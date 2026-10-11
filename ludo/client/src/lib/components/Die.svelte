<script lang="ts">
  // Dado con puntos. Mientras "rolling" cambia de cara al azar; si está "active" es el botón de tirar.
  type Props = {
    value: number | null;
    rolling?: boolean;
    color?: string;
    active?: boolean;
    size?: number;
    onroll?: () => void;
  };
  let { value, rolling = false, color = '#fff', active = false, size = 84, onroll }: Props = $props();

  let face = $state(1);
  $effect(() => {
    if (!rolling) return;
    const id = setInterval(() => (face = 1 + Math.floor(Math.random() * 6)), 75);
    return () => clearInterval(id);
  });
  const shown = $derived(rolling ? face : (value ?? 0));

  // Posiciones de los puntos en una rejilla 3×3 (índices 0..8).
  const PIPS: Record<number, number[]> = {
    0: [],
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
  };
</script>

<button
  class="die"
  class:rolling
  class:active
  style:--size="{size}px"
  style:--ring={color}
  disabled={!active}
  onclick={onroll}
  aria-label={active ? 'Tirar el dado' : value ? `Dado: ${value}` : 'Dado'}
>
  {#if active && !rolling}
    <span class="lbl">Tirar</span>
  {:else}
    <span class="face" aria-hidden="true">
      {#each [0, 1, 2, 3, 4, 5, 6, 7, 8] as i}
        <span class="cell">{#if PIPS[shown]?.includes(i)}<span class="pip"></span>{/if}</span>
      {/each}
    </span>
  {/if}
</button>

<style>
  .die {
    position: relative;
    width: var(--size);
    height: var(--size);
    padding: 0;
    border: 0;
    border-radius: calc(var(--size) * 0.22);
    background: linear-gradient(145deg, #ffffff, #e2e6f4);
    box-shadow: 0 0 0 4px var(--ring), 0 6px 0 rgba(0, 0, 0, 0.35);
    color: #1a1f3c;
    cursor: default;
    display: grid;
    place-items: center;
    transition: transform 0.15s;
    flex: none;
  }
  .face {
    display: grid;
    grid-template: repeat(3, 1fr) / repeat(3, 1fr);
    width: 72%;
    height: 72%;
  }
  .lbl {
    font-weight: 900;
    font-size: calc(var(--size) * 0.22);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .cell {
    display: grid;
    place-items: center;
  }
  .pip {
    width: 78%;
    aspect-ratio: 1;
    border-radius: 50%;
    background: #1a1f3c;
  }
  .active {
    cursor: pointer;
    animation: bob 1.1s ease-in-out infinite;
  }
  .active:hover {
    transform: scale(1.06);
  }
  .active:active {
    transform: translateY(3px);
  }
  .rolling {
    animation: shake 0.28s linear infinite;
  }
  @keyframes bob {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-5px); }
  }
  @keyframes shake {
    0% { transform: rotate(-8deg) scale(1.05); }
    25% { transform: rotate(7deg) translateY(-6px); }
    50% { transform: rotate(-5deg) scale(1.08); }
    75% { transform: rotate(9deg) translateY(-3px); }
    100% { transform: rotate(-8deg) scale(1.05); }
  }
  @media (prefers-reduced-motion: reduce) {
    .active, .rolling { animation: none; }
  }
</style>
