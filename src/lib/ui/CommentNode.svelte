<script lang="ts">
  import { NodeResizer, type NodeProps } from '@xyflow/svelte';
  import type { CommentData } from '../types';
  import { editor } from '../stores/editor.svelte';

  let { id, data, selected }: NodeProps & { data: CommentData } = $props();
  let editing = $state(false);
  let input: HTMLInputElement | undefined = $state();

  const COLORS = ['#6e56cf', '#3e8ed0', '#30a46c', '#e0a100', '#e5484d', '#d6409f', '#7c8aa5'];

  function startEdit() {
    editing = true;
    queueMicrotask(() => input?.select());
  }
  function commit(value: string) {
    editing = false;
    if (value !== data.title) editor.updateNodeData(id, { title: value }, true);
  }
</script>

<NodeResizer minWidth={160} minHeight={90} isVisible={selected} lineClass="frame-line" handleClass="frame-handle" onResizeEnd={() => editor.commit()} />

<div class="frame" class:selected style="--fc: {data.color}">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="head" ondblclick={startEdit}>
    {#if editing}
      <input
        bind:this={input}
        class="nodrag"
        value={data.title}
        onblur={(e) => commit(e.currentTarget.value)}
        onkeydown={(e) => {
          if (e.key === 'Enter') commit(e.currentTarget.value);
          if (e.key === 'Escape') editing = false;
        }}
      />
    {:else}
      <span>{data.title}</span>
    {/if}
    {#if selected}
      <div class="colors nodrag">
        {#each COLORS as c (c)}
          <button class="sw" style="background:{c}" aria-label={c} onclick={() => editor.updateNodeData(id, { color: c }, true)}></button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .frame {
    width: 100%;
    height: 100%;
    border-radius: 14px;
    background: color-mix(in srgb, var(--fc) 7%, transparent);
    border: 1px dashed color-mix(in srgb, var(--fc) 45%, transparent);
    transition:
      background var(--dur) var(--ease),
      border-color var(--dur) var(--ease);
    animation: enter 240ms var(--ease);
  }
  .frame.selected {
    border-style: solid;
    background: color-mix(in srgb, var(--fc) 11%, transparent);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 34px;
    padding: 0 14px;
    border-radius: 14px 14px 0 0;
    background: color-mix(in srgb, var(--fc) 22%, transparent);
    color: color-mix(in srgb, var(--fc) 30%, white);
    font-weight: 600;
    font-size: 14px;
  }
  .head span {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .head input {
    flex: 1;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 6px;
    padding: 2px 6px;
    font-weight: 600;
    font-size: 14px;
    outline: none;
  }
  .colors {
    display: flex;
    gap: 4px;
  }
  .sw {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.3);
    padding: 0;
    cursor: pointer;
  }
  :global(.frame-line) {
    border-color: transparent !important;
  }
  :global(.frame-handle) {
    width: 9px !important;
    height: 9px !important;
    border-radius: 3px !important;
    background: var(--accent) !important;
    border: none !important;
  }
  @keyframes enter {
    from {
      opacity: 0;
    }
  }
</style>
