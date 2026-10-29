<script lang="ts">
  import { onMount } from 'svelte';
  import { GAMES, LEVELS, LUDO_GAME, PARTY_GAMES, isPartyId, type BJHand, type Card, type PartyGame } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import { fmt, handTotal, signed } from '../lib/format';
  import { soften } from '../lib/party';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Flames from './Flames.svelte';
  import Logo from './Logo.svelte';
  import Wheel from './Wheel.svelte';
  import PlayingCard from './PlayingCard.svelte';
  import ChipStack from './ChipStack.svelte';
  import Reactions from './Reactions.svelte';
  import LudoTv from './ludo/LudoTv.svelte';

  let { code }: { code: string } = $props();

  onMount(() => net.joinScreen(code));

  const room = $derived(net.room);
  const game = $derived(room?.game);
  const party = $derived(room ? isPartyId(room.game) : false);
  const pa = $derived(room?.party);
  const bj = $derived(room?.blackjack);
  const ro = $derived(room?.roulette);
  const pk = $derived(room?.poker);
  const soft = $derived(!!pa?.soft);
  const t = (s: string | null | undefined) => soften(s ?? '', soft);
  const joinUrl = $derived(`${location.origin}/?sala=${code}`);

  const nameOf = (id: string) => room?.players.find((p) => p.id === id)?.name ?? '?';
  const names = (ids: string[]) => (ids.length ? ids.map(nameOf).join(', ') : '');
  const info = $derived(
    game && game !== 'party'
      ? ([...GAMES, ...PARTY_GAMES, LUDO_GAME].find((g) => g.id === game) as { name: string; id: string } | undefined)
      : undefined,
  );
  const gameIcon = $derived(game === 'party' ? 'party' : (info?.id ?? 'chip'));
  const level = $derived(LEVELS.find((l) => l.id === pa?.level));
  const live = $derived((room?.players ?? []).filter((p) => p.connected));

  // ---- Fiesta ----
  const votes = $derived.by(() => {
    const m = new Map<string, string[]>();
    for (const [voter, pick] of Object.entries(pa?.picks ?? {})) m.set(pick, [...(m.get(pick) ?? []), voter]);
    return m;
  });
  const likelyRows = $derived((room?.players ?? []).map((p) => ({ id: p.id, n: votes.get(p.id)?.length ?? 0 })).sort((a, b) => b.n - a.n));
  const topVotes = $derived(Math.max(1, ...likelyRows.map((r) => r.n)));
  const ranking = $derived(
    (room?.players ?? [])
      .map((p) => ({ id: p.id, name: p.name, n: pa?.tally[p.id] ?? 0 }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n),
  );

  // ---- Blackjack ----
  const dealerTotal = $derived(bj ? handTotal(bj.dealer).total : 0);
  const bjStatus = $derived.by(() => {
    if (!bj) return '';
    if (bj.phase === 'betting') return bj.seats.length ? 'Apuestas abiertas' : 'Hagan sus apuestas';
    if (bj.phase === 'insurance') return 'Seguro: el crupier enseña un As';
    if (bj.phase === 'playing') return bj.turn ? `Turno de ${nameOf(bj.turn)}` : '…';
    if (bj.phase === 'dealer') return 'Juega el crupier';
    return 'Resultado de la ronda';
  });
  const handBadge = (h: BJHand) => {
    if (bj?.phase === 'payout' && h.result) {
      return h.result === 'blackjack' ? `Blackjack ${signed(h.delta ?? 0)}` : h.result === 'win' ? `Gana ${signed(h.delta ?? 0)}` : h.result === 'push' ? 'Empate' : `Pierde ${signed(h.delta ?? 0)}`;
    }
    return h.status === 'bust' ? 'Se pasa' : h.status === 'blackjack' ? 'Blackjack' : h.status === 'stand' && bj?.phase !== 'betting' ? 'Se planta' : '';
  };

  // ---- Ruleta ----
  const betTotals = $derived(
    Object.entries(ro?.bets ?? {}).map(([id, list]) => ({ id, total: list.reduce((n, b) => n + b.amount, 0) })).filter((x) => x.total > 0),
  );
  const colorOf = (n: number) => ([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n) ? 'red' : n === 0 ? 'green' : 'black');
  const roStatus = $derived(ro?.phase === 'betting' ? (betTotals.length ? 'Apuestas abiertas' : 'Hagan sus apuestas') : ro?.phase === 'spinning' ? 'No va más…' : `Salió el ${ro?.result}`);

  // ---- Póker ----
  const PHASE: Record<string, string> = { waiting: 'Esperando jugadores', preflop: 'Pre-flop', flop: 'Flop', turn: 'Turn', river: 'River', showdown: 'Showdown' };
  const pot = $derived(pk?.pot ?? 0);

  const cardsOf = (cs: Card[]) => cs;
</script>

<main class="tv">
  {#if !room}
    <div class="wait">
      <Logo size={1.4} />
      <p>{net.link === 'retrying' ? 'Reconectando con la mesa…' : `Conectando con la mesa ${code}…`}</p>
      {#if net.error}<p class="err">{net.error}</p>{/if}
      <button class="btn btn-ghost" onclick={() => net.joinScreen(code)}>Reintentar</button>
    </div>
  {:else}
    <header>
      <Logo size={0.62} />
      <div class="title">
        {#if game}<span class="gi"><Icon name={gameIcon} size={34} /></span>{/if}
        <h1 class="display">{game === 'party' ? 'Zona Fiesta' : (info?.name ?? '')}</h1>
        {#if party && level}<Flames n={level.flames} size={26} />{/if}
      </div>
      <div class="join">
        <div class="jtxt">
          <small>Únete a la mesa</small>
          <b class="display foil-text">{code}</b>
          <small class="url">{location.host}</small>
        </div>
        {#await import('./QrCode.svelte') then m}<m.default value={joinUrl} size={132} />{/await}
      </div>
    </header>

    <section class="stage">
      <!-- ================= BLACKJACK ================= -->
      {#if game === 'blackjack' && bj}
        <p class="status">{bjStatus}</p>
        <div class="bj">
          <div class="dealer">
            <span class="lbl">Crupier</span>
            <div class="cards">
              {#each bj.dealer as card, i (i)}<PlayingCard {card} />{:else}<span class="muted">—</span>{/each}
            </div>
            {#if bj.dealer.length}<b class="total">{dealerTotal}{bj.dealer.some((c) => 'hidden' in c) ? '+' : ''}</b>{/if}
          </div>
          <div class="seats">
            {#each bj.seats as seat (seat.id)}
              <div class="seat" class:turn={bj.turn === seat.id}>
                <span class="nm"><Avatar id={seat.id} size={36} /> {nameOf(seat.id)}</span>
                <div class="hands">
                  {#each seat.hands as h, hi (hi)}
                    {@const tt = handTotal(h.cards)}
                    <div class="hbox">
                      <div class="cards sm">{#each h.cards as card, i (i)}<PlayingCard {card} />{/each}</div>
                      <span class="tot">{tt.total}</span>
                      {#if handBadge(h)}<span class="badge">{handBadge(h)}</span>{/if}
                    </div>
                  {/each}
                </div>
                <ChipStack amount={seat.bet} />
              </div>
            {/each}
          </div>
        </div>

      <!-- ================= LUDO ================= -->
      {:else if game === 'ludo'}
        <LudoTv />

      <!-- ================= RULETA ================= -->
      {:else if game === 'roulette' && ro}
        <div class="ro">
          <Wheel phase={ro.phase} result={ro.result} size="min(46vh, 38vw)" ticks={false} />
          <div class="rside">
            <p class="status">{roStatus}</p>
            <ol class="hist">
              {#each ro.history as n, i (i)}<li class={colorOf(n)}>{n}</li>{:else}<li class="none">Sin tiradas todavía</li>{/each}
            </ol>
            <ul class="bets">
              {#each betTotals as b (b.id)}
                <li><Avatar id={b.id} size={34} /><span>{nameOf(b.id)}</span><ChipStack amount={b.total} />
                  {#if ro.phase === 'result' && ro.net[b.id] !== undefined}<b class:pos={ro.net[b.id] > 0} class:neg={ro.net[b.id] < 0}>{signed(ro.net[b.id])}</b>{/if}</li>
              {/each}
            </ul>
          </div>
        </div>

      <!-- ================= TRAGAPERRAS ================= -->
      {:else if game === 'slots'}
        <div class="center">
          <span class="bigicon"><Icon name="slots" size={84} /></span>
          <p class="status">Cada uno juega la suya en su celular</p>
          <p class="muted">Los premios gordos aparecen abajo en el marcador.</p>
        </div>

      <!-- ================= PÓKER ================= -->
      {:else if game === 'poker' && pk}
        <p class="status">{PHASE[pk.phase]}{pk.toAct ? ` · turno de ${nameOf(pk.toAct)}` : ''}</p>
        <div class="pk">
          <div class="board">
            {#each cardsOf(pk.board) as card, i (i)}<PlayingCard {card} />{/each}
            {#each Array(Math.max(0, 5 - pk.board.length)) as _, i (i)}<span class="slot"></span>{/each}
          </div>
          <div class="pot">{#if pot > 0}<ChipStack amount={pot} />{:else}<span class="muted">Bote vacío</span>{/if}</div>
          <div class="pseats">
            {#each pk.seats as s (s.id)}
              <div class="pseat" class:turn={pk.toAct === s.id} class:out={s.folded && s.inHand}>
                <span class="nm"><Avatar id={s.id} size={34} /> {nameOf(s.id)}{#if s.button} <i class="dbtn">D</i>{/if}</span>
                <div class="cards sm">{#each s.cards as card, i (i)}<PlayingCard {card} />{/each}</div>
                <b class="num">{fmt(s.stack)}</b>
                {#if s.bet > 0}<ChipStack amount={s.bet} />{/if}
                {#if pk.phase === 'showdown' && s.hand}<span class="badge">{s.hand}</span>{:else if s.allIn}<span class="badge">All-in</span>{:else if s.folded && s.inHand}<span class="badge off">Se retira</span>{:else if s.last}<span class="badge off">{s.last}</span>{/if}
                {#if pk.phase === 'showdown' && s.delta !== undefined && s.inHand}<span class="d" class:pos={s.delta > 0} class:neg={s.delta < 0}>{signed(s.delta)}</span>{/if}
              </div>
            {:else}
              <p class="muted">Siéntate a la mesa desde tu celular.</p>
            {/each}
          </div>
        </div>

      <!-- ================= FIESTA: menú ================= -->
      {:else if game === 'party' && pa}
        <div class="hubtv">
          <p class="status">El anfitrión elige el juego</p>
          <ul class="tiles">
            {#each PARTY_GAMES as g (g.id)}
              <li><span class="medal"><Icon name={g.icon} size={34} /></span><b class="display">{g.name}</b><small>{g.tagline}</small></li>
            {/each}
          </ul>
        </div>

      <!-- ================= FIESTA: juegos ================= -->
      {:else if pa && party}
        {@const g = game as PartyGame}
        {#if g === 'reflex'}
          <div class="reflex" class:wait={pa.phase === 'wait'} class:go={pa.phase === 'go'}>
            {#if pa.phase === 'wait'}<b>Preparados…</b><small>No toquéis todavía</small>
            {:else if pa.phase === 'go'}<b>¡YA!</b><small>¡Tocad!</small>
            {:else if pa.phase === 'reveal' && pa.times}
              <ol class="res">
                {#each pa.times as r, i (r.id)}
                  <li class:drink={pa.drinkers.includes(r.id)}>
                    <span class="pos">{i + 1}</span><Avatar id={r.id} size={46} /><span class="nm">{nameOf(r.id)}</span>
                    <b>{r.early ? 'Se adelantó' : r.ms === null ? 'No llegó' : `${r.ms} ms`}</b>
                    {#if pa.drinkers.includes(r.id)}<Icon name={soft ? 'minus' : 'drink'} size={34} />{/if}
                  </li>
                {/each}
              </ol>
            {:else}<b>Duelo de reflejos</b><small>El anfitrión lo lanza desde su celular</small>{/if}
          </div>
        {:else if pa.phase === 'idle'}
          <div class="center"><span class="bigicon"><Icon name={gameIcon} size={84} /></span><p class="status">Esperando al anfitrión…</p></div>
        {:else if g === 'truth'}
          <div class="spot">
            <Avatar id={pa.target ?? ''} size={96} />
            <div><small>En el centro</small><h2 class="display">{pa.target ? nameOf(pa.target) : '…'}</h2></div>
          </div>
          {#if pa.phase === 'choose'}<p class="status">Está eligiendo verdad o reto…</p>
          {:else}
            <div class="card ticket">
              <span class="kicker">{pa.kind === 'truth' ? 'Verdad' : 'Reto'}</span>
              <p class="prompt">{t(pa.prompt)}</p>
              {#if pa.phase === 'done'}<p class="outcome">{pa.resolved === 'drink' ? (soft ? 'Prefirió perder un punto' : 'Prefirió beber') : 'Lo cumplió'}</p>{/if}
            </div>
          {/if}
        {:else if g === 'kings'}
          <div class="spot">
            <Avatar id={pa.target ?? ''} size={72} />
            <div><small>Turno de</small><h2 class="display">{pa.target ? nameOf(pa.target) : '…'}</h2></div>
            <span class="kings">{#each [1, 2, 3, 4] as i (i)}<span class:dim={i > pa.kings}><Icon name="kings" size={36} /></span>{/each}</span>
          </div>
          {#if pa.card && pa.phase === 'prompt'}
            <div class="kcard"><div class="kc"><PlayingCard card={pa.card} /></div><h2 class="display">{pa.prompt}</h2><p>{t(pa.rule)}</p></div>
          {:else}<p class="status">Saca una carta, {pa.target ? nameOf(pa.target) : ''}</p>{/if}
        {:else}
          <!-- yo nunca / probable / preferirías -->
          {#if g === 'would' && pa.options}
            <div class="opts">
              {#each [['A', pa.options[0]], ['B', pa.options[1]]] as [key, text] (key)}
                {@const who = votes.get(key) ?? []}
                <div class="opt" class:lose={pa.phase === 'reveal' && pa.drinkers.some((d) => who.includes(d))}>
                  <span class="letter">{key}</span><p>{t(text)}</p>
                  {#if pa.phase === 'reveal'}<b>{who.length}</b><small>{names(who) || '—'}</small>{/if}
                </div>
              {/each}
            </div>
          {:else}
            <div class="card ticket">
              <span class="kicker">{g === 'never' ? 'Yo nunca' : '¿Quién es más probable?'}</span>
              <p class="prompt">{g === 'likely' ? t(pa.prompt).replace(/^¿Quién es más probable que /, 'Que ') : t(pa.prompt)}</p>
            </div>
          {/if}

          {#if pa.phase === 'asking'}
            <div class="roster">
              {#each live as p (p.id)}<span class="dot" class:ok={pa.answered.includes(p.id)}><Avatar id={p.id} size={52} /></span>{/each}
              <b>{pa.answered.length}/{live.length}</b>
            </div>
          {:else if pa.phase === 'reveal'}
            {#if g === 'likely'}
              <div class="bars">
                {#each likelyRows as r (r.id)}
                  <div class="row" class:hot={pa.drinkers.includes(r.id)}>
                    <Avatar id={r.id} size={44} /><span class="nm">{nameOf(r.id)}</span>
                    <span class="bar"><i style="width:{(r.n / topVotes) * 100}%"></i></span><b>{r.n}</b>
                    {#if pa.drinkers.includes(r.id)}<Icon name={soft ? 'minus' : 'drink'} size={30} />{/if}
                  </div>
                {/each}
              </div>
            {:else}
              <p class="verdict">
                {#if pa.drinkers.length}<Icon name={soft ? 'minus' : 'drink'} size={44} /> {soft ? 'Pierden un punto' : '¡Beben!'} <b>{names(pa.drinkers)}</b>
                {:else}{g === 'never' ? 'Nadie lo ha hecho' : 'Nadie bebe: brinden'}{/if}
              </p>
            {/if}
          {/if}
        {/if}
      {/if}
    </section>

    <footer>
      <ul class="players">
        {#each room.players as p (p.id)}
          <li class:off={!p.connected}>
            <Avatar id={p.id} size={44} />
            <span class="pn">{p.name}{#if p.host} <Icon name="kings" size={18} />{/if}</span>
            <b class="num">{party ? `${pa?.tally[p.id] ?? 0} ${soft ? 'pts' : 'tragos'}` : room?.casino && game !== 'ludo' ? fmt(p.chips) : ''}</b>
          </li>
        {/each}
      </ul>
      {#if party && ranking.length === 0}<p class="muted foot">Marcador de {soft ? 'puntos perdidos' : 'tragos'} de la noche</p>{/if}
    </footer>
  {/if}
  <Reactions bar={false} />
</main>

<style>
  .tv { --u: clamp(14px, 1.7vw, 30px); font-size: var(--u); min-height: 100dvh; padding: 2vh 2.4vw; display: flex; flex-direction: column; gap: 2vh; --card-w: clamp(54px, 6.2vw, 120px); }
  .wait { margin: auto; text-align: center; display: grid; gap: 18px; justify-items: center; }
  .wait p { margin: 0; font-size: 1.2em; }
  .err { color: #ffb3a8; }
  header { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 2vw; }
  .title { display: flex; align-items: center; gap: 0.8em; justify-content: center; }
  .gi { width: 2.2em; height: 2.2em; border-radius: 50%; display: grid; place-items: center; background: var(--gold-grad); color: var(--on-accent); }
  h1 { margin: 0; font-size: 2.1em; font-weight: 800; color: var(--gold-hi); }
  .join { display: flex; align-items: center; gap: 1em; padding: 0.6em 0.9em; border-radius: 1em; background: var(--panel); border: 1px solid var(--gold-lo); }
  .jtxt { display: flex; flex-direction: column; align-items: flex-end; line-height: 1.1; }
  .jtxt small { color: var(--muted); font-size: 0.7em; }
  .jtxt b { font-size: 2.6em; font-weight: 900; letter-spacing: 0.12em; }
  .url { font-size: 0.62em !important; }

  .stage { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 2.4vh; min-height: 0; }
  .status { margin: 0; text-align: center; font-family: var(--font-display); font-weight: 700; font-size: 1.9em; color: var(--gold-hi); }
  .center { display: grid; justify-items: center; gap: 1em; text-align: center; }
  .center p { margin: 0; }
  .bigicon { width: 2.4em; height: 2.4em; border-radius: 50%; display: grid; place-items: center; background: var(--gold-grad); color: var(--on-accent); font-size: 1.4em; }

  /* cartas */
  .cards { display: flex; justify-content: center; }
  .cards > :global(.card:not(:first-child)) { margin-left: calc(var(--card-w) * -0.22); }
  .cards.sm { --card-w: clamp(46px, 4.6vw, 86px); }
  .total, .tot { font-weight: 800; padding: 0.1em 0.8em; border-radius: 99px; background: rgba(0, 0, 0, 0.45); border: 1px solid var(--gold-lo); color: var(--gold-hi); }
  .nm { display: inline-flex; align-items: center; gap: 0.5em; font-weight: 700; }
  .badge { font-size: 0.8em; font-weight: 800; padding: 0.15em 0.8em; border-radius: 99px; background: var(--gold-grad); color: var(--on-accent); white-space: nowrap; }
  .badge.off { background: #cdbf9d; }
  .d { font-weight: 800; padding: 0.1em 0.7em; border-radius: 99px; background: #1b1812; border: 1px solid var(--line); }
  .pos { color: var(--ok); } .neg { color: #ff9b90; }

  /* blackjack */
  .bj { display: grid; gap: 2.4vh; }
  .dealer { display: grid; justify-items: center; gap: 0.5em; }
  .lbl { font-size: 0.75em; letter-spacing: 0.3em; text-transform: uppercase; color: var(--muted); }
  .seats { display: flex; flex-wrap: wrap; justify-content: center; gap: 1.4em; }
  .seat { display: grid; justify-items: center; gap: 0.6em; padding: 0.8em 1em; border-radius: 1em; background: rgba(0, 0, 0, 0.28); border: 2px solid transparent; }
  .seat.turn { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.12); }
  .hands { display: flex; gap: 1em; flex-wrap: wrap; justify-content: center; }
  .hbox { display: grid; justify-items: center; gap: 0.4em; }

  /* ruleta */
  .ro { display: flex; align-items: center; justify-content: center; gap: 4vw; flex-wrap: wrap; }
  .rside { display: grid; gap: 1.4vh; min-width: min(40vw, 480px); }
  .hist { list-style: none; margin: 0; padding: 0; display: flex; gap: 0.4em; flex-wrap: wrap; }
  .hist li { min-width: 2em; height: 2em; border-radius: 50%; display: grid; place-items: center; font-weight: 800; border: 1px solid rgba(255, 255, 255, 0.25); }
  .hist li.red { background: #a3202f; } .hist li.black { background: #16130f; } .hist li.green { background: #127a4a; }
  .hist li.none { border: 0; width: auto; padding: 0 0.5em; color: var(--muted); font-weight: 500; }
  .bets { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5em; }
  .bets li { display: flex; align-items: center; gap: 0.7em; padding: 0.4em 0.8em; border-radius: 0.8em; background: rgba(255, 255, 255, 0.05); }
  .bets li span { flex: 1; font-weight: 700; }

  /* póker */
  .pk { display: grid; gap: 2vh; justify-items: center; }
  .board { display: flex; gap: 0.6em; }
  .slot { width: var(--card-w); height: calc(var(--card-w) * 1.42); border-radius: 0.5em; border: 2px dashed rgb(var(--accent-rgb) / 0.3); }
  .pseats { display: flex; flex-wrap: wrap; justify-content: center; gap: 1.2em; }
  .pseat { display: grid; justify-items: center; gap: 0.5em; padding: 0.8em 1em; border-radius: 1em; background: rgba(0, 0, 0, 0.28); border: 2px solid transparent; min-width: 9em; }
  .pseat.turn { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.12); }
  .pseat.out { opacity: 0.45; }
  .dbtn { font-style: normal; font-size: 0.7em; width: 1.5em; height: 1.5em; border-radius: 50%; display: inline-grid; place-items: center; background: var(--ivory); color: #1a1208; }

  /* fiesta */
  .tiles { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.4vw; }
  .tiles li { display: grid; gap: 0.4em; justify-items: start; padding: 1em 1.2em; border-radius: 1em; background: var(--panel); border: 1px solid var(--gold-lo); }
  .tiles .medal { width: 2.4em; height: 2.4em; border-radius: 50%; display: grid; place-items: center; background: var(--gold-grad); color: var(--on-accent); }
  .tiles b { font-size: 1.1em; color: var(--gold-hi); }
  .tiles small { color: var(--muted); }
  .hubtv { display: grid; gap: 3vh; }
  .card {
    margin: 0 auto; width: min(100%, 1100px); padding: 3.4vh 3vw; border-radius: 1.4em; text-align: center;
    background: linear-gradient(160deg, rgb(var(--accent-rgb) / 0.12), rgba(0, 0, 0, 0.25)), var(--panel); border: 2px solid var(--gold-lo);
  }
  .kicker { display: inline-block; font-family: var(--font-display); font-size: 0.8em; letter-spacing: 0.22em; text-transform: uppercase; color: var(--gold); margin-bottom: 1em; padding-bottom: 0.8em; border-bottom: 2px dashed var(--gold-lo); }
  .prompt { margin: 0; font-family: var(--font-display); font-weight: 700; font-size: clamp(1.6em, 3.4vw, 3.4em); line-height: 1.3; text-wrap: balance; }
  .outcome { margin: 0.8em 0 0; font-weight: 800; color: var(--gold-hi); font-size: 1.4em; }
  .roster { display: flex; justify-content: center; align-items: center; gap: 1em; flex-wrap: wrap; }
  .roster b { font-size: 1.6em; color: var(--gold-hi); }
  .dot { padding: 4px; border-radius: 50%; opacity: 0.35; transition: opacity 0.2s; }
  .dot.ok { opacity: 1; box-shadow: 0 0 0 4px var(--ok); }
  .verdict { margin: 0; display: flex; align-items: center; justify-content: center; gap: 0.5em; font-family: var(--font-display); font-weight: 800; font-size: 2.2em; color: var(--gold-hi); flex-wrap: wrap; text-align: center; }
  .verdict b { color: var(--text); }
  .bars { width: min(100%, 900px); margin: 0 auto; display: grid; gap: 0.6em; }
  .row { display: grid; grid-template-columns: 2.8em 8em 1fr 2em 2em; align-items: center; gap: 0.8em; font-size: 1.1em; }
  .row.hot .nm { color: var(--gold-hi); }
  .bar { height: 0.7em; border-radius: 99px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--gold-grad); transition: width 0.5s ease; }
  .opts { display: grid; grid-template-columns: 1fr 1fr; gap: 2vw; width: min(100%, 1300px); margin: 0 auto; }
  .opt { padding: 3vh 2vw; border-radius: 1.2em; background: var(--panel); border: 2px solid var(--gold-lo); display: grid; gap: 0.6em; justify-items: center; text-align: center; }
  .opt.lose { opacity: 0.6; }
  .opt p { margin: 0; font-family: var(--font-display); font-weight: 700; font-size: 1.6em; line-height: 1.3; }
  .opt b { font-size: 2.4em; color: var(--gold-hi); }
  .opt small { color: var(--muted); }
  .letter { width: 2.2em; height: 2.2em; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: var(--gold-grad); color: var(--on-accent); }
  .spot { display: flex; align-items: center; justify-content: center; gap: 1em; }
  .spot div { display: grid; line-height: 1.1; }
  .spot small { color: var(--muted); }
  .spot h2 { margin: 0; font-size: 2.6em; color: var(--gold-hi); }
  .kings { display: inline-flex; gap: 0.2em; color: var(--gold-hi); margin-left: 1em; }
  .dim { opacity: 0.25; }
  .kcard { display: grid; justify-items: center; gap: 0.6em; text-align: center; }
  .kcard .kc { --card-w: clamp(90px, 10vw, 170px); }
  .kcard h2 { margin: 0; font-size: 2.4em; color: var(--gold-hi); }
  .kcard p { margin: 0; font-size: 1.5em; max-width: 24em; line-height: 1.4; }
  .reflex { min-height: 54vh; border-radius: 1.6em; display: grid; place-content: center; text-align: center; gap: 0.3em; background: var(--panel); border: 2px solid var(--gold-lo); }
  .reflex.wait { background: linear-gradient(160deg, #8a1c26, #4b0c13); border-color: transparent; }
  .reflex.go { background: linear-gradient(160deg, #1fae5f, #0d6b38); border-color: transparent; }
  .reflex b { font-family: var(--font-display); font-weight: 900; font-size: clamp(2em, 8vw, 7em); line-height: 1; }
  .reflex small { font-size: 1.4em; opacity: 0.85; }
  .res { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.6em; width: min(90vw, 900px); text-align: left; }
  .res li { display: grid; grid-template-columns: 2em 3em 1fr auto 2.4em; align-items: center; gap: 0.8em; padding: 0.5em 1em; border-radius: 0.8em; background: rgba(255, 255, 255, 0.05); font-size: 1.2em; }
  .res li.drink { background: rgb(var(--accent-rgb) / 0.16); }
  .res .pos { color: var(--muted); font-weight: 800; text-align: center; }

  footer { display: grid; gap: 0.6em; }
  .players { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; justify-content: center; gap: 1em; }
  .players li { display: flex; align-items: center; gap: 0.6em; padding: 0.4em 1em 0.4em 0.5em; border-radius: 99px; background: var(--panel); border: 1px solid var(--line); }
  .players li.off { opacity: 0.4; }
  .pn { font-weight: 700; display: inline-flex; align-items: center; gap: 0.3em; }
  .players b { color: var(--gold-hi); font-size: 1.1em; }
  .foot { margin: 0; text-align: center; font-size: 0.8em; }
</style>
