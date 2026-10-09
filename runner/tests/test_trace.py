"""Tests for runner/trace.py: run small programs through the tracer as a subprocess."""

from __future__ import annotations

import json
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

TRACE = Path(__file__).resolve().parents[1] / "trace.py"


def write_program(tmp_path: Path, source: str, lines: dict[int, str], **extra) -> Path:
    program = tmp_path / "program.py"
    program.write_text(textwrap.dedent(source).lstrip("\n"), encoding="utf-8")
    config = {
        "program": str(program),
        "sourcemap": {"lines": {str(k): v for k, v in lines.items()}, "watches": extra.pop("watches", {}), "vars": extra.pop("vars", [])},
        "mode": "run",
        "delay_ms": 0,
        "breakpoints": [],
        "cpu_limit_s": 10,
        "output_limit": 1_000_000,
    }
    config.update(extra)
    cfg = tmp_path / "config.json"
    cfg.write_text(json.dumps(config), encoding="utf-8")
    return cfg


def run(cfg: Path, stdin: str = "", timeout: float = 15) -> list[dict]:
    proc = subprocess.run(
        [sys.executable, "-u", str(TRACE), str(cfg)],
        input=stdin,
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    assert proc.stderr == "", proc.stderr
    return [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]


def of_type(events: list[dict], kind: str) -> list[dict]:
    return [e for e in events if e["type"] == kind]


def stdout_text(events: list[dict]) -> str:
    return "".join(e["text"] for e in of_type(events, "stdout"))


class Session:
    """Interactive tracer session for step / breakpoint tests."""

    def __init__(self, cfg: Path):
        self.proc = subprocess.Popen(
            [sys.executable, "-u", str(TRACE), str(cfg)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        self.events: list[dict] = []

    def send(self, **cmd):
        assert self.proc.stdin is not None
        self.proc.stdin.write(json.dumps(cmd) + "\n")
        self.proc.stdin.flush()

    def until(self, kind: str, timeout: float = 10) -> dict:
        assert self.proc.stdout is not None
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            line = self.proc.stdout.readline()
            if not line:
                break
            event = json.loads(line)
            self.events.append(event)
            if event["type"] == kind:
                return event
        raise AssertionError(f"no {kind!r} event; got {[e['type'] for e in self.events]}")

    def close(self):
        self.proc.kill()
        self.proc.wait()


HELLO = """
def on_start():
    print("Hello, World!")
    print("bye")


if __name__ == "__main__":
    on_start()
"""


def test_hello_world_events(tmp_path):
    cfg = write_program(tmp_path, HELLO, {2: "print1", 3: "print2", 7: "start"}, mode="slow")
    events = run(cfg)
    assert events[0] == {"type": "start"}
    assert events[-1] == {"type": "done", "status": "ok"}
    assert stdout_text(events) == "Hello, World!\nbye\n"
    nodes = [e["node_id"] for e in of_type(events, "line")]
    assert nodes == ["start", "print1", "print2"]
    assert all(set(e) == {"type", "line", "node_id"} for e in of_type(events, "line"))


def test_stdout_is_ordered_with_line_events(tmp_path):
    cfg = write_program(tmp_path, HELLO, {2: "print1", 3: "print2", 7: "start"}, mode="slow")
    events = run(cfg)
    kinds = [(e["type"], e.get("node_id") or e.get("text")) for e in events if e["type"] in ("line", "stdout")]
    assert kinds == [
        ("line", "start"),
        ("line", "print1"),
        ("stdout", "Hello, World!\n"),
        ("line", "print2"),
        ("stdout", "bye\n"),
    ]


def test_error_is_mapped_to_node(tmp_path):
    src = """
    def on_start():
        x = 1
        print(x / 0)


    on_start()
    """
    cfg = write_program(tmp_path, src, {2: "set", 3: "div", 6: "start"})
    events = run(cfg)
    err = of_type(events, "error")[0]
    assert err["line"] == 3
    assert err["node_id"] == "div"
    assert err["msg"].startswith("ZeroDivisionError")
    assert "trace.py" not in err["traceback"]
    assert 'File "program.py", line 3' in err["traceback"]
    assert str(tmp_path) not in err["traceback"]
    assert events[-1] == {"type": "done", "status": "error"}


def test_syntax_error_reports_line(tmp_path):
    cfg = write_program(tmp_path, "x = (\n", {1: "broken"})
    events = run(cfg)
    err = of_type(events, "error")[0]
    assert err["msg"].startswith("SyntaxError")
    assert err["node_id"] == "broken"


def test_input_request_and_reply(tmp_path):
    src = """
    name = input("Name: ")
    print("Hi", name)
    """
    cfg = write_program(tmp_path, src, {1: "input", 2: "print"})
    events = run(cfg, stdin=json.dumps({"cmd": "input", "text": "Ada"}) + "\n")
    req = of_type(events, "input_request")[0]
    assert req["prompt"] == "Name: "
    assert stdout_text(events) == "Name: Ada\nHi Ada\n"
    assert events[-1]["status"] == "ok"


def test_vars_snapshot_contains_globals_and_locals(tmp_path):
    src = """
    score = 10


    def on_start():
        global score
        item = [1, 2]
        score = score + 5


    on_start()
    """
    cfg = write_program(tmp_path, src, {6: "a", 7: "b", 10: "start"}, vars=["score"], mode="slow")
    events = run(cfg)
    snaps = of_type(events, "vars")
    assert any(s["locals"].get("item", {}).get("repr") == "[1, 2]" for s in snaps)
    assert snaps[-1]["globals"]["score"] == {"repr": "15", "type": "int"}


def test_watches_report_wire_values(tmp_path):
    src = """
    def on_start():
        a = 40
        print(a + 2)


    on_start()
    """
    cfg = write_program(
        tmp_path,
        src,
        {2: "set", 3: "print", 6: "start"},
        watches={"print": [{"edge": "e-add", "expr": "a + 2"}, {"edge": "e-bad", "expr": "missing_name"}]},
        mode="slow",
    )
    events = run(cfg)
    values = of_type(events, "values")
    assert values == [{"type": "values", "node_id": "print", "values": {"e-add": "42"}}]


def test_run_mode_throttles_line_events(tmp_path):
    src = """
    total = 0
    for i in range(200000):
        total += i
    print(total)
    """
    cfg = write_program(tmp_path, src, {1: "a", 2: "loop", 3: "add", 4: "print"})
    events = run(cfg)
    assert stdout_text(events) == f"{sum(range(200000))}\n"
    assert len(of_type(events, "line")) < 2000


def test_output_limit(tmp_path):
    src = """
    while True:
        print("x" * 100)
    """
    cfg = write_program(tmp_path, src, {1: "loop", 2: "print"}, output_limit=5000)
    events = run(cfg)
    err = of_type(events, "error")[0]
    assert err["msg"].startswith("OutputLimit")
    assert err["node_id"] == "print"
    assert events[-1]["status"] == "error"
    assert len(stdout_text(events)) <= 5200


def test_cpu_time_limit(tmp_path):
    src = """
    while True:
        pass
    """
    cfg = write_program(tmp_path, src, {1: "loop", 2: "pass"}, cpu_limit_s=1)
    events = run(cfg, timeout=20)
    err = of_type(events, "error")[0]
    assert err["msg"].startswith("Timeout")
    assert err["node_id"] in ("loop", "pass")


def test_step_mode_pauses_on_every_node(tmp_path):
    cfg = write_program(tmp_path, HELLO, {2: "print1", 3: "print2", 7: "start"}, mode="step")
    s = Session(cfg)
    try:
        assert s.until("paused")["node_id"] == "start"
        s.send(cmd="step")
        assert s.until("paused")["node_id"] == "print1"
        s.send(cmd="step")
        p = s.until("paused")
        assert p["node_id"] == "print2" and p["reason"] == "step"
        assert "Hello, World!\n" in stdout_text(s.events)
        assert "bye" not in stdout_text(s.events)
        s.send(cmd="continue")
        assert s.until("done")["status"] == "ok"
    finally:
        s.close()


def test_breakpoint_then_continue(tmp_path):
    src = """
    def on_start():
        for i in range(3):
            print(i)


    on_start()
    """
    cfg = write_program(tmp_path, src, {2: "for", 3: "print", 6: "start"}, breakpoints=["print"])
    s = Session(cfg)
    try:
        p = s.until("paused")
        assert p == {"type": "paused", "line": 3, "node_id": "print", "reason": "breakpoint"}
        # node changes print → for → print, so the breakpoint fires on every iteration
        s.send(cmd="continue")
        assert s.until("paused")["node_id"] == "print"
        s.send(cmd="breakpoints", nodes=[])
        s.send(cmd="continue")
        assert s.until("done")["status"] == "ok"
        assert stdout_text(s.events) == "0\n1\n2\n"
    finally:
        s.close()


def test_pause_command_switches_to_stepping(tmp_path):
    src = """
    import time
    def on_start():
        while True:
            time.sleep(0.01)


    on_start()
    """
    cfg = write_program(tmp_path, src, {3: "while", 4: "sleep", 7: "start"})
    s = Session(cfg)
    try:
        s.until("start")
        s.send(cmd="pause")
        assert s.until("paused")["node_id"] in ("while", "sleep")
    finally:
        s.close()


def test_slow_mode_waits_between_nodes(tmp_path):
    cfg = write_program(tmp_path, HELLO, {2: "print1", 3: "print2", 7: "start"}, mode="slow", delay_ms=150)
    t0 = time.monotonic()
    events = run(cfg)
    assert time.monotonic() - t0 >= 0.4
    assert events[-1]["status"] == "ok"


def test_untracked_lines_are_silent(tmp_path):
    cfg = write_program(tmp_path, HELLO, {}, mode="slow")
    events = run(cfg)
    assert of_type(events, "line") == []
    assert stdout_text(events) == "Hello, World!\nbye\n"


@pytest.mark.parametrize("example", ["hello-world", "fizzbuzz"])
def test_generated_examples_run(tmp_path, example):
    """Golden programs produced by the codegen tests (src/lib/codegen/__snapshots__)."""
    golden = Path(__file__).resolve().parents[2] / "src/lib/codegen/__golden__" / f"{example}.py"
    if not golden.exists():
        pytest.skip("run `npm test` first to produce golden files")
    cfg = write_program(tmp_path, golden.read_text(encoding="utf-8"), {})
    events = run(cfg)
    assert events[-1]["status"] == "ok"
    out = stdout_text(events)
    if example == "fizzbuzz":
        lines = out.splitlines()
        assert lines[:5] == ["1", "2", "Fizz", "4", "Buzz"]
        assert lines[14] == "FizzBuzz"
        assert len(lines) == 100
    else:
        assert out == "Hello, World!\n"
