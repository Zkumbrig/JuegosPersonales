// Autoprueba: npm test  (arranca el servidor en el puerto 3999 y juega rondas reales)
process.env.PORT = '3999';
process.env.LUDO_FAST = '1'; // los bots del Ludo juegan sin pausas
// La autoprueba no debe leer ni escribir las mesas reales del proyecto.
import os from 'node:os';
import nodePath from 'node:path';
process.env.DATA_FILE = nodePath.join(os.tmpdir(), 'royale-selftest-rooms.json');
import nodeFs from 'node:fs';
nodeFs.rmSync(process.env.DATA_FILE, { force: true }); // cada autoprueba empieza limpia
nodeFs.rmSync(process.env.DATA_FILE.replace(/\.json$/, '') + '.profiles.json', { force: true });

process.env.POKER = '1'; // estas pruebas ejercitan el póker, que por defecto está oculto
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { spin } from './slots';
import { handValue } from './blackjack';
import { returnMultiplier } from '../shared/rules';
import { bestHand, splitPots, type PCard } from './pokerEval';
import { DARES, KING_RULES, LIKELY, NEVER, TRUTHS, WOULD } from './content';
import { Player, Room } from './room';
import type { ClientMsg, GameId, ProfilePublic, RoomPublic, ServerMsg } from '../shared/protocol';

// ---------- Unidades ----------
{
  const N = 2_000_000;
  let total = 0;
  for (let i = 0; i < N; i++) total += spin().mult;
  const rtp = total / N;
  console.log(`RTP tragaperras (${N} giros): ${(rtp * 100).toFixed(2)} %`);
  assert.ok(rtp > 0.9 && rtp < 1.0, 'RTP fuera de rango');
}
assert.equal(handValue([{ r: 'A', s: 'S' }, { r: 'K', s: 'H' }]), 21);
assert.equal(handValue([{ r: 'A', s: 'S' }, { r: 'A', s: 'H' }, { r: '9', s: 'D' }]), 21);
assert.equal(handValue([{ r: 'K', s: 'S' }, { r: 'Q', s: 'H' }, { r: '5', s: 'D' }]), 25);
assert.equal(returnMultiplier({ kind: 'straight', value: 17 }, 17), 36);
assert.equal(returnMultiplier({ kind: 'red' }, 0), 0);
assert.equal(returnMultiplier({ kind: 'red' }, 32), 2);
assert.equal(returnMultiplier({ kind: 'even' }, 0), 0);
assert.equal(returnMultiplier({ kind: 'dozen', value: 2 }, 13), 3);
assert.equal(returnMultiplier({ kind: 'dozen', value: 2 }, 25), 0);
assert.equal(returnMultiplier({ kind: 'column', value: 3 }, 36), 3);
assert.equal(returnMultiplier({ kind: 'column', value: 1 }, 34), 3);
assert.equal(returnMultiplier({ kind: 'column', value: 2 }, 34), 0);
console.log('Unidades OK');

