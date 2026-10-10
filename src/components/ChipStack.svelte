<script lang="ts">
  import { breakdown, CHIP_COLORS } from '../lib/chips';
  import { fmt } from '../lib/format';

  let { amount }: { amount: number } = $props();
  const discs = $derived(breakdown(amount, 6));
</script>

<span class="stack" aria-label="Apuesta de {amount}">
  <span class="pile" style="--h:{discs.length}">
    {#each discs as d, i (i)}
      <i class="disc" style="--c:{CHIP_COLORS[d]};--i:{i}"></i>
    {/each}
  </span>
  <b class="num">{fmt(amount)}</b>
</span>

<style>
  .stack { display: inline-flex; align-items: center; gap: 7px; font-size: 0.82rem; }
  .pile { position: relative; width: 24px; height: calc(24px + (var(--h) - 1) * 4px); flex: none; }
  .disc {
    position: absolute;
    left: 0;
    bottom: calc(var(--i) * 4px);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background:
      radial-gradient(circle, var(--c) 0 38%, transparent 40%),
      repeating-conic-gradient(#f5efe0 0 14deg, var(--c) 14deg 30deg);
    box-shadow: 0 2px 0 rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(0, 0, 0, 0.35);
    animation: drop 0.28s cubic-bezier(0.3, 1.4, 0.5, 1) both;
    animation-delay: calc(var(--i) * 40ms);
  }
  @keyframes drop { from { transform: translateY(-14px) scale(0.8); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
