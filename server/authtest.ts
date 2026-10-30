// Inicio de sesión por correo: servicio de Supabase Auth (simulado), vinculación de perfiles (PGlite) y rutas HTTP. npm test
process.env.DATABASE_URL = ''; // las pruebas nunca tocan la base de datos real
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { AuthService, cleanEmail } from './auth';
import { makeAuthRoutes } from './authHttp';
import { ProfileStore } from './profiles';
import type { SqlDb } from './db';

let n = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  n++;
  console.log('  ok  ' + name);
}
console.log('Cuentas por correo');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrations = fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort()
  .map((f) => fs.readFileSync(path.join(ROOT, 'db', 'migrations', f), 'utf8'));

const opened: PGlite[] = [];
async function freshStore() {
  const pg = new PGlite();
  opened.push(pg);
  await pg.exec('create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());');
  for (const m of migrations) await pg.exec(m);
  const db: SqlDb = { query: (sql, params) => pg.query(sql, params as unknown[]) as Promise<{ rows: Record<string, unknown>[] }> };
  const store = new ProfileStore();
  await store.attachDb(db);
  const userId = async () => String(((await pg.query('insert into auth.users default values returning id')).rows[0] as { id: string }).id);
  return { pg, store, userId };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const UUID = '3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

await test('valida el correo', () => {
  assert.equal(cleanEmail('  Ana@Correo.COM '), 'ana@correo.com');
  assert.equal(cleanEmail('sin-arroba'), null);
  assert.equal(cleanEmail('a b@c.com'), null);
  assert.equal(cleanEmail('x'.repeat(300) + '@c.com'), null);
  assert.equal(cleanEmail(42), null);
});

await test('deduce la URL del proyecto y solo se activa con la clave pública', () => {
  const a = new AuthService();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  process.env.DATABASE_URL = 'postgresql://postgres.abcdefghijklmnopqrst:secreto@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
  assert.equal(a.url, 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(a.enabled, false, 'sin SUPABASE_ANON_KEY está desactivado');
  process.env.SUPABASE_ANON_KEY = 'anon-de-prueba';
  assert.equal(a.enabled, true);
  process.env.SUPABASE_URL = 'https://otro.supabase.co/';
  assert.equal(a.url, 'https://otro.supabase.co', 'SUPABASE_URL manda y se limpia la barra final');
  delete process.env.SUPABASE_URL;
  process.env.DATABASE_URL = '';
  assert.equal(a.url, null);
  assert.equal(a.enabled, false);
});

process.env.SUPABASE_URL = 'https://proyecto.supabase.co';
process.env.SUPABASE_ANON_KEY = 'anon-de-prueba';

await test('pide el código y traduce los errores de Supabase a mensajes claros', async () => {
  const a = new AuthService();
  let seen: { url: string; body: Record<string, unknown>; key: string } | null = null;
  a.fetcher = (async (u: unknown, init?: RequestInit) => {
    seen = { url: String(u), body: JSON.parse(String(init?.body)), key: String((init?.headers as Record<string, string>).apikey) };
    return json(200, {});
  }) as typeof fetch;
  assert.equal(await a.start('ana@correo.com'), null);
  assert.equal(seen!.url, 'https://proyecto.supabase.co/auth/v1/otp');
  assert.deepEqual(seen!.body, { email: 'ana@correo.com', create_user: true });
  assert.equal(seen!.key, 'anon-de-prueba');
  a.fetcher = (async () => json(429, {})) as typeof fetch;
  assert.match((await a.start('ana@correo.com'))!, /minuto/);
  a.fetcher = (async () => json(500, {})) as typeof fetch;
  assert.match((await a.start('ana@correo.com'))!, /Inténtalo/);
  a.fetcher = (async () => { throw new Error('sin red'); }) as typeof fetch;
  assert.match((await a.start('ana@correo.com'))!, /conectar/);
});

await test('comprueba el código: solo vale si Supabase lo acepta y devuelve un usuario real', async () => {
  const a = new AuthService();
  let calls = 0;
  a.fetcher = (async (u: unknown, init?: RequestInit) => {
    calls++;
    assert.equal(String(u), 'https://proyecto.supabase.co/auth/v1/verify');
    assert.deepEqual(JSON.parse(String(init?.body)), { type: 'email', email: 'ana@correo.com', token: '123456' });
    return json(200, { access_token: 'no-se-guarda', user: { id: UUID, email: 'ana@correo.com' } });
  }) as typeof fetch;
  assert.deepEqual(await a.verify('ana@correo.com', '123456'), { id: UUID, email: 'ana@correo.com' });
  assert.equal(await a.verify('ana@correo.com', 'abc'), null, 'un código con letras ni se envía');
  assert.equal(await a.verify('ana@correo.com', '12'), null);
  assert.equal(calls, 1);
  a.fetcher = (async () => json(403, { msg: 'Token has expired or is invalid' })) as typeof fetch;
  assert.equal(await a.verify('ana@correo.com', '123456'), null);
  a.fetcher = (async () => json(200, { user: { id: 'no-es-uuid' } })) as typeof fetch;
  assert.equal(await a.verify('ana@correo.com', '123456'), null, 'un id que no es UUID se rechaza');
});

await test('vincular: una cuenta nueva se queda con el perfil de este dispositivo y conserva su progreso', async () => {
  const { pg, store, userId } = await freshStore();
  const pid = 'dispositivo-1-aaaaaaaa';
  await store.hydrate(pid);
  store.newNight(pid, 'Ana');
  store.bump(pid, 'rounds', 7);
  await store.flush();
  const uid = await userId();
  assert.deepEqual(await store.linkAccount(pid, { id: uid }), { pid, name: 'Ana' });
  const row = (await pg.query('select user_id, rounds, nights from profiles where pid = $1', [pid])).rows[0] as Record<string, unknown>;
  assert.equal(row.user_id, uid);
  assert.equal(row.rounds, 7);
  assert.equal(row.nights, 1);
  // repetir no cambia nada
  assert.deepEqual(await store.linkAccount(pid, { id: uid }), { pid, name: 'Ana' });
});

await test('vincular: en otro dispositivo se recupera el mismo perfil (el progreso no se pierde)', async () => {
  const { store, userId } = await freshStore();
  const first = 'dispositivo-1-bbbbbbbb';
  await store.hydrate(first);
  store.newNight(first, 'Beto');
  await store.flush();
  const uid = await userId();
  await store.linkAccount(first, { id: uid });
  const other = await store.linkAccount('dispositivo-2-cccccccc', { id: uid });
  assert.deepEqual(other, { pid: first, name: 'Beto' }, 'el segundo dispositivo adopta el perfil de la cuenta');
});

await test('vincular: si el dispositivo ya es de otra cuenta, la cuenta nueva empieza con perfil propio', async () => {
  const { pg, store, userId } = await freshStore();
  const pid = 'dispositivo-1-dddddddd';
  await store.hydrate(pid);
  store.newNight(pid, 'Caro');
  await store.flush();
  const u1 = await userId();
  const u2 = await userId();
  await store.linkAccount(pid, { id: u1 });
  const r = await store.linkAccount(pid, { id: u2 });
  assert.ok(r && r.pid !== pid && /^[0-9a-f]{32}$/.test(r.pid), 'recibe un pid nuevo');
  assert.equal(((await pg.query('select count(*)::int as n from profiles')).rows[0] as { n: number }).n, 2);
  assert.equal(((await pg.query('select user_id from profiles where pid = $1', [pid])).rows[0] as { user_id: string }).user_id, u1, 'el perfil de la primera cuenta no se toca');
});

await test('sin base de datos no se puede vincular', async () => {
  assert.equal(await new ProfileStore().linkAccount('dispositivo-x-eeeeeeee', { id: UUID }), null);
});

// ---------- Rutas HTTP ----------
async function withServer(fn: (call: (method: string, p: string, body?: unknown, raw?: string) => Promise<{ status: number; data: Record<string, unknown> }>) => Promise<void>, enabled = true) {
  const { pg, store } = await freshStore();
  await pg.query('insert into auth.users (id) values ($1)', [UUID]); // el usuario que devolverá la verificación simulada
  const a = new AuthService();
  let sent: string[] = [];
  a.fetcher = (async (u: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (String(u).endsWith('/otp')) { sent.push(body.email); return json(200, {}); }
    return body.token === '123456' ? json(200, { user: { id: UUID, email: body.email } }) : json(403, {});
  }) as typeof fetch;
  if (!enabled) delete process.env.SUPABASE_ANON_KEY;
  const handle = makeAuthRoutes({ auth: a, profiles: store });
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (!(await handle(req, res, url))) res.writeHead(404).end();
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  const call = async (method: string, p: string, body?: unknown, raw?: string) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : (raw ?? JSON.stringify(body ?? {})) });
    return { status: res.status, data: (await res.json()) as Record<string, unknown> };
  };
  try { await fn(call); } finally { srv.close(); process.env.SUPABASE_ANON_KEY = 'anon-de-prueba'; }
  return sent;
}

