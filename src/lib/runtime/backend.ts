// Thin wrapper over Tauri commands with graceful fallbacks when the UI runs
// in a plain browser (`npm run dev` without Tauri).
import type { SourceMap } from '../codegen/compile';

export const inTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function core() {
  return import('@tauri-apps/api/core');
}

export async function readTextFile(path: string): Promise<string> {
  return (await core()).invoke<string>('read_text_file', { path });
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await (await core()).invoke('write_text_file', { path, content });
}

export async function openBlkDialog(): Promise<string | null> {
  if (!inTauri) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ multiple: false, filters: [{ name: 'Nodus graph', extensions: ['blk'] }] });
  return typeof r === 'string' ? r : null;
}

export async function saveBlkDialog(defaultPath?: string): Promise<string | null> {
  if (!inTauri) return null;
  const { save } = await import('@tauri-apps/plugin-dialog');
  const r = await save({ defaultPath, filters: [{ name: 'Nodus graph', extensions: ['blk'] }] });
  if (!r) return null;
  return r.endsWith('.blk') ? r : `${r}.blk`;
}

export async function confirmDialog(message: string, title = 'Nodus'): Promise<boolean> {
  if (!inTauri) return window.confirm(message);
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(message, { title, kind: 'warning' });
}

export async function listUserBlocks(): Promise<{ dir: string; files: { name: string; content: string }[] }> {
  if (!inTauri) return { dir: '~/.local/share/nodus/blocks', files: [] };
  return (await core()).invoke('list_user_blocks');
}

export async function autosaveWrite(content: string) {
  if (!inTauri) {
    try {
      localStorage.setItem('nodus.autosave', content);
    } catch {
      /* quota */
    }
    return;
  }
  await (await core()).invoke('autosave_write', { content });
}

export async function autosaveRead(): Promise<string | null> {
  if (!inTauri) return localStorage.getItem('nodus.autosave');
  return (await core()).invoke<string | null>('autosave_read');
}

export async function autosaveClear() {
  if (!inTauri) {
    localStorage.removeItem('nodus.autosave');
    return;
  }
  await (await core()).invoke('autosave_clear');
}

export async function cliFile(): Promise<string | null> {
  if (!inTauri) return null;
  return (await core()).invoke<string | null>('cli_file');
}

export async function setWindowTitle(title: string) {
  if (!inTauri) {
    document.title = title;
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().setTitle(title);
}

export interface RunRequest {
  code: string;
  sourcemap: SourceMap;
  mode: 'run' | 'slow' | 'step';
  delay_ms: number;
  breakpoints: string[];
  cpu_limit_s: number;
  output_limit: number;
  cwd: string | null;
  python: string | null;
}

export interface RunnerBatch {
  run_id: number;
  events: string[];
}

// In a plain browser during development the Vite dev server (dev-runner.ts)
// plays the role of the Rust runner over HTTP + SSE.
const devListeners = new Set<(b: RunnerBatch) => void>();
let devSource: EventSource | null = null;

function devStream(id: number) {
  devSource?.close();
  const src = new EventSource(`/__nodus/events?id=${id}`);
  devSource = src;
  let batch: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const events = batch;
    batch = [];
    for (const l of devListeners) l({ run_id: id, events });
  };
  src.onmessage = (e) => {
    batch.push(e.data);
    if (e.data.includes('"type": "exit"') || e.data.includes('"type":"exit"')) {
      src.close();
      flush();
      return;
    }
    timer ??= setTimeout(flush, 16);
  };
  src.onerror = () => src.close();
}

async function devPost(path: string, data: unknown) {
  const r = await fetch(`/__nodus/${path}`, { method: 'POST', body: JSON.stringify(data) });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function runProgram(req: RunRequest): Promise<number> {
  if (!inTauri) {
    if (!import.meta.env.DEV) throw new Error('Запуск программ доступен только в десктоп-приложении (npm run tauri dev)');
    const { id } = await devPost('run', req);
    devStream(id);
    return id;
  }
  return (await core()).invoke<number>('run_program', { req });
}

export async function runnerCommand(cmd: Record<string, unknown>) {
  if (!inTauri) {
    if (import.meta.env.DEV) await devPost('cmd', cmd);
    return;
  }
  await (await core()).invoke('runner_command', { cmd });
}

export async function stopProgram() {
  if (!inTauri) {
    if (import.meta.env.DEV) await devPost('stop', {});
    devSource?.close();
    return;
  }
  await (await core()).invoke('stop_program');
}

export async function onRunnerEvents(cb: (b: RunnerBatch) => void): Promise<() => void> {
  if (!inTauri) {
    devListeners.add(cb);
    return () => devListeners.delete(cb);
  }
  const { listen } = await import('@tauri-apps/api/event');
  return listen<RunnerBatch>('runner-events', (e) => cb(e.payload));
}

export async function onCloseRequested(cb: () => Promise<boolean>, isDirty: () => boolean): Promise<void> {
  if (!inTauri) {
    window.addEventListener('beforeunload', (e) => {
      if (isDirty()) e.preventDefault();
    });
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  await win.onCloseRequested(async (event) => {
    if (!(await cb())) event.preventDefault();
  });
}
