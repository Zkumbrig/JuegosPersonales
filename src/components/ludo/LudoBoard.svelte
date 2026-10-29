<script lang="ts">
  import { armColor, safeCells, startCell, trackLen, zoneOf, type BoardSize, type LudoSeat } from '../../../shared/ludo';
  import { armDeg, geometry, rotatePt, type Pt } from '../../lib/ludo/geometry';
  import type { Burst } from '../../lib/ludo/view.svelte';
  import LudoPawn from './LudoPawn.svelte';

  type Props = {
    board: BoardSize;
    /** Jugadores sentados: solo sus brazos van a todo color. Vacío = todos (vista previa). */
    seats?: LudoSeat[];
    /** Progreso que se dibuja de cada peón, por id de jugador. */
    shown?: Record<string, number[]>;
    /** Jugador con el turno (su patio se ilumina). */
    turnId?: string | null;
    /** Quien mira: su brazo se gira hacia abajo, como cuando juegas sentado a la mesa. */
    meId?: string | null;
    movable?: number[];
    canPick?: boolean;
    /** A qué progreso llegaría cada peón movible. */
    targets?: { pawn: number; p: number }[];
    popped?: string[];
    bursts?: Burst[];
    ripples?: Burst[];
    shake?: boolean;
    /** Placas con el nombre y el avance de cada jugador junto a su patio. */
    labels?: boolean;
    /** Ids de jugadores sin conexión. */
    offline?: string[];
    mini?: boolean;
    onpick?: (pawn: number) => void;
  };
  let {
    board, seats = [], shown = {}, turnId = null, meId = null, movable = [], canPick = false, targets = [],
    popped = [], bursts = [], ripples = [], shake = false, labels = false, offline = [], mini = false, onpick,
  }: Props = $props();

  const uid = $props.id();
  const g = $derived(geometry(board));
  const T = $derived(trackLen(board));
  const safe = $derived(safeCells(board));
  const live = $derived(seats.filter((s) => !s.left));
  const activeArms = $derived(new Set(live.length ? live.map((s) => s.arm) : Array.from({ length: board }, (_, i) => i)));
  const hex = (arm: number) => armColor(board, arm).hex;
  const isActive = (arm: number) => activeArms.has(arm);
  const turnArm = $derived(live.find((s) => s.id === turnId)?.arm ?? -1);
  const E = $derived(g.extent);

  // El tablero gira para que tu brazo quede abajo (solo en partida).
  const spin = $derived.by(() => {
    const me = live.find((s) => s.id === meId);
    return !mini && me ? 180 - armDeg(board, me.arm) : 0;
  });
  const R = (p: Pt) => rotatePt(p, spin);

  const IDLE = '#3a3328';

  // Estrella de 5 puntas.
  const star = (r: number, ri: number) =>
    Array.from({ length: 10 }, (_, i) => {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? ri : r;
      return `${(Math.cos(a) * rr).toFixed(3)},${(Math.sin(a) * rr).toFixed(3)}`;
    }).join(' ');
  const STAR = star(0.3, 0.125);

  const cells = $derived(
    g.track.map((c, i) => {
      const startArm = (i - 8 + T) % 13 === 0 ? Math.floor((i - 8 + T) / 13) % board : -1;
      const p = R(c);
      return { x: p.x, y: p.y, rot: c.rot + spin, i, arm: Math.floor(i / 13), startArm, safe: safe.has(i) };
    }),
  );
  const homes = $derived(
    g.home.map((lane, k) => lane.map((c) => {
      const p = R(c);
      return { x: p.x, y: p.y, rot: c.rot + spin };
    })),
  );
  const wedges = $derived(g.wedges.map((w) => w.map(R)));
  const yards = $derived(g.yards.map((y) => ({ c: R(y.center), r: y.radius, slots: y.slots.map(R) })));
  const inits = $derived(Object.fromEntries(live.map((s) => [s.arm, s.name.slice(0, 1).toUpperCase()])));

  // Peones: posición de cada uno; si comparten casilla se reparten para que se vean todos.
  interface Item { key: string; id: string; pawn: number; arm: number; p: number; x: number; y: number; scale: number; color: string }
  const pawns = $derived.by(() => {
    const items: Item[] = [];
    for (const s of live) {
      const prog = shown[s.id] ?? s.pawns;
      for (let i = 0; i < 4; i++) {
        const p = prog[i] ?? 0;
        const pt = R(g.pawnPoint(s.arm, p, i));
        items.push({ key: `${s.id}:${i}`, id: s.id, pawn: i, arm: s.arm, p, x: pt.x, y: pt.y, scale: zoneOf(board, p) === 'done' ? 0.6 : 1, color: hex(s.arm) });
      }
    }
    const groups = new Map<string, Item[]>();
    for (const it of items) {
      const z = zoneOf(board, it.p);
      if (z === 'yard' || z === 'done') continue;
      const k = `${it.x.toFixed(2)},${it.y.toFixed(2)}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
    }
    for (const grp of groups.values()) {
      const n = grp.length;
      if (n < 2) continue;
      const r = n === 2 ? 0.22 : 0.32;
      grp.forEach((it, j) => {
        const a = (2 * Math.PI * j) / n - Math.PI / 2;
        it.x += Math.cos(a) * r;
        it.y += Math.sin(a) * r * 0.85;
        it.scale = n === 2 ? 0.84 : n === 3 ? 0.76 : 0.68;
      });
    }
    return items;
  });

  // Tarjetas de los jugadores: tangentes al exterior de su patio (hacia el borde) para no pisar casillas.
  // El tamaño se ajusta al tablero: con más brazos hay menos hueco y los nombres se acortan.
  const PLATE = { 4: { chars: 8, font: 0.46 }, 6: { chars: 6, font: 0.44 }, 8: { chars: 5, font: 0.42 } } as const;
  /** Acerca la tarjeta al centro hasta que sus esquinas caigan dentro del tablero redondo. */
  const inside = (x: number, y: number, ux: number, uy: number, w: number, h: number) => {
    const lim = E - 0.3;
    const far = (px: number, py: number) => Math.max(...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => Math.hypot(px + a! * w / 2, py + b! * h / 2)));
    for (let i = 0; i < 40 && far(x, y) > lim; i++) { x -= ux * 0.05; y -= uy * 0.05; }
    return { x, y };
  };
  const plates = $derived.by(() => {
    if (!labels || mini) return [];
    const cfg = PLATE[board];
    return live.map((s) => {
      const y = yards[s.arm]!;
      const full = s.id === meId ? 'Tú' : s.name;
      const name = [...full].length > cfg.chars ? `${[...full].slice(0, cfg.chars - 1).join('')}…` : full;
      const w = 0.95 + [...name].length * cfg.font * 0.64 + 0.3;
      const h = 1.1;
      const d = Math.hypot(y.c.x, y.c.y) || 1;
      const ux = y.c.x / d;
      const uy = y.c.y / d;
      const half = Math.abs(ux) * (w / 2) + Math.abs(uy) * (h / 2);
      const prog = shown[s.id] ?? s.pawns;
      return {
        id: s.id, arm: s.arm, name, w, h, font: cfg.font, initial: s.name.slice(0, 1).toUpperCase(),
        pips: prog.map((p) => (zoneOf(board, p) === 'done' ? 2 : p > 0 ? 1 : 0)),
        rank: s.rank, left: s.left, auto: s.auto, off: offline.includes(s.id),
        ...inside(y.c.x + ux * (y.r + 0.25 + half), y.c.y + uy * (y.r + 0.25 + half), ux, uy, w, h),
      };
    });
  });

  let hovered = $state<number | null>(null);
  const turnSeat = $derived(live.find((s) => s.id === turnId));
  const targetPts = $derived(
    turnSeat
      ? targets.map((t) => {
          const from = (shown[turnSeat.id] ?? turnSeat.pawns)[t.pawn] ?? 0;
          const path: Pt[] = [];
          for (let q = Math.max(1, from + 1); q <= t.p; q++) path.push(R(g.pawnPoint(turnSeat.arm, q, t.pawn)));
          const end = R(g.pawnPoint(turnSeat.arm, t.p, t.pawn));
          return { pawn: t.pawn, end, path: [R(g.pawnPoint(turnSeat.arm, from, t.pawn)), ...path], color: hex(turnSeat.arm) };
        })
      : [],
  );

  const SPARKS = Array.from({ length: 10 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 10 + 0.3;
    return { dx: Math.cos(a) * (0.9 + (i % 3) * 0.28), dy: Math.sin(a) * (0.9 + (i % 3) * 0.28) };
  });
</script>

<div class="table" class:mini class:shake aria-label={`Tablero de Ludo para ${board} jugadores`} role={mini ? 'img' : 'group'}>
  <div class="felt">
    <svg viewBox="{-E} {-E} {2 * E} {2 * E}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="tile-{uid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fffdf5" />
          <stop offset="1" stop-color="#e6dcc0" />
        </linearGradient>
        <linearGradient id="gold-{uid}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style="stop-color: var(--gold-hi)" />
          <stop offset="0.5" style="stop-color: var(--gold)" />
          <stop offset="1" style="stop-color: var(--gold-lo)" />
        </linearGradient>
        {#each Array.from({ length: board }, (_, k) => k) as k (k)}
          <linearGradient id="lane-{uid}-{k}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="color-mix(in srgb, {hex(k)} 62%, #fff)" />
            <stop offset="0.55" stop-color={hex(k)} />
            <stop offset="1" stop-color="color-mix(in srgb, {hex(k)} 72%, #000)" />
          </linearGradient>
          <radialGradient id="pw-{uid}-{k}" cx="0.36" cy="0.3" r="0.85">
            <stop offset="0" stop-color="color-mix(in srgb, {hex(k)} 45%, #fff)" />
            <stop offset="0.45" stop-color={hex(k)} />
            <stop offset="1" stop-color="color-mix(in srgb, {hex(k)} 55%, #000)" />
          </radialGradient>
          <radialGradient id="gem-{uid}-{k}" gradientUnits="userSpaceOnUse" cx="0" cy="0" r={g.hubRadius * 1.05}>
            <stop offset="0" stop-color="color-mix(in srgb, {hex(k)} 40%, #fff)" />
            <stop offset="0.6" stop-color={hex(k)} />
            <stop offset="1" stop-color="color-mix(in srgb, {hex(k)} 65%, #000)" />
          </radialGradient>
          <radialGradient id="yd-{uid}-{k}" cx="0.5" cy="0.4" r="0.7">
            <stop offset="0" stop-color="color-mix(in srgb, {hex(k)} 42%, #1a120c)" />
            <stop offset="1" stop-color="color-mix(in srgb, {hex(k)} 16%, #0a0705)" />
          </radialGradient>
        {/each}
      </defs>

      <!-- Filetes dorados del tapete -->
      <circle r={E - 0.55} fill="none" style="stroke: var(--gold)" stroke-width="0.06" opacity="0.4" />
      <circle r={E - 0.95} fill="none" style="stroke: var(--gold)" stroke-width="0.03" opacity="0.25" />

      <!-- Patios -->
      {#each yards as y, k (k)}
        <g>
          <circle cx={y.c.x} cy={y.c.y} r={y.r + 0.12} fill="rgba(0,0,0,.35)" />
          <circle
            cx={y.c.x}
            cy={y.c.y}
            r={y.r}
            fill={isActive(k) ? `url(#yd-${uid}-${k})` : '#14100c'}
            stroke={isActive(k) ? hex(k) : IDLE}
            stroke-width="0.16"
          />
          {#if isActive(k)}
            <circle cx={y.c.x} cy={y.c.y} r={y.r - 0.16} fill="none" stroke="rgba(255,255,255,.18)" stroke-width="0.04" />
          {/if}
          {#each y.slots as s, i (i)}
            <circle cx={s.x} cy={s.y} r="0.5" fill="rgba(0,0,0,.5)" />
            <circle cx={s.x} cy={s.y} r="0.5" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="0.05" />
          {/each}
          {#if isActive(k) && !mini && inits[k]}
            <circle cx={y.c.x} cy={y.c.y} r="0.36" fill={hex(k)} stroke="rgba(255,255,255,.7)" stroke-width="0.05" />
            <text x={y.c.x} y={y.c.y + 0.02} class="initial" text-anchor="middle" dominant-baseline="central">{inits[k]}</text>
          {/if}
          {#if k === turnArm && !mini}
            <circle class="turnring" cx={y.c.x} cy={y.c.y} r={y.r + 0.28} style:stroke={hex(k)} />
          {/if}
        </g>
      {/each}

      <!-- Circuito exterior -->
      {#each cells as c (c.i)}
        <g transform="translate({c.x.toFixed(3)} {c.y.toFixed(3)}) rotate({c.rot.toFixed(2)})">
          <rect x="-0.47" y="-0.45" width="0.94" height="0.94" rx="0.17" fill="rgba(0,0,0,.45)" />
          <rect
            x="-0.47"
            y="-0.5"
            width="0.94"
            height="0.94"
            rx="0.17"
            fill={c.startArm >= 0 ? (isActive(c.startArm) ? `url(#lane-${uid}-${c.startArm})` : '#2a241b') : `url(#tile-${uid})`}
          />
          {#if c.startArm < 0 && isActive(c.arm)}
            <rect x="-0.47" y="-0.5" width="0.94" height="0.94" rx="0.17" fill={hex(c.arm)} opacity="0.13" />
          {/if}
          <rect x="-0.4" y="-0.46" width="0.8" height="0.07" rx="0.035" fill="#fff" opacity="0.55" />
        </g>
        {#if c.safe}
          <polygon
            points={STAR}
            transform="translate({c.x.toFixed(3)} {(c.y - 0.03).toFixed(3)})"
            fill={c.startArm >= 0 ? '#fff' : `url(#gold-${uid})`}
            stroke={c.startArm >= 0 ? 'none' : 'rgba(0,0,0,.35)'}
            stroke-width="0.03"
          />
        {/if}
      {/each}

      <!-- Pasillos de llegada -->
      {#each homes as lane, k (k)}
        {#each lane as c, j (j)}
          <g transform="translate({c.x.toFixed(3)} {c.y.toFixed(3)}) rotate({c.rot.toFixed(2)})">
            <rect x="-0.47" y="-0.45" width="0.94" height="0.94" rx="0.17" fill="rgba(0,0,0,.45)" />
            <rect x="-0.47" y="-0.5" width="0.94" height="0.94" rx="0.17" fill={isActive(k) ? `url(#lane-${uid}-${k})` : '#2a241b'} />
            <rect x="-0.4" y="-0.46" width="0.8" height="0.07" rx="0.035" fill="#fff" opacity="0.4" />
            <path d="M -0.2 -0.12 L 0 0.1 L 0.2 -0.12" fill="none" stroke="#fff" stroke-width="0.09" stroke-linecap="round" stroke-linejoin="round" opacity="0.85" />
          </g>
        {/each}
      {/each}

      <!-- Centro: una gema por brazo -->
      {#each wedges as w, k (k)}
        <polygon
          points={w.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ')}
          fill={isActive(k) ? `url(#gem-${uid}-${k})` : '#1d1912'}
          style="stroke: var(--gold-hi)"
          stroke-width="0.07"
          stroke-linejoin="round"
          stroke-opacity="0.85"
        />
      {/each}
      <circle r="0.62" fill="url(#gold-{uid})" stroke="rgba(0,0,0,.4)" stroke-width="0.05" />
      <circle r="0.3" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="0.05" />

      {#if !mini}
        <!-- Camino del peón señalado y destinos posibles -->
        {#each targetPts as t (t.pawn)}
          {#if hovered === t.pawn && t.path.length > 1}
            <polyline class="path" points={t.path.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} />
          {/if}
          <circle class="target" class:hot={hovered === t.pawn} cx={t.end.x} cy={t.end.y} r="0.52" style:stroke={t.color} />
        {/each}

        <!-- Participantes: tarjeta con avatar, nombre y progreso junto a su patio -->
        {#each plates as pl (pl.id)}
          <g class="plate" class:turn={pl.id === turnId} class:gone={pl.left} style:transform="translate({pl.x}px, {pl.y}px)" style:--c={hex(pl.arm)}>
            <rect x={-pl.w / 2} y={-pl.h / 2} width={pl.w} height={pl.h} rx="0.38" class="pbg" />
            <circle cx={-pl.w / 2 + 0.52} cy="0" r="0.34" fill={hex(pl.arm)} class="pav" />
            <text x={-pl.w / 2 + 0.52} y="0.03" class="pini" text-anchor="middle" dominant-baseline="central">{pl.initial}</text>
            <text x={-pl.w / 2 + 1.0} y="-0.17" class="pname" style:font-size="{pl.font}px" dominant-baseline="central">{pl.name}</text>
            {#if pl.rank}
              <text x={-pl.w / 2 + 1.0} y="0.28" class="prank" dominant-baseline="central">{pl.rank}º lugar</text>
            {:else}
              {#each pl.pips as k, i (i)}
                <rect x={-pl.w / 2 + 1.0 + i * 0.3} y="0.14" width="0.22" height="0.26" rx="0.07" class="pip pip{k}" />
              {/each}
            {/if}
            {#if pl.off || pl.auto}<circle cx={pl.w / 2 - 0.2} cy={-pl.h / 2 + 0.2} r="0.14" class={pl.off ? 'dot off' : 'dot auto'} />{/if}
          </g>
        {/each}

        <!-- Peones -->
        {#each pawns as it (it.key)}
          {@const can = canPick && it.id === turnId && movable.includes(it.pawn)}
          <LudoPawn
            {uid}
            arm={it.arm}
            x={it.x}
            y={it.y}
            p={it.p}
            scale={it.scale}
            color={it.color}
            movable={can}
            popped={popped.includes(it.key)}
            label={`Mover el peón ${it.pawn + 1}`}
            onpick={() => onpick?.(it.pawn)}
            onhover={(on) => (hovered = on ? it.pawn : hovered === it.pawn ? null : hovered)}
          />
        {/each}

        <!-- Ondas al caer cada peón -->
        {#each ripples as r (r.id)}
          {@const rp = R(r)}
          <circle class="ripple" class:big={r.big} cx={rp.x} cy={rp.y} r="0.3" style:stroke={r.color} />
        {/each}

        <!-- Chispas de capturas y llegadas -->
        {#each bursts as b (b.id)}
          {@const bp = R(b)}
          <g style:transform="translate({bp.x}px, {bp.y}px)" class="burst">
            {#each SPARKS as s, i (i)}
              <circle class="spark" r="0.13" fill={i % 3 === 0 ? '#fff' : b.color} style:--dx="{s.dx}px" style:--dy="{s.dy}px" />
            {/each}
            <circle class="shock" r="0.4" style:stroke={b.color} />
          </g>
        {/each}
      {/if}
    </svg>
  </div>
</div>

<style>
  /* Aro de oro (foil del tema) alrededor de un fieltro con grano: todo estático. */
  .table {
    position: relative;
    width: 100%;
    aspect-ratio: 1;
    padding: 2.6%;
    border-radius: 50%;
    background: var(--foil);
    box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55), inset 0 0 0 2px rgba(0, 0, 0, 0.35);
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
  }
  .table.mini { padding: 3.2%; box-shadow: none; }
  .felt {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    overflow: hidden;
    background:
      var(--grain),
      radial-gradient(80% 80% at 50% 38%, var(--felt-hi) 0%, var(--felt) 58%, var(--felt-dark) 100%);
    background-blend-mode: soft-light, normal;
    box-shadow: inset 0 0 0 3px rgba(0, 0, 0, 0.45), inset 0 0 38px rgba(0, 0, 0, 0.6);
  }
  svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .initial { font: 800 0.5px var(--font-display); fill: #fff; paint-order: stroke; stroke: rgba(0, 0, 0, 0.35); stroke-width: 0.06px; }
  .turnring {
    fill: none;
    stroke-width: 0.18;
    transform-box: fill-box;
    transform-origin: center;
    animation: turn 1.2s ease-in-out infinite;
  }
  .target {
    fill: rgba(255, 255, 255, 0.08);
    stroke-width: 0.12;
    stroke-dasharray: 0.26 0.2;
    opacity: 0.9;
    pointer-events: none;
    transform-box: fill-box;
    transform-origin: center;
    animation: tgt 1.1s ease-in-out infinite;
  }
  .target.hot { stroke-dasharray: none; fill: rgba(255, 255, 255, 0.4); opacity: 1; }
  .path {
    fill: none;
    stroke: var(--gold-hi);
    stroke-width: 0.12;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-dasharray: 0.01 0.26;
    opacity: 0.95;
    pointer-events: none;
  }
  .spark { transform-box: fill-box; transform-origin: center; animation: spark 0.8s cubic-bezier(0.1, 0.7, 0.3, 1) forwards; }
  .shock { fill: none; stroke-width: 0.12; transform-box: fill-box; transform-origin: center; animation: shock 0.7s ease-out forwards; }
  .plate { pointer-events: none; transition: transform 0.2s; }
  .pbg { fill: rgba(10, 8, 12, 0.86); stroke: var(--c); stroke-width: 0.08; }
  .plate.turn .pbg { stroke-width: 0.16; fill: color-mix(in srgb, var(--c) 28%, #0a080c); animation: platepulse 1.2s ease-in-out infinite; }
  .plate.gone { opacity: 0.4; }
  .pname { font-family: var(--font-ui); font-weight: 700; fill: #fff; }
  .pini { font: 800 0.4px var(--font-display); fill: #fff; paint-order: stroke; stroke: rgba(0, 0, 0, 0.35); stroke-width: 0.05px; }
  .prank { font: 800 0.34px var(--font-display); fill: var(--gold-hi); }
  .pip { fill: none; stroke: color-mix(in srgb, var(--c) 70%, #fff); stroke-width: 0.05; }
  .pip.pip1 { fill: color-mix(in srgb, var(--c) 50%, transparent); }
  .pip.pip2 { fill: var(--c); }
  .dot.off { fill: #e0564b; }
  .dot.auto { fill: #ecb84a; }
  @keyframes platepulse { 0%, 100% { opacity: 0.75; } 50% { opacity: 1; } }
  .burst { pointer-events: none; }
  .ripple { fill: none; stroke-width: 0.1; pointer-events: none; transform-box: fill-box; transform-origin: center; animation: ripple 0.6s ease-out forwards; }
  .ripple.big { stroke-width: 0.16; animation-duration: 0.8s; }
  .table.shake { animation: shake 0.5s cubic-bezier(0.3, 0.1, 0.3, 1); }
  @keyframes ripple { 0% { transform: scale(0.5); opacity: 0.9; } 100% { transform: scale(2.6); opacity: 0; } }
  @keyframes shake { 0%, 100% { transform: translate(0, 0); } 15% { transform: translate(-1.4%, 0.6%) rotate(-0.4deg); } 35% { transform: translate(1.2%, -0.8%) rotate(0.4deg); } 55% { transform: translate(-0.8%, 0.5%); } 75% { transform: translate(0.5%, -0.3%); } }
  @keyframes turn { 0%, 100% { opacity: 0.25; transform: scale(0.97); } 50% { opacity: 1; transform: scale(1.04); } }
  @keyframes tgt { 0%, 100% { transform: scale(0.94); } 50% { transform: scale(1.07); } }
  @keyframes spark { 0% { transform: translate(0, 0) scale(1); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(0.2); opacity: 0; } }
  @keyframes shock { 0% { transform: scale(0.4); opacity: 0.9; } 100% { transform: scale(2.8); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) {
    .turnring, .target, .spark, .shock, .ripple, .table.shake { animation: none; }
    .spark, .shock { opacity: 0; }
  }
</style>
