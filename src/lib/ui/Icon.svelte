<script lang="ts">
  import { icons } from '@lucide/svelte';
  import type { Component } from 'svelte';

  let { name, size = 14, strokeWidth = 2, class: cls = '' }: { name: string; size?: number; strokeWidth?: number; class?: string } = $props();

  const pascal = (s: string) =>
    s
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join('');

  const lib = icons as unknown as Record<string, Component<{ size?: number; strokeWidth?: number; class?: string }>>;
  let Cmp = $derived(lib[pascal(name)] ?? lib.Box);
</script>

<Cmp {size} {strokeWidth} class={cls} />
