// Read-only graph queries shared by codegen, validation and the debugger UI.
import type { GEdge, GNode, Graph } from '../types';
import { isRerouteNode } from '../types';

export class GraphIndex {
  readonly nodes = new Map<string, GNode>();
  /** target node → target handle → edge (inputs take one wire; for exec inputs: many). */
  readonly incoming = new Map<string, Map<string, GEdge[]>>();
  /** source node → source handle → edges */
  readonly outgoing = new Map<string, Map<string, GEdge[]>>();

  constructor(readonly graph: Graph) {
    for (const n of graph.nodes) this.nodes.set(n.id, n);
    for (const e of graph.edges) {
      if (!this.nodes.has(e.source) || !this.nodes.has(e.target)) continue;
      push(this.incoming, e.target, e.targetHandle, e);
      push(this.outgoing, e.source, e.sourceHandle, e);
    }
  }

  edgesInto(node: string, handle: string): GEdge[] {
    return this.incoming.get(node)?.get(handle) ?? [];
  }

  edgesFrom(node: string, handle: string): GEdge[] {
    return this.outgoing.get(node)?.get(handle) ?? [];
  }

  /** Follows a data input backwards through reroute nodes to the real source. */
  dataSource(node: string, inputPort: string): { node: GNode; port: string; edges: GEdge[] } | null {
    const edges: GEdge[] = [];
    let edge = this.edgesInto(node, `in:${inputPort}`)[0];
    const seen = new Set<string>();
    while (edge) {
      edges.push(edge);
      const src = this.nodes.get(edge.source);
      if (!src) return null;
      if (!isRerouteNode(src)) return { node: src, port: edge.sourceHandle.replace(/^out:/, ''), edges };
      if (seen.has(src.id)) return null;
      seen.add(src.id);
      edge = this.edgesInto(src.id, 'in:in')[0];
    }
    return null;
  }

  /** Follows an exec output forwards through reroute nodes to the real target block. */
  execTarget(node: string, outPort: string): { node: GNode; edges: GEdge[] } | null {
    const edges: GEdge[] = [];
    let edge = this.edgesFrom(node, `out:${outPort}`)[0];
    const seen = new Set<string>();
    while (edge) {
      edges.push(edge);
      const dst = this.nodes.get(edge.target);
      if (!dst) return null;
      if (!isRerouteNode(dst)) return { node: dst, edges };
      if (seen.has(dst.id)) return null;
      seen.add(dst.id);
      edge = this.edgesFrom(dst.id, 'out:out')[0];
    }
    return null;
  }

  /** Exec edges (as chains through reroutes) leading from `from` straight into `to`. */
  execEdgesBetween(from: string, to: string): string[] {
    const out = this.outgoing.get(from);
    if (!out) return [];
    for (const [handle] of out) {
      const t = this.execTarget(from, handle.replace(/^out:/, ''));
      if (t && t.node.id === to) return t.edges.map((e) => e.id);
    }
    return [];
  }
}

function push(map: Map<string, Map<string, GEdge[]>>, node: string, handle: string, e: GEdge) {
  let m = map.get(node);
  if (!m) map.set(node, (m = new Map()));
  const list = m.get(handle);
  if (list) list.push(e);
  else m.set(handle, [e]);
}

/**
 * Kahn's topological sort over exec wires (`isExec` decides which edges count).
 * Returns the order and the nodes that are part of (or blocked by) a cycle.
 */
export function topoSort(nodeIds: string[], edges: { source: string; target: string }[]): { order: string[]; cyclic: string[] } {
  const indeg = new Map<string, number>(nodeIds.map((id) => [id, 0]));
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!indeg.has(e.source) || !indeg.has(e.target)) continue;
    indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
    (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
  }
  const queue = nodeIds.filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const t of adj.get(id) ?? []) {
      const d = (indeg.get(t) ?? 0) - 1;
      indeg.set(t, d);
      if (d === 0) queue.push(t);
    }
  }
  const done = new Set(order);
  return { order, cyclic: nodeIds.filter((id) => !done.has(id)) };
}
