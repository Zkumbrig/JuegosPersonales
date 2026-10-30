// Pruebas de las frases generadas con IA (sin red: se simula la respuesta de Gemini). npm test
import assert from 'node:assert/strict';
import { AiContent, QuipMaker, cleanItem, cleanQuip, sig, similar } from './ai';
import { curatedQuip, joinNames, type QuipCtx } from './quips';

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

// ---------- Comentarios con gracia ----------
const textReply = (text: string, status = 200) => async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status });
const REQ = { game: 'never', prompt: 'Yo nunca he mandado un mensaje al ex.', level: 2, outcome: '3 de 5 personas dijeron que sí lo han hecho' } as const;

await test('el comentario de la IA se limpia y descarta lo que no sirve', () => {
  assert.equal(cleanQuip('"Tres de cinco: el ex tiene el chat más concurrido del mes."'), 'Tres de cinco: el ex tiene el chat más concurrido del mes.');
  assert.equal(cleanQuip('Corto'), null, 'demasiado corto');
  assert.equal(cleanQuip('x'.repeat(200)), null, 'demasiado largo');
  assert.equal(cleanQuip('Qué risa de ronda 😂 la verdad'), null, 'sin emojis');
  assert.equal(cleanQuip('Frase con {llaves} dentro de ella'), null);
  assert.equal(cleanQuip(42), null);
});

await test('la IA solo habla si es específica: SKIP, relleno, sin relación con la pregunta o contradiciendo el resultado', () => {
  const req = { game: 'never', prompt: 'Yo nunca he dejado morir una planta por olvidarme de regarla.', level: 1, outcome: '3 de 5 personas dijeron que sí', anyDrink: true } as const;
  assert.equal(cleanQuip('SKIP', req), null, 'SKIP = no hay nada gracioso');
  assert.equal(cleanQuip('skip', req), null);
  assert.equal(cleanQuip('Tres verdugos de plantas confesos; el balcón pide abogado.', req), 'Tres verdugos de plantas confesos; el balcón pide abogado.');
  assert.equal(cleanQuip('Parece que alguien recordó por qué odia los lunes y las plantas.', req), null, 'muletilla "Parece que"');
  assert.equal(cleanQuip('Qué grupo tan talentoso tenemos aquí hoy.', req), null, 'muletilla "Qué grupo"');
  assert.equal(cleanQuip('Los lunes siempre son un desastre para todo el mundo.', req), null, 'no habla de la pregunta');
  assert.equal(cleanQuip('Nadie ha matado una planta, qué gente tan decente.', req), null, 'contradice: sí hubo culpables');
  assert.equal(cleanQuip('Una frase larguísima que sigue y sigue sin parar hablando de plantas y de cómo mueren todas por olvido total.', req), null, 'demasiadas palabras');
  const none = { ...req, anyDrink: false, outcome: 'nadie dijo que sí' };
  assert.equal(cleanQuip('Ni una planta muerta: aquí hay jardineros o mentirosos que beben.', none), null, 'habla de beber cuando nadie bebe');
  assert.ok(cleanQuip('Ni una planta muerta: o son jardineros o son mentirosos.', none));
});

await test('no repite la misma idea dos veces seguidas', async () => {
  const q = new QuipMaker();
  q.fetcher = textReply('Tres verdugos de plantas confesos; el balcón pide abogado.') as typeof fetch;
  const req = { game: 'never', prompt: 'Yo nunca he dejado morir una planta por olvidarme.', level: 1, outcome: '3 de 5 sí', anyDrink: true } as const;
  assert.ok(await q.make(req));
  assert.equal(await q.make(req), null, 'la segunda vez es la misma idea');
});

await test('sin clave o con AI_QUIPS=0 no pide nada', async () => {
  const q = new QuipMaker();
  let calls = 0;
  q.fetcher = (async () => { calls++; return new Response('{}'); }) as typeof fetch;
  process.env.AI_QUIPS = '0';
  assert.equal(await q.make(REQ), null);
  delete process.env.AI_QUIPS;
  assert.equal(calls, 0);
});

await test('pide un comentario y no envía nombres ni datos de jugadores', async () => {
  const q = new QuipMaker();
  let body = '';
  q.fetcher = (async (_u: unknown, init?: RequestInit) => { body = String(init?.body); return textReply('Tres mensajes al ex y los demás borrando el historial.')(); }) as typeof fetch;
  assert.equal(await q.make(REQ), 'Tres mensajes al ex y los demás borrando el historial.');
  assert.ok(body.includes('3 de 5 personas'));
  assert.ok(!/\bpid\b|nombre del jugador/i.test(body));
});

