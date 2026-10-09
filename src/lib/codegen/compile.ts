// Graph → readable Python 3 + source map.
//
// Exec wires define statement order: every event (Start, On Timer, function
// entry) becomes a Python function whose body is emitted by walking exec wires
// depth-first. Pure blocks have no statements of their own; their expression
// templates are inlined where their outputs are used. Outputs of exec blocks
// (Input.text, For.index …) become local variables.

import type { BlockData, BlockDef, Doc, FnDef, GNode, Graph, Port } from '../types';
import { isBlockNode } from '../types';
import { getBlock } from '../blocks/registry';
import { resolvePorts, type PortContext } from '../blocks/ports';
import { GraphIndex, topoSort } from '../graph/query';
import { isAtomic, pyIdent, pyLiteral, pyNumber, pyStr, PY_RESERVED, wrap } from './python';

export interface Watch {
  edge: string;
  expr: string;
}

export interface SourceMap {
  /** 1-based line → node id */
  lines: Record<number, string>;
  /** node id → lines it produced */
  nodeLines: Record<string, number[]>;
  /** exec node id → data wires whose values the debugger may evaluate when the node starts */
  watches: Record<string, Watch[]>;
  /** user (global) variables */
  vars: string[];
  /** node id → graph id ('main' or function id) */
  graphOf: Record<string, string>;
}

export interface CompileProblem {
  severity: 'error' | 'warning';
  msg: string;
  nodeId?: string;
  graphId?: string;
}

export interface CompileResult {
  code: string;
  sourceMap: SourceMap;
  problems: CompileProblem[];
}

const INDENT = '    ';
const MAX_LINES = 50_000;

interface Line {
  indent: number;
  text: string;
  node?: string;
}

interface Expr {
  code: string;
  impure: boolean;
  int: boolean;
}

class CompileError extends Error {}

class Namer {
  private used = new Set<string>(PY_RESERVED);
  reserve(name: string) {
    this.used.add(name);
  }
  take(base: string): string {
    let name = pyIdent(base);
    if (PY_RESERVED.has(name) && !this.used.has(`${name}_`)) name = `${name}_`;
    if (!this.used.has(name)) {
      this.used.add(name);
      return name;
    }
    for (let i = 2; ; i++) {
      const n = `${name}_${i}`;
      if (!this.used.has(n)) {
        this.used.add(n);
        return n;
      }
    }
  }
}

/** Per-graph compilation state. */
class GraphCompiler {
  readonly index: GraphIndex;
  readonly ports = new Map<string, { inputs: Port[]; outputs: Port[] }>();
  /** Assignments to user variables inside the Python function being emitted. */
  globalsAssigned = new Set<string>();

  constructor(
    readonly prog: ProgramCompiler,
    readonly graph: Graph,
    readonly graphId: string,
    readonly fn: FnDef | null
  ) {
    this.index = new GraphIndex(graph);
    const ctx: PortContext = { ...prog.portCtx, currentFn: fn };
    for (const n of graph.nodes) this.ports.set(n.id, resolvePorts(n, ctx));
  }

  problem(severity: 'error' | 'warning', msg: string, nodeId?: string) {
    this.prog.problems.push({ severity, msg, nodeId, graphId: this.graphId });
  }

  def(node: GNode): BlockDef | undefined {
    return isBlockNode(node) ? getBlock(node.data.block) : undefined;
  }

  port(nodeId: string, dir: 'in' | 'out', id: string): Port | undefined {
    const p = this.ports.get(nodeId);
    return (dir === 'in' ? p?.inputs : p?.outputs)?.find((x) => x.id === id);
  }

  // ------------------------------------------------------------ expressions

  /** Expression for a data input of `node`; records watches into `watches`. */
  inputExpr(node: GNode, portId: string, watches: Watch[], visiting: Set<string>): Expr {
    const port = this.port(node.id, 'in', portId);
    const src = this.index.dataSource(node.id, portId);
    if (!src) {
      const data = node.data as BlockData;
      const raw = data.inputs?.[portId] !== undefined ? data.inputs[portId] : port?.default;
      if (port?.required && raw === undefined)
        this.problem('error', `Вход «${port.label || portId}» должен быть подключён`, node.id);
      return { ...this.literalFor(port?.type ?? 'any', raw), impure: false };
    }
    const value = this.outputExpr(src.node, src.port, watches, visiting);
    if (!value.impure) for (const e of src.edges) watches.push({ edge: e.id, expr: value.code });
    return value;
  }

