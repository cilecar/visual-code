// "Collapse to function": moves the selected blocks into a new function graph
// and replaces them by a call block whose ports mirror the wires that crossed
// the selection boundary.
import type { BlockData, DataType, Doc, FnDef, FnPort, GEdge, GNode, Graph, PortType } from '../types';
import { isBlockNode } from '../types';
import { getBlock } from '../blocks/registry';
import { findPort, type PortContext } from '../blocks/ports';
import { pyIdent } from '../codegen/python';
import { uid } from './ids';

export class CollapseError extends Error {}

export interface CollapseResult {
  graph: Graph;
  fn: FnDef;
  callId: string;
}

const W = (n: GNode) => n.measured?.width ?? n.width ?? 220;

export function newFunction(name: string, existing: FnDef[]): FnDef {
  return {
    id: uid('f'),
    name: uniqueName(name, existing.map((f) => f.name)),
    inputs: [],
    outputs: [],
    graph: {
      nodes: [
        { id: uid('n'), type: 'block', position: { x: 0, y: 0 }, data: { block: 'fn.entry', params: {}, inputs: {} } },
        { id: uid('n'), type: 'block', position: { x: 520, y: 0 }, data: { block: 'fn.return', params: {}, inputs: {} } }
      ],
      edges: []
    }
  };
}

export function uniqueName(base: string, taken: string[]): string {
  if (!taken.includes(base)) return base;
  for (let i = 2; ; i++) if (!taken.includes(`${base}_${i}`)) return `${base}_${i}`;
}

