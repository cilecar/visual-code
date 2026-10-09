// Copy / paste of sub-graphs. The clipboard payload carries the variable and
// function definitions the copied blocks refer to, so pasting into another
// file keeps working.
import type { BlockData, Doc, FnDef, GEdge, GNode, VarDef } from '../types';
import { isBlockNode } from '../types';
import { cleanEdge, cleanNode } from './serialize';
import { uid } from './ids';

export interface ClipPayload {
  nodus: 'clipboard';
  nodes: GNode[];
  edges: GEdge[];
  variables: VarDef[];
  functions: FnDef[];
}

export function copySelection(nodes: GNode[], edges: GEdge[], doc: Doc): ClipPayload | null {
  const sel = nodes.filter((n) => n.selected);
  if (!sel.length) return null;
  const ids = new Set(sel.map((n) => n.id));
  const varNames = new Set<string>();
  const fnIds = new Set<string>();
  for (const n of sel) {
    if (!isBlockNode(n)) continue;
    if (n.data.params?.var) varNames.add(String(n.data.params.var));
    if (n.data.block === 'fn.call' && n.data.params?.fn) fnIds.add(String(n.data.params.fn));
  }
  return {
    nodus: 'clipboard',
    nodes: sel.map(cleanNode),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map(cleanEdge),
    variables: doc.variables.filter((v) => varNames.has(v.name)),
    functions: doc.functions.filter((f) => fnIds.has(f.id))
  };
}

export function parseClipboard(text: string): ClipPayload | null {
  try {
    const p = JSON.parse(text);
    return p?.nodus === 'clipboard' && Array.isArray(p.nodes) ? p : null;
  } catch {
    return null;
  }
}

/**
 * Re-ids the payload and places its top-left corner at `at`.
 * Returns the new nodes/edges (selected) and the definitions missing in `doc`.
 */
export function preparePaste(p: ClipPayload, doc: Doc, at: { x: number; y: number }) {
  const map = new Map<string, string>();
  const minX = Math.min(...p.nodes.map((n) => n.position.x));
  const minY = Math.min(...p.nodes.map((n) => n.position.y));
  const nodes: GNode[] = p.nodes.map((n) => {
    const id = uid(n.type === 'comment' ? 'c' : 'n');
    map.set(n.id, id);
    return { ...structuredClone(n), id, selected: true, position: { x: n.position.x - minX + at.x, y: n.position.y - minY + at.y } };
  });
  const edges: GEdge[] = p.edges.map((e) => ({ ...e, id: uid('e'), source: map.get(e.source)!, target: map.get(e.target)!, selected: false }));
  const variables = p.variables.filter((v) => !doc.variables.some((x) => x.name === v.name));
  const functions: FnDef[] = [];
  for (const f of p.functions) {
    if (doc.functions.some((x) => x.id === f.id)) continue;
    functions.push(structuredClone(f));
  }
  for (const n of nodes) if (isBlockNode(n)) (n.data as BlockData).breakpoint = false;
  return { nodes, edges, variables, functions };
}
