import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile, elifify } from './compile';
import { isAtomic, pyIdent, pyLiteral } from './python';
import { GB, startBody } from './testkit';
import { parseDoc } from '../graph/serialize';

const example = (name: string) => parseDoc(readFileSync(`examples/${name}.blk`, 'utf8'));
const errors = (r: ReturnType<typeof compile>) => r.problems.filter((p) => p.severity === 'error');

describe('examples', () => {
  test('hello world', async () => {
    const r = compile(example('hello-world'));
    expect(errors(r)).toEqual([]);
    expect(r.code).toBe(
      [
        '# Hello World — сгенерировано Nodus',
        '',
        '',
        'def on_start():',
        '    print("Hello, World!")',
        '',
        '',
        'if __name__ == "__main__":',
        '    on_start()',
        ''
      ].join('\n')
    );
    await expect(r.code).toMatchFileSnapshot('./__golden__/hello-world.py');
  });

  test('fizzbuzz compiles to an elif chain inside a for loop', async () => {
    const r = compile(example('fizzbuzz'));
    expect(errors(r)).toEqual([]);
    expect(startBody(r.code)).toEqual([
      'for i in range(1, 101):',
      '    if (i % 15) == 0:',
      '        print("FizzBuzz")',
      '    elif (i % 3) == 0:',
      '        print("Fizz")',
      '    elif (i % 5) == 0:',
      '        print("Buzz")',
      '    else:',
      '        print(i)'
    ]);
    await expect(r.code).toMatchFileSnapshot('./__golden__/fizzbuzz.py');
  });

  test('guess the number declares globals and converts input', async () => {
    const r = compile(example('guess-the-number'));
    expect(errors(r)).toEqual([]);
    expect(r.code).toContain('import random\n');
    expect(r.code).toContain('secret = 0\nguess = 0\ntries = 0\n');
    const body = startBody(r.code);
    expect(body[0]).toBe('global secret, guess, tries');
    expect(body).toContain('secret = random.randint(1, 100)');
    expect(body).toContain('while guess != secret:');
    expect(body).toContain('    answer = input("Ваш вариант: ")');
    expect(body).toContain('    guess = int(answer)');
    expect(body).toContain('    tries = tries + 1');
    expect(body.at(-1)).toBe('print("Угадано за {0} попыток!".format(tries))');
    await expect(r.code).toMatchFileSnapshot('./__golden__/guess-the-number.py');
  });

  test('expense tracker', async () => {
    const r = compile(example('expense-tracker'));
    expect(errors(r)).toEqual([]);
    const body = startBody(r.code);
    expect(body).toContain('while running:');
    expect(body).toContain('    if len(answer) == 0:');
    expect(body).toContain('        amount = float(answer)');
    expect(body).toContain('        if amount > biggest:');
    expect(body).toContain('    else:');
    await expect(r.code).toMatchFileSnapshot('./__golden__/expense-tracker.py');
  });
});

describe('source map', () => {
  test('every statement line maps to its block', () => {
    const g = new GB();
    const s = g.node('event.start', { id: 'start' });
    const a = g.node('io.print', { id: 'p1', inputs: { value: 'a' } });
    const b = g.node('io.print', { id: 'p2', inputs: { value: 'b' } });
    g.chain(s, a, b);
    const r = compile(g.doc());
    const lines = r.code.split('\n');
    const at = (node: string) => r.sourceMap.nodeLines[node].map((n) => lines[n - 1].trim());
    expect(at('p1')).toEqual(['print("a")']);
    expect(at('p2')).toEqual(['print("b")']);
    expect(at('start')).toEqual(['on_start()']);
    for (const [line, node] of Object.entries(r.sourceMap.lines)) expect(r.sourceMap.nodeLines[node]).toContain(Number(line));
    expect(r.sourceMap.graphOf).toMatchObject({ start: 'main', p1: 'main', p2: 'main' });
  });

  test('multi-line templates map all their lines and nested bodies map to children', () => {
    const g = new GB();
    const s = g.node('event.start', { id: 'start' });
    const loop = g.node('flow.for', { id: 'loop', inputs: { end: 3 } });
    const p = g.node('io.print', { id: 'p' });
    const done = g.node('io.print', { id: 'done', inputs: { value: 'end' } });
    g.chain(s, loop);
    g.wire('loop.body', 'p.exec');
    g.wire('loop.index', 'p.value');
    g.wire('loop.done', 'done.exec');
    const r = compile(g.doc());
    const lines = r.code.split('\n');
    expect(lines[r.sourceMap.nodeLines.loop[0] - 1]).toBe('    for i in range(0, 3):');
    expect(lines[r.sourceMap.nodeLines.p[0] - 1]).toBe('        print(i)');
    expect(lines[r.sourceMap.nodeLines.done[0] - 1]).toBe('    print("end")');
  });

  test('watches record side-effect free wire expressions for the consuming block', () => {
    const g = new GB();
    const s = g.node('event.start', { id: 'start' });
    const n = g.node('lit.number', { id: 'num', params: { value: 40 } });
    const add = g.node('math.add', { id: 'add', inputs: { b: 2 } });
    const rnd = g.node('math.random', { id: 'rnd' });
    const p = g.node('io.print', { id: 'p' });
    const p2 = g.node('io.print', { id: 'p2' });
    g.chain(s, p, p2);
    const e1 = g.wire('num.value', 'add.a');
    const e2 = g.wire('add.result', 'p.value');
    const e3 = g.wire('rnd.result', 'p2.value');
    const r = compile(g.doc());
    expect(r.sourceMap.watches.p).toEqual(
      expect.arrayContaining([
        { edge: e1, expr: '40' },
        { edge: e2, expr: '40 + 2' }
      ])
    );
    // Random must never be re-evaluated by the debugger
    expect(r.sourceMap.watches.p2 ?? []).not.toContainEqual(expect.objectContaining({ edge: e3 }));
    void n;
    void add;
    void rnd;
  });
});

