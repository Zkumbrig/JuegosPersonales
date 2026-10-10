<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { CHIP_VALUES, SLOT_PAY, type SlotSymbol } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import { fmt, vibrate } from '../lib/format';
  import { sfx } from '../lib/sound.svelte';
  import { celebrate } from '../lib/celebrate.svelte';
  import Chip from './Chip.svelte';
  import SlotSym from './SlotSym.svelte';
  import PlayerStrip from './PlayerStrip.svelte';

  const SYMS: SlotSymbol[] = ['cherry', 'lemon', 'bell', 'diamond', 'seven'];
  const NAME: Record<SlotSymbol, string> = { cherry: 'Cerezas', lemon: 'Limones', bell: 'Campanas', diamond: 'Diamantes', seven: 'Sietes' };
  const STRIP_LEN = 22; // símbolos que "pasan" antes de parar
  const STOP_MS = [1100, 1550, 2000];
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const me = $derived(net.me);
  let bet = $state(50);
  let strips = $state<SlotSymbol[][]>([['seven'], ['diamond'], ['cherry']]);
  let run = $state([false, false, false]);
  let busy = $state(false);
  let last = $state<{ win: number; bet: number } | null>(null);
  let timers: ReturnType<typeof setTimeout>[] = [];
  let ticker: ReturnType<typeof setInterval> | undefined;

  const rand = () => SYMS[Math.floor(Math.random() * SYMS.length)];
  const canSpin = $derived(!busy && (me?.chips ?? 0) >= bet && bet > 0);

  $effect(() => {
    const chips = me?.chips ?? 0;
    if (!busy && bet > chips) {
      const fit = [...CHIP_VALUES].reverse().find((v) => v <= chips);
      if (fit) bet = fit;
    }
  });

  function spin() {
    if (!canSpin) return;
    busy = true;
    last = null;
    net.send({ t: 'sl:spin', bet });
    vibrate(15);
  }

  // Llega el resultado del servidor: monta una tira por rodillo y la desliza hasta el símbolo final.
  let seen = 0;
  $effect(() => {
    const r = net.slot;
    if (!r || r.seq === seen) return;
    seen = r.seq;
    untrack(() => void play(r));
  });

  async function play(r: NonNullable<typeof net.slot>) {
    busy = true;
    timers.forEach(clearTimeout);
    timers = [];
    // 1) tira nueva (empieza en el símbolo que ya se veía) sin transición
    run = [false, false, false];
    strips = strips.map((s, i) => [s[s.length - 1], ...Array.from({ length: STRIP_LEN - 2 }, rand), r.reels[i]]);
    await tick();
    void document.body.offsetHeight; // fuerza el estado inicial antes de animar
    // 2) deslizar
    run = [true, true, true];
    if (reduce) {
      finish(r);
      return;
    }
    clearInterval(ticker);
    ticker = setInterval(sfx.tick, 90);
    STOP_MS.forEach((ms) => timers.push(setTimeout(sfx.stop, ms - 60)));
    timers.push(setTimeout(() => { clearInterval(ticker); finish(r); }, STOP_MS[2]));
    timers.push(setTimeout(() => (busy = false), 2450)); // el premio ya está acreditado en el servidor
  }

  function finish(r: NonNullable<typeof net.slot>) {
    if (r.win > 0) {
      const jackpot = r.win >= r.bet * 50;
      (jackpot ? sfx.jackpot : sfx.win)();
      celebrate(r.win >= r.bet * 20);
    } else {
      sfx.lose();
    }
    last = { win: r.win, bet: r.bet };
    if (reduce) busy = false;
  }

  onDestroy(() => { timers.forEach(clearTimeout); clearInterval(ticker); });
</script>

