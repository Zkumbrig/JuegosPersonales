<script lang="ts">
  import { untrack } from 'svelte';
  import { CHIP_VALUES, RED_NUMBERS, type RouletteBetKind } from '../../shared/protocol';
  import { returnMultiplier } from '../../shared/rules';
  import { net } from '../lib/net.svelte';
  import { fmt, signed, vibrate } from '../lib/format';
  import { sfx } from '../lib/sound.svelte';
  import { celebrate } from '../lib/celebrate.svelte';
  import Chip from './Chip.svelte';
  import PlayerStrip from './PlayerStrip.svelte';
  import Wheel from './Wheel.svelte';

  const ro = $derived(net.room!.roulette);
  const me = $derived(net.me);
  const secs = $derived.by(() => {
    const ms = net.left(ro.timeLeft);
    return ms === null ? null : Math.ceil(ms / 1000);
  });

  const colorOf = (n: number) => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black');

  // Sonido y celebración al terminar la tirada (la rueda se anima en <Wheel>)
  let lastPhase: string | null = null;
  $effect(() => {
    const phase = ro.phase;
    untrack(() => {
      if (phase === 'result' && lastPhase !== null && lastPhase !== 'result') {
        const mine = ro.net[net.pid];
        if (mine !== undefined) (mine > 0 ? sfx.win : mine < 0 ? sfx.lose : sfx.stop)();
        else sfx.stop();
        if (mine !== undefined && mine > 0) celebrate(mine >= 1000);
      }
      lastPhase = phase;
    });
  });

  // ---------- Apuestas ----------
  let selected = $state(50);
  $effect(() => {
    const chips = me?.chips ?? 0;
    if (selected > chips) {
      const fit = [...CHIP_VALUES].reverse().find((v) => v <= chips);
      if (fit) selected = fit;
    }
  });

  const key = (kind: string, value?: number) => `${kind}:${value ?? ''}`;
  const mine = $derived.by(() => {
    const m = new Map<string, number>();
    for (const b of ro.bets[net.pid] ?? []) m.set(key(b.kind, b.value), (m.get(key(b.kind, b.value)) ?? 0) + b.amount);
    return m;
  });
  const others = $derived.by(() => {
    const s = new Set<string>();
    for (const [pid, list] of Object.entries(ro.bets)) if (pid !== net.pid) for (const b of list) s.add(key(b.kind, b.value));
    return s;
  });
  const myTotal = $derived([...mine.values()].reduce((a, b) => a + b, 0));
  const lastTotal = $derived(ro.lastTotals[net.pid] ?? 0);
  const canBet = $derived(ro.phase === 'betting' && (me?.chips ?? 0) >= selected);

  function place(kind: RouletteBetKind, value?: number) {
    if (!canBet) return;
    net.send({ t: 'ro:bet', kind, value, amount: selected });
    sfx.chip();
    vibrate(8);
  }
  const hit = (kind: RouletteBetKind, value?: number) =>
    ro.phase === 'result' && ro.result !== null && returnMultiplier({ kind, value }, ro.result) > 0;

  const nums = Array.from({ length: 36 }, (_, i) => i + 1);
  const OUTSIDE: { kind: RouletteBetKind; label: string; cls?: string }[] = [
    { kind: 'low', label: '1-18' },
    { kind: 'even', label: 'PAR' },
    { kind: 'red', label: '◆', cls: 'red' },
    { kind: 'black', label: '◆', cls: 'black' },
    { kind: 'odd', label: 'IMPAR' },
    { kind: 'high', label: '19-36' },
  ];

  const myNet = $derived(ro.net[net.pid]);
  const status = $derived.by(() => {
    if (ro.phase === 'betting')
      return ro.timeLeft === null ? 'Coloca tus fichas para abrir la ronda' : `Apuestas abiertas · ${secs}s`;
    if (ro.phase === 'spinning') return 'No va más…';
    return `Salió el ${ro.result}`;
  });
</script>