// ---------- Póker: evaluador y botes ----------
{
  const RANKS: Record<string, number> = { T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const hand = (s: string): PCard[] =>
    s.split(' ').map((x) => ({ r: RANKS[x[0]] ?? Number(x[0]), s: x[1].toUpperCase() as PCard['s'] }));
  const score = (s: string) => bestHand(hand(s)).score;

  // Una mano de cada categoría, de menor a mayor: deben ordenarse estrictamente
  const ladder = [
    '2c 5d 7h 9s Kc', // carta alta
    '2c 2d 7h 9s Kc', // pareja
    '2c 2d 7h 7s Kc', // doble pareja
    '2c 2d 2h 9s Kc', // trío
    '5c 6d 7h 8s 9c', // escalera
    '2c 5c 7c 9c Kc', // color
    '2c 2d 2h 9s 9c', // full
    '2c 2d 2h 2s Kc', // póker
    '5c 6c 7c 8c 9c', // escalera de color
  ];
  for (let i = 1; i < ladder.length; i++) assert.ok(score(ladder[i]) > score(ladder[i - 1]), `categoría ${i}`);
  assert.equal(bestHand(hand('5c 6c 7c 8c 9c')).name, 'Escalera de color');
  assert.ok(score('6c 2d 3h 4s 5c') > score('Ac 2d 3h 4s 5c'), 'la rueda A-5 es la escalera más baja');
  assert.ok(score('Ac 2d 3h 4s 5c') > score('Ac Kd Qh Js 9c'), 'escalera > carta alta');
  assert.ok(score('Ac Ad 3h 4s Kc') > score('Ac Ad 3h 4s Qc'), 'desempate por kicker');
  assert.ok(score('Kc Kd Kh 2s 2c') > score('Qc Qd Qh As Ac'), 'full: manda el trío');
  // 7 cartas: escalera real de color escondida entre ruido
  assert.equal(bestHand(hand('Ah Kh Qh Jh 2c Th 3d')).name, 'Escalera de color');
  assert.equal(bestHand(hand('Ah Ad Kc Kd 2c 2h 9s')).name, 'Doble pareja');

  // Botes laterales: A (all-in 100, la mejor mano), B y C 300, D se retiró tras poner 50
  const pay = splitPots(
    [
      { id: 'A', total: 100, folded: false, score: 9 },
      { id: 'B', total: 300, folded: false, score: 5 },
      { id: 'C', total: 300, folded: false, score: 1 },
      { id: 'D', total: 50, folded: true, score: 0 },
    ],
    ['A', 'B', 'C', 'D'],
  );
  assert.equal(pay.get('A'), 350);
  assert.equal(pay.get('B'), 400);
  assert.equal(pay.get('C') ?? 0, 0);
  assert.equal([...pay.values()].reduce((a, b) => a + b, 0), 750, 'el bote total se conserva');
  // Empate con ficha impar: 25 entre dos -> 13 y 12 según el orden
  const tie = splitPots(
    [
      { id: 'X', total: 10, folded: false, score: 7 },
      { id: 'Y', total: 10, folded: false, score: 7 },
      { id: 'Z', total: 5, folded: true, score: 0 },
    ],
    ['Y', 'X', 'Z'],
  );
  assert.equal(tie.get('Y'), 13);
  assert.equal(tie.get('X'), 12);
  console.log('Póker (manos y botes) OK');
}

// ---------- Blackjack avanzado (mazo preparado) ----------
{
  const fakeWs = { readyState: 1, send: () => {}, close: () => {} } as unknown as WebSocket;
  const card = (r: string, s: 'S' | 'H' | 'D' | 'C' = 'S') => ({ r, s });
  const waitFor = async (pred: () => boolean, label: string, ms = 20_000) => {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error('Timeout esperando: ' + label);
      await new Promise((r) => setTimeout(r, 30));
    }
  };
  /** Mesa de un solo jugador con el mazo dado. Orden del reparto: jugador, crupier (visible), jugador, crupier (oculta). */
  const table = async (stack: ReturnType<typeof card>[]) => {
    const room = new Room('TEST', () => {});
    const p = new Player('player-test-1', 'Test', 0);
    p.ws = fakeWs;
    room.players.set(p.id, p);
    room.hostId = p.id;
    room.bj.debugStack(stack);
    assert.equal(room.bj.bet(p, 100), undefined);
    await waitFor(() => room.bj.phase !== 'betting', 'reparto');
    return { room, p, bj: room.bj, seat: () => room.bj.toPublic().seats[0], phase: () => room.bj.phase };
  };

  // 1) Dividir 8-8 y doblar una mano. El crupier (6+10) roba un 10 y se pasa.
  {
    const t = await table([card('8', 'S'), card('6', 'D'), card('8', 'H'), card('10', 'C'), card('3', 'S'), card('10', 'D'), card('9', 'H'), card('10', 'S')]);
    assert.equal(t.phase(), 'playing');
    assert.equal(t.bj.act(t.p.id, 'split'), undefined, 'dividir 8-8 está permitido');
    assert.equal(t.seat().hands.length, 2);
    assert.equal(t.p.chips, 800, 'dividir cuesta otra apuesta igual');
    assert.equal(t.bj.act(t.p.id, 'double'), undefined, 'doblar tras dividir está permitido');
    assert.equal(t.p.chips, 700);
    assert.equal(t.seat().active, 1, 'pasa a la segunda mano');
    assert.equal(t.bj.act(t.p.id, 'split'), 'Solo puedes dividir un par.', 'no se divide dos veces');
    assert.equal(t.bj.act(t.p.id, 'stand'), undefined);
    await waitFor(() => t.phase() === 'payout', 'pago de la división');
    assert.equal(t.p.chips, 1300, 'mano doblada (200) y mano normal (100) ganan: +300');
    assert.equal(t.seat().delta, 300);
    assert.deepEqual(t.seat().hands.map((h) => h.result), ['win', 'win']);
    t.room.destroy();
  }

  // 2) No se puede dividir un par desigual y no se cobra nada
  {
    const t = await table([card('8', 'S'), card('6', 'D'), card('9', 'H'), card('10', 'C')]);
    assert.equal(t.bj.act(t.p.id, 'split'), 'Solo puedes dividir un par.');
    assert.equal(t.p.chips, 900);
    t.room.destroy();
  }

  // 3) Dividir ases: una carta por mano, y un 21 así NO es Blackjack
  {
    const t = await table([card('A', 'S'), card('5', 'D'), card('A', 'H'), card('6', 'C'), card('K', 'S'), card('9', 'D'), card('10', 'H')]);
    assert.equal(t.bj.act(t.p.id, 'split'), undefined);
    await waitFor(() => t.phase() === 'payout', 'ases');
    const hs = t.seat().hands;
    assert.deepEqual(hs.map((h) => h.status), ['stand', 'stand'], 'con ases se planta solo');
    assert.deepEqual(hs.map((h) => h.result), ['push', 'lose'], 'A+K tras dividir (21) empata con el 21 del crupier y no cobra 3 a 2');
    assert.equal(t.p.chips, 900);
    t.room.destroy();
  }

  // 4) Seguro con Blackjack del crupier: el seguro (2 a 1) compensa la pérdida
  {
    const t = await table([card('9', 'S'), card('A', 'D'), card('7', 'H'), card('K', 'C')]);
    assert.equal(t.phase(), 'insurance', 'con un As a la vista se ofrece seguro');
    assert.equal(t.bj.insure(t.p, true), undefined);
    assert.equal(t.p.chips, 850, 'el seguro cuesta la mitad de la apuesta');
    await waitFor(() => t.phase() === 'payout', 'pago con seguro');
    assert.equal(t.p.chips, 1000, 'pierde 100, el seguro devuelve 150: neto 0');
    assert.equal(t.seat().delta, 0);
    t.room.destroy();
  }

  // 5) Seguro sin Blackjack del crupier: se pierde y la ronda sigue
  {
    const t = await table([card('10', 'S'), card('A', 'D'), card('9', 'H'), card('6', 'C')]);
    assert.equal(t.phase(), 'insurance');
    t.bj.insure(t.p, true);
    await waitFor(() => t.phase() === 'playing', 'continúa la ronda');
    assert.equal(t.bj.insure(t.p, true), 'Ahora no se ofrece seguro.');
    t.bj.act(t.p.id, 'stand');
    await waitFor(() => t.phase() === 'payout', 'pago sin Blackjack del crupier');
    assert.equal(t.p.chips, 1050, 'gana 100 de la mano y pierde 50 del seguro');
    t.room.destroy();
  }

  // 6) Rechazar el seguro no cuesta nada
  {
    const t = await table([card('10', 'S'), card('A', 'D'), card('9', 'H'), card('K', 'C')]);
    t.bj.insure(t.p, false);
    await waitFor(() => t.phase() === 'payout', 'sin seguro y con Blackjack del crupier');
    assert.equal(t.p.chips, 900, 'pierde solo la apuesta');
    t.room.destroy();
  }
  console.log('Blackjack avanzado OK (dividir, doblar tras dividir, ases, seguro)');
}

