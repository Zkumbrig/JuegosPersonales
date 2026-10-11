<script lang="ts">
  import { armColor, finalPos, targetOf } from '$shared/rules';
  import { ludo } from '$lib/game.svelte';
  import { sound } from '$lib/sound.svelte';
  import Board from './Board.svelte';
  import Die from './Die.svelte';
  import Icon from './Icon.svelte';

  const room = $derived(ludo.room!);
  const board = $derived(room.options.board);
  const FIN = $derived(finalPos(board));
  const turn = $derived(room.turn);
  const turnPlayer = $derived(ludo.turnPlayer);
  const turnColor = $derived(turnPlayer ? armColor(board, turnPlayer.arm).hex : '#fff');
  const finished = $derived(room.phase === 'finished');
  const hostName = $derived(room.players.find((p) => p.id === room.hostId)?.name ?? 'el líder');

  // Destinos de los peones que se pueden mover (solo se enseñan a quien le toca).
  const targets = $derived.by(() => {
    if (!ludo.canMove || !turn || !turnPlayer || turn.dice === null) return [];
    return turn.movable
      .map((pawn) => ({ pawn, p: targetOf(board, room.options, turnPlayer.pawns[pawn] ?? 0, turn.dice!) }))
      .filter((t): t is { pawn: number; p: number } => t.p !== null);
  });

  // Cuenta atrás del turno.
  let now = $state(Date.now());
  $effect(() => {
    if (!turn?.deadline) return;
    const id = setInterval(() => (now = Date.now()), 250);
    return () => clearInterval(id);
  });
  const remaining = $derived(turn?.deadline ? Math.max(0, turn.deadline - (now + ludo.clockOffset)) : null);
  const fraction = $derived(remaining !== null && room.options.turnSeconds ? Math.min(1, remaining / (room.options.turnSeconds * 1000)) : 0);

  // Qué decir en la tarjeta de turno.
  const message = $derived.by(() => {
    if (finished) return 'Partida terminada';
    if (!turn || !turnPlayer) return '';
    const mine = ludo.myTurn;
    if (turn.step === 'roll') return mine ? 'Tu turno: tira el dado' : `${turnPlayer.name} va a tirar`;
    if (turn.step === 'move') {
      if (!mine) return `${turnPlayer.name} elige peón`;
      const n = new Set(turn.movable.map((i) => turnPlayer.pawns[i])).size;
      return n > 1 ? 'Elige un peón para mover' : 'Mueve tu peón';
    }
    return turn.dice === null ? '' : `${turnPlayer.name} no puede mover`;
  });

  // El aro del dado lleva el color de quien lo está usando: el que tira ahora, o el que lo acaba de tirar.
  const diceOwner = $derived(ludo.dice.rolling || (turn?.step !== 'roll' && ludo.dice.playerId) ? ludo.dice.playerId : (turn?.playerId ?? ludo.dice.playerId));
  const diceColor = $derived(armColor(board, room.players.find((p) => p.id === diceOwner)?.arm ?? 0).hex);

  function pips(p: { pawns: number[] }) {
    return p.pawns.map((x) => (x >= FIN ? 'done' : x > 0 ? 'out' : 'home'));
  }

  // Salir pide una segunda pulsación para evitar toques accidentales.
  let confirmLeave = $state(false);
  let leaveTimer: ReturnType<typeof setTimeout> | undefined;
  function leave() {
    if (!ludo.isPlayer || finished || confirmLeave) {
      clearTimeout(leaveTimer);
      return ludo.leave();
    }
    confirmLeave = true;
    leaveTimer = setTimeout(() => (confirmLeave = false), 3500);
  }

  let showResults = $state(true);
  $effect(() => {
    if (finished) showResults = true;
  });

  const ranking = $derived(
    [...room.players].sort((a, b) => (a.left ? 1 : 0) - (b.left ? 1 : 0) || (a.rank ?? 99) - (b.rank ?? 99)),
  );
  const ordinal = (n: number) => `${n}.º`;
</script>

