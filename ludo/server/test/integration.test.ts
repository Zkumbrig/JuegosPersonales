import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import type { ClientMsg, RoomInfo, ServerMsg } from '../src/shared/protocol';

const PORT = 39_000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let proc: ChildProcess;

class Client {
  ws: WebSocket;
  msgs: ServerMsg[] = [];
  constructor() {
    this.ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    this.ws.on('message', (d) => this.msgs.push(JSON.parse(d.toString())));
  }
  open() { return this.ws.readyState === WebSocket.OPEN ? Promise.resolve() : once(this.ws, 'open'); }
  send(m: ClientMsg | string) { this.ws.send(typeof m === 'string' ? m : JSON.stringify(m)); }
  async waitFor<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, ms = 3000) {
    const start = Date.now();
    for (;;) {
      const m = this.msgs.find((x): x is Extract<ServerMsg, { t: T }> => x.t === t && pred(x as never));
      if (m) return m;
      if (Date.now() - start > ms) throw new Error(`timeout esperando ${t}: ${JSON.stringify(this.msgs.slice(-3))}`);
      await new Promise((r) => setTimeout(r, 15));
    }
  }
  close() { this.ws.close(); }
}

before(async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  proc = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), CLIENT_DIR: path.join(root, 'test') },
    stdio: 'ignore',
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch { /* aún arrancando */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('el servidor no arrancó');
});
after(() => { proc?.kill('SIGKILL'); });

test('flujo completo: crear sala, unirse con el código, configurar, bots, jugar y reconectar', async () => {
  const host = new Client();
  await host.open();
  host.send({ t: 'create', name: 'Lucía' });
  const w = await host.waitFor('welcome');
  const code = w.room.code;
  assert.match(code, /^[A-Z2-9]{5}$/);
  assert.equal(w.room.hostId, w.you.id);
  assert.equal(w.you.role, 'player');

  // La API REST dice que la sala existe y se puede entrar.
  const info = (await (await fetch(`${BASE}/api/rooms/${code.toLowerCase()}`)).json()) as RoomInfo;
  assert.equal(info.code, code);
  assert.equal(info.host, 'Lucía');
  assert.equal(info.joinable, true);
  assert.equal((await fetch(`${BASE}/api/rooms/ZZZZZ`)).status, 404);

  // Otra persona entra con el código (en minúsculas y con guion, como lo escribiría alguien).
  const guest = new Client();
  await guest.open();
  guest.send({ t: 'join', code: `${code.slice(0, 2)}-${code.slice(2)}`.toLowerCase(), name: 'Marcos' });
  const gw = await guest.waitFor('welcome');
  assert.equal(gw.room.players.length, 2);
  assert.notEqual(gw.you.id, w.you.id);
  await host.waitFor('state', (m) => m.room.players.length === 2);

  // El invitado no es líder: no puede configurar ni empezar.
  guest.send({ t: 'config', patch: { board: 8 } });
  assert.equal((await guest.waitFor('error')).code, 'not-host');

  host.send({ t: 'config', patch: { board: 6, turnSeconds: 0 } });
  await guest.waitFor('state', (m) => m.room.options.board === 6);
  host.send({ t: 'bot', op: 'add' });
  await host.waitFor('state', (m) => m.room.players.length === 3);
  host.send({ t: 'start' });
  const started = await guest.waitFor('state', (m) => m.room.phase === 'playing');
  assert.ok(started.room.events.some((e) => e.type === 'start'));

  // Quien tiene el turno tira; todos reciben el evento del dado.
  const turnOf = started.room.turn!.playerId;
  const actor = turnOf === w.you.id ? host : turnOf === gw.you.id ? guest : null;
  if (actor) {
    actor.send({ t: 'roll' });
    const ev = await host.waitFor('state', (m) => m.room.events.some((e) => e.type === 'roll'));
    assert.ok(ev.room.events.find((e) => e.type === 'roll'));
  }

  // Basura y mensajes inválidos no tumban nada.
  guest.send('esto no es json');
  assert.equal((await guest.waitFor('error', (m) => m.code === 'bad-request')).t, 'error');
  guest.send({ t: 'move', pawn: 9 } as never);

  // Reconexión: se cae la conexión del invitado y vuelve con su token.
  guest.close();
  await host.waitFor('state', (m) => m.room.players.some((p) => p.id === gw.you.id && !p.connected));
  const back = new Client();
  await back.open();
  back.send({ t: 'resume', code, token: gw.you.token });
  const again = await back.waitFor('welcome');
  assert.equal(again.you.id, gw.you.id);
  assert.equal(again.room.phase, 'playing');

  // Un token falso no entra.
  const intruder = new Client();
  await intruder.open();
  intruder.send({ t: 'resume', code, token: 'nope' });
  assert.equal((await intruder.waitFor('error')).code, 'not-found');

  // Un tercero que llega con la partida empezada solo mira.
  const spec = new Client();
  await spec.open();
  spec.send({ t: 'join', code, name: 'Mirón' });
  assert.equal((await spec.waitFor('welcome')).you.role, 'spectator');
  spec.send({ t: 'roll' });
  assert.equal((await spec.waitFor('error')).code, 'illegal');

  for (const c of [host, back, intruder, spec]) c.close();
});

test('una sala con código inexistente da error claro y la sala vacía desaparece', async () => {
  const c = new Client();
  await c.open();
  c.send({ t: 'join', code: 'QQQQQ', name: 'X' });
  assert.equal((await c.waitFor('error')).code, 'not-found');
  c.send({ t: 'create', name: 'Solo' });
  const code = (await c.waitFor('welcome')).room.code;
  c.send({ t: 'leave' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await fetch(`${BASE}/api/rooms/${code}`)).status, 404);
  c.close();
});
