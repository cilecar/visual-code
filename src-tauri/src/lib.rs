//! Nodus backend: file IO, autosave, user blocks and the Python runner.
//!
//! The runner spawns `python3 trace.py <config.json>` in its own process group,
//! streams JSON-lines from its stdout to the frontend as batched Tauri events and
//! forwards control commands (step / continue / input …) to its stdin.

mod runner;

use serde::Serialize;
use std::fs;
use std::path::PathBuf;

fn data_dir() -> PathBuf {
    let home = || std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."));
    // Inside Flatpak XDG_DATA_HOME points into ~/.var/app; user blocks live in
    // the host's ~/.local/share/nodus (granted via --filesystem in the manifest).
    if std::env::var_os("FLATPAK_ID").is_some() {
        return home().join(".local").join("share").join("nodus");
    }
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| home().join(".local").join("share"));
    base.join("nodus")
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

/// Atomic write: write next to the target and rename over it.
#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let tmp = target.with_extension("blk~tmp");
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("{path}: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("{path}: {e}"))
}

#[derive(Serialize)]
struct UserBlockFile {
    name: String,
    content: String,
}

#[derive(Serialize)]
struct UserBlocks {
    dir: String,
    files: Vec<UserBlockFile>,
}

#[tauri::command]
fn list_user_blocks() -> Result<UserBlocks, String> {
    let dir = data_dir().join("blocks");
    let _ = fs::create_dir_all(&dir);
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(&p) {
                files.push(UserBlockFile {
                    name: p.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                    content,
                });
            }
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(UserBlocks { dir: dir.to_string_lossy().into_owned(), files })
}

#[tauri::command]
fn autosave_write(content: String) -> Result<(), String> {
    let dir = data_dir();
    fs::create_dir_all(&dir).map_err(err)?;
    let tmp = dir.join("autosave.blk.tmp");
    fs::write(&tmp, content).map_err(err)?;
    fs::rename(tmp, dir.join("autosave.blk")).map_err(err)
}

#[tauri::command]
fn autosave_read() -> Option<String> {
    fs::read_to_string(data_dir().join("autosave.blk")).ok()
}

#[tauri::command]
fn autosave_clear() {
    let _ = fs::remove_file(data_dir().join("autosave.blk"));
}

/// A `.blk` path passed on the command line (file association / `nodus file.blk`).
#[tauri::command]
fn cli_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| a.ends_with(".blk"))
        .map(|a| {
            let p = PathBuf::from(&a);
            fs::canonicalize(&p).unwrap_or(p).to_string_lossy().into_owned()
        })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(runner::RunnerState::default())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            list_user_blocks,
            autosave_write,
            autosave_read,
            autosave_clear,
            cli_file,
            runner::run_program,
            runner::runner_command,
            runner::stop_program,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Nodus");

    app.run(|handle, event| {
        if let tauri::RunEvent::Exit = event {
            use tauri::Manager;
            runner::kill_current(&handle.state::<runner::RunnerState>());
        }
    });
}
