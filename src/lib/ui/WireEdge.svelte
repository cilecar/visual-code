<script lang="ts">
  import { EdgeLabel, getBezierPath, useSvelteFlow, type EdgeProps } from '@xyflow/svelte';
  import { editor } from '../stores/editor.svelte';
  import { run } from '../runtime/run.svelte';
  import { PORT_COLORS } from '../blocks/registry';
  import { registerPath } from './pulses';

  let { id, source, target, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, sourceHandleId, targetHandleId, selected }: EdgeProps =
    $props();

  const flow = useSvelteFlow();

  let srcType = $derived(editor.portType(source, sourceHandleId ?? '') ?? 'any');
  let dstType = $derived(editor.portType(target, targetHandleId ?? '') ?? srcType);
  let exec = $derived(srcType === 'exec');
  let c1 = $derived(PORT_COLORS[srcType] ?? PORT_COLORS.any);
  let c2 = $derived(PORT_COLORS[dstType] ?? c1);

  let geo = $derived(
    getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.35 })
  );
  let path = $derived(geo[0]);
  let gradId = $derived(`wg-${id}`);
  let active = $derived(run.activeEdges.has(id));
  let value = $derived(run.edgeValues.get(id));
  let hold = $derived(run.status === 'paused' || run.status === 'input');

  let el: SVGPathElement | undefined = $state();
  $effect(() => {
    if (el) return registerPath(id, el);
  });

  function onDblClick(e: MouseEvent) {
    e.stopPropagation();
    editor.insertReroute(id, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }
</script>

<defs>
  <linearGradient id={gradId} gradientUnits="userSpaceOnUse" x1={sourceX} y1={sourceY} x2={targetX} y2={targetY}>
    <stop offset="0%" stop-color={c1} />
    <stop offset="100%" stop-color={c2} />
  </linearGradient>
</defs>

<!-- glow underlay -->
<path d={path} class="glow" class:active class:selected stroke={`url(#${gradId})`} />
<path bind:this={el} d={path} class="wire" class:exec class:active class:selected stroke={`url(#${gradId})`} />
<!-- svelte-ignore a11y_no_static_element_interactions -->
<path d={path} class="hit" ondblclick={onDblClick} />

{#if value}
  {#key value.seq}
    <EdgeLabel x={geo[1]} y={geo[2]} class="wire-value-wrap">
      <div class="wire-value mono" class:hold style="--wc: {c1}">{value.value}</div>
    </EdgeLabel>
  {/key}
{/if}

<style>
  .wire {
    fill: none;
    stroke-width: 2.25;
    stroke-linecap: round;
    opacity: 0.85;
    transition:
      stroke-width var(--dur) var(--ease),
      opacity var(--dur) var(--ease);
    pointer-events: none;
  }
  .wire.exec {
    stroke-width: 3;
    opacity: 0.75;
  }
  .glow {
    fill: none;
    stroke-width: 9;
    opacity: 0;
    filter: blur(5px);
    transition: opacity var(--dur) var(--ease);
    pointer-events: none;
  }
  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 18;
    cursor: pointer;
  }
  :global(.svelte-flow__edge:hover) .wire {
    stroke-width: 4.25;
    opacity: 1;
  }
  :global(.svelte-flow__edge:hover) .wire.exec {
    stroke-width: 5;
  }
  :global(.svelte-flow__edge:hover) .glow {
    opacity: 0.35;
  }
  .wire.selected {
    stroke-width: 4;
    opacity: 1;
  }
  .glow.selected {
    opacity: 0.45;
  }
  .wire.active {
    opacity: 1;
    stroke-width: 3.5;
  }
  .glow.active {
    opacity: 0.6;
  }
  :global(.wire-value-wrap) {
    pointer-events: none !important;
  }
  .wire-value {
    padding: 2px 7px;
    border-radius: 7px;
    background: rgba(13, 15, 20, 0.92);
    border: 1px solid color-mix(in srgb, var(--wc) 60%, transparent);
    color: color-mix(in srgb, var(--wc) 50%, white);
    font-size: 11px;
    max-width: 220px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 0 12px color-mix(in srgb, var(--wc) 35%, transparent);
    animation: value-pop 2600ms var(--ease) forwards;
  }
  .wire-value.hold {
    animation: value-in 200ms var(--ease) forwards;
  }
  @keyframes value-pop {
    0% {
      opacity: 0;
      transform: translateY(6px) scale(0.85);
    }
    8% {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    75% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
  @keyframes value-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.85);
    }
  }
</style>
