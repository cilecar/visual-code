// Real-time validation: compile problems + editor-level checks, grouped by node.
import type { Doc } from '../types';
import { compile, type CompileProblem, type CompileResult } from '../codegen/compile';

export interface Validation {
  result: CompileResult;
  byNode: Map<string, CompileProblem[]>;
  errors: number;
  warnings: number;
}

export function validate(doc: Doc): Validation {
  const result = compile(doc);
  const byNode = new Map<string, CompileProblem[]>();
  for (const p of result.problems) {
    if (!p.nodeId) continue;
    const list = byNode.get(p.nodeId);
    if (list) list.push(p);
    else byNode.set(p.nodeId, [p]);
  }
  return {
    result,
    byNode,
    errors: result.problems.filter((p) => p.severity === 'error').length,
    warnings: result.problems.filter((p) => p.severity === 'warning').length
  };
}
