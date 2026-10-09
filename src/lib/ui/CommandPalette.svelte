<script lang="ts">
  import { tick } from 'svelte';
  import { COMMANDS, type Command } from '../commands';
  import { ui } from '../stores/ui.svelte';
  import { fuzzyScore } from './fuzzy';
  import Icon from './Icon.svelte';

  let query = $state('');
  let index = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLDivElement | undefined = $state();

  let results = $derived(
    COMMANDS.filter((c) => !c.id.endsWith('redo2'))
      .map((c) => ({ c, s: Math.max(fuzzyScore(c.title, query), fuzzyScore(c.group, query) * 0.5) }))
      .filter((r) => r.s > 0)
      .sort((a, b) => (query ? b.s - a.s : 0))
      .map((r) => r.c)
  );

  $effect(() => {
    if (ui.commandPalette) {
      query = '';
      index = 0;
      tick().then(() => input?.focus());
    }
  });
  $effect(() => {
    void query;
    index = 0;
  });

  function exec(c: Command | undefined) {
    if (!c) return;
    ui.commandPalette = false;
    if (c.enabled && !c.enabled()) return;
    void c.run();
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') index = Math.min(results.length - 1, index + 1);
    else if (e.key === 'ArrowUp') index = Math.max(0, index - 1);
    else if (e.key === 'Enter') exec(results[index]);
    else if (e.key === 'Escape') ui.commandPalette = false;
    else return;
    e.preventDefault();
    tick().then(() => list?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

{#if ui.commandPalette}
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="overlay" onclick={() => (ui.commandPalette = false)}>
    <div class="palette glass" onclick={(e) => e.stopPropagation()}>
      <div class="head">
        <Icon name="command" size={15} />
        <input bind:this={input} bind:value={query} onkeydown={onKey} placeholder="Введите команду…" spellcheck="false" />
        <span class="kbd">Esc</span>
      </div>
      <div class="list" bind:this={list}>
        {#each results as c, i (c.id)}
          <button class="row" class:sel={i === index} class:off={c.enabled && !c.enabled()} onmouseenter={() => (index = i)} onclick={() => exec(c)}>
            <span class="group">{c.group}</span>
            <span class="title">{c.title}</span>
            {#if c.hotkey}<span class="kbd">{c.hotkey}</span>{/if}
          </button>
        {:else}
          <div class="empty">Команда не найдена</div>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(5, 6, 10, 0.45);
    display: flex;
    justify-content: center;
    padding-top: 12vh;
    animation: fade 160ms var(--ease);
  }
  .palette {
    width: min(620px, 92vw);
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    background: rgba(20, 24, 34, 0.96);
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.7);
    animation: pop 200ms var(--ease);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 50px;
    padding: 0 16px;
    border-bottom: 1px solid var(--border);
    color: var(--muted);
  }
  .head input {
    flex: 1;
    background: none;
    border: none;
    outline: none;
    font-size: 15px;
  }
  .list {
    overflow-y: auto;
    padding: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    height: 36px;
    padding: 0 10px;
    border: none;
    border-radius: 8px;
    background: none;
    text-align: left;
    cursor: pointer;
  }
  .row.sel {
    background: rgba(124, 140, 255, 0.16);
  }
  .row.off {
    opacity: 0.45;
  }
  .group {
    width: 90px;
    color: var(--muted);
    font-size: 11.5px;
  }
  .title {
    flex: 1;
  }
  .empty {
    padding: 18px;
    color: var(--muted);
    text-align: center;
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(-10px) scale(0.98);
    }
  }
</style>
