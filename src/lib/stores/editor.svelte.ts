// Editor state: the document, the graph currently shown on the canvas,
// selection, undo/redo, clipboard and all editing operations.
import type { Connection } from '@xyflow/svelte';
import type { BlockData, CommentData, CustomPort, DataType, Doc, FnDef, GEdge, GNode, Graph, PortType } from '../types';
import { isBlockNode, isCommentNode } from '../types';
import { getBlock, registerUserBlocks } from '../blocks/registry';
import { findPort, resolvePorts, type PortContext } from '../blocks/ports';
import { typesCompatible } from '../graph/compat';
import { uid } from '../graph/ids';
import { History } from '../graph/history';
import { cleanGraph, newDoc, parseDoc, serializeDoc } from '../graph/serialize';
import { copySelection, parseClipboard, preparePaste, type ClipPayload } from '../graph/clipboard';
import { align, distribute, type AlignMode } from '../graph/align';
import { collapseToFunction, newFunction, uniqueName, CollapseError } from '../graph/functions';
import { validate, type Validation } from '../graph/validate';
import { pyIdent } from '../codegen/python';
import * as backend from '../runtime/backend';
import { toast } from './ui.svelte';

interface Snapshot {
  doc: Doc;
  graphId: string;
}

export interface FlowApi {
  fitView: (opts?: { nodes?: { id: string }[]; duration?: number; padding?: number; maxZoom?: number }) => Promise<boolean>;
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
  getViewport: () => { x: number; y: number; zoom: number };
  setViewport: (v: { x: number; y: number; zoom: number }, o?: { duration?: number }) => Promise<boolean>;
}

const RECENT_KEY = 'nodus.recent';
const GRID = 16;

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

class EditorStore {
  doc = $state<Doc>(newDoc());
  graphId = $state('main');
  nodes = $state.raw<GNode[]>([]);
  edges = $state.raw<GEdge[]>([]);
  filePath = $state<string | null>(null);
  dirty = $state(false);
  snapToGrid = $state(true);
  recent = $state<string[]>(loadRecent());
  blocksVersion = $state(0);
  userBlocksDir = $state('');
  validation = $state.raw<Validation | null>(null);
  canUndo = $state(false);
  canRedo = $state(false);

  flow: FlowApi | null = null;
  private history = new History<Snapshot>({ doc: newDoc(), graphId: 'main' });
  private memClipboard: ClipPayload | null = null;
  private validateTimer: ReturnType<typeof setTimeout> | null = null;
  private commitTimer: ReturnType<typeof setTimeout> | null = null;

  currentFn = $derived(this.graphId === 'main' ? null : (this.doc.functions.find((f) => f.id === this.graphId) ?? null));
  portCtx = $derived<PortContext>({ variables: this.doc.variables, functions: this.doc.functions, currentFn: this.currentFn });
  selectedNodes = $derived(this.nodes.filter((n) => n.selected));
  /** node id → set of connected handle ids (for port fill / snap animation) */
  connected = $derived.by(() => {
    const m = new Map<string, Set<string>>();
    const add = (n: string, h: string) => (m.get(n) ?? m.set(n, new Set()).get(n)!).add(h);
    for (const e of this.edges) {
      add(e.source, e.sourceHandle);
      add(e.target, e.targetHandle);
    }
    return m;
  });
  title = $derived(`${this.dirty ? '● ' : ''}${this.doc.name} — Nodus`);

  constructor() {
    this.loadDoc(newDoc(), null);
  }

  // ------------------------------------------------------------- document

  /** Whole document with the canvas graph written back. */
  fullDoc(): Doc {
    const doc = $state.snapshot(this.doc) as Doc;
    const g: Graph = { nodes: this.nodes, edges: this.edges };
    if (this.graphId === 'main') doc.main = g;
    else {
      const fn = doc.functions.find((f) => f.id === this.graphId);
      if (fn) fn.graph = g;
    }
    return doc;
  }

  private cleanDoc(): Doc {
    const d = this.fullDoc();
    d.main = cleanGraph(d.main);
    for (const f of d.functions) f.graph = cleanGraph(f.graph);
    return d;
  }

