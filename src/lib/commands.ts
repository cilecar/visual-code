// Command registry: used by the command palette (Ctrl+K), menus and hotkeys.
import { editor } from './stores/editor.svelte';
import { ui } from './stores/ui.svelte';
import { run } from './runtime/run.svelte';
import { EXAMPLES } from './examples';

export interface Command {
  id: string;
  title: string;
  group: string;
  hotkey?: string;
  run: () => unknown;
  enabled?: () => boolean;
}

const hasSel = () => editor.selectedNodes.length > 0;
const multi = (n: number) => () => editor.selectedNodes.length >= n;

export function toggleBreakpoint(id?: string) {
  editor.toggleBreakpoint(id);
  void run.syncBreakpoints();
}

export function openSearchAtPointer() {
  const p = ui.pointer;
  const el = document.querySelector('.svelte-flow')?.getBoundingClientRect();
  const x = p.overCanvas ? p.x : el ? el.left + el.width / 2 : 400;
  const y = p.overCanvas ? p.y : el ? el.top + el.height / 2 : 300;
  ui.search = { x, y, flow: editor.flow?.screenToFlowPosition({ x, y }) ?? { x: 0, y: 0 } };
}

export const COMMANDS: Command[] = [
  { id: 'file.new', title: 'Новый файл', group: 'Файл', hotkey: 'Ctrl+N', run: () => editor.newFile() },
  { id: 'file.open', title: 'Открыть…', group: 'Файл', hotkey: 'Ctrl+O', run: () => editor.open() },
  { id: 'file.save', title: 'Сохранить', group: 'Файл', hotkey: 'Ctrl+S', run: () => editor.save() },
  { id: 'file.saveAs', title: 'Сохранить как…', group: 'Файл', hotkey: 'Ctrl+Shift+S', run: () => editor.save(true) },

  { id: 'run.run', title: 'Запустить', group: 'Запуск', hotkey: 'F5', run: () => run.start('run') },
  { id: 'run.slow', title: 'Медленный запуск', group: 'Запуск', run: () => run.start('slow') },
  { id: 'run.step', title: 'Шаг', group: 'Запуск', hotkey: 'F10', run: () => run.step() },
  { id: 'run.continue', title: 'Продолжить', group: 'Запуск', hotkey: 'F8', run: () => run.continue(), enabled: () => run.status === 'paused' },
  { id: 'run.pause', title: 'Пауза', group: 'Запуск', run: () => run.pause(), enabled: () => run.status === 'running' },
  { id: 'run.stop', title: 'Остановить', group: 'Запуск', hotkey: 'Shift+F5', run: () => run.stop(), enabled: () => run.live },
  { id: 'run.breakpoint', title: 'Точка останова на блоке', group: 'Запуск', hotkey: 'F9', run: () => toggleBreakpoint(), enabled: hasSel },
  { id: 'run.clear', title: 'Очистить вывод', group: 'Запуск', run: () => run.clearOutput() },

  { id: 'edit.undo', title: 'Отменить', group: 'Правка', hotkey: 'Ctrl+Z', run: () => editor.undo(), enabled: () => editor.canUndo },
  { id: 'edit.redo', title: 'Повторить', group: 'Правка', hotkey: 'Ctrl+Shift+Z', run: () => editor.redo(), enabled: () => editor.canRedo },
  { id: 'edit.redo2', title: 'Повторить', group: 'Правка', hotkey: 'Ctrl+Y', run: () => editor.redo(), enabled: () => editor.canRedo },
  { id: 'edit.copy', title: 'Копировать', group: 'Правка', hotkey: 'Ctrl+C', run: () => editor.copy(), enabled: hasSel },
  { id: 'edit.cut', title: 'Вырезать', group: 'Правка', hotkey: 'Ctrl+X', run: () => editor.copy(true), enabled: hasSel },
  {
    id: 'edit.paste',
    title: 'Вставить',
    group: 'Правка',
    hotkey: 'Ctrl+V',
    run: () => editor.paste(ui.pointer.overCanvas ? editor.flow?.screenToFlowPosition(ui.pointer) : undefined)
  },
  { id: 'edit.duplicate', title: 'Дублировать', group: 'Правка', hotkey: 'Ctrl+D', run: () => editor.duplicate(), enabled: hasSel },
  { id: 'edit.delete', title: 'Удалить', group: 'Правка', hotkey: 'Delete', run: () => editor.deleteSelection() },
  { id: 'edit.selectAll', title: 'Выделить всё', group: 'Правка', hotkey: 'Ctrl+A', run: () => editor.selectAll() },
  { id: 'edit.search', title: 'Добавить блок…', group: 'Правка', hotkey: 'Space', run: openSearchAtPointer },
  { id: 'edit.comment', title: 'Комментарий-фрейм вокруг выделения', group: 'Правка', hotkey: 'C', run: () => editor.addComment() },
  { id: 'edit.collapse', title: 'Свернуть выделение в функцию', group: 'Правка', hotkey: 'Ctrl+G', run: () => editor.collapseSelection(), enabled: hasSel },

  { id: 'layout.left', title: 'Выровнять по левому краю', group: 'Раскладка', run: () => editor.alignSelection('left'), enabled: multi(2) },
  { id: 'layout.right', title: 'Выровнять по правому краю', group: 'Раскладка', run: () => editor.alignSelection('right'), enabled: multi(2) },
  { id: 'layout.top', title: 'Выровнять по верху', group: 'Раскладка', run: () => editor.alignSelection('top'), enabled: multi(2) },
  { id: 'layout.bottom', title: 'Выровнять по низу', group: 'Раскладка', run: () => editor.alignSelection('bottom'), enabled: multi(2) },
  { id: 'layout.hcenter', title: 'Выровнять по центру (горизонтально)', group: 'Раскладка', run: () => editor.alignSelection('hcenter'), enabled: multi(2) },
  { id: 'layout.vcenter', title: 'Выровнять по центру (вертикально)', group: 'Раскладка', run: () => editor.alignSelection('vcenter'), enabled: multi(2) },
  { id: 'layout.distX', title: 'Распределить по горизонтали', group: 'Раскладка', run: () => editor.distributeSelection('x'), enabled: multi(3) },
  { id: 'layout.distY', title: 'Распределить по вертикали', group: 'Раскладка', run: () => editor.distributeSelection('y'), enabled: multi(3) },

  { id: 'view.fit', title: 'Показать всё', group: 'Вид', hotkey: 'F', run: () => editor.flow?.fitView({ padding: 0.2, duration: 250, maxZoom: 1.2 }) },
  {
    id: 'view.snap',
    title: 'Привязка к сетке вкл/выкл',
    group: 'Вид',
    hotkey: 'G',
    run: () => {
      editor.snapToGrid = !editor.snapToGrid;
      ui.toast(`Привязка к сетке ${editor.snapToGrid ? 'включена' : 'выключена'}`);
    }
  },
  { id: 'view.dock', title: 'Показать/скрыть нижнюю панель', group: 'Вид', hotkey: 'Ctrl+J', run: () => (ui.dockOpen = !ui.dockOpen) },
  { id: 'view.code', title: 'Показать код', group: 'Вид', run: () => ((ui.dockOpen = true), (ui.dockTab = 'code')) },
  { id: 'view.main', title: 'Вернуться к основному графу', group: 'Вид', run: () => editor.switchGraph('main'), enabled: () => editor.graphId !== 'main' },
  { id: 'view.palette', title: 'Командная палитра', group: 'Вид', hotkey: 'Ctrl+K', run: () => (ui.commandPalette = true) },

  { id: 'var.new', title: 'Новая переменная', group: 'Переменные', run: () => ((ui.sideTab = 'variables'), editor.addVariable()) },
  { id: 'fn.new', title: 'Новая функция', group: 'Функции', run: () => editor.createFunction() },
  { id: 'blocks.reload', title: 'Перезагрузить пользовательские блоки', group: 'Блоки', run: () => editor.loadUserBlocks() },

  ...EXAMPLES.map((ex) => ({
    id: `example.${ex.id}`,
    title: `Пример: ${ex.name}`,
    group: 'Примеры',
    run: async () => {
      if (await editor.confirmDiscard()) editor.openText(ex.text);
    }
  }))
];

