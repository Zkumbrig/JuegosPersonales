<script lang="ts">
  import { untrack } from 'svelte';
  import { CHIP_VALUES, type BJHand, type BJSeat } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import { fmt, handTotal, signed, vibrate } from '../lib/format';
  import { sfx } from '../lib/sound.svelte';
  import { celebrate } from '../lib/celebrate.svelte';
  import PlayingCard from './PlayingCard.svelte';
  import Chip from './Chip.svelte';
  import ChipStack from './ChipStack.svelte';
  import Suit from './Suit.svelte';
  import Icon from './Icon.svelte';
  import PlayerStrip from './PlayerStrip.svelte';

  const bj = $derived(net.room!.blackjack);
  const me = $derived(net.me);
  const chips = $derived(me?.chips ?? 0);
  const mySeat = $derived(bj.seats.find((s) => s.id === net.pid));
  const myTurn = $derived(bj.phase === 'playing' && bj.turn === net.pid);
  const activeHand = $derived(mySeat?.hands[mySeat.active]);
  const secs = $derived.by(() => {
    const ms = net.left(bj.timeLeft);
    return ms === null ? null : Math.ceil(ms / 1000);
  });
  const dealerInfo = $derived(handTotal(bj.dealer));

  /** Puntos de una carta para decidir si es un par (As = 11, figuras = 10). */
  const pts = (c: BJHand['cards'][number]) => ('hidden' in c ? -1 : c.r === 'A' ? 11 : 'JQK'.includes(c.r) ? 10 : Number(c.r));
  const canDouble = $derived(myTurn && !!activeHand && activeHand.cards.length === 2 && chips >= activeHand.bet);
  const canSplit = $derived(
    myTurn && !!mySeat && !!activeHand && mySeat.hands.length === 1 && activeHand.cards.length === 2 &&
      pts(activeHand.cards[0]) === pts(activeHand.cards[1]) && chips >= activeHand.bet,
  );
  const insuranceCost = $derived(mySeat ? Math.floor(mySeat.bet / 2) : 0);

  const nameOf = (id: string) => net.room!.players.find((p) => p.id === id)?.name ?? '?';
  const label = (s: BJSeat) => (s.id === net.pid ? 'Tú' : nameOf(s.id));

  let selected = $state(50);
  $effect(() => {
    // Si ya no alcanza para la ficha elegida, baja a la más grande posible.
    if (selected > chips) {
      const fit = [...CHIP_VALUES].reverse().find((v) => v <= chips);
      if (fit) selected = fit;
    }
  });

  function bet(v: number) {
    selected = v;
    net.send({ t: 'bj:bet', amount: v });
    sfx.chip();
    vibrate(8);
  }

  // Sonido al repartir y al resolver la ronda
  let lastCards = 0;
  let lastPhase = '';
  $effect(() => {
    const count = bj.dealer.length + bj.seats.reduce((n, s) => n + s.hands.reduce((m, h) => m + h.cards.length, 0), 0);
    const phase = bj.phase;
    untrack(() => {
      if (count > lastCards) sfx.card();
      if (phase === 'payout' && lastPhase !== 'payout' && mySeat?.delta !== undefined) {
        if (mySeat.delta > 0) { sfx.win(); celebrate(mySeat.hands.length === 1 && mySeat.hands[0].result === 'blackjack'); }
        else if (mySeat.delta < 0) sfx.lose();
      }
      lastCards = count;
      lastPhase = phase;
    });
  });

  function badge(h: BJHand): { text: string; cls: string } | null {
    if (bj.phase === 'payout' && h.result) {
      const d = h.delta ?? 0;
      if (h.result === 'blackjack') return { text: `Blackjack ${signed(d)}`, cls: 'gold' };
      if (h.result === 'win') return { text: `Gana ${signed(d)}`, cls: 'win' };
      if (h.result === 'push') return { text: 'Empate', cls: 'push' };
      return { text: `Pierde ${signed(d)}`, cls: 'lose' };
    }
    if (h.status === 'bust') return { text: 'Se pasa', cls: 'lose' };
    if (h.status === 'blackjack') return { text: 'Blackjack', cls: 'gold' };
    if (h.status === 'stand' && bj.phase !== 'betting') return { text: h.doubled ? 'Dobla' : 'Se planta', cls: 'push' };
    return null;
  }

  const status = $derived.by(() => {
    if (bj.phase === 'betting')
      return bj.seats.length === 0 ? 'Haz tu apuesta para abrir la ronda' : `Apuestas abiertas${secs !== null ? ` · ${secs}s` : ''}`;
    if (bj.phase === 'insurance') return `El crupier enseña un As: ¿seguro?${secs !== null ? ` · ${secs}s` : ''}`;
    if (bj.phase === 'playing')
      return bj.turn === net.pid ? `Tu turno${secs !== null ? ` · ${secs}s` : ''}` : `Turno de ${bj.turn ? nameOf(bj.turn) : '…'}`;
    if (bj.phase === 'dealer') return 'Juega el crupier…';
    return 'Resultado de la ronda';
  });
