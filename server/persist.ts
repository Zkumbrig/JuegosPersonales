import fs from 'node:fs';
import path from 'node:path';
import { Room } from './room';

/** Una copia más vieja que esto se ignora: la gente ya se habrá ido a casa. */
const MAX_AGE_MS = 6 * 3_600_000;

export function loadRooms(file: string, onDestroy: (code: string) => void): Room[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || raw.v !== 1 || Date.now() - Number(raw.savedAt) > MAX_AGE_MS) return [];
    const rooms: Room[] = [];
    for (const snap of raw.rooms ?? []) {
      try { rooms.push(Room.restore(snap, onDestroy)); }
      catch (e) { console.error('[persist] mesa descartada:', (e as Error).message); }
    }
    return rooms;
  } catch {
    return []; // no hay copia, o está dañada: se empieza de cero
  }
}

let lastSaved = '';

/** Guarda las mesas de forma atómica (archivo temporal + renombrar) y solo si algo cambió. */
export function saveRooms(file: string, rooms: Iterable<Room>) {
  try {
    const snaps = [...rooms].map((r) => r.toSnapshot()).filter((s) => s.players.length > 0);
    const key = JSON.stringify(snaps);
    if (key === lastSaved) return;
    lastSaved = key;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, savedAt: Date.now(), rooms: snaps }));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('[persist] no se pudo guardar:', (e as Error).message);
  }
}
