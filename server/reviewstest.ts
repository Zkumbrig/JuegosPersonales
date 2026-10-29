// Pruebas de valoraciones y reseñas (almacén en archivo; Postgres usa la misma interfaz). npm test
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Reviews, SCHEMA, cleanComment, renderAdmin } from './reviews';

let n = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  n++;
  console.log('  ok  ' + name);
}
console.log('Reseñas (unidades)');

delete process.env.DATABASE_URL;
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-reviews-')), 'r.json');
const rv = new Reviews();
await rv.init(file);
const base = { pid: 'p1', name: 'Ana', game: 'ludo', rating: 5, comment: 'Muy buena', roomCode: 'ABCD', theme: null };

await test('sin DATABASE_URL usa el archivo local y guarda la reseña con todos sus campos', async () => {
  assert.equal(rv.mode, 'archivo');
  assert.equal(await rv.add(base), undefined);
  const [r] = await rv.list();
  assert.deepEqual({ ...r, id: 0, createdAt: '' }, { ...base, id: 0, createdAt: '' });
  assert.ok(Date.parse(r!.createdAt) > 0);
});

await test('valida las estrellas (1 a 5) y limpia el comentario', async () => {
  assert.match(String(await rv.add({ ...base, pid: 'p2', rating: 0 })), /1 a 5/);
  assert.match(String(await rv.add({ ...base, pid: 'p2', rating: 6 })), /1 a 5/);
  assert.match(String(await rv.add({ ...base, pid: 'p2', rating: 3.5 })), /1 a 5/);
  assert.equal(cleanComment('  hola \n\n  mundo \u0007 '), 'hola mundo');
  assert.equal(cleanComment('x'.repeat(900)).length, 400);
  assert.equal(cleanComment(42), '');
});

await test('la misma persona no repite en el mismo juego, pero sí en otro', async () => {
  assert.match(String(await rv.add(base)), /Ya valoraste/);
  assert.equal(await rv.add({ ...base, game: 'blackjack', rating: 4 }), undefined);
  assert.equal(await rv.add({ ...base, pid: 'p3', name: 'Beto', rating: 2, comment: '' }), undefined);
  assert.equal((await rv.list()).length, 3);
});

await test('la página del dueño escapa HTML y resume por juego', () => {
  const html = renderAdmin(
    [{ id: 1, createdAt: '2026-10-30T10:00:00.000Z', pid: 'x', name: '<b>Eve</b>', game: 'ludo', rating: 4, comment: '<script>alert(1)</script>', roomCode: null, theme: null }],
    'archivo',
  );
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('4.00'));
});

await test('el esquema de Postgres tiene los campos pedidos', () => {
  for (const col of ['rating', 'comment', 'game', 'pid', 'name', 'created_at', 'room_code']) assert.ok(SCHEMA.includes(col), col);
  assert.ok(/CHECK \(rating BETWEEN 1 AND 5\)/.test(SCHEMA));
});

console.log(`Reseñas: ${n} pruebas correctas`);
