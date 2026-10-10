<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { RED_NUMBERS, WHEEL } from '../../shared/protocol';
  import { sfx } from '../lib/sound.svelte';

  let {
    phase,
    result,
    size = 'min(66vw, 250px)',
    ticks = true,
  }: { phase: 'betting' | 'spinning' | 'result'; result: number | null; size?: string; ticks?: boolean } = $props();

  const STEP = 360 / WHEEL.length;
  const polar = (r: number, deg: number) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [r * Math.cos(a), r * Math.sin(a)] as const;
  };
  const colorOf = (n: number) => (n === 0 ? 'green' : RED_NUMBERS.has(n) ? 'red' : 'black');
  const FILL = { green: '#127a4a', red: '#a3202f', black: '#16130f' } as const;

  const sectors = WHEEL.map((n, i) => {
    const [x0, y0] = polar(97, i * STEP - STEP / 2);
    const [x1, y1] = polar(97, i * STEP + STEP / 2);
    const [x2, y2] = polar(64, i * STEP + STEP / 2);
    const [x3, y3] = polar(64, i * STEP - STEP / 2);
    const [tx, ty] = polar(80, i * STEP);
    const f = (v: number) => v.toFixed(2);
    return {
      n,
      d: `M${f(x0)} ${f(y0)}A97 97 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A64 64 0 0 0 ${f(x3)} ${f(y3)}Z`,
      tx: f(tx), ty: f(ty), rot: i * STEP, fill: FILL[colorOf(n)],
    };
  });

  let rot = $state(0);
  let ball = $state(0);
  let anim = $state(false);
  let lastPhase: string | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };

  $effect(() => {
    const p = phase;
    const r = result;
    untrack(() => {
      const first = lastPhase === null;
      if (first && r !== null && p !== 'betting') {
        anim = false;
        rot = -WHEEL.indexOf(r) * STEP; // llegó tarde: muestra el resultado ya puesto
      } else if (p === 'spinning' && lastPhase !== 'spinning' && r !== null) {
        anim = true;
        rot = Math.ceil(rot / 360) * 360 + 360 * 6 - WHEEL.indexOf(r) * STEP;
        ball -= 360 * 9;
        clearTimers();
        if (ticks) for (let k = 0; k < 34; k++) timers.push(setTimeout(sfx.tick, 6300 * Math.pow(k / 34, 1.7)));
      }
      lastPhase = p;
    });
  });
  onDestroy(clearTimers);
</script>

<div class="wheelbox" style="--wsize:{size}">
  <svg viewBox="-104 -104 208 208" class="wheel" aria-label="Rueda de la ruleta">
    <defs>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color:var(--gold-hi)" /><stop offset=".5" style="stop-color:var(--gold)" /><stop offset="1" style="stop-color:var(--gold-lo)" />
      </linearGradient>
      <radialGradient id="hub" cx=".4" cy=".35"><stop offset="0" style="stop-color:var(--gold-hi)" /><stop offset="1" style="stop-color:var(--gold-lo)" /></radialGradient>
    </defs>
    <circle r="103" class="rim" />
    <g class="rotor" class:anim style="transform: rotate({rot}deg)">
      {#each sectors as s (s.n)}
        <path d={s.d} fill={s.fill} class="sector" />
        <text x={s.tx} y={s.ty} transform="rotate({s.rot} {s.tx} {s.ty})" text-anchor="middle" dominant-baseline="central" class="num">{s.n}</text>
      {/each}
      <circle r="62" fill="#1b130a" class="sector" />
      <circle r="40" fill="none" class="dash" />
      {#each [0, 90, 180, 270] as a (a)}
        <line x1="0" y1="0" x2="0" y2="-52" stroke="url(#gold)" stroke-width="3" stroke-linecap="round" transform="rotate({a})" />
      {/each}
      <circle r="9" fill="url(#hub)" />
    </g>
    <g class="ballg" class:anim style="transform: rotate({ball}deg)">
      <circle cy="-90" r="4.2" fill="#fff" stroke="#cfcfcf" stroke-width="0.6" />
    </g>
    <path d="M-6 -106 L6 -106 L0 -97Z" class="pointer" />
  </svg>
  {#if phase === 'result' && result !== null}
    <div class="bigres {colorOf(result)}" aria-hidden="true">{result}</div>
  {/if}
</div>

<style>
  .wheelbox { position: relative; width: var(--wsize); aspect-ratio: 1; border-radius: 50%; box-shadow: 0 10px 24px rgba(0, 0, 0, 0.55); }
  .wheel { width: 100%; height: 100%; overflow: visible; }
  .rim { fill: #2a1c06; stroke: url(#gold); stroke-width: 2; }
  .sector { stroke: var(--gold); stroke-width: 0.5; }
  .dash { stroke: var(--gold-lo); stroke-width: 0.6; stroke-dasharray: 3 3; }
  .pointer { fill: var(--gold-hi); stroke: #2a1c06; stroke-width: 0.8; }
  .rotor, .ballg { transform-origin: 0 0; transform-box: view-box; }
  .rotor.anim { transition: transform 6.6s cubic-bezier(0.12, 0.62, 0.14, 1); will-change: transform; }
  .ballg.anim { transition: transform 6.6s cubic-bezier(0.2, 0.55, 0.2, 1); will-change: transform; }
  .num { font-size: 7.4px; font-weight: 700; fill: #fff; font-family: var(--font-ui); }
  .bigres {
    position: absolute; inset: 0; margin: auto; width: 34%; height: 34%; border-radius: 50%;
    display: grid; place-items: center; font-family: var(--font-display); font-size: calc(var(--wsize) * 0.1); font-weight: 800;
    border: 3px solid var(--gold); box-shadow: 0 0 24px rgba(0, 0, 0, 0.7); animation: fadeUp 0.4s ease both;
  }
  .bigres.red { background: #a3202f; } .bigres.black { background: #16130f; } .bigres.green { background: #127a4a; }
</style>