// ---------- Contenido de la fiesta ----------
{
  const MIN: Record<string, number> = { never: 55, likely: 50, would: 40, truth: 45, dare: 45 };
  const lists: Record<string, { text: string; level: number }[]> = {
    never: NEVER, likely: LIKELY, truth: TRUTHS, dare: DARES,
    would: WOULD.map((w) => ({ text: w.a + ' | ' + w.b, level: w.level })),
  };
  for (const [name, list] of Object.entries(lists)) {
    for (const level of [1, 2, 3]) {
      const n = list.filter((i) => i.level === level).length;
      assert.ok(n >= MIN[name], `${name} nivel ${level}: ${n} frases (mínimo ${MIN[name]})`);
    }
    const texts = list.map((i) => i.text.trim().toLowerCase());
    const dupes = texts.filter((t, i) => texts.indexOf(t) !== i);
    assert.deepEqual(dupes, [], `${name}: frases repetidas`);
  }
  assert.ok(NEVER.every((i) => i.text.startsWith('Yo nunca')), 'todas las frases de "yo nunca" empiezan igual');
  assert.ok(LIKELY.every((i) => i.text.endsWith('?')), '¿Quién es más probable?: todas acaban en ?');
  assert.ok(WOULD.every((w) => w.a !== w.b), 'preferirías: opciones distintas');
  assert.equal(Object.keys(KING_RULES).length, 13, 'una regla por cada carta del rey de copas');
  console.log(`Contenido OK (yo nunca ${NEVER.length}, probable ${LIKELY.length}, preferirías ${WOULD.length}, verdades ${TRUTHS.length}, retos ${DARES.length})`);
}

// ---------- Integración por WebSocket ----------
await import('./index');

class Client {
  ws: WebSocket;
  room!: RoomPublic;
  errors: string[] = [];
  slot?: Extract<ServerMsg, { t: 'sl:result' }>;
  reactions: { from: string; kind: string }[] = [];
  achievements: string[] = [];
  profile?: ProfilePublic;
  constructor(public pid: string, public name: string) {
    this.ws = new WebSocket('ws://localhost:3999/ws');
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMsg;
      if (m.t === 'state') this.room = m.room;
      else if (m.t === 'err') this.errors.push(m.msg);
      else if (m.t === 'sl:result') this.slot = m;
      else if (m.t === 'react') this.reactions.push({ from: m.from, kind: m.kind });
      else if (m.t === 'achievement') this.achievements.push(m.id);
      else if (m.t === 'profile') this.profile = m.profile;
    });
  }
  open() { return new Promise<void>((r) => this.ws.once('open', () => r())); }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  me() { return this.room.players.find((p) => p.id === this.pid)!; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, label: string, ms = 15_000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`Timeout esperando: ${label}`);
    await sleep(50);
  }
}

