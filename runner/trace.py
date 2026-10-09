#!/usr/bin/env python3
"""Nodus tracer.

Runs a generated program under ``sys.settrace`` and reports what happens as
JSON lines on stdout.  Usage::

    python3 trace.py config.json

``config.json``::

    {
      "program": "/path/program.py",
      "sourcemap": {"lines": {"3": "node-id"}, "watches": {"node-id": [{"edge": "e1", "expr": "x + 1"}]},
                    "vars": ["score"]},
      "mode": "run" | "slow" | "step",
      "delay_ms": 300,
      "breakpoints": ["node-id"],
      "cpu_limit_s": 30,
      "output_limit": 1000000
    }

Events (one JSON object per line on stdout)::

    {"type": "start"}
    {"type": "line", "line": 3, "node_id": "n1"}
    {"type": "vars", "globals": {...}, "locals": {...}}
    {"type": "values", "node_id": "n1", "values": {"edge-id": "42"}}
    {"type": "stdout", "text": "hello\\n"}
    {"type": "paused", "line": 3, "node_id": "n1", "reason": "step" | "breakpoint"}
    {"type": "resumed"}
    {"type": "input_request", "prompt": "Name: "}
    {"type": "error", "line": 3, "node_id": "n1", "msg": "ZeroDivisionError: ...", "traceback": "..."}
    {"type": "done", "status": "ok" | "error"}

Commands (one JSON object per line on stdin)::

    {"cmd": "step"} {"cmd": "continue"} {"cmd": "pause"}
    {"cmd": "mode", "mode": "run" | "slow", "delay_ms": 500}
    {"cmd": "breakpoints", "nodes": ["n1"]}
    {"cmd": "input", "text": "Alice"}
"""

from __future__ import annotations

import builtins
import json
import os
import signal
import sys
import threading
import time
import traceback
import types

RUN_THROTTLE_S = 1 / 30  # line events in "run" mode
VARS_THROTTLE_S = 1 / 5  # vars snapshots in "run" mode
REPR_LIMIT = 200


