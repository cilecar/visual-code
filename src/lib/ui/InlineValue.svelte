<script lang="ts">
  // Small inline editor for a literal value (unconnected input or node param).
  let {
    type,
    value,
    options,
    placeholder = '',
    onchange
  }: { type: string; value: unknown; options?: string[]; placeholder?: string; onchange: (v: unknown) => void } = $props();

  function parseAny(s: string): unknown {
    if (/^-?\d+(\.\d+)?$/.test(s.trim())) return Number(s);
    if (s === 'True' || s === 'true') return true;
    if (s === 'False' || s === 'false') return false;
    return s;
  }
</script>

{#if options}
  <select class="iv nodrag" value={String(value ?? '')} onchange={(e) => onchange(e.currentTarget.value)}>
    {#each options as o (o)}<option value={o}>{o}</option>{/each}
  </select>
{:else if type === 'bool'}
  <label class="iv-check nodrag">
    <input type="checkbox" checked={value === true} onchange={(e) => onchange(e.currentTarget.checked)} />
    <span>{value === true ? 'True' : 'False'}</span>
  </label>
{:else if type === 'number'}
  <input
    class="iv num nodrag"
    type="number"
    value={typeof value === 'number' ? value : Number(value ?? 0)}
    oninput={(e) => onchange(e.currentTarget.value === '' ? 0 : Number(e.currentTarget.value))}
  />
{:else if type === 'string' || type === 'any'}
  <input
    class="iv nodrag"
    class:str={type === 'string'}
    {placeholder}
    value={value === undefined || value === null ? '' : String(value)}
    oninput={(e) => onchange(type === 'any' ? parseAny(e.currentTarget.value) : e.currentTarget.value)}
    spellcheck="false"
  />
{:else if type === 'list'}
  <span class="iv-empty mono">[ ]</span>
{/if}

<style>
  .iv {
    width: 92px;
    height: 20px;
    padding: 0 6px;
    border-radius: 5px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.35);
    font-family: var(--mono);
    font-size: 11px;
    outline: none;
    user-select: text;
    transition: border-color var(--dur) var(--ease);
  }
  .iv:focus {
    border-color: rgba(124, 140, 255, 0.7);
  }
  .iv.num {
    width: 64px;
    color: var(--c-number);
  }
  .iv.str {
    color: #f9a8d4;
  }
  select.iv {
    width: auto;
    min-width: 54px;
    padding: 0 2px;
  }
  select.iv option {
    background: #141822;
  }
  .iv-check {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--text-2);
    cursor: pointer;
  }
  .iv-check input {
    accent-color: var(--c-bool);
    margin: 0;
  }
  .iv-empty {
    font-size: 11px;
    color: var(--muted);
  }
  input[type='number']::-webkit-inner-spin-button {
    opacity: 0.4;
  }
</style>
