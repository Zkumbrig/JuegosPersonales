// Reglas puras del Ludo, válidas para tableros de 4, 6 y 8 brazos.
// Las usan el servidor (autoridad) y el cliente (para pintar y animar).
//
// Modelo del recorrido
// --------------------
// El tablero es una estrella de N brazos (N = 4, 6 u 8) numerados 0..N-1 en sentido horario
// empezando por el de arriba. Cada brazo aporta 13 casillas al circuito exterior:
//   6 de ida (carril izquierdo) + 1 de la punta + 6 de vuelta (carril derecho).
// El circuito tiene T = 13·N casillas y se recorre en sentido horario.
//
// Cada peón tiene un "progreso" p propio:
//   p = 0            en casa (el patio)
//   p = 1            casilla de salida de su brazo
//   p = 1 .. T-1     circuito exterior (51 casillas en el Ludo clásico de 4)
//   p = T .. T+4     pasillo de llegada de su color (5 casillas, solo suyas)
//   p = T+5          meta
// Sale de casa únicamente con un 6.

import type { BoardSize, RoomOptions } from './protocol';

export const ARM_CELLS = 13;
export const HOME_STEPS = 5;
export const PAWNS = 4;
/** Posición de la casilla de salida dentro del segmento de 13 casillas de su brazo. */
const START_OFFSET = 8;
/** Distancia (en casillas) entre una salida y la casilla segura "estrella" siguiente. */
const STAR_OFFSET = 8;

export const trackLen = (board: number) => board * ARM_CELLS;
export const finalPos = (board: number) => board * ARM_CELLS + HOME_STEPS;
export const startCell = (arm: number) => arm * ARM_CELLS + START_OFFSET;

/** Casilla del circuito (0..T-1) donde está un peón de `arm` con progreso `p`; null si no está en el circuito. */
export function trackCell(board: number, arm: number, p: number): number | null {
  const T = trackLen(board);
  if (p < 1 || p > T - 1) return null;
  return (startCell(arm) + p - 1) % T;
}

const safeCache = new Map<number, ReadonlySet<number>>();
/** Casillas seguras: la salida de cada brazo y la "estrella" 8 casillas después. Ahí conviven peones rivales. */
export function safeCells(board: number): ReadonlySet<number> {
  let s = safeCache.get(board);
  if (!s) {
    const T = trackLen(board);
    const set = new Set<number>();
    for (let a = 0; a < board; a++) {
      set.add(startCell(a) % T);
      set.add((startCell(a) + STAR_OFFSET) % T);
    }
    safeCache.set(board, set);
    s = set;
  }
  return s;
}

export type Zone = 'yard' | 'track' | 'home' | 'done';
export function zoneOf(board: number, p: number): Zone {
  if (p <= 0) return 'yard';
  if (p < trackLen(board)) return 'track';
  if (p < finalPos(board)) return 'home';
  return 'done';
}

/** Brazos que se ocupan al sentarse, en orden de llegada: reparte a los jugadores lo más separados posible. */
const SEAT_ORDER: Record<BoardSize, readonly number[]> = {
  4: [0, 2, 1, 3],
  6: [0, 3, 1, 4, 2, 5],
  8: [0, 4, 2, 6, 1, 5, 3, 7],
};
export const seatOrder = (board: BoardSize) => SEAT_ORDER[board];

export interface ArmColor {
  key: string;
  name: string;
  hex: string;
}
const PALETTE: Record<string, ArmColor> = {
  red: { key: 'red', name: 'Rojo', hex: '#e5383b' },
  green: { key: 'green', name: 'Verde', hex: '#22b573' },
  yellow: { key: 'yellow', name: 'Amarillo', hex: '#f6b800' },
  blue: { key: 'blue', name: 'Azul', hex: '#2f7de1' },
  orange: { key: 'orange', name: 'Naranja', hex: '#ff7a1a' },
  purple: { key: 'purple', name: 'Morado', hex: '#8b5cf6' },
  teal: { key: 'teal', name: 'Turquesa', hex: '#12b5c4' },
  pink: { key: 'pink', name: 'Rosa', hex: '#ec4899' },
};
// Colores por brazo, ordenados para que los vecinos se distingan bien.
const ARM_COLORS: Record<BoardSize, readonly string[]> = {
  4: ['red', 'green', 'yellow', 'blue'],
  6: ['red', 'green', 'orange', 'blue', 'yellow', 'purple'],
  8: ['red', 'teal', 'yellow', 'pink', 'blue', 'orange', 'green', 'purple'],
};
export function armColor(board: BoardSize, arm: number): ArmColor {
  const list = ARM_COLORS[board];
  return PALETTE[list[arm % list.length]!]!;
}

