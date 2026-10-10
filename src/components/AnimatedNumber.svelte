<script lang="ts">
  import { untrack } from 'svelte';
  import { fmt } from '../lib/format';

  let { value, ms = 650 }: { value: number; ms?: number } = $props();

  let shown = $state(untrack(() => value));
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  $effect(() => {
    const to = value;
    const from = untrack(() => shown);
    if (from === to) return;
    if (reduce) { shown = to; return; }
    const t0 = performance.now();
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      shown = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  });
</script>

{fmt(shown)}