  literalFor(type: string, raw: unknown): { code: string; int: boolean } {
    switch (type) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw ?? 0);
        const v = Number.isNaN(n) ? 0 : n;
        return { code: pyNumber(v), int: Number.isInteger(v) };
      }
      case 'string':
        return { code: pyStr(raw === undefined || raw === null ? '' : String(raw)), int: false };
      case 'bool':
        return { code: raw === true || raw === 'true' ? 'True' : 'False', int: false };
      case 'list':
        return { code: Array.isArray(raw) ? pyLiteral(raw) : '[]', int: false };
      default:
        if (raw === undefined || raw === null || raw === '') return { code: 'None', int: false };
        return { code: pyLiteral(raw), int: typeof raw === 'number' && Number.isInteger(raw) };
    }
  }

  /** Expression that yields output `portId` of `node`. */
  outputExpr(node: GNode, portId: string, watches: Watch[], visiting: Set<string>): Expr {
    const def = this.def(node);
    const port = this.port(node.id, 'out', portId);
    if (!def || !port) {
      this.problem('error', `Неизвестный выход «${portId}»`, node.id);
      return { code: 'None', impure: false, int: false };
    }
    if (def.kind === 'pure') {
      if (visiting.has(node.id)) {
        this.problem('error', 'Цикл в потоке данных', node.id);
        throw new CompileError('data cycle');
      }
      visiting.add(node.id);
      try {
        const template = def.expr?.[portId] ?? 'None';
        const code = this.fill(template, node, def, watches, visiting).trim();
        let impure = !!def.impure;
        // purity of the whole tree: any impure operand makes the result impure
        for (const ip of this.ports.get(node.id)?.inputs ?? []) {
          const s = this.index.dataSource(node.id, ip.id);
          if (s && this.isImpure(s.node, new Set())) impure = true;
        }
        for (const imp of def.imports ?? []) this.prog.imports.add(imp);
        return { code, impure, int: !!port.int };
      } finally {
        visiting.delete(node.id);
      }
    }
    // exec / event node outputs are variables (or a declared expression)
    if (port.expr) {
      const code = this.fill(port.expr, node, def, watches, visiting);
      return { code, impure: false, int: !!port.int };
    }
    return { code: this.prog.outVar(node, port, def), impure: false, int: !!port.int };
  }

  isImpure(node: GNode, seen: Set<string>): boolean {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    const def = this.def(node);
    if (!def || def.kind !== 'pure') return false;
    if (def.impure) return true;
    for (const ip of this.ports.get(node.id)?.inputs ?? []) {
      const s = this.index.dataSource(node.id, ip.id);
      if (s && this.isImpure(s.node, seen)) return true;
    }
    return false;
  }

  /** Substitutes `{…}` tokens of a single-line template. */
  fill(template: string, node: GNode, def: BlockDef, watches: Watch[], visiting: Set<string>): string {
    const data = node.data as BlockData;
    return template.replace(/\{(in|raw|int|opt|out|name|param|text)\.([A-Za-z_]\w*)\}|\{join\}/g, (m, kind, id) => {
      if (m === '{join}') {
        const v = def.variadic;
        if (!v) return '';
        const ports = (this.ports.get(node.id)?.inputs ?? []).filter((p) => p.id.startsWith(v.prefix) && /\d+$/.test(p.id));
        return ports.map((p) => this.inputExpr(node, p.id, watches, visiting).code).join(', ');
      }
      switch (kind) {
        case 'in':
          return wrap(this.inputExpr(node, id, watches, visiting).code);
        case 'raw':
          return this.inputExpr(node, id, watches, visiting).code;
        case 'int': {
          const e = this.inputExpr(node, id, watches, visiting);
          if (e.int) return e.code;
          const n = Number(e.code);
          if (!Number.isNaN(n) && /^-?[\d.e+]+$/.test(e.code)) return String(Math.trunc(n));
          return `int(${e.code})`;
        }
        case 'opt': {
          // ", value" unless the input is unconnected and equal to its default
          const port = this.port(node.id, 'in', id);
          const connected = !!this.index.dataSource(node.id, id);
          const raw = data.inputs?.[id] ?? port?.default;
          if (!connected && raw === port?.default) return '';
          const e = this.inputExpr(node, id, watches, visiting);
          const n = Number(e.code);
          return `, ${!e.int && !Number.isNaN(n) && /^-?[\d.e+]+$/.test(e.code) ? Math.trunc(n) : e.int ? e.code : `int(${e.code})`}`;
        }
        case 'out': {
          const port = this.port(node.id, 'out', id);
          return port ? this.prog.outVar(node, port, def) : 'None';
        }
        case 'name': {
          const v = String(data.params?.[id] ?? '');
          if (!v) {
            this.problem('error', 'Не выбрана переменная', node.id);
            return '_undefined_';
          }
          const known = this.prog.varNames.get(v);
          if (!known) {
            this.problem('error', `Переменная «${v}» не объявлена`, node.id);
            return pyIdent(v);
          }
          return known;
        }
        case 'param': {
          const p = def.params.find((x) => x.id === id);
          const raw = data.params?.[id] ?? p?.default;
          return this.literalFor(p?.type === 'select' ? 'string' : (p?.type ?? 'any'), raw).code;
        }
        case 'text': {
          const p = def.params.find((x) => x.id === id);
          const raw = String(data.params?.[id] ?? p?.default ?? '');
          if (p?.options && !p.options.includes(raw)) return String(p.default ?? p.options[0]);
          return raw;
        }
      }
      return m;
    });
  }

  // ------------------------------------------------------------ statements

  /** Emits `node` and everything that follows it along exec wires. */
  emitChain(nodeId: string, indent: number, out: Line[], path: Set<string>) {
    const node = this.index.nodes.get(nodeId);
    if (!node) return;
    if (path.has(nodeId)) {
      this.problem('error', 'Цикл в exec-потоке: используйте блоки While/For', nodeId);
      throw new CompileError('exec cycle');
    }
    if (out.length > MAX_LINES) throw new CompileError('program too large');
    const def = this.def(node);
    if (!def) {
      this.problem('error', `Неизвестный блок «${(node.data as BlockData).block}»`, nodeId);
      return;
    }
    if (def.kind === 'pure') return;
    path.add(nodeId);
    this.prog.reachable.add(nodeId);
    const watches: Watch[] = [];
    const before = out.length;
    try {
      for (const imp of def.imports ?? []) this.prog.imports.add(imp);
      const tmpl = (def.code ?? '').split('\n');
      for (let raw of tmpl) {
        const cond = raw.match(/\{\?exec\.(\w+)\}/);
        if (cond) {
          if (!this.index.execTarget(nodeId, cond[1])) continue;
          raw = raw.replace(/\{\?exec\.\w+\}/g, '');
        }
        const lead = raw.match(/^ */)![0].length;
        const level = indent + Math.floor(lead / 4);
        const body = raw.trim();
        const branch = body.match(/^\{exec\.(\w+)\}$/);
        if (branch) {
          const t = this.index.execTarget(nodeId, branch[1]);
          const start = out.length;
          if (t) this.emitChain(t.node.id, level, out, path);
          if (out.length === start && lead > 0) out.push({ indent: level, text: 'pass', node: nodeId });
          continue;
        }
        if (body === '{python}') {
          this.emitPython(node, level, out, watches);
          continue;
        }
        if (body === '{call}') {
          out.push({ indent: level, text: this.callStatement(node, watches), node: nodeId });
          continue;
        }
        if (body === '{return}') {
          out.push({ indent: level, text: this.returnStatement(node, watches), node: nodeId });
          continue;
        }
        if (!body) continue;
        const text = this.fill(body, node, def, watches, new Set());
        out.push({ indent: level, text, node: nodeId });
        if (def.dynamic === 'var-set') {
          const v = this.prog.varNames.get(String((node.data as BlockData).params?.var ?? ''));
          if (v) this.globalsAssigned.add(v);
        }
      }
    } finally {
      path.delete(nodeId);
    }
    if (out.length === before) {
      // e.g. an event with nothing attached
    }
    const prev = this.prog.watches[nodeId] ?? [];
    const seen = new Set(prev.map((w) => w.edge));
    this.prog.watches[nodeId] = [...prev, ...watches.filter((w) => !seen.has(w.edge) && seen.add(w.edge))];
  }

  emitPython(node: GNode, level: number, out: Line[], watches: Watch[]) {
    const data = node.data as BlockData;
    for (const p of data.pyInputs ?? []) {
      const name = pyIdent(p.name);
      out.push({ indent: level, text: `${name} = ${this.inputExpr(node, p.name, watches, new Set()).code}`, node: node.id });
    }
    const code = String(data.params?.code ?? '');
    const lines = code.replace(/\t/g, INDENT).split('\n');
    const minLead = Math.min(...lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length), Infinity);
    let any = false;
    for (const l of lines) {
      if (!l.trim()) continue;
      any = true;
      out.push({ indent: level, text: l.slice(Number.isFinite(minLead) ? minLead : 0).trimEnd(), node: node.id });
    }
    if (!any && !(data.pyInputs ?? []).length) out.push({ indent: level, text: 'pass', node: node.id });
    for (const [user, py] of this.prog.varNames) {
      const re = new RegExp(`(^|[^\\w.])${py}\\s*([-+*/%]|//|\\*\\*)?=(?!=)`, 'm');
      if (re.test(code) && user) this.globalsAssigned.add(py);
    }
  }

  callStatement(node: GNode, watches: Watch[]): string {
    const data = node.data as BlockData;
    const fn = this.prog.portCtx.functions.find((f) => f.id === data.params?.fn);
    if (!fn) {
      this.problem('error', 'Функция не найдена', node.id);
      return 'pass';
    }
    const name = this.prog.fnNames.get(fn.id)!;
    const def = this.def(node)!;
    const args = fn.inputs.map((p) => this.inputExpr(node, p.name, watches, new Set()).code).join(', ');
    const call = `${name}(${args})`;
    const outs = (this.ports.get(node.id)?.outputs ?? []).filter((p) => p.type !== 'exec');
    if (!outs.length) return call;
    return `${outs.map((p) => this.prog.outVar(node, p, def)).join(', ')} = ${call}`;
  }

  returnStatement(node: GNode, watches: Watch[]): string {
    const outs = this.fn?.outputs ?? [];
    if (!outs.length) return 'return';
    return `return ${outs.map((p) => this.inputExpr(node, p.name, watches, new Set()).code).join(', ')}`;
  }
}

