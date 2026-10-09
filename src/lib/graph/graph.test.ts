import { describe, expect, test } from 'vitest';
import { collapseToFunction, CollapseError } from './functions';
import { compile } from '../codegen/compile';
import { GB, startBody } from '../codegen/testkit';
import { typesCompatible } from './compat';
import { History } from './history';
import { parseDoc, serializeDoc, newDoc, BlkFormatError } from './serialize';
import { copySelection, preparePaste } from './clipboard';
import { align, distribute } from './align';
import { validateBlockDef, registerUserBlocks, getBlock } from '../blocks/registry';

describe('collapse to function', () => {
  test('selected exec+pure blocks become a function call with matching ports', () => {
    const g = new GB();
    const s = g.node('event.start', { id: 's' });
    g.node('lit.number', { id: 'num', params: { value: 20 } });
    g.node('math.mul', { id: 'mul', inputs: { b: 2 } });
    const p = g.node('io.print', { id: 'p' });
    const after = g.node('io.print', { id: 'after' });
    g.chain(s, p, after);
    g.wire('num.value', 'mul.a');
    g.wire('mul.result', 'p.value');
    g.wire('mul.result', 'after.value');
    const doc = g.doc();
    const before = startBody(compile(doc).code);
    expect(before).toEqual(['print(20 * 2)', 'print(20 * 2)']);

    const ctx = { variables: doc.variables, functions: doc.functions };
    const r = collapseToFunction(doc.main, ['mul', 'p'], doc, ctx, 'double it');
    expect(r.fn.name).toBe('double_it');
    expect(r.fn.inputs).toEqual([{ name: 'A', type: 'number' }]);
    expect(r.fn.outputs).toEqual([{ name: 'result', type: 'number' }]);
    const doc2 = { ...doc, main: r.graph, functions: [r.fn] };
    const out = compile(doc2);
    expect(out.problems.filter((x) => x.severity === 'error')).toEqual([]);
    expect(out.code).toContain('def double_it(A):\n    print(A * 2)\n    return A * 2\n');
    expect(startBody(out.code)).toEqual(['result = double_it(20)', 'print(result)']);
  });

  test('refuses multiple exec entries', () => {
    const g = new GB();
    const s = g.node('event.start', { id: 's' });
    const iff = g.node('flow.if', { id: 'iff' });
    const a = g.node('io.print', { id: 'a' });
    const b = g.node('io.print', { id: 'b' });
    g.chain(s, iff);
    g.wire('iff.true', 'a.exec');
    g.wire('iff.false', 'b.exec');
    const doc = g.doc();
    expect(() => collapseToFunction(doc.main, ['a', 'b'], doc, { variables: [], functions: [] })).toThrow(CollapseError);
    void [a, b];
  });
});

test('type compatibility', () => {
  expect(typesCompatible('number', 'number')).toBe(true);
  expect(typesCompatible('number', 'string')).toBe(false);
  expect(typesCompatible('any', 'list')).toBe(true);
  expect(typesCompatible('bool', 'any')).toBe(true);
  expect(typesCompatible('exec', 'any')).toBe(false);
  expect(typesCompatible('exec', 'exec')).toBe(true);
});

test('history undo/redo', () => {
  const h = new History({ v: 1 });
  expect(h.commit({ v: 1 })).toBe(false);
  h.commit({ v: 2 });
  h.commit({ v: 3 });
  expect(h.undo()).toEqual({ v: 2 });
  expect(h.undo()).toEqual({ v: 1 });
  expect(h.undo()).toBeNull();
  expect(h.redo()).toEqual({ v: 2 });
  h.commit({ v: 9 });
  expect(h.canRedo).toBe(false);
});

