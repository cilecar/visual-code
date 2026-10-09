// Registry of rendered wire paths, used by the particle overlay to sample
// points along a wire (getPointAtLength) without touching Svelte Flow internals.
const paths = new Map<string, SVGPathElement>();

export function registerPath(id: string, el: SVGPathElement) {
  paths.set(id, el);
  return () => {
    if (paths.get(id) === el) paths.delete(id);
  };
}

export function getPath(id: string): SVGPathElement | undefined {
  const p = paths.get(id);
  return p?.isConnected ? p : undefined;
}
