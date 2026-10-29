<script lang="ts">
  import { untrack } from 'svelte';
  import { net } from '../lib/net.svelte';
  import { vibrate } from '../lib/format';
  import { sfx } from '../lib/sound.svelte';
  import { celebrate } from '../lib/celebrate.svelte';
  import PlayingCard from './PlayingCard.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  const fp = $derived(net.room!.freepoker);
  const mySeat = $derived(fp.seats.find((s) => s.id === net.pid));
  const others = $derived(fp.seats.filter((s) => s.id !== net.pid));
  const inHand = $derived(fp.phase !== 'waiting' && fp.phase !== 'showdown');
  const myPick = $derived(inHand && !!mySeat?.inHand && !mySeat.folded && !mySeat.decided);
  const secs = $derived.by(() => {
    const ms = net.left(fp.timeLeft);
    return ms === null ? null : Math.ceil(ms / 1000);
  });

  const nameOf = (id: string) => (id === net.pid ? 'Tú' : (net.room!.players.find((p) => p.id === id)?.name ?? '?'));
  const PHASE: Record<string, string> = {
    waiting: 'Esperando jugadores', preflop: 'Antes del flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown',
  };
  const NEXT: Record<string, string> = { preflop: 'el flop', flop: 'el turn', turn: 'el river', river: 'el showdown' };

  const readyCount = $derived(fp.seats.filter((s) => s.ready).length);
  const status = $derived.by(() => {
    if (fp.phase === 'waiting') {
      if (fp.seats.length < 2) return 'Se necesitan al menos 2 jugadores sentados';
      return readyCount < 2 ? 'Presionen "Repartir" para empezar' : `Empieza pronto${secs !== null ? ` · ${secs}s` : ''}`;
    }
    if (fp.phase === 'showdown') return fp.note ?? (fp.winners.length > 1 ? 'Empate' : `Gana ${nameOf(fp.winners[0] ?? '')}`);
    if (myPick) return `¿Seguir hasta ${NEXT[fp.phase]}?${secs !== null ? ` · ${secs}s` : ''}`;
    const pending = fp.seats.filter((s) => s.inHand && !s.folded && !s.decided).length;
    return pending > 0 ? `Esperando a ${pending} ${pending === 1 ? 'jugador' : 'jugadores'}…` : 'Repartiendo…';
  });

  function choose(stay: boolean) {
    net.send({ t: 'fp:choose', stay });
    vibrate(10);
    sfx.chip();
  }

  // Sonido al repartir y celebración al ganar
  let lastCards = 0;
  let lastPhase = '';
  $effect(() => {
    const count = fp.board.length + fp.seats.reduce((n, s) => n + s.cards.length, 0);
    const phase = fp.phase;
    untrack(() => {
      if (count > lastCards) sfx.card();
      if (phase === 'showdown' && lastPhase !== 'showdown' && mySeat?.won) { sfx.win(); celebrate(false); }
      lastCards = count;
      lastPhase = phase;
    });
  });

  const wait = (s: { inHand: boolean; folded: boolean; decided: boolean; won?: boolean; hand?: string }) => {
    if (fp.phase === 'showdown' && s.inHand && !s.folded) return s.hand ?? null;
    if (s.folded && s.inHand) return 'Se retira';
    if (inHand && s.inHand) return s.decided ? 'Sigue' : 'Decidiendo…';
    return null;
  };
</script>