class Tracer:
    def __init__(self, config: dict, out=None, inp=None):
        self.out = out if out is not None else sys.__stdout__
        self.inp = inp if inp is not None else sys.__stdin__
        self.program = os.path.abspath(config["program"])
        sm = config.get("sourcemap") or {}
        self.lines: dict[int, str] = {int(k): v for k, v in (sm.get("lines") or {}).items()}
        self.watches: dict[str, list] = sm.get("watches") or {}
        self.var_names: list[str] = list(sm.get("vars") or [])
        self.output_limit = int(config.get("output_limit") or 0)
        self.cpu_limit = int(config.get("cpu_limit_s") or 0)

        mode = config.get("mode") or "run"
        self.stepping = mode == "step"
        self.base_mode = "slow" if mode == "slow" else "run"
        self.delay = max(0.0, float(config.get("delay_ms") or 0) / 1000.0)
        self.breakpoints = set(config.get("breakpoints") or [])

        self.cond = threading.Condition()
        self.resume_token = 0
        self.inputs: list[str] = []
        self.closed = False

        self.write_lock = threading.Lock()
        self.out_bytes = 0
        self.out_buf = ""
        self.last_node: str | None = None
        self.last_line_emit = 0.0
        self.last_vars_emit = 0.0
        self.current_line = 0

    # ----------------------------------------------------------- output
    def emit(self, event: dict) -> None:
        data = json.dumps(event, ensure_ascii=False, default=str)
        with self.write_lock:
            try:
                self.out.write(data + "\n")
                self.out.flush()
            except (BrokenPipeError, ValueError):
                os._exit(1)

    def write_stdout(self, text: str) -> int:
        if not text:
            return 0
        self.out_bytes += len(text.encode("utf-8", "replace"))
        if self.output_limit and self.out_bytes > self.output_limit:
            self.flush_stdout()
            self.emit({"type": "stdout", "text": "\n"})
            self.fail_hard(f"OutputLimit: вывод превысил {self.output_limit} байт")
        self.out_buf += text
        if "\n" in self.out_buf or len(self.out_buf) > 4096:
            self.flush_stdout()
        return len(text)

    def flush_stdout(self) -> None:
        if self.out_buf:
            text, self.out_buf = self.out_buf, ""
            self.emit({"type": "stdout", "text": text})

    def fail_hard(self, msg: str) -> None:
        node = self.lines.get(self.current_line)
        self.emit({"type": "error", "line": self.current_line, "node_id": node, "msg": msg, "traceback": ""})
        self.emit({"type": "done", "status": "error"})
        os._exit(2)

    # ---------------------------------------------------------- control
    def control_loop(self) -> None:
        for raw in self.inp:
            raw = raw.strip()
            if not raw:
                continue
            try:
                cmd = json.loads(raw)
            except ValueError:
                continue
            self.handle_command(cmd)
        # parent closed our stdin: nobody is listening any more
        with self.cond:
            self.closed = True
            self.cond.notify_all()

    def handle_command(self, cmd: dict) -> None:
        kind = cmd.get("cmd")
        with self.cond:
            if kind == "step":
                self.stepping = True
                self.resume_token += 1
            elif kind == "continue":
                self.stepping = False
                self.resume_token += 1
            elif kind == "pause":
                self.stepping = True
            elif kind == "mode":
                if cmd.get("mode") in ("run", "slow"):
                    self.base_mode = cmd["mode"]
                if "delay_ms" in cmd:
                    self.delay = max(0.0, float(cmd["delay_ms"]) / 1000.0)
            elif kind == "breakpoints":
                self.breakpoints = set(cmd.get("nodes") or [])
            elif kind == "input":
                self.inputs.append(str(cmd.get("text", "")))
            self.cond.notify_all()

    def wait_resume(self) -> None:
        with self.cond:
            token = self.resume_token
            while self.resume_token == token and not self.closed:
                self.cond.wait()
            if self.closed:
                os._exit(1)

    def sleep(self, seconds: float) -> None:
        """Interruptible delay: a step/continue command or a new delay cuts it short."""
        end = time.monotonic() + seconds
        with self.cond:
            token = self.resume_token
            while self.resume_token == token and self.base_mode == "slow":
                left = end - time.monotonic()
                if left <= 0:
                    break
                self.cond.wait(left)

    def read_input(self, prompt: object = "") -> str:
        prompt = str(prompt)
        if prompt:
            self.write_stdout(prompt)
        self.flush_stdout()
        self.emit({"type": "input_request", "prompt": prompt})
        with self.cond:
            while not self.inputs and not self.closed:
                self.cond.wait()
            if not self.inputs:
                raise EOFError("ввод закрыт")
            text = self.inputs.pop(0)
        self.write_stdout(text + "\n")
        self.flush_stdout()
        return text

    # ------------------------------------------------------------ state
    @staticmethod
    def short_repr(value: object) -> str:
        try:
            r = repr(value)
        except Exception as exc:  # noqa: BLE001 - user objects may raise anything
            r = f"<repr failed: {exc}>"
        if len(r) > REPR_LIMIT:
            r = r[: REPR_LIMIT - 1] + "…"
        return r

    def describe(self, value: object) -> dict:
        return {"repr": self.short_repr(value), "type": type(value).__name__}

    def snapshot_vars(self, frame: types.FrameType) -> None:
        g = frame.f_globals
        globs = {n: self.describe(g[n]) for n in self.var_names if n in g}
        locs = {}
        if frame.f_code.co_name != "<module>":
            for name, value in frame.f_locals.items():
                if name.startswith("_") or isinstance(value, (types.ModuleType, types.FunctionType, type)):
                    continue
                locs[name] = self.describe(value)
        self.emit({"type": "vars", "globals": globs, "locals": locs, "scope": frame.f_code.co_name})

    def eval_watches(self, node: str, frame: types.FrameType) -> None:
        watches = self.watches.get(node)
        if not watches:
            return
        values = {}
        for w in watches:
            try:
                values[w["edge"]] = self.short_repr(eval(w["expr"], frame.f_globals, frame.f_locals))  # noqa: S307
            except Exception:  # noqa: BLE001 - value not available yet
                continue
        if values:
            self.emit({"type": "values", "node_id": node, "values": values})

    # ------------------------------------------------------------ trace
    def global_trace(self, frame: types.FrameType, event: str, arg):
        if frame.f_code.co_filename == self.program:
            return self.local_trace
        return None

    def local_trace(self, frame: types.FrameType, event: str, arg):
        if event != "line":
            return self.local_trace
        line = frame.f_lineno
        node = self.lines.get(line)
        if node is None:
            return self.local_trace
        self.current_line = line
        changed = node != self.last_node
        self.last_node = node
        now = time.monotonic()

        pause_reason = None
        if changed:
            if node in self.breakpoints:
                pause_reason = "breakpoint"
            elif self.stepping:
                pause_reason = "step"

        detailed = pause_reason is not None or self.base_mode == "slow"
        if detailed or now - self.last_line_emit >= RUN_THROTTLE_S:
            self.last_line_emit = now
            self.flush_stdout()
            self.emit({"type": "line", "line": line, "node_id": node})
            if changed:
                self.eval_watches(node, frame)
        if detailed or now - self.last_vars_emit >= VARS_THROTTLE_S:
            self.last_vars_emit = now
            self.snapshot_vars(frame)

        if pause_reason:
            self.flush_stdout()
            self.emit({"type": "paused", "line": line, "node_id": node, "reason": pause_reason})
            self.wait_resume()
            self.emit({"type": "resumed"})
        elif self.base_mode == "slow" and changed and self.delay > 0:
            self.sleep(self.delay)
        return self.local_trace

    # -------------------------------------------------------------- run
    def error_location(self, tb) -> int:
        line = 0
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == self.program:
                line = tb.tb_lineno
            tb = tb.tb_next
        return line

    def error_frame(self, tb):
        frame = None
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == self.program:
                frame = tb.tb_frame
            tb = tb.tb_next
        return frame

    def format_traceback(self, exc: BaseException) -> str:
        """Traceback limited to frames of the user's program (tracer frames are noise)."""
        frames = [f for f in traceback.extract_tb(exc.__traceback__) if f.filename == self.program]
        text = "Traceback (most recent call last):\n" if frames else ""
        text += "".join(traceback.format_list(frames))
        text += "".join(traceback.format_exception_only(type(exc), exc))
        return text.replace(self.program, os.path.basename(self.program))

    def install_limits(self) -> None:
        try:
            import resource

            if self.cpu_limit > 0:
                resource.setrlimit(resource.RLIMIT_CPU, (self.cpu_limit, self.cpu_limit + 2))
                signal.signal(
                    signal.SIGXCPU,
                    lambda *_: self.fail_hard(f"Timeout: превышен лимит процессорного времени {self.cpu_limit} с"),
                )
            mem = 2 * 1024**3
            soft, hard = resource.getrlimit(resource.RLIMIT_AS)
            if hard == resource.RLIM_INFINITY or hard > mem:
                resource.setrlimit(resource.RLIMIT_AS, (mem, hard))
        except (ImportError, ValueError, OSError):
            pass

    def run(self) -> int:
        with open(self.program, encoding="utf-8") as fh:
            source = fh.read()
        threading.Thread(target=self.control_loop, daemon=True, name="nodus-control").start()
        self.install_limits()

        tracer = self

        class Stdout:
            encoding = "utf-8"

            def write(self, s):
                return tracer.write_stdout(str(s))

            def flush(self):
                tracer.flush_stdout()

            def isatty(self):
                return False

        builtins.input = self.read_input
        sys.stdout = Stdout()
        sys.argv = [self.program]
        sys.path.insert(0, os.path.dirname(self.program))
        self.emit({"type": "start"})

        status = "ok"
        g = {"__name__": "__main__", "__file__": self.program, "__builtins__": builtins}
        try:
            code = compile(source, self.program, "exec")
            sys.settrace(self.global_trace)
            threading.settrace(self.global_trace)
            exec(code, g)  # noqa: S102 - running user's program is the whole point
        except SystemExit as exc:
            if exc.code not in (None, 0):
                status = "error"
        except BaseException as exc:  # noqa: BLE001
            sys.settrace(None)
            status = "error"
            frame = self.error_frame(exc.__traceback__)
            if frame is not None:
                self.snapshot_vars(frame)
            if isinstance(exc, SyntaxError) and exc.filename == self.program:
                line = exc.lineno or 0
            else:
                line = self.error_location(exc.__traceback__)
            self.flush_stdout()
            self.emit(
                {
                    "type": "error",
                    "line": line,
                    "node_id": self.lines.get(line),
                    "msg": f"{type(exc).__name__}: {exc}",
                    "traceback": self.format_traceback(exc),
                }
            )
        finally:
            sys.settrace(None)
            threading.settrace(None)  # type: ignore[arg-type]
            sys.stdout = sys.__stdout__
        self.flush_stdout()
        if status == "ok":
            self.emit({"type": "vars", "globals": {n: self.describe(g[n]) for n in self.var_names if n in g}, "locals": {}, "scope": "<module>"})
        self.emit({"type": "done", "status": status})
        return 0 if status == "ok" else 1


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: trace.py config.json", file=sys.stderr)
        return 2
    with open(argv[1], encoding="utf-8") as fh:
        config = json.load(fh)
    return Tracer(config).run()


if __name__ == "__main__":
    code = main(sys.argv)
    sys.stdout.flush()
    os._exit(code)
