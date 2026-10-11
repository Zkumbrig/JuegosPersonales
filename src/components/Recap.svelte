<script lang="ts">
  import { onMount } from 'svelte';
  import { BRAND } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import { computeAwards, renderRecap } from '../lib/recap';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let src = $state('');
  let blob: Blob | null = null;
  let status = $state<'loading' | 'ready' | 'empty' | 'error'>('loading');
  let note = $state('');
  const canShare = typeof navigator !== 'undefined' && typeof navigator.canShare === 'function';

  onMount(async () => {
    const room = net.room;
    if (!room) return;
    if (computeAwards(room.stats, room.party.soft).length === 0) { status = 'empty'; return; }
    try {
      const canvas = await renderRecap(room.stats, room.party.soft, room.code);
      src = canvas.toDataURL('image/png');
      blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      status = 'ready';
    } catch {
      status = 'error';
    }
  });

  function save() {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'resumen-royale-club.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    note = 'Imagen guardada';
  }

  async function share() {
    if (!blob) return;
    const file = new File([blob], 'resumen-royale-club.png', { type: 'image/png' });
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Resumen de la noche · ${BRAND}`, text: `Mi noche en ${BRAND}` });
      } else {
        save();
      }
    } catch { /* cancelado */ }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="overlay" role="presentation" onclick={onclose}>
  <div class="sheet panel" role="dialog" aria-modal="true" aria-label="Resumen de la noche" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <header>
      <h2 class="display">Resumen de la noche</h2>
      <button class="x" onclick={onclose} aria-label="Cerrar"><Icon name="x" size={20} /></button>
    </header>

    {#if status === 'loading'}
      <p class="muted center">Preparando la imagen…</p>
    {:else if status === 'empty'}
      <p class="muted center">Todavía no hay premios que repartir. Jueguen unas rondas y vuelvan por aquí.</p>
    {:else if status === 'error'}
      <p class="muted center">No se pudo crear la imagen en este navegador.</p>
    {:else}
      <img {src} alt="Resumen de la noche con los premios de cada jugador" />
      <div class="actions">
        {#if canShare}
          <button class="btn btn-gold" onclick={share}><Icon name="share" size={16} /> Compartir</button>
        {/if}
        <button class="btn btn-ghost" onclick={save}>{note || 'Guardar imagen'}</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, 0.7); display: flex; align-items: flex-end; justify-content: center; animation: fade 0.18s ease both; }
  .sheet {
    width: 100%; max-width: 520px; max-height: 92dvh; overflow-y: auto; border-radius: 22px 22px 0 0; border-bottom: 0; background: var(--panel);
    padding: 16px 16px calc(18px + var(--safe-b)); display: flex; flex-direction: column; gap: 14px; animation: rise 0.25s cubic-bezier(0.2, 0.9, 0.3, 1) both;
  }
  header { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  h2 { margin: 0; font-size: 1.05rem; font-weight: 800; color: var(--gold-hi); }
  .x { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); display: grid; place-items: center; color: var(--gold-hi); flex: none; }
  img { width: 100%; height: auto; border-radius: 16px; display: block; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); }
  .actions { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; }
  .center { text-align: center; margin: 14px 0; line-height: 1.5; }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes rise { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
