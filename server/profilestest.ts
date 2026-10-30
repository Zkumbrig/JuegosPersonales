// Perfiles y logros con base de datos, contra un Postgres real en memoria (PGlite) con la migración de db/. npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { ProfileStore } from './profiles';
import type { SqlDb } from './db';

let n = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  n++;
  console.log('  ok  ' + name);
}
console.log('Perfiles con base de datos (PGlite)');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migration = fs.readFileSync(path.join(ROOT, 'db', 'migrations', '0001_init.sql'), 'utf8');

async function freshDb() {
  const pg = new PGlite();
  // Supabase trae el esquema auth; aquí se imita lo mínimo para las referencias.
  await pg.exec('create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());');
  await pg.exec(migration);
  const db: SqlDb = { query: (sql, params) => pg.query(sql, params as unknown[]) as Promise<{ rows: Record<string, unknown>[] }> };
  return { pg, db };
}

const quiet = async <T>(fn: () => Promise<T>) => {
  const e = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = e; }
};

await test('un perfil nuevo se guarda con sus estadísticas y logros', async () => {
  const { pg, db } = await freshDb();
  const s = new ProfileStore();
  await s.attachDb(db);
  await s.hydrate('device-aaaaaaaa');
  s.newNight('device-aaaaaaaa', 'Ana');
  s.bump('device-aaaaaaaa', 'rounds', 3);
  s.reflex('device-aaaaaaaa', 210);
  assert.deepEqual(s.check('device-aaaaaaaa').sort(), ['first-night', 'lightning']);
  await s.save();
  const row = (await pg.query('select * from profiles where pid = $1', ['device-aaaaaaaa'])).rows[0] as Record<string, unknown>;
  assert.equal(row.display_name, 'Ana');
  assert.equal(row.nights, 1);
  assert.equal(row.rounds, 3);
  assert.equal(row.best_reflex, 210);
  const ach = (await pg.query('select achievement from achievements_unlocked order by 1')).rows.map((r) => (r as { achievement: string }).achievement);
  assert.deepEqual(ach, ['first-night', 'lightning']);
});

await test('tras "reiniciar" el servidor el perfil vuelve igual y sigue acumulando', async () => {
  const { pg, db } = await freshDb();
  const a = new ProfileStore();
  await a.attachDb(db);
  await a.hydrate('device-bbbbbbbb');
  a.newNight('device-bbbbbbbb', 'Beto');
  a.bump('device-bbbbbbbb', 'drinks', 7);
  a.check('device-bbbbbbbb');
  await a.save();

  const b = new ProfileStore(); // servidor nuevo, memoria vacía
  await b.attachDb(db);
  assert.equal(b.publicOf('device-bbbbbbbb').nights, 0, 'antes de cargar está en blanco');
  await b.hydrate('device-bbbbbbbb');
  const p = b.publicOf('device-bbbbbbbb');
  assert.equal(p.name, 'Beto');
  assert.equal(p.nights, 1);
  assert.equal(p.drinks, 7);
  assert.deepEqual(p.achievements, ['first-night']);
  b.bump('device-bbbbbbbb', 'drinks', 20);
  assert.deepEqual(b.check('device-bbbbbbbb'), ['thirsty']);
  await b.save();
  const row = (await pg.query('select drinks, nights from profiles where pid = $1', ['device-bbbbbbbb'])).rows[0] as { drinks: number; nights: number };
  assert.equal(row.drinks, 27);
  assert.equal(row.nights, 1, 'no se duplicó ni se perdió nada');
  assert.equal(((await pg.query('select count(*)::int as n from profiles')).rows[0] as { n: number }).n, 1);
});

await test('un perfil que no se pudo cargar nunca pisa lo que hay en la base de datos', async () => {
  const { pg, db } = await freshDb();
  const a = new ProfileStore();
  await a.attachDb(db);
  await a.hydrate('device-cccccccc');
  a.newNight('device-cccccccc', 'Caro');
  a.bump('device-cccccccc', 'rounds', 50);
  await a.save();

  const b = new ProfileStore();
  await b.attachDb(db);
  // sin hydrate (la base de datos tardó): se juega con un perfil en blanco que NO debe escribirse
  b.bump('device-cccccccc', 'rounds', 1);
  await b.save();
  const row = (await pg.query('select rounds from profiles where pid = $1', ['device-cccccccc'])).rows[0] as { rounds: number };
  assert.equal(row.rounds, 50);
});

await test('importa una sola vez el archivo local cuando la base de datos está vacía', async () => {
  const { pg, db } = await freshDb();
  const file = path.join(ROOT, 'data', `.profiles-test-${process.pid}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ v: 1, profiles: { 'device-dddddddd': { name: 'Dani', firstSeen: 1_700_000_000_000, lastSeen: 1, nights: 4, rounds: 9, drinks: 1, bestReflex: null, bigWin: 0, bigWinGame: '', bluffs: 0, rebuys: 0, achievements: ['first-night'] } } }));
  try {
    const s = new ProfileStore();
    s.init(file);
    await s.attachDb(db);
    const row = (await pg.query('select display_name, nights, first_seen from profiles where pid = $1', ['device-dddddddd'])).rows[0] as { display_name: string; nights: number; first_seen: Date };
    assert.equal(row.display_name, 'Dani');
    assert.equal(row.nights, 4);
    assert.equal(new Date(row.first_seen).getTime(), 1_700_000_000_000);
    // segunda vez con la base ya poblada: no se vuelve a importar nada encima
    await pg.query("update profiles set nights = 99 where pid = 'device-dddddddd'");
    const s2 = new ProfileStore();
    s2.init(file);
    await s2.attachDb(db);
    await s2.save();
    assert.equal(((await pg.query("select nights from profiles where pid = 'device-dddddddd'")).rows[0] as { nights: number }).nights, 99);
  } finally {
    fs.rmSync(file, { force: true });
  }
});

await test('si la base de datos falla, se sigue con archivo y memoria sin romper nada', async () => {
  const broken: SqlDb = { query: async () => { throw new Error('sin conexión'); } };
  const s = new ProfileStore();
  await quiet(() => s.attachDb(broken));
  assert.equal(s.usingDb, false);
  await s.hydrate('device-eeeeeeee'); // no hace nada
  s.newNight('device-eeeeeeee', 'Eli');
  assert.deepEqual(s.check('device-eeeeeeee'), ['first-night']);
  await s.save();
});

await test('la migración deja RLS activo en todas las tablas', async () => {
  const { pg } = await freshDb();
  const rows = (await pg.query("select relname, relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'")).rows as { relname: string; relrowsecurity: boolean }[];
  assert.ok(rows.length >= 8);
  assert.ok(rows.every((r) => r.relrowsecurity), 'todas con RLS: ' + rows.filter((r) => !r.relrowsecurity).map((r) => r.relname).join(','));
});

console.log(`Perfiles: ${n} pruebas correctas`);
process.exit(0);
