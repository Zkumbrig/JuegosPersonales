<script lang="ts">
  import { untrack } from 'svelte';
  import { POKER_BB, POKER_BUYINS, POKER_SB, type PokerSeat } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import { fmt, signed, vibrate } from '../lib/format';
  import { sfx } from '../lib/sound.svelte';
  import { celebrate } from '../lib/celebrate.svelte';
  import PlayingCard from './PlayingCard.svelte';
  import Chip from './Chip.svelte';
  import ChipStack from './ChipStack.svelte';
  import PlayerStrip from './PlayerStrip.svelte';

  const pk = $derived(net.room!.poker);
  const me = $derived(net.me);
  const mySeat = $derived(pk.seats.find((s) => s.id === net.pid));
  const others = $derived(pk.seats.filter((s) => s.id !== net.pid));
  const inHand = $derived(pk.phase !== 'waiting' && pk.phase !== 'showdown');
  const myTurn = $derived(inHand && pk.toAct === net.pid);
  const secs = $derived.by(() => {
    const ms = net.left(pk.timeLeft);
    return ms === null ? null : Math.ceil(ms / 1000);
  });

  const nameOf = (id: string) => (id === net.pid ? 'Tú' : (net.room!.players.find((p) => p.id === id)?.name ?? '?'));
  const PHASE: Record<string, string> = {
    waiting: 'Esperando jugadores', preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown',
  };

  // ---------- Acciones ----------
  const toCall = $derived(mySeat ? Math.max(0, pk.currentBet - mySeat.bet) : 0);
  const maxTo = $derived(mySeat ? mySeat.bet + mySeat.stack : 0);
  const minTo = $derived(Math.min(pk.minRaiseTo, maxTo));
  const canRaise = $derived(myTurn && !!mySeat && maxTo > pk.currentBet);
  const callLabel = $derived(toCall === 0 ? 'Pasar' : mySeat && toCall >= mySeat.stack ? `All-in ${fmt(mySeat.stack)}` : `Igualar ${fmt(toCall)}`);

  let raiseTo = $state(0);
  const clamp = (v: number) => Math.max(minTo, Math.min(maxTo, Math.round(v / 10) * 10 || minTo));
  $effect(() => {
    // Cada vez que me toca (o cambia la apuesta) el selector vuelve a la subida mínima.
    if (myTurn) { void pk.currentBet; untrack(() => (raiseTo = minTo)); }
  });
  const potAfterCall = $derived(pk.pot + toCall);
  const presets = $derived([
    { label: 'Mín', to: minTo },
    { label: '½ bote', to: clamp(pk.currentBet + potAfterCall / 2) },
    { label: 'Bote', to: clamp(pk.currentBet + potAfterCall) },
    { label: 'All-in', to: maxTo },
  ]);

  const send = (action: 'fold' | 'check' | 'call' | 'raise', amount?: number) => {
    net.send({ t: 'po:act', action, amount });
    vibrate(10);
  };
  const raise = () => { send('raise', Math.min(maxTo, Math.max(minTo, raiseTo))); sfx.chip(); };

  // ---------- Sonido / celebración ----------
  let lastCards = 0;
  let lastPhase = '';
  let lastPot = 0;
  $effect(() => {
    const count = pk.board.length + pk.seats.reduce((n, s) => n + s.cards.length, 0);
    const phase = pk.phase;
    const pot = pk.pot;
    untrack(() => {
      if (count > lastCards) sfx.card();
      if (pot > lastPot) sfx.chip();
      if (phase === 'showdown' && lastPhase !== 'showdown' && mySeat?.delta !== undefined && mySeat.inHand) {
        if (mySeat.delta > 0) { sfx.win(); celebrate(mySeat.delta >= 500); }
        else if (mySeat.delta < 0 && !mySeat.folded) sfx.lose();
      }
      lastCards = count;
      lastPhase = phase;
      lastPot = pot;
    });
  });

  const readyCount = $derived(pk.seats.filter((s) => s.ready).length);
  const status = $derived.by(() => {
    if (pk.phase === 'waiting') {
      if (pk.seats.length < 2) return 'Se necesitan al menos 2 jugadores';
      return readyCount < 2 ? 'Presionen "Repartir" para empezar' : `Empieza pronto${secs !== null ? ` · ${secs}s` : ''}`;
    }
    if (pk.phase === 'showdown') return 'Fin de la mano';
    if (pk.toAct) return pk.toAct === net.pid ? `Tu turno${secs !== null ? ` · ${secs}s` : ''}` : `Turno de ${nameOf(pk.toAct)}`;
    return 'Repartiendo…';
  });

  function badge(s: PokerSeat): string | null {
    if (pk.phase === 'showdown' && s.inHand) return s.hand ?? null;
    if (s.folded && s.inHand) return 'Se retira';
    if (s.allIn) return 'All-in';
    return inHand && s.inHand ? (s.last ?? null) : null;
  }
