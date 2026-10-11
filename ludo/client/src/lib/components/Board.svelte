<script lang="ts">
  import type { BoardSize, PlayerView } from '$shared/protocol';
  import { armColor, safeCells, startCell, trackLen, zoneOf } from '$shared/rules';
  import { geometry, type Pt } from '$lib/geometry';
  import Pawn from './Pawn.svelte';

  type Props = {
    board: BoardSize;
    /** Jugadores sentados: solo sus brazos van a todo color. Vacío = todos (vista previa). */
    players?: PlayerView[];
    /** Progreso que se dibuja de cada peón, por id de jugador. */
    shown?: Record<string, number[]>;
    /** Jugador con el turno (su patio se ilumina). */
    turnId?: string | null;
    /** Peones del jugador con turno que se pueden mover. */
    movable?: number[];
    /** ¿Puede el usuario actual pulsar los peones movibles? */
    canPick?: boolean;
    /** A qué progreso llegaría cada peón movible. */
    targets?: { pawn: number; p: number }[];
    popped?: string[];
    mini?: boolean;
    onpick?: (pawn: number) => void;
  };
  let {
    board,
    players = [],
    shown = {},
    turnId = null,
    movable = [],
    canPick = false,
    targets = [],
    popped = [],
    mini = false,
    onpick,
  }: Props = $props();

  const g = $derived(geometry(board));
  const T = $derived(trackLen(board));
  const safe = $derived(safeCells(board));
  const seated = $derived(players.filter((p) => !p.left));
  const activeArms = $derived(new Set(seated.length ? seated.map((p) => p.arm) : Array.from({ length: board }, (_, i) => i)));
  const hex = (arm: number) => armColor(board, arm).hex;
  const isActive = (arm: number) => activeArms.has(arm);
  const turnArm = $derived(seated.find((p) => p.id === turnId)?.arm ?? -1);

  const IDLE = '#d8d2c2';
  const tint = (arm: number) => (isActive(arm) ? `color-mix(in srgb, ${hex(arm)} 42%, #fff)` : '#ebe6d8');

  // Estrella de 5 puntas para las casillas seguras.
  function star(r: number, ri: number) {
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = (Math.PI / 5) * i - Math.PI / 2;
      const rr = i % 2 ? ri : r;
      pts.push(`${(Math.cos(a) * rr).toFixed(3)},${(Math.sin(a) * rr).toFixed(3)}`);
    }
    return pts.join(' ');
  }
  const STAR = star(0.3, 0.13);

  // Casillas del circuito con su papel (salida de un brazo, estrella segura o normal).
  const cells = $derived(
    g.track.map((c, i) => {
      const startArm = (i - 8 + T) % 13 === 0 ? Math.floor((i - 8 + T) / 13) % board : -1;
      return { ...c, i, startArm, safe: safe.has(i) };
    }),
  );

  // Peones: posición de cada uno, separando los que comparten casilla.
  interface PawnItem {
    key: string;
    playerId: string;
    pawn: number;
    arm: number;
    p: number;
    x: number;
    y: number;
    scale: number;
    color: string;
  }
  const pawns = $derived.by(() => {
    const items: PawnItem[] = [];
    for (const pl of seated) {
      const prog = shown[pl.id] ?? pl.pawns;
      for (let i = 0; i < 4; i++) {
        const p = prog[i] ?? 0;
        const pt = g.pawnPoint(pl.arm, p, i);
        items.push({ key: `${pl.id}:${i}`, playerId: pl.id, pawn: i, arm: pl.arm, p, x: pt.x, y: pt.y, scale: zoneOf(board, p) === 'done' ? 0.62 : 1, color: hex(pl.arm) });
      }
    }
    // Varios peones en la misma casilla: se reparten alrededor para que se vean todos.
    const groups = new Map<string, PawnItem[]>();
    for (const it of items) {
      const z = zoneOf(board, it.p);
      if (z === 'yard' || z === 'done') continue;
      const k = `${it.x.toFixed(2)},${it.y.toFixed(2)}`;
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(it);
    }
    for (const grp of groups.values()) {
      const n = grp.length;
      if (n < 2) continue;
      const r = n === 2 ? 0.2 : 0.3;
      grp.forEach((it, j) => {
        const a = (2 * Math.PI * j) / n + (n === 2 ? Math.PI / 2 : -Math.PI / 2);
        it.x += Math.cos(a) * r;
        it.y += Math.sin(a) * r * (n === 2 ? 0.4 : 0.8);
        it.scale = n === 2 ? 0.82 : n === 3 ? 0.74 : 0.66;
      });
    }
    return items;
  });

  let hovered = $state<number | null>(null);
  const targetPts = $derived(
    targets
      .map((t) => {
        const pl = seated.find((p) => p.id === turnId);
        if (!pl) return null;
        const pt: Pt = g.pawnPoint(pl.arm, t.p, t.pawn);
        return { pawn: t.pawn, ...pt, color: hex(pl.arm) };
      })
      .filter((t): t is NonNullable<typeof t> => t !== null),
  );
  const E = $derived(g.extent);
