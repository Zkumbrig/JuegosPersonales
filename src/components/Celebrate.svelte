<script lang="ts">
  import { onMount, untrack } from 'svelte';

  let { big = false }: { big?: boolean } = $props();
  let alive = $state(true);

  // Posiciones aleatorias calculadas una vez; la animación solo usa transform y opacity.
  const coins = Array.from({ length: untrack(() => big) ? 30 : 14 }, () => ({
    x: Math.round(Math.random() * 100),
    drift: Math.round((Math.random() - 0.5) * 120),
    delay: Math.round(Math.random() * 500),
    dur: 1500 + Math.round(Math.random() * 900),
    s: 0.7 + Math.random() * 0.7,
  }));

  onMount(() => {
    const t = setTimeout(() => (alive = false), 3200);
    return () => clearTimeout(t);
  });
</script>

{#if alive}
  <div class="fx" aria-hidden="true">
    {#each coins as c, i (i)}
      <span class="coin" style="--x:{c.x}vw;--dx:{c.drift}px;--d:{c.delay}ms;--t:{c.dur}ms;--s:{c.s}"></span>
    {/each}
  </div>
{/if}

<style>
  .fx { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 60; }
  .coin {
    position: absolute;
    left: var(--x);
    top: -24px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, var(--gold-hi), var(--gold) 55%, var(--gold-lo));
    border: 2px solid var(--gold-lo);
    box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.25);
    will-change: transform, opacity;
    animation: drop var(--t) cubic-bezier(0.3, 0.1, 0.6, 1) var(--d) both;
  }
  @keyframes drop {
    0% { transform: translate3d(0, 0, 0) scale(var(--s)) rotateY(0); opacity: 0; }
    10% { opacity: 1; }
    85% { opacity: 1; }
    100% { transform: translate3d(var(--dx), 105vh, 0) scale(var(--s)) rotateY(900deg); opacity: 0; }
  }
</style>
