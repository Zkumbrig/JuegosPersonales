import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, RoomError } from '../src/room';
import { chooseMove } from '../src/ai';
import { BOARDS, type BoardSize, type RoomView } from '../src/shared/protocol';
import { finalPos, safeCells, trackCell } from '../src/shared/rules';
import { FakeConn, VirtualTime, ZERO_TIMING } from './helpers';

function mk(opts: { dice?: () => number } = {}) {
  const vt = new VirtualTime();
  const room = new Room('ABCDE', { timing: ZERO_TIMING, schedule: vt.schedule, now: vt.now, dice: opts.dice });
  return { vt, room };
}
const err = (fn: () => void) => {
  try {
    fn();
  } catch (e) {
    return e instanceof RoomError ? e.code : 'other';
  }
  return null;
};

// Acceso a las entrañas para colocar fichas a mano en los tests.
interface Internals {
  players: { id: string; pawns: number[]; arm: number; auto: boolean }[];
  turn: { seat: number; dice: number };
}
const inner = (room: Room) => room as unknown as Internals;

test('el primero que entra es el líder; completada la sala, el siguiente es espectador', () => {
  const { room } = mk();
  const conns = Array.from({ length: 5 }, () => new FakeConn());
  const ids = conns.map((c, i) => room.join(`J${i}`, c));
  assert.equal(room.hostId, ids[0]!.id);
  assert.deepEqual(ids.map((y) => y.role), ['player', 'player', 'player', 'player', 'spectator']);
  const v = conns[4]!.lastRoom();
  assert.equal(v.players.length, 4);
  assert.equal(v.spectators, 1);
});

test('nombres repetidos se distinguen', () => {
  const { room } = mk();
  room.join('Ana', new FakeConn());
  room.join('ana', new FakeConn());
  room.join('Ana', new FakeConn());
  assert.deepEqual(room.view().players.map((p) => p.name), ['Ana', 'ana 2', 'Ana 3']);
});

test('solo el líder configura; no se puede achicar el tablero por debajo de los jugadores', () => {
  const { room } = mk();
  const a = room.join('A', new FakeConn());
  const b = room.join('B', new FakeConn());
  room.join('C', new FakeConn());
  assert.equal(err(() => room.handle(b.id, { t: 'config', patch: { board: 8 } })), 'not-host');
  room.handle(a.id, { t: 'config', patch: { board: 8 } });
  assert.equal(room.options.board, 8);
  assert.equal(err(() => room.handle(a.id, { t: 'config', patch: { turnSeconds: 7 } })), 'bad-request');
  room.handle(a.id, { t: 'config', patch: { board: 4, towers: true } });
  assert.equal(room.options.towers, true);
  room.join('D', new FakeConn());
  assert.equal(err(() => room.handle(a.id, { t: 'config', patch: { board: 6 } })), null);
  room.handle(a.id, { t: 'config', patch: { board: 8 } });
  room.join('E', new FakeConn());
  assert.equal(err(() => room.handle(a.id, { t: 'config', patch: { board: 4 } })), 'illegal');
});

test('al cambiar el tablero se reparten los brazos y no se repiten', () => {
  const { room } = mk();
  const a = room.join('A', new FakeConn());
  for (const n of ['B', 'C']) room.join(n, new FakeConn());
  for (const board of BOARDS) {
    room.handle(a.id, { t: 'config', patch: { board } });
    const arms = room.view().players.map((p) => p.arm);
    assert.equal(new Set(arms).size, arms.length);
    assert.ok(arms.every((x) => x < board));
  }
});

test('bots: el líder los añade y quita; no se puede empezar con un solo jugador', () => {
  const { room } = mk();
  const a = room.join('A', new FakeConn());
  assert.equal(err(() => room.handle(a.id, { t: 'start' })), 'illegal');
  room.handle(a.id, { t: 'bot', op: 'add' });
  assert.equal(room.view().players.length, 2);
  const bot = room.view().players.find((p) => p.bot)!;
  room.handle(a.id, { t: 'bot', op: 'remove', id: bot.id });
  assert.equal(room.view().players.length, 1);
});

test('el liderazgo pasa a otra persona cuando el líder sale', () => {
  const { room } = mk();
  const a = room.join('A', new FakeConn());
  const b = room.join('B', new FakeConn());
  room.leave(a.id);
  assert.equal(room.hostId, b.id);
  assert.equal(room.view().players.length, 1);
});