const a = new Client('player-aaaaaaaa', 'Ana');
const b = new Client('player-bbbbbbbb', 'Beto');
await Promise.all([a.open(), b.open()]);
a.send({ t: 'join', pid: a.pid, name: a.name });
await until(() => !!a.room, 'sala creada');
const code = a.room.code;
b.send({ t: 'join', pid: b.pid, name: b.name, code });
await until(() => b.room?.players.length === 2, 'segundo jugador');
assert.equal(a.room.players.find((p) => p.host)?.id, a.pid);
console.log(`Sala ${code} con 2 jugadores OK`);
await until(() => a.achievements.includes('first-night') && b.achievements.includes('first-night'), 'logro de bienvenida');

// Blackjack: ambos apuestan -> reparto automático
a.send({ t: 'bj:bet', amount: 100 });
b.send({ t: 'bj:bet', amount: 50 });
await until(() => a.room.blackjack.phase !== 'betting', 'reparto');
if (a.room.blackjack.phase === 'insurance') {
  // El crupier enseñó un As: se rechaza el seguro para seguir con la ronda de prueba
  a.send({ t: 'bj:insure', take: false });
  b.send({ t: 'bj:insure', take: false });
  await until(() => a.room.blackjack.phase !== 'insurance', 'fin de la oferta de seguro');
}
a.errors.length = 0;
b.errors.length = 0;
for (const seat of a.room.blackjack.seats) assert.equal(seat.hands[0].cards.length, 2);
assert.ok('hidden' in a.room.blackjack.dealer[1] || a.room.blackjack.phase === 'payout', 'carta oculta del crupier');
// Un jugador que no tiene el turno no puede actuar
{
  const turn = a.room.blackjack.turn;
  if (turn) {
    const other = turn === a.pid ? b : a;
    other.send({ t: 'bj:hit' });
    await until(() => other.errors.length > 0, 'rechazo fuera de turno');
  }
}
// Jugar: pedir hasta 17 o más
while (a.room.blackjack.phase === 'playing') {
  const turn = a.room.blackjack.turn;
  const c = turn === a.pid ? a : b;
  const seat = a.room.blackjack.seats.find((s) => s.id === turn);
  if (!seat) { await sleep(50); continue; }
  const total = seat.hands[seat.active].cards.reduce((n, card) => (('r' in card) ? n + (card.r === 'A' ? 11 : 'JQK'.includes(card.r) ? 10 : Number(card.r)) : n), 0);
  c.send({ t: total < 15 ? 'bj:hit' : 'bj:stand' });
  await sleep(120);
}
await until(() => a.room.blackjack.phase === 'payout', 'pago blackjack');
for (const seat of a.room.blackjack.seats) {
  const p = a.room.players.find((x) => x.id === seat.id)!;
  assert.equal(p.chips, 1000 + seat.delta!, `fichas de ${p.name} no cuadran con el resultado`);
  assert.ok(seat.hands.every((h) => h.result));
  assert.ok(!a.room.blackjack.dealer.some((c) => 'hidden' in c), 'crupier revelado al pagar');
}
console.log('Blackjack OK:', a.room.blackjack.seats.map((s) => `${s.id.slice(7, 8)}:${s.hands[0].result}(${s.delta})`).join(' '));
await until(() => a.room.blackjack.phase === 'betting', 'nueva ronda', 10_000);

// Cambiar de mesa: solo el anfitrión
b.errors.length = 0;
b.send({ t: 'game', game: 'roulette' });
await until(() => b.errors.length > 0, 'invitado no puede cambiar mesa');
a.send({ t: 'game', game: 'roulette' });
await until(() => a.room.game === 'roulette', 'cambio a ruleta');

// Ruleta: ronda completa
const before = a.me().chips;
a.send({ t: 'ro:bet', kind: 'red', amount: 100 });
a.send({ t: 'ro:bet', kind: 'straight', value: 7, amount: 10 });
a.send({ t: 'ro:bet', kind: 'straight', value: 99, amount: 10 }); // inválida
await until(() => a.room.roulette.bets[a.pid]?.length === 2, 'apuestas ruleta');
assert.equal(a.me().chips, before - 110);
a.send({ t: 'ro:undo' });
await until(() => a.room.roulette.bets[a.pid]?.length === 1, 'deshacer');
assert.equal(a.me().chips, before - 100);
await until(() => a.room.roulette.phase === 'spinning', 'giro', 25_000);
const n = a.room.roulette.result!;
assert.ok(n >= 0 && n <= 36);
await until(() => a.room.roulette.phase === 'result', 'resultado', 10_000);
const red = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(n);
assert.equal(a.me().chips, before + (red ? 100 : -100));
assert.equal(a.room.roulette.history[0], n);
console.log(`Ruleta OK: salió ${n} (${red ? 'rojo' : 'no rojo'})`);