describe('expressions', () => {
  test('nested operators get parentheses only where needed', () => {
    const g = new GB();
    const s = g.node('event.start');
    const add = g.node('math.add', { id: 'add', inputs: { a: 1, b: 2 } });
    const mul = g.node('math.mul', { id: 'mul', inputs: { b: 3 } });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, p);
    g.wire('add.result', 'mul.a');
    g.wire('mul.result', 'p.value');
    expect(startBody(compile(g.doc()).code)).toEqual(['print((1 + 2) * 3)']);
  });

  test('literals of every type', () => {
    const g = new GB();
    const s = g.node('event.start');
    const p1 = g.node('io.print', { inputs: { value: 'quote " and \\ and\nnewline' } });
    const p2 = g.node('io.print', { inputs: { value: 2.5 } });
    const not = g.node('logic.not', { id: 'not', inputs: { a: true } });
    const p3 = g.node('io.print', { id: 'p3' });
    const list = g.node('list.make', { id: 'list', params: { count: 3 }, inputs: { item0: 1, item1: 'two', item2: false } });
    const p4 = g.node('io.print', { id: 'p4' });
    g.chain(s, p1, p2, p3, p4);
    g.wire('not.result', 'p3.value');
    g.wire('list.result', 'p4.value');
    expect(startBody(compile(g.doc()).code)).toEqual([
      'print("quote \\" and \\\\ and\\nnewline")',
      'print(2.5)',
      'print(not True)',
      'print([1, "two", False])'
    ]);
    void not;
    void list;
  });

  test('compare, logic and string blocks', () => {
    const g = new GB();
    const s = g.node('event.start');
    const cmp = g.node('math.compare', { id: 'cmp', params: { op: '>=' }, inputs: { a: 5, b: 3 } });
    const and = g.node('logic.and', { id: 'and', inputs: { b: true } });
    const iff = g.node('flow.if', { id: 'iff' });
    const split = g.node('str.split', { id: 'split', inputs: { text: 'a,b', sep: ',' } });
    const len = g.node('list.length', { id: 'len' });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, iff);
    g.wire('cmp.result', 'and.a');
    g.wire('and.result', 'iff.cond');
    g.wire('iff.true', 'p.exec');
    g.wire('split.result', 'len.list');
    g.wire('len.result', 'p.value');
    expect(startBody(compile(g.doc()).code)).toEqual(['if (5 >= 3) and True:', '    print(len("a,b".split(",")))']);
    void [cmp, split];
  });

  test('compare operator is restricted to known options', () => {
    const g = new GB();
    const s = g.node('event.start');
    g.node('math.compare', { id: 'cmp', params: { op: '); import os; (' } });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, p);
    g.wire('cmp.result', 'p.value');
    expect(startBody(compile(g.doc()).code)).toEqual(['print(0 < 0)']);
  });

  test('range arguments are coerced to int unless known to be ints', () => {
    const g = new GB();
    const s = g.node('event.start');
    const get = g.node('var.get', { id: 'get', params: { var: 'n' } });
    const loop = g.node('flow.for', { id: 'loop', inputs: { start: 1, step: 2 } });
    const len = g.node('str.length', { id: 'len', inputs: { text: 'abc' } });
    const loop2 = g.node('flow.for', { id: 'loop2' });
    g.chain(s, loop);
    g.wire('get.value', 'loop.end');
    g.wire('loop.done', 'loop2.exec');
    g.wire('len.result', 'loop2.end');
    const r = compile(g.doc({ variables: [{ name: 'n', type: 'number', value: 10 }] }));
    expect(startBody(r.code)).toEqual(['for i in range(1, int(n), 2):', '    pass', 'for i_2 in range(0, len("abc")):', '    pass']);
    void len;
  });

  test('format with variadic arguments', () => {
    const g = new GB();
    const s = g.node('event.start');
    g.node('str.format', { id: 'fmt', params: { count: 2 }, inputs: { template: '{0}-{1}', arg0: 1, arg1: 'x' } });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, p);
    g.wire('fmt.result', 'p.value');
    expect(startBody(compile(g.doc()).code)).toEqual(['print("{0}-{1}".format(1, "x"))']);
  });

  test('reroute nodes are transparent for data and exec wires', () => {
    const g = new GB();
    const s = g.node('event.start');
    const r1 = g.reroute('exec');
    const r2 = g.reroute('number');
    g.node('lit.number', { id: 'num', params: { value: 7 } });
    const p = g.node('io.print', { id: 'p' });
    g.wire(`${s}.then`, `${r1}.in`);
    g.wire(`${r1}.out`, 'p.exec');
    g.wire('num.value', `${r2}.in`);
    g.wire(`${r2}.out`, 'p.value');
    const r = compile(g.doc());
    expect(startBody(r.code)).toEqual(['print(7)']);
    expect(r.sourceMap.watches.p.map((w) => w.edge).sort()).toEqual(['e3', 'e4']);
    void p;
  });
});