test('si el líder pierde la conexión, tras un rato el mando pasa a otro conectado; y puede volver', () => {
  const { room, vt } = mk();
  const ca = new FakeConn();
  const a = room.join('A', ca);
  const b = room.join('B', new FakeConn());
  room.disconnect(a.id, ca);
  vt.run(10, () => room.hostId === b.id);
  assert.equal(room.hostId, b.id);
  assert.ok(room.resume(a.token, new FakeConn()));
  assert.equal(room.hostId, b.id); // vuelve como jugador normal
});

test('quien se desconecta en la sala de espera y no vuelve deja su lugar; en partida lo conserva', () => {
  const { room, vt } = mk();
  const a = room.join('A', new FakeConn());
  const cb = new FakeConn();
  const b = room.join('B', cb);
  room.disconnect(b.id, cb);
  vt.run();
  assert.deepEqual(room.view().players.map((p) => p.name), ['A']);
  // En partida el asiento se conserva (puede volver).
  const cc = new FakeConn();
  const c = room.join('C', cc);
  room.handle(a.id, { t: 'start' });
  room.disconnect(c.id, cc);
  vt.run(1000);
  assert.ok(room.view().players.some((p) => p.id === c.id));
});

test('reconectar con el token recupera el asiento y cierra la conexión anterior', () => {
  const { room } = mk();
  const c1 = new FakeConn();
  const a = room.join('A', c1);
  room.join('B', new FakeConn());
  const c2 = new FakeConn();
  const again = room.resume(a.token, c2)!;
  assert.equal(again.id, a.id);
  assert.equal(c1.closed, true);
  assert.equal(room.resume('token-falso', new FakeConn()), null);
  room.disconnect(a.id, c1); // la conexión vieja se cae después: no debe afectar a la nueva
  assert.equal(room.view().players[0]!.connected, true);
});

test('un espectador puede sentarse si queda hueco', () => {
  const { room } = mk();
  const a = room.join('A', new FakeConn());
  for (let i = 0; i < 3; i++) room.join(`J${i}`, new FakeConn());
  const s = room.join('Mirón', new FakeConn());
  assert.equal(s.role, 'spectator');
  assert.equal(err(() => room.handle(s.id, { t: 'sit' })), 'full');
  room.handle(a.id, { t: 'kick', id: room.view().players[1]!.id });
  room.handle(s.id, { t: 'sit' });
  assert.ok(room.view().players.some((p) => p.id === s.id));
});

// ---------- Partida ----------

function startGame(dice: () => number, names = ['A', 'B']) {
  const { room, vt } = mk({ dice });
  const conns = names.map(() => new FakeConn());
  const you = names.map((n, i) => room.join(n, conns[i]!));
  room.handle(you[0]!.id, { t: 'config', patch: { turnSeconds: 0 } });
  room.handle(you[0]!.id, { t: 'start' });
  return { room, vt, conns, you };
}

const current = (room: Room) => room.view().turn!;
const playerOf = (room: Room, id: string) => room.view().players.find((p) => p.id === id)!;

test('no se puede tirar fuera de turno ni mover antes de tirar; los espectadores solo miran', () => {
  const { room, you } = startGame(() => 3, ['A', 'B']);
  const spec = room.join('C', new FakeConn());
  assert.equal(spec.role, 'spectator');
  const t = current(room);
  const other = you.find((y) => y.id !== t.playerId)!;
  assert.equal(err(() => room.handle(other.id, { t: 'roll' })), 'not-your-turn');
  assert.equal(err(() => room.handle(t.playerId, { t: 'move', pawn: 0 })), 'phase');
  assert.equal(err(() => room.handle(spec.id, { t: 'roll' })), 'illegal');
});

test('sin un 6 los peones siguen en casa y el turno pasa; con un 6 se saca peón y se repite turno', () => {
  const seq = [3, 6, 4];
  let i = 0;
  const { room, vt } = startGame(() => seq[i++ % seq.length]!);
  const first = current(room).playerId;
  room.handle(first, { t: 'roll' }); // 3: nada que mover
  assert.equal(current(room).step, 'wait');
  vt.run();
  const second = current(room).playerId;
  assert.notEqual(second, first);
  assert.equal(current(room).step, 'roll');
  room.handle(second, { t: 'roll' }); // 6: puede sacar un peón
  assert.equal(current(room).step, 'move');
  assert.deepEqual(current(room).movable, [0, 1, 2, 3]);
  room.handle(second, { t: 'move', pawn: 2 });
  assert.equal(playerOf(room, second).pawns[2], 1);
  assert.equal(current(room).playerId, second, 'el 6 da otra tirada');
  assert.equal(current(room).step, 'roll');
});