// Repetir y doblar la apuesta
await until(() => a.room.roulette.phase === 'betting', 'nueva ronda de ruleta', 10_000);
assert.equal(a.room.roulette.lastTotals[a.pid], 100, 'recuerda la apuesta anterior');
const chipsBeforeRebet = a.me().chips;
b.errors.length = 0;
b.send({ t: 'ro:rebet' }); // B no apostó nada antes
await until(() => b.errors.length > 0, 'sin apuesta anterior no se puede repetir');
a.send({ t: 'ro:rebet' });
await until(() => a.room.roulette.bets[a.pid]?.length === 1, 'apuesta repetida');
assert.equal(a.me().chips, chipsBeforeRebet - 100);
a.errors.length = 0;
a.send({ t: 'ro:rebet' });
await until(() => a.errors.length > 0, 'no se repite encima de fichas ya puestas');
a.send({ t: 'ro:double' });
await until(() => a.room.roulette.bets[a.pid]?.length === 2, 'apuesta doblada');
assert.equal(a.me().chips, chipsBeforeRebet - 200);
a.send({ t: 'ro:clear' });
await until(() => !a.room.roulette.bets[a.pid], 'fichas retiradas');
assert.equal(a.me().chips, chipsBeforeRebet, 'quitar devuelve todo');
console.log('Ruleta: repetir y doblar OK');

// Tragaperras
a.send({ t: 'game', game: 'slots' });
await until(() => a.room.game === 'roulette' ? false : a.room.game === 'slots', 'cambio a tragaperras', 10_000).catch(async () => {
  await until(() => a.room.roulette.phase === 'betting', 'ruleta libre', 10_000);
  a.send({ t: 'game', game: 'slots' });
  await until(() => a.room.game === 'slots', 'cambio a tragaperras');
});
const c0 = a.me().chips;
a.send({ t: 'sl:spin', bet: 50 });
await until(() => !!a.slot, 'resultado tragaperras');
assert.equal(a.slot!.reels.length, 3);
await until(() => a.me().chips === c0 - 50 + a.slot!.win, 'premio acreditado', 5_000);
console.log(`Tragaperras OK: ${a.slot!.reels.join(' ')} → ${a.slot!.win}`);

// ---------- Póker por WebSocket ----------
{
  a.send({ t: 'game', game: 'poker' });
  await until(() => a.room.game === 'poker', 'cambio a póker', 10_000);
  const totalChips = () => a.me().chips + b.me().chips + a.room.poker.seats.reduce((n, s) => n + s.stack, 0);
  const before = a.me().chips + b.me().chips;

  a.send({ t: 'po:sit', buyin: 200 });
  b.send({ t: 'po:sit', buyin: 200 });
  await until(() => a.room.poker.seats.length === 2 && b.room.poker.seats.length === 2, 'dos sentados');
  assert.equal(totalChips(), before, 'sentarse no crea ni destruye fichas');

  // Mano 1: ciegas, cartas privadas, errores y retirada
  a.send({ t: 'po:ready' });
  b.send({ t: 'po:ready' });
  await until(() => a.room.poker.phase === 'preflop', 'mano 1 repartida');
  let pk = a.room.poker;
  assert.equal(pk.pot, 30, 'ciegas 10 + 20');
  assert.equal(pk.seats.reduce((n, s) => n + s.bet, 0), 30);
  const aSeat = (r: RoomPublic) => r.poker.seats.find((s) => s.id === a.pid)!;
  assert.ok(aSeat(a.room).cards.every((c) => 'r' in c), 'veo mis cartas');
  assert.ok(aSeat(b.room).cards.length === 2 && aSeat(b.room).cards.every((c) => 'hidden' in c), 'el rival no ve mis cartas');
  const actor = pk.toAct === a.pid ? a : b;
  const other = actor === a ? b : a;
  other.errors.length = 0;
  other.send({ t: 'po:act', action: 'check' });
  await until(() => other.errors.length > 0, 'acción fuera de turno rechazada');
  actor.errors.length = 0;
  actor.send({ t: 'po:act', action: 'raise', amount: 25 }); // por debajo de la subida mínima (40)
  await until(() => actor.errors.length > 0, 'subida mínima rechazada');
  assert.match(actor.errors[0], /mínima/);
  actor.send({ t: 'po:act', action: 'fold' });
  await until(() => a.room.poker.phase === 'showdown', 'fin de mano por retirada');
  assert.equal(totalChips(), before, 'tras la retirada se conservan las fichas');
  const deltas = a.room.poker.seats.map((s) => s.delta);
  assert.equal(deltas.reduce((n, d) => n! + (d ?? 0), 0), 0, 'deltas suman cero');
  assert.ok(a.room.poker.seats.every((s) => s.cards.every((c) => 'hidden' in c || s.id === a.pid)), 'sin enseñar cartas ajenas');
  await until(() => a.room.poker.phase === 'waiting', 'vuelta a espera', 10_000);
  console.log('Póker mano 1 OK (ciegas, privacidad, errores, retirada)');

  // Mano 2: all-in y runout hasta el showdown
  a.send({ t: 'po:ready' });
  b.send({ t: 'po:ready' });
  await until(() => a.room.poker.phase === 'preflop', 'mano 2 repartida');
  const first = a.room.poker.toAct === a.pid ? a : b;
  first.send({ t: 'po:act', action: 'raise', amount: 99999 });
  await until(() => a.room.poker.toAct !== first.pid && a.room.poker.toAct !== null, 'turno del rival');
  (first === a ? b : a).send({ t: 'po:act', action: 'call' });
  await until(() => a.room.poker.phase === 'showdown', 'runout hasta el showdown', 20_000);
  pk = a.room.poker;
  assert.equal(pk.board.length, 5, 'cinco cartas comunitarias');
  assert.ok(pk.seats.every((s) => s.cards.every((c) => 'r' in c)), 'all-in: se enseñan las cartas');
  assert.ok(pk.seats.every((s) => s.hand), 'nombres de mano');
  assert.equal(pk.seats.reduce((n, s) => n + (s.delta ?? 0), 0), 0);
  assert.equal(totalChips(), before, 'tras el all-in se conservan las fichas');
  await until(() => a.room.poker.phase === 'waiting', 'fin mano 2', 12_000);
  console.log('Póker mano 2 OK (all-in, runout, showdown)');

  // Cambiar de juego devuelve las fichas de la mesa
  a.send({ t: 'game', game: 'slots' });
  await until(() => a.room.game === 'slots', 'salir del póker');
  assert.equal(a.me().chips + b.me().chips, before, 'las fichas vuelven a los jugadores');
  console.log('Póker OK (cierre de mesa)');
}

