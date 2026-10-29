// Pruebas del Ludo dentro de la mesa: npm test  (o: tsx server/ludotest.ts)
import assert from 'node:assert/strict';
import { Ludo, type LudoTiming } from './ludo';
import { chooseMove } from './ludoAi';
import { Player, Room as RealRoom, type Room } from './room';
import { BOARDS, finalPos, safeCells, trackCell, type BoardSize, type LudoPublic } from '../shared/ludo';

/** Reloj virtual: ejecuta los temporizadores al instante y en orden. */
class VirtualTime {
  t = 0;
  private q: { at: number; fn: () => void; dead: boolean; n: number }[] = [];
  private n = 0;
  now = () => this.t;
  schedule = (ms: number, fn: () => void) => {
    const item = { at: this.t + ms, fn, dead: false, n: this.n++ };
    this.q.push(item);
    return () => { item.dead = true; };
  };
  run(max = 400_000, stop?: () => boolean) {
    let steps = 0;
    while (steps < max) {
      if (stop?.()) break;
      this.q = this.q.filter((i) => !i.dead);
      if (!this.q.length) break;
      this.q.sort((a, b) => a.at - b.at || a.n - b.n);
      const item = this.q.shift()!;
      this.t = Math.max(this.t, item.at);
      item.fn();
      steps++;
    }
  }
}

const ZERO: LudoTiming = { act: 0, single: 0, pass: 0, grace: 0 };

interface Fake { id: string; name: string; ws: object | null }
function mkRoom(names: string[], timing: LudoTiming = ZERO, dice?: () => number) {
  const vt = new VirtualTime();
  const players = new Map<string, Fake>(names.map((n, i) => [`p${i}`, { id: `p${i}`, name: n, ws: {} }]));
  const feed: string[] = [];
  let rounds = 0;
  const room = {
    players,
    hostId: 'p0',
    broadcast() {},
    addFeed: (t: string) => feed.push(t),
    noteRound: () => { rounds++; },
  } as unknown as Room;
  const lu = new Ludo(room, { timing, schedule: vt.schedule, now: vt.now, dice });
  return { vt, lu, players, feed, rounds: () => rounds, room };
}
const host = { id: 'p0' };
const pub = (lu: Ludo): LudoPublic => lu.toPublic();
const inner = (lu: Ludo) => lu as unknown as { seats: { id: string; arm: number; pawns: number[]; auto: boolean }[]; turn: { seat: number; dice: number } };

let n = 0;
function test(name: string, fn: () => void) {
  fn();
  n++;
  console.log('  ok  ' + name);
}

console.log('Ludo (unidades)');

test('solo el anfitrión configura; los tableros limitan jugadores y bots', () => {
  const { lu } = mkRoom(['A', 'B', 'C']);
  assert.match(String(lu.config({ id: 'p1' }, { board: 8 })), /anfitrión/);
  assert.equal(lu.config(host, { board: 4 }), undefined);
  lu.config(host, { bots: 5 });
  assert.equal(pub(lu).seats.length, 4, 'con 3 personas en un tablero de 4 solo cabe 1 bot');
  assert.equal(lu.config(host, { board: 8 }), undefined);
  lu.config(host, { bots: 5 });
  assert.equal(pub(lu).seats.length, 8);
  assert.match(String(lu.config(host, { turnSeconds: 7 })), /no válido/);
  assert.match(String(lu.config(host, { bots: 99 })), /no válido/);
  const small = mkRoom(['A', 'B', 'C', 'D', 'E']);
  assert.match(String(small.lu.config(host, { board: 4 })), /mayor/);
});

