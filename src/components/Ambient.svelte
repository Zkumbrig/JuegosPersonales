<script lang="ts">
  // Color de ambiente detrás del juego: un tono suave propio del juego y, cuando pasa algo, una ola de color que se apaga sola.
  // Solo opacidad y escala (no pesa). `washKey` cambia cuando hay que repetir la ola; con `washColor` null no hay ola.
  let {
    tone,
    washColor = null,
    washKey = '',
    strong = false,
    toneKey = '',
  }: { tone: string; washColor?: string | null; washKey?: string; strong?: boolean; toneKey?: string } = $props();
</script>

<div class="amb" aria-hidden="true">
  {#key toneKey || tone}<i class="base" style:--c={tone}></i>{/key}
  {#key washKey}
    {#if washColor}<i class="wash" class:me={strong} style:--c={washColor}></i>{/if}
  {/key}
</div>

<style>
  .amb { position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
  .amb i { position: absolute; inset: -25%; }
  .base { background: radial-gradient(85% 60% at 50% 100%, var(--c) 0%, transparent 75%); opacity: 0.5; animation: ambIn 1.4s ease both; }
  .wash { background: radial-gradient(95% 70% at 50% 55%, var(--c) 0%, transparent 72%); opacity: 0; animation: wash 3s ease-out both; }
  .wash.me { animation-name: washMe; }
  @keyframes ambIn { from { opacity: 0; } to { opacity: 0.5; } }
  @keyframes wash { 0% { opacity: 0; transform: scale(0.85); } 20% { opacity: 0.85; } 100% { opacity: 0.4; transform: scale(1.1); } }
  @keyframes washMe { 0% { opacity: 0; transform: scale(0.8); } 18% { opacity: 1; } 100% { opacity: 0.5; transform: scale(1.12); } }
</style>