test('tres seises seguidos pierden el turno', () => {
  const { room, vt } = startGame(() => 6);
  const first = current(room).playerId;
  room.handle(first, { t: 'roll' });
  vt.run(50, () => current(room).step === 'roll'); // los 4 peones en casa son una sola jugada: se mueve solo
  assert.equal(current(room).sixes, 1);
  room.handle(first, { t: 'roll' });
  room.handle(first, { t: 'move', pawn: 0 }); // ya hay un peón en juego: ahora hay dos jugadas distintas
  assert.equal(current(room).sixes, 2);
  assert.equal(current(room).playerId, first);
  room.handle(first, { t: 'roll' }); // tercer 6
  assert.equal(current(room).step, 'wait');
  vt.run(50, () => current(room).playerId !== first);
  assert.notEqual(current(room).playerId, first);
  assert.equal(current(room).sixes, 0);
});

test('comer da otra tirada y manda el peón rival a casa', () => {
  const rolls: number[] = [];
  const { room, vt, you } = startGame(() => rolls.shift() ?? 1);
  const mineId = current(room).playerId;
  const theirId = you.find((y) => y.id !== mineId)!.id;
  const mine = inner(room).players.find((p) => p.id === mineId)!;
  const theirs = inner(room).players.find((p) => p.id === theirId)!;
  // Mi peón 0 en p=9; el rival está justo 4 casillas por delante.
  mine.pawns[0] = 9;
  const cell = trackCell(4, mine.arm, 13)!;
  assert.ok(!safeCells(4).has(cell), 'la casilla objetivo no es segura');
  theirs.pawns[1] = Array.from({ length: 51 }, (_, i) => i + 1).find((p) => trackCell(4, theirs.arm, p) === cell)!;
  rolls.push(4);
  room.handle(mineId, { t: 'roll' });
  assert.equal(current(room).step, 'move');
  room.handle(mineId, { t: 'move', pawn: 0 });
  vt.run(20, () => current(room).step === 'roll');
  assert.equal(playerOf(room, theirId).pawns[1], 0);
  assert.equal(playerOf(room, mineId).pawns[0], 13);
  assert.equal(current(room).playerId, mineId, 'repite por comer');
});

test('el tiempo agotado juega por el jugador y a la segunda lo pone en automático', () => {
  const { room, vt } = mk();
  const ca = new FakeConn();
  const a = room.join('A', ca);
  room.join('B', new FakeConn());
  room.handle(a.id, { t: 'config', patch: { turnSeconds: 20 } });
  room.handle(a.id, { t: 'start' });
  vt.run(20_000, () => room.view().players.some((p) => p.auto));
  assert.ok(room.view().players.some((p) => p.auto), 'alguien pasó a automático');
  const events = ca.msgs.flatMap((m) => (m.t === 'state' ? m.room.events : []));
  assert.ok(events.some((e) => e.type === 'roll'));
});

test('si el jugador del turno abandona, el turno pasa; si queda uno solo, gana', () => {
  const { room } = startGame(() => 2, ['A', 'B', 'C']);
  const t = current(room).playerId;
  room.leave(t);
  assert.notEqual(current(room).playerId, t);
  assert.equal(room.view().phase, 'playing');
  room.leave(current(room).playerId);
  assert.equal(room.view().phase, 'finished');
  assert.equal(room.view().players.find((p) => !p.left)!.rank, 1);
});

test('quien se cae en su turno tiene un margen antes de que el servidor juegue por él', () => {
  const vt = new VirtualTime();
  const room = new Room('ABCDE', { timing: { ...ZERO_TIMING, reconnectGrace: 4000 }, schedule: vt.schedule, now: vt.now, dice: () => 3 });
  const ca = new FakeConn();
  const cb = new FakeConn();
  const a = room.join('A', ca);
  const b = room.join('B', cb);
  room.handle(a.id, { t: 'config', patch: { turnSeconds: 0 } });
  room.handle(a.id, { t: 'start' });
  // Que el turno sea de A (con 3 nadie puede salir de casa, así que pasa solo).
  if (room.view().turn!.playerId !== a.id) {
    room.handle(b.id, { t: 'roll' });
    vt.run(20, () => room.view().turn!.playerId === a.id);
  }
  assert.equal(room.view().turn!.playerId, a.id);
  assert.equal(room.view().turn!.step, 'roll');
  const rollsOfA = () =>
    cb.msgs.flatMap((m) => (m.t === 'state' ? m.room.events : [])).filter((e) => e.type === 'roll' && e.playerId === a.id).length;
  const before = rollsOfA();
  const t0 = vt.t;
  room.disconnect(a.id, ca);
  vt.run(50, () => rollsOfA() > before);
  assert.equal(rollsOfA(), before + 1, 'el servidor acabó tirando por A');
  assert.ok(vt.t - t0 >= 4000, 'pero no antes de terminar el margen (' + (vt.t - t0) + ' ms)');
});