<main class="game">
  <header class="bar">
    <button class="btn small" class:danger={confirmLeave} onclick={leave}>
      <Icon name="exit" size={16} />
      {confirmLeave ? 'Toca otra vez para salir' : ludo.isPlayer && !finished ? 'Abandonar' : 'Salir'}
    </button>
    <span class="roomcode" title="Código de sala">{room.code}</span>
    <div class="right">
      {#if finished && !showResults}
        <button class="btn small" onclick={() => (showResults = true)}><Icon name="trophy" size={16} /> Resultados</button>
      {/if}
      <button class="btn small icon" onclick={() => sound.toggle()} aria-label={sound.muted ? 'Activar sonido' : 'Silenciar'}>
        <Icon name={sound.muted ? 'mute' : 'sound'} size={18} />
      </button>
    </div>
  </header>

  {#if ludo.status !== 'open'}
    <p class="offline" role="status"><Icon name="wifi" size={16} /> Sin conexión. Reconectando…</p>
  {/if}
  {#if !ludo.isPlayer}
    <p class="watching" role="status"><Icon name="eye" size={16} /> Estás mirando la partida.</p>
  {/if}

  <div class="stage">
    <div class="boardwrap">
      <Board
        {board}
        players={room.players}
        shown={ludo.shown}
        turnId={finished ? null : (turn?.playerId ?? null)}
        movable={turn?.movable ?? []}
        canPick={ludo.canMove}
        {targets}
        popped={ludo.popped}
        onpick={(pawn) => ludo.move(pawn)}
      />
    </div>

    <aside class="side">
      <section class="card turncard" class:mine={ludo.myTurn} style:--tc={turnColor}>
        <div class="turnrow">
          <Die
            value={ludo.dice.value}
            rolling={ludo.dice.rolling}
            color={diceColor}
            active={ludo.canRoll}
            onroll={() => ludo.roll()}
          />
          <div class="turntext">
            {#if turnPlayer && !finished}
              <span class="who"><i style:background={turnColor}></i>{turnPlayer.name}{ludo.myTurn ? ' (tú)' : ''}</span>
            {/if}
            <strong class="msg" aria-live="polite">{message}</strong>
            {#if turn && turn.sixes > 0 && !finished}<span class="sixes">{turn.sixes === 1 ? 'Un 6: repite tirada' : `${turn.sixes} seises seguidos`}</span>{/if}
            {#if turnPlayer?.auto && !finished}<span class="tag warn">Piloto automático</span>{/if}
            {#if turnPlayer && !turnPlayer.connected && !turnPlayer.bot && !finished}<span class="tag warn">Sin conexión</span>{/if}
          </div>
        </div>
        {#if remaining !== null && !finished}
          <div class="timer" role="timer" aria-label="Tiempo restante">
            <span style:transform="scaleX({fraction})" class:low={remaining < 8000}></span>
          </div>
        {/if}
      </section>

      <section class="card players">
        <h2>Jugadores</h2>
        <ul>
          {#each room.players as p (p.id)}
            {@const c = armColor(board, p.arm)}
            <li class:turn={!finished && turn?.playerId === p.id} class:gone={p.left} style:--c={c.hex}>
              <span class="dot" aria-hidden="true"></span>
              <span class="nm">
                {p.name}{p.id === ludo.you?.id ? ' (tú)' : ''}
                {#if p.host}<Icon name="crown" size={13} />{/if}
                {#if p.bot}<Icon name="bot" size={13} />{/if}
              </span>
              <span class="state">
                {#if p.left}Abandonó
                {:else if p.rank}{ordinal(p.rank)}
                {:else if !p.connected && !p.bot}Sin conexión
                {:else if p.auto}Auto
                {/if}
              </span>
              <span class="pips" title="En meta / en juego / en casa">
                {#each pips(p) as s}<i class={s}></i>{/each}
              </span>
            </li>
          {/each}
        </ul>
      </section>

      <section class="card log">
        <h2>Jugadas</h2>
        <ol aria-live="off">
          {#each ludo.log.slice(-7).reverse() as l (l.id)}
            <li style:--c={l.color ?? 'var(--muted)'}>{l.text}</li>
          {/each}
        </ol>
      </section>
    </aside>
  </div>

  {#if finished && showResults}
    <div class="overlay" role="dialog" aria-modal="true" aria-label="Resultados">
      <div class="card results">
        <Icon name="trophy" size={36} />
        <h2>{ranking[0]?.rank === 1 ? `¡Ganó ${ranking[0].name}!` : 'Fin de la partida'}</h2>
        <ol>
          {#each ranking as p (p.id)}
            <li style:--c={armColor(board, p.arm).hex}>
              <span class="pos">{p.left ? '—' : p.rank ? ordinal(p.rank) : ''}</span>
              <span class="dot"></span>
              <span class="nm">{p.name}{p.id === ludo.you?.id ? ' (tú)' : ''}</span>
              <span class="st">{p.left ? 'Abandonó' : `${p.pawns.filter((x) => x >= FIN).length}/4 en meta`}</span>
            </li>
          {/each}
        </ol>
        <div class="btns">
          {#if ludo.isHost}
            <button class="btn primary" onclick={() => ludo.rematch()}><Icon name="refresh" size={18} /> Jugar otra vez</button>
          {:else}
            <p class="waiting">Esperando a que {hostName} proponga otra partida…</p>
          {/if}
          <button class="btn" onclick={() => (showResults = false)}>Ver tablero</button>
          <button class="btn ghost" onclick={() => ludo.leave()}>Salir</button>
        </div>
      </div>
    </div>
  {/if}
</main>

<style>
  .game {
    max-width: 1180px;
    margin: 0 auto;
    padding: 10px 12px 28px;
  }
  .bar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .bar > :first-child {
    justify-self: start;
  }
  .right {
    justify-self: end;
    display: flex;
    gap: 8px;
  }
  .roomcode {
    font-weight: 900;
    letter-spacing: 0.25em;
    padding: 4px 4px 4px 0.65em;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.95rem;
  }
  .offline,
  .watching {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 12px;
    margin-bottom: 10px;
    font-weight: 700;
    font-size: 0.92rem;
  }
  .offline {
    background: color-mix(in srgb, var(--danger) 18%, transparent);
    color: var(--danger);
  }
  .watching {
    background: var(--surface-2);
    color: var(--muted);
  }
  .stage {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 340px;
    gap: 16px;
    align-items: start;
  }
  .boardwrap {
    width: 100%;
    max-width: min(100%, calc(100dvh - 90px));
    margin: 0 auto;
  }
  .side {
    display: grid;
    gap: 12px;
    align-content: start;
  }
  h2 {
    font-size: 0.8rem;
    font-weight: 900;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 10px;
  }
  .turncard {
    padding: 14px;
    border-color: color-mix(in srgb, var(--tc) 60%, var(--line));
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--tc) 25%, transparent);
  }
  .turncard.mine {
    background: linear-gradient(180deg, color-mix(in srgb, var(--tc) 22%, var(--surface)), var(--surface));
  }
  .turnrow {
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .turntext {
    display: grid;
    gap: 4px;
    min-width: 0;
    justify-items: start;
  }
  .who {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-weight: 800;
    color: var(--muted);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who i {
    width: 12px;
    height: 12px;
    border-radius: 4px;
    flex: none;
  }
  .msg {
    font-size: 1.1rem;
    line-height: 1.2;
  }
  .sixes {
    font-size: 0.82rem;
    font-weight: 800;
    color: var(--accent);
  }
  .timer {
    margin-top: 12px;
    height: 6px;
    border-radius: 99px;
    background: #0e1330;
    overflow: hidden;
  }
  .timer span {
    display: block;
    height: 100%;
    background: var(--ok);
    transform-origin: left;
    transition: transform 0.25s linear;
  }
  .timer span.low {
    background: var(--danger);
  }
  .players ul,
  .log ol {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .players li {
    display: grid;
    grid-template-columns: auto 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 7px 10px;
    border-radius: 10px;
    background: #10162f;
    border-left: 5px solid var(--c);
    transition: background 0.2s;
  }
  .players li.turn {
    background: color-mix(in srgb, var(--c) 24%, #10162f);
  }
  .players li.gone {
    opacity: 0.45;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 4px;
    background: var(--c);
  }
  .nm {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .state {
    font-size: 0.78rem;
    font-weight: 800;
    color: var(--muted);
  }
  .pips {
    display: flex;
    gap: 3px;
  }
  .pips i {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    border: 2px solid var(--c);
  }
  .pips i.done {
    background: var(--c);
  }
  .pips i.out {
    background: linear-gradient(135deg, var(--c) 50%, transparent 50%);
  }
  .pips i.home {
    border-color: #3b4580;
  }
  .log li {
    font-size: 0.9rem;
    padding-left: 10px;
    border-left: 3px solid var(--c);
    color: var(--text);
  }
  .log li:not(:first-child) {
    opacity: 0.7;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: grid;
    place-items: center;
    padding: 16px;
    background: rgba(5, 8, 20, 0.72);
  }
  .results {
    width: min(100%, 440px);
    display: grid;
    gap: 14px;
    justify-items: center;
    text-align: center;
    color: var(--accent);
  }
  .results h2 {
    margin: 0;
    font-size: 1.6rem;
    letter-spacing: 0;
    text-transform: none;
    color: var(--text);
  }
  .results ol {
    list-style: none;
    padding: 0;
    margin: 0;
    width: 100%;
    display: grid;
    gap: 6px;
  }
  .results li {
    display: grid;
    grid-template-columns: 2.4em auto 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 9px 12px;
    border-radius: 10px;
    background: #10162f;
    border-left: 5px solid var(--c);
    color: var(--text);
    text-align: left;
  }
  .results .pos {
    font-weight: 900;
    color: var(--accent);
  }
  .results .st {
    font-size: 0.82rem;
    color: var(--muted);
    font-weight: 700;
  }
  .btns {
    display: grid;
    gap: 8px;
    width: 100%;
  }
  .waiting {
    color: var(--muted);
    font-weight: 700;
  }

  @media (max-width: 900px) {
    .stage {
      grid-template-columns: 1fr;
    }
    .boardwrap {
      max-width: 100%;
    }
    .turncard {
      position: sticky;
      bottom: 8px;
      z-index: 5;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
    }
  }
</style>
