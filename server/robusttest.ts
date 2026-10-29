// Pruebas de robustez: arranca servidores reales como procesos aparte y los maltrata.
//   npm run test:robust
process.env.POKER = '1'; // estas pruebas ejercitan el póker y las tragaperras, que por defecto están ocultos
process.env.SLOTS = '1';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import type { ClientMsg, ProfilePublic, RoomPublic, ServerMsg } from '../shared/protocol';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX = require.resolve('tsx/cli');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(pred: () => boolean, label: string, ms = 8000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`Timeout esperando: ${label}`);
    await sleep(40);
  }
}

// ---------- Servidor ----------
interface Srv { proc: ChildProcess; port: number; exited: () => boolean; log: () => string; stop: () => Promise<void> }
async function startServer(port: number, env: Record<string, string> = {}): Promise<Srv> {
  const proc = spawn(process.execPath, [TSX, 'server/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_FILE: path.join(os.tmpdir(), `royale-robust-${port}-none.json`), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  let done = false;
  proc.stdout!.on('data', (d) => (log += d));
  proc.stderr!.on('data', (d) => (log += d));
  proc.on('exit', () => (done = true));
  await until(() => log.includes('escuchando'), `servidor :${port}`, 15_000);
  return {
    proc, port, exited: () => done, log: () => log,
    stop: async () => { proc.kill('SIGKILL'); await until(() => done, 'parada', 5000); },
  };
}

// ---------- Cliente ----------
class Client {
  ws!: WebSocket;
  room: RoomPublic | null = null;
  errors: string[] = [];
  kicked = false;
  profile: ProfilePublic | null = null;
  closeCode: number | null = null;
  states = 0;
  constructor(public pid: string, public name: string, private port: number) {}
  async connect(code?: string) {
    this.ws = new WebSocket(`ws://localhost:${this.port}/ws`);
    this.ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString()) as ServerMsg;
      if (m.t === 'state') { this.room = m.room; this.states++; }
      else if (m.t === 'err') this.errors.push(m.msg);
      else if (m.t === 'kicked') this.kicked = true;
      else if (m.t === 'profile') this.profile = m.profile;
    });
    this.ws.on('close', (c) => (this.closeCode = c));
    await new Promise<void>((r) => this.ws.once('open', () => r()));
    this.ws.send(JSON.stringify({ t: 'join', pid: this.pid, name: this.name, code }));
  }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  me() { return this.room?.players.find((p) => p.id === this.pid); }
}
const pid = (n: string) => `robust-${n}-`.padEnd(14, 'x');

// =====================================================================
// 1) Datos basura + inundación + tope de intentos de código
// =====================================================================
{
  const srv = await startServer(3991, { JOIN_FAILS_MAX: '5' });
  const a = new Client(pid('A'), 'Ana', srv.port);
  await a.connect();
  await until(() => !!a.room, 'sala creada');
  const code = a.room!.code;
  const b = new Client(pid('B'), 'Beto', srv.port);
  await b.connect(code);
  await until(() => b.room?.players.length === 2, 'segundo jugador');

  const junk = [
    'no es json', '[]', 'null', '42', '{"t":5}', '{"t":"bj:bet","amount":"1e9"}', '{"t":"bj:bet","amount":-5}',
    '{"t":"ro:bet","kind":{"a":1},"amount":10}', '{"t":"po:sit","buyin":"500"}', '{"t":"po:act","action":{"x":1}}',
    '{"t":"pa:level","level":{}}', '{"t":"pa:answer","value":{"x":1}}', '{"t":"pa:tap","ms":"abc"}',
    '{"t":"game","game":"__proto__"}', '{"t":"room:kick","pid":{"a":1}}', '{"t":"room:lock","locked":"x"}',
    '{"t":"join","name":{"a":1},"pid":"zzzzzzzzzz"}', '{"t":"sl:spin","bet":1e308}',
  ];
  for (const j of junk) { a.ws.send(j); b.ws.send(j); }
  await sleep(400);
  assert.equal(srv.exited(), false, 'sobrevive a mensajes malformados');
  const health = await fetch(`http://localhost:${srv.port}/healthz`);
  assert.equal(health.status, 200, '/healthz responde para el monitor de la plataforma');
  console.log('Robustez 1/6: datos basura OK');

  // Inundación: 5000 ajustes válidos que, sin límite, serían 5000 difusiones
  a.send({ t: 'game', game: 'party' });
  await until(() => a.room?.game === 'party', 'zona fiesta');
  const before = b.states;
  for (let i = 0; i < 5000; i++) a.send({ t: 'pa:soft', soft: i % 2 === 0 });
  await until(() => a.closeCode !== null, 'el servidor corta al que inunda', 6000);
  assert.equal(a.closeCode, 1008, 'se corta por ritmo excesivo');
  assert.ok(b.states - before < 200, `difusiones recibidas por el otro jugador: ${b.states - before} (sin límite serían ~5000)`);
  assert.equal(srv.exited(), false);
  console.log(`Robustez 2/6: inundación frenada (${b.states - before} difusiones de 5000, conexión cortada con 1008)`);

  // El otro jugador sigue pudiendo jugar
  b.send({ t: 'game', game: 'blackjack' }); // no es anfitrión: debe responder con error, no colgarse
  await until(() => b.errors.length > 0, 'el servidor sigue respondiendo');

  // Fuerza bruta de códigos: 5 fallos y se bloquea la IP
  const c = new Client(pid('C'), 'Cris', srv.port);
  await c.connect('AAAA');
  for (const wrong of ['AAAB', 'AAAC', 'AAAD', 'AAAE', 'AAAF']) c.send({ t: 'join', pid: c.pid, name: 'Cris', code: wrong });
  await sleep(300);
  c.send({ t: 'join', pid: c.pid, name: 'Cris', code }); // código bueno, pero la IP ya está bloqueada
  await until(() => c.errors.some((e) => /Demasiados intentos/.test(e)), 'bloqueo por fuerza bruta');
  assert.equal(c.room, null, 'no se le deja entrar mientras está bloqueado');
  console.log('Robustez 3/6: fuerza bruta de códigos bloqueada');
  await srv.stop();
}

