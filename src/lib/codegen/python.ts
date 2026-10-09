// Python literal / identifier helpers.

export const PY_KEYWORDS = new Set([
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
  'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal',
  'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'match', 'case', 'type'
]);

/** Builtins we refuse to shadow with generated names. */
export const PY_RESERVED = new Set([
  ...PY_KEYWORDS,
  'print', 'input', 'len', 'range', 'str', 'int', 'float', 'bool', 'list', 'dict', 'set', 'tuple', 'open', 'random',
  'min', 'max', 'sum', 'abs', 'round', 'sorted', 'map', 'filter', 'zip', 'enumerate', 'object', 'id', 'iter', 'next',
  'run_timers', 'time', 'math', 'sys', 'os', 'json'
]);

/** Makes an arbitrary string a valid, readable Python identifier. */
export function pyIdent(raw: string, fallback = 'value'): string {
  let s = String(raw ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[^\p{L}\p{N}_]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = fallback;
  if (/^\p{N}/u.test(s)) s = `_${s}`;
  if (PY_KEYWORDS.has(s)) s = `${s}_`;
  return s;
}

export function pyStr(s: string): string {
  // JSON string escapes (\n, \t, \", \\, \uXXXX) are valid Python escapes too.
  return JSON.stringify(s);
}

export function pyNumber(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n);
  if (Number.isNaN(v)) return 'float("nan")';
  if (!Number.isFinite(v)) return v > 0 ? 'float("inf")' : '-float("inf")';
  return String(v);
}

export function pyLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'number') return pyNumber(v);
  if (typeof v === 'string') return pyStr(v);
  if (Array.isArray(v)) return `[${v.map(pyLiteral).join(', ')}]`;
  if (typeof v === 'object')
    return `{${Object.entries(v as Record<string, unknown>)
      .map(([k, x]) => `${pyStr(k)}: ${pyLiteral(x)}`)
      .join(', ')}}`;
  return 'None';
}

/**
 * True when `code` can be used as an operand without parentheses:
 * names, attribute/call/subscript chains, literals, bracketed displays.
 */
export function isAtomic(code: string): boolean {
  const s = code.trim();
  if (!s) return true;
  if (/^-/.test(s)) return false;
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (depth === 0 && /[\s+\-*/%<>=!&|^~,@:]/.test(c)) return false;
  }
  return true;
}

export const wrap = (code: string) => (isAtomic(code) ? code : `(${code})`);
