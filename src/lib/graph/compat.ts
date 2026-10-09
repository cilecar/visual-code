import type { PortType } from '../types';

/** Can a wire go from an output of type `out` into an input of type `inp`? */
export function typesCompatible(out: PortType, inp: PortType): boolean {
  if (out === 'exec' || inp === 'exec') return out === inp;
  return out === inp || out === 'any' || inp === 'any';
}