class ProgramCompiler {
  readonly problems: CompileProblem[] = [];
  readonly imports = new Set<string>();
  readonly names = new Namer();
  readonly varNames = new Map<string, string>();
  readonly fnNames = new Map<string, string>();
  readonly outVars = new Map<string, string>();
  readonly watches: Record<string, Watch[]> = {};
  readonly reachable = new Set<string>();
  readonly graphOf: Record<string, string> = {};
  readonly portCtx: PortContext;

  constructor(readonly doc: Doc) {
    this.portCtx = { variables: doc.variables, functions: doc.functions };
  }

  outVar(node: GNode, port: Port, def: BlockDef): string {
    const key = `${node.id}|${port.id}`;
    let name = this.outVars.get(key);
    if (!name) {
      if (def.dynamic === 'python') name = pyIdent(port.id);
      else name = this.names.take(port.varName ?? `${pyIdent(def.title.split(/\s+/)[0].toLowerCase())}_${port.id}`);
      this.outVars.set(key, name);
    }
    return name;
  }

  compile(): CompileResult {
    const { doc } = this;
    for (const v of doc.variables) {
      const name = this.names.take(v.name);
      this.varNames.set(v.name, name);
    }
    for (const fn of doc.functions) this.fnNames.set(fn.id, this.names.take(fn.name));

    const lines: Line[] = [];
    const sections: Line[][] = [];

    // user functions
    for (const fn of doc.functions) {
      const gc = new GraphCompiler(this, fn.graph, fn.id, fn);
      for (const n of fn.graph.nodes) this.graphOf[n.id] = fn.id;
      this.checkExecCycles(gc);
      const entry = fn.graph.nodes.find((n) => isBlockNode(n) && n.data.block === 'fn.entry');
      const params = fn.inputs.map((p) => pyIdent(p.name)).join(', ');
      const body: Line[] = [];
      if (entry) this.safeEmit(gc, entry.id, 1, body);
      else gc.problem('error', `В функции «${fn.name}» нет блока входа`);
      if (fn.outputs.length > 1 && body.at(-1)?.text.startsWith('return') !== true)
        body.push({ indent: 1, text: `return ${fn.outputs.map(() => 'None').join(', ')}` });
      const sec: Line[] = [{ indent: 0, text: `def ${this.fnNames.get(fn.id)}(${params}):` }];
      if (gc.globalsAssigned.size) sec.push({ indent: 1, text: `global ${[...gc.globalsAssigned].join(', ')}` });
      sec.push(...(body.length ? body : [{ indent: 1, text: 'pass' }]));
      sections.push(sec);
    }

    // events of the main graph
    const main = new GraphCompiler(this, doc.main, 'main', null);
    for (const n of doc.main.nodes) this.graphOf[n.id] = 'main';
    this.checkExecCycles(main);
    const events = doc.main.nodes
      .filter((n) => isBlockNode(n) && getBlock(n.data.block)?.kind === 'event' && getBlock(n.data.block)?.event)
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    const startCalls: Line[] = [];
    const timers: { interval: string; fn: string; node: string }[] = [];
    for (const ev of events) {
      const def = getBlock((ev.data as BlockData).block)!;
      const fname = this.names.take(def.event!.name);
      main.globalsAssigned = new Set();
      const body: Line[] = [];
      this.safeEmit(main, ev.id, 1, body);
      const sec: Line[] = [{ indent: 0, text: `def ${fname}():` }];
      if (main.globalsAssigned.size) sec.push({ indent: 1, text: `global ${[...main.globalsAssigned].join(', ')}` });
      sec.push(...(body.length ? body : [{ indent: 1, text: 'pass' }]));
      sections.push(sec);
      if (def.event!.timer) {
        const iv = Number((ev.data as BlockData).params?.[def.event!.timer] ?? 1);
        timers.push({ interval: pyNumber(iv > 0 ? iv : 1), fn: fname, node: ev.id });
      } else startCalls.push({ indent: 1, text: `${fname}()`, node: ev.id });
    }
    if (!events.length) this.problems.push({ severity: 'warning', msg: 'Нет блока Start — программе нечего выполнять', graphId: 'main' });

    // unreachable exec blocks
    for (const [graph, gid] of [[doc.main, 'main'], ...doc.functions.map((f) => [f.graph, f.id] as const)] as const) {
      for (const n of graph.nodes) {
        if (!isBlockNode(n)) continue;
        const def = getBlock(n.data.block);
        if (def && def.kind === 'exec' && !this.reachable.has(n.id))
          this.problems.push({ severity: 'warning', msg: 'Блок не подключён к событию и не выполнится', nodeId: n.id, graphId: gid });
      }
    }

    // ---------------------------------------------------------- assemble
    lines.push({ indent: 0, text: `# ${doc.name || 'Программа'} — сгенерировано Nodus` });
    for (const imp of [...this.imports].sort()) lines.push({ indent: 0, text: `import ${imp}` });
    if (timers.length) lines.push({ indent: 0, text: 'import time' });
    if (doc.variables.length) {
      lines.push({ indent: 0, text: '' });
      for (const v of doc.variables)
        lines.push({ indent: 0, text: `${this.varNames.get(v.name)} = ${main.literalFor(v.type, v.value).code}` });
    }
    if (timers.length) {
      lines.push({ indent: 0, text: '' }, { indent: 0, text: '' });
      for (const t of TIMER_HELPER) lines.push({ indent: 0, text: t });
    }
    for (const sec of sections) {
      lines.push({ indent: 0, text: '' }, { indent: 0, text: '' }, ...sec);
    }
    lines.push({ indent: 0, text: '' }, { indent: 0, text: '' }, { indent: 0, text: 'if __name__ == "__main__":' });
    lines.push(...startCalls);
    if (timers.length) {
      lines.push({ indent: 1, text: `run_timers([${timers.map((t) => `(${t.interval}, ${t.fn})`).join(', ')}])` });
    }
    if (!startCalls.length && !timers.length) lines.push({ indent: 1, text: 'pass' });

    const sourceMap: SourceMap = { lines: {}, nodeLines: {}, watches: this.watches, vars: [...this.varNames.values()], graphOf: this.graphOf };
    const text = elifify(lines)
      .map((l, i) => {
        if (l.node) {
          sourceMap.lines[i + 1] = l.node;
          (sourceMap.nodeLines[l.node] ??= []).push(i + 1);
        }
        return l.text ? INDENT.repeat(l.indent) + l.text : '';
      })
      .join('\n');
    for (const k of Object.keys(sourceMap.watches)) if (!sourceMap.watches[k].length) delete sourceMap.watches[k];
    return { code: text + '\n', sourceMap, problems: dedupe(this.problems) };
  }

