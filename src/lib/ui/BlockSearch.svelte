<script lang="ts">
  import { tick } from 'svelte';
  import type { BlockData, GNode } from '../types';
  import { categoryColor, getBlock, paletteBlocks, PORT_COLORS } from '../blocks/registry';
  import { resolvePorts } from '../blocks/ports';
  import { typesCompatible } from '../graph/compat';
  import { editor } from '../stores/editor.svelte';
  import { ui } from '../stores/ui.svelte';
  import Icon from './Icon.svelte';
  import { fuzzyScore } from './fuzzy';

  interface Entry {
    key: string;
    title: string;
    sub: string;
    block: string;
    icon: string;
    color: string;
    data?: Partial<BlockData>;
  }

  let query = $state('');
  let index = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLDivElement | undefined = $state();
  let req = $derived(ui.search);

  let entries = $derived.by((): Entry[] => {
    void editor.blocksVersion;
    const out: Entry[] = [];
    for (const b of paletteBlocks()) {
      if (b.dynamic === 'var-get' || b.dynamic === 'var-set') continue;
      out.push({ key: b.id, title: b.title, sub: b.description ?? b.id, block: b.id, icon: b.icon, color: categoryColor(b.category) });
    }
    for (const v of editor.doc.variables) {
      for (const set of [false, true])
        out.push({
          key: `${set ? 'set' : 'get'}:${v.name}`,
          title: `${set ? 'Set' : 'Get'} ${v.name}`,
          sub: `переменная · ${v.type}`,
          block: set ? 'var.set' : 'var.get',
          icon: set ? 'pencil' : 'variable',
          color: categoryColor('variables'),
          data: { params: { var: v.name } }
        });
    }
    if (!editor.doc.variables.length) {
      out.push({ key: 'var.get', title: 'Get Var', sub: 'сначала создайте переменную', block: 'var.get', icon: 'variable', color: categoryColor('variables') });
      out.push({ key: 'var.set', title: 'Set Var', sub: 'сначала создайте переменную', block: 'var.set', icon: 'pencil', color: categoryColor('variables') });
    }
    for (const f of editor.doc.functions) {
      if (f.id === editor.graphId) continue;
      out.push({ key: `fn:${f.id}`, title: f.name, sub: 'функция', block: 'fn.call', icon: 'square-function', color: categoryColor('functions'), data: { params: { fn: f.id } } });
    }
    if (editor.currentFn) {
      out.push({ key: 'fn.return', title: 'Return', sub: 'выход из функции', block: 'fn.return', icon: 'log-out', color: categoryColor('functions') });
    }
    return out;
  });

  function compatible(e: Entry): boolean {
    const from = req?.from;
    if (!from) return true;
    const def = getBlock(e.block);
    if (!def) return false;
    const node = editor.makeBlockNode(e.block, { x: 0, y: 0 }, e.data) as GNode;
    const ports = resolvePorts(node, editor.portCtx);
    if (from.type === 'source') return ports.inputs.some((p) => typesCompatible(from.portType, p.type));
    return ports.outputs.some((p) => typesCompatible(p.type, from.portType));
  }

  let results = $derived(
    entries
      .filter(compatible)
      .map((e) => ({ e, s: Math.max(fuzzyScore(e.title, query), fuzzyScore(e.sub, query) * 0.6) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 60)
      .map((r) => r.e)
  );

  $effect(() => {
    if (req) {
      query = '';
      index = 0;
      tick().then(() => input?.focus());
    }
  });

  $effect(() => {
    void query;
    index = 0;
  });

  function choose(e: Entry | undefined) {
    if (!e || !req) return;
    const pos = { x: req.flow.x, y: req.flow.y - 20 };
    if (req.from) editor.addBlockConnected(e.block, req.from.type === 'source' ? pos : { x: pos.x - 200, y: pos.y }, req.from, e.data);
    else editor.addBlock(e.block, pos, e.data);
    ui.search = null;
  }

  function onKey(ev: KeyboardEvent) {
    if (ev.key === 'ArrowDown') index = Math.min(results.length - 1, index + 1);
    else if (ev.key === 'ArrowUp') index = Math.max(0, index - 1);
    else if (ev.key === 'Enter') choose(results[index]);
    else if (ev.key === 'Escape') ui.search = null;
    else return;
    ev.preventDefault();
    tick().then(() => list?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }));
  }

  let pos = $derived.by(() => {
    if (!req) return { left: 0, top: 0 };
    const w = 320;
    const h = 380;
    return { left: Math.min(req.x, window.innerWidth - w - 12), top: Math.min(req.y, window.innerHeight - h - 12) };
  });
</script>

{#if req}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="backdrop" onclick={() => (ui.search = null)} oncontextmenu={(e) => (e.preventDefault(), (ui.search = null))}></div>
  <div class="search glass" style="left:{pos.left}px; top:{pos.top}px">
    <div class="head">
      <Icon name="search" size={14} />
      <input bind:this={input} bind:value={query} onkeydown={onKey} placeholder="Найти блок…" spellcheck="false" />
      {#if req.from}
        <span class="filter" style="--pc:{PORT_COLORS[req.from.portType]}"><span class="dot"></span>{req.from.portType}</span>
      {/if}
    </div>
    <div class="list" bind:this={list}>
      {#each results as r, i (r.key)}
        <button class="row" class:sel={i === index} onmouseenter={() => (index = i)} onclick={() => choose(r)} style="--cat:{r.color}">
          <span class="ico"><Icon name={r.icon} size={13} /></span>
          <span class="t">{r.title}</span>
          <span class="s">{r.sub}</span>
        </button>
      {:else}
        <div class="empty">Нет подходящих блоков</div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
  }
  .search {
    position: fixed;
    z-index: 91;
    width: 320px;
    max-height: 380px;
    display: flex;
    flex-direction: column;
    border-radius: 12px;
    background: rgba(20, 24, 34, 0.96);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.65);
    animation: pop 180ms var(--ease);
    transform-origin: top left;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 10px;
    height: 40px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
  }
  .head input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 13.5px;
  }
  .filter {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 2px 7px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.05);
    font-size: 11px;
    font-family: var(--mono);
    color: var(--pc);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--pc);
  }
  .list {
    overflow-y: auto;
    padding: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 9px;
    width: 100%;
    height: 32px;
    padding: 0 8px;
    border: none;
    border-radius: 7px;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .row.sel {
    background: color-mix(in srgb, var(--cat) 18%, transparent);
  }
  .ico {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--cat) 35%, transparent);
    flex: none;
  }
  .t {
    white-space: nowrap;
  }
  .s {
    flex: 1;
    min-width: 0;
    text-align: right;
    color: var(--muted);
    font-size: 11px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .empty {
    padding: 14px;
    color: var(--muted);
    text-align: center;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: scale(0.96) translateY(-4px);
    }
  }
</style>
