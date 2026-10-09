// .blk file format: JSON with nodes, edges, positions, comments, variables,
// functions and a schema version.
import type { Doc, GEdge, GNode, Graph } from '../types';
import { SCHEMA_VERSION } from '../types';

export function emptyGraph(): Graph {
  return { nodes: [], edges: [] };
}

export function newDoc(name = 'Без названия'): Doc {
  return {
    format: 'nodus',
    schemaVersion: SCHEMA_VERSION,
    name,
    variables: [],
    functions: [],
    main: {
      nodes: [
        {
          id: 'n_start',
          type: 'block',
          position: { x: 0, y: 0 },
          data: { block: 'event.start', params: {}, inputs: {} }
        }
      ],
      edges: []
    }
  };
}

/** Strips runtime-only fields (selection, measurements) from a node. */
export function cleanNode(n: GNode): GNode {
  const out: GNode = { id: n.id, type: n.type, position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: structuredClone(n.data) };
  if (n.type === 'comment') {
    out.width = Math.round(n.width ?? n.measured?.width ?? 320);
    out.height = Math.round(n.height ?? n.measured?.height ?? 200);
  }
  return out;
}

export function cleanEdge(e: GEdge): GEdge {
  return { id: e.id, source: e.source, sourceHandle: e.sourceHandle, target: e.target, targetHandle: e.targetHandle };
}

export function cleanGraph(g: Graph): Graph {
  return { nodes: g.nodes.map(cleanNode), edges: g.edges.map(cleanEdge) };
}

export function serializeDoc(doc: Doc): string {
  const out: Doc = {
    format: 'nodus',
    schemaVersion: SCHEMA_VERSION,
    name: doc.name,
    description: doc.description,
    variables: structuredClone(doc.variables),
    functions: doc.functions.map((f) => ({ ...structuredClone({ ...f, graph: undefined }), graph: cleanGraph(f.graph) })),
    main: cleanGraph(doc.main),
    viewport: doc.viewport
  };
  return JSON.stringify(out, null, 2) + '\n';
}

export class BlkFormatError extends Error {}

/** Parses and migrates a .blk file. */
export function parseDoc(text: string): Doc {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new BlkFormatError(`Файл не является JSON: ${(e as Error).message}`);
  }
  if (!raw || typeof raw !== 'object' || raw.format !== 'nodus') throw new BlkFormatError('Это не файл Nodus (.blk)');
  const version = Number(raw.schemaVersion ?? 0);
  if (version > SCHEMA_VERSION) throw new BlkFormatError(`Файл создан более новой версией Nodus (схема ${version})`);
  const doc = migrate(raw, version);
  const checkGraph = (g: Graph, where: string) => {
    if (!Array.isArray(g?.nodes) || !Array.isArray(g?.edges)) throw new BlkFormatError(`Повреждён граф ${where}`);
    const ids = new Set(g.nodes.map((n) => n.id));
    g.edges = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    for (const n of g.nodes) {
      n.type ??= 'block';
      n.position ??= { x: 0, y: 0 };
      if (n.type === 'block') {
        const d = n.data as Record<string, unknown>;
        d.params ??= {};
        d.inputs ??= {};
      }
    }
  };
  checkGraph(doc.main, 'main');
  for (const f of doc.functions) checkGraph(f.graph, f.name);
  return doc;
}

function migrate(raw: Record<string, unknown>, version: number): Doc {
  // v0 → v1: a bare {nodes, edges} graph at the top level
  if (version < 1) {
    raw = {
      ...raw,
      schemaVersion: 1,
      main: raw.main ?? { nodes: raw.nodes ?? [], edges: raw.edges ?? [] },
      variables: raw.variables ?? [],
      functions: raw.functions ?? []
    };
    delete raw.nodes;
    delete raw.edges;
  }
  const doc = raw as unknown as Doc;
  doc.variables ??= [];
  doc.functions ??= [];
  doc.name ??= 'Без названия';
  return doc;
}
