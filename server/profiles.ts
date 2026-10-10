import fs from 'node:fs';
import path from 'node:path';
import { ACHIEVEMENTS, type ProfilePublic } from '../shared/protocol';

/**
 * Perfiles anónimos: se identifican por el `pid` que cada navegador guarda, sin cuentas ni correos.
 * Acumulan estadísticas y logros de todas las mesas en las que juega esa persona.
 */
export interface Profile extends ProfilePublic { lastSeen: number }

const MAX_PROFILES = 5000;

const RULES: Record<string, (p: Profile) => boolean> = {
  'first-night': (p) => p.nights >= 1,
  regular: (p) => p.nights >= 5,
  grinder: (p) => p.rounds >= 100,
  thirsty: (p) => p.drinks >= 20,
  lightning: (p) => p.bestReflex !== null && p.bestReflex < 250,
  whale: (p) => p.bigWin >= 1000,
  bluffer: (p) => p.bluffs >= 3,
  borrower: (p) => p.rebuys >= 3,
};

class ProfileStore {
  private map = new Map<string, Profile>();
  private file: string | null = null;
  private lastSaved = '';

  /** Activa la copia en disco y carga lo que hubiera. Sin llamarlo, los perfiles viven solo en memoria. */
  init(file: string) {
    this.file = file;
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw?.v === 1 && raw.profiles && typeof raw.profiles === 'object') {
        for (const [pid, p] of Object.entries<Profile>(raw.profiles)) this.map.set(pid, this.blank(p));
      }
    } catch { /* primera vez o archivo dañado: se empieza de cero */ }
  }

  private blank(over: Partial<Profile> = {}): Profile {
    const now = Date.now();
    return {
      name: 'Jugador', firstSeen: now, lastSeen: now, nights: 0, rounds: 0, drinks: 0, bestReflex: null,
      bigWin: 0, bigWinGame: '', bluffs: 0, rebuys: 0, achievements: [], ...over,
    };
  }

  get(pid: string, name?: string): Profile {
    let p = this.map.get(pid);
    if (!p) {
      p = this.blank();
      this.map.set(pid, p);
      if (this.map.size > MAX_PROFILES) this.prune();
    }
    if (name) p.name = name.slice(0, 16);
    p.lastSeen = Date.now();
    return p;
  }

  newNight(pid: string, name: string) { this.get(pid, name).nights++; }
  bump(pid: string, field: 'rounds' | 'drinks' | 'bluffs' | 'rebuys', n = 1) { this.get(pid)[field] += n; }
  win(pid: string, amount: number, game: string) {
    const p = this.get(pid);
    if (amount > p.bigWin) { p.bigWin = amount; p.bigWinGame = game; }
  }
  reflex(pid: string, ms: number) {
    const p = this.get(pid);
    if (p.bestReflex === null || ms < p.bestReflex) p.bestReflex = ms;
  }

  /** Logros recién conseguidos desde la última comprobación. */
  check(pid: string): string[] {
    const p = this.map.get(pid);
    if (!p) return [];
    const fresh: string[] = [];
    for (const a of ACHIEVEMENTS) {
      if (!p.achievements.includes(a.id) && RULES[a.id]?.(p)) { p.achievements.push(a.id); fresh.push(a.id); }
    }
    return fresh;
  }

  publicOf(pid: string): ProfilePublic {
    const { lastSeen: _ignored, ...pub } = this.get(pid);
    return { ...pub, achievements: [...pub.achievements] };
  }

  private prune() {
    const oldest = [...this.map].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, this.map.size - MAX_PROFILES);
    for (const [pid] of oldest) this.map.delete(pid);
  }

  /** Guardado atómico y solo si cambió algo. */
  save() {
    if (!this.file) return;
    try {
      const body = JSON.stringify({ v: 1, profiles: Object.fromEntries(this.map) });
      if (body === this.lastSaved) return;
      this.lastSaved = body;
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, body);
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[profiles] no se pudo guardar:', (e as Error).message);
    }
  }
}

export const profiles = new ProfileStore();
