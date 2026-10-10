import { RED_NUMBERS, type RouletteBet } from './protocol';

/** Múltiplo total que se devuelve al jugador (0 = pierde la apuesta). */
export function returnMultiplier(b: Pick<RouletteBet, 'kind' | 'value'>, n: number): number {
  switch (b.kind) {
    case 'straight': return b.value === n ? 36 : 0;
    case 'red': return RED_NUMBERS.has(n) ? 2 : 0;
    case 'black': return n !== 0 && !RED_NUMBERS.has(n) ? 2 : 0;
    case 'even': return n !== 0 && n % 2 === 0 ? 2 : 0;
    case 'odd': return n % 2 === 1 ? 2 : 0;
    case 'low': return n >= 1 && n <= 18 ? 2 : 0;
    case 'high': return n >= 19 ? 2 : 0;
    case 'dozen': return n >= 1 && Math.ceil(n / 12) === b.value ? 3 : 0;
    case 'column': return n >= 1 && ((n - 1) % 3) + 1 === b.value ? 3 : 0;
  }
}
