<script lang="ts">
  import { ludo } from '$lib/game.svelte';
</script>

<div class="toasts" aria-live="polite">
  {#each ludo.toasts as t (t.id)}
    <p class="toast" class:error={t.kind === 'error'}>{t.text}</p>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    top: max(12px, env(safe-area-inset-top));
    translate: -50% 0;
    z-index: 50;
    display: grid;
    gap: 8px;
    width: min(92vw, 420px);
    pointer-events: none;
  }
  .toast {
    padding: 12px 16px;
    border-radius: 12px;
    background: #20285a;
    border: 1px solid var(--line);
    font-weight: 700;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
    animation: in 0.2s ease-out;
  }
  .toast.error {
    background: #4a1d2a;
    border-color: var(--danger);
  }
  @keyframes in {
    from { opacity: 0; transform: translateY(-8px); }
  }
</style>