function eventCombo(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  let key = e.key;
  if (key === ' ') key = 'Space';
  else if (key.length === 1) key = key.toUpperCase();
  else if (key === 'Del') key = 'Delete';
  parts.push(key);
  return parts.join('+');
}

/** Keys that work even while typing in a text field / the code editor. */
const GLOBAL = new Set(['F5', 'Shift+F5', 'F8', 'F9', 'F10', 'Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+O', 'Ctrl+N', 'Ctrl+K', 'Ctrl+J']);

export function handleHotkey(e: KeyboardEvent): boolean {
  if (e.repeat && !['Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+Y'].includes(eventCombo(e))) {
    if (!e.key.startsWith('F')) return false;
  }
  const combo = eventCombo(e);
  const t = e.target as HTMLElement | null;
  const typing = !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest('.cm-editor'));
  if (typing && !GLOBAL.has(combo)) return false;
  if (ui.search || ui.commandPalette) {
    if (combo !== 'Ctrl+K') return false;
  }
  // Backspace deletes too (Svelte Flow default), but only on the canvas
  const cmd = COMMANDS.find((c) => c.hotkey === combo) ?? (combo === 'Backspace' ? COMMANDS.find((c) => c.id === 'edit.delete') : undefined);
  if (!cmd) return false;
  if (cmd.enabled && !cmd.enabled()) {
    e.preventDefault();
    return true;
  }
  e.preventDefault();
  void cmd.run();
  return true;
}