</script>

<svg
  class="board"
  class:mini
  viewBox="{-E} {-E} {2 * E} {2 * E}"
  role={mini ? 'img' : 'group'}
  aria-label={`Tablero de Ludo para ${board} jugadores`}
>
  <defs>
    <radialGradient id="paper-{board}-{mini ? 'm' : 'g'}" cx="50%" cy="45%" r="60%">
      <stop offset="0%" stop-color="#fbf7ea" />
      <stop offset="100%" stop-color="#eee6d0" />
    </radialGradient>
  </defs>

  <circle r={E - 0.1} fill="url(#paper-{board}-{mini ? 'm' : 'g'})" stroke="#0b0f1e" stroke-width="0.18" />

  <!-- Centro: un triángulo por brazo -->
  {#each g.wedges as w, k}
    <polygon
      points={w.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ')}
      fill={isActive(k) ? hex(k) : IDLE}
      stroke="#fff"
      stroke-width="0.07"
      stroke-linejoin="round"
    />
  {/each}

  <!-- Patios -->
  {#each g.yards as y, k}
    <g>
      <circle
        class="yard"
        class:turn={k === turnArm}
        cx={y.center.x}
        cy={y.center.y}
        r={y.radius}
        fill={tint(k)}
        stroke={isActive(k) ? hex(k) : IDLE}
        stroke-width="0.16"
      />
      {#each y.slots as s}
        <circle cx={s.x} cy={s.y} r="0.46" fill="#fff" opacity={isActive(k) ? 0.85 : 0.5} />
      {/each}
    </g>
  {/each}

  <!-- Circuito exterior -->
  {#each cells as c}
    {@const owner = c.startArm}
    <g transform="translate({c.x} {c.y}) rotate({c.rot})">
      <rect
        x="-0.46"
        y="-0.46"
        width="0.92"
        height="0.92"
        rx="0.16"
        fill={owner >= 0 ? (isActive(owner) ? hex(owner) : IDLE) : '#fff'}
        stroke="#cfc7b2"
        stroke-width="0.06"
      />
      {#if c.safe}
        <polygon points={STAR} fill={owner >= 0 ? '#fff' : '#bdb49c'} transform="rotate({-c.rot})" />
      {/if}
    </g>
  {/each}

  <!-- Pasillos de llegada -->
  {#each g.home as lane, k}
    {#each lane as c, j}
      <g transform="translate({c.x} {c.y}) rotate({c.rot})">
        <rect
          x="-0.46"
          y="-0.46"
          width="0.92"
          height="0.92"
          rx="0.16"
          fill={isActive(k) ? `color-mix(in srgb, ${hex(k)} ${j === 4 ? 78 : 60}%, #fff)` : '#ebe6d8'}
          stroke={isActive(k) ? hex(k) : '#cfc7b2'}
          stroke-width="0.06"
        />
        <path d="M -0.2 -0.1 L 0 0.14 L 0.2 -0.1" fill="none" stroke="#fff" stroke-width="0.09" stroke-linecap="round" stroke-linejoin="round" opacity="0.8" />
      </g>
    {/each}
  {/each}

  {#if !mini}
    <!-- Destinos posibles de los peones movibles -->
    {#each targetPts as t (t.pawn)}
      <circle class="target" class:hot={hovered === t.pawn} cx={t.x} cy={t.y} r="0.5" stroke={t.color} />
    {/each}

    <!-- Peones -->
    {#each pawns as it (it.key)}
      {@const can = canPick && it.playerId === turnId && movable.includes(it.pawn)}
      <Pawn
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
  {/if}
</svg>

<style>
  .board {
    display: block;
    width: 100%;
    height: auto;
    aspect-ratio: 1;
    touch-action: manipulation;
    user-select: none;
    -webkit-user-select: none;
    filter: drop-shadow(0 14px 30px rgba(0, 0, 0, 0.45));
  }
  .mini {
    filter: none;
  }
  .yard.turn {
    animation: glow 1.1s ease-in-out infinite;
  }
  .target {
    fill: none;
    stroke-width: 0.13;
    stroke-dasharray: 0.28 0.2;
    opacity: 0.85;
    pointer-events: none;
  }
  .target.hot {
    stroke-dasharray: none;
    opacity: 1;
    fill: rgba(255, 255, 255, 0.45);
  }
  @keyframes glow {
    0%, 100% { stroke-width: 0.16; }
    50% { stroke-width: 0.42; }
  }
  @media (prefers-reduced-motion: reduce) {
    .yard.turn { animation: none; stroke-width: 0.36; }
  }
</style>