  graphById(doc: Doc, id: string): Graph {
    if (id === 'main') return doc.main;
    return doc.functions.find((f) => f.id === id)?.graph ?? doc.main;
  }

  private show(doc: Doc, graphId: string) {
    const g = this.graphById(doc, graphId);
    this.doc = doc;
    this.graphId = doc.functions.some((f) => f.id === graphId) ? graphId : 'main';
    this.nodes = g.nodes.map((n) => this.prepNode(n));
    this.edges = g.edges.map((e) => ({ ...e, type: 'wire' }));
  }

  private prepNode(n: GNode): GNode {
    const out = { ...n } as GNode & { zIndex?: number; dragHandle?: string };
    if (n.type === 'comment') {
      out.zIndex = -1;
      out.width ??= 360;
      out.height ??= 220;
    }
    return out;
  }

  loadDoc(doc: Doc, path: string | null) {
    this.show(doc, 'main');
    this.filePath = path;
    this.dirty = false;
    this.history.reset({ doc: this.cleanDoc(), graphId: 'main' });
    this.syncUndo();
    this.scheduleValidate(0);
    if (path) this.pushRecent(path);
    setTimeout(() => this.flow?.fitView({ padding: 0.2, duration: 0, maxZoom: 1.2 }), 30);
  }

  switchGraph(id: string) {
    if (id === this.graphId) return;
    const doc = this.fullDoc();
    this.show(doc, id);
    this.scheduleValidate(0);
    setTimeout(() => this.flow?.fitView({ padding: 0.25, duration: 250, maxZoom: 1.2 }), 30);
  }

  // ------------------------------------------------------------- history

  /** Records the current state as an undo step. */
  commit() {
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    if (this.history.commit({ doc: this.cleanDoc(), graphId: this.graphId })) {
      this.dirty = true;
    }
    this.syncUndo();
    this.scheduleValidate();
  }