// =====================================================================
// 2) Anfitrión que se cae + expulsar + cerrar mesa
// =====================================================================
{
  const srv = await startServer(3992, { HOST_GRACE_MS: '1200' });
  const a = new Client(pid('A'), 'Ana', srv.port);
  await a.connect();
  await until(() => !!a.room, 'sala');
  const code = a.room!.code;
  const b = new Client(pid('B'), 'Beto', srv.port);
  await b.connect(code);
  await until(() => b.room?.players.length === 2, 'B dentro');
  assert.equal(b.me()!.host, false);

  a.ws.terminate(); // el móvil del anfitrión se queda sin batería
  await until(() => b.me()?.host === true, 'el mando pasa a otro jugador', 6000);
  assert.ok(b.room!.feed.some((f) => /anfitrión/.test(f.text)), 'se avisa en el marcador');
  console.log('Robustez 4/6: traspaso de anfitrión OK');

  // Ana vuelve: sigue en la mesa, pero ya no manda
  const a2 = new Client(a.pid, 'Ana', srv.port);
  await a2.connect(code);
  await until(() => !!a2.me(), 'Ana vuelve');
  assert.equal(a2.me()!.host, false);
  assert.equal(a2.me()!.chips, 1000, 'conserva sus fichas');

  // Solo el anfitrión (ahora B) puede expulsar o cerrar
  a2.errors.length = 0;
  a2.send({ t: 'room:kick', pid: b.pid });
  a2.send({ t: 'room:lock', locked: true });
  await until(() => a2.errors.length >= 2, 'un invitado no puede expulsar ni cerrar');

  b.send({ t: 'room:lock', locked: true });
  await until(() => b.room?.locked === true, 'mesa cerrada');
  const d = new Client(pid('D'), 'Dani', srv.port);
  await d.connect(code);
  await until(() => d.errors.some((e) => /cerrada/.test(e)), 'entrada nueva rechazada');
  assert.equal(d.room, null);
  // Quien ya estaba puede reconectar aunque esté cerrada
  a2.ws.terminate();
  const a3 = new Client(a.pid, 'Ana', srv.port);
  await a3.connect(code);
  await until(() => !!a3.me(), 'Ana reconecta con la mesa cerrada');

  b.send({ t: 'room:lock', locked: false });
  await until(() => b.room?.locked === false, 'mesa abierta');
  const d2 = new Client(pid('D'), 'Dani', srv.port);
  await d2.connect(code);
  await until(() => !!d2.me(), 'Dani entra');

  b.send({ t: 'room:kick', pid: d2.pid });
  await until(() => d2.kicked, 'Dani recibe la expulsión');
  await until(() => !b.room!.players.some((p) => p.id === d2.pid), 'sale de la lista');
  const d3 = new Client(d2.pid, 'Dani', srv.port);
  await d3.connect(code);
  await until(() => d3.errors.some((e) => /expulsado/.test(e)), 'no puede volver a entrar');
  console.log('Robustez 5/6: expulsar y cerrar mesa OK');
  await srv.stop();
}