await test('un error o una respuesta inválida devuelven null sin romper', async () => {
  const q = new QuipMaker();
  q.fetcher = (async () => new Response('x', { status: 500 })) as typeof fetch;
  assert.equal(await q.make(REQ), null);
  q.fetcher = textReply('ok') as typeof fetch;
  assert.equal(await q.make(REQ), null, 'frase demasiado corta');
});

await test('si el modelo principal falla, prueba el de respaldo; si fallan los dos, hace una pausa', async () => {
  delete process.env.GEMINI_QUIP_MODEL;
  process.env.GEMINI_MODEL = 'modelo-de-respaldo';
  const q = new QuipMaker();
  const urls: string[] = [];
  q.fetcher = (async (u: unknown) => {
    urls.push(String(u));
    return /gemini-3\.5-flash/.test(String(u)) ? new Response('RESOURCE_EXHAUSTED', { status: 429 }) : textReply('Tres mensajes al ex y los demás borrando el historial.')();
  }) as typeof fetch;
  assert.equal(await q.make(REQ), 'Tres mensajes al ex y los demás borrando el historial.');
  assert.equal(urls.length, 2, 'primero el principal (falló) y luego el de respaldo');
  // los dos saturados: pausa de un minuto y no insiste
  const q2 = new QuipMaker();
  let calls = 0;
  q2.fetcher = (async () => { calls++; return new Response('UNAVAILABLE', { status: 503 }); }) as typeof fetch;
  assert.equal(await q2.make(REQ), null);
  assert.equal(await q2.make(REQ), null);
  assert.equal(calls, 2, 'una ronda con los dos modelos y ninguna más durante la pausa');
  delete process.env.GEMINI_MODEL;
});

await test('un SKIP no gasta el modelo de respaldo', async () => {
  process.env.GEMINI_MODEL = 'modelo-de-respaldo';
  const q = new QuipMaker();
  let calls = 0;
  q.fetcher = (async () => { calls++; return textReply('SKIP')(); }) as typeof fetch;
  assert.equal(await q.make(REQ), null);
  assert.equal(calls, 1);
  delete process.env.GEMINI_MODEL;
});

await test('límite por minuto y pausa tras agotar la cuota', async () => {
  const q = new QuipMaker();
  let calls = 0;
  q.fetcher = (async () => { calls++; return textReply('Una reacción larga y simpática sobre la ronda.')(); }) as typeof fetch;
  for (let i = 0; i < 12; i++) await q.make(REQ);
  assert.equal(calls, 8, 'como máximo 8 por minuto');
  const q2 = new QuipMaker();
  let c2 = 0;
  q2.fetcher = (async () => { c2++; return new Response('RESOURCE_EXHAUSTED', { status: 429 }); }) as typeof fetch;
  await q2.make(REQ);
  await q2.make(REQ);
  assert.equal(c2, 2, 'tras un 429 prueba los dos modelos una vez y deja de pedir un rato');
});

await test('los comentarios escritos a mano cubren cada situación y mencionan a quien corresponde', () => {
  const ctxs: QuipCtx[] = [
    { game: 'never', total: 4, drinkers: [] },
    { game: 'never', total: 4, drinkers: ['Ana'] },
    { game: 'never', total: 4, drinkers: ['Ana', 'Beto'] },
    { game: 'never', total: 3, drinkers: ['Ana', 'Beto', 'Caro'] },
    { game: 'likely', total: 4, drinkers: ['Ana'], votes: 4 },
    { game: 'likely', total: 5, drinkers: ['Ana'], votes: 3 },
    { game: 'likely', total: 5, drinkers: ['Ana', 'Beto'], votes: 2 },
    { game: 'would', a: 2, b: 2, drinkers: [] },
    { game: 'would', a: 4, b: 0, drinkers: [] },
    { game: 'would', a: 4, b: 1, drinkers: ['Beto'] },
    { game: 'truth', kind: 'dare', resolved: 'drink', name: 'Ana' },
    { game: 'truth', kind: 'truth', resolved: 'done', name: 'Ana' },
    { game: 'reflex', total: 3, early: ['Ana'], best: null, last: null },
    { game: 'reflex', total: 3, early: [], best: { name: 'Ana', ms: 210 }, last: { name: 'Beto', ms: 480 } },
    { game: 'reflex', total: 3, early: [], best: { name: 'Ana', ms: 350 }, last: { name: 'Beto', ms: 480 } },
  ];
  for (const c of ctxs) {
    for (let i = 0; i < 6; i++) {
      const q = curatedQuip(c);
      assert.ok(q.length > 10 && q.length < 140, `longitud rara: ${q}`);
      assert.ok(!/undefined|\[object/.test(q), q);
    }
  }
  assert.match(curatedQuip({ game: 'never', total: 4, drinkers: ['Ana'] }), /Ana/);
  assert.equal(joinNames(['Ana', 'Beto', 'Caro']), 'Ana, Beto y Caro');
});

console.log(`IA: ${n} pruebas correctas`);
