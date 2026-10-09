// Align / distribute selected nodes.
import type { GNode } from '../types';

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'hcenter' | 'vcenter';

const W = (n: GNode) => n.measured?.width ?? n.width ?? 200;
const H = (n: GNode) => n.measured?.height ?? n.height ?? 80;

/** Returns new positions (by id) for the given nodes. */
export function align(nodes: GNode[], mode: AlignMode): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length < 2) return out;
  const minX = Math.min(...nodes.map((n) => n.position.x));
  const maxX = Math.max(...nodes.map((n) => n.position.x + W(n)));
  const minY = Math.min(...nodes.map((n) => n.position.y));
  const maxY = Math.max(...nodes.map((n) => n.position.y + H(n)));
  for (const n of nodes) {
    let { x, y } = n.position;
    if (mode === 'left') x = minX;
    if (mode === 'right') x = maxX - W(n);
    if (mode === 'top') y = minY;
    if (mode === 'bottom') y = maxY - H(n);
    if (mode === 'hcenter') x = (minX + maxX) / 2 - W(n) / 2;
    if (mode === 'vcenter') y = (minY + maxY) / 2 - H(n) / 2;
    out.set(n.id, { x, y });
  }
  return out;
}

/** Equal gaps between nodes along an axis. */
export function distribute(nodes: GNode[], axis: 'x' | 'y'): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  if (nodes.length < 3) return out;
  const size = axis === 'x' ? W : H;
  const sorted = [...nodes].sort((a, b) => a.position[axis] - b.position[axis]);
  const start = sorted[0].position[axis];
  const end = sorted.at(-1)!.position[axis] + size(sorted.at(-1)!);
  const total = sorted.reduce((s, n) => s + size(n), 0);
  const gap = (end - start - total) / (sorted.length - 1);
  let cur = start;
  for (const n of sorted) {
    out.set(n.id, { ...n.position, [axis]: cur });
    cur += size(n) + gap;
  }
  return out;
}
