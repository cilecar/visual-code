//! Process runner for generated Python programs.

use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const TRACE_PY: &str = include_str!("../../runner/trace.py");
/// Events are flushed to the webview at most this often.
const FLUSH_INTERVAL: Duration = Duration::from_millis(16);
const MAX_BATCH: usize = 512;
/// Hard cap on a single stdout line coming from the tracer.
const MAX_LINE: usize = 256 * 1024;

struct Run {
    id: u64,
    child: Child,
    stdin: Option<ChildStdin>,
    workdir: PathBuf,
}

#[derive(Default)]
pub struct RunnerState {
    current: Mutex<Option<Run>>,
    counter: AtomicU64,
}

#[derive(Deserialize)]
pub struct RunRequest {
    code: String,
    sourcemap: serde_json::Value,
    mode: String,
    delay_ms: u64,
    breakpoints: Vec<String>,
    cpu_limit_s: u64,
    output_limit: u64,
    cwd: Option<String>,
    python: Option<String>,
}

#[derive(Serialize, Clone)]
struct RunnerBatch {
    run_id: u64,
    events: Vec<String>,
}

fn kill_run(mut run: Run) {
    let pid = run.child.id() as i32;
    // The child is the leader of its own process group (process_group(0)),
    // so killing -pid takes down everything it spawned too.
    unsafe {
        libc::killpg(pid, libc::SIGKILL);
    }
    let _ = run.child.kill();
    let _ = run.child.wait();
    let _ = fs::remove_dir_all(&run.workdir);
}

pub fn kill_current(state: &RunnerState) {
    if let Some(run) = state.current.lock().unwrap().take() {
        kill_run(run);
    }
}

fn json_event(kind: &str, text: &str) -> String {
    serde_json::json!({ "type": kind, "text": text }).to_string()
}

#[tauri::command]
pub fn run_program(app: AppHandle, state: State<'_, RunnerState>, req: RunRequest) -> Result<u64, String> {
    kill_current(&state);

    let id = state.counter.fetch_add(1, Ordering::SeqCst) + 1;
    let workdir = std::env::temp_dir().join(format!("nodus-{}-{}", std::process::id(), id));
    fs::create_dir_all(&workdir).map_err(|e| e.to_string())?;
    let program = workdir.join("program.py");
    let trace = workdir.join("trace.py");
    let config = workdir.join("config.json");
    fs::write(&program, &req.code).map_err(|e| e.to_string())?;
    fs::write(&trace, TRACE_PY).map_err(|e| e.to_string())?;
    let cfg = serde_json::json!({
        "program": program,
        "sourcemap": req.sourcemap,
        "mode": req.mode,
        "delay_ms": req.delay_ms,
        "breakpoints": req.breakpoints,
        "cpu_limit_s": req.cpu_limit_s,
        "output_limit": req.output_limit,
    });
    fs::write(&config, cfg.to_string()).map_err(|e| e.to_string())?;

    let cwd = req
        .cwd
        .map(PathBuf::from)
        .filter(|p| p.is_dir())
        .or_else(|| std::env::var_os("HOME").map(PathBuf::from))
        .unwrap_or_else(|| workdir.clone());

    let python = req.python.filter(|p| !p.trim().is_empty()).unwrap_or_else(|| "python3".into());
    let mut child = Command::new(&python)
        .arg("-u")
        .arg("-X")
        .arg("utf8")
        .arg(&trace)
        .arg(&config)
        .current_dir(&cwd)
        .env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONDONTWRITEBYTECODE", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("Не удалось запустить {python}: {e}"))?;

    let stdout = child.stdout.take().ok_or("no stdout")?;
    let stderr = child.stderr.take().ok_or("no stderr")?;
    let stdin = child.stdin.take();

    let (tx, rx) = mpsc::channel::<String>();

    // stdout: JSON lines from the tracer, forwarded verbatim.
    let tx_out = tx.clone();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut buf = Vec::new();
        loop {
            buf.clear();
            match reader.read_until(b'\n', &mut buf) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if buf.len() > MAX_LINE {
                        buf.truncate(MAX_LINE);
                    }
                    let line = String::from_utf8_lossy(&buf).trim_end().to_string();
                    if line.is_empty() {
                        continue;
                    }
                    if line.starts_with('{') {
                        if tx_out.send(line).is_err() {
                            break;
                        }
                    } else if tx_out.send(json_event("stdout", &format!("{line}\n"))).is_err() {
                        break;
                    }
                }
            }
        }
    });

    // stderr: anything Python prints outside of the tracer (crashes of the tracer itself).
    let tx_err = tx;
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().map_while(Result::ok) {
            if tx_err.send(json_event("stderr", &format!("{line}\n"))).is_err() {
                break;
            }
        }
    });

    // Batching emitter; also reaps the child when both pipes are closed.
    let app2 = app.clone();
    thread::spawn(move || {
        let mut batch: Vec<String> = Vec::new();
        let mut last_flush = Instant::now();
        let flush = |batch: &mut Vec<String>| {
            if !batch.is_empty() {
                let _ = app2.emit("runner-events", RunnerBatch { run_id: id, events: std::mem::take(batch) });
            }
        };
        loop {
            match rx.recv_timeout(FLUSH_INTERVAL) {
                Ok(line) => {
                    batch.push(line);
                    if batch.len() >= MAX_BATCH || last_flush.elapsed() >= FLUSH_INTERVAL {
                        flush(&mut batch);
                        last_flush = Instant::now();
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    flush(&mut batch);
                    last_flush = Instant::now();
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        flush(&mut batch);

        let state = app2.state::<RunnerState>();
        let mut code: Option<i32> = None;
        let mut guard = state.current.lock().unwrap();
        if guard.as_ref().map(|r| r.id) == Some(id) {
            if let Some(mut run) = guard.take() {
                code = run.child.wait().ok().and_then(|s| {
                    use std::os::unix::process::ExitStatusExt;
                    s.code().or_else(|| s.signal().map(|sig| -sig))
                });
                let _ = fs::remove_dir_all(&run.workdir);
            }
        }
        drop(guard);
        let exit = serde_json::json!({ "type": "exit", "code": code }).to_string();
        let _ = app2.emit("runner-events", RunnerBatch { run_id: id, events: vec![exit] });
    });

    *state.current.lock().unwrap() = Some(Run { id, child, stdin, workdir });
    Ok(id)
}

/// Sends one JSON control command (step, continue, input, …) to the tracer.
#[tauri::command]
pub fn runner_command(state: State<'_, RunnerState>, cmd: serde_json::Value) -> Result<(), String> {
    let mut guard = state.current.lock().unwrap();
    let run = guard.as_mut().ok_or("Программа не запущена")?;
    let stdin = run.stdin.as_mut().ok_or("stdin закрыт")?;
    let mut line = cmd.to_string();
    line.push('\n');
    stdin.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stop_program(state: State<'_, RunnerState>) {
    kill_current(&state);
}
