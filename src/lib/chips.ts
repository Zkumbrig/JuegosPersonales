export const CHIP_COLORS: Record<number, string> = {
  10: '#2f5fa8', 50: '#a3202f', 100: '#1d1d1d', 500: '#5b2a86', 1000: '#c9a13a',
};

const DENOMS = [1000, 500, 100, 50, 10];

/** Descompone una cantidad en fichas (de mayor a menor), limitada a `max` para el dibujo. */
export function breakdown(amount: number, max = 6): number[] {
  const out: number[] = [];
  let rest = amount;
  for (const d of DENOMS) {
    while (rest >= d && out.length < max) { out.push(d); rest -= d; }
  }
  if (out.length === 0 && amount > 0) out.push(10);
  return out;
}
