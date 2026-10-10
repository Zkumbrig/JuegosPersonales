<script lang="ts">
  import { net } from '../lib/net.svelte';

  let { id, size = 32 }: { id: string; size?: number } = $props();
  const HUES = [38, 12, 160, 200, 280, 330, 90, 20];
  const player = $derived(net.room?.players.find((p) => p.id === id));
  const hue = $derived(HUES[(player?.avatar ?? 0) % HUES.length]);
</script>

<span class="av" style="--h:{hue};--s:{size}px" aria-hidden="true">{(player?.name ?? '?').slice(0, 1).toUpperCase()}</span>

<style>
  .av {
    width: var(--s);
    height: var(--s);
    border-radius: 50%;
    display: inline-grid;
    place-items: center;
    font-weight: 800;
    font-size: calc(var(--s) * 0.42);
    color: #1a1208;
    background: linear-gradient(135deg, hsl(var(--h) 80% 72%), hsl(var(--h) 65% 48%));
    flex: none;
  }
</style>