describe('statements', () => {
  test('if with only a false branch keeps a pass in the true branch', () => {
    const g = new GB();
    const s = g.node('event.start');
    const iff = g.node('flow.if', { id: 'iff', inputs: { cond: true } });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, iff);
    g.wire('iff.false', 'p.exec');
    expect(startBody(compile(g.doc()).code)).toEqual(['if True:', '    pass', 'else:', '    print("Hello, World!")']);
    void p;
  });

  test('while with break and sequence', () => {
    const g = new GB();
    const s = g.node('event.start');
    const w = g.node('flow.while', { id: 'w', inputs: { cond: true } });
    const seq = g.node('flow.sequence', { id: 'seq' });
    const p = g.node('io.print', { id: 'p', inputs: { value: 'once' } });
    const br = g.node('flow.break', { id: 'br' });
    const after = g.node('io.print', { id: 'after', inputs: { value: 'after' } });
    g.chain(s, w);
    g.wire('w.body', 'seq.exec');
    g.wire('seq.then0', 'p.exec');
    g.wire('seq.then1', 'br.exec');
    g.wire('w.done', 'after.exec');
    expect(startBody(compile(g.doc()).code)).toEqual(['while True:', '    print("once")', '    break', 'print("after")']);
    void [p, br, after];
  });

  test('foreach, append, get index', () => {
    const g = new GB();
    const s = g.node('event.start');
    const get = g.node('var.get', { id: 'get', params: { var: 'items' } });
    const app = g.node('list.append', { id: 'app', inputs: { item: 4 } });
    const fe = g.node('flow.foreach', { id: 'fe' });
    const p = g.node('io.print', { id: 'p' });
    const idx = g.node('list.get', { id: 'idx', inputs: { index: 0 } });
    const p2 = g.node('io.print', { id: 'p2' });
    g.chain(s, app, fe);
    g.wire('get.value', 'app.list');
    g.wire('get.value', 'fe.list');
    g.wire('fe.body', 'p.exec');
    g.wire('fe.item', 'p.value');
    g.wire('fe.done', 'p2.exec');
    g.wire('get.value', 'idx.list');
    g.wire('idx.result', 'p2.value');
    const r = compile(g.doc({ variables: [{ name: 'items', type: 'list', value: [1, 2, 3] }] }));
    expect(r.code).toContain('items = [1, 2, 3]\n');
    expect(startBody(r.code)).toEqual(['items.append(4)', 'for item in items:', '    print(item)', 'print(items[0])']);
    void idx;
  });

  test('input, read and write file', () => {
    const g = new GB();
    const s = g.node('event.start');
    const inp = g.node('io.input', { id: 'inp', inputs: { prompt: 'Name? ' } });
    const wf = g.node('io.write_file', { id: 'wf', inputs: { path: 'out.txt' } });
    const rf = g.node('io.read_file', { id: 'rf', inputs: { path: 'out.txt' } });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, inp, wf, rf, p);
    g.wire('inp.text', 'wf.content');
    g.wire('rf.content', 'p.value');
    expect(startBody(compile(g.doc()).code)).toEqual([
      'answer = input("Name? ")',
      'with open("out.txt", "w", encoding="utf-8") as _file:',
      '    _file.write(str(answer))',
      'with open("out.txt", encoding="utf-8") as _file:',
      '    content = _file.read()',
      'print(content)'
    ]);
  });

  test('output variable names are unique and never shadow builtins or variables', () => {
    const g = new GB();
    const s = g.node('event.start');
    const a = g.node('io.input', { id: 'a' });
    const b = g.node('io.input', { id: 'b' });
    const c = g.node('flow.for', { id: 'c' });
    g.chain(s, a, b, c);
    const r = compile(g.doc({ variables: [{ name: 'answer', type: 'string', value: '' }, { name: 'print', type: 'number', value: 1 }] }));
    expect(r.code).toContain('answer = ""\nprint_ = 1\n');
    expect(startBody(r.code)).toEqual([
      'answer_2 = input("> ")',
      'answer_3 = input("> ")',
      'for i in range(0, 10):',
      '    pass'
    ]);
  });

  test('set var declares global and outputs the variable', () => {
    const g = new GB();
    const s = g.node('event.start');
    const set = g.node('var.set', { id: 'set', params: { var: 'score' }, inputs: { value: 5 } });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, set, p);
    g.wire('set.value', 'p.value');
    const r = compile(g.doc({ variables: [{ name: 'score', type: 'number', value: 0 }] }));
    expect(startBody(r.code)).toEqual(['global score', 'score = 5', 'print(score)']);
  });

  test('python code block binds inputs and exposes outputs', () => {
    const g = new GB();
    const s = g.node('event.start');
    const py = g.node('python.code', {
      id: 'py',
      params: { code: '  result = a * 2\n  if result > 3:\n      score = result\n' },
      inputs: { a: 21 },
      data: { pyInputs: [{ name: 'a', type: 'number' }], pyOutputs: [{ name: 'result', type: 'number' }] }
    });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, py, p);
    g.wire('py.result', 'p.value');
    const r = compile(g.doc({ variables: [{ name: 'score', type: 'number', value: 0 }] }));
    expect(startBody(r.code)).toEqual(['global score', 'a = 21', 'result = a * 2', 'if result > 3:', '    score = result', 'print(result)']);
    expect(new Set(r.sourceMap.nodeLines.py.length ? ['ok'] : [])).toEqual(new Set(['ok']));
  });

  test('timer events produce a scheduler', () => {
    const g = new GB();
    const t = g.node('event.timer', { id: 't', params: { interval: 0.5 } });
    const p = g.node('io.print', { id: 'p', inputs: { value: 'tick' } });
    g.chain(t, p);
    const r = compile(g.doc());
    expect(r.code).toContain('import time\n');
    expect(r.code).toContain('def run_timers(timers):');
    expect(r.code).toContain('def on_timer():\n    print("tick")');
    expect(r.code.trimEnd().endsWith('run_timers([(0.5, on_timer)])')).toBe(true);
  });

  test('several start events run top to bottom', () => {
    const g = new GB();
    const s1 = g.node('event.start', { id: 's1', y: 300 });
    const s2 = g.node('event.start', { id: 's2', y: 0 });
    const p1 = g.node('io.print', { inputs: { value: 'lower' } });
    const p2 = g.node('io.print', { inputs: { value: 'upper' } });
    g.chain(s1, p1);
    g.chain(s2, p2);
    const code = compile(g.doc()).code;
    expect(code).toContain('def on_start():\n    print("upper")');
    expect(code).toContain('def on_start_2():\n    print("lower")');
    expect(code).toContain('    on_start()\n    on_start_2()\n');
  });

  test('user functions compile to def + call', () => {
    const fg = new GB();
    const entry = fg.node('fn.entry', { id: 'entry' });
    const add = fg.node('math.add', { id: 'fadd' });
    const ret = fg.node('fn.return', { id: 'ret' });
    fg.chain(entry, ret);
    fg.wire('entry.x', 'fadd.a');
    fg.wire('entry.y', 'fadd.b');
    fg.wire('fadd.result', 'ret.sum');
    const g = new GB();
    const s = g.node('event.start');
    const call = g.node('fn.call', { id: 'call', params: { fn: 'f1' }, inputs: { x: 2, y: 3 } });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, call, p);
    g.wire('call.sum', 'p.value');
    const r = compile(
      g.doc({
        functions: [
          {
            id: 'f1',
            name: 'add numbers',
            inputs: [
              { name: 'x', type: 'number' },
              { name: 'y', type: 'number' }
            ],
            outputs: [{ name: 'sum', type: 'number' }],
            graph: fg.graph()
          }
        ]
      })
    );
    expect(errors(r)).toEqual([]);
    expect(r.code).toContain('def add_numbers(x, y):\n    return x + y\n');
    expect(startBody(r.code)).toEqual(['sum_ = add_numbers(2, 3)', 'print(sum_)']);
    expect(r.sourceMap.graphOf.ret).toBe('f1');
    void add;
  });
});

