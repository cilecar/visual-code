<script lang="ts">
  // Canvas overlay drawing glowing impulses that run along active exec wires.
  import { onMount } from 'svelte';
  import { useSvelteFlow } from '@xyflow/svelte';
  import { run } from '../runtime/run.svelte';
  import { getPath } from './pulses';

  interface Particle {
    edges: string[];
    start: number;
    duration: number;
  }

  const flow = useSvelteFlow();
  let canvas: HTMLCanvasElement;
  let particles: Particle[] = [];
  let raf = 0;

  function spawn(edges: string[], slow: boolean) {
    particles.push({ edges, start: performance.now(), duration: slow ? 520 : 260 });
    if (particles.length > 40) particles.shift();
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function resize() {
    const r = canvas.parentElement!.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
  }

  function frame(now: number) {
    raf = 0;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const vp = flow.getViewport();
    ctx.setTransform(dpr * vp.zoom, 0, 0, dpr * vp.zoom, dpr * vp.x, dpr * vp.y);
    ctx.globalCompositeOperation = 'lighter';

    particles = particles.filter((p) => now - p.start < p.duration + 220);
    for (const p of particles) {
      const els = p.edges.map(getPath).filter((e): e is SVGPathElement => !!e);
      if (!els.length) continue;
      const lens = els.map((e) => e.getTotalLength());
      const total = lens.reduce((a, b) => a + b, 0);
      const t = Math.min(1, (now - p.start) / p.duration);
      const eased = 1 - Math.pow(1 - t, 2);
      const fade = t >= 1 ? Math.max(0, 1 - (now - p.start - p.duration) / 220) : 1;
      // head + fading tail
      for (let k = 0; k < 9; k++) {
        const d = eased * total - k * 7;
        if (d < 0) break;
        let rest = d;
        let i = 0;
        while (i < els.length - 1 && rest > lens[i]) rest -= lens[i++];
        const pt = els[i].getPointAtLength(Math.min(rest, lens[i]));
        const a = (1 - k / 9) * fade;
        const r = (k === 0 ? 5 : 4 - k * 0.3) / Math.sqrt(vp.zoom);
        const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, r * 3.2);
        g.addColorStop(0, `rgba(235, 240, 255, ${a})`);
        g.addColorStop(0.35, `rgba(124, 140, 255, ${a * 0.8})`);
        g.addColorStop(1, 'rgba(124, 140, 255, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (particles.length) raf = requestAnimationFrame(frame);
    else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  onMount(() => {
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);
    const off = run.onPulse(spawn);
    return () => {
      ro.disconnect();
      off();
      cancelAnimationFrame(raf);
    };
  });
</script>

<canvas bind:this={canvas} class="pulse-overlay" aria-hidden="true"></canvas>

<style>
  .pulse-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 5;
  }
</style>