await test('HTTP: config, pedir código y verificarlo de principio a fin', async () => {
  await withServer(async (call) => {
    assert.deepEqual((await call('GET', '/api/auth/config')).data, { enabled: true });
    assert.equal((await call('GET', '/api/auth/start')).status, 405);
    assert.equal((await call('POST', '/api/auth/start', { email: 'no-valido' })).status, 400);
    assert.equal((await call('POST', '/api/auth/start', { email: 'ana@correo.com' })).status, 200);
    assert.equal((await call('POST', '/api/auth/start', { email: 'ana@correo.com' })).status, 429, 'otro código al mismo correo en menos de un minuto');
    assert.equal((await call('POST', '/api/auth/verify', { email: 'ana@correo.com', token: '000000', pid: 'dispositivo-1-ffffffff' })).status, 401);
    assert.equal((await call('POST', '/api/auth/verify', { email: 'ana@correo.com', token: '123456', pid: 'raro!' })).status, 400, 'pid con caracteres no válidos');
    const ok = await call('POST', '/api/auth/verify', { email: 'ana@correo.com', token: '123 456', pid: 'dispositivo-1-ffffffff' });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.pid, 'dispositivo-1-ffffffff');
    assert.equal(ok.data.email, 'ana@correo.com');
    assert.ok(!('access_token' in ok.data), 'la sesión de Supabase no sale del servidor');
  });
});

await test('HTTP: cuerpos enormes o rotos y demasiados intentos se rechazan', async () => {
  await withServer(async (call) => {
    assert.equal((await call('POST', '/api/auth/start', undefined, 'no es json')).status, 400);
    assert.equal((await call('POST', '/api/auth/start', undefined, JSON.stringify({ email: 'a'.repeat(5000) }))).status, 413);
    let last = 0;
    for (let i = 0; i < 14; i++) last = (await call('POST', '/api/auth/verify', { email: 'ana@correo.com', token: '000000', pid: 'dispositivo-1-gggggggg' })).status;
    assert.equal(last, 429, 'tras muchos códigos erróneos desde la misma IP se frena');
  });
});

await test('HTTP: sin la clave de Supabase el inicio con correo queda desactivado', async () => {
  await withServer(async (call) => {
    assert.deepEqual((await call('GET', '/api/auth/config')).data, { enabled: false });
    assert.equal((await call('POST', '/api/auth/start', { email: 'ana@correo.com' })).status, 503);
  }, false);
});

console.log(`Cuentas: ${n} pruebas correctas`);
for (const pg of opened) await pg.close();