describe('problems', () => {
  test('missing required input', () => {
    const g = new GB();
    const s = g.node('event.start');
    const app = g.node('list.append', { id: 'app' });
    g.chain(s, app);
    expect(errors(compile(g.doc()))).toContainEqual(expect.objectContaining({ nodeId: 'app' }));
  });

  test('data cycle is reported, not looped forever', () => {
    const g = new GB();
    const s = g.node('event.start');
    g.node('math.add', { id: 'a' });
    g.node('math.add', { id: 'b' });
    const p = g.node('io.print', { id: 'p' });
    g.chain(s, p);
    g.wire('a.result', 'b.a');
    g.wire('b.result', 'a.a');
    g.wire('a.result', 'p.value');
    const r = compile(g.doc());
    expect(errors(r).some((e) => e.msg.includes('Цикл в потоке данных'))).toBe(true);
    expect(r.code).toContain('raise RuntimeError');
  });

  test('exec cycle is reported', () => {
    const g = new GB();
    const s = g.node('event.start');
    const a = g.node('io.print', { id: 'a' });
    const b = g.node('io.print', { id: 'b' });
    g.chain(s, a, b);
    g.wire('b.then', 'a.exec');
    const r = compile(g.doc());
    const cyc = errors(r).filter((e) => e.msg.includes('exec'));
    expect(cyc.map((e) => e.nodeId).sort()).toEqual(['a', 'b']);
  });

  test('unknown variable and unreachable blocks', () => {
    const g = new GB();
    const s = g.node('event.start');
    const set = g.node('var.set', { id: 'set', params: { var: 'ghost' } });
    g.node('io.print', { id: 'lonely' });
    g.chain(s, set);
    const r = compile(g.doc());
    expect(errors(r)).toContainEqual(expect.objectContaining({ nodeId: 'set' }));
    expect(r.problems).toContainEqual(expect.objectContaining({ nodeId: 'lonely', severity: 'warning' }));
  });

  test('no start block is a warning and still valid python', () => {
    const r = compile(new GB().doc());
    expect(r.problems[0].severity).toBe('warning');
    expect(r.code).toContain('if __name__ == "__main__":\n    pass');
  });
});