<div class="wrap">
  <section class="felt table" aria-live="polite">
    <div class="center">
      <span class="phase">{PHASE[fp.phase]}</span>
      <div class="board">
        {#each fp.board as card, i (i)}
          <PlayingCard {card} delay={i < 3 ? i * 140 : 0} />
        {/each}
        {#each Array(Math.max(0, 5 - fp.board.length)) as _, i (i)}
          <span class="slot" aria-hidden="true"></span>
        {/each}
      </div>
      <p class="status" class:urgent={myPick && secs !== null && secs <= 5}>{status}</p>
    </div>

    {#if others.length}
      <div class="seats">
        {#each others as s (s.id)}
          {@const b = wait(s)}
          <div class="seat" class:win={s.won} class:out={s.folded && s.inHand} class:off={!s.inHand && inHand}>
            <div class="hole">
              {#each s.cards as card, i (i)}<PlayingCard {card} delay={i * 120} />{/each}
            </div>
            <div class="info">
              <Avatar id={s.id} size={22} />
              <span class="name">{nameOf(s.id)}</span>
              <span class="wins" title="Victorias de la noche"><Icon name="trophy" size={12} />{s.wins}</span>
            </div>
            {#if b}<span class="badge" class:gold={s.won}>{b}</span>{/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if mySeat}
      {@const b = wait(mySeat)}
      <div class="seat mine" class:win={mySeat.won} class:out={mySeat.folded && mySeat.inHand} class:pulse={myPick}>
        <div class="hole big">
          {#each mySeat.cards as card, i (i)}<PlayingCard {card} delay={i * 140} />{:else}<span class="muted">Sin cartas</span>{/each}
        </div>
        <div class="info">
          <Avatar id={mySeat.id} size={22} />
          <span class="name">Tú</span>
          <span class="wins" title="Victorias de la noche"><Icon name="trophy" size={12} />{mySeat.wins}</span>
        </div>
        {#if b}<span class="badge" class:gold={mySeat.won}>{b}</span>{/if}
      </div>
    {/if}
  </section>

  <section class="controls panel">
    {#if !mySeat}
      <p class="lead">Texas Hold'em sin apostar: gana la mejor mano</p>
      <button class="btn btn-gold" disabled={fp.seats.length >= 8} onclick={() => net.send({ t: 'fp:sit' })}>Sentarme a jugar</button>
      <p class="hint muted">En cada fase decides si sigues o te retiras. Al final, la mejor mano gana la ronda.</p>
    {:else if myPick}
      <div class="actions">
        <button class="btn btn-ghost" onclick={() => choose(false)}>Retirarme</button>
        <button class="btn btn-gold" onclick={() => choose(true)}>Seguir</button>
      </div>
    {:else if fp.phase === 'waiting'}
      <div class="actions">
        <button class="btn btn-ghost" onclick={() => net.send({ t: 'fp:stand' })}>Levantarme</button>
        <button class="btn btn-gold" disabled={mySeat.ready} onclick={() => net.send({ t: 'fp:ready' })}>{mySeat.ready ? 'Listo' : 'Repartir mano'}</button>
      </div>
    {:else}
      <p class="wait muted">
        {mySeat.inHand ? (mySeat.folded ? 'Te retiraste. Espera a la siguiente mano.' : fp.phase === 'showdown' ? 'Mano terminada.' : 'Esperando al resto…') : 'Entras en la próxima mano.'}
      </p>
      {#if !mySeat.inHand || fp.phase === 'showdown'}<button class="btn btn-ghost small" onclick={() => net.send({ t: 'fp:stand' })}>Levantarme</button>{/if}
    {/if}
  </section>
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 10px; }
  .table { padding: 14px 10px 16px; display: flex; flex-direction: column; gap: 26px; min-height: 380px; }
  .center { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  .phase { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.25em; color: rgba(255, 255, 255, 0.55); }
  .board { display: flex; gap: 5px; --card-w: 50px; min-height: 71px; }
  .slot { width: 50px; height: 71px; border-radius: 6px; border: 1.5px dashed rgb(var(--accent-rgb) / 0.3); }
  .status { margin: 0; text-align: center; font-family: var(--font-display); font-weight: 600; font-size: 0.85rem; line-height: 1.4; color: var(--gold-hi); min-height: 1.5em; }
  .status.urgent { color: #ffb3a8; }

  .seats { position: relative; z-index: 1; display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 8px; }
  .seat { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 8px 8px; border-radius: 16px; background: rgba(0, 0, 0, 0.24); min-width: 98px; border: 1px solid transparent; }
  .seat.mine { z-index: 1; align-self: center; width: 100%; max-width: 280px; background: rgba(0, 0, 0, 0.34); }
  .seat.out { opacity: 0.5; }
  .seat.off { opacity: 0.4; }
  .seat.win { border-color: var(--gold-hi); background: rgb(var(--accent-rgb) / 0.14); }
  .hole { display: flex; --card-w: 36px; min-height: 51px; }
  .hole.big { --card-w: 62px; min-height: 88px; align-items: center; }
  .hole > :global(.card:not(:first-child)) { margin-left: -10px; }
  .hole.big > :global(.card:not(:first-child)) { margin-left: -6px; }
  .info { display: flex; align-items: center; gap: 6px; }
  .name { font-size: 0.78rem; color: rgba(255, 255, 255, 0.85); max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .wins { display: inline-flex; align-items: center; gap: 2px; font-weight: 800; font-size: 0.74rem; color: var(--gold-hi); }
  .badge { position: absolute; top: -10px; padding: 2px 10px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; white-space: nowrap; background: #cdbf9d; color: #2b2210; animation: fadeUp 0.25s ease both; }
  .badge.gold { background: var(--gold-grad); color: var(--on-accent); }

  .controls { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .lead { margin: 0; text-align: center; font-family: var(--font-display); font-weight: 600; font-size: 0.9rem; color: var(--gold-hi); }
  .hint { margin: 0; text-align: center; font-size: 0.78rem; }
  .actions { display: grid; grid-template-columns: 1fr 1.5fr; gap: 8px; }
  .wait { margin: 0; text-align: center; padding: 8px 0; }
  .btn.small { min-height: 34px; padding: 0 14px; font-size: 0.7rem; align-self: center; }
</style>