test('hay que ser anfitrión y tener 2 jugadores para empezar; los colores no se repiten', () => {
  const solo = mkRoom(['A']);
  assert.match(String(solo.lu.start(host)), /2 jugadores/);
  const { lu } = mkRoom(['A', 'B']);
  assert.match(String(lu.start({ id: 'p1' })), /anfitrión/);
  for (const board of BOARDS) {
    lu.config(host, { board, bots: 0 });
    const arms = pub(lu).seats.map((s) => s.arm);
    assert.equal(new Set(arms).size, arms.length);
    assert.ok(arms.every((a) => a < board));
  }
  assert.equal(lu.start(host), undefined);
  assert.equal(pub(lu).phase, 'playing');
  assert.match(String(lu.config(host, { board: 6 })), /ya empezó/);
});

const turn = (lu: Ludo) => pub(lu).turn!;

test('fuera de turno, antes de tirar y como espectador', () => {
  const { lu } = mkRoom(['A', 'B'], ZERO, () => 3);
  lu.start(host);
  const cur = turn(lu).playerId;
  const other = cur === 'p0' ? 'p1' : 'p0';
  assert.match(String(lu.roll({ id: other })), /turno/);
  assert.match(String(lu.move({ id: cur }, 0)), /tira el dado/);
  assert.match(String(lu.roll({ id: 'espectador' })), /mirando/);
});

test('sin un 6 no se sale de casa; con un 6 se saca peón y se repite turno', () => {
  const seq = [3, 6, 4];
  let i = 0;
  const { lu, vt } = mkRoom(['A', 'B'], ZERO, () => seq[i++ % seq.length]!);
  lu.start(host);
  const first = turn(lu).playerId;
  lu.roll({ id: first });
  assert.equal(turn(lu).step, 'wait');
  vt.run(20, () => turn(lu).playerId !== first);
  const second = turn(lu).playerId;
  assert.notEqual(second, first);
  lu.roll({ id: second }); // 6
  assert.deepEqual(turn(lu).movable, [0, 1, 2, 3]);
  lu.move({ id: second }, 2);
  assert.equal(pub(lu).seats.find((s) => s.id === second)!.pawns[2], 1);
  assert.equal(turn(lu).playerId, second, 'el 6 da otra tirada');
});

test('tres seises seguidos pierden el turno', () => {
  const { lu, vt } = mkRoom(['A', 'B'], ZERO, () => 6);
  lu.start(host);
  const first = turn(lu).playerId;
  lu.roll({ id: first });
  vt.run(20, () => turn(lu).step === 'roll');
  lu.roll({ id: first });
  lu.move({ id: first }, 0);
  assert.equal(turn(lu).sixes, 2);
  lu.roll({ id: first });
  assert.equal(turn(lu).step, 'wait');
  vt.run(20, () => turn(lu).playerId !== first);
  assert.notEqual(turn(lu).playerId, first);
});

test('comer manda el peón a casa y da otra tirada', () => {
  const rolls: number[] = [];
  const { lu } = mkRoom(['A', 'B'], ZERO, () => rolls.shift() ?? 1);
  lu.start(host);
  const mineId = turn(lu).playerId;
  const s = inner(lu).seats;
  const mine = s.find((x) => x.id === mineId)!;
  const theirs = s.find((x) => x.id !== mineId)!;
  mine.pawns[0] = 9;
  const cell = trackCell(4, mine.arm, 13)!;
  assert.ok(!safeCells(4).has(cell));
  theirs.pawns[1] = Array.from({ length: 51 }, (_, i) => i + 1).find((p) => trackCell(4, theirs.arm, p) === cell)!;
  rolls.push(4);
  lu.roll({ id: mineId });
  lu.move({ id: mineId }, 0);
  assert.equal(theirs.pawns[1], 0);
  assert.equal(mine.pawns[0], 13);
  assert.equal(turn(lu).playerId, mineId);
});