  safeEmit(gc: GraphCompiler, nodeId: string, indent: number, out: Line[]) {
    try {
      gc.emitChain(nodeId, indent, out, new Set());
    } catch (e) {
      if (!(e instanceof CompileError)) throw e;
      if (e.message === 'program too large') gc.problem('error', 'Сгенерированная программа слишком велика');
      out.push({ indent, text: 'raise RuntimeError("граф содержит ошибки")', node: nodeId });
    }
  }

  checkExecCycles(gc: GraphCompiler) {
    const ids = gc.graph.nodes.map((n) => n.id);
    const execEdges = gc.graph.edges.filter((e) => {
      const p = gc.port(e.source, 'out', e.sourceHandle.replace(/^out:/, ''));
      return p?.type === 'exec';
    });
    const { cyclic } = topoSort(ids, execEdges);
    const onCycle = new Set(cyclic);
    // report only nodes that are really on a cycle (they reach themselves)
    for (const id of cyclic) {
      const stack = [id];
      const seen = new Set<string>();
      let found = false;
      while (stack.length && !found) {
        const cur = stack.pop()!;
        for (const e of execEdges) {
          if (e.source !== cur || !onCycle.has(e.target)) continue;
          if (e.target === id) found = true;
          else if (!seen.has(e.target)) {
            seen.add(e.target);
            stack.push(e.target);
          }
        }
      }
      if (found && gc.index.nodes.get(id)?.type === 'block')
        gc.problem('error', 'Цикл в exec-потоке: используйте блоки While/For', id);
    }
  }
}

