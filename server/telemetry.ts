// Medición de producto: sesiones de mesa, resultados de rondas y regresos de jugadores.
// Todo se acumula en memoria y se escribe en la base de datos en segundo plano (flush). Nunca bloquea una partida:
// sin base de datos no hace nada y si la escritura falla se reintenta en el siguiente ciclo.

import type { SqlDb } from './db';

export interface RoundPlayer {
  /** Identificador anónimo (pid) del jugador; los bots no lo llevan. */
  pid?: string;
  name: string;
  bot?: boolean;
  rank?: number;
  score?: number;
}
export interface RoundResult {
  game: string;
  board?: number;
  durationS?: number;
  players: RoundPlayer[];
}

interface Session {
  id: string | null;
  startedAt: number;
  lastActivity: number;
  endedAt: number | null;
  maxPlayers: number;
  rounds: number;
  games: Record<string, number>;
  dirty: boolean;
}

const MAX_QUEUE = 2_000; // si la base de datos no responde, no se acumula sin límite

export class Telemetry {
  private db: SqlDb | null = null;
  private sessions = new Map<string, Session>();
  private results: { code: string; at: number; r: RoundResult }[] = [];
  private visits = new Set<string>(); // "pid|YYYY-MM-DD"
  private flushing = false;

  attach(db: SqlDb | null) {
    this.db = db;
  }

  get enabled() {
    return this.db !== null;
  }

  private session(code: string): Session {
    let s = this.sessions.get(code);
    if (!s) {
      s = { id: null, startedAt: Date.now(), lastActivity: Date.now(), endedAt: null, maxPlayers: 0, rounds: 0, games: {}, dirty: true };
      this.sessions.set(code, s);
    }
    return s;
  }

  /** Se abre (o recupera) una mesa. */
  sessionOpen(code: string) {
    if (!this.db) return;
    this.session(code);
  }

  /** Cambia el número de jugadores presentes (se guarda el máximo de la sesión). */
  players(code: string, count: number) {
    if (!this.db) return;
    const s = this.session(code);
    if (count > s.maxPlayers) { s.maxPlayers = count; s.dirty = true; }
    s.lastActivity = Date.now();
  }

  /** Termina una ronda: suma a la sesión y guarda su resultado. */
  round(code: string, r: RoundResult) {
    if (!this.db) return;
    const s = this.session(code);
    s.rounds++;
    s.games[r.game] = (s.games[r.game] ?? 0) + 1;
    s.lastActivity = Date.now();
    s.dirty = true;
    if (this.results.length < MAX_QUEUE) this.results.push({ code, at: Date.now(), r });
  }

  /** Un perfil jugó hoy (una fila por perfil y día). */
  visit(pid: string, now = new Date()) {
    if (!this.db) return;
    if (this.visits.size < MAX_QUEUE) this.visits.add(`${pid}|${now.toISOString().slice(0, 10)}`);
  }

  sessionClose(code: string) {
    const s = this.sessions.get(code);
    if (!s || !this.db) return;
    s.endedAt = Date.now();
    s.dirty = true;
  }