</script>

<div class="wrap">
  <PlayerStrip activeId={myTurn || !pk.toAct ? null : pk.toAct} />

  <section class="felt table" aria-live="polite">
    <div class="center">
      <span class="phase">{PHASE[pk.phase]}</span>
      <div class="pot">
        {#if pk.pot > 0}<ChipStack amount={pk.pot} />{:else}<span class="muted">Bote vacío</span>{/if}
      </div>
      <div class="board">
        {#each pk.board as card, i (i)}
          <PlayingCard {card} delay={i < 3 ? i * 140 : 0} />
        {/each}
        {#each Array(Math.max(0, 5 - pk.board.length)) as _, i (i)}
          <span class="slot" aria-hidden="true"></span>
        {/each}
      </div>
      <p class="status" class:urgent={myTurn && secs !== null && secs <= 5}>{status}</p>
    </div>

    {#if others.length}
      <div class="seats">
        {#each others as s (s.id)}
          {@const b = badge(s)}
          <div class="seat" class:pulse={pk.toAct === s.id} class:out={s.folded && s.inHand} class:off={!s.inHand && inHand}>
            <div class="hole">
              {#each s.cards as card, i (i)}<PlayingCard {card} delay={i * 120} />{/each}
            </div>
            <div class="info">
              <span class="name">{#if s.button}<i class="dealer-btn" title="Dealer">D</i>{/if}{nameOf(s.id)}</span>
              <span class="stack num">{fmt(s.stack)}</span>
            </div>
            {#if s.bet > 0}<div class="bet"><ChipStack amount={s.bet} /></div>{/if}
            {#if b}<span class="badge" class:win={s.delta !== undefined && s.delta > 0}>{b}</span>{/if}
            {#if pk.phase === 'showdown' && s.delta !== undefined && s.inHand}
              <span class="delta" class:pos={s.delta > 0} class:neg={s.delta < 0}>{signed(s.delta)}</span>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if mySeat}
      {@const b = badge(mySeat)}
      <div class="seat mine" class:pulse={myTurn} class:out={mySeat.folded && mySeat.inHand}>
        <div class="hole big">
          {#each mySeat.cards as card, i (i)}<PlayingCard {card} delay={i * 140} />{:else}<span class="muted">Sin cartas</span>{/each}
        </div>
        <div class="info">
          <span class="name">{#if mySeat.button}<i class="dealer-btn">D</i>{/if}Tú</span>
          <span class="stack num">{fmt(mySeat.stack)}</span>
        </div>
        {#if mySeat.bet > 0}<div class="bet"><ChipStack amount={mySeat.bet} /></div>{/if}
        {#if b}<span class="badge" class:win={mySeat.delta !== undefined && mySeat.delta > 0}>{b}</span>{/if}
        {#if pk.phase === 'showdown' && mySeat.delta !== undefined && mySeat.inHand}
          <span class="delta" class:pos={mySeat.delta > 0} class:neg={mySeat.delta < 0}>{signed(mySeat.delta)}</span>
        {/if}
      </div>
    {/if}
  </section>

  <section class="controls panel">
    {#if !mySeat}
      <p class="lead">Siéntate a la mesa · ciegas {POKER_SB}/{POKER_BB}</p>
      <div class="rack">
        {#each POKER_BUYINS as v (v)}
          <Chip value={v} size={60} disabled={(me?.chips ?? 0) < v} onclick={() => net.send({ t: 'po:sit', buyin: v })} />
        {/each}
      </div>
      <p class="hint muted">Elige con cuántas fichas entras. Al salir, las que te queden vuelven a tu cartera.</p>
    {:else if myTurn}
      <div class="actions">
        <button class="btn btn-ghost" onclick={() => send('fold')}>Retirarme</button>
        <button class="btn btn-gold" onclick={() => send(toCall === 0 ? 'check' : 'call')}>{callLabel}</button>
      </div>
      {#if canRaise}
        <div class="raise">
          <div class="presets">
            {#each presets as p (p.label)}
              <button class="chipbtn" class:on={raiseTo === p.to} onclick={() => (raiseTo = p.to)}>{p.label}</button>
            {/each}
          </div>
          <input type="range" min={minTo} max={maxTo} step="10" bind:value={raiseTo} aria-label="Cantidad a subir" />
          <button class="btn btn-ghost" onclick={raise}>{pk.currentBet === 0 ? 'Apostar' : 'Subir a'} {fmt(Math.min(maxTo, Math.max(minTo, raiseTo)))}</button>
        </div>
      {/if}
    {:else if pk.phase === 'waiting'}
      <div class="actions">
        <button class="btn btn-ghost" onclick={() => net.send({ t: 'po:stand' })}>Levantarme</button>
        <button class="btn btn-gold" disabled={mySeat.ready || mySeat.stack === 0} onclick={() => net.send({ t: 'po:ready' })}>
          {mySeat.ready ? 'Listo' : 'Repartir mano'}
        </button>
      </div>
    {:else}
      <p class="wait muted">
        {mySeat.inHand ? (mySeat.folded ? 'Te retiraste. Espera a la siguiente mano.' : 'Esperando al resto…') : 'Entras en la próxima mano.'}
      </p>
      {#if !mySeat.inHand}<button class="btn btn-ghost small" onclick={() => net.send({ t: 'po:stand' })}>Levantarme</button>{/if}
    {/if}
  </section>
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 10px; }
  .table { padding: 14px 10px 16px; display: flex; flex-direction: column; gap: 26px; min-height: 380px; }
  .center { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .phase { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.25em; color: rgba(255, 255, 255, 0.55); }
  .pot { min-height: 28px; display: flex; align-items: center; font-weight: 700; }
  .board { display: flex; gap: 5px; --card-w: 50px; min-height: 71px; }
  .slot { width: 50px; height: 71px; border-radius: 6px; border: 1.5px dashed rgb(var(--accent-rgb) / 0.3); }
  .status { margin: 0; text-align: center; font-family: var(--font-display); font-weight: 600; font-size: 0.85rem; line-height: 1.4; color: var(--gold-hi); min-height: 1.5em; }
  .status.urgent { color: #ffb3a8; }

  .seats { position: relative; z-index: 1; display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 8px; }
  .seat {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 10px 8px 8px; border-radius: 16px; background: rgba(0, 0, 0, 0.24); min-width: 98px;
  }
  .seat.mine { z-index: 1; align-self: center; width: 100%; max-width: 280px; background: rgba(0, 0, 0, 0.34); }
  .seat.out { opacity: 0.5; }
  .seat.off { opacity: 0.4; }
  .hole { display: flex; --card-w: 36px; min-height: 51px; }
  .hole.big { --card-w: 62px; min-height: 88px; align-items: center; }
  .hole > :global(.card:not(:first-child)) { margin-left: -10px; }
  .hole.big > :global(.card:not(:first-child)) { margin-left: -6px; }
  .info { display: flex; align-items: baseline; gap: 8px; }
  .name { font-size: 0.78rem; color: rgba(255, 255, 255, 0.8); max-width: 80px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
  .stack { font-weight: 800; color: var(--gold-hi); font-size: 0.9rem; }
  .dealer-btn { font-style: normal; font-weight: 800; font-size: 0.62rem; width: 17px; height: 17px; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ivory); color: #1a1208; }
  .bet { min-height: 24px; }
  .badge {
    position: absolute; top: -10px; padding: 2px 10px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; white-space: nowrap;
    background: #cdbf9d; color: #2b2210; animation: fadeUp 0.25s ease both;
  }
  .badge.win { background: var(--gold-grad); color: var(--on-accent); }
  .delta { position: absolute; bottom: -9px; padding: 1px 9px; border-radius: 999px; font-weight: 800; font-size: 0.78rem; background: #1b1812; border: 1px solid var(--line); }
  .delta.pos { color: var(--ok); border-color: var(--ok); } .delta.neg { color: #ff9b90; }

  .controls { padding: 14px; display: flex; flex-direction: column; gap: 10px; }
  .lead { margin: 0; text-align: center; font-family: var(--font-display); font-weight: 600; font-size: 0.9rem; color: var(--gold-hi); }
  .rack { display: flex; justify-content: space-around; padding: 6px 0; }
  .hint { margin: 0; text-align: center; font-size: 0.78rem; }
  .actions { display: grid; grid-template-columns: 1fr 1.5fr; gap: 8px; }
  .raise { display: grid; gap: 10px; padding-top: 4px; }
  .presets { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .chipbtn { min-height: 36px; border-radius: 999px; border: 1px solid var(--line); font-size: 0.74rem; font-weight: 700; color: var(--muted); }
  .chipbtn.on { border-color: var(--gold); color: var(--gold-hi); background: rgb(var(--accent-rgb) / 0.12); }
  input[type='range'] { width: 100%; accent-color: var(--gold); height: 28px; }
  .wait { margin: 0; text-align: center; padding: 8px 0; }
  .btn.small { min-height: 34px; padding: 0 14px; font-size: 0.7rem; align-self: center; }
</style>
