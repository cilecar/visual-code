<script lang="ts">
  import { onMount } from 'svelte';
  import { SvelteFlowProvider } from '@xyflow/svelte';
  import { editor } from './lib/stores/editor.svelte';
  import { ui } from './lib/stores/ui.svelte';
  import { run } from './lib/runtime/run.svelte';
  import * as backend from './lib/runtime/backend';
  import { handleHotkey } from './lib/commands';
  import Toolbar from './lib/ui/Toolbar.svelte';
  import Sidebar from './lib/ui/Sidebar.svelte';
  import Canvas from './lib/ui/Canvas.svelte';
  import Inspector from './lib/ui/Inspector.svelte';
  import Dock from './lib/ui/Dock.svelte';
  import BlockSearch from './lib/ui/BlockSearch.svelte';
  import CommandPalette from './lib/ui/CommandPalette.svelte';
  import Toasts from './lib/ui/Toasts.svelte';
  import Icon from './lib/ui/Icon.svelte';

  let recovery = $state<string | null>(null);

  // handle for end-to-end tests / debugging in dev builds
  if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__nodus = { editor, run, ui };

  $effect(() => {
    void backend.setWindowTitle(editor.title);
  });

  onMount(() => {
    let alive = true;
    (async () => {
      await run.init();
      await editor.loadUserBlocks();
      const cli = await backend.cliFile();
      const saved = await backend.autosaveRead();
      if (!alive) return;
      if (saved) recovery = saved;
      else if (cli) await editor.open(cli);
    })();

    // autosave for crash recovery
    const timer = setInterval(() => void editor.autosave(), 5000);

    void backend.onCloseRequested(async () => {
      if (run.live) await run.stop();
      if (!editor.dirty) {
        await backend.autosaveClear();
        return true;
      }
      const ok = await backend.confirmDialog('Есть несохранённые изменения. Закрыть без сохранения?');
      if (ok) await backend.autosaveClear();
      return ok;
    }, () => editor.dirty);

    return () => {
      alive = false;
      clearInterval(timer);
      run.dispose();
    };
  });

  function restore() {
    if (recovery) {
      try {
        editor.restoreAutosave(recovery);
        ui.toast('Несохранённая работа восстановлена', 'success');
      } catch (e) {
        ui.toast(`Не удалось восстановить: ${e}`, 'error');
      }
    }
    recovery = null;
  }

  function discard() {
    recovery = null;
    void backend.autosaveClear();
  }
</script>

<svelte:window onkeydown={(e) => handleHotkey(e)} />

<SvelteFlowProvider>
  <div class="app" class:reduced={ui.reducedMotion}>
    <div class="top"><Toolbar /></div>
    <div class="left"><Sidebar /></div>
    <main class="center">
      <div class="canvas glass-edge"><Canvas /></div>
      <Dock />
    </main>
    <div class="right"><Inspector /></div>
  </div>

  <BlockSearch />
  <CommandPalette />
  <Toasts />

  {#if recovery}
    <div class="recovery glass">
      <Icon name="life-buoy" size={18} />
      <div>
        <strong>Найдена несохранённая работа</strong>
        <span>Похоже, прошлый сеанс завершился аварийно. Восстановить?</span>
      </div>
      <button class="btn primary" onclick={restore}>Восстановить</button>
      <button class="btn" onclick={discard}>Отбросить</button>
    </div>
  {/if}
</SvelteFlowProvider>

<style>
  .app {
    display: grid;
    grid-template-columns: 252px minmax(0, 1fr) 300px;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas:
      'top top top'
      'left center right';
    gap: 8px;
    height: 100vh;
    padding: 8px;
  }
  .top {
    grid-area: top;
  }
  .left {
    grid-area: left;
    min-height: 0;
  }
  .right {
    grid-area: right;
    min-height: 0;
  }
  .center {
    grid-area: center;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 0;
    min-width: 0;
  }
  .canvas {
    flex: 1;
    min-height: 0;
    border-radius: 14px;
    overflow: hidden;
    border: 1px solid var(--border);
    position: relative;
  }
  .recovery {
    position: fixed;
    left: 50%;
    top: 70px;
    transform: translateX(-50%);
    z-index: 110;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px;
    border-radius: 12px;
    background: rgba(22, 26, 37, 0.97);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    animation: drop 240ms var(--ease);
  }
  .recovery > :global(svg) {
    color: var(--warn);
  }
  .recovery div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .recovery span {
    color: var(--text-2);
    font-size: 12px;
  }
  @keyframes drop {
    from {
      opacity: 0;
      transform: translate(-50%, -10px);
    }
  }
  @media (max-width: 1180px) {
    .app {
      grid-template-columns: 220px minmax(0, 1fr) 260px;
    }
  }
</style>
