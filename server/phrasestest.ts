// Frases de la IA que se guardan, rotan, se miden y enseñan a la IA qué funciona (PGlite, sin red). npm test
process.env.DATABASE_URL = ''; // las pruebas nunca tocan la base de datos real
process.env.GEMINI_API_KEY = 'clave-de-prueba';
process.env.AI_QUIPS = '0'; // los comentarios de la mesa tampoco llaman a la red
process.env.AI_SHARE = '1'; // en las pruebas de la mesa, siempre sale la frase de la IA
delete process.env.AI_CONTENT;
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { AiContent, aiContent, phraseScore, type PhraseStats } from './ai';
import { renderPhrases } from './phrasesAdmin';
import type { SqlDb } from './db';

let n = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  await fn();
  n++;
  console.log('  ok  ' + name);
}
console.log('Frases guardadas y medidas (PGlite)');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationFiles = fs.readdirSync(path.join(ROOT, 'db', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => fs.readFileSync(path.join(ROOT, 'db', 'migrations', f), 'utf8');

const opened: PGlite[] = [];
async function freshDb(only?: string[]) {
  const pg = new PGlite();
  opened.push(pg);
  await pg.exec('create schema auth; create table auth.users (id uuid primary key default gen_random_uuid());');
  for (const f of only ?? migrationFiles) await pg.exec(read(f));
  if (!only) for (const f of migrationFiles) await pg.exec(read(f)); // las migraciones deben poder repetirse
  const db: SqlDb = { query: (sql, params) => pg.query(sql, params as unknown[]) as Promise<{ rows: Record<string, unknown>[] }> };
  return { pg, db };
}

const reply = (items: unknown[]) => async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }] }), { status: 200 });
const noNetwork = (async () => { throw new Error('no debería llamar a la red'); }) as typeof fetch;
const stats = (o: Partial<PhraseStats>): PhraseStats => ({ shown: 0, answered: 0, hits: 0, accepted: 0, declined: 0, skipped: 0, ...o });
const NEVER_SET = [
  'Yo nunca he cantado a gritos en un taxi con el conductor.',
  'Yo nunca he ensayado una discusión frente al espejo.',
  'Yo nunca he llamado mamá a mi jefe en una reunión.',
  'Yo nunca he pagado una suscripción durante años sin usarla.',
  'Yo nunca he discutido en voz alta con una máquina expendedora.',
];
const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const w = console.warn, e = console.error, l = console.log;
  console.warn = console.error = console.log = () => {};
  try { return await fn(); } finally { console.warn = w; console.error = e; console.log = l; }
};

await test('la nota de una frase mide si mueve a la mesa (y no puntúa con pocos datos)', () => {
  assert.equal(phraseScore('never', stats({ shown: 2, answered: 10, hits: 5 })), null, 'menos de 3 apariciones');
  assert.equal(phraseScore('never', stats({ shown: 5, answered: 3, hits: 1 })), null, 'menos de 4 respuestas');
  assert.equal(phraseScore('never', stats({ shown: 5, answered: 10, hits: 5 })), 1, 'divide a la mesa por la mitad: lo mejor');
  assert.equal(phraseScore('never', stats({ shown: 5, answered: 10, hits: 0 })), 0, 'nadie la ha hecho: aburre');
  assert.equal(phraseScore('never', stats({ shown: 5, answered: 10, hits: 10 })), 0, 'todos: tampoco');
  assert.equal(phraseScore('would', stats({ shown: 5, answered: 10, hits: 5 })), 1, 'mesa partida por la mitad');
  assert.ok(phraseScore('would', stats({ shown: 5, answered: 10, hits: 1 }))! < 0.3, 'casi unanimidad');
  assert.ok(phraseScore('likely', stats({ shown: 5, answered: 10, hits: 6 }))! > 0.9, 'alguien destaca');
  assert.ok(phraseScore('dare', stats({ shown: 5, accepted: 7, declined: 3 }))! > 0.95, 'se cumple 7 de 10');
  assert.ok(phraseScore('dare', stats({ shown: 5, accepted: 1, declined: 9 }))! < 0.3, 'casi todos la rechazan');
  assert.equal(phraseScore('truth', stats({ shown: 5, accepted: 1, declined: 1 })), null, 'pocos intentos');
  const sinSaltos = phraseScore('never', stats({ shown: 5, answered: 10, hits: 5 }))!;
  assert.ok(phraseScore('never', stats({ shown: 5, answered: 10, hits: 5, skipped: 3 }))! < sinSaltos, 'cada salto del anfitrión resta');
});

