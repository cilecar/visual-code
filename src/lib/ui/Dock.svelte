<script lang="ts">
  import { ui } from '../stores/ui.svelte';
  import { editor } from '../stores/editor.svelte';
  import { run } from '../runtime/run.svelte';
  import Icon from './Icon.svelte';
  import OutputPanel from './OutputPanel.svelte';
  import CodePanel from './CodePanel.svelte';
  import VariablesPanel from './VariablesPanel.svelte';
  import ProblemsPanel from './ProblemsPanel.svelte';

  let errors = $derived(editor.validation?.errors ?? 0);
  let warnings = $derived(editor.validation?.warnings ?? 0);

  function startResize(e: PointerEvent) {
    const startY = e.clientY;
    const startH = ui.dockHeight;
    const move = (ev: PointerEvent) => (ui.dockHeight = Math.max(120, Math.min(window.innerHeight - 220, startH + startY - ev.clientY)));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const tabs = [
    { id: 'output', label: 'Output', icon: 'terminal' },
    { id: 'code', label: 'Code', icon: 'code-xml' },
    { id: 'variables', label: 'Variables', icon: 'braces' },
    { id: 'problems', label: 'Problems', icon: 'triangle-alert' }
  ] as const;
</script>

<section class="dock glass" class:closed={!ui.dockOpen} style="height:{ui.dockOpen ? ui.dockHeight : 38}px">
  {#if ui.dockOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="resizer" onpointerdown={startResize}></div>
  {/if}
  <nav>
    {#each tabs as t (t.id)}
      <button
        class:on={ui.dockTab === t.id && ui.dockOpen}
        onclick={() => {
          if (ui.dockTab === t.id && ui.dockOpen) ui.dockOpen = false;
          else ((ui.dockTab = t.id), (ui.dockOpen = true));
        }}
      >
        <Icon name={t.icon} size={13} />
        {t.label}
        {#if t.id === 'problems' && errors + warnings}
          <span class="count" class:err={errors > 0}>{errors + warnings}</span>
        {/if}
        {#if t.id === 'output' && run.status === 'input'}<span class="count live">ввод</span>{/if}
      </button>
    {/each}
    <span class="spacer"></span>
    {#if ui.dockTab === 'output' && ui.dockOpen}
      <button class="btn icon ghost" title="Очистить" onclick={() => run.clearOutput()}><Icon name="eraser" size={13} /></button>
    {/if}
    <button class="btn icon ghost" title="Свернуть (Ctrl+J)" onclick={() => (ui.dockOpen = !ui.dockOpen)}>
      <Icon name={ui.dockOpen ? 'chevron-down' : 'chevron-up'} size={14} />
    </button>
  </nav>
  {#if ui.dockOpen}
    <div class="content">
      <div class="pane" class:show={ui.dockTab === 'output'}><OutputPanel /></div>
      <div class="pane" class:show={ui.dockTab === 'code'}><CodePanel /></div>
      <div class="pane" class:show={ui.dockTab === 'variables'}><VariablesPanel /></div>
      <div class="pane" class:show={ui.dockTab === 'problems'}><ProblemsPanel /></div>
    </div>
  {/if}
</section>

<style>
  .dock {
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: 14px;
    overflow: hidden;
    transition: height 220ms var(--ease);
  }
  .resizer {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 5px;
    cursor: ns-resize;
    z-index: 2;
  }
  .resizer:hover {
    background: linear-gradient(rgba(124, 140, 255, 0.4), transparent);
  }
  nav {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 5px 6px;
    border-bottom: 1px solid var(--border);
    flex: none;
  }
  .closed nav {
    border-bottom: none;
  }
  nav > button:not(.btn) {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 27px;
    padding: 0 11px;
    border-radius: 8px;
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    font-size: 12px;
    transition:
      background var(--dur) var(--ease),
      color var(--dur) var(--ease);
  }
  nav > button:not(.btn):hover {
    color: var(--text);
  }
  nav > button.on {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text);
  }
  .spacer {
    flex: 1;
  }
  .count {
    font-size: 10px;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 8px;
    display: grid;
    place-items: center;
    background: rgba(255, 255, 255, 0.1);
  }
  .count.err {
    background: var(--warn);
    color: #1b1206;
    font-weight: 700;
  }
  .count.live {
    background: var(--accent);
    color: #0d0f14;
    animation: blink 1s ease-in-out infinite alternate;
  }
  .content {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .pane {
    position: absolute;
    inset: 0;
    visibility: hidden;
    opacity: 0;
    transition: opacity 160ms var(--ease);
  }
  .pane.show {
    visibility: visible;
    opacity: 1;
  }
  @keyframes blink {
    to {
      opacity: 0.6;
    }
  }
</style>