test('quien abandona deja de recibir mensajes de la sala', () => {
  const { room } = mk({ dice: () => 2 });
  const ca = new FakeConn(), cb = new FakeConn();
  const a = room.join('A', ca);
  room.join('B', cb);
  room.handle(a.id, { t: 'start' });
  const before = ca.msgs.length;
  room.leave(a.id);
  assert.equal(ca.msgs.length, before);
  assert.equal(cb.lastRoom().phase, 'finished');
});

test('revancha: solo el líder, y devuelve a todos a la sala de espera', () => {
  const { room, you } = startGame(() => 2);
  const hostId = room.view().hostId!;
  const other = you.find((y) => y.id !== hostId)!;
  room.leave(current(room).playerId);
  assert.equal(room.view().phase, 'finished');
  const survivor = room.view().players.find((p) => !p.left)!;
  // Si sobrevive el líder, quien quedó no puede pedir revancha; si no, el mando ya pasó al superviviente.
  if (survivor.id !== room.view().hostId) assert.equal(err(() => room.handle(other.id, { t: 'rematch' })), 'not-host');
  room.handle(room.view().hostId!, { t: 'rematch' });
  assert.equal(room.view().phase, 'lobby');
  assert.ok(room.view().players.every((p) => p.pawns.every((x) => x === 0) && p.rank === null));
});

// ---------- Simulaciones completas ----------

function checkInvariants(v: RoomView) {
  const board = v.options.board;
  const FIN = finalPos(board);
  const occupied = new Map<number, Set<number>>(); // casilla -> brazos presentes
  for (const p of v.players) {
    assert.equal(p.pawns.length, 4);
    for (const x of p.pawns) {
      assert.ok(x >= 0 && x <= FIN, `progreso fuera de rango: ${x}`);
      const c = trackCell(board, p.arm, x);
      if (c !== null) {
        if (!occupied.has(c)) occupied.set(c, new Set());
        occupied.get(c)!.add(p.arm);
      }
    }
  }
  for (const [cell, arms] of occupied) {
    if (!safeCells(board).has(cell)) assert.equal(arms.size, 1, `rivales juntos en la casilla no segura ${cell}`);
  }
}

for (const board of BOARDS) {
  for (const count of [2, 3, board]) {
    test(`partida completa: tablero de ${board} con ${count} jugadores (hasta el último puesto)`, () => {
      const { room, vt } = mk();
      const a = room.join('Humano', new FakeConn());
      room.handle(a.id, { t: 'config', patch: { board: board as BoardSize, turnSeconds: 0, endAtFirst: false } });
      for (let i = 1; i < count; i++) room.handle(a.id, { t: 'bot', op: 'add' });
      room.handle(a.id, { t: 'start' });
      let guard = 0;
      while (room.view().phase === 'playing' && guard++ < 100_000) {
        const humanReady = () => {
          const v = room.view();
          return v.phase !== 'playing' || (v.turn?.playerId === a.id && v.turn.step !== 'wait');
        };
        vt.run(50_000, humanReady);
        const v = room.view();
        checkInvariants(v);
        if (v.phase !== 'playing') break;
        const t = v.turn!;
        if (t.step === 'roll') room.handle(a.id, { t: 'roll' });
        else if (t.step === 'move') {
          const s = inner(room);
          room.handle(a.id, { t: 'move', pawn: chooseMove(board, room.options, s.players, s.turn.seat, s.turn.dice, t.movable) });
        }
      }
      const v = room.view();
      assert.equal(v.phase, 'finished');
      assert.deepEqual(v.players.map((p) => p.rank).sort(), Array.from({ length: count }, (_, i) => i + 1));
      const winner = v.players.find((p) => p.rank === 1)!;
      assert.ok(winner.pawns.every((x) => x === finalPos(board)), 'el ganador tiene los 4 peones en la meta');
    });
  }
}

test('con "terminar al primero" acaba cuando alguien gana y completa la clasificación', () => {
  const { room, vt } = mk();
  const a = room.join('Humano', new FakeConn());
  room.handle(a.id, { t: 'config', patch: { turnSeconds: 20 } }); // el humano no responde: el tiempo juega por él
  for (let i = 0; i < 3; i++) room.handle(a.id, { t: 'bot', op: 'add' });
  room.handle(a.id, { t: 'start' });
  vt.run(100_000, () => room.view().phase === 'finished');
  const v = room.view();
  assert.equal(v.phase, 'finished');
  assert.deepEqual(v.players.map((p) => p.rank).sort(), [1, 2, 3, 4]);
});
