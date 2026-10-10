import { randomInt } from 'node:crypto';

export const rnd = (n: number) => randomInt(n);

export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const isPosInt = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n > 0;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O
export function makeCode(): string {
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}
