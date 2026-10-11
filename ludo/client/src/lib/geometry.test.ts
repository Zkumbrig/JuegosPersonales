import test from 'node:test';
import assert from 'node:assert/strict';
import { geometry } from './geometry';
import { BOARDS } from '$shared/protocol';
import { finalPos, trackCell, trackLen } from '$shared/rules';

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

for (const board of BOARDS) {
  test(`tablero de ${board}: casillas contiguas se tocan y ninguna se solapa`, () => {
    const g = geometry(board);
    const T = trackLen(board);
    assert.equal(g.track.length, T);
    for (let i = 0; i < T; i++) {
      const d = dist(g.track[i]!, g.track[(i + 1) % T]!);
      assert.ok(d > 0.95 && d < 1.5, `casillas ${i}->${i + 1} a distancia ${d.toFixed(2)}`);
      for (let j = i + 1; j < T; j++) assert.ok(dist(g.track[i]!, g.track[j]!) > 0.95, `solape ${i}/${j}`);
    }
  });

  test(`tablero de ${board}: el pasillo de llegada sale de la punta y no pisa el circuito`, () => {
    const g = geometry(board);
    for (let k = 0; k < board; k++) {
      const tip = g.track[trackCell(board, k, trackLen(board) - 1)!]!;
      assert.ok(Math.abs(dist(tip, g.home[k]![0]!) - 1) < 1e-6, 'el pasillo empieza junto a la punta');
      for (let c = 0; c < 4; c++) assert.ok(Math.abs(dist(g.home[k]![c]!, g.home[k]![c + 1]!) - 1) < 1e-6);
      for (const h of g.home[k]!) for (const t of g.track) assert.ok(dist(h, t) > 0.95, 'sin solapes con el circuito');
    }
  });

  test(`tablero de ${board}: los patios y la meta caben sin pisar casillas`, () => {
    const g = geometry(board);
    for (const y of g.yards) {
      for (const c of [...g.track, ...g.home.flat()]) assert.ok(dist(y.center, c) > y.radius + 0.55, 'patio sobre una casilla');
      for (const s of y.slots) assert.ok(dist(s, y.center) < y.radius - 0.3, 'peón fuera del patio');
    }
    for (let a = 0; a < board; a++) for (const s of g.hubSlots[a]!) assert.ok(Math.hypot(s.x, s.y) < g.hubRadius);
    for (const c of [...g.track, ...g.yards.map((y) => y.center)]) {
      assert.ok(Math.abs(c.x) < g.extent && Math.abs(c.y) < g.extent, 'fuera del viewBox');
    }
  });

  test(`tablero de ${board}: pawnPoint cubre todo el recorrido`, () => {
    const g = geometry(board);
    for (let arm = 0; arm < board; arm++) {
      for (let p = 0; p <= finalPos(board); p++) {
        const pt = g.pawnPoint(arm, p, 3);
        assert.ok(Number.isFinite(pt.x) && Number.isFinite(pt.y), `p=${p}`);
      }
    }
  });
}
