<script lang="ts">
  import type { BlockDef, DataType } from '../types';
  import { DATA_TYPES } from '../types';
  import { CATEGORIES, PORT_COLORS, paletteBlocks } from '../blocks/registry';
  import { editor } from '../stores/editor.svelte';
  import { ui } from '../stores/ui.svelte';
  import Icon from './Icon.svelte';
  import InlineValue from './InlineValue.svelte';

  let query = $state('');
  let collapsed = $state<Record<string, boolean>>({});

  let blocks = $derived((editor.blocksVersion, paletteBlocks()));
  let filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return blocks;
    return blocks.filter((b) => b.title.toLowerCase().includes(q) || b.id.toLowerCase().includes(q) || (b.description ?? '').toLowerCase().includes(q));
  });
  let groups = $derived(
    CATEGORIES.map((c) => ({ ...c, blocks: filtered.filter((b) => b.category === c.id) })).filter((g) => g.blocks.length)
  );

  function dragStart(e: DragEvent, block: string, data?: Record<string, unknown>) {
    e.dataTransfer?.setData('application/x-nodus-block', JSON.stringify({ block, data }));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy';
  }

  function add(def: BlockDef) {
    const c = editor.viewCenter();
    editor.addBlock(def.id, { x: c.x - 80, y: c.y - 30 });
  }

  function addVarBlock(name: string, set: boolean) {
    const c = editor.viewCenter();
    editor.addBlock(set ? 'var.set' : 'var.get', { x: c.x - 80, y: c.y - 30 }, { params: { var: name } } as never);
  }

  function addCall(fnId: string) {
    const c = editor.viewCenter();
    editor.addBlock('fn.call', { x: c.x - 80, y: c.y - 30 }, { params: { fn: fnId } } as never);
  }
</script>

