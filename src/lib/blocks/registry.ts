// Block registry: builtin declarative definitions + user blocks from
// ~/.local/share/nodus/blocks/*.json.
import type { BlockDef, Category, DataType, PortType } from '../types';
import { DATA_TYPES } from '../types';

export interface CategoryMeta {
  id: Category;
  label: string;
  color: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { id: 'events', label: 'События', color: '#e5484d' },
  { id: 'flow', label: 'Поток', color: '#7c8aa5' },
  { id: 'variables', label: 'Переменные', color: '#30a46c' },
  { id: 'math', label: 'Математика', color: '#3e8ed0' },
  { id: 'logic', label: 'Логика', color: '#c2410c' },
  { id: 'strings', label: 'Строки', color: '#d6409f' },
  { id: 'lists', label: 'Списки', color: '#c9a20a' },
  { id: 'io', label: 'Ввод/вывод', color: '#12a594' },
  { id: 'functions', label: 'Функции', color: '#8e4ec6' },
  { id: 'python', label: 'Python', color: '#e0a100' },
  { id: 'custom', label: 'Пользовательские', color: '#6e56cf' }
];

export const PORT_COLORS: Record<PortType, string> = {
  exec: '#f4f4f5',
  number: '#4fc3f7',
  string: '#f472b6',
  bool: '#ef4444',
  list: '#facc15',
  any: '#9ca3af'
};

export function categoryColor(cat: string): string {
  return CATEGORIES.find((c) => c.id === cat)?.color ?? '#6e56cf';
}

const builtinModules = import.meta.glob<{ default: BlockDef }>('./defs/*.json', { eager: true });

const registry = new Map<string, BlockDef>();
let userErrors: string[] = [];
let userDir = '';

for (const mod of Object.values(builtinModules)) {
  const def = { ...mod.default, source: 'builtin' as const };
  registry.set(def.id, def);
}

const PORT_TYPES = new Set<string>([...DATA_TYPES, 'exec']);
const TOKEN_RE = /\{\??(in|raw|int|opt|out|exec|name|param|text)\.([A-Za-z_][\w]*)\}|\{(join|python|call|return)\}/g;

/** Validates a (user supplied) block definition; returns a list of problems. */
export function validateBlockDef(raw: unknown): string[] {
  const errs: string[] = [];
  if (!raw || typeof raw !== 'object') return ['определение должно быть JSON-объектом'];
  const d = raw as Record<string, unknown>;
  if (typeof d.id !== 'string' || !/^[\w.-]+$/.test(d.id)) errs.push('поле "id" обязательно (буквы, цифры, . _ -)');
  if (typeof d.title !== 'string') errs.push('поле "title" обязательно');
  if (!['exec', 'pure', 'event'].includes(d.kind as string)) errs.push('"kind" должен быть exec | pure | event');
  for (const key of ['inputs', 'outputs'] as const) {
    if (d[key] === undefined) continue;
    if (!Array.isArray(d[key])) {
      errs.push(`"${key}" должен быть массивом`);
      continue;
    }
    const seen = new Set<string>();
    for (const p of d[key] as Record<string, unknown>[]) {
      if (typeof p?.id !== 'string' || !/^[A-Za-z_]\w*$/.test(p.id)) errs.push(`${key}: некорректный id порта`);
      else if (seen.has(p.id)) errs.push(`${key}: повторяющийся порт "${p.id}"`);
      else seen.add(p.id);
      if (!PORT_TYPES.has(p?.type as string)) errs.push(`${key}.${p?.id}: неизвестный тип "${p?.type}"`);
    }
  }
  if (d.kind === 'pure') {
    if (!d.expr || typeof d.expr !== 'object') errs.push('pure-блоку нужно поле "expr": {выход: шаблон}');
    if (Array.isArray(d.inputs) && d.inputs.some((p: { type: string }) => p.type === 'exec'))
      errs.push('pure-блок не может иметь exec-входов');
  } else if (typeof d.code !== 'string') {
    errs.push('exec/event-блоку нужно поле "code" (шаблон Python)');
  }
  const templates = [d.code, ...Object.values((d.expr as Record<string, unknown>) ?? {})].filter(
    (t): t is string => typeof t === 'string'
  );
  for (const t of templates) {
    for (const m of t.matchAll(TOKEN_RE)) {
      if (m[1] === 'exec' && Array.isArray(d.outputs) && !d.outputs.some((p: { id: string }) => p.id === m[2]))
        errs.push(`шаблон ссылается на неизвестный exec-выход "${m[2]}"`);
    }
  }
  return errs;
}

function normalize(d: BlockDef, source: 'builtin' | 'user'): BlockDef {
  return {
    ...d,
    category: (d.category as string) && CATEGORIES.some((c) => c.id === d.category) ? d.category : 'custom',
    icon: d.icon || 'box',
    inputs: d.inputs ?? [],
    outputs: d.outputs ?? [],
    params: d.params ?? [],
    source
  };
}

/** Registers user blocks; returns per-file errors. Re-registering replaces older user blocks. */
export function registerUserBlocks(files: { name: string; content: string }[], dir = ''): string[] {
  for (const [id, def] of registry) if (def.source === 'user') registry.delete(id);
  userErrors = [];
  userDir = dir;
  for (const f of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(f.content);
    } catch (e) {
      userErrors.push(`${f.name}: некорректный JSON (${(e as Error).message})`);
      continue;
    }
    const errs = validateBlockDef(parsed);
    if (errs.length) {
      userErrors.push(...errs.map((e) => `${f.name}: ${e}`));
      continue;
    }
    const def = normalize(parsed as BlockDef, 'user');
    if (registry.get(def.id)?.source === 'builtin') {
      userErrors.push(`${f.name}: id "${def.id}" занят встроенным блоком`);
      continue;
    }
    registry.set(def.id, def);
  }
  return userErrors;
}

export const getUserBlockErrors = () => userErrors;
export const getUserBlocksDir = () => userDir;

export function getBlock(id: string): BlockDef | undefined {
  return registry.get(id);
}

export function allBlocks(): BlockDef[] {
  return [...registry.values()];
}

export function paletteBlocks(): BlockDef[] {
  return allBlocks().filter((b) => !b.hidden);
}

export function isDataType(t: string): t is DataType {
  return (DATA_TYPES as string[]).includes(t);
}