// ---------- Fiesta por WebSocket ----------
{
  const setGame = async (game: GameId) => {
    a.send({ t: 'game', game });
    await until(() => a.room.game === game && b.room.game === game, `cambio a ${game}`, 10_000);
  };
  await setGame('party');
  const P = () => a.room.party;

  // Ajustes: solo el anfitrión
  b.errors.length = 0;
  b.send({ t: 'pa:level', level: 3 });
  await until(() => b.errors.length > 0, 'invitado no cambia el nivel');
  a.send({ t: 'pa:level', level: 3 });
  a.send({ t: 'pa:soft', soft: true });
  await until(() => P().level === 3 && P().soft, 'nivel y modo sin alcohol');

  // Yo nunca: respuestas ocultas hasta que contestan todos
  await setGame('never');
  b.errors.length = 0;
  b.send({ t: 'pa:next' });
  await until(() => b.errors.length > 0, 'solo el anfitrión pasa de ronda');
  a.send({ t: 'pa:next' });
  await until(() => P().phase === 'asking', 'ronda de yo nunca');
  assert.match(P().prompt!, /^Yo nunca/);
  a.send({ t: 'pa:answer', value: 'yes' });
  await until(() => b.room.party.answered.includes(a.pid), 'respuesta registrada');
  assert.equal(b.room.party.picks, null, 'no se revela antes de tiempo');
  assert.equal(b.room.party.mine, null, 'no veo la respuesta ajena');
  assert.equal(a.room.party.mine, 'yes');
  b.send({ t: 'pa:answer', value: 'no' });
  await until(() => P().phase === 'reveal', 'revelación automática');
  assert.deepEqual(P().drinkers, [a.pid]);
  assert.equal(P().tally[a.pid], 1);
  console.log('Fiesta: Yo nunca OK');

  // ¿Quién es más probable?: el más votado bebe
  await setGame('likely');
  a.send({ t: 'pa:next' });
  await until(() => P().phase === 'asking', 'ronda likely');
  assert.match(P().prompt!, /^¿Quién es más probable/);
  a.errors.length = 0;
  a.send({ t: 'pa:answer', value: 'no-existe' });
  await until(() => a.errors.length > 0, 'voto a un jugador inexistente');
  a.send({ t: 'pa:answer', value: b.pid });
  b.send({ t: 'pa:answer', value: b.pid });
  await until(() => P().phase === 'reveal', 'revelación likely');
  assert.deepEqual(P().drinkers, [b.pid]);
  console.log('Fiesta: ¿Quién es más probable? OK');

  // Preferirías: empate = nadie bebe
  await setGame('would');
  a.send({ t: 'pa:next' });
  await until(() => P().phase === 'asking' && !!P().options, 'ronda would');
  a.send({ t: 'pa:answer', value: 'A' });
  b.send({ t: 'pa:answer', value: 'B' });
  await until(() => P().phase === 'reveal', 'revelación would');
  assert.deepEqual(P().drinkers, [], 'empate: nadie bebe');
  console.log('Fiesta: Preferirías OK');

  // Verdad o reto
  await setGame('truth');
  a.send({ t: 'pa:next' });
  await until(() => P().phase === 'choose' && !!P().target, 'turno de verdad o reto');
  const tgt = P().target === a.pid ? a : b;
  const non = tgt === a ? b : a;
  non.errors.length = 0;
  non.send({ t: 'pa:answer', value: 'dare' });
  await until(() => non.errors.length > 0, 'solo responde quien está en el centro');
  tgt.send({ t: 'pa:answer', value: 'dare' });
  await until(() => P().phase === 'prompt' && P().kind === 'dare' && !!P().prompt, 'reto servido');
  tgt.send({ t: 'pa:answer', value: 'drink' });
  await until(() => P().phase === 'done' && P().resolved === 'drink', 'trago por pasar');
  assert.equal(P().tally[tgt.pid], 2, 'el marcador acumula los tragos de la noche (1 de antes + este)');
  console.log('Fiesta: Verdad o reto OK');

  // Rey de copas
  await setGame('kings');
  a.send({ t: 'pa:next' });
  await until(() => P().phase === 'ready' && !!P().target, 'rey de copas listo');
  const kt = P().target === a.pid ? a : b;
  kt.send({ t: 'pa:next' });
  await until(() => P().phase === 'prompt' && !!P().card && !!P().rule, 'carta con regla');
  kt.send({ t: 'pa:next' });
  await until(() => P().phase === 'ready' && P().target !== kt.pid, 'pasa el turno');
  console.log('Fiesta: Rey de copas OK');

  // Duelo de reflejos: adelantarse = trago; ranking por tiempo
  await setGame('reflex');
  a.send({ t: 'pa:next' });
  await until(() => P().phase === 'wait', 'duelo en espera');
  b.send({ t: 'pa:tap', ms: 0 });
  await until(() => P().answered.includes(b.pid), 'salida en falso registrada');
  await until(() => P().phase === 'go', '¡YA!', 10_000);
  a.send({ t: 'pa:tap', ms: 210 });
  await until(() => P().phase === 'reveal', 'resultado del duelo', 8_000);
  assert.equal(P().times![0].id, a.pid, 'a es el más rápido');
  assert.ok(P().times!.find((t) => t.id === b.pid)!.early);
  assert.deepEqual(P().drinkers, [b.pid], 'bebe quien se adelantó');
  console.log('Fiesta: Duelo de reflejos OK');

  // Reacciones: llegan a todos, se limitan si se spamean y se ignoran las inventadas
  a.send({ t: 'react', kind: 'laugh' });
  await until(() => b.reactions.some((r) => r.from === a.pid && r.kind === 'laugh'), 'reacción recibida');
  const before = b.reactions.length;
  a.send({ t: 'react', kind: 'laugh' });
  a.send({ t: 'react', kind: 'laugh' });
  a.send({ t: 'react', kind: 'inventada' as never });
  await sleep(400);
  assert.ok(b.reactions.length - before <= 1, 'las reacciones seguidas se limitan');
  assert.ok(!b.reactions.some((r) => r.kind === 'inventada'), 'una reacción inventada no llega');
  console.log('Fiesta: Reacciones OK');

  // Pantalla compartida: mira, no juega
  {
    const openScreen = (pid: string) => new Promise<{ ws: WebSocket; last: () => RoomPublic | null; msgs: ServerMsg[]; closed: () => boolean }>((resolve) => {
      const ws = new WebSocket('ws://localhost:3999/ws');
      let last: RoomPublic | null = null;
      const msgs: ServerMsg[] = [];
      let closed = false;
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString()) as ServerMsg;
        msgs.push(m);
        if (m.t === 'state') last = m.room;
      });
      ws.on('close', () => (closed = true));
      ws.on('open', () => {
        ws.send(JSON.stringify({ t: 'join', pid, name: 'Pantalla', code: a.room.code, screen: true }));
        resolve({ ws, last: () => last, msgs, closed: () => closed });
      });
    });
    const tv = await openScreen('screen-test-0001');
    await until(() => !!tv.last(), 'la pantalla recibe el estado');
    assert.equal(tv.last()!.players.length, 2, 'la pantalla no cuenta como jugador');
    assert.equal(a.room.players.length, 2);
    // Una pantalla no puede actuar
    tv.ws.send(JSON.stringify({ t: 'game', game: 'party' }));
    tv.ws.send(JSON.stringify({ t: 'react', kind: 'laugh' }));
    await sleep(300);
    assert.equal(a.room.game, 'reflex', 'una pantalla no cambia de juego');
    // Recibe las reacciones y los cambios
    b.send({ t: 'react', kind: 'heart' });
    await until(() => tv.msgs.some((m) => m.t === 'react' && m.kind === 'heart'), 'la pantalla ve las reacciones');
    // Con la mesa cerrada: una pantalla nueva no entra, la que ya estaba sí puede volver
    a.send({ t: 'room:lock', locked: true });
    await until(() => a.room.locked, 'mesa cerrada');
    const stranger = await openScreen('screen-test-0002');
    await sleep(300);
    assert.ok(stranger.msgs.some((m) => m.t === 'err' && /cerrada/.test(m.msg)), 'pantalla nueva rechazada con la mesa cerrada');
    tv.ws.terminate();
    await sleep(200);
    const tv2 = await openScreen('screen-test-0001');
    await until(() => !!tv2.last(), 'la pantalla conocida vuelve aunque esté cerrada');
    a.send({ t: 'room:lock', locked: false });
    await until(() => !a.room.locked, 'mesa abierta');
    tv2.ws.terminate();
    stranger.ws.terminate();
    console.log('Fiesta: Pantalla compartida OK');
  }

  // Perfil y logros (acumulan entre mesas)
  a.send({ t: 'profile:get' });
  await until(() => !!a.profile, 'perfil');
  assert.ok(a.profile!.nights >= 1, 'cuenta las mesas');
  assert.ok(a.profile!.rounds >= 8, `rondas del perfil: ${a.profile!.rounds}`);
  assert.equal(a.profile!.bestReflex, 210, 'mejor tiempo de reflejos guardado');
  assert.equal(a.profile!.drinks, a.room.party.tally[a.pid] ?? 0, 'los tragos del perfil coinciden con el marcador');
  assert.ok(a.profile!.achievements.includes('first-night'));
  assert.ok(a.profile!.achievements.includes('lightning'), '210 ms baja de 250: logro Dedos de rayo');
  console.log('Fiesta: Perfil OK');

  // Estadísticas de la noche
  const stats = a.room.stats;
  assert.ok(stats.rounds >= 10, `rondas contadas: ${stats.rounds}`);
  const sa = stats.players.find((p) => p.id === a.pid)!;
  assert.equal(sa.bestReflex, 210, 'mejor tiempo de reflejos');
  assert.equal(sa.drinks, a.room.party.tally[a.pid] ?? 0, 'los tragos coinciden con el marcador');
  assert.ok(stats.players.every((p) => p.worth >= 0 && Number.isFinite(p.worth)));
  assert.ok(stats.startedAt <= Date.now());
  console.log(`Fiesta: Estadísticas OK (${stats.rounds} rondas)`);

  await setGame('slots');
}

