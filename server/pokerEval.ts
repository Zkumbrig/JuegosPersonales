import type { Suit } from '../shared/protocol';

/** r: 2..14 (14 = As) */
export interface PCard { r: number; s: Suit }

export const HAND_NAMES = [
  'Carta alta', 'Pareja', 'Doble pareja', 'Trío', 'Escalera', 'Color', 'Full', 'Póker', 'Escalera de color',
];

/** Puntúa exactamente 5 cartas: categoría y desempates codificados en un solo número comparable. */
export function eval5(cards: PCard[]): number {
  const ranks = cards.map((c) => c.r).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  let straightHigh = 0;
  if (new Set(ranks).size === 5) {
    if (ranks[0] - ranks[4] === 4) straightHigh = ranks[0];
    else if (ranks[0] === 14 && ranks[1] === 5 && ranks[4] === 2) straightHigh = 5; // rueda A-2-3-4-5
  }
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const top = groups[0][1];
  const second = groups[1]?.[1] ?? 0;

  let cat: number;
  if (straightHigh && flush) cat = 8;
  else if (top === 4) cat = 7;
  else if (top === 3 && second === 2) cat = 6;
  else if (flush) cat = 5;
  else if (straightHigh) cat = 4;
  else if (top === 3) cat = 3;
  else if (top === 2 && second === 2) cat = 2;
  else if (top === 2) cat = 1;
  else cat = 0;

  const tiebreak = straightHigh ? [straightHigh] : groups.map((g) => g[0]);
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (tiebreak[i] ?? 0);
  return score;
}

export const categoryOf = (score: number) => Math.floor(score / 15 ** 5);

/** Mejor mano de 5 entre 5, 6 o 7 cartas. */
export function bestHand(cards: PCard[]): { score: number; name: string } {
  let best = -1;
  const n = cards.length;
  const pick: PCard[] = [];
  const rec = (start: number) => {
    if (pick.length === 5) {
      const s = eval5(pick);
      if (s > best) best = s;
      return;
    }
    for (let i = start; i < n; i++) {
      pick.push(cards[i]);
      rec(i + 1);
      pick.pop();
    }
  };
  rec(0);
  return { score: best, name: HAND_NAMES[categoryOf(best)] };
}

export interface PotEntry { id: string; total: number; folded: boolean; score: number }

/**
 * Reparte el bote con botes laterales. `total` es lo aportado por cada jugador en la mano
 * (los que se retiraron también cuentan como dinero muerto). `oddOrder` decide quién se lleva
 * la ficha sobrante en un empate (el primero de la lista).
 */
export function splitPots(entries: PotEntry[], oddOrder: string[]): Map<string, number> {
  const payout = new Map<string, number>();
  const add = (id: string, n: number) => payout.set(id, (payout.get(id) ?? 0) + n);
  const levels = [...new Set(entries.filter((e) => e.total > 0).map((e) => e.total))].sort((a, b) => a - b);
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const e of entries) amount += Math.min(e.total, level) - Math.min(e.total, prev);
    prev = level;
    if (amount === 0) continue;
    let eligible = entries.filter((e) => !e.folded && e.total >= level);
    if (eligible.length === 0) eligible = entries.filter((e) => !e.folded); // no debería ocurrir
    const best = Math.max(...eligible.map((e) => e.score));
    const winners = eligible
      .filter((e) => e.score === best)
      .sort((a, b) => oddOrder.indexOf(a.id) - oddOrder.indexOf(b.id));
    const share = Math.floor(amount / winners.length);
    const rem = amount - share * winners.length;
    winners.forEach((w, i) => add(w.id, share + (i < rem ? 1 : 0)));
  }
  return payout;
}
