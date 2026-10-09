// Run state: talks to the Rust runner, turns tracer events into UI state
// (active block, trail, wire values, output, variables, errors).
import { SvelteMap } from 'svelte/reactivity';
import type { SourceMap } from '../codegen/compile';
import { GraphIndex } from '../graph/query';
import { validate } from '../graph/validate';
import { editor } from '../stores/editor.svelte';
import { toast, ui } from '../stores/ui.svelte';
import * as backend from './backend';

export type RunMode = 'run' | 'slow' | 'step';
export type RunStatus = 'idle' | 'running' | 'paused' | 'input' | 'done' | 'error' | 'stopped';

export interface OutChunk {
  kind: 'out' | 'err' | 'sys' | 'in';
  text: string;
}

export interface VarInfo {
  repr: string;
  type: string;
}

export interface VarsSnapshot {
  globals: Record<string, VarInfo>;
  locals: Record<string, VarInfo>;
  scope: string;
}

export interface RunError {
  nodeId: string | null;
  line: number;
  msg: string;
  traceback: string;
}

type TraceEvent =
  | { type: 'start' }
  | { type: 'line'; line: number; node_id: string }
  | ({ type: 'vars' } & VarsSnapshot)
  | { type: 'values'; node_id: string; values: Record<string, string> }
  | { type: 'stdout' | 'stderr'; text: string }
  | { type: 'paused'; line: number; node_id: string; reason: string }
  | { type: 'resumed' }
  | { type: 'input_request'; prompt: string }
  | { type: 'error'; line: number; node_id: string | null; msg: string; traceback: string }
  | { type: 'done'; status: 'ok' | 'error' }
  | { type: 'exit'; code: number | null };

const OUTPUT_CAP = 400_000;

class RunStore {
  status = $state<RunStatus>('idle');
  mode = $state<RunMode>('run');
  delayMs = $state(400);
  activeNode = $state<string | null>(null);
  activeLine = $state<number | null>(null);
  pauseReason = $state<string | null>(null);
  error = $state<RunError | null>(null);
  output = $state.raw<OutChunk[]>([]);
  vars = $state.raw<VarsSnapshot>({ globals: {}, locals: {}, scope: '' });
  inputPrompt = $state<string | null>(null);
  /** the code / source map of the current run (the Code tab follows these while running) */
  code = $state('');
  sourceMap = $state.raw<SourceMap | null>(null);
  trail = new SvelteMap<string, number>();
  edgeValues = new SvelteMap<string, { value: string; seq: number }>();
  activeEdges = $state.raw<Set<string>>(new Set());
  startedAt = $state(0);
  elapsed = $state(0);

  private runId = 0;
  private seq = 0;
  private outChars = 0;
  private pulseListeners = new Set<(edges: string[], slow: boolean) => void>();
  private indexCache = new Map<string, { key: unknown; index: GraphIndex }>();
  private unlisten: (() => void) | null = null;
  private clock: ReturnType<typeof setInterval> | null = null;

  get live() {
    return this.status === 'running' || this.status === 'paused' || this.status === 'input';
  }

  async init() {
    this.unlisten = await backend.onRunnerEvents((b) => {
      if (b.run_id !== this.runId) return;
      this.handleBatch(b.events);
    });
  }

  onPulse(cb: (edges: string[], slow: boolean) => void) {
    this.pulseListeners.add(cb);
    return () => this.pulseListeners.delete(cb);
  }

  // ---------------------------------------------------------- controls

