// Valoraciones y reseñas de los jugadores. Son PRIVADAS: solo se leen desde la ruta de administración
// (/admin/reviews, con ADMIN_KEY); nunca se envían a otros jugadores.
//
// Almacenamiento: Postgres si hay DATABASE_URL (Supabase, Neon…; la tabla se crea sola).
// Sin DATABASE_URL se guardan en un archivo JSON local, pensado solo para desarrollo (en Render gratis se pierde).

import fs from 'node:fs';
import path from 'node:path';

export interface Review {
  id: number;
  createdAt: string;
  pid: string;
  name: string;
  game: string;
  rating: number;
  comment: string;
  roomCode: string | null;
  theme: string | null;
}
export type NewReview = Omit<Review, 'id' | 'createdAt'>;

/** Misma persona y mismo juego: una reseña cada 12 horas (evita repetirlas o llenar la tabla). */
const COOLDOWN_MS = 12 * 3600_000;
const MAX_COMMENT = 400;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS reviews (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pid        TEXT NOT NULL,
  name       TEXT NOT NULL,
  game       TEXT NOT NULL,
  rating     SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment    TEXT NOT NULL DEFAULT '',
  room_code  TEXT,
  theme      TEXT
);
CREATE INDEX IF NOT EXISTS reviews_game_idx ON reviews (game, created_at DESC);
CREATE INDEX IF NOT EXISTS reviews_pid_idx ON reviews (pid, game, created_at DESC);
`;

/** Quita caracteres de control, colapsa espacios y recorta. */
export function cleanComment(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return [...raw.normalize('NFC').replace(/[\p{C}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim()].slice(0, MAX_COMMENT).join('');
}

interface Store {
  insert(r: NewReview): Promise<void>;
  recent(pid: string, game: string, sinceMs: number): Promise<boolean>;
  list(limit: number): Promise<Review[]>;
}

type PgPool = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<void> };

function fromRow(r: Record<string, unknown>): Review {
  return {
    id: Number(r.id),
    createdAt: new Date(r.created_at as string).toISOString(),
    pid: String(r.pid),
    name: String(r.name),
    game: String(r.game),
    rating: Number(r.rating),
    comment: String(r.comment ?? ''),
    roomCode: (r.room_code as string | null) ?? null,
    theme: (r.theme as string | null) ?? null,
  };
}

function pgStore(pool: PgPool): Store {
  return {
    async insert(r) {
      await pool.query('INSERT INTO reviews (pid, name, game, rating, comment, room_code, theme) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
        r.pid, r.name, r.game, r.rating, r.comment, r.roomCode, r.theme,
      ]);
    },
    async recent(pid, game, sinceMs) {
      const res = await pool.query('SELECT 1 FROM reviews WHERE pid = $1 AND game = $2 AND created_at > now() - ($3 * interval \'1 millisecond\') LIMIT 1', [pid, game, sinceMs]);
      return res.rows.length > 0;
    },
    async list(limit) {
      const res = await pool.query('SELECT * FROM reviews ORDER BY created_at DESC LIMIT $1', [limit]);
      return res.rows.map(fromRow);
    },
  };
}

function fileStore(file: string): Store {
  const read = (): Review[] => {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Review[]; } catch { return []; }
  };
  return {
    async insert(r) {
      const all = read();
      all.push({ ...r, id: (all.at(-1)?.id ?? 0) + 1, createdAt: new Date().toISOString() });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(all));
    },
    async recent(pid, game, sinceMs) {
      const since = Date.now() - sinceMs;
      return read().some((x) => x.pid === pid && x.game === game && Date.parse(x.createdAt) > since);
    },
    async list(limit) {
      return read().reverse().slice(0, limit);
    },
  };
}

export class Reviews {
  private store: Store | null = null;
  mode: 'postgres' | 'archivo' | 'sin iniciar' = 'sin iniciar';

  async init(fallbackFile: string) {
    const url = process.env.DATABASE_URL;
    if (url) {
      try {
        const { default: pg } = await import('pg');
        // Supabase y Neon exigen TLS; DATABASE_SSL=0 lo desactiva (por ejemplo, un Postgres local).
        const pool = new pg.Pool({ connectionString: url, max: 3, ssl: process.env.DATABASE_SSL === '0' ? false : { rejectUnauthorized: false } }) as unknown as PgPool;
        await pool.query(SCHEMA);
        this.store = pgStore(pool);
        this.mode = 'postgres';
        return;
      } catch (e) {
        console.error('[reviews] no se pudo conectar a Postgres; se usa el archivo local:', (e as Error).message);
      }
    }
    this.store = fileStore(fallbackFile);
    this.mode = 'archivo';
    if (!url) console.warn('[reviews] sin DATABASE_URL: las reseñas se guardan en un archivo local (solo para desarrollo).');
  }

  /** Guarda una reseña. Devuelve un mensaje de error para el jugador, o undefined si se guardó. */
  async add(r: NewReview): Promise<string | void> {
    if (!this.store) return 'Las reseñas no están disponibles todavía.';
    if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5) return 'La valoración va de 1 a 5 estrellas.';
    try {
      if (await this.store.recent(r.pid, r.game, COOLDOWN_MS)) return 'Ya valoraste este juego hace poco. ¡Gracias!';
      await this.store.insert({ ...r, comment: cleanComment(r.comment) });
    } catch (e) {
      console.error('[reviews] error al guardar:', (e as Error).message);
      return 'No se pudo guardar tu valoración. Inténtalo más tarde.';
    }
  }

  async list(limit = 500): Promise<Review[]> {
    return this.store ? this.store.list(limit) : [];
  }
}

export const reviews = new Reviews();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Página sencilla para el dueño: promedio por juego y lista de reseñas. */
export function renderAdmin(list: Review[], mode: string): string {
  const by = new Map<string, { n: number; sum: number }>();
  for (const r of list) {
    const g = by.get(r.game) ?? { n: 0, sum: 0 };
    g.n++;
    g.sum += r.rating;
    by.set(r.game, g);
  }
  const total = list.length ? (list.reduce((s, r) => s + r.rating, 0) / list.length).toFixed(2) : '—';
  const rows = [...by.entries()].sort((a, b) => b[1].n - a[1].n).map(([g, v]) => `<tr><td>${esc(g)}</td><td>${(v.sum / v.n).toFixed(2)}</td><td>${v.n}</td></tr>`).join('');
  const items = list
    .map((r) => `<li><b>${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</b> <i>${esc(r.game)}</i> · ${esc(r.name)} · ${esc(r.createdAt.slice(0, 16).replace('T', ' '))}${r.comment ? `<p>${esc(r.comment)}</p>` : ''}</li>`)
    .join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Reseñas</title>
<style>body{font:16px/1.5 system-ui;background:#0d0a12;color:#eee;max-width:760px;margin:0 auto;padding:20px}table{border-collapse:collapse;margin:10px 0 24px}td,th{padding:6px 14px;border-bottom:1px solid #333;text-align:left}li{list-style:none;padding:10px 0;border-bottom:1px solid #2a2433}p{margin:4px 0 0;color:#cfc}small{color:#999}</style></head>
<body><h1>Reseñas <small>(${esc(mode)})</small></h1><p>Promedio general: <b>${total}</b> · ${list.length} reseñas</p>
<table><tr><th>Juego</th><th>Promedio</th><th>Reseñas</th></tr>${rows}</table><ul style="padding:0">${items || '<li>Todavía no hay reseñas.</li>'}</ul></body></html>`;
}
