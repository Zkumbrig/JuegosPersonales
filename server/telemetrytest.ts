// Medición de producto (sesiones, resultados, regresos) contra un Postgres real en memoria (PGlite). npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { Telemetry, renderMetrics } from './telemetry';
import type { SqlDb } from './db';

let n = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  n++;
  console.log('  ok  ' + name);
}
console.log('Medición (PGlite)');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrations = fs
  .readdirSync(path.join(ROOT, 'db', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => fs.readFileSync(path.join(ROOT, 'db', 'migrations', f), 'utf8'));

const opened: PGlite[] = [];
async function freshDb() {
  const pg = new PGlite();
  opened.push(pg);
  await pg.exec('create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());');
  for (const m of migrations) await pg.exec(m);
  for (const m of migrations) await pg.exec(m); // las migraciones deben poder repetirse
  const db: SqlDb = { query: (sql, params) => pg.query(sql, params as unknown[]) as Promise<{ rows: Record<string, unknown>[] }> };
  return { pg, db };
}
const count = async (pg: PGlite, table: string) => ((await pg.query(`select count(*)::int as n from ${table}`)).rows[0] as { n: number }).n;

await test('sin base de datos no hace nada y no falla', async () => {
  const t = new Telemetry();
  t.sessionOpen('ABCD');
  t.round('ABCD', { game: 'ludo', players: [{ name: 'Ana' }] });
  t.visit('device-aaaaaaaa');
  await t.flush();
  assert.equal(t.enabled, false);
  assert.equal(await t.report(), null);
});

await test('guarda la sesión, el resultado con sus jugadores y la visita', async () => {
  const { pg, db } = await freshDb();
  await pg.query("insert into profiles (pid, display_name) values ('device-aaaaaaaa', 'Ana'), ('device-bbbbbbbb', 'Beto')");
  const t = new Telemetry();
  t.attach(db);
  t.sessionOpen('ABCD');
  t.players('ABCD', 3);
  t.players('ABCD', 2); // el máximo se conserva
  t.round('ABCD', {
    game: 'ludo', board: 6, durationS: 540,
    players: [
      { pid: 'device-aaaaaaaa', name: 'Ana', rank: 1 },
      { pid: 'device-bbbbbbbb', name: 'Beto', rank: 2 },
      { name: 'Bot 1', bot: true, rank: 3 },
    ],
  });
  t.round('ABCD', { game: 'never', players: [{ pid: 'device-aaaaaaaa', name: 'Ana' }] });
  t.visit('device-aaaaaaaa');
  t.visit('device-aaaaaaaa'); // el mismo día solo cuenta una vez
  t.visit('device-desconocido'); // sin perfil: se ignora sin romper
  t.sessionClose('ABCD');
  await t.flush();

  const s = (await pg.query('select * from room_sessions')).rows[0] as Record<string, any>;
  assert.equal(s.room_code, 'ABCD');
  assert.equal(s.max_players, 3);
  assert.equal(s.rounds, 2);
  assert.deepEqual(s.games, { ludo: 1, never: 1 });
  assert.ok(s.ended_at, 'la sesión quedó cerrada');
  assert.equal(await count(pg, 'game_results'), 2);
  const r = (await pg.query("select * from game_results where game = 'ludo'")).rows[0] as Record<string, any>;
  assert.equal(r.board, 6);
  assert.equal(r.duration_s, 540);
  assert.equal(r.session_id, s.id);
  const ps = (await pg.query('select name, is_bot, rank, profile_id from game_result_players where result_id = $1 order by rank', [r.id])).rows as Record<string, any>[];
  assert.deepEqual(ps.map((p) => p.name), ['Ana', 'Beto', 'Bot 1']);
  assert.ok(ps[0]!.profile_id && ps[1]!.profile_id, 'las personas enlazan con su perfil');
  assert.equal(ps[2]!.profile_id, null, 'el bot no tiene perfil');
  assert.equal(ps[2]!.is_bot, true);
  assert.equal(await count(pg, 'profile_visits'), 1);
});

await test('si la base de datos falla, no pierde datos: reintenta en el siguiente ciclo', async () => {
  const { db } = await freshDb();
  let fail = true;
  const flaky: SqlDb = { query: (sql, p) => (fail ? Promise.reject(new Error('sin conexión')) : db.query(sql, p)) };
  const t = new Telemetry();
  t.attach(flaky);
  t.sessionOpen('ZZZZ');
  t.round('ZZZZ', { game: 'ludo', players: [{ name: 'Ana' }] });
  const e = console.error;
  console.error = () => {};
  await t.flush();
  console.error = e;
  fail = false;
  await t.flush();
  const rep = await t.report();
  assert.equal(rep!.totals!.rounds, 1);
  assert.equal(rep!.totals!.sessions, 1);
});

await test('las cohortes cuentan quién volvió en 7 y en 30 días', async () => {
  const { pg, db } = await freshDb();
  // tres jugadores llegaron el mismo día; uno volvió a los 3 días, otro a los 20 y otro nunca
  await pg.exec(`
    insert into profiles (pid, display_name, first_seen) values
      ('p-uno-aaaaaa', 'Uno', now() - interval '40 days'),
      ('p-dos-bbbbbb', 'Dos', now() - interval '40 days'),
      ('p-tres-cccccc', 'Tres', now() - interval '40 days');
    insert into profile_visits (profile_id, day)
      select id, (now() - interval '40 days')::date from profiles;            -- el día que llegaron (no cuenta como regreso)
    insert into profile_visits (profile_id, day)
      select id, (now() - interval '37 days')::date from profiles where pid = 'p-uno-aaaaaa';
    insert into profile_visits (profile_id, day)
      select id, (now() - interval '20 days')::date from profiles where pid = 'p-dos-bbbbbb';
  `);
  const t = new Telemetry();
  t.attach(db);
  const rep = await t.report();
  const cohort = rep!.retention[0] as Record<string, number>;
  assert.equal(cohort.size, 3);
  assert.equal(cohort.back_7d, 1, 'solo "Uno" volvió en la primera semana');
  assert.equal(cohort.back_30d, 2, '"Uno" y "Dos" volvieron dentro de 30 días');
});

await test('el uso por juego cuenta rondas, mesas y jugadores medios (sin bots)', async () => {
  const { db } = await freshDb();
  const t = new Telemetry();
  t.attach(db);
  t.sessionOpen('AAAA');
  t.sessionOpen('BBBB');
  const ppl = (k: number) => Array.from({ length: k }, (_, i) => ({ name: `J${i}` }));
  t.round('AAAA', { game: 'ludo', players: [...ppl(4), { name: 'Bot', bot: true }] });
  t.round('BBBB', { game: 'ludo', players: ppl(2) });
  t.round('BBBB', { game: 'freepoker', players: ppl(3) });
  await t.flush();
  const rep = await t.report();
  const ludo = rep!.usage.find((u) => u.game === 'ludo')!;
  assert.equal(ludo.rounds, 2);
  assert.equal(ludo.sessions, 2);
  assert.equal(ludo.avg_players, 3, 'media de 4 y 2 personas (el bot no cuenta)');
});

await test('la página de métricas escapa HTML y explica si falta la base de datos', () => {
  assert.match(renderMetrics(null), /DATABASE_URL/);
  const html = renderMetrics({
    sessionsPerDay: [],
    usage: [{ game: '<script>x</script>', rounds: 1, sessions: 1, avg_players: 2 }],
    retention: [],
    totals: { profiles: 1, sessions: 1, rounds: 1 },
  });
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
});

await test('las tablas nuevas tienen RLS y las vistas respetan los permisos de quien consulta', async () => {
  const { pg } = await freshDb();
  const rls = (await pg.query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'")).rows as { relname: string; relrowsecurity: boolean }[];
  assert.ok(rls.every((r) => r.relrowsecurity), 'sin RLS: ' + rls.filter((r) => !r.relrowsecurity).map((r) => r.relname).join(','));
  const views = (await pg.query("select c.relname, c.reloptions from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'")).rows as { relname: string; reloptions: string[] | null }[];
  assert.equal(views.length, 2);
  assert.ok(views.every((v) => (v.reloptions ?? []).includes('security_invoker=true')), 'las vistas deben ser security_invoker');
});

console.log(`Medición: ${n} pruebas correctas`);
for (const pg of opened) await pg.close();
