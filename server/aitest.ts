// Pruebas de las frases generadas con IA (sin red: se simula la respuesta de Gemini). npm test
import assert from 'node:assert/strict';
import { AiContent, cleanItem, sig, similar } from './ai';

let n = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  n++;
  console.log('  ok  ' + name);
}
console.log('IA (unidades)');

const reply = (items: unknown[], status = 200) => async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(items) }] } }] }), { status });

await test('sin clave no hace nada y no pide nada', async () => {
  delete process.env.GEMINI_API_KEY;
  const ai = new AiContent();
  let calls = 0;
  ai.fetcher = (async () => { calls++; return new Response('{}'); }) as typeof fetch;
  assert.equal(ai.enabled, false);
  assert.equal(ai.take('never', 2), null);
  assert.equal(await ai.refill('never', 2), 0);
  assert.equal(calls, 0);
});

process.env.GEMINI_API_KEY = 'clave-de-prueba';

await test('limpia y valida cada tipo de frase', () => {
  assert.equal(cleanItem('never', 'Yo nunca he cantado en la ducha a gritos'), 'Yo nunca he cantado en la ducha a gritos.');
  assert.equal(cleanItem('never', 'He cantado en la ducha a gritos siempre'), null, 'debe empezar por "Yo nunca"');
  assert.equal(cleanItem('likely', '¿Quién es más probable que llegue tarde a su boda'), 'llegue tarde a su boda?');
  assert.equal(cleanItem('likely', '¿llegue tarde a su boda?'), null);
  assert.equal(cleanItem('truth', '¿Cuál fue tu peor cita?'), '¿Cuál fue tu peor cita?');
  assert.equal(cleanItem('truth', 'Cuál fue tu peor cita'), null);
  assert.equal(cleanItem('dare', 'baila sin música durante veinte segundos.'), 'Baila sin música durante veinte segundos.');
  assert.deepEqual(cleanItem('would', { a: 'Poder volar siempre', b: 'Ser invisible a voluntad' }), ['Poder volar siempre', 'Ser invisible a voluntad']);
  assert.equal(cleanItem('would', { a: 'Lo mismo aquí', b: 'lo mismo aquí' }), null);
});

await test('rechaza temas prohibidos, enlaces y textos raros', () => {
  assert.equal(cleanItem('never', 'Yo nunca he hablado con menores de edad en privado.'), null);
  assert.equal(cleanItem('never', 'Yo nunca he visitado https://ejemplo.com a escondidas.'), null);
  assert.equal(cleanItem('truth', '¿Alguna vez pensaste en suicidarte por una ex?'), null);
  assert.equal(cleanItem('dare', 'Haz esto {ahora} mismo con todos.'), null);
  assert.equal(cleanItem('dare', 'Dibuja con tu dedo sobre la espalda de la persona a tu derecha.'), null, 'sin contacto físico');
  assert.equal(cleanItem('dare', 'Besa a la persona que tengas a tu izquierda en la mejilla.'), null);
  assert.equal(cleanItem('dare', 'Quítate un calcetín y quédate así dos rondas.'), null);
  assert.ok(cleanItem('dare', 'Confiesa tu peor cita en una sola frase.'));
  assert.equal(cleanItem('never', 'Yo nunca.'), null, 'demasiado corta');
  assert.equal(cleanItem('never', 'Yo nunca ' + 'a'.repeat(200)), null, 'demasiado larga');
});

await test('rellena el pozo, descarta repetidas y las gasta una sola vez', async () => {
  const ai = new AiContent();
  ai.fetcher = reply([
    'Yo nunca he aprendido un baile viral solo para una fiesta.',
    'Yo nunca he aprendido un baile viral solo para una fiesta.', // repetida
    'yo nunca he leído un libro entero en una sola noche.',
    'Esto no empieza como toca',
    'Yo nunca he rechazado un abrazo de un desconocido en un tren.',
  ]) as typeof fetch;
  assert.equal(await ai.refill('never', 2), 3);
  assert.equal(ai.size('never', 2), 3);
  const got = new Set([ai.take('never', 2), ai.take('never', 2), ai.take('never', 2)]);
  assert.equal(got.size, 3);
  assert.equal(ai.take('never', 2), null, 'ya no quedan');
});

await test('no repite frases de la lista curada', async () => {
  const ai = new AiContent();
  ai.fetcher = reply(['Yo nunca me he olvidado del cumpleaños de alguien cercano.']) as typeof fetch;
  assert.equal(await ai.refill('never', 1), 0);
});

await test('los dilemas llegan como pareja', async () => {
  const ai = new AiContent();
  ai.fetcher = reply([{ a: 'Cenar siempre lo mismo', b: 'No cenar nunca más' }, { a: 'x', b: 'y' }]) as typeof fetch;
  assert.equal(await ai.refill('would', 3), 1);
  assert.deepEqual(ai.take('would', 3), ['Cenar siempre lo mismo', 'No cenar nunca más']);
});

await test('si Gemini falla, se espera un rato y el juego sigue sin la IA', async () => {
  const ai = new AiContent();
  let calls = 0;
  ai.fetcher = (async () => { calls++; return new Response('boom', { status: 500 }); }) as typeof fetch;
  const warn = console.warn;
  console.warn = () => {};
  assert.equal(await ai.refill('truth', 3), 0);
  assert.equal(await ai.refill('truth', 3), 0, 'en espera: no vuelve a llamar enseguida');
  console.warn = warn;
  assert.equal(calls, 1);
  assert.equal(ai.take('truth', 3), null);
});

await test('retos de minidepa: nada de gritar, saltar, balcón ni baño', () => {
  for (const bad of ['Sal al balcón y saluda a los vecinos.', 'Grita tu nombre lo más fuerte que puedas.', 'Salta tres veces sobre un pie.', 'Ve al baño y vuelve con una cara nueva.', 'Escribe en el brazo de la persona a tu derecha una inicial.', 'Susúrrale al oído una fantasía a alguien del grupo.', 'Llama a un contacto al azar y pídele un consejo.']) assert.equal(cleanItem('dare', bad), null, bad);
  assert.ok(cleanItem('dare', 'Imita a un presentador de noticias durante tu próxima frase.'));
});

await test('detecta frases parecidas aunque cambien las palabras', () => {
  const a = sig('Yo nunca he fingido una llamada para escapar de una cita aburrida.');
  assert.ok(similar(a, sig('Yo nunca he fingido una llamada telefónica para escapar de una cita.')));
  assert.ok(!similar(a, sig('Yo nunca he bailado encima de una mesa en una boda.')));
});

await test('AI_CONTENT=0 la desactiva aunque haya clave', () => {
  process.env.AI_CONTENT = '0';
  assert.equal(new AiContent().enabled, false);
  delete process.env.AI_CONTENT;
});

console.log(`IA: ${n} pruebas correctas`);