describe('blk format', () => {
  test('round trip strips runtime fields', () => {
    const d = newDoc('X');
    d.main.nodes[0].selected = true;
    d.main.nodes[0].measured = { width: 10, height: 10 };
    const back = parseDoc(serializeDoc(d));
    expect(back.main.nodes[0]).toEqual({ id: 'n_start', type: 'block', position: { x: 0, y: 0 }, data: { block: 'event.start', params: {}, inputs: {} } });
    expect(back.schemaVersion).toBe(1);
  });

  test('migrates schema v0 and drops dangling edges', () => {
    const v0 = JSON.stringify({ format: 'nodus', nodes: [{ id: 'a', data: { block: 'event.start' } }], edges: [{ id: 'e', source: 'a', target: 'zzz' }] });
    const d = parseDoc(v0);
    expect(d.main.nodes[0].type).toBe('block');
    expect(d.main.edges).toEqual([]);
  });

  test('rejects foreign or newer files', () => {
    expect(() => parseDoc('{"hello":1}')).toThrow(BlkFormatError);
    expect(() => parseDoc('{"format":"nodus","schemaVersion":99}')).toThrow(/новой версией/);
    expect(() => parseDoc('nope')).toThrow(BlkFormatError);
  });
});

test('copy/paste re-ids nodes, keeps inner edges and carries variables', () => {
  const g = new GB();
  g.node('var.get', { id: 'get', params: { var: 'score' } });
  g.node('io.print', { id: 'p' });
  g.node('io.print', { id: 'outside' });
  g.wire('get.value', 'p.value');
  g.wire('get.value', 'outside.value');
  const doc = g.doc({ variables: [{ name: 'score', type: 'number', value: 3 }] });
  for (const n of doc.main.nodes) n.selected = n.id !== 'outside';
  const clip = copySelection(doc.main.nodes, doc.main.edges, doc)!;
  expect(clip.edges).toHaveLength(1);
  expect(clip.variables).toEqual([{ name: 'score', type: 'number', value: 3 }]);
  const pasted = preparePaste(clip, { ...doc, variables: [] }, { x: 1000, y: 1000 });
  expect(pasted.nodes.map((n) => n.id)).not.toContain('get');
  expect(pasted.edges[0].source).toBe(pasted.nodes[0].id);
  expect(Math.min(...pasted.nodes.map((n) => n.position.x))).toBe(1000);
  expect(pasted.variables).toHaveLength(1);
});

test('align and distribute', () => {
  const n = (id: string, x: number, y: number) => ({ id, type: 'block' as const, position: { x, y }, data: {} as never, measured: { width: 100, height: 50 } });
  const nodes = [n('a', 0, 0), n('b', 50, 100), n('c', 400, 30)];
  expect([...align(nodes, 'left').values()].map((p) => p.x)).toEqual([0, 0, 0]);
  expect([...align(nodes, 'bottom').values()].map((p) => p.y)).toEqual([100, 100, 100]);
  const d = distribute(nodes, 'x');
  expect(d.get('b')!.x).toBe(200);
});

describe('user blocks', () => {
  test('validation catches broken definitions', () => {
    expect(validateBlockDef({})).not.toEqual([]);
    expect(validateBlockDef({ id: 'x', title: 'X', kind: 'pure', outputs: [{ id: 'r', type: 'number' }] })).toContain(
      'pure-блоку нужно поле "expr": {выход: шаблон}'
    );
    expect(validateBlockDef({ id: 'x', title: 'X', kind: 'exec', code: '{exec.nope}', outputs: [] })[0]).toMatch(/nope/);
  });

  test('valid user block compiles', () => {
    const errs = registerUserBlocks([
      {
        name: 'square.json',
        content: JSON.stringify({
          id: 'user.square',
          title: 'Square',
          kind: 'pure',
          category: 'math',
          inputs: [{ id: 'x', type: 'number', default: 3 }],
          outputs: [{ id: 'r', type: 'number' }],
          expr: { r: '{in.x} ** 2' }
        })
      },
      { name: 'bad.json', content: '{' },
      { name: 'clash.json', content: JSON.stringify({ id: 'io.print', title: 'P', kind: 'exec', code: 'pass' }) }
    ]);
    expect(errs).toHaveLength(2);
    expect(getBlock('user.square')?.source).toBe('user');
    const g = new GB();
    const s = g.node('event.start');
    g.node('user.square', { id: 'sq' });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, p);
    g.wire('sq.r', 'p.value');
    expect(startBody(compile(g.doc()).code)).toEqual(['print(3 ** 2)']);
  });
});