  async start(mode: RunMode): Promise<void> {
    if (this.live) {
      if (mode === 'step') return this.step();
      return this.continue();
    }
    const v = validate(editor.fullDoc());
    editor.validation = v;
    if (v.errors > 0) {
      ui.dockTab = 'problems';
      ui.dockOpen = true;
      toast(`Граф содержит ошибки: ${v.errors}. Исправьте их перед запуском.`, 'error');
      return;
    }
    this.reset();
    this.mode = mode;
    this.code = v.result.code;
    this.sourceMap = v.result.sourceMap;
    this.status = 'running';
    this.startedAt = performance.now();
    this.elapsed = 0;
    this.clock = setInterval(() => (this.elapsed = performance.now() - this.startedAt), 100);
    this.append({ kind: 'sys', text: `▶ ${mode === 'run' ? 'Запуск' : mode === 'slow' ? 'Медленный запуск' : 'Пошаговый запуск'} — ${editor.doc.name}\n` });
    if (ui.dockTab === 'problems') ui.dockTab = 'output';
    const cwd = editor.filePath ? editor.filePath.replace(/\/[^/]*$/, '') : null;
    try {
      this.runId = await backend.runProgram({
        code: v.result.code,
        sourcemap: v.result.sourceMap,
        mode,
        delay_ms: this.delayMs,
        breakpoints: editor.breakpoints(),
        cpu_limit_s: Number(localStorage.getItem('nodus.cpuLimit') ?? 30),
        output_limit: Number(localStorage.getItem('nodus.outputLimit') ?? 2_000_000),
        cwd,
        python: localStorage.getItem('nodus.python')
      });
    } catch (e) {
      this.finish('error');
      this.append({ kind: 'err', text: `${e}\n` });
      toast(String(e), 'error');
    }
  }

  async step(): Promise<void> {
    if (!this.live) return this.start('step');
    if (this.status !== 'paused') {
      await backend.runnerCommand({ cmd: 'pause' });
      return;
    }
    await backend.runnerCommand({ cmd: 'step' });
  }

  async continue() {
    if (this.status === 'paused') await backend.runnerCommand({ cmd: 'continue' });
  }

  async pause() {
    if (this.status === 'running') await backend.runnerCommand({ cmd: 'pause' });
  }

  async stop() {
    if (!this.live) return;
    this.append({ kind: 'sys', text: '■ Остановлено\n' });
    this.finish('stopped');
    await backend.stopProgram();
  }

  async setDelay(ms: number) {
    this.delayMs = ms;
    if (this.live) await backend.runnerCommand({ cmd: 'mode', mode: this.mode === 'step' ? 'run' : this.mode, delay_ms: ms });
  }

  async setMode(mode: 'run' | 'slow') {
    this.mode = mode;
    if (this.live) await backend.runnerCommand({ cmd: 'mode', mode, delay_ms: this.delayMs });
  }

  async syncBreakpoints() {
    if (this.live) await backend.runnerCommand({ cmd: 'breakpoints', nodes: editor.breakpoints() });
  }

  async sendInput(text: string) {
    if (this.status !== 'input') return;
    this.inputPrompt = null;
    this.status = 'running';
    await backend.runnerCommand({ cmd: 'input', text });
  }

  clearOutput() {
    this.output = [];
    this.outChars = 0;
  }

  /** Clears highlight state after a run (keeps output and error). */
  clearHighlights() {
    this.trail.clear();
    this.edgeValues.clear();
    this.activeEdges = new Set();
    this.error = null;
  }

  // ---------------------------------------------------------- events

  private reset() {
    this.clearOutput();
    this.clearHighlights();
    this.activeNode = null;
    this.activeLine = null;
    this.pauseReason = null;
    this.inputPrompt = null;
    this.vars = { globals: {}, locals: {}, scope: '' };
  }

  private finish(status: RunStatus) {
    this.status = status;
    this.activeEdges = new Set();
    this.inputPrompt = null;
    if (status !== 'error') this.activeNode = null;
    if (this.clock) clearInterval(this.clock);
    this.clock = null;
    this.elapsed = performance.now() - this.startedAt;
  }

  private append(chunk: OutChunk) {
    const out = this.output.slice();
    const last = out.at(-1);
    if (last && last.kind === chunk.kind && !last.text.endsWith('\n') && chunk.kind !== 'sys') {
      out[out.length - 1] = { kind: last.kind, text: last.text + chunk.text };
    } else out.push(chunk);
    this.outChars += chunk.text.length;
    while (this.outChars > OUTPUT_CAP && out.length > 1) this.outChars -= out.shift()!.text.length;
    this.output = out;
  }

