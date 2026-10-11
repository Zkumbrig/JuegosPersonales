import {
  capturesAt,
  finalPos,
  safeCells,
  targetOf,
  trackCell,
  trackLen,
  type Seat,
} from './shared/rules';
import type { RoomOptions } from './shared/protocol';
import { rnd } from './util';

type Rules = Pick<RoomOptions, 'exactFinish' | 'towers'>;

/** Cuántos peones rivales hay en las 6 casillas anteriores a `cell` (los que podrían comerla de un tiro). */
function threatsTo(board: number, seats: readonly Seat[], si: number, cell: number): number {
  const T = trackLen(board);
  let n = 0;
  for (let s = 0; s < seats.length; s++) {
    if (s === si) continue;
    const o = seats[s]!;
    for (const p of o.pawns) {
      const c = trackCell(board, o.arm, p);
      if (c === null) continue;
      const d = (cell - c + T) % T;
      if (d >= 1 && d <= 6) n++;
    }
  }
  return n;
}

/**
 * Elige un peón entre los movibles. Es una heurística sencilla: prefiere meter en la meta,
 * comer, salir de casa, ponerse a salvo y avanzar al peón más adelantado.
 * La usan los bots y el piloto automático de quien no responde a tiempo.
 */
export function chooseMove(
  board: number,
  rules: Rules,
  seats: readonly Seat[],
  si: number,
  dice: number,
  movable: number[],
): number {
  const seat = seats[si]!;
  const T = trackLen(board);
  const FIN = finalPos(board);
  const safe = safeCells(board);
  let best: number[] = [];
  let bestScore = -Infinity;

  for (const pawn of movable) {
    const p = seat.pawns[pawn]!;
    const to = targetOf(board, rules, p, dice)!;
    let score = (to / FIN) * 12;
    if (to === FIN) score += 100;
    else if (to >= T && p < T) score += 45; // entra al pasillo de llegada
    if (p === 0) score += 55; // sacar peón de casa

    const cell = trackCell(board, seat.arm, to);
    if (cell !== null) {
      score += capturesAt(board, rules, seats, si, cell).length * 90;
      if (safe.has(cell)) score += 18;
      else score -= threatsTo(board, seats, si, cell) * 14;
    }
    const here = trackCell(board, seat.arm, p);
    if (here !== null && !safe.has(here)) score += threatsTo(board, seats, si, here) * 12; // huir del peligro

    score += Math.random() * 4; // desempate
    if (score > bestScore + 1e-9) {
      bestScore = score;
      best = [pawn];
    } else if (Math.abs(score - bestScore) <= 1e-9) best.push(pawn);
  }
  return best[rnd(best.length)]!;
}
