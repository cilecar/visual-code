<script lang="ts">
  import { run } from '../runtime/run.svelte';
  import { editor } from '../stores/editor.svelte';
  import { PORT_COLORS } from '../blocks/registry';

  const typeColor: Record<string, string> = { int: PORT_COLORS.number, float: PORT_COLORS.number, str: PORT_COLORS.string, bool: PORT_COLORS.bool, list: PORT_COLORS.list };
  let globals = $derived(Object.entries(run.vars.globals));
  let locals = $derived(Object.entries(run.vars.locals));
</script>

<div class="vars">
  <table>
    <thead><tr><th>Имя</th><th>Тип</th><th>Значение</th></tr></thead>
    <tbody>
      <tr class="group"><td colspan="3">Глобальные переменные</td></tr>
      {#if globals.length}
        {#each globals as [name, v] (name)}
          <tr><td class="mono name">{name}</td><td class="mono" style="color:{typeColor[v.type] ?? 'var(--muted)'}">{v.type}</td><td class="mono val">{v.repr}</td></tr>
        {/each}
      {:else}
        {#each editor.doc.variables as v (v.name)}
          <tr class="idle"><td class="mono name">{v.name}</td><td class="mono" style="color:{PORT_COLORS[v.type]}">{v.type}</td><td class="mono val">{JSON.stringify(v.value)}</td></tr>
        {/each}
      {/if}
      {#if locals.length}
        <tr class="group"><td colspan="3">Локальные · <span class="mono">{run.vars.scope}()</span></td></tr>
        {#each locals as [name, v] (name)}
          <tr><td class="mono name">{name}</td><td class="mono" style="color:{typeColor[v.type] ?? 'var(--muted)'}">{v.type}</td><td class="mono val">{v.repr}</td></tr>
        {/each}
      {/if}
    </tbody>
  </table>
  {#if !globals.length && !editor.doc.variables.length && !locals.length}
    <p class="empty">Во время выполнения здесь видны значения переменных. В режимах Slow и Step они обновляются на каждом шаге.</p>
  {/if}
</div>

<style>
  .vars {
    height: 100%;
    overflow: auto;
    padding: 4px 8px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12.5px;
  }
  th {
    text-align: left;
    font-weight: 500;
    color: var(--muted);
    font-size: 11px;
    padding: 6px 8px;
    position: sticky;
    top: 0;
    background: var(--panel-solid);
  }
  td {
    padding: 4px 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.04);
    user-select: text;
  }
  .group td {
    color: var(--muted);
    font-size: 11px;
    padding-top: 10px;
    border: none;
  }
  .name {
    color: #ffcb6b;
    width: 30%;
  }
  .val {
    word-break: break-all;
  }
  tr.idle td {
    opacity: 0.6;
  }
  tr:not(.group):hover td {
    background: rgba(255, 255, 255, 0.025);
  }
  .empty {
    color: var(--muted);
    padding: 8px;
  }
</style>
