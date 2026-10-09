<script lang="ts">
  import { editor } from '../stores/editor.svelte';
  import { nodeTitle } from '../blocks/ports';
  import Icon from './Icon.svelte';

  let problems = $derived(editor.validation?.result.problems ?? []);

  function title(nodeId?: string, graphId?: string) {
    if (!nodeId) return '';
    const doc = editor.fullDoc();
    const g = editor.graphById(doc, graphId ?? 'main');
    const n = g.nodes.find((x) => x.id === nodeId);
    return n ? nodeTitle(n, { variables: doc.variables, functions: doc.functions }) : nodeId;
  }

  function graphName(graphId?: string) {
    if (!graphId || graphId === 'main') return '';
    return editor.doc.functions.find((f) => f.id === graphId)?.name ?? '';
  }
</script>

<div class="problems">
  {#each problems as p, i (i)}
    <button class="row {p.severity}" onclick={() => p.nodeId && editor.focusNode(p.nodeId, p.graphId)}>
      <Icon name={p.severity === 'error' ? 'circle-alert' : 'triangle-alert'} size={14} />
      <span class="msg">{p.msg}</span>
      {#if p.nodeId}<span class="where">{graphName(p.graphId) ? `ƒ ${graphName(p.graphId)} · ` : ''}{title(p.nodeId, p.graphId)}</span>{/if}
    </button>
  {:else}
    <div class="ok"><Icon name="circle-check" size={16} /> Проблем не найдено</div>
  {/each}
</div>

<style>
  .problems {
    height: 100%;
    overflow: auto;
    padding: 6px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    border-radius: 8px;
    background: none;
    text-align: left;
    cursor: pointer;
    transition: background var(--dur) var(--ease);
  }
  .row:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .row.error :global(svg) {
    color: var(--warn);
  }
  .row.warning :global(svg) {
    color: var(--muted);
  }
  .msg {
    flex: 1;
  }
  .where {
    color: var(--muted);
    font-size: 11.5px;
  }
  .ok {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    color: var(--ok);
  }
</style>