export function collapseToFunction(graph: Graph, selectedIds: string[], doc: Doc, ctx: PortContext, name = 'function'): CollapseResult {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const sel = new Set(
    selectedIds.filter((id) => {
      const n = byId.get(id);
      if (!n || n.type === 'comment') return false;
      if (isBlockNode(n)) {
        const def = getBlock(n.data.block);
        if (def?.kind === 'event' || def?.dynamic === 'fn-entry' || def?.dynamic === 'fn-return') return false;
      }
      return true;
    })
  );
  if (!sel.size) throw new CollapseError('Выделите блоки (кроме событий), чтобы свернуть их в функцию');

  const portType = (nodeId: string, handle: string): PortType => findPort(byId.get(nodeId)!, handle, ctx)?.type ?? 'any';
  const portLabel = (nodeId: string, handle: string) => {
    const p = findPort(byId.get(nodeId)!, handle, ctx);
    return p?.varName ?? (p?.label || p?.id || 'value');
  };

  const inner = graph.edges.filter((e) => sel.has(e.source) && sel.has(e.target));
  const incoming = graph.edges.filter((e) => !sel.has(e.source) && sel.has(e.target));
  const outgoing = graph.edges.filter((e) => sel.has(e.source) && !sel.has(e.target));

  const execIn = incoming.filter((e) => portType(e.target, e.targetHandle) === 'exec');
  const execOut = outgoing.filter((e) => portType(e.source, e.sourceHandle) === 'exec');
  const dataIn = incoming.filter((e) => portType(e.target, e.targetHandle) !== 'exec');
  const dataOut = outgoing.filter((e) => portType(e.source, e.sourceHandle) !== 'exec');

  const entryTargets = new Set(execIn.map((e) => `${e.target}|${e.targetHandle}`));
  if (entryTargets.size > 1) throw new CollapseError('У выделения должен быть только один exec-вход');
  const exitSources = new Set(execOut.map((e) => `${e.source}|${e.sourceHandle}`));
  if (exitSources.size > 1) throw new CollapseError('У выделения должен быть только один exec-выход');

  const selNodes = graph.nodes.filter((n) => sel.has(n.id));
  const hasExec = selNodes.some((n) => isBlockNode(n) && getBlock(n.data.block)?.kind === 'exec');
  if (hasExec && !entryTargets.size) throw new CollapseError('Подключите exec-вход к выделенным блокам');

  // where the function returns: the single exec wire leaving the selection,
  // otherwise the single dangling exec output inside it
  let exit: { node: string; handle: string } | null = null;
  if (exitSources.size) {
    const [n, h] = [...exitSources][0].split('|');
    exit = { node: n, handle: h };
  } else if (hasExec) {
    const dangling: { node: string; handle: string }[] = [];
    for (const n of selNodes) {
      if (!isBlockNode(n)) continue;
      const def = getBlock(n.data.block);
      if (def?.kind !== 'exec') continue;
      for (const p of def.outputs.filter((p) => p.type === 'exec' && p.id === 'then')) {
        const h = `out:${p.id}`;
        if (!graph.edges.some((e) => e.source === n.id && e.sourceHandle === h)) dangling.push({ node: n.id, handle: h });
      }
    }
    if (dangling.length === 1) exit = dangling[0];
  }

  // function ports
  const usedNames: string[] = [];
  const portName = (base: string) => {
    const n = uniqueName(pyIdent(base), usedNames);
    usedNames.push(n);
    return n;
  };
  const inputs: FnPort[] = [];
  const inputBySource = new Map<string, string>();
  for (const e of dataIn) {
    const key = `${e.source}|${e.sourceHandle}`;
    if (inputBySource.has(key)) continue;
    const t = portType(e.source, e.sourceHandle);
    const name = portName(portLabel(e.target, e.targetHandle));
    inputBySource.set(key, name);
    inputs.push({ name, type: (t === 'exec' ? 'any' : t) as DataType });
  }
  const outputs: FnPort[] = [];
  const outputBySource = new Map<string, string>();
  for (const e of dataOut) {
    const key = `${e.source}|${e.sourceHandle}`;
    if (outputBySource.has(key)) continue;
    const t = portType(e.source, e.sourceHandle);
    const name = portName(portLabel(e.source, e.sourceHandle));
    outputBySource.set(key, name);
    outputs.push({ name, type: (t === 'exec' ? 'any' : t) as DataType });
  }

  // layout of the new graph
  const minX = Math.min(...selNodes.map((n) => n.position.x));
  const maxX = Math.max(...selNodes.map((n) => n.position.x + W(n)));
  const minY = Math.min(...selNodes.map((n) => n.position.y));
  const avgY = selNodes.reduce((s, n) => s + n.position.y, 0) / selNodes.length;
  const entryId = uid('n');
  const returnId = uid('n');
  const fnNodes: GNode[] = [
    { id: entryId, type: 'block', position: { x: minX - 300, y: minY }, data: { block: 'fn.entry', params: {}, inputs: {} } },
    ...selNodes.map((n) => ({ ...structuredClone({ ...n, selected: undefined, measured: undefined }), selected: false })),
    { id: returnId, type: 'block', position: { x: maxX + 80, y: minY }, data: { block: 'fn.return', params: {}, inputs: {} } }
  ];
  const fnEdges: GEdge[] = inner.map((e) => ({ ...e, selected: false }));
  if (entryTargets.size) {
    const [t, h] = [...entryTargets][0].split('|');
    fnEdges.push({ id: uid('e'), source: entryId, sourceHandle: 'out:then', target: t, targetHandle: h });
  }
  if (exit) fnEdges.push({ id: uid('e'), source: exit.node, sourceHandle: exit.handle, target: returnId, targetHandle: 'in:exec' });
  else if (!hasExec) fnEdges.push({ id: uid('e'), source: entryId, sourceHandle: 'out:then', target: returnId, targetHandle: 'in:exec' });
  for (const e of dataIn) {
    const name = inputBySource.get(`${e.source}|${e.sourceHandle}`)!;
    fnEdges.push({ id: uid('e'), source: entryId, sourceHandle: `out:${name}`, target: e.target, targetHandle: e.targetHandle });
  }
  for (const [key, name] of outputBySource) {
    const [s, h] = key.split('|');
    fnEdges.push({ id: uid('e'), source: s, sourceHandle: h, target: returnId, targetHandle: `in:${name}` });
  }

  const fn: FnDef = {
    id: uid('f'),
    name: uniqueName(pyIdent(name, 'function'), doc.functions.map((f) => f.name)),
    inputs,
    outputs,
    graph: { nodes: fnNodes, edges: fnEdges }
  };

  // replace the selection by a call
  const callId = uid('n');
  const call: GNode<BlockData> = {
    id: callId,
    type: 'block',
    position: { x: minX, y: avgY },
    selected: true,
    data: { block: 'fn.call', params: { fn: fn.id }, inputs: {} }
  };
  const keptEdges = graph.edges.filter((e) => !sel.has(e.source) && !sel.has(e.target));
  const newEdges: GEdge[] = [];
  for (const e of execIn) newEdges.push({ ...e, id: uid('e'), target: callId, targetHandle: 'in:exec' });
  for (const e of execOut) newEdges.push({ ...e, id: uid('e'), source: callId, sourceHandle: 'out:then' });
  for (const [key, name] of inputBySource) {
    const [s, h] = key.split('|');
    newEdges.push({ id: uid('e'), source: s, sourceHandle: h, target: callId, targetHandle: `in:${name}` });
  }
  for (const e of dataOut) {
    const name = outputBySource.get(`${e.source}|${e.sourceHandle}`)!;
    newEdges.push({ ...e, id: uid('e'), source: callId, sourceHandle: `out:${name}` });
  }

  return {
    graph: {
      nodes: [...graph.nodes.filter((n) => !sel.has(n.id)).map((n) => ({ ...n, selected: false })), call],
      edges: [...keptEdges, ...newEdges]
    },
    fn,
    callId
  };
}