describe('python helpers', () => {
  test('isAtomic', () => {
    for (const s of ['x', 'f(a + b)', 'a.b[1]', '"a b"', '[1, 2]', '42', '3.5', 'x.split(",")']) expect(isAtomic(s), s).toBe(true);
    for (const s of ['a + b', 'not x', '-1', 'f(a) + g(b)', 'a if b else c', 'x == 1']) expect(isAtomic(s), s).toBe(false);
  });

  test('pyIdent', () => {
    expect(pyIdent('my var')).toBe('my_var');
    expect(pyIdent('1st')).toBe('_1st');
    expect(pyIdent('class')).toBe('class_');
    expect(pyIdent('счёт')).toBe('счет');
    expect(pyIdent('!!!')).toBe('value');
  });

  test('pyLiteral', () => {
    expect(pyLiteral([1, 'a', true, null, { k: 2 }])).toBe('[1, "a", True, None, {"k": 2}]');
    expect(pyLiteral(Infinity)).toBe('float("inf")');
  });

  test('elifify only rewrites else blocks that hold a single if', () => {
    const L = (indent: number, text: string) => ({ indent, text });
    const keep = [L(0, 'if a:'), L(1, 'x()'), L(0, 'else:'), L(1, 'if b:'), L(2, 'y()'), L(1, 'z()')];
    expect(elifify(keep)).toEqual(keep);
    const rewrite = [L(0, 'if a:'), L(1, 'x()'), L(0, 'else:'), L(1, 'if b:'), L(2, 'y()'), L(1, 'else:'), L(2, 'z()')];
    expect(elifify(rewrite).map((l) => `${'  '.repeat(l.indent)}${l.text}`)).toEqual(['if a:', '  x()', 'elif b:', '  y()', 'else:', '  z()']);
  });
});
