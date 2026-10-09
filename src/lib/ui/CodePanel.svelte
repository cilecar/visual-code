<script lang="ts">
  import { onMount } from 'svelte';
  import { EditorState, StateEffect, StateField, RangeSet, type Extension } from '@codemirror/state';
  import { EditorView, Decoration, GutterMarker, gutter, lineNumbers, highlightActiveLineGutter, type DecorationSet } from '@codemirror/view';
  import { python } from '@codemirror/lang-python';
  import { HighlightStyle, syntaxHighlighting, bracketMatching } from '@codemirror/language';
  import { tags as t } from '@lezer/highlight';
  import { editor } from '../stores/editor.svelte';
  import { run } from '../runtime/run.svelte';
  import { toggleBreakpoint } from '../commands';
  import { isBlockNode } from '../types';

  let host: HTMLDivElement;
  let view: EditorView | null = null;

  let code = $derived(run.live || (run.status === 'error' && run.code) ? run.code : (editor.validation?.result.code ?? ''));
  let sourceMap = $derived(run.live || (run.status === 'error' && run.sourceMap) ? run.sourceMap : (editor.validation?.result.sourceMap ?? null));
  let bpNodes = $derived(new Set(editor.nodes.filter((n) => isBlockNode(n) && n.data.breakpoint).map((n) => n.id)));
  let bpLines = $derived.by(() => {
    const out: number[] = [];
    if (!sourceMap) return out;
    for (const id of bpNodes) {
      const l = sourceMap.nodeLines[id]?.[0];
      if (l) out.push(l);
    }
    return out.sort((a, b) => a - b);
  });
  let selectedLines = $derived.by(() => {
    const ids = editor.selectedNodes.map((n) => n.id);
    return ids.flatMap((id) => sourceMap?.nodeLines[id] ?? []);
  });

  // ---------------------------------------------------------------- decorations
  const setLines = StateEffect.define<{ active: number | null; error: number | null; selected: number[] }>();
  const activeMark = Decoration.line({ class: 'cm-run-line' });
  const errorMark = Decoration.line({ class: 'cm-error-line' });
  const selMark = Decoration.line({ class: 'cm-sel-line' });

  const lineField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      deco = deco.map(tr.changes);
      for (const e of tr.effects) {
        if (!e.is(setLines)) continue;
        const doc = tr.state.doc;
        const marks: { at: number; d: Decoration }[] = [];
        const add = (line: number | null, d: Decoration) => {
          if (line && line >= 1 && line <= doc.lines) marks.push({ at: doc.line(line).from, d });
        };
        for (const l of e.value.selected) add(l, selMark);
        add(e.value.active, activeMark);
        add(e.value.error, errorMark);
        marks.sort((a, b) => a.at - b.at);
        deco = Decoration.set(marks.map((m) => m.d.range(m.at)));
      }
      return deco;
    },
    provide: (f) => EditorView.decorations.from(f)
  });

  const setBps = StateEffect.define<number[]>();
  class BpMarker extends GutterMarker {
    toDOM() {
      const el = document.createElement('div');
      el.className = 'cm-bp';
      return el;
    }
  }
  const bpMarker = new BpMarker();
  const bpField = StateField.define<RangeSet<GutterMarker>>({
    create: () => RangeSet.empty,
    update(set, tr) {
      set = set.map(tr.changes);
      for (const e of tr.effects) {
        if (!e.is(setBps)) continue;
        const doc = tr.state.doc;
        set = RangeSet.of(e.value.filter((l) => l <= doc.lines).map((l) => bpMarker.range(doc.line(l).from)));
      }
      return set;
    }
  });

  function nodeAtLine(line: number): string | undefined {
    return sourceMap?.lines[line];
  }

  const bpGutter = gutter({
    class: 'cm-bp-gutter',
    markers: (v) => v.state.field(bpField),
    initialSpacer: () => bpMarker,
    domEventHandlers: {
      mousedown(v, block) {
        const line = v.state.doc.lineAt(block.from).number;
        const node = nodeAtLine(line);
        if (node) toggleBreakpoint(node);
        return true;
      }
    }
  });

  const theme = EditorView.theme(
    {
      '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'transparent', color: '#d7dcf0' },
      '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.6', fontVariantLigatures: 'none' },
      '.cm-content': { caretColor: '#7c8cff', padding: '8px 0' },
      '.cm-gutters': { backgroundColor: 'transparent', border: 'none', color: '#4b5165' },
      '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 4px', minWidth: '34px' },
      '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#9aa3c7' },
      '.cm-bp-gutter': { width: '18px', cursor: 'pointer' },
      '.cm-bp-gutter .cm-gutterElement': { display: 'flex', alignItems: 'center', justifyContent: 'center' },
      '.cm-bp': { width: '9px', height: '9px', borderRadius: '50%', background: '#ff5a6a', boxShadow: '0 0 6px #ff5a6a' },
      '.cm-run-line': {
        backgroundColor: 'rgba(124, 140, 255, 0.16)',
        boxShadow: 'inset 3px 0 0 #7c8cff',
        transition: 'background-color 150ms'
      },
      '.cm-error-line': { backgroundColor: 'rgba(255, 90, 106, 0.18)', boxShadow: 'inset 3px 0 0 #ff5a6a' },
      '.cm-sel-line': { backgroundColor: 'rgba(255, 255, 255, 0.035)' },
      '&.cm-focused': { outline: 'none' },
      '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(124, 140, 255, 0.25) !important' },
      '.cm-matchingBracket': { backgroundColor: 'rgba(124,140,255,.2)', outline: 'none' }
    },
    { dark: true }
  );

  const highlight = HighlightStyle.define([
    { tag: t.keyword, color: '#c792ea' },
    { tag: [t.controlKeyword, t.definitionKeyword], color: '#c792ea', fontWeight: '500' },
    { tag: t.string, color: '#f9a8d4' },
    { tag: t.number, color: '#4fc3f7' },
    { tag: t.bool, color: '#ff8a8a' },
    { tag: t.null, color: '#ff8a8a' },
    { tag: t.comment, color: '#5c6584', fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#82aaff' },
    { tag: t.definition(t.variableName), color: '#ffcb6b' },
    { tag: t.definition(t.function(t.variableName)), color: '#82aaff', fontWeight: '600' },
    { tag: t.operator, color: '#89ddff' },
    { tag: t.propertyName, color: '#b2ccd6' },
    { tag: t.variableName, color: '#e3e7f7' }
  ]);

  function extensions(): Extension[] {
    return [
      bpField,
      lineField,
      bpGutter,
      lineNumbers(),
      highlightActiveLineGutter(),
      python(),
      syntaxHighlighting(highlight),
      bracketMatching(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      theme,
      EditorView.domEventHandlers({
        click(e, v) {
          const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
          if (pos === null) return false;
          const node = nodeAtLine(v.state.doc.lineAt(pos).number);
          if (node) editor.focusNode(node, sourceMap?.graphOf[node]);
          return false;
        }
      })
    ];
  }

  onMount(() => {
    view = new EditorView({ parent: host, state: EditorState.create({ doc: code, extensions: extensions() }) });
    return () => view?.destroy();
  });

  // content
  $effect(() => {
    const c = code;
    if (!view || view.state.doc.toString() === c) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: c } });
  });

  // breakpoints
  $effect(() => {
    const lines = bpLines;
    void code;
    view?.dispatch({ effects: setBps.of(lines) });
  });

  // active / error / selection lines + autoscroll
  $effect(() => {
    const active = run.live ? run.activeLine : null;
    const error = run.error?.line ?? null;
    const selected = selectedLines;
    void code;
    if (!view) return;
    const effects: StateEffect<unknown>[] = [setLines.of({ active, error, selected })];
    const target = active ?? error;
    if (target && target <= view.state.doc.lines) effects.push(EditorView.scrollIntoView(view.state.doc.line(target).from, { y: 'center' }));
    view.dispatch({ effects });
  });
</script>

<div class="code-panel" bind:this={host}></div>

<style>
  .code-panel {
    height: 100%;
    overflow: hidden;
    user-select: text;
  }
</style>