/** Lo mínimo que necesitan las reglas de un jugador sentado. */
export interface Seat {
  arm: number;
  pawns: number[];
}

type Rules = Pick<RoomOptions, 'exactFinish' | 'towers'>;

/** A qué progreso llegaría un peón en `p` con `dice`, o null si no puede moverse. */
export function targetOf(board: number, rules: Rules, p: number, dice: number): number | null {
  const FIN = finalPos(board);
  if (p <= 0) return dice === 6 ? 1 : null; // solo se sale de casa con un 6
  if (p >= FIN) return null;
  const np = p + dice;
  if (np > FIN) return rules.exactFinish ? null : FIN;
  return np;
}

/** Índices de los peones de `seat` que pueden mover con `dice`. */
export function legalMoves(board: number, rules: Rules, seat: Seat, dice: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < seat.pawns.length; i++) {
    if (targetOf(board, rules, seat.pawns[i]!, dice) !== null) out.push(i);
  }
  return out;
}

/** Quita los movimientos equivalentes (peones con el mismo progreso): sacar uno u otro de casa es igual. */
export function distinctMoves(seat: Seat, movable: number[]): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const i of movable) {
    const p = seat.pawns[i]!;
    if (!seen.has(p)) {
      seen.add(p);
      out.push(i);
    }
  }
  return out;
}

/** Peones rivales que se comerían si el peón de `seats[si]` aterrizara en la casilla `cell`. */
export function capturesAt(
  board: number,
  rules: Rules,
  seats: readonly Seat[],
  si: number,
  cell: number,
): { seat: number; pawn: number }[] {
  if (safeCells(board).has(cell)) return [];
  const out: { seat: number; pawn: number }[] = [];
  for (let s = 0; s < seats.length; s++) {
    if (s === si) continue;
    const other = seats[s]!;
    const here: number[] = [];
    for (let i = 0; i < other.pawns.length; i++) {
      if (trackCell(board, other.arm, other.pawns[i]!) === cell) here.push(i);
    }
    if (rules.towers && here.length >= 2) continue; // pareja protegida
    for (const pawn of here) out.push({ seat: s, pawn });
  }
  return out;
}

export interface MoveResult {
  from: number;
  to: number;
  captured: { seat: number; pawn: number; from: number }[];
  reachedHome: boolean;
}

/** Aplica el movimiento (modifica `seats`). Lanza si no es legal. */
export function applyMove(
  board: number,
  rules: Rules,
  seats: Seat[],
  si: number,
  pawn: number,
  dice: number,
): MoveResult {
  const seat = seats[si]!;
  const from = seat.pawns[pawn]!;
  const to = targetOf(board, rules, from, dice);
  if (to === null) throw new Error('movimiento ilegal');
  const cell = trackCell(board, seat.arm, to);
  const captured: MoveResult['captured'] = [];
  if (cell !== null) {
    for (const c of capturesAt(board, rules, seats, si, cell)) {
      captured.push({ ...c, from: seats[c.seat]!.pawns[c.pawn]! });
    }
  }
  seat.pawns[pawn] = to;
  for (const c of captured) seats[c.seat]!.pawns[c.pawn] = 0;
  return { from, to, captured, reachedHome: to === finalPos(board) };
}

export const allHome = (board: number, seat: Seat) => seat.pawns.every((p) => p === finalPos(board));