await test('lo generado se guarda y, tras un reinicio, vuelve a los depósitos sin pedir nada al arrancar', async () => {
  const { pg, db } = await freshDb();
  const a = new AiContent();
  await a.attachDb(db);
  assert.equal(a.persistent, true);
  a.fetcher = reply(NEVER_SET) as typeof fetch;
  assert.equal(await a.refill('never', 2), 5);
  assert.equal(((await pg.query("select count(*)::int as n from ai_phrases where kind = 'never' and level = 2")).rows[0] as { n: number }).n, 5);

  const reinicio = new AiContent(); // otro proceso: memoria vacía
  reinicio.fetcher = noNetwork;
  await reinicio.attachDb(db);
  assert.equal(reinicio.size('never', 2), 5, 'las 5 vuelven a los depósitos');
  const t = reinicio.takeWithId('never', 2)!;
  assert.ok(typeof t.item === 'string' && NEVER_SET.includes(t.item));
  assert.match(t.id!, /^[0-9a-f-]{36}$/);
  assert.equal(await reinicio.refill('never', 2), 0, 'pedir otra vez lo mismo no duplica nada');
});

await test('rotación: salen primero las que menos han salido', async () => {
  const { pg, db } = await freshDb();
  for (const [i, shown] of [4, 0, 9, 1].entries()) {
    await pg.query("insert into ai_phrases (kind, level, text, shown) values ('truth', 1, $1, $2)", [`¿Cuál fue el peor regalo que recibiste, número ${i}?`, shown]);
  }
  const a = new AiContent();
  a.fetcher = noNetwork;
  await a.attachDb(db);
  const order = [0, 1, 2, 3].map(() => a.take('truth', 1) as string);
  assert.deepEqual(order.map((t) => Number(/número (\d)/.exec(t)![1])), [1, 3, 0, 2], 'primero la de 0, luego 1, 4 y 9');
});

await test('se retiran las que no funcionan (con datos suficientes) y se conservan las buenas', async () => {
  const { pg, db } = await freshDb();
  await pg.query("insert into ai_phrases (kind, level, text, shown, answered, hits) values ('never', 2, 'Yo nunca he hecho algo que nadie en la mesa ha hecho.', 8, 40, 0)");
  await pg.query("insert into ai_phrases (kind, level, text, shown, answered, hits) values ('never', 2, 'Yo nunca he roto algo ajeno y lo he escondido bien.', 8, 40, 20)");
  const a = new AiContent();
  await quiet(() => a.attachDb(db));
  assert.equal(a.size('never', 2), 1, 'solo la que divide a la mesa');
  const st = (await pg.query("select text, status from ai_phrases order by text")).rows as { text: string; status: string }[];
  assert.equal(st.find((r) => /nadie en la mesa/.test(r.text))!.status, 'rejected');
  assert.equal(st.find((r) => /roto algo ajeno/.test(r.text))!.status, 'approved');
});

await test('se apunta lo que pasa con cada frase y se guarda en la base de datos (con reintento si falla)', async () => {
  const { pg, db } = await freshDb();
  await pg.query("insert into ai_phrases (kind, level, text) values ('never', 3, 'Yo nunca he mandado un mensaje a mi ex a las tres de la madrugada.')");
  let fail = true;
  const flaky: SqlDb = { query: (sql, p) => (fail && /update ai_phrases/.test(sql) ? Promise.reject(new Error('sin conexión')) : db.query(sql, p)) };
  const a = new AiContent();
  await a.attachDb(flaky);
  const t = a.takeWithId('never', 3)!; // cuenta una aparición
  a.record(t.id, { answered: 5, hits: 2 });
  a.record(t.id, { answered: 4, hits: 4 });
  a.record(null, { answered: 99 }); // una frase de la lista curada no se mide
  await quiet(() => a.flush()); // falla: no se pierde
  fail = false;
  await a.flush();
  const row = (await pg.query('select shown, answered, hits, used_at from ai_phrases')).rows[0] as Record<string, unknown>;
  assert.equal(row.shown, 1);
  assert.equal(row.answered, 9);
  assert.equal(row.hits, 6);
  assert.ok(row.used_at, 'queda anotada la última vez que salió');
  await a.flush(); // nada pendiente: no escribe de nuevo
  assert.equal(((await pg.query('select shown from ai_phrases')).rows[0] as { shown: number }).shown, 1);
});

