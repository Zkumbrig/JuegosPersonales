// Geometría del tablero: convierte el recorrido lógico (reglas compartidas) en coordenadas.
//
// El tablero es una estrella de N brazos (4, 6 u 8). Todo se mide en "casillas" (1 casilla = 1 unidad)
// y se centra en (0,0). Cada brazo mide 3 casillas de ancho: carril de ida, carril central
// (la punta y el pasillo de llegada) y carril de vuelta.
//
//   u = distancia desde el centro hacia afuera siguiendo el brazo
//   v = desplazamiento lateral (+1 = lado derecho mirando hacia afuera, el de la vuelta)
//
// Las esquinas de brazos contiguos se encuentran justo en los vértices de un polígono central de N lados,
// por eso el primer cuadrado de un brazo está a U0 = 0.5 + 1.5 / tan(π/N) del centro.

import { ARM_CELLS, HOME_STEPS, finalPos, trackCell, trackLen, type BoardSize } from '../../../shared/ludo';

export interface Pt {
  x: number;
  y: number;
}
export interface CellGeo extends Pt {
  /** Giro en grados: el de su brazo, para que el cuadrado quede alineado con el carril. */
  rot: number;
}

export interface Geometry {
  board: BoardSize;
  /** Mitad del lado del viewBox (el tablero cabe en [-extent, extent]). */
  extent: number;
  /** Casillas del circuito exterior, en orden de recorrido. */
  track: CellGeo[];
  /** Pasillo de llegada de cada brazo, de la entrada (0) hacia el centro (4). */
  home: CellGeo[][];
  yards: { center: Pt; radius: number; slots: Pt[] }[];
  /** Triángulo de cada brazo en el centro: centro + 2 vértices del polígono. */
  wedges: Pt[][];
  /** Dónde se colocan los peones que ya llegaron a la meta. */
  hubSlots: Pt[][];
  /** Radio del polígono central (hasta los vértices). */
  hubRadius: number;
  /** Posición de un peón con progreso `p` de un brazo; `slot` (0..3) lo coloca en el patio/meta. */
  pawnPoint(arm: number, p: number, slot: number): Pt;
}

/** Punto a distancia r del centro, con el ángulo medido en sentido horario desde arriba. */
const polar = (angle: number, r: number): Pt => ({ x: Math.sin(angle) * r, y: -Math.cos(angle) * r });

const YARD_RADIUS: Record<BoardSize, number> = { 4: 1.6, 6: 1.4, 8: 1.25 };

const cache = new Map<BoardSize, Geometry>();

export function geometry(board: BoardSize): Geometry {
  const hit = cache.get(board);
  if (hit) return hit;
  const g = build(board);
  cache.set(board, g);
  return g;
}

function build(board: BoardSize): Geometry {
  const N = board;
  const phi = (2 * Math.PI) / N;
  const U0 = 0.5 + 1.5 / Math.tan(Math.PI / N);
  const armAngle = (k: number) => k * phi;

  /** Punto en el sistema del brazo k. */
  const at = (k: number, u: number, v: number): CellGeo => {
    const a = armAngle(k);
    const e = polar(a, 1); // hacia afuera
    const r = { x: Math.cos(a), y: Math.sin(a) }; // a la derecha mirando hacia afuera
    return { x: e.x * u + r.x * v, y: e.y * u + r.y * v, rot: (a * 180) / Math.PI };
  };

  // Circuito: por cada brazo, ida (carril izquierdo), punta y vuelta (carril derecho).
  const track: CellGeo[] = [];
  for (let k = 0; k < N; k++) {
    for (let d = 0; d < 6; d++) track.push(at(k, U0 + d, -1));
    track.push(at(k, U0 + 5, 0));
    for (let d = 0; d < 6; d++) track.push(at(k, U0 + 5 - d, 1));
  }
  if (track.length !== trackLen(N) || ARM_CELLS !== 13) throw new Error('geometría incoherente con las reglas');

  const home = Array.from({ length: N }, (_, k) =>
    Array.from({ length: HOME_STEPS }, (_, c) => at(k, U0 + 4 - c, 0)),
  );

  // Polígono central y sus triángulos.
  const apothem = U0 - 0.5;
  const hubRadius = apothem / Math.cos(phi / 2);
  const vertex = (k: number) => polar(armAngle(k) + phi / 2, hubRadius); // entre el brazo k y el k+1
  const wedges = Array.from({ length: N }, (_, k) => [{ x: 0, y: 0 }, vertex((k + N - 1) % N), vertex(k)]);

  // Meta: 2×2 peones pequeños dentro del triángulo de cada brazo.
  const hubSlots = Array.from({ length: N }, (_, k) => {
    const out: Pt[] = [];
    for (const u of [0.42, 0.8]) for (const v of [-0.3, 0.3]) {
      const c = at(k, apothem * u, v * Math.min(1, apothem / 1.5));
      out.push({ x: c.x, y: c.y });
    }
    return out;
  });

  // Patios: círculos en el hueco entre un brazo y el siguiente (el lado de su carril de vuelta).
  const rho = YARD_RADIUS[board];
  const s = (rho - 0.4) / Math.SQRT2;
  const ry = (rho + 1.5 + 0.3) / Math.sin(phi / 2);
  const yards = Array.from({ length: N }, (_, k) => {
    const center = polar(armAngle(k) + phi / 2, ry);
    const slots: Pt[] = [];
    for (const dy of [-s, s]) for (const dx of [-s, s]) slots.push({ x: center.x + dx, y: center.y + dy });
    return { center, radius: rho, slots };
  });

  let extent = 0;
  for (const c of track) extent = Math.max(extent, Math.hypot(c.x, c.y) + 0.75);
  for (const y of yards) extent = Math.max(extent, Math.hypot(y.center.x, y.center.y) + y.radius + 0.25);
  extent = Math.ceil((extent + 0.35) * 2) / 2 + (board === 8 ? 1.2 : 0.9); // margen: las tarjetas de los jugadores asoman por fuera de los patios

  const FIN = finalPos(N);
  const pawnPoint = (arm: number, p: number, slot: number): Pt => {
    if (p <= 0) return yards[arm]!.slots[slot]!;
    if (p >= FIN) return hubSlots[arm]!.at(slot)!;
    const cell = trackCell(N, arm, p);
    if (cell !== null) return track[cell]!;
    return home[arm]![p - trackLen(N)]!;
  };

  return { board, extent, track, home, yards, wedges, hubSlots, hubRadius, pawnPoint };
}

/** Gira un punto `deg` grados en sentido horario alrededor del centro (coordenadas de pantalla, y hacia abajo). */
export function rotatePt(p: Pt, deg: number): Pt {
  if (!deg) return p;
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/** Ángulo (grados, horario desde arriba) del brazo `arm`. */
export const armDeg = (board: BoardSize, arm: number) => (360 / board) * arm;
