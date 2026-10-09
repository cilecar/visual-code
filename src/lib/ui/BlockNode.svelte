<script lang="ts">
  import { useUpdateNodeInternals, type NodeProps } from '@xyflow/svelte';
  import type { BlockData, GNode, Port as PortT } from '../types';
  import { categoryColor, getBlock } from '../blocks/registry';
  import { nodeTitle, resolvePorts } from '../blocks/ports';
  import { editor } from '../stores/editor.svelte';
  import { run } from '../runtime/run.svelte';
  import { toggleBreakpoint } from '../commands';
  import Port from './Port.svelte';
  import Icon from './Icon.svelte';
  import InlineValue from './InlineValue.svelte';

  let { id, data, selected }: NodeProps & { data: BlockData } = $props();

  const updateInternals = useUpdateNodeInternals();

  let def = $derived((editor.blocksVersion, getBlock(data.block)));
  let node = $derived({ id, type: 'block', position: { x: 0, y: 0 }, data } as GNode);
  let ports = $derived(resolvePorts(node, editor.portCtx));
  let title = $derived(nodeTitle(node, editor.portCtx));
  let color = $derived(def ? categoryColor(def.category) : '#ff5a6a');
  let conns = $derived(editor.connected.get(id));
  let problems = $derived(editor.validation?.byNode.get(id) ?? []);
  let hasError = $derived(problems.some((p) => p.severity === 'error'));
  let active = $derived(run.activeNode === id && run.live);
  let trailSeq = $derived(run.trail.get(id));
  let runError = $derived(run.error && run.error.nodeId === id ? run.error : null);
  let pure = $derived(def?.kind === 'pure');
  let event = $derived(def?.kind === 'event');
  let inlineParams = $derived((def?.params ?? []).filter((p) => p.type !== 'code' && !(def?.variadic && p.id === def.variadic.param)));

  // rows: exec ports first, then data; inputs left, outputs right
  let rows = $derived.by(() => {
    const ins = [...ports.inputs.filter((p) => p.type === 'exec'), ...ports.inputs.filter((p) => p.type !== 'exec')];
    const outs = [...ports.outputs.filter((p) => p.type === 'exec'), ...ports.outputs.filter((p) => p.type !== 'exec')];
    const n = Math.max(ins.length, outs.length);
    return Array.from({ length: n }, (_, i) => [ins[i], outs[i]] as [PortT | undefined, PortT | undefined]);
  });

  // keep Svelte Flow's handle geometry in sync when ports change
  let portKey = $derived(rows.map(([a, b]) => `${a?.id}:${a?.type}|${b?.id}:${b?.type}`).join(','));
  $effect(() => {
    void portKey;
    queueMicrotask(() => updateInternals(id));
  });

  const isConnected = (p: PortT) => !!conns?.has(`${p.dir === 'in' ? 'in' : 'out'}:${p.id}`);

  function varOptions() {
    return editor.doc.variables.map((v) => v.name);
  }

  function openFunction() {
    if (def?.dynamic === 'function' && data.params?.fn) editor.switchGraph(String(data.params.fn));
  }

  let codePreview = $derived(
    def?.dynamic === 'python'
      ? String(data.params?.code ?? '')
          .split('\n')
          .slice(0, 4)
          .join('\n')
      : ''
  );
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="block"
  class:selected
  class:active
  class:pure
  class:event
  class:run-error={!!runError}
  class:has-error={hasError}
  style="--cat: {color}"
  ondblclick={openFunction}