test('dado justo: con todos los peones en casa nunca se esperan más de 5 tiradas por un 6', () => {
  const { lu, vt } = mkRoom(['A', 'B']);
  lu.config(host, { turnSeconds: 0 });
  lu.start(host);
  let worst = 0;
  let run = 0;
  let seen = 0;
  for (let i = 0; i < 4000; i++) {
    const t = pub(lu).turn!;
    if (t.step === 'roll') lu.roll({ id: t.playerId });
    const e = pub(lu).events.filter((x) => x.seq > seen && x.type === 'roll' && x.playerId === 'p0');
    for (const r of e) {
      if (r.type !== 'roll') continue;
      const inYard = inner(lu).seats.find((s) => s.id === 'p0')!.pawns.every((p) => p === 0);
      run = r.dice === 6 || !inYard ? 0 : run + 1;
      worst = Math.max(worst, run);
    }
    seen = pub(lu).seq;
    const cur = pub(lu).turn;
    if (cur?.step === 'move') {
      const s = inner(lu);
      lu.move({ id: cur.playerId }, chooseMove(4, pub(lu).options, s.seats, s.turn.seat, s.turn.dice, cur.movable));
    }
    vt.run(5);
    if (pub(lu).phase !== 'playing') break;
  }
  assert.ok(worst <= 5, 'la peor racha sin 6 fue ' + worst);
});

test('el tiempo agotado juega por la persona y a la segunda pasa a automático', () => {
  const { lu, vt } = mkRoom(['A', 'B']);
  lu.config(host, { turnSeconds: 20 });
  lu.start(host);
  vt.run(20_000, () => inner(lu).seats.some((s) => s.auto));
  assert.ok(inner(lu).seats.some((s) => s.auto));
});

test('si quien tiene el turno sale de la mesa el turno pasa; si queda uno solo gana', () => {
  const { lu } = mkRoom(['A', 'B', 'C'], ZERO, () => 2);
  lu.start(host);
  const t = turn(lu).playerId;
  lu.onRemove(t);
  assert.notEqual(turn(lu).playerId, t);
  assert.equal(pub(lu).phase, 'playing');
  lu.onRemove(turn(lu).playerId);
  assert.equal(pub(lu).phase, 'finished');
  assert.equal(pub(lu).seats.find((s) => !s.left)!.rank, 1);
});

test('el anfitrión vuelve a la preparación desde el final o en plena partida', () => {
  const { lu } = mkRoom(['A', 'B'], ZERO, () => 2);
  lu.start(host);
  assert.match(String(lu.reset({ id: 'p1' })), /anfitrión/);
  assert.equal(lu.idle(), false);
  assert.equal(lu.reset(host), undefined);
  assert.equal(pub(lu).phase, 'setup');
  assert.equal(lu.idle(), true);
  assert.equal(lu.start(host), undefined);
});

test('margen de gracia: quien se cae en su turno no pierde la tirada al instante', () => {
  const t = { ...ZERO, grace: 4000 };
  const { lu, vt, players } = mkRoom(['A', 'B'], t, () => 3);
  lu.start(host);
  if (turn(lu).playerId !== 'p0') {
    lu.roll({ id: 'p1' });
    vt.run(20, () => turn(lu).playerId === 'p0');
  }
  assert.equal(turn(lu).playerId, 'p0');
  const rolls = () => pub(lu).events.filter((e) => e.type === 'roll' && e.playerId === 'p0').length;
  const before = rolls();
  players.get('p0')!.ws = null;
  lu.onDisconnect('p0');
  const t0 = vt.t;
  vt.run(50, () => rolls() > before);
  assert.equal(rolls(), before + 1, 'el servidor acabó tirando por A');
  assert.ok(vt.t - t0 >= 4000, `pero no antes del margen (${vt.t - t0} ms)`);
});

test('sin ninguna persona conectada la partida queda en pausa', () => {
  const { lu, vt, players } = mkRoom(['A', 'B']);
  lu.start(host);
  for (const p of players.values()) p.ws = null;
  lu.onDisconnect('p0');
  const before = pub(lu).seq;
  vt.run(500);
  assert.equal(pub(lu).seq, before);
});