<div class="wrap">
  <PlayerStrip />

  <section class="machine">
    <h2 class="display gold-text">Tragaperras</h2>
    <div class="reels" class:won={last && last.win > 0} class:pulse={last && last.win > 0} style="--ring-count:3">
      {#each strips as strip, i (i)}
        <div class="reel">
          <div class="strip" class:run={run[i]} style="--n:{strip.length};--dur:{STOP_MS[i]}ms">
            {#each strip as sym, k (k)}
              <span class="cell"><SlotSym name={sym} size={72} /></span>
            {/each}
          </div>
        </div>
      {/each}
    </div>
    <p class="result" aria-live="polite">
      {#if last && last.win > 0}
        <span class="win">¡Ganas {fmt(last.win)}!</span>
      {:else if last}
        <span class="muted">Sin premio esta vez</span>
      {:else if busy}
        <span class="muted">Girando…</span>
      {:else}
        <span class="muted">Elige tu apuesta y tira de la palanca</span>
      {/if}
    </p>
  </section>

  <section class="controls panel">
    <div class="rack">
      {#each CHIP_VALUES as v (v)}
        <Chip value={v} selected={bet === v} disabled={busy || (me?.chips ?? 0) < v} onclick={() => (bet = v)} size={52} />
      {/each}
    </div>
    <button class="btn btn-gold spin" disabled={!canSpin} onclick={spin}>
      {busy ? 'Girando…' : `Girar · ${fmt(bet)}`}
    </button>
  </section>

  <section class="panel pay">
    <h3 class="display">Premios (× tu apuesta)</h3>
    <ul>
      {#each [...SYMS].reverse() as s (s)}
        <li><span class="g"><SlotSym name={s} size={22} /><SlotSym name={s} size={22} /><SlotSym name={s} size={22} /></span><span class="n">{NAME[s]}</span><b>×{SLOT_PAY[s]}</b></li>
      {/each}
      <li><span class="g"><SlotSym name="cherry" size={22} /><SlotSym name="cherry" size={22} /></span><span class="n">Dos cerezas</span><b>×1</b></li>
    </ul>
  </section>
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 10px; }
  .machine {
    text-align: center; padding: 18px 14px 16px; border-radius: 24px;
    background: linear-gradient(180deg, var(--machine-1), var(--machine-2));
    border: 2px solid var(--gold-lo);
    box-shadow: inset 0 0 50px rgba(0, 0, 0, 0.6), 0 12px 40px rgba(0, 0, 0, 0.5);
  }
  h2 { margin: 0 0 12px; font-size: 2rem; }
  .reels {
    --rh: clamp(104px, 34vw, 150px);
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 12px; border-radius: 18px;
    background: #090605; border: 3px solid transparent;
    background-image: linear-gradient(#090605, #090605), var(--gold-grad);
    background-origin: border-box; background-clip: padding-box, border-box;
  }
  .reel {
    position: relative; height: var(--rh); border-radius: 12px; overflow: hidden;
    background: linear-gradient(180deg, #d9d2bd 0%, #fffdf4 30%, #fffdf4 70%, #cfc7ae 100%);
  }
  /* Sombras de profundidad (estáticas) por encima de la tira */
  .reel::after {
    content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.42), transparent 28%, transparent 72%, rgba(0, 0, 0, 0.42));
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.25);
  }
  .strip { will-change: transform; transform: translate3d(0, 0, 0); }
  .strip.run {
    transform: translate3d(0, calc(var(--rh) * (var(--n) - 1) * -1), 0);
    transition: transform var(--dur) cubic-bezier(0.17, 0.72, 0.2, 1.03);
  }
  .cell { display: grid; place-items: center; height: var(--rh); }
  .cell :global(.sym) { width: calc(var(--rh) * 0.64); height: calc(var(--rh) * 0.64); }
  .result { margin: 14px 0 0; min-height: 1.8em; font-size: 0.95rem; }
  .win { font-family: var(--font-display); font-size: 1.25rem; font-weight: 700; color: var(--gold-hi); animation: fadeUp 0.3s ease both; }

  .controls { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 12px; }
  .rack { display: flex; justify-content: space-between; align-items: flex-end; padding-top: 8px; }
  .spin { min-height: 56px; font-size: 1rem; }

  .pay { padding: 12px 16px; }
  .pay h3 { margin: 0 0 8px; font-size: 1.1rem; color: var(--gold-hi); }
  .pay ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .pay li { display: grid; grid-template-columns: 76px 1fr auto; align-items: center; font-size: 0.86rem; }
  .pay .g { display: inline-flex; }
  .pay .g :global(.sym + .sym) { margin-left: -6px; }
  .pay .n { color: var(--muted); }
  .pay b { color: var(--gold-hi); font-variant-numeric: tabular-nums; }
</style>
