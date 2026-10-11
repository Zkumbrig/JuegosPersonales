import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARDS } from '../src/shared/protocol';
import {
  applyMove, armColor, distinctMoves, finalPos, legalMoves, safeCells, seatOrder, startCell, targetOf,
  trackCell, trackLen, zoneOf, type Seat,
} from '../src/shared/rules';

const classic = { exactFinish: true, towers: false };

test('el circuito tiene 13 casillas por brazo y 57 pasos en el Ludo clásico', () => {
  assert.equal(trackLen(4), 52);
  assert.equal(trackLen(6), 78);
  assert.equal(trackLen(8), 104);
  assert.equal(finalPos(4), 57);
  assert.equal(finalPos(8), 109);
});

for (const board of BOARDS) {
  test(`tablero de ${board}: cada brazo recorre el circuito entero sin repetir casillas`, () => {
    const T = trackLen(board);
    for (let arm = 0; arm < board; arm++) {
      const seen = new Set<number>();
      for (let p = 1; p <= T - 1; p++) seen.add(trackCell(board, arm, p)!);
      assert.equal(seen.size, T - 1, 'recorre T-1 casillas distintas');
      assert.equal(trackCell(board, arm, 1), startCell(arm), 'p=1 es su salida');
      // La última casilla antes del pasillo es la punta de su propio brazo.
      assert.equal(trackCell(board, arm, T - 1), arm * 13 + 6);
      assert.equal(trackCell(board, arm, 0), null);
      assert.equal(trackCell(board, arm, T), null);
    }
  });

  test(`tablero de ${board}: casillas seguras (salidas + estrellas) y colores únicos`, () => {
    assert.equal(safeCells(board).size, board * 2);
    for (let a = 0; a < board; a++) assert.ok(safeCells(board).has(startCell(a)));
    assert.equal(new Set(Array.from({ length: board }, (_, a) => armColor(board, a).key)).size, board);
    assert.equal(new Set(seatOrder(board)).size, board);
  });
}

test('solo se sale de casa con un 6', () => {
  for (let d = 1; d <= 5; d++) assert.equal(targetOf(4, classic, 0, d), null);
  assert.equal(targetOf(4, classic, 0, 6), 1);
});

test('meta: tiro exacto obligatorio (o no, según la opción)', () => {
  const FIN = finalPos(4);
  assert.equal(targetOf(4, classic, FIN - 2, 2), FIN);
  assert.equal(targetOf(4, classic, FIN - 2, 3), null);
  assert.equal(targetOf(4, { ...classic, exactFinish: false }, FIN - 2, 3), FIN);
  assert.equal(targetOf(4, classic, FIN, 1), null);
});

test('legalMoves y distinctMoves', () => {
  const seat: Seat = { arm: 0, pawns: [0, 0, 5, 5] };
  assert.deepEqual(legalMoves(4, classic, seat, 3), [2, 3]);
  assert.deepEqual(legalMoves(4, classic, seat, 6), [0, 1, 2, 3]);
  assert.deepEqual(distinctMoves(seat, [0, 1, 2, 3]), [0, 2]);
});

function twoSeats(): Seat[] {
  return [{ arm: 0, pawns: [3, 0, 0, 0] }, { arm: 1, pawns: [0, 0, 0, 0] }];
}

test('un peón come al rival que está en una casilla normal y lo manda a casa', () => {
  const seats = twoSeats();
  // Casilla del circuito de rojo con p=5 -> buscamos el p del verde en la misma casilla.
  const cell = trackCell(4, 0, 5)!;
  const pg = Array.from({ length: 51 }, (_, i) => i + 1).find((p) => trackCell(4, 1, p) === cell)!;
  seats[1]!.pawns[2] = pg;
  const res = applyMove(4, classic, seats, 0, 0, 2);
  assert.equal(res.to, 5);
  assert.deepEqual(res.captured, [{ seat: 1, pawn: 2, from: pg }]);
  assert.equal(seats[1]!.pawns[2], 0);
});

test('en casillas seguras conviven peones rivales', () => {
  const seats = twoSeats();
  // Rojo avanza hasta la salida del verde (casilla segura).
  const target = startCell(1);
  const pr = Array.from({ length: 51 }, (_, i) => i + 1).find((p) => trackCell(4, 0, p) === target)!;
  seats[0]!.pawns[0] = pr - 2;
  seats[1]!.pawns[0] = 1; // verde en su salida
  const res = applyMove(4, classic, seats, 0, 0, 2);
  assert.equal(res.captured.length, 0);
  assert.equal(seats[1]!.pawns[0], 1);
});

test('las parejas son inmunes solo si la opción "towers" está activa', () => {
  const build = () => {
    const seats = twoSeats();
    const cell = trackCell(4, 0, 5)!;
    const pg = Array.from({ length: 51 }, (_, i) => i + 1).find((p) => trackCell(4, 1, p) === cell)!;
    seats[1]!.pawns[0] = pg;
    seats[1]!.pawns[1] = pg;
    return seats;
  };
  assert.equal(applyMove(4, classic, build(), 0, 0, 2).captured.length, 2);
  assert.equal(applyMove(4, { ...classic, towers: true }, build(), 0, 0, 2).captured.length, 0);
});

test('el pasillo de llegada es privado: no se come ahí', () => {
  const seats: Seat[] = [{ arm: 0, pawns: [trackLen(4) + 1, 0, 0, 0] }, { arm: 1, pawns: [trackLen(4) + 1, 0, 0, 0] }];
  seats[0]!.pawns[0] = trackLen(4) - 1; // última casilla del circuito
  const res = applyMove(4, classic, seats, 0, 0, 2);
  assert.equal(res.captured.length, 0);
  assert.equal(zoneOf(4, res.to), 'home');
});
