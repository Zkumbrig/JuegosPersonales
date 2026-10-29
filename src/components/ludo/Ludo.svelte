<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { BOARDS, TURN_SECONDS_CHOICES, armColor, finalPos, targetOf, type BoardSize, type LudoOptions } from '../../../shared/ludo';
  import { net } from '../../lib/net.svelte';
  import { lv } from '../../lib/ludo/view.svelte';
  import { sfx } from '../../lib/sound.svelte';
  import Icon from '../Icon.svelte';
  import LudoBoard from './LudoBoard.svelte';
  import LudoDie from './LudoDie.svelte';

  // Preparación: estado en vivo. Partida: estado "mostrado" (va a la par de las animaciones).
  const live = $derived(net.room!.ludo);
  const pub = $derived(lv.pub);
  const isHost = $derived(!!net.me?.host);
  const players = $derived(net.room!.players);

  onMount(() => {
    lv.snap(net.room!.ludo);
    return () => lv.reset();
  });
  $effect(() => {
    const l = net.room?.ludo;
    if (l) untrack(() => lv.ingest(l));
  });

  // ---------- Preparación ----------
  const opts = $derived(live.options);
  const humans = $derived(players.length);
  const maxBots = $derived(Math.max(0, opts.board - Math.min(humans, opts.board)));
  const outside = $derived(players.slice(opts.board));
  const secondsLabel = (s: number) => (s === 0 ? 'Sin límite' : `${s} s`);
  const patch = (p: Partial<LudoOptions>) => net.send({ t: 'lu:config', patch: p });

  // ---------- Partida ----------
  const board = $derived((pub?.options.board ?? 4) as BoardSize);
  const turn = $derived(pub?.turn ?? null);
  const finished = $derived(pub?.phase === 'finished');
  const turnSeat = $derived(pub?.seats.find((s) => s.id === turn?.playerId) ?? null);
  const mine = $derived(turn?.playerId === net.pid && pub?.phase === 'playing');
  const canRoll = $derived(mine && turn?.step === 'roll' && !lv.dice.rolling);
  const canMove = $derived(mine && turn?.step === 'move');
  const turnColor = $derived(turnSeat ? armColor(board, turnSeat.arm).hex : 'var(--gold)');
  const iSit = $derived(!!pub?.seats.some((s) => s.id === net.pid));

  let locked = false;
  function roll() {
    if (!canRoll || locked) return;
    locked = true;
    setTimeout(() => (locked = false), 1200);
    net.send({ t: 'lu:roll' });
  }
  function pick(pawn: number) {
    if (!canMove || locked || !turn?.movable.includes(pawn)) return;
    locked = true;
    setTimeout(() => (locked = false), 900);
    sfx.tick();
    net.send({ t: 'lu:move', pawn });
  }

  const targets = $derived.by(() => {
    if (!canMove || !turn || !turnSeat || turn.dice === null || !pub) return [];
    return turn.movable
      .map((pawn) => ({ pawn, p: targetOf(board, pub.options, turnSeat.pawns[pawn] ?? 0, turn.dice!) }))
      .filter((t): t is { pawn: number; p: number } => t.p !== null);
  });

  const message = $derived.by(() => {
    if (!pub) return '';
    if (finished) return 'Partida terminada';
    if (!turn || !turnSeat) return '';
    if (turn.step === 'roll') return mine ? 'Tu turno: tira el dado' : `${turnSeat.name} va a tirar`;
    if (turn.step === 'move') {
      if (!mine) return `${turnSeat.name} elige un peón`;
      return new Set(turn.movable.map((i) => turnSeat.pawns[i])).size > 1 ? 'Elige un peón' : 'Mueve tu peón';
    }
    return `${turnSeat.name} no puede mover`;
  });

  const left = $derived(lv.turnLeft());
  const fraction = $derived(left !== null && pub?.options.turnSeconds ? Math.min(1, left / (pub.options.turnSeconds * 1000)) : 0);
  const diceOwner = $derived(pub?.seats.find((s) => s.id === lv.dice.playerId));
  const diceColor = $derived(armColor(board, (lv.dice.rolling || turn?.step !== 'roll' ? diceOwner : turnSeat)?.arm ?? 0).hex);

  const pips = (pawns: number[]) => pawns.map((x) => (x >= finalPos(board) ? 'done' : x > 0 ? 'out' : 'home'));
  const ranking = $derived([...(pub?.seats ?? [])].sort((a, b) => (a.left ? 1 : 0) - (b.left ? 1 : 0) || (a.rank ?? 99) - (b.rank ?? 99)));
  // En tableros grandes se puede acercar la vista a tu lado.
  let zoom = $state(false);
  let showResults = $state(true);
  $effect(() => { if (finished) showResults = true; });