// ---------- Ludo por WebSocket ----------
{
  const lu = () => a.room.ludo;
  a.send({ t: 'game', game: 'ludo' });
  await until(() => a.room.game === 'ludo' && b.room.game === 'ludo', 'cambio a Ludo', 10_000);
  b.errors.length = 0;
  b.send({ t: 'lu:config', patch: { board: 6 } });
  await until(() => b.errors.length > 0, 'solo el anfitrión configura el Ludo');
  a.send({ t: 'lu:config', patch: { board: 6, bots: 2, turnSeconds: 0 } });
  await until(() => lu().options.board === 6 && lu().seats.length === 4, 'preparación del Ludo');
  assert.equal(new Set(lu().seats.map((s) => s.arm)).size, 4, 'cada uno con su color');
  b.errors.length = 0;
  b.send({ t: 'lu:start' });
  await until(() => b.errors.length > 0, 'solo el anfitrión empieza');
  a.send({ t: 'lu:start' });
  await until(() => lu().phase === 'playing' && b.room.ludo.phase === 'playing', 'empieza el Ludo');
  a.errors.length = 0;
  a.send({ t: 'game', game: 'slots' });
  await until(() => a.errors.length > 0, 'no se cambia de juego con una partida de Ludo en curso');

  // Las dos personas juegan lo que les toca (primer peón posible) mientras los bots juegan solos.
  const play = (c: Client) => {
    const l = c.room.ludo;
    const t = l.turn;
    if (l.phase !== 'playing' || t?.playerId !== c.pid) return;
    if (t.step === 'roll') c.send({ t: 'lu:roll' });
    else if (t.step === 'move') c.send({ t: 'lu:move', pawn: t.movable[0]! });
  };
  await until(() => { play(a); play(b); return lu().seq >= 80 || lu().phase === 'finished'; }, 'se juegan 80 eventos de Ludo', 60_000);
  const seats = lu().seats;
  assert.ok(seats.every((s) => s.pawns.length === 4 && s.pawns.every((p) => p >= 0)));
  assert.ok(lu().events.length > 0 && lu().events.length <= 14, 'solo se guardan los últimos eventos');
  assert.deepEqual(a.room.ludo.seats, b.room.ludo.seats, 'todos ven el mismo tablero');

  a.send({ t: 'lu:reset' });
  await until(() => lu().phase === 'setup', 'el anfitrión cancela la partida');
  a.send({ t: 'game', game: 'slots' });
  await until(() => a.room.game === 'slots' && b.room.game === 'slots', 'salir del Ludo', 10_000);
  console.log('Ludo OK');
}

// Reconexión con el mismo pid conserva fichas
const chipsBeforeReconnect = a.me().chips;
const a2 = new Client(a.pid, a.name);
await a2.open();
a2.send({ t: 'join', pid: a.pid, name: a.name, code });
await until(() => !!a2.room, 'reconexión');
assert.equal(a2.me().chips, chipsBeforeReconnect);
console.log('Reconexión OK');

console.log('\nTODO OK');
process.exit(0);
