<script lang="ts">
  // Vista para la pantalla compartida (TV): el tablero grande y el estado de la partida. Solo mira.
  import { onMount, untrack } from 'svelte';
  import { armColor, finalPos, type BoardSize } from '../../../shared/ludo';
  import { net } from '../../lib/net.svelte';
  import { lv } from '../../lib/ludo/view.svelte';
  import LudoBoard from './LudoBoard.svelte';
  import LudoDie from './LudoDie.svelte';

  const live = $derived(net.room!.ludo);
  const pub = $derived(lv.pub);

  onMount(() => {
    lv.snap(net.room!.ludo);
    return () => lv.reset();
  });
  $effect(() => {
    const l = net.room?.ludo;
    if (l) untrack(() => lv.ingest(l));
  });

  const board = $derived((pub?.options.board ?? live.options.board) as BoardSize);
  const turn = $derived(pub?.turn ?? null);
  const finished = $derived(pub?.phase === 'finished');
  const seats = $derived(live.phase === 'setup' || !pub ? live.seats : pub.seats);
  const turnSeat = $derived(seats.find((s) => s.id === turn?.playerId));
  const diceOwner = $derived(seats.find((s) => s.id === lv.dice.playerId));
  const ranking = $derived([...seats].sort((a, b) => (a.left ? 1 : 0) - (b.left ? 1 : 0) || (a.rank ?? 99) - (b.rank ?? 99)));
  const status = $derived(
    live.phase === 'setup' || !pub
      ? 'El anfitrión prepara la partida'
      : finished
        ? `¡Ganó ${ranking[0]?.name ?? '…'}!`
        : turnSeat
          ? turn?.step === 'roll' ? `${turnSeat.name} va a tirar` : turn?.step === 'move' ? `${turnSeat.name} elige un peón` : `${turnSeat.name} no puede mover`
          : '',
  );
  const pips = (pawns: number[]) => pawns.map((x) => (x >= finalPos(board) ? 'done' : x > 0 ? 'out' : 'home'));
</script>

<div class="ltv">
  <div class="stage">
    <LudoBoard
      {board}
      {seats}
      shown={live.phase === 'setup' ? {} : lv.shown}
      turnId={finished || live.phase === 'setup' ? null : (turn?.playerId ?? null)}
      popped={lv.popped}
      bursts={lv.bursts}
      ripples={lv.ripples}
      shake={lv.shake}
    />
  </div>
  <div class="info">
    <p class="status">{status}</p>
    {#if live.phase !== 'setup' && pub}
      <div class="dice">
        <LudoDie value={lv.dice.value} rollId={lv.dice.id} rolling={lv.dice.rolling} color={armColor(board, (diceOwner ?? turnSeat)?.arm ?? 0).hex} size={118} />
      </div>
    {/if}
    <ul class="seats">
      {#each seats as s (s.id)}
        <li class:cur={!finished && turn?.playerId === s.id} class:gone={s.left} style="--c:{armColor(board, s.arm).hex}">
          <span class="sw"></span>
          <span class="nm">{s.name}</span>
          {#if s.rank}<b class="rk display">{s.rank}º</b>{/if}
          <span class="pips">{#each pips(s.pawns) as k, i (i)}<i class={k}></i>{/each}</span>
        </li>
      {/each}
    </ul>
    {#if lv.log.length}
      <ol class="log">{#each lv.log.slice(-3).reverse() as l (l.id)}<li style="--c:{l.color ?? 'var(--muted)'}">{l.text}</li>{/each}</ol>
    {/if}
  </div>
</div>

<style>
  .ltv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 3vw; align-items: center; min-height: 0; }
  .stage { height: min(70vh, 60vw); aspect-ratio: 1; }
  .info { display: grid; gap: 1.6vh; align-content: center; justify-items: start; }
  .status { margin: 0; font-family: var(--font-display); font-size: 1.5em; color: var(--gold-hi); }
  .dice { padding: 0.4em 0; }
  .seats, .log { list-style: none; margin: 0; padding: 0; display: grid; gap: 0.5vh; width: 100%; }
  .seats { grid-template-columns: repeat(auto-fit, minmax(14em, 1fr)); gap: 0.8vh 1vw; }
  .seats li { display: flex; align-items: center; gap: 0.7em; padding: 0.5em 0.8em; border-radius: 0.8em; background: rgba(0, 0, 0, 0.32); border-left: 0.35em solid var(--c); font-size: 0.85em; }
  .seats li.cur { background: color-mix(in srgb, var(--c) 28%, #0d0a07); }
  .seats li.gone { opacity: 0.4; }
  .sw { width: 0.9em; height: 0.9em; border-radius: 0.3em; background: var(--c); flex: none; }
  .nm { flex: 1; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rk { color: var(--gold-hi); font-size: 0.8em; }
  .pips { display: flex; gap: 0.2em; }
  .pips i { width: 0.65em; height: 0.65em; border-radius: 0.2em; border: 0.15em solid var(--c); }
  .pips i.done { background: var(--c); }
  .pips i.out { background: linear-gradient(135deg, var(--c) 50%, transparent 50%); }
  .pips i.home { border-color: var(--line); }
  .log li { font-size: 0.8em; padding-left: 0.6em; border-left: 0.2em solid var(--c); }
  .log li:not(:first-child) { opacity: 0.6; }
  @media (max-width: 800px) { .ltv { grid-template-columns: 1fr; } .stage { height: auto; width: 100%; } }
</style>
