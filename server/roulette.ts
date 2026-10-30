import { isPosInt, rnd } from './util';
import type { Room, Player } from './room';
import { returnMultiplier } from '../shared/rules';
import type { RouletteBet, RouletteBetKind, RoulettePublic } from '../shared/protocol';

const BET_WINDOW = 20_000;
const SPIN_TIME = 7_000;
const RESULT_TIME = 6_000;
const MAX_BETS_PER_PLAYER = 60;

const KINDS: RouletteBetKind[] = [
  'straight', 'red', 'black', 'even', 'odd', 'low', 'high', 'dozen', 'column',
];

export class Roulette {
  phase: RoulettePublic['phase'] = 'betting';
  bets = new Map<string, RouletteBet[]>();
  result: number | null = null;
  history: number[] = [];
  net = new Map<string, number>();
  /** Apuestas de la tirada anterior de cada jugador, para poder repetirlas. */
  private last = new Map<string, RouletteBet[]>();
  private deadline: number | null = null;
  private timer?: NodeJS.Timeout;

  constructor(private room: Room) {}

  idle() {
    return this.phase === 'betting' && this.bets.size === 0;
  }

  refundable(): [string, number][] {
    if (this.phase === 'result') return []; // ya está pagado
    return [...this.bets].map(([id, list]) => [id, list.reduce((n, b) => n + b.amount, 0)]);
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private setTimer(ms: number | null, fn?: () => void) {
    clearTimeout(this.timer);
    if (ms === null || !fn) { this.deadline = null; return; }
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
  }

  bet(p: Player, kind: RouletteBetKind, value: number | undefined, amount: number): string | void {
    if (this.phase !== 'betting') return 'La bola ya está girando.';
    if (!isPosInt(amount) || amount > p.chips) return 'No tienes fichas suficientes.';
    if (!KINDS.includes(kind)) return 'Apuesta no válida.';
    if (kind === 'straight' && !(Number.isInteger(value) && value! >= 0 && value! <= 36)) return 'Número no válido.';
    if ((kind === 'dozen' || kind === 'column') && !(Number.isInteger(value) && value! >= 1 && value! <= 3)) return 'Apuesta no válida.';
    const list = this.bets.get(p.id) ?? [];
    if (list.length >= MAX_BETS_PER_PLAYER) return 'Demasiadas fichas en la mesa.';
    const entry: RouletteBet = { kind, amount };
    if (kind === 'straight' || kind === 'dozen' || kind === 'column') entry.value = value;
    list.push(entry);
    this.bets.set(p.id, list);
    p.chips -= amount;
    if (this.deadline === null) this.setTimer(BET_WINDOW, () => this.lock());
    this.room.broadcast();
  }

  /** Repite exactamente las fichas de la tirada anterior. */
  rebet(p: Player): string | void {
    if (this.phase !== 'betting') return 'La bola ya está girando.';
    const prev = this.last.get(p.id);
    if (!prev?.length) return 'No tienes una apuesta anterior que repetir.';
    if (this.bets.get(p.id)?.length) return 'Quita tus fichas actuales para repetir, o usa Doblar.';
    const total = prev.reduce((n, b) => n + b.amount, 0);
    if (total > p.chips) return `Para repetir necesitas ${total} fichas.`;
    this.bets.set(p.id, prev.map((b) => ({ ...b })));
    p.chips -= total;
    if (this.deadline === null) this.setTimer(BET_WINDOW, () => this.lock());
    this.room.broadcast();
  }

  /** Duplica las fichas que tienes ahora mismo en el tapete. */
  double(p: Player): string | void {
    if (this.phase !== 'betting') return 'La bola ya está girando.';
    const cur = this.bets.get(p.id);
    if (!cur?.length) return 'Primero pon alguna ficha.';
    if (cur.length * 2 > MAX_BETS_PER_PLAYER) return 'Demasiadas fichas para doblar.';
    const total = cur.reduce((n, b) => n + b.amount, 0);
    if (total > p.chips) return `Para doblar necesitas ${total} fichas más.`;
    cur.push(...cur.map((b) => ({ ...b })));
    p.chips -= total;
    this.room.broadcast();
  }

  undo(p: Player) {
    if (this.phase !== 'betting') return;
    const list = this.bets.get(p.id);
    const last = list?.pop();
    if (!list || !last) return;
    p.chips += last.amount;
    this.afterRefund(p.id, list);
  }

  clear(p: Player) {
    if (this.phase !== 'betting') return;
    const list = this.bets.get(p.id);
    if (!list) return;
    for (const b of list) p.chips += b.amount;
    this.afterRefund(p.id, []);
  }

  private afterRefund(pid: string, list: RouletteBet[]) {
    if (list.length === 0) this.bets.delete(pid);
    if (this.bets.size === 0) this.setTimer(null);
    this.room.broadcast();
  }

  private lock() {
    if (this.bets.size === 0) { this.setTimer(null); return; }
    this.phase = 'spinning';
    this.result = rnd(37);
    this.setTimer(SPIN_TIME, () => this.settle());
    this.room.broadcast();
  }

  private settle() {
    const n = this.result!;
    this.net.clear();
    for (const [pid, list] of this.bets) {
      let stake = 0;
      let back = 0;
      for (const b of list) {
        stake += b.amount;
        back += b.amount * returnMultiplier(b, n);
      }
      const p = this.room.players.get(pid);
      if (p) {
        p.chips += back;
        if (back - stake >= 500) this.room.addFeed(`${p.name} ganó ${back - stake} en la ruleta (${n})`);
      }
      this.net.set(pid, back - stake);
      this.last.set(pid, list.map((b) => ({ ...b })));
      if (back - stake > 0) this.room.noteWin(pid, back - stake, 'Ruleta');
    }
    this.room.noteRound({
      game: 'roulette',
      players: [...this.net].map(([pid, score]) => ({ pid, name: this.room.players.get(pid)?.name ?? 'Jugador', score })),
    });
    this.history.unshift(n);
    this.history.length = Math.min(this.history.length, 12);
    this.phase = 'result';
    this.setTimer(RESULT_TIME, () => this.reset());
    this.room.broadcast();
  }

  private reset() {
    this.bets.clear();
    this.net.clear();
    this.phase = 'betting';
    this.setTimer(null);
    this.room.broadcast();
  }

  onRemove(pid: string) {
    if (this.phase === 'betting' && this.bets.delete(pid) && this.bets.size === 0) this.setTimer(null);
  }

  toPublic(): RoulettePublic {
    return {
      phase: this.phase,
      timeLeft: this.deadline === null ? null : Math.max(0, this.deadline - Date.now()),
      bets: Object.fromEntries(this.bets),
      result: this.result,
      history: this.history,
      net: Object.fromEntries(this.net),
      lastTotals: Object.fromEntries([...this.last].map(([id, l]) => [id, l.reduce((n, b) => n + b.amount, 0)])),
    };
  }
}
