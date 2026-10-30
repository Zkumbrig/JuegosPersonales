<script lang="ts">
  import { GAMES, LUDO_GAME, PARTY_GAMES, isPartyId } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const game = $derived(net.room?.game ?? 'ludo');
  const title = $derived(
    isPartyId(game) ? 'la zona Fiesta' : ([...GAMES, ...PARTY_GAMES, LUDO_GAME].find((g) => g.id === game)?.name ?? 'el juego'),
  );

  let rating = $state(0);
  let hover = $state(0);
  let comment = $state('');
  let sent = $state(false);

  const LABELS = ['', 'Malo', 'Regular', 'Bien', 'Muy bien', '¡Excelente!'];

  function send() {
    if (!rating) return;
    net.send({ t: 'review', rating, comment: comment.trim() });
    sent = true;
    setTimeout(onclose, 900);
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="overlay" role="presentation" onclick={onclose}>
  <div class="sheet panel" role="dialog" aria-modal="true" aria-label="Valorar" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <header>
      <h2 class="display gold-text">¿Qué tal {title}?</h2>
      <button class="x" onclick={onclose} aria-label="Cerrar"><Icon name="x" size={20} /></button>
    </header>

    <div class="stars" role="radiogroup" tabindex={-1} aria-label="Valoración de 1 a 5 estrellas" onmouseleave={() => (hover = 0)}>
      {#each [1, 2, 3, 4, 5] as n (n)}
        <button
          class="star"
          class:on={n <= (hover || rating)}
          role="radio"
          aria-checked={rating === n}
          aria-label="{n} {n === 1 ? 'estrella' : 'estrellas'}"
          onmouseenter={() => (hover = n)}
          onclick={() => (rating = n)}
        >
          <svg viewBox="0 0 24 24" width="38" height="38" aria-hidden="true"><path d="M12 2.8l2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.7 6.3 20l1.4-6.3L2.9 9.4l6.4-.7z" /></svg>
        </button>
      {/each}
    </div>
    <p class="label">{LABELS[hover || rating] || 'Toca las estrellas'}</p>

    <textarea bind:value={comment} maxlength="400" rows="3" placeholder="¿Algo que mejorarías? (opcional)" aria-label="Comentario"></textarea>
    <p class="note muted">Tu opinión no se muestra a otros jugadores: nos llega solo a nosotros para mejorar el juego.</p>

    <button class="btn btn-gold" disabled={!rating || sent} onclick={send}>{sent ? 'Enviado' : 'Enviar valoración'}</button>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 45; display: grid; align-items: end; justify-items: center; background: rgba(4, 3, 2, 0.7); animation: fadeUp 0.2s ease both; }
  .sheet { width: min(100%, 460px); padding: 18px 18px calc(18px + var(--safe-b)); border-radius: 22px 22px 0 0; display: grid; gap: 10px; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  h2 { margin: 0; font-size: 1.05rem; }
  .x { width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--muted); }
  .stars { display: flex; justify-content: center; gap: 6px; padding: 6px 0 0; }
  .star { padding: 2px; color: var(--line); transition: transform 0.12s, color 0.12s; }
  .star svg { fill: currentColor; stroke: rgba(0, 0, 0, 0.35); stroke-width: 0.8; display: block; }
  .star.on { color: var(--gold); transform: scale(1.08); }
  .star:active { transform: scale(0.9); }
  .label { margin: 0; text-align: center; font-family: var(--font-display); font-size: 0.82rem; color: var(--gold-hi); min-height: 1.4em; }
  textarea { width: 100%; resize: none; padding: 12px; border-radius: 14px; border: 1px solid var(--line); background: rgba(0, 0, 0, 0.35); color: var(--text); font: inherit; }
  textarea:focus { outline: none; border-color: var(--gold); }
  .note { margin: 0; text-align: center; font-size: 0.74rem; }
  @media (min-width: 560px) { .overlay { align-items: center; } .sheet { border-radius: 22px; } }
</style>