<div class="wrap">
  <PlayerStrip />

  <section class="felt stage">
    <Wheel phase={ro.phase} result={ro.result} />

    <p class="status" class:urgent={ro.phase === 'betting' && secs !== null && secs <= 5}>{status}</p>
    {#if ro.phase === 'result' && myNet !== undefined}
      <p class="net" class:pos={myNet > 0} class:neg={myNet < 0}>{myNet === 0 ? 'Recuperas tu apuesta' : myNet > 0 ? `Ganas ${signed(myNet)}` : `Pierdes ${signed(myNet)}`}</p>
    {/if}

    <ol class="history" aria-label="Últimos números">
      {#each ro.history as n, i (i)}
        <li class={colorOf(n)}>{n}</li>
      {:else}
        <li class="none">Sin tiradas todavía</li>
      {/each}
    </ol>
  </section>

  <section class="felt board" class:locked={ro.phase !== 'betting'}>
    <button class="cell green zero" class:hit={hit('straight', 0)} class:pulse={hit('straight', 0)} onclick={() => place('straight', 0)}>
      0{#if mine.has(key('straight', 0))}<b class="stack">{fmt(mine.get(key('straight', 0))!)}</b>{/if}
    </button>
    {#each nums as n (n)}
      <button
        class="cell {colorOf(n)}"
        class:hit={hit('straight', n)} class:pulse={hit('straight', n)}
        class:other={others.has(key('straight', n))}
        style="grid-row:{Math.floor((n - 1) / 3) + 2};grid-column:{((n - 1) % 3) + 2}"
        onclick={() => place('straight', n)}
      >
        {n}{#if mine.has(key('straight', n))}<b class="stack">{fmt(mine.get(key('straight', n))!)}</b>{/if}
      </button>
    {/each}
    {#each [1, 2, 3] as d (d)}
      <button class="cell out" class:hit={hit('dozen', d)} class:pulse={hit('dozen', d)} class:other={others.has(key('dozen', d))}
        style="grid-column:1;grid-row:{(d - 1) * 4 + 2} / span 4" onclick={() => place('dozen', d)}>
        <span class="vlabel">{d === 1 ? '1ª' : d === 2 ? '2ª' : '3ª'} docena</span>
        {#if mine.has(key('dozen', d))}<b class="stack">{fmt(mine.get(key('dozen', d))!)}</b>{/if}
      </button>
    {/each}
    {#each OUTSIDE as o, i (o.kind)}
      <button class="cell out {o.cls ?? ''}" class:hit={hit(o.kind)} class:pulse={hit(o.kind)} class:other={others.has(key(o.kind))}
        style="grid-column:5;grid-row:{i * 2 + 2} / span 2" onclick={() => place(o.kind)}>
        {o.label}
        {#if mine.has(key(o.kind))}<b class="stack">{fmt(mine.get(key(o.kind))!)}</b>{/if}
      </button>
    {/each}
    {#each [1, 2, 3] as c (c)}
      <button class="cell out" class:hit={hit('column', c)} class:pulse={hit('column', c)} class:other={others.has(key('column', c))}
        style="grid-row:14;grid-column:{c + 1}" onclick={() => place('column', c)}>
        2:1{#if mine.has(key('column', c))}<b class="stack">{fmt(mine.get(key('column', c))!)}</b>{/if}
      </button>
    {/each}
  </section>

  <section class="controls panel">
    <div class="rack">
      {#each CHIP_VALUES as v (v)}
        <Chip value={v} selected={selected === v} disabled={(me?.chips ?? 0) < v} onclick={() => (selected = v)} size={52} />
      {/each}
    </div>
    <div class="betline">
      <span>En mesa: <strong>{fmt(myTotal)}</strong></span>
      <span class="btns">
        <button class="btn btn-ghost small" disabled={ro.phase !== 'betting' || myTotal > 0 || lastTotal === 0 || (me?.chips ?? 0) < lastTotal} onclick={() => net.send({ t: 'ro:rebet' })} title="Repetir la apuesta anterior ({fmt(lastTotal)})">Repetir</button>
        <button class="btn btn-ghost small" disabled={ro.phase !== 'betting' || myTotal === 0 || (me?.chips ?? 0) < myTotal} onclick={() => net.send({ t: 'ro:double' })}>Doblar</button>
        <button class="btn btn-ghost small" disabled={ro.phase !== 'betting' || myTotal === 0} onclick={() => net.send({ t: 'ro:undo' })}>Deshacer</button>
        <button class="btn btn-ghost small" disabled={ro.phase !== 'betting' || myTotal === 0} onclick={() => net.send({ t: 'ro:clear' })}>Quitar</button>
      </span>
    </div>
  </section>
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 10px; }
  .stage { padding: 14px 12px 12px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
  .status { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 0.9rem; color: var(--gold-hi); text-align: center; min-height: 1.5em; }
  .status.urgent { color: #ffb3a8; }
  .net { margin: 0; font-weight: 800; letter-spacing: 0.04em; }
  .net.pos { color: var(--ok); } .net.neg { color: #ff9b90; }
  .history { list-style: none; margin: 0; padding: 0; display: flex; gap: 5px; flex-wrap: wrap; justify-content: center; }
  .history li {
    min-width: 28px; height: 28px; padding: 0 4px; border-radius: 50%; display: grid; place-items: center;
    font-size: 0.74rem; font-weight: 800; border: 1px solid rgba(255, 255, 255, 0.25);
  }
  .history li.red { background: #a3202f; } .history li.black { background: #16130f; } .history li.green { background: #127a4a; }
  .history li.none { border: 0; background: none; color: rgba(255, 255, 255, 0.4); font-weight: 500; font-size: 0.8rem; width: auto; }

  .board {
    display: grid; grid-template-columns: 40px 1fr 1fr 1fr 48px; grid-template-rows: repeat(14, 34px);
    gap: 3px; padding: 8px; border-radius: 20px;
  }
  .board.locked .cell { opacity: 0.7; }
  .cell {
    position: relative; display: grid; place-items: center; border-radius: 8px; font-weight: 800; font-size: 0.95rem;
    border: 1px solid rgba(255, 255, 255, 0.25); color: #fff; transition: transform 0.1s, box-shadow 0.2s, opacity 0.2s;
  }
  .cell:active { transform: scale(0.94); }
  .cell.red { background: #a3202f; } .cell.black { background: #16130f; } .cell.green { background: #127a4a; }
  .zero { grid-row: 1; grid-column: 2 / 5; }
  .cell.out { background: rgba(0, 0, 0, 0.28); font-size: 0.7rem; letter-spacing: 0.04em; }
  .cell.out.red, .cell.out.black { font-size: 1.15rem; color: #f5efe0; }
  .cell.out.red { background: #a3202f; } .cell.out.black { background: #16130f; }
  .vlabel { writing-mode: vertical-rl; transform: rotate(180deg); white-space: nowrap; }
  .cell.other::before { content: ''; position: absolute; top: 3px; right: 3px; width: 6px; height: 6px; border-radius: 50%; background: var(--gold-hi); opacity: 0.85; }
  .cell.hit { z-index: 1; }
  .stack {
    position: absolute; bottom: 2px; right: 2px; min-width: 22px; height: 18px; padding: 0 4px;
    border-radius: 999px; font-size: 0.62rem; font-weight: 800; display: grid; place-items: center;
    background: var(--gold-grad); color: #2a1c05; box-shadow: 0 2px 5px rgba(0, 0, 0, 0.6);
  }

  .controls { padding: 12px 14px; position: sticky; bottom: calc(8px + var(--safe-b)); z-index: 5; background-color: var(--panel); box-shadow: 0 -8px 20px rgba(0, 0, 0, 0.45); }
  .rack { display: flex; justify-content: space-between; align-items: flex-end; padding: 8px 2px 2px; }
  .betline { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; font-size: 0.9rem; color: var(--muted); }
  .betline strong { color: var(--gold-hi); }
  .btns { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
  .btn.small { min-height: 34px; padding: 0 10px; font-size: 0.64rem; }
</style>
