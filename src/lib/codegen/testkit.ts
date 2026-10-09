// Tiny DSL for building graphs in tests.
import type { BlockData, Doc, FnDef, GEdge, GNode, Graph, VarDef } from '../types';

export class GB {
  nodes: GNode[] = [];
  edges: GEdge[] = [];
  private k = 0;

  node(block: string, opts: { id?: string; params?: Record<string, unknown>; inputs?: Record<string, unknown>; x?: number; y?: number; data?: Partial<BlockData> } = {}): string {
    const id = opts.id ?? `${block.split('.').pop()}${++this.k}`;
    this.nodes.push({
      id,
      type: 'block',
      position: { x: opts.x ?? this.k * 200, y: opts.y ?? 0 },
      data: { block, params: opts.params ?? {}, inputs: opts.inputs ?? {}, ...opts.data }
    });
    return id;
  }

  reroute(portType: string, id = `rr${++this.k}`): string {
    this.nodes.push({ id, type: 'reroute', position: { x: 0, y: 0 }, data: { portType } as never });
    return id;
  }

  /** wire("a.then", "b.exec") */
  wire(from: string, to: string, id?: string): string {
    const [s, sp] = from.split('.');
    const [t, tp] = to.split('.');
    const eid = id ?? `e${this.edges.length + 1}`;
    this.edges.push({ id: eid, source: s, sourceHandle: `out:${sp}`, target: t, targetHandle: `in:${tp}` });
    return eid;
  }

  /** chain("start.then", "print1", "print2") – exec chain through `then` ports. */
  chain(...ids: string[]) {
    for (let i = 0; i < ids.length - 1; i++) {
      const from = ids[i].includes('.') ? ids[i] : `${ids[i]}.then`;
      this.wire(from, `${ids[i + 1]}.exec`);
    }
  }

  graph(): Graph {
    return { nodes: this.nodes, edges: this.edges };
  }

  doc(opts: { name?: string; variables?: VarDef[]; functions?: FnDef[] } = {}): Doc {
    return {
      format: 'nodus',
      schemaVersion: 1,
      name: opts.name ?? 'Test',
      variables: opts.variables ?? [],
      functions: opts.functions ?? [],
      main: this.graph()
    };
  }
}

/** Body of `def on_start():` without indentation. */
export function startBody(code: string): string[] {
  const lines = code.split('\n');
  const i = lines.findIndex((l) => l.startsWith('def on_start():'));
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (l && !l.startsWith('    ')) break;
    if (l) out.push(l.slice(4));
  }
  return out;
}