await test('cada depósito tiene su propia pausa tras un fallo, y la cuota agotada frena a todos', async () => {
  const a = new AiContent();
  let calls = 0;
  a.fetcher = (async (u: unknown) => {
    calls++;
    return String(u).includes('error503') ? new Response('x', { status: 503 }) : reply([])();
  }) as typeof fetch;
  // Primer depósito falla con 503
  const f503 = (async () => { calls++; return new Response('x', { status: 503 }); }) as typeof fetch;
  a.fetcher = f503;
  assert.equal(await quiet(() => a.refill('never', 1)), 0);
  assert.equal(await quiet(() => a.refill('never', 1)), 0);
  assert.equal(calls, 2 - 1, 'el segundo intento del mismo depósito ni llama');
  // Otro depósito sigue pudiendo pedir
  a.fetcher = (async () => { calls++; return reply(NEVER_SET)(); }) as typeof fetch;
  assert.equal(await a.refill('never', 2), 5, 'un fallo en Yo nunca/suave no frena a Yo nunca/picante');
  // Cuota agotada: nadie pide
  a.fetcher = (async () => { calls++; return new Response('RESOURCE_EXHAUSTED', { status: 429 }); }) as typeof fetch;
  await quiet(() => a.refill('likely', 1));
  const antes = calls;
  a.fetcher = (async () => { calls++; return reply(NEVER_SET)(); }) as typeof fetch;
  assert.equal(await a.refill('would', 3), 0);
  assert.equal(calls, antes, 'con la cuota agotada ningún depósito pide');
});

await test('al arrancar solo se rellenan los depósitos que están bajos', async () => {
  const { pg, db } = await freshDb();
  for (let i = 0; i < 12; i++) {
    await pg.query("insert into ai_phrases (kind, level, text) values ('never', 1, $1)", [`Yo nunca he guardado el recuerdo número ${i} de una cita desastrosa.`]);
  }
  const a = new AiContent();
  await quiet(() => a.attachDb(db));
  const pedidos: string[] = [];
  a.fetcher = (async (_u: unknown, init?: RequestInit) => { pedidos.push(String(init?.body)); return reply([])(); }) as typeof fetch;
  await a.prefill(0);
  assert.equal(pedidos.length, 14, '15 depósitos menos el que ya está lleno');
});

await test('la IA aprende de lo que funcionó: las mejores y peores van como ejemplos en el siguiente lote', async () => {
  const { pg, db } = await freshDb();
  for (let i = 0; i < 6; i++) {
    await pg.query("insert into ai_phrases (kind, level, text, shown, answered, hits) values ('never', 2, $1, 5, 10, 5)", [`Yo nunca he hecho la gran travesura buena número ${i} en una boda.`]);
  }
  for (let i = 0; i < 4; i++) {
    await pg.query("insert into ai_phrases (kind, level, text, shown, answered, hits) values ('never', 2, $1, 5, 10, 0)", [`Yo nunca he cometido el delito aburrido número ${i} de oficina.`]);
  }
  const a = new AiContent();
  await quiet(() => a.attachDb(db));
  let prompt = '';
  a.fetcher = (async (_u: unknown, init?: RequestInit) => { prompt = JSON.parse(String(init?.body)).contents[0].parts[0].text; return reply([])(); }) as typeof fetch;
  await a.refill('never', 2);
  assert.match(prompt, /funcionaron MUY BIEN[^\n]*travesura buena/);
  assert.match(prompt, /funcionaron mal[^\n]*delito aburrido/);
  assert.match(prompt, /Reparte las frases entre temas/, 'cada lote pide temas distintos para variar');
  // con pocos datos no se inventa un aprendizaje
  const poca = await freshDb();
  await poca.pg.query("insert into ai_phrases (kind, level, text, shown, answered, hits) values ('never', 1, 'Yo nunca he sido el único en llegar tarde.', 5, 10, 5)");
  const b = new AiContent();
  await quiet(() => b.attachDb(poca.db));
  let p2 = '';
  b.fetcher = (async (_u: unknown, init?: RequestInit) => { p2 = JSON.parse(String(init?.body)).contents[0].parts[0].text; return reply([])(); }) as typeof fetch;
  await b.refill('never', 1);
  assert.ok(!/funcionaron MUY BIEN/.test(p2), 'con menos de 8 frases medidas todavía no aprende');
});

await test('si falta la migración 0003 todo sigue funcionando solo en memoria', async () => {
  const { db } = await freshDb(['0001_init.sql']); // sin las columnas nuevas
  const a = new AiContent();
  await quiet(() => a.attachDb(db));
  assert.equal(a.persistent, false);
  a.fetcher = reply(NEVER_SET) as typeof fetch;
  assert.equal(await a.refill('never', 2), 5);
  assert.ok(a.takeWithId('never', 2)!.id === null, 'sin base de datos no hay identificador');
});