  /** Escribe lo pendiente. Se llama cada pocos segundos y al apagar. */
  async flush() {
    const db = this.db;
    if (!db || this.flushing) return;
    this.flushing = true;
    try {
      // 1) sesiones (y sus ids)
      for (const [code, s] of [...this.sessions]) {
        if (!s.dirty && s.id) {
          if (s.endedAt && !this.results.some((x) => x.code === code)) this.sessions.delete(code);
          continue;
        }
        try {
          if (!s.id) {
            const res = await db.query(
              `insert into room_sessions (room_code, started_at, last_activity, ended_at, max_players, rounds, games)
               values ($1, to_timestamp($2 / 1000.0), to_timestamp($3 / 1000.0), case when $4::bigint is null then null else to_timestamp($4 / 1000.0) end, $5, $6, $7::jsonb)
               returning id`,
              [code, s.startedAt, s.lastActivity, s.endedAt, s.maxPlayers, s.rounds, JSON.stringify(s.games)],
            );
            s.id = String(res.rows[0]?.id);
          } else {
            await db.query(
              `update room_sessions set last_activity = to_timestamp($2 / 1000.0), ended_at = case when $3::bigint is null then null else to_timestamp($3 / 1000.0) end,
                      max_players = $4, rounds = $5, games = $6::jsonb where id = $1`,
              [s.id, s.lastActivity, s.endedAt, s.maxPlayers, s.rounds, JSON.stringify(s.games)],
            );
          }
          s.dirty = false;
        } catch (e) {
          console.error('[telemetry] no se pudo guardar una sesión (se reintentará):', (e as Error).message);
          return;
        }
      }

      // 2) resultados de rondas
      while (this.results.length) {
        const item = this.results[0]!;
        const sid = this.sessions.get(item.code)?.id ?? null;
        try {
          const res = await db.query(
            'insert into game_results (game, room_code, board, played_at, duration_s, session_id) values ($1, $2, $3, to_timestamp($4 / 1000.0), $5, $6) returning id',
            [item.r.game, item.code, item.r.board ?? null, item.at, item.r.durationS ?? null, sid],
          );
          const id = res.rows[0]?.id;
          for (const p of item.r.players) {
            await db.query(
              `insert into game_result_players (result_id, profile_id, name, is_bot, rank, score)
               values ($1, (select id from profiles where pid = $2 and deleted_at is null), $3, $4, $5, $6)
               on conflict do nothing`,
              [id, p.pid ?? null, p.name.slice(0, 40), !!p.bot, p.rank ?? null, p.score ?? null],
            );
          }
          this.results.shift();
        } catch (e) {
          console.error('[telemetry] no se pudo guardar un resultado (se reintentará):', (e as Error).message);
          return;
        }
      }

      // 3) regresos
      for (const key of [...this.visits]) {
        const [pid, day] = key.split('|') as [string, string];
        try {
          await db.query(
            'insert into profile_visits (profile_id, day) select id, $2::date from profiles where pid = $1 and deleted_at is null on conflict do nothing',
            [pid, day],
          );
          this.visits.delete(key);
        } catch (e) {
          console.error('[telemetry] no se pudo guardar una visita (se reintentará):', (e as Error).message);
          return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** Datos para la página de métricas del administrador. */
  async report() {
    const db = this.db;
    if (!db) return null;
    const q = async (sql: string) => (await db.query(sql)).rows;
    return {
      sessionsPerDay: await q(
        `select started_at::date as day, count(*)::int as sessions, coalesce(round(avg(max_players), 1), 0)::float as avg_players,
                coalesce(sum(rounds), 0)::int as rounds
           from room_sessions where started_at > now() - interval '30 days' group by 1 order by 1 desc`,
      ),
      usage: await q('select game, rounds::int, sessions::int, avg_players::float from usage_by_game'),
      retention: await q('select cohort, size::int, back_7d::int, back_30d::int from retention_weekly limit 12'),
      totals: (
        await q(
          `select (select count(*) from profiles where deleted_at is null)::int as profiles,
                  (select count(*) from room_sessions)::int as sessions,
                  (select count(*) from game_results)::int as rounds`,
        )
      )[0],
    };
  }
}

export const telemetry = new Telemetry();

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');
const day = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
const table = (head: string[], rows: unknown[][]) =>
  `<table><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>` +
  (rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}">Sin datos todavía</td></tr>`) +
  '</table>';

/** Página de métricas para el dueño (con la clave de administrador). */
export function renderMetrics(report: Awaited<ReturnType<Telemetry['report']>>): string {
  if (!report) {
    return '<!doctype html><meta charset="utf-8"><title>Métricas</title><p style="font:16px system-ui;padding:24px">La medición necesita la base de datos (DATABASE_URL) y la migración 0002.</p>';
  }
  const usage = table(['Juego', 'Rondas', 'Mesas', 'Jugadores medios'], report.usage.map((r) => [r.game, r.rounds, r.sessions, r.avg_players]));
  const perDay = table(['Día', 'Mesas', 'Jugadores medios', 'Rondas'], report.sessionsPerDay.map((r) => [day(r.day), r.sessions, r.avg_players, r.rounds]));
  const back = table(
    ['Semana', 'Jugadores nuevos', 'Volvieron en 7 días', 'Volvieron en 30 días'],
    report.retention.map((r) => [day(r.cohort), r.size, `${r.back_7d} (${pct(r.back_7d, r.size)})`, `${r.back_30d} (${pct(r.back_30d, r.size)})`]),
  );
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Métricas</title>
<style>body{font:16px/1.5 system-ui;background:#0d0a12;color:#eee;max-width:860px;margin:0 auto;padding:20px}table{border-collapse:collapse;margin:8px 0 26px;width:100%}td,th{padding:6px 12px;border-bottom:1px solid #333;text-align:left}h2{margin:28px 0 4px;font-size:1.05rem;color:#ecb8a4}small{color:#999}</style></head><body>
<h1>Métricas de Royale Club</h1>
<p>Perfiles: <b>${esc(report.totals?.profiles)}</b> · Sesiones de mesa: <b>${esc(report.totals?.sessions)}</b> · Rondas jugadas: <b>${esc(report.totals?.rounds)}</b></p>
<h2>Uso por juego <small>(últimos 30 días)</small></h2>${usage}
<h2>Mesas por día <small>(últimos 30 días)</small></h2>${perDay}
<h2>Regreso por semana de llegada</h2>${back}
<p><small>Sin datos personales: solo conteos. Añade ?format=json para los datos crudos.</small></p></body></html>`;
}