// ---------- Partidas completas ----------
function invariants(p: LudoPublic) {
  const board = p.options.board;
  const FIN = finalPos(board);
  for (const s of p.seats) {
    assert.equal(s.pawns.length, 4);
    for (const x of s.pawns) {
      assert.ok(x >= 0 && x <= FIN, `progreso fuera de rango: ${x}`);
    }
  }
}

for (const board of BOARDS) {
  for (const count of [2, 3, board]) {
    test(`partida completa de ${board} brazos con ${count} jugadores (hasta el último puesto)`, () => {
      const { lu, vt } = mkRoom(['Humano']);
      lu.config(host, { board: board as BoardSize, bots: count - 1, turnSeconds: 0, endAtFirst: false });
      assert.equal(lu.start(host), undefined);
      let guard = 0;
      while (pub(lu).phase === 'playing' && guard++ < 100_000) {
        vt.run(50_000, () => {
          const p = pub(lu);
          return p.phase !== 'playing' || (p.turn?.playerId === 'p0' && p.turn.step !== 'wait');
        });
        const p = pub(lu);
        invariants(p);
        if (p.phase !== 'playing') break;
        const t = p.turn!;
        if (t.step === 'roll') lu.roll(host);
        else if (t.step === 'move') {
          const s = inner(lu);
          lu.move(host, chooseMove(board, p.options, s.seats, s.turn.seat, s.turn.dice, t.movable));
        }
      }
      const p = pub(lu);
      assert.equal(p.phase, 'finished');
      assert.deepEqual(p.seats.map((s) => s.rank).sort(), Array.from({ length: count }, (_, i) => i + 1));
      assert.ok(p.seats.find((s) => s.rank === 1)!.pawns.every((x) => x === finalPos(board)));
    });
  }
}

test('"terminar al primero" acaba al ganar el primero y cierra la clasificación', () => {
  const { lu, vt, rounds, feed } = mkRoom(['Humano']);
  lu.config(host, { bots: 3, turnSeconds: 20, endAtFirst: true }); // el humano no responde: el tiempo juega por él
  lu.start(host);
  vt.run(200_000, () => pub(lu).phase === 'finished');
  const p = pub(lu);
  assert.equal(p.phase, 'finished');
  assert.deepEqual(p.seats.map((s) => s.rank).sort(), [1, 2, 3, 4]);
  assert.equal(rounds(), 1);
  assert.ok(feed.some((f) => /ganó el Ludo/.test(f)));
});

test('el casino está activo por defecto y CASINO=0 lo oculta', () => {
  const make = () => {
    const r = new RealRoom('ABCD', () => {});
    const p = new Player('p-host', 'Ana', 0);
    r.players.set(p.id, p);
    r.hostId = p.id;
    return { r, setGame: (g: string) => (r as unknown as { setGame(p: Player, g: string): string | void }).setGame(p, g) };
  };
  delete process.env.CASINO;
  const on = make();
  assert.equal(on.r.casino, true);
  assert.equal(on.r.game, 'blackjack');
  assert.equal(on.setGame('roulette'), undefined);
  assert.deepEqual(on.r.casinoGames, ['blackjack', 'roulette', 'freepoker'], 'el póker con fichas y las tragaperras están ocultos por defecto');
  assert.match(String(on.setGame('poker')), /no está disponible/);
  process.env.CASINO = '0';
  const off = make();
  assert.equal(off.r.casino, false);
  assert.equal(off.r.game, 'party', 'sin casino la mesa abre en Fiesta');
  assert.match(String(off.setGame('blackjack')), /no está disponible/);
  assert.equal(off.setGame('ludo'), undefined, 'Ludo y Fiesta siguen disponibles');
  delete process.env.CASINO;
  off.r.destroy();
  on.r.destroy();
});

console.log(`Ludo: ${n} pruebas correctas`);