const TIMER_HELPER = [
  'def run_timers(timers):',
  '    next_at = [time.monotonic() + interval for interval, _ in timers]',
  '    while True:',
  '        i = min(range(len(timers)), key=next_at.__getitem__)',
  '        time.sleep(max(0.0, next_at[i] - time.monotonic()))',
  '        next_at[i] += timers[i][0]',
  '        timers[i][1]()'
];

/**
 * `else:` whose whole body is one `if` statement becomes `elif`
 * (If → If chains read like hand-written code).
 */
export function elifify(lines: Line[]): Line[] {
  const out = lines.slice();
  for (let i = 0; i < out.length - 1; i++) {
    const el = out[i];
    const first = out[i + 1];
    if (el.text !== 'else:' || !first.text.startsWith('if ') || first.indent !== el.indent + 1) continue;
    let end = i + 2;
    let single = true;
    while (end < out.length && out[end].indent > el.indent) {
      const l = out[end];
      if (l.indent === el.indent + 1 && !(l.text === 'else:' || l.text.startsWith('elif '))) single = false;
      end++;
    }
    if (!single) continue;
    const body = out.slice(i + 2, end).map((l) => ({ ...l, indent: l.indent - 1 }));
    out.splice(i, end - i, { ...first, indent: el.indent, text: `el${first.text}` }, ...body);
  }
  return out;
}

function dedupe(problems: CompileProblem[]): CompileProblem[] {
  const seen = new Set<string>();
  return problems.filter((p) => {
    const k = `${p.severity}|${p.nodeId}|${p.msg}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function compile(doc: Doc): CompileResult {
  return new ProgramCompiler(doc).compile();
}

export { isAtomic };