</script>

{#if live.phase === 'setup' || !pub}
  <section class="setup">
    <header>
      <h2 class="display gold-text">Ludo</h2>
      <p class="muted">{isHost ? 'Elige el tablero y empieza' : 'El anfitrión prepara la partida'}</p>
    </header>

    <div class="boards" role="radiogroup" aria-label="Tablero">
      {#each BOARDS as b (b)}
        <button
          class="bd panel"
          class:on={opts.board === b}
          role="radio"
          aria-checked={opts.board === b}
          disabled={!isHost || b < humans}
          title={b < humans ? `Hay ${humans} jugadores: no caben` : undefined}
          onclick={() => patch({ board: b })}
        >
          <span class="thumb"><LudoBoard board={b} seats={opts.board === b ? live.seats : []} mini /></span>
          <b class="display">{b}</b>
          <small>jugadores</small>
        </button>
      {/each}
    </div>

    <section class="panel box">
      <div class="head">
        <h3><Icon name="users" size={16} /> Jugadores <span class="muted num">{live.seats.length}/{opts.board}</span></h3>
        {#if isHost}
          <div class="stepper" aria-label="Bots">
            <button class="st" aria-label="Quitar un bot" disabled={opts.bots <= 0} onclick={() => patch({ bots: opts.bots - 1 })}><Icon name="minus" size={14} /></button>
            <span class="num">{opts.bots} {opts.bots === 1 ? 'bot' : 'bots'}</span>
            <button class="st" aria-label="Añadir un bot" disabled={opts.bots >= maxBots} onclick={() => patch({ bots: opts.bots + 1 })}><Icon name="sparkle" size={14} /></button>
          </div>
        {/if}
      </div>
      <ul class="roster">
        {#each live.seats as s (s.id)}
          {@const c = armColor(opts.board, s.arm)}
          <li style="--c:{c.hex}">
            <span class="sw" aria-hidden="true"></span>
            <span class="nm">{s.id === net.pid ? `${s.name} (tú)` : s.name}</span>
            <span class="cn muted">{c.name}</span>
            {#if s.bot}<span class="tg">Bot</span>{/if}
          </li>
        {/each}
      </ul>
      {#if outside.length}
        <p class="warn">{outside.map((p) => p.name).join(', ')} no caben: sube el tablero o expulsa a alguien.</p>
      {/if}
    </section>

    <section class="panel box">
      <h3>Reglas</h3>
      <label class="sel">
        <span><b>Tiempo por turno</b><small>Si no juegas a tiempo, el juego mueve por ti.</small></span>
        <select disabled={!isHost} value={opts.turnSeconds} onchange={(e) => patch({ turnSeconds: Number(e.currentTarget.value) })}>
          {#each TURN_SECONDS_CHOICES as s (s)}<option value={s}>{secondsLabel(s)}</option>{/each}
        </select>
      </label>
      {#each [
        { k: 'endAtFirst', t: 'Termina con el primer ganador', h: 'Si no, se sigue hasta fijar todos los puestos.' },
        { k: 'exactFinish', t: 'Tiro exacto para la meta', h: 'Para entrar a la meta hay que sacar el número justo.' },
        { k: 'towers', t: 'Parejas protegidas', h: 'Dos peones del mismo color juntos no se pueden comer.' },
        { k: 'autoSingle', t: 'Mover solo si hay una jugada', h: 'Te ahorra tocar cuando no hay nada que elegir.' },
      ] as o (o.k)}
        <label class="chk">
          <input type="checkbox" checked={opts[o.k as 'endAtFirst']} disabled={!isHost} onchange={(e) => patch({ [o.k]: e.currentTarget.checked })} />
          <span><b>{o.t}</b><small>{o.h}</small></span>
        </label>
      {/each}
    </section>

    {#if isHost}
      <button class="btn btn-gold go" disabled={live.seats.length < 2} onclick={() => net.send({ t: 'lu:start' })}>
        <Icon name="dice" size={20} /> Empezar partida
      </button>
      {#if live.seats.length < 2}<p class="muted center">Hacen falta 2 jugadores: invita a alguien o añade un bot.</p>{/if}
    {:else}
      <p class="panel wait" role="status">Esperando a que el anfitrión empiece…</p>
    {/if}
  </section>
{:else}
  <section class="play">
    {#if !iSit}<p class="watch" role="status"><Icon name="tv" size={15} /> Estás mirando la partida.</p>{/if}

    <div class="stage">
      <div class="zoomer" class:zoom>
      <LudoBoard
        {board}
        seats={pub.seats}
        shown={lv.shown}
        turnId={finished ? null : (turn?.playerId ?? null)}
        meId={net.pid}
        movable={turn?.movable ?? []}
        canPick={canMove}
        {targets}
        popped={lv.popped}
        bursts={lv.bursts}
        ripples={lv.ripples}
        shake={lv.shake}
        onpick={pick}
      />
      </div>
      <!-- El dado se lanza sobre el tablero y luego se queda en la tarjeta de turno -->
      <div class="tossed" class:on={lv.dice.show} class:ta={lv.dice.id % 2 === 0} class:tb={lv.dice.id % 2 === 1} aria-hidden="true">
        <LudoDie value={lv.dice.value} rollId={lv.dice.id} rolling={lv.dice.rolling} color={diceColor} size={104} />
        {#if lv.dice.show && !lv.dice.rolling && lv.dice.value === 6}<span class="six6 display">¡Seis!</span>{/if}
      </div>
      {#if board >= 6 && iSit}
        <button class="zbtn" class:on={zoom} onclick={() => (zoom = !zoom)} aria-pressed={zoom} aria-label={zoom ? 'Ver todo el tablero' : 'Acercar a mi lado'}><Icon name="zoom" size={20} /></button>
      {/if}
    </div>

    <aside class="side">
      <section class="panel turn" class:mine style="--tc:{turnColor}">
        <LudoDie
          value={lv.dice.value}
          rollId={lv.dice.id}
          rolling={lv.dice.rolling}
          color={diceColor}
          active={canRoll}
          size={74}
          onroll={roll}
        />
        <div class="tx">
          {#if turnSeat && !finished}<span class="who"><i style:background={turnColor}></i>{turnSeat.id === net.pid ? 'Tú' : turnSeat.name}</span>{/if}
          <strong class="msg" aria-live="polite">{message}</strong>
          {#if turn && turn.sixes > 0 && !finished}<span class="six">{turn.sixes === 1 ? 'Un 6: repite tirada' : `${turn.sixes} seises seguidos`}</span>{/if}
          {#if turnSeat?.auto && !finished}<span class="tg warn">Piloto automático</span>{/if}
        </div>
        {#if left !== null && !finished}
          <div class="bar" role="timer" aria-label="Tiempo restante"><span class:low={left < 8000} style:transform="scaleX({fraction})"></span></div>
        {/if}
      </section>

      <section class="panel seats">
        <ul>
          {#each pub.seats as s (s.id)}
            {@const c = armColor(board, s.arm)}
            <li class:cur={!finished && turn?.playerId === s.id} class:gone={s.left} style="--c:{c.hex}">
              <span class="sw" aria-hidden="true"></span>
              <span class="nm">{s.id === net.pid ? 'Tú' : s.name}{#if s.bot} <Icon name="sparkle" size={12} />{/if}</span>
              <span class="st2 muted">
                {#if s.left}Abandonó{:else if s.rank}{s.rank}.º{:else if s.auto}Auto{:else if !s.bot && !players.find((p) => p.id === s.id)?.connected}Sin conexión{/if}
              </span>
              <span class="pips" title="En meta · en juego · en casa">{#each pips(s.pawns) as k, i (i)}<i class={k}></i>{/each}</span>
            </li>
          {/each}
        </ul>
      </section>

      <section class="panel log" aria-label="Últimas jugadas">
        <ol>
          {#each lv.log.slice(-4).reverse() as l (l.id)}
            <li style="--c:{l.color ?? 'var(--muted)'}">{l.text}</li>
          {/each}
        </ol>
      </section>

      {#if isHost}
        <button class="btn btn-ghost small" onclick={() => net.send({ t: 'lu:reset' })}>{finished ? 'Volver a la preparación' : 'Cancelar la partida'}</button>
      {/if}
    </aside>

    {#if finished && showResults}
      <div class="overlay" role="dialog" aria-modal="true" aria-label="Resultados">
        <div class="panel res">
          <Icon name="trophy" size={40} />
          <h2 class="display gold-text">{ranking[0]?.rank === 1 ? (ranking[0].id === net.pid ? '¡Ganaste!' : `¡Ganó ${ranking[0].name}!`) : 'Fin de la partida'}</h2>
          <ol>
            {#each ranking as s (s.id)}
              <li style="--c:{armColor(board, s.arm).hex}">
                <span class="pos display">{s.left ? '—' : s.rank ? `${s.rank}º` : ''}</span>
                <span class="sw" aria-hidden="true"></span>
                <span class="nm">{s.id === net.pid ? `${s.name} (tú)` : s.name}</span>
                <span class="muted st2">{s.left ? 'Abandonó' : `${s.pawns.filter((x) => x >= finalPos(board)).length}/4 en meta`}</span>
              </li>
            {/each}
          </ol>
          <div class="btns">
            {#if isHost}<button class="btn btn-gold" onclick={() => net.send({ t: 'lu:reset' })}><Icon name="dice" size={18} /> Jugar otra vez</button>
            {:else}<p class="muted">Esperando al anfitrión para otra partida…</p>{/if}
            <button class="btn btn-ghost" onclick={() => (showResults = false)}>Ver tablero</button>
          </div>
        </div>
      </div>
    {/if}
    {#if finished && !showResults}
      <button class="btn btn-ghost small again" onclick={() => (showResults = true)}><Icon name="trophy" size={16} /> Resultados</button>
    {/if}
  </section>
{/if}

<style>
  h2, h3, p, ol, ul { margin: 0; }
  ol, ul { list-style: none; padding: 0; }
  .center { text-align: center; }
  small { display: block; color: var(--muted); font-size: 0.72rem; font-weight: 400; line-height: 1.3; }

  /* ---------- Preparación ---------- */
  .setup { display: grid; gap: 12px; animation: fadeUp 0.3s ease both; }
  .setup header { text-align: center; }
  .setup header h2 { font-size: 1.7rem; }
  .boards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .bd { display: grid; justify-items: center; gap: 2px; padding: 10px 6px 8px; border-radius: 16px; transition: border-color 0.2s, background 0.2s, transform 0.12s; }
  .bd:disabled:not(.on) { opacity: 0.45; }
  .bd:not(:disabled):active { transform: scale(0.97); }
  .bd.on { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.1); }
  .bd .thumb { width: 100%; max-width: 110px; }
  .bd b { font-size: 1.5rem; line-height: 1; margin-top: 4px; color: var(--gold-hi); }
  .bd small { color: var(--muted); }
  .box { padding: 14px; display: grid; gap: 10px; }
  .box h3 { font-family: var(--font-display); font-size: 0.78rem; letter-spacing: 0.06em; text-transform: uppercase; display: flex; align-items: center; gap: 8px; color: var(--gold-hi); }
  .head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .stepper { display: inline-flex; align-items: center; gap: 8px; font-size: 0.82rem; }
  .st { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--gold-lo); color: var(--gold-hi); display: grid; place-items: center; }
  .st:disabled { opacity: 0.35; }
  .roster { display: grid; gap: 6px; }
  .roster li, .seats li { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 12px; background: rgba(0, 0, 0, 0.28); border-left: 4px solid var(--c); }
  .sw { width: 14px; height: 14px; border-radius: 5px; background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--c) 55%, #fff), var(--c) 60%, color-mix(in srgb, var(--c) 60%, #000)); flex: none; }
  .nm { font-weight: 700; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px; }
  .cn { font-size: 0.75rem; }
  .tg { font-size: 0.62rem; letter-spacing: 0.1em; text-transform: uppercase; padding: 2px 8px; border-radius: 999px; background: rgb(var(--accent-rgb) / 0.15); color: var(--gold-hi); font-weight: 700; }
  .tg.warn { background: rgba(224, 86, 75, 0.2); color: #ffb3a8; }
  .warn { font-size: 0.82rem; color: #ffb3a8; }
  .chk, .sel { display: flex; align-items: center; gap: 12px; justify-content: space-between; }
  .chk { justify-content: flex-start; }
  .chk b, .sel b { font-size: 0.9rem; }
  .chk input { width: 22px; height: 22px; accent-color: var(--gold); flex: none; }
  .sel select { background: rgba(0, 0, 0, 0.35); border: 1px solid var(--line); border-radius: 10px; color: var(--text); min-height: 40px; padding: 0 10px; font: inherit; }
  .go { min-height: 54px; font-size: 0.8rem; }
  .wait { padding: 14px; text-align: center; color: var(--muted); }

  /* ---------- Partida ---------- */
  .play { display: grid; gap: 10px; animation: fadeUp 0.3s ease both; }
  .watch { display: flex; align-items: center; justify-content: center; gap: 8px; padding: 6px; border-radius: 12px; background: rgba(255, 255, 255, 0.05); font-size: 0.82rem; color: var(--muted); }
  .stage { position: relative; width: 100%; max-width: min(100%, 78dvh); margin: 0 auto; }
  .tossed { position: absolute; left: 50%; top: 50%; margin: -65px 0 0 -65px; z-index: 3; pointer-events: none; opacity: 0; visibility: hidden; transition: opacity 0.25s, visibility 0.25s; }
  .tossed.on { opacity: 1; visibility: visible; }
  .tossed.on.ta { animation: throw-a 1.1s cubic-bezier(0.25, 0.7, 0.3, 1); }
  .tossed.on.tb { animation: throw-b 1.1s cubic-bezier(0.25, 0.7, 0.3, 1); }
  .six6 { position: absolute; left: 50%; bottom: -14px; translate: -50% 0; font-size: 1.1rem; color: var(--gold-hi); text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8); white-space: nowrap; animation: pop6 0.5s cubic-bezier(0.2, 1.6, 0.4, 1); }
  @keyframes throw-a { 0% { transform: translate(-110%, 90%) scale(0.45); } 55% { transform: translate(8%, -12%) scale(1.12); } 75% { transform: translate(0, 4%) scale(0.96); } 100% { transform: translate(0, 0) scale(1); } }
  @keyframes throw-b { 0% { transform: translate(110%, 90%) scale(0.45); } 55% { transform: translate(-8%, -12%) scale(1.12); } 75% { transform: translate(0, 4%) scale(0.96); } 100% { transform: translate(0, 0) scale(1); } }
  @keyframes pop6 { from { transform: scale(0.2); opacity: 0; } to { transform: scale(1); opacity: 1; } }
  .zoomer { width: 100%; aspect-ratio: 1; }
  .zoomer.zoom { overflow: hidden; border-radius: 26px; }
  .zoomer :global(.table) { transition: transform 0.45s cubic-bezier(0.3, 0.7, 0.2, 1); transform-origin: 50% 88%; }
  .zoomer.zoom :global(.table) { transform: scale(1.75); }
  .zbtn { position: absolute; right: 4px; bottom: 4px; z-index: 2; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; color: var(--gold-hi); background: rgba(10, 8, 7, 0.8); border: 1px solid var(--gold-lo); }
  .zbtn.on { background: var(--gold-grad); color: var(--on-accent); border-color: transparent; }
  .side { display: grid; gap: 10px; align-content: start; }
  .turn { display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 12px; padding: 10px 14px 12px; border-color: color-mix(in srgb, var(--tc) 55%, var(--line)); position: relative; }
  .turn.mine { background: linear-gradient(180deg, color-mix(in srgb, var(--tc) 22%, var(--panel)), var(--panel)); }
  .tx { display: grid; gap: 3px; justify-items: start; min-width: 0; }
  .who { display: inline-flex; align-items: center; gap: 7px; font-size: 0.8rem; color: var(--muted); font-weight: 700; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who i { width: 11px; height: 11px; border-radius: 4px; flex: none; }
  .msg { font-family: var(--font-display); font-size: 0.92rem; line-height: 1.25; }
  .six { font-size: 0.74rem; color: var(--gold-hi); font-weight: 700; }
  .bar { grid-column: 1 / -1; height: 6px; border-radius: 99px; background: rgba(0, 0, 0, 0.45); overflow: hidden; }
  .bar span { display: block; height: 100%; background: var(--ok); transform-origin: left; transition: transform 0.25s linear; }
  .bar span.low { background: var(--danger); }
  .seats { padding: 8px; }
  .seats ul { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 6px; }
  .seats li { transition: background 0.2s; }
  .seats li.cur { background: color-mix(in srgb, var(--c) 26%, #0d0a07); }
  .seats li.gone { opacity: 0.4; }
  .st2 { font-size: 0.7rem; font-weight: 700; }
  .pips { display: flex; gap: 3px; }
  .pips i { width: 10px; height: 10px; border-radius: 3px; border: 2px solid var(--c); }
  .pips i.done { background: var(--c); }
  .pips i.out { background: linear-gradient(135deg, var(--c) 50%, transparent 50%); }
  .pips i.home { border-color: var(--line); }
  .log { padding: 8px 12px; }
  .log ol { display: grid; gap: 3px; min-height: 4.2em; }
  .log li { font-size: 0.8rem; padding-left: 8px; border-left: 3px solid var(--c); }
  .log li:not(:first-child) { opacity: 0.6; }
  .small { min-height: 40px; }
  .again { justify-self: center; }

  .overlay { position: fixed; inset: 0; z-index: 40; display: grid; place-items: center; padding: 16px; background: rgba(4, 3, 2, 0.78); animation: fadeUp 0.25s ease both; }
  .res { width: min(100%, 420px); padding: 20px; display: grid; gap: 12px; justify-items: center; text-align: center; color: var(--gold-hi); }
  .res h2 { font-size: 1.3rem; }
  .res ol { width: 100%; display: grid; gap: 6px; }
  .res li { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 12px; background: rgba(0, 0, 0, 0.35); border-left: 4px solid var(--c); text-align: left; color: var(--text); }
  .res .pos { width: 2.2em; color: var(--gold-hi); font-size: 0.8rem; }
  .res .btns { display: grid; gap: 8px; width: 100%; }

  /* Pantallas grandes: tablero a la izquierda, panel a la derecha. */
  @media (min-width: 900px) {
    .play { grid-template-columns: minmax(0, 1fr) 330px; align-items: start; gap: 18px; }
    .stage { margin: 0; }
    .seats ul { grid-template-columns: 1fr; }
    .setup { grid-template-columns: 1fr 1fr; align-items: start; }
    .setup header, .go, .wait, .center { grid-column: 1 / -1; }
  }
  @media (prefers-reduced-motion: reduce) { .bar span { transition: none; } }
</style>
