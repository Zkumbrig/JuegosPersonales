import type { Card } from '../../shared/protocol';

export const fmt = (n: number) => n.toLocaleString('es-ES');
export const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `−${fmt(Math.abs(n))}` : '0');
export const chipLabel = (v: number) => (v >= 1000 ? `${v / 1000}K` : String(v));


/** Valor de una mano; las cartas ocultas no cuentan. */
export function handTotal(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if ('hidden' in c) continue;
    if (c.r === 'A') { aces++; total += 11; }
    else if (c.r === 'J' || c.r === 'Q' || c.r === 'K') total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 && total <= 21 };
}

export function vibrate(ms = 10) {
  try { navigator.vibrate?.(ms); } catch { /* ignore */ }
}
