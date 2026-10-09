// Resolves the concrete ports of a node: most blocks have static ports, a few
// (variables, Python Code, function calls, variadic blocks) derive them from
// node data and the document.
import type { BlockData, Doc, FnDef, GNode, Port, PortDef, RerouteData } from '../types';
import { isBlockNode, isRerouteNode } from '../types';
import { getBlock } from './registry';

export interface PortContext {
  variables: Doc['variables'];
  functions: FnDef[];
  /** When resolving ports inside a function graph: the function being edited. */
  currentFn?: FnDef | null;
}

export interface NodePorts {
  inputs: Port[];
  outputs: Port[];
}

const EMPTY: NodePorts = { inputs: [], outputs: [] };

function toPort(p: PortDef, dir: 'in' | 'out', data: BlockData): Port {
  let int = false;
  if (p.int === true) int = true;
  else if (typeof p.int === 'string') {
    const [k, v] = p.int.split('=');
    int = String(data.params?.[k]) === v;
  }
  return {
    id: p.id,
    dir,
    type: p.type,
    label: p.label ?? (p.type === 'exec' ? '' : p.id),
    default: p.default,
    required: p.required,
    varName: p.varName,
    expr: p.expr,
    int
  };
}

export function resolvePorts(node: GNode, ctx: PortContext): NodePorts {
  if (isRerouteNode(node)) {
    const t = (node.data as RerouteData).portType;
    return {
      inputs: [{ id: 'in', dir: 'in', type: t, label: '' }],
      outputs: [{ id: 'out', dir: 'out', type: t, label: '' }]
    };
  }
  if (!isBlockNode(node)) return EMPTY;
  const data = node.data;
  const def = getBlock(data.block);
  if (!def) return EMPTY;
  const inputs = def.inputs.map((p) => toPort(p, 'in', data));
  const outputs = def.outputs.map((p) => toPort(p, 'out', data));

  if (def.variadic) {
    const n = Math.max(0, Math.min(32, Math.floor(Number(data.params?.[def.variadic.param] ?? 2)) || 0));
    for (let i = 0; i < n; i++)
      inputs.push({ id: `${def.variadic.prefix}${i}`, dir: 'in', type: def.variadic.type, label: `${def.variadic.label} ${i}` });
  }

  switch (def.dynamic) {
    case 'var-get':
    case 'var-set': {
      const v = ctx.variables.find((x) => x.name === data.params?.var);
      if (v) {
        for (const p of [...inputs, ...outputs]) if (p.id === 'value') p.type = v.type;
      }
      break;
    }
    case 'python': {
      for (const p of data.pyInputs ?? []) inputs.push({ id: p.name, dir: 'in', type: p.type, label: p.name });
      for (const p of data.pyOutputs ?? []) outputs.push({ id: p.name, dir: 'out', type: p.type, label: p.name, varName: p.name });
      break;
    }
    case 'function': {
      const fn = ctx.functions.find((f) => f.id === data.params?.fn);
      if (fn) {
        for (const p of fn.inputs) inputs.push({ id: p.name, dir: 'in', type: p.type, label: p.name });
        for (const p of fn.outputs) outputs.push({ id: p.name, dir: 'out', type: p.type, label: p.name, varName: p.name });
      }
      break;
    }
    case 'fn-entry': {
      for (const p of ctx.currentFn?.inputs ?? []) outputs.push({ id: p.name, dir: 'out', type: p.type, label: p.name, expr: p.name });
      break;
    }
    case 'fn-return': {
      for (const p of ctx.currentFn?.outputs ?? []) inputs.push({ id: p.name, dir: 'in', type: p.type, label: p.name });
      break;
    }
  }
  return { inputs, outputs };
}

export function findPort(node: GNode, handle: string, ctx: PortContext): Port | undefined {
  const ports = resolvePorts(node, ctx);
  if (handle.startsWith('in:')) return ports.inputs.find((p) => `in:${p.id}` === handle);
  if (handle.startsWith('out:')) return ports.outputs.find((p) => `out:${p.id}` === handle);
  return undefined;
}

export function nodeTitle(node: GNode, ctx: PortContext): string {
  if (!isBlockNode(node)) return '';
  const def = getBlock(node.data.block);
  if (!def) return `? ${node.data.block}`;
  if (def.dynamic === 'function') return ctx.functions.find((f) => f.id === node.data.params?.fn)?.name ?? 'Function';
  if (def.dynamic === 'var-get') return `Get ${node.data.params?.var || '…'}`;
  if (def.dynamic === 'var-set') return `Set ${node.data.params?.var || '…'}`;
  return def.title;
}
