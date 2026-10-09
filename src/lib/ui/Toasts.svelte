<script lang="ts">
  import { flip } from 'svelte/animate';
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { ui } from '../stores/ui.svelte';
  import Icon from './Icon.svelte';

  const icons = { info: 'info', success: 'circle-check', error: 'circle-alert' };
</script>

<div class="toasts">
  {#each ui.toasts as t (t.id)}
    <div
      class="toast glass {t.kind}"
      animate:flip={{ duration: ui.reducedMotion ? 0 : 200 }}
      in:fly={{ y: 12, duration: ui.reducedMotion ? 0 : 220, easing: cubicOut }}
      out:fly={{ x: 30, duration: ui.reducedMotion ? 0 : 180 }}
    >
      <Icon name={icons[t.kind]} size={15} />
      <span>{t.text}</span>
      <button class="x" aria-label="close" onclick={() => (ui.toasts = ui.toasts.filter((x) => x.id !== t.id))}><Icon name="x" size={12} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: 330px;
    bottom: 24px;
    z-index: 120;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 9px;
    max-width: 440px;
    padding: 9px 10px 9px 12px;
    border-radius: 10px;
    background: rgba(22, 26, 37, 0.96);
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.5);
    user-select: text;
  }
  .toast.success :global(svg:first-child) {
    color: var(--ok);
  }
  .toast.error {
    border-color: rgba(255, 90, 106, 0.4);
  }
  .toast.error :global(svg:first-child) {
    color: var(--danger);
  }
  .toast.info :global(svg:first-child) {
    color: var(--accent);
  }
  .x {
    border: none;
    background: none;
    color: var(--muted);
    cursor: pointer;
    display: grid;
    padding: 2px;
  }
</style>
