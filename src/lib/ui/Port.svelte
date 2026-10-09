<script lang="ts">
  import { Handle, Position, useConnection } from '@xyflow/svelte';
  import type { Port } from '../types';
  import { editor } from '../stores/editor.svelte';
  import { typesCompatible } from '../graph/compat';
  import { PORT_COLORS } from '../blocks/registry';

  let { nodeId, port, connected }: { nodeId: string; port: Port; connected: boolean } = $props();

  const conn = useConnection();
  let handleId = $derived(`${port.dir === 'in' ? 'in' : 'out'}:${port.id}`);
  let color = $derived(PORT_COLORS[port.type] ?? PORT_COLORS.any);

  /** While a wire is being dragged: '' | 'origin' | 'compatible' | 'dim' */
  let dragState = $derived.by(() => {
    const c = conn.current;
    if (!c.inProgress) return '';
    const from = c.fromHandle;
    if (from.nodeId === nodeId && from.id === handleId) return 'origin';
    const fromType = editor.portType(from.nodeId, from.id ?? '');
    const fromIsSource = from.type === 'source';
    if (!fromType || from.nodeId === nodeId || fromIsSource !== (port.dir === 'in')) return 'dim';
    const ok = fromIsSource ? typesCompatible(fromType, port.type) : typesCompatible(port.type, fromType);
    return ok ? 'compatible' : 'dim';
  });

  // "snap" pop when a wire gets attached
  let snapKey = $state(0);
  let wasConnected: boolean | null = null;
  $effect(() => {
    if (connected && wasConnected === false) snapKey++;
    wasConnected = connected;
  });
</script>

<Handle
  id={handleId}
  type={port.dir === 'in' ? 'target' : 'source'}
  position={port.dir === 'in' ? Position.Left : Position.Right}
  class="port port-{port.type} {dragState} {connected ? 'connected' : ''}"
  style="--pc: {color}"
>
  {#key snapKey}
    <span class="shape" class:snap={snapKey > 0}></span>
  {/key}
</Handle>

<style>
  :global(.svelte-flow__handle.port) {
    width: 18px;
    height: 18px;
    min-width: 0;
    min-height: 0;
    border: none;
    background: transparent;
    border-radius: 0;
    display: grid;
    place-items: center;
    transition:
      opacity var(--dur) var(--ease),
      filter var(--dur) var(--ease);
  }
  :global(.svelte-flow__handle.port.svelte-flow__handle-left) {
    left: -9px;
  }
  :global(.svelte-flow__handle.port.svelte-flow__handle-right) {
    right: -9px;
  }
  .shape {
    pointer-events: none;
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 2px solid var(--pc);
    background: #0d0f14;
    transition:
      transform var(--dur) var(--ease),
      background var(--dur) var(--ease),
      box-shadow var(--dur) var(--ease);
  }
  :global(.port.connected) .shape {
    background: var(--pc);
  }
  :global(.port-exec) .shape {
    width: 12px;
    height: 13px;
    border: none;
    border-radius: 0;
    background: var(--pc);
    clip-path: polygon(0 0, 100% 50%, 0 100%);
    opacity: 0.55;
  }
  :global(.port-exec.connected) .shape {
    opacity: 1;
  }
  :global(.svelte-flow__handle.port:hover) .shape {
    transform: scale(1.3);
    box-shadow: 0 0 10px var(--pc);
  }
  :global(.svelte-flow__handle.port.compatible) .shape {
    transform: scale(1.35);
    box-shadow:
      0 0 0 3px color-mix(in srgb, var(--pc) 30%, transparent),
      0 0 14px var(--pc);
    animation: port-breathe 900ms var(--ease) infinite alternate;
  }
  :global(.svelte-flow__handle.port.port-exec.compatible) .shape {
    opacity: 1;
    filter: drop-shadow(0 0 6px var(--pc));
  }
  :global(.svelte-flow__handle.port.dim) {
    opacity: 0.18;
    filter: grayscale(0.8);
  }
  .snap {
    animation: snap 240ms var(--ease);
  }
  @keyframes snap {
    0% {
      transform: scale(0.6);
    }
    55% {
      transform: scale(1.55);
    }
    100% {
      transform: scale(1);
    }
  }
  @keyframes port-breathe {
    to {
      transform: scale(1.15);
    }
  }
</style>
