import { randomBytes, randomInt } from 'node:crypto';
import { CODE_CHARS, CODE_LEN, NAME_MAX } from './shared/protocol';

export const rnd = (n: number) => randomInt(n);

export function makeCode(): string {
  let s = '';
  for (let i = 0; i < CODE_LEN; i++) s += CODE_CHARS[randomInt(CODE_CHARS.length)];
  return s;
}

export const newId = () => randomBytes(6).toString('base64url');
export const newToken = () => randomBytes(18).toString('base64url');

/** Normaliza un código escrito por una persona (mayúsculas, sin espacios ni guiones). */
export function cleanCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const c = raw.toUpperCase().replace(/[\s-]/g, '');
  return c.length === CODE_LEN && [...c].every((ch) => CODE_CHARS.includes(ch)) ? c : null;
}

/** Nombre visible: sin caracteres de control, espacios colapsados, de 1 a NAME_MAX letras. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw
    .normalize('NFC')
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  const chars = [...s];
  if (chars.length === 0) return null;
  return chars.slice(0, NAME_MAX).join('').trim() || null;
}

/** Cubo de fichas para limitar el ritmo de mensajes de una conexión. */
export class Bucket {
  private tokens: number;
  private last = Date.now();
  constructor(
    private burst: number,
    private perSec: number,
  ) {
    this.tokens = burst;
  }
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.last) / 1000) * this.perSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}
