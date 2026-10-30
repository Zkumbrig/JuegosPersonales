import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ACHIEVEMENTS, type ProfilePublic } from '../shared/protocol';
import type { SqlDb } from './db';

/**
 * Perfiles: se identifican por el `pid` que cada navegador guarda (anónimo). Quien inicia sesión con su correo
 * vincula su perfil a su cuenta (`linkAccount`) y así lo recupera desde cualquier dispositivo.
 * Acumulan estadísticas y logros de todas las mesas en las que juega esa persona.
 *
 * Funcionamiento: los perfiles viven en memoria (lectura y escritura síncronas, rápidas). Si hay base de datos
 * (Supabase), cada perfil se carga al entrar la persona (`hydrate`) y los cambios se guardan en segundo plano
 * (`save`, cada pocos segundos y al apagar). Sin base de datos se guardan en un archivo JSON, como siempre.
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

const HYDRATE_TIMEOUT_MS = 3_000;

export class ProfileStore {
  private map = new Map<string, Profile>();
  private file: string | null = null;
  private lastSaved = '';
  private db: SqlDb | null = null;
  /** pid cuyo estado ya se contrastó con la base de datos (solo esos se escriben, para no pisar datos con ceros). */
  private loaded = new Set<string>();
  /** pid con cambios pendientes de guardar en la base de datos. */
  private dirty = new Set<string>();
  private flushing = false;

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

  /**
   * Conecta la base de datos. Si la tabla está vacía y hay perfiles del archivo local, se importan una sola vez.
   */
  async attachDb(db: SqlDb | null) {
    this.db = db;
    if (!db) return;
    try {
      const n = await db.query('select count(*)::int as n from profiles where deleted_at is null');
      if (Number(n.rows[0]?.n) === 0 && this.map.size > 0) {
        for (const pid of this.map.keys()) { this.loaded.add(pid); this.dirty.add(pid); }
        console.log(`[profiles] importando ${this.map.size} perfil(es) del archivo local a la base de datos`);
        await this.flush();
      }
    } catch (e) {
      console.error('[profiles] la base de datos no está lista (¿falta la migración?); se usa el archivo local:', (e as Error).message);
      this.db = null;
    }
  }

  get usingDb() {
    return this.db !== null;
  }

  /** Carga el perfil de la base de datos antes de usarlo. Si tarda demasiado, se sigue sin él (y no se escribirá encima). */
  async hydrate(pid: string): Promise<void> {
    if (!this.db || this.loaded.has(pid)) return;
    const db = this.db;
    try {
      const res = await Promise.race([
        db.query(
          `select p.display_name, p.first_seen, p.nights, p.rounds, p.drinks, p.best_reflex, p.big_win, p.big_win_game,
                  p.bluffs, p.rebuys,
                  coalesce(array_agg(a.achievement) filter (where a.achievement is not null), '{}') as ach
             from profiles p left join achievements_unlocked a on a.profile_id = p.id
            where p.pid = $1 and p.deleted_at is null
            group by p.id`,
          [pid],
        ),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('tiempo agotado')), HYDRATE_TIMEOUT_MS)),
      ]);
      const r = res.rows[0];
      if (r) {
        this.map.set(pid, this.blank({
          name: String(r.display_name),
          firstSeen: new Date(r.first_seen).getTime(),
          nights: Number(r.nights), rounds: Number(r.rounds), drinks: Number(r.drinks),
          bestReflex: r.best_reflex === null ? null : Number(r.best_reflex),
          bigWin: Number(r.big_win), bigWinGame: String(r.big_win_game ?? ''),
          bluffs: Number(r.bluffs), rebuys: Number(r.rebuys),
          achievements: (r.ach as string[]) ?? [],
        }));
      }
      this.loaded.add(pid); // existía (cargado) o es nuevo (se creará al guardar)
    } catch (e) {
      console.error('[profiles] no se pudo cargar un perfil; este jugador no se guardará en la base de datos en esta sesión:', (e as Error).message);
    }
  }

  /**
   * Vincula una cuenta (usuario de Supabase Auth) con un perfil y devuelve el `pid` que debe usar el navegador.
   * - Si la cuenta ya tiene perfil (otro dispositivo, o ya lo había vinculado), se devuelve ese: así el progreso se recupera.
   * - Si es una cuenta nueva, se queda con el perfil anónimo de este dispositivo (se conservan sus logros y estadísticas).
   * - Si el perfil de este dispositivo ya pertenece a otra cuenta, la cuenta nueva empieza con un perfil propio.
   * Devuelve null si no hay base de datos o falla (el inicio de sesión no puede completarse sin ella).
   */
  async linkAccount(pid: string, user: { id: string }): Promise<{ pid: string; name: string } | null> {
    const db = this.db;
    if (!db) return null;
    const newPid = () => randomBytes(16).toString('hex');
    try {
      const have = await db.query('select pid, display_name from profiles where user_id = $1 and deleted_at is null', [user.id]);
      const row = have.rows[0];
      if (row) {
        let mine = row.pid ? String(row.pid) : null;
        if (!mine) {
          mine = newPid();
          await db.query('update profiles set pid = $1 where user_id = $2', [mine, user.id]);
        }
        return { pid: mine, name: String(row.display_name) };
      }
      const name = (this.map.get(pid)?.name ?? 'Jugador').slice(0, 16) || 'Jugador';
      const claimed = await db.query(
        `insert into profiles (pid, display_name, user_id) values ($1, $2, $3)
         on conflict (pid) do update set user_id = excluded.user_id where profiles.user_id is null
         returning pid`,
        [pid, name, user.id],
      );
      if (claimed.rows[0]) return { pid, name };
      const fresh = newPid();
      await db.query('insert into profiles (pid, display_name, user_id) values ($1, $2, $3)', [fresh, 'Jugador', user.id]);
      return { pid: fresh, name: 'Jugador' };
    } catch (e) {
      console.error('[profiles] no se pudo vincular la cuenta:', (e as Error).message);
      return null;
    }
  }

  private blank(over: Partial<Profile> = {}): Profile {
    const now = Date.now();
    return {
      name: 'Jugador', firstSeen: now, lastSeen: now, nights: 0, rounds: 0, drinks: 0, bestReflex: null,
      bigWin: 0, bigWinGame: '', bluffs: 0, rebuys: 0, achievements: [], ...over,
    };
  }

  private touch(pid: string) {
    this.dirty.add(pid);
  }

  get(pid: string, name?: string): Profile {
    let p = this.map.get(pid);
    if (!p) {
      p = this.blank();
      this.map.set(pid, p);
      if (this.map.size > MAX_PROFILES) this.prune();
    }
    if (name && p.name !== name.slice(0, 16)) { p.name = name.slice(0, 16); this.touch(pid); }
    p.lastSeen = Date.now();
    return p;
  }

  newNight(pid: string, name: string) { this.get(pid, name).nights++; this.touch(pid); }
  bump(pid: string, field: 'rounds' | 'drinks' | 'bluffs' | 'rebuys', n = 1) { this.get(pid)[field] += n; this.touch(pid); }
  win(pid: string, amount: number, game: string) {
    const p = this.get(pid);
    if (amount > p.bigWin) { p.bigWin = amount; p.bigWinGame = game; this.touch(pid); }
  }
  reflex(pid: string, ms: number) {
    const p = this.get(pid);
    if (p.bestReflex === null || ms < p.bestReflex) { p.bestReflex = ms; this.touch(pid); }
  }

  /** Logros recién conseguidos desde la última comprobación. */
  check(pid: string): string[] {
    const p = this.map.get(pid);
    if (!p) return [];
    const fresh: string[] = [];
    for (const a of ACHIEVEMENTS) {
      if (!p.achievements.includes(a.id) && RULES[a.id]?.(p)) { p.achievements.push(a.id); fresh.push(a.id); }
    }
    if (fresh.length) this.touch(pid);
    return fresh;
  }

  publicOf(pid: string): ProfilePublic {
    const { lastSeen: _ignored, ...pub } = this.get(pid);
    return { ...pub, achievements: [...pub.achievements] };
  }

  private prune() {
    const oldest = [...this.map].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, this.map.size - MAX_PROFILES);
    for (const [pid] of oldest) { this.map.delete(pid); this.loaded.delete(pid); }
  }

  /** Escribe en la base de datos los perfiles con cambios (los que se contrastaron al entrar). */
  async flush() {
    const db = this.db;
    if (!db || this.flushing) return;
    this.flushing = true;
    try {
      for (const pid of [...this.dirty]) {
        if (!this.loaded.has(pid)) continue;
        const p = this.map.get(pid);
        if (!p) { this.dirty.delete(pid); continue; }
        this.dirty.delete(pid); // si falla, vuelve a la cola
        try {
          const res = await db.query(
            `insert into profiles (pid, display_name, first_seen, nights, rounds, drinks, best_reflex, big_win, big_win_game, bluffs, rebuys)
             values ($1, $2, to_timestamp($3 / 1000.0), $4, $5, $6, $7, $8, $9, $10, $11)
             on conflict (pid) do update set display_name = excluded.display_name, nights = excluded.nights,
               rounds = excluded.rounds, drinks = excluded.drinks, best_reflex = excluded.best_reflex,
               big_win = excluded.big_win, big_win_game = excluded.big_win_game, bluffs = excluded.bluffs,
               rebuys = excluded.rebuys
             returning id`,
            [pid, p.name.slice(0, 16) || 'Jugador', p.firstSeen, p.nights, p.rounds, p.drinks, p.bestReflex, p.bigWin, p.bigWinGame, p.bluffs, p.rebuys],
          );
          const id = res.rows[0]?.id;
          if (id && p.achievements.length) {
            await db.query(
              'insert into achievements_unlocked (profile_id, achievement) select $1, unnest($2::text[]) on conflict do nothing',
              [id, p.achievements],
            );
          }
        } catch (e) {
          this.dirty.add(pid);
          console.error('[profiles] no se pudo guardar un perfil (se reintentará):', (e as Error).message);
          break; // la base de datos no responde: se deja el resto para el próximo ciclo
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Guardado atómico en archivo (solo si cambió algo) y, con base de datos, escritura de los cambios pendientes. */
  async save() {
    if (this.db) { await this.flush(); return; }
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
