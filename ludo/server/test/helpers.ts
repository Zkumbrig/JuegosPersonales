import type { ServerMsg, RoomView } from '../src/shared/protocol';
import type { Conn, Scheduler } from '../src/room';

export class FakeConn implements Conn {
  msgs: ServerMsg[] = [];
  closed = false;
  send(raw: string) { this.msgs.push(JSON.parse(raw)); }
  close() { this.closed = true; }
  last(): ServerMsg | undefined { return this.msgs[this.msgs.length - 1]; }
  lastRoom(): RoomView {
    for (let i = this.msgs.length - 1; i >= 0; i--) {
      const m = this.msgs[i]!;
      if (m.t === 'state' || m.t === 'welcome') return m.room;
    }
    throw new Error('sin estado');
  }
}

/** Reloj virtual: ejecuta los temporizadores de la sala al instante y en orden. */
export class VirtualTime {
  t = 0;
  private q: { at: number; fn: () => void; dead: boolean; n: number }[] = [];
  private n = 0;
  now = () => this.t;
  schedule: Scheduler = (ms, fn) => {
    const item = { at: this.t + ms, fn, dead: false, n: this.n++ };
    this.q.push(item);
    return () => { item.dead = true; };
  };
  /** Ejecuta hasta que no quede nada pendiente (o `max` pasos). Devuelve los pasos dados. */
  run(max = 200_000, stop?: () => boolean): number {
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
    return steps;
  }
  get pending() { return this.q.filter((i) => !i.dead).length; }
}

export const ZERO_TIMING = { act: 0, single: 0, pass: 0, hostGrace: 1000, reconnectGrace: 0, lobbyGrace: 5000 };