>
  {#key trailSeq}
    {#if trailSeq && !active}<div class="trail"></div>{/if}
  {/key}

  {#if data.comment}
    <div class="note">{data.comment}</div>
  {/if}

  <header>
    {#if def}<Icon name={def.icon} size={14} />{/if}
    <span class="title">{title}</span>
    {#if def?.dynamic === 'function'}<span class="tag">fn</span>{/if}
    {#if !pure}
      <button
        class="bp nodrag"
        class:on={data.breakpoint}
        title={data.breakpoint ? 'Убрать точку останова (F9)' : 'Поставить точку останова (F9)'}
        onclick={(e) => (e.stopPropagation(), toggleBreakpoint(id))}
        aria-label="breakpoint"
      ></button>
    {/if}
    {#if problems.length}
      <span class="badge" title={problems.map((p) => p.msg).join('\n')}>!{#if problems.length > 1}{problems.length}{/if}</span>
    {/if}
  </header>

  <div class="body">
    {#if inlineParams.length}
      <div class="params">
        {#each inlineParams as p (p.id)}
          <div class="param">
            {#if p.label && !pure}<span class="plabel">{p.label}</span>{/if}
            <InlineValue
              type={p.type === 'var' ? 'select' : p.type}
              options={p.type === 'var' ? varOptions() : p.options}
              value={data.params?.[p.id] ?? p.default}
              onchange={(v) => editor.setParam(id, p.id, v, p.type === 'var' || p.type === 'select')}
            />
          </div>
        {/each}
      </div>
    {/if}

    {#each rows as [inp, out], i (i)}
      <div class="row">
        <div class="cell in">
          {#if inp}
            <Port nodeId={id} port={inp} connected={isConnected(inp)} />
            {#if inp.type !== 'exec' || inp.label}<span class="label">{inp.label}</span>{/if}
            {#if inp.type !== 'exec' && !isConnected(inp) && !inp.required}
              <InlineValue type={inp.type} value={data.inputs?.[inp.id] ?? inp.default} onchange={(v) => editor.setInput(id, inp.id, v)} />
            {/if}
          {/if}
        </div>
        <div class="cell out">
          {#if out}
            {#if out.type !== 'exec' || out.label}<span class="label">{out.label}</span>{/if}
            <Port nodeId={id} port={out} connected={isConnected(out)} />
          {/if}
        </div>
      </div>
    {/each}

    {#if codePreview}
      <pre class="code">{codePreview}</pre>
    {/if}
  </div>

  {#if runError}
    <div class="err-tip" role="alert">
      <strong>{runError.msg.split(':')[0]}</strong>
      <span>{runError.msg.split(':').slice(1).join(':').trim()}</span>
    </div>
  {/if}
</div>

<style>
  .block {
    position: relative;
    min-width: 168px;
    max-width: 360px;
    border-radius: var(--radius);
    background: rgba(24, 28, 39, 0.72);
    backdrop-filter: blur(14px) saturate(130%);
    -webkit-backdrop-filter: blur(14px) saturate(130%);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow:
      0 10px 30px -12px rgba(0, 0, 0, 0.7),
      inset 0 1px 0 rgba(255, 255, 255, 0.05);
    animation: enter 240ms var(--ease) both;
    transition:
      box-shadow var(--dur) var(--ease),
      border-color var(--dur) var(--ease),
      transform var(--dur) var(--ease);
  }
  .block.selected {
    border-color: rgba(124, 140, 255, 0.75);
    box-shadow:
      0 0 0 1px rgba(124, 140, 255, 0.5),
      0 12px 34px -10px rgba(0, 0, 0, 0.8);
  }
  .block.active {
    border-color: var(--accent);
    animation: neon 900ms var(--ease) infinite alternate;
  }
  .block.run-error {
    border-color: var(--danger);
    background: rgba(60, 18, 26, 0.78);
    box-shadow:
      0 0 0 1px var(--danger),
      0 0 26px rgba(255, 90, 106, 0.5);
    animation: shake 420ms var(--ease);
  }

  .trail {
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    pointer-events: none;
    box-shadow:
      0 0 0 2px var(--accent),
      0 0 22px 2px var(--accent-glow);
    animation: trail 1400ms var(--ease) forwards;
  }

  header {
    display: flex;
    align-items: center;
    gap: 7px;
    height: 30px;
    padding: 0 10px;
    border-radius: calc(var(--radius) - 1px) calc(var(--radius) - 1px) 0 0;
    background: linear-gradient(
      100deg,
      color-mix(in srgb, var(--cat) 62%, transparent) 0%,
      color-mix(in srgb, var(--cat) 22%, transparent) 70%,
      transparent 100%
    );
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    font-weight: 600;
    font-size: 12.5px;
    letter-spacing: 0.01em;
    color: #fff;
  }
  .event header {
    border-radius: calc(var(--radius) - 1px) calc(var(--radius) - 1px) 0 0;
    background: linear-gradient(100deg, color-mix(in srgb, var(--cat) 80%, transparent), color-mix(in srgb, var(--cat) 30%, transparent));
  }
  .pure header {
    height: 26px;
    font-size: 12px;
    background: linear-gradient(100deg, color-mix(in srgb, var(--cat) 38%, transparent), transparent 90%);
  }
  .title {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    font-family: var(--mono);
    font-size: 10px;
    padding: 0 5px;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.3);
    color: var(--text-2);
  }
  .bp {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 1.5px solid rgba(255, 90, 106, 0.8);
    padding: 0;
    background: transparent;
    cursor: pointer;
    opacity: 0;
    transition:
      opacity var(--dur) var(--ease),
      transform var(--dur) var(--ease),
      background var(--dur) var(--ease);
  }
  .block:hover .bp {
    opacity: 0.55;
  }
  .bp:hover {
    opacity: 1 !important;
    transform: scale(1.2);
  }
  .bp.on {
    opacity: 1;
    border-color: var(--danger);
    background: var(--danger);
    box-shadow: 0 0 8px var(--danger);
    animation: pop 220ms var(--ease);
  }
  .badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    display: grid;
    place-items: center;
    background: var(--warn);
    color: #1b1206;
    font-size: 11px;
    font-weight: 800;
    box-shadow: 0 0 10px rgba(255, 159, 67, 0.6);
    cursor: help;
    animation: pop 220ms var(--ease);
  }

  .body {
    padding: 6px 0 8px;
  }
  .params {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 2px 12px 6px;
  }
  .param {
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: space-between;
  }
  .plabel {
    color: var(--muted);
    font-size: 11px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    min-height: 24px;
    gap: 12px;
  }
  .cell {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 24px;
  }
  .cell.in {
    padding-left: 14px;
  }
  .cell.out {
    padding-right: 14px;
    margin-left: auto;
    justify-content: flex-end;
  }
  .label {
    font-size: 11.5px;
    color: var(--text-2);
    white-space: nowrap;
  }
  .code {
    margin: 6px 10px 0;
    padding: 6px 8px;
    border-radius: 6px;
    background: rgba(0, 0, 0, 0.35);
    font-family: var(--mono);
    font-size: 10.5px;
    line-height: 1.45;
    color: #c9d1ff;
    max-width: 320px;
    overflow: hidden;
    white-space: pre;
  }
  .note {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 0;
    max-width: 260px;
    padding: 5px 9px;
    border-radius: 8px;
    background: rgba(250, 204, 21, 0.12);
    border: 1px solid rgba(250, 204, 21, 0.28);
    color: #fde68a;
    font-size: 11.5px;
    white-space: pre-wrap;
  }
  .err-tip {
    position: absolute;
    top: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%);
    width: max-content;
    max-width: 340px;
    padding: 8px 11px;
    border-radius: 9px;
    background: #2a0f16;
    border: 1px solid rgba(255, 90, 106, 0.6);
    color: #ffd3d8;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
    animation: enter 220ms var(--ease);
    z-index: 10;
    user-select: text;
  }
  .err-tip::before {
    content: '';
    position: absolute;
    top: -6px;
    left: 50%;
    width: 10px;
    height: 10px;
    background: #2a0f16;
    border-left: 1px solid rgba(255, 90, 106, 0.6);
    border-top: 1px solid rgba(255, 90, 106, 0.6);
    transform: translateX(-50%) rotate(45deg);
  }
  .err-tip strong {
    color: var(--danger);
    font-family: var(--mono);
    font-size: 11.5px;
  }

  @keyframes enter {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.94);
    }
  }
  @keyframes pop {
    from {
      transform: scale(0.3);
      opacity: 0;
    }
  }
  @keyframes neon {
    from {
      box-shadow:
        0 0 0 1px var(--accent),
        0 0 14px 1px var(--accent-glow),
        0 0 0 0 rgba(124, 140, 255, 0);
    }
    to {
      box-shadow:
        0 0 0 2px var(--accent),
        0 0 34px 6px var(--accent-glow),
        0 0 70px 10px rgba(124, 140, 255, 0.18);
    }
  }
  @keyframes trail {
    from {
      opacity: 0.85;
    }
    to {
      opacity: 0;
    }
  }
  @keyframes shake {
    0%,
    100% {
      transform: translateX(0);
    }
    20% {
      transform: translateX(-6px);
    }
    40% {
      transform: translateX(5px);
    }
    60% {
      transform: translateX(-4px);
    }
    80% {
      transform: translateX(2px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .block.active {
      animation: none;
      box-shadow:
        0 0 0 2px var(--accent),
        0 0 26px 4px var(--accent-glow);
    }
  }
</style>