  /** Debounced commit for typing in fields. */
  commitSoon(ms = 400) {
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => this.commit(), ms);
    this.scheduleValidate();
  }

  private syncUndo() {
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
  }

  undo() {
    if (this.commitTimer) this.commit();
    const s = this.history.undo();
    if (s) this.restore(s);
  }

  redo() {
    const s = this.history.redo();
    if (s) this.restore(s);
  }

  private restore(s: Snapshot) {
    this.show(s.doc, s.graphId);
    this.dirty = true;
    this.syncUndo();
    this.scheduleValidate(0);
  }

  scheduleValidate(ms = 150) {
    if (this.validateTimer) clearTimeout(this.validateTimer);
    this.validateTimer = setTimeout(() => {
      this.validateTimer = null;
      try {
        this.validation = validate(this.fullDoc());
      } catch (e) {
        console.error('validation failed', e);
      }
    }, ms);
  }

  // ------------------------------------------------------------- ports

  portOf(nodeId: string, handle: string) {
    const n = this.nodes.find((x) => x.id === nodeId);
    return n ? findPort(n, handle, this.portCtx) : undefined;
  }

  portType(nodeId: string, handle: string): PortType | undefined {
    return this.portOf(nodeId, handle)?.type;
  }

  isValidConnection = (c: Connection | GEdge): boolean => {
    if (!c.source || !c.target || c.source === c.target) return false;
    const sh = c.sourceHandle ?? '';
    const th = c.targetHandle ?? '';
    if (!sh.startsWith('out:') || !th.startsWith('in:')) return false;
    const a = this.portType(c.source, sh);
    const b = this.portType(c.target, th);
    return !!a && !!b && typesCompatible(a, b);
  };

  /** Applies wiring rules and adds the edge; returns false so Svelte Flow doesn't add its own. */
  connect = (c: Connection): false => {
    if (!this.isValidConnection(c)) return false;
    const sh = c.sourceHandle!;
    const th = c.targetHandle!;
    const srcType = this.portType(c.source, sh);
    let edges = this.edges.filter((e) => {
      // a data input takes only one wire
      if (srcType !== 'exec' && e.target === c.target && e.targetHandle === th) return false;
      // an exec output drives only one block
      if (srcType === 'exec' && e.source === c.source && e.sourceHandle === sh) return false;
      return true;
    });
    edges = [...edges, { id: uid('e'), source: c.source, sourceHandle: sh, target: c.target, targetHandle: th, type: 'wire' }];
    this.edges = edges;
    this.commit();
    return false;
  };

  // ------------------------------------------------------------- nodes

  snap(p: { x: number; y: number }) {
    if (!this.snapToGrid) return p;
    return { x: Math.round(p.x / GRID) * GRID, y: Math.round(p.y / GRID) * GRID };
  }

  makeBlockNode(blockId: string, pos: { x: number; y: number }, data: Partial<BlockData> = {}): GNode<BlockData> {
    const def = getBlock(blockId);
    const params: Record<string, unknown> = {};
    for (const p of def?.params ?? []) if (p.default !== undefined) params[p.id] = p.default;
    if (def?.dynamic === 'var-get' || def?.dynamic === 'var-set') params.var = this.doc.variables[0]?.name ?? '';
    const node: GNode<BlockData> = {
      id: uid('n'),
      type: 'block',
      position: this.snap(pos),
      data: { block: blockId, params, inputs: {}, ...data }
    };
    if (def?.dynamic === 'python' && !data.pyInputs) {
      node.data.pyInputs = [{ name: 'a', type: 'number' }];
      node.data.pyOutputs = [{ name: 'result', type: 'number' }];
    }
    return node;
  }

  addBlock(blockId: string, pos: { x: number; y: number }, data: Partial<BlockData> = {}): GNode<BlockData> {
    const node = this.makeBlockNode(blockId, pos, data);
    this.nodes = [...this.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...node, selected: true }];
    this.commit();
    return node;
  }

  /** Adds a block and wires it to the port a connection was dragged from. */
  addBlockConnected(
    blockId: string,
    pos: { x: number; y: number },
    from: { nodeId: string; handleId: string; type: 'source' | 'target' },
    data: Partial<BlockData> = {}
  ) {
    const node = this.makeBlockNode(blockId, pos, data);
    this.nodes = [...this.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), { ...node, selected: true }];
    const fromType = this.portType(from.nodeId, from.handleId);
    const ports = resolvePorts(node, this.portCtx);
    if (fromType) {
      if (from.type === 'source') {
        const p = ports.inputs.find((p) => typesCompatible(fromType, p.type));
        if (p) this.connect({ source: from.nodeId, sourceHandle: from.handleId, target: node.id, targetHandle: `in:${p.id}` });
      } else {
        const p = ports.outputs.find((p) => typesCompatible(p.type, fromType));
        if (p) this.connect({ source: node.id, sourceHandle: `out:${p.id}`, target: from.nodeId, targetHandle: from.handleId });
      }
    }
    this.commit();
    return node;
  }

  updateNodeData(id: string, patch: Partial<BlockData> | Partial<CommentData>, immediate = false) {
    this.nodes = this.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
    if (immediate) this.commit();
    else this.commitSoon();
  }

  setInput(id: string, port: string, value: unknown) {
    const n = this.nodes.find((x) => x.id === id);
    if (!n || !isBlockNode(n)) return;
    this.updateNodeData(id, { inputs: { ...n.data.inputs, [port]: value } });
  }

  setParam(id: string, param: string, value: unknown, immediate = false) {
    const n = this.nodes.find((x) => x.id === id);
    if (!n || !isBlockNode(n)) return;
    this.updateNodeData(id, { params: { ...n.data.params, [param]: value } }, immediate);
    this.pruneInvalidEdges();
  }

  /** Removes wires whose ports disappeared or changed to an incompatible type. */
  pruneInvalidEdges() {
    const keep = this.edges.filter((e) => this.isValidConnection(e));
    if (keep.length !== this.edges.length) this.edges = keep;
  }

  deleteSelection() {
    const ids = new Set(this.nodes.filter((n) => n.selected && !(isBlockNode(n) && n.data.block === 'fn.entry')).map((n) => n.id));
    const edgeSel = new Set(this.edges.filter((e) => e.selected).map((e) => e.id));
    if (!ids.size && !edgeSel.size) return;
    this.nodes = this.nodes.filter((n) => !ids.has(n.id));
    this.edges = this.edges.filter((e) => !edgeSel.has(e.id) && !ids.has(e.source) && !ids.has(e.target));
    this.commit();
  }

  selectAll() {
    this.nodes = this.nodes.map((n) => ({ ...n, selected: true }));
  }

  selectOnly(id: string) {
    this.nodes = this.nodes.map((n) => (n.selected !== (n.id === id) ? { ...n, selected: n.id === id } : n));
  }

  focusNode(id: string, graphId?: string) {
    if (graphId && graphId !== this.graphId) this.switchGraph(graphId);
    setTimeout(() => {
      this.selectOnly(id);
      this.flow?.fitView({ nodes: [{ id }], duration: 250, maxZoom: 1.1, padding: 0.6 });
    }, graphId && graphId !== this.graphId ? 60 : 0);
  }

  toggleBreakpoint(id?: string) {
    const targets = id ? [id] : this.selectedNodes.filter(isBlockNode).map((n) => n.id);
    if (!targets.length) return;
    this.nodes = this.nodes.map((n) =>
      targets.includes(n.id) && isBlockNode(n) && getBlock(n.data.block)?.kind !== 'pure'
        ? { ...n, data: { ...n.data, breakpoint: !n.data.breakpoint } }
        : n
    );
    this.commit();
  }

  breakpoints(): string[] {
    const doc = this.fullDoc();
    const out: string[] = [];
    for (const g of [doc.main, ...doc.functions.map((f) => f.graph)])
      for (const n of g.nodes) if (isBlockNode(n) && n.data.breakpoint) out.push(n.id);
    return out;
  }

  // ------------------------------------------------------------- clipboard

  async copy(cut = false) {
    const p = copySelection(this.nodes, this.edges, this.fullDoc());
    if (!p) return;
    this.memClipboard = p;
    try {
      await navigator.clipboard.writeText(JSON.stringify(p));
    } catch {
      /* clipboard API unavailable; memory clipboard still works */
    }
    if (cut) this.deleteSelection();
  }

  async paste(at?: { x: number; y: number }) {
    let p: ClipPayload | null = null;
    try {
      p = parseClipboard(await navigator.clipboard.readText());
    } catch {
      /* fall back to memory */
    }
    p ??= this.memClipboard;
    if (!p) return;
    this.insertPayload(p, at);
  }

  duplicate() {
    const p = copySelection(this.nodes, this.edges, this.fullDoc());
    if (!p) return;
    const minX = Math.min(...p.nodes.map((n) => n.position.x));
    const minY = Math.min(...p.nodes.map((n) => n.position.y));
    this.insertPayload(p, { x: minX + 32, y: minY + 32 });
  }

  private insertPayload(p: ClipPayload, at?: { x: number; y: number }) {
    const pos = at ?? this.viewCenter();
    const r = preparePaste(p, this.fullDoc(), this.snap(pos));
    if (r.variables.length) this.doc.variables = [...this.doc.variables, ...r.variables];
    if (r.functions.length) this.doc.functions = [...this.doc.functions, ...r.functions];
    this.nodes = [...this.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), ...r.nodes.map((n) => this.prepNode(n))];
    this.edges = [...this.edges, ...r.edges.map((e) => ({ ...e, type: 'wire' }))];
    this.commit();
  }

  viewCenter(): { x: number; y: number } {
    const el = document.querySelector('.svelte-flow');
    if (!el || !this.flow) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return this.flow.screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }

  // ------------------------------------------------------------- layout

  alignSelection(mode: AlignMode) {
    this.applyPositions(align(this.selectedNodes.filter((n) => !isCommentNode(n)), mode));
  }

  distributeSelection(axis: 'x' | 'y') {
    this.applyPositions(distribute(this.selectedNodes.filter((n) => !isCommentNode(n)), axis));
  }

  private applyPositions(pos: Map<string, { x: number; y: number }>) {
    if (!pos.size) return;
    this.nodes = this.nodes.map((n) => (pos.has(n.id) ? { ...n, position: pos.get(n.id)! } : n));
    this.commit();
  }

  insertReroute(edgeId: string, at: { x: number; y: number }) {
    const e = this.edges.find((x) => x.id === edgeId);
    if (!e) return;
    const t = this.portType(e.source, e.sourceHandle) ?? 'any';
    const id = uid('r');
    const node: GNode = { id, type: 'reroute', position: { x: at.x - 8, y: at.y - 8 }, data: { portType: t } };
    this.nodes = [...this.nodes, node];
    this.edges = [
      ...this.edges.filter((x) => x.id !== edgeId),
      { id: uid('e'), source: e.source, sourceHandle: e.sourceHandle, target: id, targetHandle: 'in:in', type: 'wire' },
      { id: uid('e'), source: id, sourceHandle: 'out:out', target: e.target, targetHandle: e.targetHandle, type: 'wire' }
    ];
    this.commit();
  }

  addComment() {
    const sel = this.selectedNodes.filter((n) => !isCommentNode(n));
    let x: number, y: number, w: number, h: number;
    if (sel.length) {
      const W = (n: GNode) => n.measured?.width ?? 200;
      const H = (n: GNode) => n.measured?.height ?? 80;
      x = Math.min(...sel.map((n) => n.position.x)) - 32;
      y = Math.min(...sel.map((n) => n.position.y)) - 64;
      w = Math.max(...sel.map((n) => n.position.x + W(n))) - x + 32;
      h = Math.max(...sel.map((n) => n.position.y + H(n))) - y + 32;
    } else {
      const c = this.viewCenter();
      [x, y, w, h] = [c.x - 180, c.y - 110, 360, 220];
    }
    const node: GNode = this.prepNode({
      id: uid('c'),
      type: 'comment',
      position: { x, y },
      width: w,
      height: h,
      data: { title: 'Комментарий', color: '#6e56cf' }
    });
    this.nodes = [node, ...this.nodes];
    this.commit();
  }

  // ------------------------------------------------------------- variables

  addVariable(type: DataType = 'number') {
    const name = uniqueName('var', this.doc.variables.map((v) => v.name));
    this.doc.variables = [...this.doc.variables, { name, type, value: defaultValue(type) }];
    this.commit();
    return name;
  }

  renameVariable(oldName: string, raw: string) {
    const name = pyIdent(raw, 'var');
    if (name === oldName) return;
    if (this.doc.variables.some((v) => v.name === name)) {
      toast(`Переменная «${name}» уже существует`, 'error');
      return;
    }
    this.doc.variables = this.doc.variables.map((v) => (v.name === oldName ? { ...v, name } : v));
    const fix = (nodes: GNode[]) =>
      nodes.map((n) => (isBlockNode(n) && n.data.params?.var === oldName ? { ...n, data: { ...n.data, params: { ...n.data.params, var: name } } } : n));
    this.nodes = fix(this.nodes);
    for (const f of this.doc.functions) if (f.id !== this.graphId) f.graph.nodes = fix(f.graph.nodes);
    if (this.graphId !== 'main') this.doc.main.nodes = fix(this.doc.main.nodes);
    this.commit();
  }

  setVariable(name: string, patch: { type?: DataType; value?: unknown }) {
    this.doc.variables = this.doc.variables.map((v) =>
      v.name === name ? { ...v, ...patch, value: patch.type && patch.type !== v.type ? defaultValue(patch.type) : (patch.value ?? v.value) } : v
    );
    this.pruneInvalidEdges();
    this.commitSoon();
  }

  deleteVariable(name: string) {
    this.doc.variables = this.doc.variables.filter((v) => v.name !== name);
    this.commit();
  }

  // ------------------------------------------------------------- functions

  createFunction() {
    const fn = newFunction('function', this.doc.functions);
    this.doc.functions = [...this.doc.functions, fn];
    this.commit();
    this.switchGraph(fn.id);
    return fn;
  }

  collapseSelection() {
    try {
      const doc = this.fullDoc();
      const graph = { nodes: this.nodes, edges: this.edges };
      const r = collapseToFunction(graph, this.selectedNodes.map((n) => n.id), doc, this.portCtx);
      this.doc.functions = [...this.doc.functions, r.fn];
      this.nodes = r.graph.nodes.map((n) => this.prepNode(n));
      this.edges = r.graph.edges.map((e) => ({ ...e, type: 'wire' }));
      this.commit();
      toast(`Создана функция «${r.fn.name}». Двойной клик по блоку — открыть.`, 'success');
    } catch (e) {
      if (e instanceof CollapseError) toast(e.message, 'error');
      else throw e;
    }
  }

  renameFunction(id: string, raw: string) {
    const name = pyIdent(raw, 'function');
    if (this.doc.functions.some((f) => f.id !== id && f.name === name)) {
      toast(`Функция «${name}» уже существует`, 'error');
      return;
    }
    this.doc.functions = this.doc.functions.map((f) => (f.id === id ? { ...f, name } : f));
    this.commit();
  }

  deleteFunction(id: string) {
    if (this.graphId === id) this.switchGraph('main');
    this.doc.functions = this.doc.functions.filter((f) => f.id !== id);
    const drop = (g: Graph) => {
      const gone = new Set(g.nodes.filter((n) => isBlockNode(n) && n.data.block === 'fn.call' && n.data.params?.fn === id).map((n) => n.id));
      return { nodes: g.nodes.filter((n) => !gone.has(n.id)), edges: g.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)) };
    };
    const cur = drop({ nodes: this.nodes, edges: this.edges });
    this.nodes = cur.nodes;
    this.edges = cur.edges;
    for (const f of this.doc.functions) if (f.id !== this.graphId) f.graph = drop(f.graph);
    if (this.graphId !== 'main') this.doc.main = drop(this.doc.main);
    this.commit();
  }

  /** Adds / renames / retypes / removes a function port and fixes every wire that used it. */
  editFnPort(fnId: string, dir: 'inputs' | 'outputs', index: number, change: { name?: string; type?: DataType } | 'delete' | 'add') {
    const doc = this.fullDoc();
    const fn = doc.functions.find((f) => f.id === fnId);
    if (!fn) return;
    const list = fn[dir];
    const taken = [...fn.inputs, ...fn.outputs].map((p) => p.name);
    let oldName: string | null = null;
    let newName: string | null = null;
    if (change === 'add') {
      list.push({ name: uniqueName(dir === 'inputs' ? 'x' : 'result', taken), type: 'number' });
    } else if (change === 'delete') {
      oldName = list[index]?.name ?? null;
      list.splice(index, 1);
    } else {
      const p = list[index];
      if (!p) return;
      if (change.name !== undefined) {
        const n = pyIdent(change.name, 'value');
        if (n !== p.name) {
          if (taken.includes(n)) {
            toast(`Порт «${n}» уже есть`, 'error');
            return;
          }
          oldName = p.name;
          newName = n;
          p.name = n;
        }
      }
      if (change.type) p.type = change.type;
    }
    // inside the function: entry outputs = inputs, return inputs = outputs
    const innerBlock = dir === 'inputs' ? 'fn.entry' : 'fn.return';
    const innerSide = dir === 'inputs' ? 'source' : 'target';
    const innerPrefix = dir === 'inputs' ? 'out:' : 'in:';
    fixHandles(fn.graph, (n) => isBlockNode(n) && n.data.block === innerBlock, innerSide, innerPrefix, oldName, newName);
    // at every call site
    const callSide = dir === 'inputs' ? 'target' : 'source';
    const callPrefix = dir === 'inputs' ? 'in:' : 'out:';
    const isCall = (n: GNode) => isBlockNode(n) && n.data.block === 'fn.call' && n.data.params?.fn === fnId;
    for (const g of [doc.main, ...doc.functions.map((f) => f.graph)]) fixHandles(g, isCall, callSide, callPrefix, oldName, newName);
    this.show(doc, this.graphId);
    this.pruneInvalidEdges();
    this.commit();
  }

  // ------------------------------------------------------------- files

  pushRecent(path: string) {
    this.recent = [path, ...this.recent.filter((p) => p !== path)].slice(0, 10);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
    } catch {
      /* ignore */
    }
  }

  serialize(): string {
    return serializeDoc({ ...this.fullDoc(), viewport: this.flow?.getViewport() });
  }

  async confirmDiscard(): Promise<boolean> {
    if (!this.dirty) return true;
    return backend.confirmDialog('Есть несохранённые изменения. Продолжить без сохранения?');
  }

  async newFile() {
    if (!(await this.confirmDiscard())) return;
    this.loadDoc(newDoc(), null);
    await backend.autosaveClear();
  }

  async open(path?: string) {
    if (!(await this.confirmDiscard())) return;
    const p = path ?? (await backend.openBlkDialog());
    if (!p) return;
    try {
      const doc = parseDoc(await backend.readTextFile(p));
      this.loadDoc(doc, p);
      await backend.autosaveClear();
    } catch (e) {
      toast(`Не удалось открыть файл: ${(e as Error).message ?? e}`, 'error');
      this.recent = this.recent.filter((r) => r !== p);
    }
  }

  openText(text: string, name?: string) {
    try {
      const doc = parseDoc(text);
      if (name) doc.name = name;
      this.loadDoc(doc, null);
    } catch (e) {
      toast(`Ошибка: ${(e as Error).message}`, 'error');
    }
  }

  async save(as = false): Promise<boolean> {
    let path = this.filePath;
    if (!path || as) {
      if (!backend.inTauri) {
        const blob = new Blob([this.serialize()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${pyIdent(this.doc.name, 'graph')}.blk`;
        a.click();
        this.dirty = false;
        return true;
      }
      path = await backend.saveBlkDialog(`${this.doc.name}.blk`);
      if (!path) return false;
    }
    try {
      if (!this.filePath || as) {
        const base = path.split('/').pop()!.replace(/\.blk$/, '');
        if (this.doc.name === 'Без названия' || as) this.doc.name = base;
      }
      await backend.writeTextFile(path, this.serialize());
      this.filePath = path;
      this.dirty = false;
      this.pushRecent(path);
      await backend.autosaveClear();
      toast('Сохранено', 'success');
      return true;
    } catch (e) {
      toast(`Не удалось сохранить: ${e}`, 'error');
      return false;
    }
  }

  async autosave() {
    if (!this.dirty) return;
    const payload = JSON.parse(this.serialize());
    payload._autosave = { path: this.filePath, at: new Date().toISOString() };
    await backend.autosaveWrite(JSON.stringify(payload));
  }

  restoreAutosave(text: string) {
    const raw = JSON.parse(text);
    const path = raw._autosave?.path ?? null;
    delete raw._autosave;
    this.loadDoc(parseDoc(JSON.stringify(raw)), path);
    this.dirty = true;
  }

  async loadUserBlocks() {
    try {
      const { dir, files } = await backend.listUserBlocks();
      this.userBlocksDir = dir;
      const errs = registerUserBlocks(files, dir);
      for (const e of errs) toast(`Пользовательский блок: ${e}`, 'error');
      this.blocksVersion++;
      this.scheduleValidate(0);
    } catch (e) {
      console.error(e);
    }
  }
}

function fixHandles(g: Graph, match: (n: GNode) => boolean, side: 'source' | 'target', prefix: string, oldName: string | null, newName: string | null) {
  if (!oldName) return;
  const ids = new Set(g.nodes.filter(match).map((n) => n.id));
  const key = side === 'source' ? 'sourceHandle' : 'targetHandle';
  g.edges = g.edges
    .map((e) => (ids.has(e[side]) && e[key] === `${prefix}${oldName}` && newName ? { ...e, [key]: `${prefix}${newName}` } : e))
    .filter((e) => !(ids.has(e[side]) && e[key] === `${prefix}${oldName}`));
  for (const n of g.nodes) {
    if (!ids.has(n.id) || !isBlockNode(n)) continue;
    const inputs = n.data.inputs ?? {};
    if (oldName in inputs) {
      if (newName) inputs[newName] = inputs[oldName];
      delete inputs[oldName];
    }
  }
}

export function defaultValue(t: DataType): unknown {
  return t === 'number' ? 0 : t === 'string' ? '' : t === 'bool' ? false : t === 'list' ? [] : null;
}

export type { CustomPort, FnDef };
export const editor = new EditorStore();
