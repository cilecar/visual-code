<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import type { RerouteData } from '../types';
  import { PORT_COLORS } from '../blocks/registry';

  let { data, selected }: NodeProps & { data: RerouteData } = $props();
  let color = $derived(PORT_COLORS[data.portType] ?? PORT_COLORS.any);
</script>

<div class="reroute" class:selected class:exec={data.portType === 'exec'} style="--pc: {color}">
  <Handle id="in:in" type="target" position={Position.Left} class="rr-handle" />
  <Handle id="out:out" type="source" position={Position.Right} class="rr-handle" />
</div>

<style>
  .reroute {
    position: relative;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #0d0f14;
    border: 2.5px solid var(--pc);
    box-shadow: 0 0 8px color-mix(in srgb, var(--pc) 45%, transparent);
    transition:
      transform var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
    animation: pop 220ms var(--ease);
  }
  .reroute.exec {
    border-radius: 4px;
    transform: rotate(45deg);
  }
  .reroute.selected {
    box-shadow:
      0 0 0 3px rgba(124, 140, 255, 0.5),
      0 0 14px var(--pc);
  }
  .reroute:hover {
    transform: scale(1.2);
  }
  .reroute.exec:hover {
    transform: rotate(45deg) scale(1.2);
  }
  :global(.svelte-flow__handle.rr-handle) {
    position: absolute;
    inset: 0;
    left: 50% !important;
    right: auto !important;
    top: 50%;
    width: 16px;
    height: 16px;
    min-width: 0;
    min-height: 0;
    transform: translate(-50%, -50%);
    opacity: 0;
    border: none;
  }
  @keyframes pop {
    from {
      transform: scale(0.2);
    }
  }
</style>
