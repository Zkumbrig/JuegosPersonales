<script lang="ts">
  import type { Card } from '../../shared/protocol';
  import Suit from './Suit.svelte';

  let { card, delay = 0 }: { card: Card; delay?: number } = $props();
  const hidden = $derived('hidden' in card);
  const red = $derived(!('hidden' in card) && (card.s === 'H' || card.s === 'D'));
  const rank = $derived('hidden' in card ? '' : card.r);
  const suitKey = $derived('hidden' in card ? '' : card.s);
  const face = $derived(rank === 'J' || rank === 'Q' || rank === 'K');
</script>

<div class="card" class:back={hidden} class:red class:face style="animation-delay:{delay}ms" role="img" aria-label={hidden ? 'Carta boca abajo' : `${rank} de ${suitKey}`}>
  {#if !hidden}
    <span class="corner">{rank}<Suit s={suitKey} size={11} /></span>
    {#if face}
      <span class="court"><b>{rank}</b><Suit s={suitKey} size={16} /></span>
    {:else}
      <span class="pip"><Suit s={suitKey} size={30} /></span>
    {/if}
    <span class="corner br">{rank}<Suit s={suitKey} size={11} /></span>
  {/if}
</div>

<style>
  .card {
    --cw: var(--card-w, 54px);
    width: var(--cw);
    height: calc(var(--cw) * 1.42);
    border-radius: calc(var(--cw) * 0.12);
    background: linear-gradient(160deg, #fffdf6, #ece3cc);
    color: #15110c;
    position: relative;
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.5), inset 0 0 0 1px rgba(0, 0, 0, 0.12);
    font-family: var(--font-display);
    font-weight: 700;
    animation: deal 0.42s cubic-bezier(0.2, 0.9, 0.3, 1.1) both;
    flex: none;
  }
  .card.red { color: #b3202e; }
  .corner {
    position: absolute;
    top: 6%;
    left: 9%;
    font-size: calc(var(--cw) * 0.3);
    line-height: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .corner :global(.suit) { width: calc(var(--cw) * 0.22); height: calc(var(--cw) * 0.22); margin-top: 2px; }
  .pip :global(.suit) { width: calc(var(--cw) * 0.56); height: calc(var(--cw) * 0.56); }
  .court :global(.suit) { width: calc(var(--cw) * 0.26); height: calc(var(--cw) * 0.26); margin-top: 3%; }
  .corner.br { top: auto; left: auto; bottom: 6%; right: 9%; transform: rotate(180deg); }
  .pip {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: calc(var(--cw) * 0.62);
    opacity: 0.9;
  }
  /* Figuras: marco dorado y monograma, sin imágenes */
  .face::before {
    content: '';
    position: absolute;
    inset: 17% 20%;
    border: 1.5px solid var(--gold-lo);
    border-radius: calc(var(--cw) * 0.08);
    background: linear-gradient(160deg, rgb(var(--accent-rgb) / 0.22), rgb(var(--accent-rgb) / 0.05));
  }
  .court {
    position: absolute;
    inset: 17% 20%;
    display: grid;
    place-items: center;
    align-content: center;
    line-height: 1;
  }
  .court b { font-size: calc(var(--cw) * 0.42); }
  .back {
    background:
      repeating-linear-gradient(45deg, rgb(var(--accent-rgb) / 0.35) 0 2px, transparent 2px 8px),
      linear-gradient(160deg, var(--back-1), var(--back-2));
    border: 2px solid var(--gold);
  }
  @keyframes deal {
    from { opacity: 0; transform: translate3d(40px, -60px, 0) rotate(14deg) scale(0.8); }
    to { opacity: 1; transform: none; }
  }
</style>