  private graphIndexFor(nodeId: string): GraphIndex | null {
    const gid = this.sourceMap?.graphOf[nodeId] ?? 'main';
    const live = gid === editor.graphId;
    const key = live ? editor.edges : gid;
    const cached = this.indexCache.get(gid);
    if (cached && cached.key === key) return cached.index;
    const graph = live ? { nodes: editor.nodes, edges: editor.edges } : editor.graphById(editor.fullDoc(), gid);
    const index = new GraphIndex(graph);
    this.indexCache.set(gid, { key, index });
    return index;
  }

  private visit(nodeId: string) {
    const prev = this.activeNode;
    if (prev === nodeId) return;
    if (prev) {
      this.trail.set(prev, ++this.seq);
      const idx = this.graphIndexFor(nodeId);
      const edges = idx ? idx.execEdgesBetween(prev, nodeId) : [];
      this.activeEdges = new Set(edges);
      if (edges.length && !ui.reducedMotion) for (const cb of this.pulseListeners) cb(edges, this.mode !== 'run');
    }
    this.activeNode = nodeId;
  }

  private handleBatch(lines: string[]) {
    let lastLine: { line: number; node_id: string } | null = null;
    for (const raw of lines) {
      let ev: TraceEvent;
      try {
        ev = JSON.parse(raw);
      } catch {
        continue;
      }
      switch (ev.type) {
        case 'start':
          break;
        case 'line':
          this.visit(ev.node_id);
          lastLine = ev;
          break;
        case 'vars':
          this.vars = { globals: ev.globals, locals: ev.locals, scope: ev.scope };
          break;
        case 'values':
          for (const [edge, value] of Object.entries(ev.values)) this.edgeValues.set(edge, { value, seq: ++this.seq });
          break;
        case 'stdout':
          this.append({ kind: 'out', text: ev.text });
          break;
        case 'stderr':
          this.append({ kind: 'err', text: ev.text });
          break;
        case 'paused':
          this.visit(ev.node_id);
          lastLine = ev;
          this.status = 'paused';
          this.pauseReason = ev.reason;
          this.revealActive();
          break;
        case 'resumed':
          if (this.status === 'paused') this.status = 'running';
          this.pauseReason = null;
          break;
        case 'input_request':
          this.status = 'input';
          this.inputPrompt = ev.prompt;
          ui.dockTab = 'output';
          ui.dockOpen = true;
          break;
        case 'error':
          this.error = { nodeId: ev.node_id, line: ev.line, msg: ev.msg, traceback: ev.traceback };
          this.activeNode = ev.node_id;
          this.activeLine = ev.line || null;
          this.append({ kind: 'err', text: (ev.traceback || ev.msg) + '\n' });
          if (ev.node_id) {
            const gid = this.sourceMap?.graphOf[ev.node_id];
            if (gid && gid !== editor.graphId) editor.switchGraph(gid);
          }
          break;
        case 'done':
          this.append({
            kind: 'sys',
            text: ev.status === 'ok' ? `✓ Завершено за ${((performance.now() - this.startedAt) / 1000).toFixed(2)} с\n` : '✗ Завершено с ошибкой\n'
          });
          this.finish(ev.status === 'ok' ? 'done' : 'error');
          break;
        case 'exit':
          if (this.live) {
            this.append({ kind: 'err', text: `Процесс завершился с кодом ${ev.code}\n` });
            this.finish('error');
          }
          break;
      }
    }
    if (lastLine) this.activeLine = lastLine.line;
  }

  /** In step mode keep the active block in view (and its graph open). */
  private revealActive() {
    const id = this.activeNode;
    if (!id) return;
    const gid = this.sourceMap?.graphOf[id];
    if (gid && gid !== editor.graphId) editor.switchGraph(gid);
  }

  dispose() {
    this.unlisten?.();
  }
}

export const run = new RunStore();