// =====================================================================
// 3) Corte brusco del servidor: las mesas vuelven con sus fichas
// =====================================================================
{
  const file = path.join(os.tmpdir(), `royale-robust-persist-${Date.now()}.json`);
  const env = { DATA_FILE: file, PERSIST_MS: '250' };
  let srv = await startServer(3993, env);
  const a = new Client(pid('A'), 'Ana', srv.port);
  await a.connect();
  await until(() => !!a.room, 'sala');
  const code = a.room!.code;
  const b = new Client(pid('B'), 'Beto', srv.port);
  await b.connect(code);
  await until(() => b.room?.players.length === 2, 'B dentro');

  // Póker a mitad de mano: hay fichas en la mesa y ciegas puestas
  a.send({ t: 'game', game: 'poker' });
  await until(() => a.room?.game === 'poker', 'póker');
  a.send({ t: 'po:sit', buyin: 500 });
  b.send({ t: 'po:sit', buyin: 200 });
  await until(() => a.room!.poker.seats.length === 2, 'sentados');
  a.send({ t: 'po:ready' });
  b.send({ t: 'po:ready' });
  await until(() => a.room!.poker.phase === 'preflop', 'mano en curso');
  assert.equal(a.me()!.chips, 500, 'en la cartera quedan 500');
  await sleep(900); // da tiempo a la copia periódica

  await srv.stop(); // corte brusco, sin apagado limpio
  assert.ok(fs.existsSync(file), 'existe la copia en disco');
  a.ws.terminate(); b.ws.terminate();

  srv = await startServer(3993, env);
  assert.match(srv.log(), /Recuperadas 1 mesa/);
  const a2 = new Client(a.pid, 'Ana', srv.port);
  await a2.connect(code);
  await until(() => !!a2.me(), 'Ana vuelve a su mesa');
  assert.equal(a2.me()!.chips, 1000, 'recupera todas sus fichas (cartera + mesa + ciegas)');
  assert.equal(a2.me()!.host, true, 'sigue siendo anfitriona');
  const beto = a2.room!.players.find((p) => p.id === b.pid)!;
  assert.equal(beto.chips, 1000, 'Beto también conserva las suyas');
  assert.equal(beto.connected, false, 'Beto aún no ha vuelto');
  assert.equal(a2.room!.poker.phase, 'waiting', 'la mano interrumpida queda anulada');
  console.log('Robustez 6/6: mesa recuperada tras un corte brusco (fichas intactas)');

  // El perfil (mesas jugadas y logros) también sobrevive
  a2.send({ t: 'profile:get' });
  await until(() => !!a2.profile, 'perfil recuperado');
  assert.ok(a2.profile!.nights >= 1, 'recuerda las mesas jugadas');
  assert.ok(a2.profile!.achievements.includes('first-night'), 'recuerda los logros');
  console.log('Robustez: perfil recuperado tras el corte');

  // Los ajustes de fiesta también sobreviven
  a2.send({ t: 'game', game: 'party' });
  await until(() => a2.room?.game === 'party', 'fiesta');
  a2.send({ t: 'pa:level', level: 3 });
  a2.send({ t: 'pa:soft', soft: true });
  await until(() => a2.room!.party.level === 3 && a2.room!.party.soft, 'ajustes');
  await sleep(900);
  await srv.stop();
  srv = await startServer(3993, env);
  const a3 = new Client(a.pid, 'Ana', srv.port);
  await a3.connect(code);
  await until(() => !!a3.me(), 'segunda recuperación');
  assert.equal(a3.room!.game, 'party');
  assert.equal(a3.room!.party.level, 3);
  assert.equal(a3.room!.party.soft, true);
  console.log('Robustez: ajustes de fiesta recuperados');
  await srv.stop();
  fs.rmSync(file, { force: true });
  fs.rmSync(file.replace(/\.json$/, '') + '.profiles.json', { force: true });
}

console.log('\nROBUSTEZ OK');
process.exit(0);
