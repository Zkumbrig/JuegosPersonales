import type { ClientMsg, RoomOptions } from './shared/protocol';
import { cleanCode, cleanName } from './util';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const OPTION_KEYS: (keyof RoomOptions)[] = ['board', 'endAtFirst', 'exactFinish', 'towers', 'autoSingle', 'turnSeconds'];

/** Comprueba la forma de un mensaje entrante. Devuelve null si no es válido. */
export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!isObj(raw) || typeof raw.t !== 'string') return null;
  switch (raw.t) {
    case 'create': {
      const name = cleanName(raw.name);
      return name ? { t: 'create', name } : null;
    }
    case 'join': {
      const name = cleanName(raw.name);
      const code = cleanCode(raw.code);
      return name && code ? { t: 'join', code, name } : null;
    }
    case 'resume': {
      const code = cleanCode(raw.code);
      return code && typeof raw.token === 'string' && raw.token.length <= 64 ? { t: 'resume', code, token: raw.token } : null;
    }
    case 'config': {
      if (!isObj(raw.patch)) return null;
      const patch: Record<string, unknown> = {};
      for (const k of OPTION_KEYS) if (k in raw.patch) patch[k] = raw.patch[k];
      return { t: 'config', patch: patch as Partial<RoomOptions> };
    }
    case 'bot':
      if (raw.op === 'add') return { t: 'bot', op: 'add' };
      if (raw.op === 'remove' && typeof raw.id === 'string' && raw.id.length <= 32) return { t: 'bot', op: 'remove', id: raw.id };
      return null;
    case 'kick':
      return typeof raw.id === 'string' && raw.id.length <= 32 ? { t: 'kick', id: raw.id } : null;
    case 'move':
      return Number.isInteger(raw.pawn) && (raw.pawn as number) >= 0 && (raw.pawn as number) < 4
        ? { t: 'move', pawn: raw.pawn as number }
        : null;
    case 'sit':
    case 'start':
    case 'roll':
    case 'rematch':
    case 'leave':
    case 'ping':
      return { t: raw.t };
    default:
      return null;
  }
}