<aside class="sidebar glass">
  <nav class="tabs">
    <button class:on={ui.sideTab === 'blocks'} onclick={() => (ui.sideTab = 'blocks')} title="Палитра блоков"><Icon name="blocks" size={13} /> Блоки</button>
    <button class:on={ui.sideTab === 'variables'} onclick={() => (ui.sideTab = 'variables')} title="Переменные"
      ><Icon name="variable" size={13} /> Данные{#if editor.doc.variables.length}<span class="n">{editor.doc.variables.length}</span>{/if}</button
    >
    <button class:on={ui.sideTab === 'functions'} onclick={() => (ui.sideTab = 'functions')} title="Функции"
      ><Icon name="square-function" size={13} /> Функции{#if editor.doc.functions.length}<span class="n">{editor.doc.functions.length}</span>{/if}</button
    >
  </nav>

  {#if ui.sideTab === 'blocks'}
    <div class="search">
      <Icon name="search" size={13} />
      <input class="field" placeholder="Поиск блоков…" bind:value={query} spellcheck="false" />
    </div>
    <div class="scroll">
      {#each groups as g (g.id)}
        <section>
          <button class="cat" onclick={() => (collapsed[g.id] = !collapsed[g.id])}>
            <span class="dot" style="background:{g.color}"></span>
            {g.label}
            <span class="count">{g.blocks.length}</span>
            <span class="chev" class:closed={collapsed[g.id] && !query}><Icon name="chevron-down" size={12} /></span>
          </button>
          {#if !collapsed[g.id] || query}
            <div class="items">
              {#each g.blocks as b (b.id)}
                <button
                  class="item"
                  draggable="true"
                  ondragstart={(e) => dragStart(e, b.id)}
                  ondblclick={() => add(b)}
                  title={`${b.description ?? b.title}\n\nПеретащите на холст или дважды щёлкните`}
                  style="--cat:{g.color}"
                >
                  <span class="ico"><Icon name={b.icon} size={13} /></span>
                  <span class="name">{b.title}</span>
                  {#if b.source === 'user'}<span class="user">user</span>{/if}
                </button>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
      {#if !groups.length}<p class="empty">Ничего не найдено</p>{/if}
      <p class="hint">
        Свои блоки: <span class="mono">{editor.userBlocksDir || '~/.local/share/nodus/blocks'}</span>
        <button class="btn ghost small" onclick={() => editor.loadUserBlocks()}><Icon name="refresh-cw" size={12} /></button>
      </p>
    </div>
  {:else if ui.sideTab === 'variables'}
    <div class="scroll pad">
      <button class="btn primary wide" onclick={() => editor.addVariable()}><Icon name="plus" /> Переменная</button>
      {#each editor.doc.variables as v (v.name)}
        <div class="var" style="--pc:{PORT_COLORS[v.type]}">
          <div class="var-head">
            <span class="dot" style="background:var(--pc)"></span>
            <input
              class="field mono vname"
              value={v.name}
              onchange={(e) => editor.renameVariable(v.name, e.currentTarget.value)}
              spellcheck="false"
            />
            <select class="field" value={v.type} onchange={(e) => editor.setVariable(v.name, { type: e.currentTarget.value as DataType })}>
              {#each DATA_TYPES as t (t)}<option value={t}>{t}</option>{/each}
            </select>
            <button class="btn icon ghost danger" title="Удалить" onclick={() => editor.deleteVariable(v.name)}><Icon name="trash-2" size={13} /></button>
          </div>
          <div class="var-row">
            <span class="muted">Начальное</span>
            {#if v.type === 'list'}
              <input
                class="field mono"
                value={JSON.stringify(v.value ?? [])}
                onchange={(e) => {
                  try {
                    editor.setVariable(v.name, { value: JSON.parse(e.currentTarget.value) });
                  } catch {
                    ui.toast('Список задаётся в JSON: [1, 2, "a"]', 'error');
                  }
                }}
              />
            {:else}
              <InlineValue type={v.type} value={v.value} onchange={(val) => editor.setVariable(v.name, { value: val })} />
            {/if}
          </div>
          <div class="var-row">
            <button class="chip" draggable="true" ondragstart={(e) => dragStart(e, 'var.get', { params: { var: v.name } })} onclick={() => addVarBlock(v.name, false)}>Get</button>
            <button class="chip" draggable="true" ondragstart={(e) => dragStart(e, 'var.set', { params: { var: v.name } })} onclick={() => addVarBlock(v.name, true)}>Set</button>
          </div>
        </div>
      {/each}
      {#if !editor.doc.variables.length}<p class="empty">Переменных пока нет. Они видны во всех событиях и функциях.</p>{/if}
    </div>
  {:else}
    <div class="scroll pad">
      <button class="btn primary wide" onclick={() => editor.createFunction()}><Icon name="plus" /> Функция</button>
      <button class="btn wide" disabled={!editor.selectedNodes.length} onclick={() => editor.collapseSelection()}>
        <Icon name="package" /> Свернуть выделение <span class="kbd">Ctrl+G</span>
      </button>
      <button class="fnrow" class:on={editor.graphId === 'main'} onclick={() => editor.switchGraph('main')}>
        <Icon name="workflow" size={13} /> Основной граф
      </button>
      {#each editor.doc.functions as f (f.id)}
        <div class="fnrow" class:on={editor.graphId === f.id}>
          <button class="fnname" ondblclick={() => editor.switchGraph(f.id)} onclick={() => editor.switchGraph(f.id)} draggable="true" ondragstart={(e) => dragStart(e, 'fn.call', { params: { fn: f.id } })}>
            <Icon name="square-function" size={13} />
            <span class="mono">{f.name}({f.inputs.map((p) => p.name).join(', ')})</span>
          </button>
          <button class="btn icon ghost" title="Добавить вызов" onclick={() => addCall(f.id)}><Icon name="plus" size={13} /></button>
          <button class="btn icon ghost danger" title="Удалить функцию" onclick={() => editor.deleteFunction(f.id)}><Icon name="trash-2" size={13} /></button>
        </div>
      {/each}
      <p class="hint">Перетащите функцию на холст, чтобы вызвать её. Порты функции настраиваются в инспекторе, когда она открыта.</p>
    </div>
  {/if}
</aside>

<style>
  .sidebar {
    display: flex;
    flex-direction: column;
    height: 100%;
    border-radius: 14px;
    overflow: hidden;
  }
  .tabs {
    display: flex;
    padding: 6px;
    gap: 4px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    height: 28px;
    white-space: nowrap;
    border-radius: 8px;
    border: none;
    background: none;
    color: var(--muted);
    font-size: 11.5px;
    cursor: pointer;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  .tabs button:hover {
    color: var(--text);
  }
  .tabs .n {
    font-size: 10px;
    padding: 0 4px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.08);
  }
  .tabs button.on {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .search {
    position: relative;
    display: flex;
    align-items: center;
    padding: 8px 8px 4px;
    color: var(--muted);
  }
  .search :global(svg) {
    position: absolute;
    left: 17px;
  }
  .search .field {
    width: 100%;
    padding-left: 28px;
    height: 30px;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    padding: 4px 6px 10px;
  }
  .scroll.pad {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cat {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 6px 4px;
    border: none;
    background: none;
    color: var(--text-2);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    cursor: pointer;
  }
  .cat .count {
    margin-left: auto;
    font-weight: 500;
    color: var(--muted);
  }
  .chev {
    display: grid;
    transition: transform var(--dur) var(--ease);
  }
  .chev.closed {
    transform: rotate(-90deg);
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
  }
  .items {
    display: flex;
    flex-direction: column;
    gap: 1px;
    animation: fade 200ms var(--ease);
  }
  .item {
    display: flex;
    align-items: center;
    gap: 9px;
    height: 30px;
    padding: 0 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: none;
    text-align: left;
    cursor: grab;
    transition:
      background var(--dur) var(--ease),
      border-color var(--dur) var(--ease),
      transform var(--dur) var(--ease);
  }
  .item:hover {
    background: color-mix(in srgb, var(--cat) 12%, transparent);
    border-color: color-mix(in srgb, var(--cat) 30%, transparent);
    transform: translateX(2px);
  }
  .item .ico {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--cat) 30%, transparent);
    color: #fff;
  }
  .item .name {
    flex: 1;
  }
  .user {
    font-size: 9.5px;
    padding: 0 5px;
    border-radius: 4px;
    background: rgba(110, 86, 207, 0.3);
  }
  .empty,
  .hint {
    color: var(--muted);
    font-size: 11.5px;
    padding: 6px;
    line-height: 1.5;
  }
  .hint .mono {
    font-size: 10.5px;
    word-break: break-all;
  }
  .btn.small {
    height: 20px;
    padding: 0 4px;
  }
  .wide {
    width: 100%;
    justify-content: center;
  }
  .var {
    padding: 8px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.02);
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: fade 200ms var(--ease);
  }
  .var-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .vname {
    flex: 1;
    color: var(--pc);
  }
  .var-head select {
    width: 72px;
  }
  .var-row {
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: space-between;
  }
  .var-row .field {
    flex: 1;
  }
  .muted {
    color: var(--muted);
    font-size: 11.5px;
  }
  .chip {
    flex: 1;
    height: 24px;
    border-radius: 6px;
    border: 1px dashed color-mix(in srgb, var(--pc) 50%, transparent);
    background: color-mix(in srgb, var(--pc) 8%, transparent);
    cursor: grab;
    font-size: 11.5px;
  }
  .fnrow {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    border-radius: 8px;
    border: 1px solid transparent;
    background: none;
    color: var(--text-2);
    cursor: pointer;
    text-align: left;
  }
  .fnrow.on {
    border-color: rgba(142, 78, 198, 0.5);
    background: rgba(142, 78, 198, 0.12);
    color: var(--text);
  }
  .fnname {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    overflow: hidden;
  }
  .fnname span {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 11.5px;
  }
  @keyframes fade {
    from {
      opacity: 0;
      transform: translateY(-3px);
    }
  }
</style>