await test('en la mesa: la frase de la IA se mide al revelar y al resolver, y se anota si el anfitrión la salta', async () => {
  const { Party } = await import('./party');
  const mk = (game: string) => {
    const players = new Map(['p1', 'p2'].map((id) => [id, { id, name: id.toUpperCase(), ws: {} }]));
    return { game, players, hostId: 'p1', broadcast() {}, noteRound() {}, noteDrink() {}, addFeed() {}, noteReflex() {} };
  };
  const calls: [string | null | undefined, Record<string, number>][] = [];
  const realTake = aiContent.takeWithId.bind(aiContent);
  const realRecord = aiContent.record.bind(aiContent);
  const ID = '11111111-1111-4111-8111-111111111111';
  aiContent.takeWithId = (() => ({ item: 'Yo nunca he cantado en un funeral de verdad.', id: ID })) as typeof aiContent.takeWithId;
  aiContent.record = ((id: string | null | undefined, d: Record<string, number>) => { calls.push([id, d]); }) as typeof aiContent.record;
  try {
    // Yo nunca: dos respuestas, una dice que sí
    const r1 = mk('never');
    const p1 = new Party(r1 as never);
    assert.equal(p1.next({ id: 'p1' } as never), undefined);
    assert.equal(p1.prompt, 'Yo nunca he cantado en un funeral de verdad.');
    p1.answer({ id: 'p1' } as never, 'yes');
    p1.answer({ id: 'p2' } as never, 'no');
    p1.forceReveal({ id: 'p1' } as never);
    assert.deepEqual(calls.at(-1), [ID, { answered: 2, hits: 1 }]);
    p1.dispose();

    // Verdad o reto: se cumple y, en otra ronda, el anfitrión la salta
    const r2 = mk('truth');
    const p2 = new Party(r2 as never);
    p2.next({ id: 'p1' } as never);
    const target = { id: p2.target! } as never;
    p2.answer(target, 'dare');
    p2.answer(target, 'done');
    assert.deepEqual(calls.at(-1), [ID, { accepted: 1 }]);
    p2.next({ id: 'p1' } as never); // siguiente jugador
    const t2 = { id: p2.target! } as never;
    p2.answer(t2, 'truth');
    p2.next({ id: 'p1' } as never); // el anfitrión salta la frase sin resolver
    assert.deepEqual(calls.at(-1), [ID, { skipped: 1 }]);
    p2.dispose();

    // Una frase de la lista curada (sin identificador) no se mide
    aiContent.takeWithId = (() => null) as typeof aiContent.takeWithId;
    calls.length = 0;
    const r3 = mk('never');
    const p3 = new Party(r3 as never);
    p3.next({ id: 'p1' } as never);
    p3.answer({ id: 'p1' } as never, 'yes');
    p3.forceReveal({ id: 'p1' } as never);
    assert.ok(calls.every(([id]) => id === null || id === undefined), 'sin frase de la IA no se apunta nada');
    p3.dispose();
  } finally {
    aiContent.takeWithId = realTake;
    aiContent.record = realRecord;
  }
});

await test('el informe del administrador resume existencias y las frases que mejor y peor funcionan, y escapa el HTML', async () => {
  const { pg, db } = await freshDb();
  await pg.query("insert into ai_phrases (kind, level, text, shown, answered, hits) values ('never', 2, 'Yo nunca he tenido <script>x</script> en la mesa.', 5, 10, 5)");
  await pg.query("insert into ai_phrases (kind, level, text, shown, answered, hits) values ('never', 2, 'Yo nunca he hecho algo que nadie ha hecho jamás.', 5, 10, 0)");
  await pg.query("insert into ai_phrases (kind, level, text, status) values ('dare', 1, 'Imita a un famoso durante veinte segundos.', 'rejected')");
  const a = new AiContent();
  await quiet(() => a.attachDb(db));
  const rep = (await a.report())!;
  assert.equal(rep.totals.length, 2);
  assert.equal(rep.best[0]!.score, 1);
  assert.equal(rep.worst[0]!.score, 0);
  const html = renderPhrases(rep);
  assert.ok(!html.includes('<script>x'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.match(renderPhrases(null), /DATABASE_URL/);
  assert.equal(await new AiContent().report(), null, 'sin base de datos no hay informe');
});

console.log(`Frases: ${n} pruebas correctas`);
for (const pg of opened) await pg.close();