</script>

<div class="wrap">
  <PlayerStrip activeId={bj.phase === 'playing' ? bj.turn : null} />

  <section class="felt table" aria-live="polite">
    {#if bj.phase === 'betting'}
      <svg class="deco" viewBox="0 0 300 70" aria-hidden="true">
        <path id="arc" d="M18 62 Q150 4 282 62" fill="none" />
        <text><textPath href="#arc" startOffset="50%" text-anchor="middle">BLACKJACK PAGA 3 A 2</textPath></text>
      </svg>
    {/if}
    <div class="dealer">
      <span class="who">Crupier</span>
      <div class="hand big">
        {#each bj.dealer as card, i (i)}
          <PlayingCard {card} delay={bj.dealer.length <= 2 ? i * 200 + 120 : 0} />
        {:else}
          <span class="empty-hand"><Suit s="S" size={16} /><Suit s="H" size={16} /><Suit s="D" size={16} /><Suit s="C" size={16} /></span>
        {/each}
      </div>
      {#if bj.dealer.length}
        <span class="total">{dealerInfo.total}{bj.dealer.some((c) => 'hidden' in c) ? '+' : ''}</span>
      {/if}
    </div>

    <p class="status" class:urgent={secs !== null && secs <= 5 && bj.phase !== 'payout'}>{status}</p>

    <div class="seats">
      {#each bj.seats as seat, si (seat.id)}
        <div class="seat" class:mine={seat.id === net.pid} class:turn={bj.turn === seat.id}>
          <div class="hands">
            {#each seat.hands as h, hi (hi)}
              {@const t = handTotal(h.cards)}
              {@const b = badge(h)}
              <div class="hbox" class:current={bj.turn === seat.id && seat.active === hi && seat.hands.length > 1}>
                <div class="hand" class:small={seat.id !== net.pid || seat.hands.length > 1}>
                  {#each h.cards as card, i (i)}
                    <PlayingCard {card} delay={h.cards.length <= 2 ? (i * bj.seats.length + si) * 200 : 0} />
                  {/each}
                </div>
                {#if h.cards.length}<span class="total small">{t.total}{t.soft && t.total < 21 ? ' blanda' : ''}</span>{/if}
                {#if seat.hands.length > 1}<ChipStack amount={h.bet} />{/if}
                {#if b}<span class="badge {b.cls}">{b.text}</span>{/if}
              </div>
            {/each}
          </div>
          <div class="meta">
            <span class="sname">{label(seat)}</span>
            {#if seat.hands.length === 1}<ChipStack amount={seat.bet} />{/if}
            {#if seat.insurance > 0}<span class="ins" title="Seguro"><Icon name="lock" size={12} /> {fmt(seat.insurance)}</span>{/if}
            {#if bj.phase === 'payout' && seat.delta !== undefined && (seat.hands.length > 1 || seat.insurance > 0)}
              <span class="net" class:pos={seat.delta > 0} class:neg={seat.delta < 0}>{signed(seat.delta)}</span>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="controls panel">
    {#if myTurn}
      <div class="actions" class:four={canSplit}>
        <button class="btn btn-gold" onclick={() => net.send({ t: 'bj:hit' })}>Pedir</button>
        <button class="btn btn-ghost" onclick={() => net.send({ t: 'bj:stand' })}>Plantarme</button>
        <button class="btn btn-ghost" disabled={!canDouble} onclick={() => net.send({ t: 'bj:double' })}>Doblar</button>
        {#if canSplit}<button class="btn btn-ghost" onclick={() => net.send({ t: 'bj:split' })}>Dividir</button>{/if}
      </div>
      {#if mySeat && mySeat.hands.length > 1}
        <p class="wait muted">Mano {mySeat.active + 1} de {mySeat.hands.length}</p>
      {/if}
    {:else if bj.phase === 'insurance'}
      {#if mySeat && !mySeat.decided}
        <p class="ask">El crupier enseña un <b>As</b>. El seguro cuesta <b>{fmt(insuranceCost)}</b> y paga 2 a 1 si tiene Blackjack.</p>
        <div class="two">
          <button class="btn btn-gold" disabled={chips < insuranceCost || insuranceCost < 1} onclick={() => net.send({ t: 'bj:insure', take: true })}>Asegurar</button>
          <button class="btn btn-ghost" onclick={() => net.send({ t: 'bj:insure', take: false })}>Sin seguro</button>
        </div>
      {:else}
        <p class="wait muted">{mySeat ? (mySeat.insurance > 0 ? 'Seguro hecho. Esperando al resto…' : 'Sin seguro. Esperando al resto…') : 'Ronda en curso. Apuesta en la siguiente.'}</p>
      {/if}
    {:else if bj.phase === 'betting'}
      <div class="rack">
        {#each CHIP_VALUES as v (v)}
          <Chip value={v} selected={selected === v} disabled={chips < v} onclick={() => bet(v)} />
        {/each}
      </div>
      <div class="betline">
        <span>{mySeat ? `Tu apuesta: ${fmt(mySeat.bet)}` : 'Toca una ficha para apostar'}</span>
        {#if mySeat}<button class="btn btn-ghost small" onclick={() => net.send({ t: 'bj:clear' })}>Quitar</button>{/if}
      </div>
    {:else}
      <p class="wait muted">
        {mySeat ? 'Esperando al resto de jugadores…' : 'Ronda en curso. Apuesta en la siguiente.'}
      </p>
    {/if}
  </section>
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 10px; }
  .table { padding: 14px 10px 12px; display: flex; flex-direction: column; gap: 10px; min-height: 360px; }
  .deco { position: absolute; left: 0; right: 0; top: 150px; width: 100%; height: 70px; pointer-events: none; }
  .deco text { font-family: var(--font-display); font-size: 13px; font-weight: 700; letter-spacing: 4px; fill: var(--gold); opacity: 0.32; }
  .dealer, .status, .seats { position: relative; z-index: 1; }
  .dealer { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .who { font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.25em; color: rgba(255, 255, 255, 0.55); }
  .hand { display: flex; justify-content: center; min-height: 40px; --card-w: 58px; }
  .hand.big { --card-w: 62px; min-height: 88px; }
  .hand.small { --card-w: 42px; }
  .hand > :global(.card:not(:first-child)) { margin-left: -16px; }
  .hand.small > :global(.card:not(:first-child)) { margin-left: -12px; }
  .empty-hand { align-self: center; display: inline-flex; gap: 14px; color: rgba(255, 255, 255, 0.22); }
  .total {
    background: rgba(0, 0, 0, 0.45);
    border: 1px solid var(--gold-lo);
    color: var(--gold-hi);
    border-radius: 999px;
    padding: 1px 12px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }
  .total.small { font-size: 0.72rem; padding: 0 8px; }
  .status {
    margin: 0;
    text-align: center;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.88rem;
    line-height: 1.4;
    color: var(--gold-hi);
    min-height: 1.6em;
  }
  .status.urgent { color: #ffb3a8; }
  .seats { display: flex; flex-wrap: wrap; justify-content: center; gap: 12px 8px; }
  .seat {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 8px 8px;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.22);
    border: 1px solid transparent;
    min-width: 96px;
    animation: fadeUp 0.3s ease both;
  }
  .seat.mine { flex-basis: 100%; max-width: 280px; background: rgba(0, 0, 0, 0.32); }
  .seat.turn { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.12); }
  .meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: center; }
  .sname { font-size: 0.78rem; color: rgba(255, 255, 255, 0.75); max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge {
    position: absolute;
    top: -8px;
    padding: 2px 10px;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    white-space: nowrap;
    animation: fadeUp 0.3s ease both;
  }
  .badge.win { background: var(--ok); color: #05260f; }
  .badge.lose { background: var(--danger); color: #fff; }
  .badge.push { background: #cdbf9d; color: #2b2210; }
  .badge.gold { background: var(--gold-grad); color: #2a1c05; }

  .controls { padding: 14px; }
  .actions { display: grid; grid-template-columns: 1.3fr 1.3fr 1fr; gap: 8px; }
  .actions .btn { padding: 0 8px; }
  .rack { display: flex; justify-content: space-between; align-items: flex-end; padding: 8px 4px 4px; }
  .betline { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; font-size: 0.9rem; color: var(--muted); min-height: 36px; }
  .btn.small { min-height: 34px; padding: 0 14px; font-size: 0.7rem; }
  .wait { margin: 0; text-align: center; padding: 10px 0; }

  .hands { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px 14px; }
  .hbox { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 6px 4px; border-radius: 12px; border: 1px solid transparent; }
  .hbox.current { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.1); }
  .ins { display: inline-flex; align-items: center; gap: 3px; font-size: 0.72rem; font-weight: 700; padding: 1px 8px; border-radius: 99px; background: rgb(var(--accent-rgb) / 0.16); color: var(--gold-hi); }
  .net { font-weight: 800; font-size: 0.8rem; padding: 1px 9px; border-radius: 99px; background: rgba(0, 0, 0, 0.4); border: 1px solid var(--line); }
  .net.pos { color: var(--ok); border-color: var(--ok); } .net.neg { color: #ff9b90; }
  .ask { margin: 0 0 10px; text-align: center; font-size: 0.92rem; line-height: 1.45; }
  .ask b { color: var(--gold-hi); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .actions { grid-template-columns: 1.3fr 1.3fr 1fr; gap: 8px; }
  .actions.four { grid-template-columns: 1fr 1fr; }
  .actions .btn { padding: 0 6px; min-width: 0; }
</style>
