import { randomInt } from 'node:crypto';
import { chooseMove } from './ludoAi';
import type { Room } from './room';
import {
  BOARDS, DEFAULT_LUDO_OPTIONS, MAX_BOTS, PAWNS, TURN_SECONDS_CHOICES,
  allHome, applyMove, distinctMoves, legalMoves, seatOrder,
  type LudoEvent, type LudoOptions, type LudoPublic, type LudoSeat,
} from '../shared/ludo';

/** Pausas que hacen que la partida se pueda seguir a ojo. En las pruebas se ponen a cero. */
export interface LudoTiming {
  act: number; // un bot (o un ausente) tira o mueve
  single: number; // movimiento automático cuando solo hay una jugada
  pass: number; // se ve el dado antes de pasar el turno si no hay jugadas
  grace: number; // margen tras caerse en pleno turno antes de jugar por esa persona
}
export const LUDO_TIMING: LudoTiming = { act: 1100, single: 800, pass: 1500, grace: 8_000 };
export type Scheduler = (ms: number, fn: () => void) => () => void;

interface Seat extends LudoSeat {
  /** Tiradas seguidas sin 6 teniendo todos los peones en casa (para el dado justo). */
  drought: number;
  strikes: number;
  /** Cuándo perdió la conexión (null si está conectada). */
  dcAt: number | null;
}

interface Turn {
  seat: number;
  step: 'roll' | 'move' | 'wait';
  dice: number | null;
  sixes: number;
  movable: number[];
  deadline: number | null;
  /** Al resolverse la espera, ¿repite el mismo jugador? */
  extra: boolean;
}

export interface LudoHooks {
  timing?: LudoTiming;
  schedule?: Scheduler;
  now?: () => number;
  dice?: () => number;
}

const KEEP_EVENTS = 14;
const STRIKES_FOR_AUTO = 2;

/** Dados forzados para pruebas manuales: DEBUG_LUDO_DICE=6,3,6,5 */
function debugDice(): (() => number) | undefined {
  const list = (process.env.DEBUG_LUDO_DICE ?? '').split(',').map(Number).filter((n) => n >= 1 && n <= 6);
  if (!list.length) return undefined;
  let i = 0;
  return () => list[i++ % list.length]!;
}

export class Ludo {
  phase: LudoPublic['phase'] = 'setup';
  options: LudoOptions = { ...DEFAULT_LUDO_OPTIONS };
  private seats: Seat[] = [];
  private turn: Turn | null = null;
  /** Índices de `seats` ordenados por brazo (sentido horario) para pasar el turno. */
  private order: number[] = [];
  private ranked = 0;
  private seq = 0;
  private startedAt = 0;
  private events: LudoEvent[] = [];
  private cancel: (() => void) | null = null;
  private readonly timing: LudoTiming;
  private readonly schedule: Scheduler;
  private readonly now: () => number;
  private readonly rollDie: (() => number) | undefined;

  constructor(private room: Room, hooks: LudoHooks = {}) {
    this.timing = hooks.timing ?? (process.env.LUDO_FAST === '1' ? { act: 0, single: 0, pass: 0, grace: 0 } : LUDO_TIMING);
    this.schedule = hooks.schedule ?? ((ms, fn) => { const h = setTimeout(fn, ms); return () => clearTimeout(h); });
    this.now = hooks.now ?? Date.now;
    this.rollDie = hooks.dice ?? debugDice();
  }

  /** Se puede cambiar de juego (no hay una partida en curso). */
  idle() {
    return this.phase !== 'playing';
  }

  dispose() {
    this.stopTimer();
  }

  // ---------- Preparación ----------
  /** Jugadores de la mesa que caben en el tablero, y después los bots. */
  private roster(): { id: string; name: string; bot: boolean }[] {
    const humans = [...this.room.players.values()].slice(0, this.options.board).map((p) => ({ id: p.id, name: p.name, bot: false }));
    const bots = Array.from({ length: Math.min(this.options.bots, this.options.board - humans.length) }, (_, i) => ({
      id: `bot${i + 1}`, name: `Bot ${i + 1}`, bot: true,
    }));
    return [...humans, ...bots];
  }

  private previewSeats(): LudoSeat[] {
    const order = seatOrder(this.options.board);
    return this.roster().map((r, i) => ({
      ...r, arm: order[i]!, pawns: new Array(PAWNS).fill(0), rank: null, left: false, auto: false,
    }));
  }

  config(p: { id: string }, patch: Partial<LudoOptions>): string | void {
    if (p.id !== this.room.hostId) return 'Solo el anfitrión cambia los ajustes.';
    if (this.phase !== 'setup') return 'La partida ya empezó.';
    const next = { ...this.options };
    const humans = this.room.players.size;
    if (patch.board !== undefined) {
      if (!BOARDS.includes(patch.board)) return 'Tablero no válido.';
      if (patch.board < humans) return `Hay ${humans} jugadores en la mesa: elige un tablero mayor.`;
      next.board = patch.board;
    }
    if (patch.bots !== undefined) {
      if (!Number.isInteger(patch.bots) || patch.bots < 0 || patch.bots > MAX_BOTS) return 'Número de bots no válido.';
      next.bots = patch.bots;
    }
    for (const k of ['endAtFirst', 'exactFinish', 'towers', 'autoSingle'] as const) {
      const v = patch[k];
      if (v === undefined) continue;
      if (typeof v !== 'boolean') return 'Opción no válida.';
      next[k] = v;
    }
    if (patch.turnSeconds !== undefined) {
      if (!(TURN_SECONDS_CHOICES as readonly number[]).includes(patch.turnSeconds)) return 'Tiempo de turno no válido.';
      next.turnSeconds = patch.turnSeconds;
    }
    // Los bots nunca desplazan a una persona: se recortan para que quepan.
    next.bots = Math.max(0, Math.min(next.bots, next.board - Math.min(humans, next.board)));
    this.options = next;
    this.room.broadcast();
  }

  start(p: { id: string }): string | void {
    if (p.id !== this.room.hostId) return 'Solo el anfitrión empieza la partida.';
    if (this.phase !== 'setup') return 'La partida ya empezó.';
    if (this.room.players.size > this.options.board) return 'No caben todos: elige un tablero mayor.';
    const preview = this.previewSeats();
    if (preview.length < 2) return 'Hacen falta al menos 2 jugadores. Añade un bot.';
    this.seats = preview.map((s) => ({ ...s, drought: 0, strikes: 0, dcAt: null }));
    this.order = this.seats.map((_, i) => i).sort((a, b) => this.seats[a]!.arm - this.seats[b]!.arm);
    this.ranked = 0;
    this.phase = 'playing';
    this.startedAt = this.now();
    const first = this.order[randomInt(this.order.length)]!;
    this.emit({ type: 'start', playerId: this.seats[first]!.id });
    this.beginTurn(first, 0);
    this.room.broadcast();
    this.plan();
  }

  /** Vuelve a la preparación (revancha o cancelar la partida en curso). */
  reset(p: { id: string }): string | void {
    if (p.id !== this.room.hostId) return 'Solo el anfitrión puede hacerlo.';
    if (this.phase === 'setup') return;
    this.back();
    this.room.broadcast();
  }

  /** Cambiar de juego deja el Ludo listo para la próxima vez. */
  back() {
    this.stopTimer();
    this.phase = 'setup';
    this.turn = null;
    this.seats = [];
    this.emit({ type: 'end' }); // las pantallas que seguían la partida vuelven a la preparación
  }

  // ---------- Jugadas ----------
  roll(p: { id: string }): string | void {
    const t = this.mine(p.id);
    if (typeof t === 'string') return t;
    if (t.step !== 'roll') return 'Ya tiraste el dado.';
    this.active(t.seat);
    this.doRoll();
  }

  move(p: { id: string }, pawn: number): string | void {
    const t = this.mine(p.id);
    if (typeof t === 'string') return t;
    if (t.step !== 'move') return 'Primero tira el dado.';
    if (!Number.isInteger(pawn) || !t.movable.includes(pawn)) return 'Ese peón no puede moverse.';
    this.active(t.seat);
    this.doMove(pawn);
  }

  private mine(id: string): Turn | string {
    const t = this.turn;
    if (this.phase !== 'playing' || !t) return 'No hay partida en curso.';
    const idx = this.seats.findIndex((s) => s.id === id);
    if (idx < 0) return 'Estás mirando: solo puedes ver la partida.';
    if (t.seat !== idx) return 'No es tu turno.';
    return t;
  }

  private doRoll() {
    const t = this.turn!;
    const s = this.seats[t.seat]!;
    const dice = this.rollDie ? this.rollDie() : this.fairRoll(s);
    t.dice = dice;
    t.sixes = dice === 6 ? t.sixes + 1 : 0;
    this.emit({ type: 'roll', playerId: s.id, dice });
    if (t.sixes >= 3) {
      // Tres seises seguidos: se pierde el turno.
      this.emit({ type: 'pass', playerId: s.id, reason: 'triple-six' });
      Object.assign(t, { movable: [], step: 'wait', extra: false, sixes: 0 });
    } else {
      t.movable = legalMoves(this.options.board, this.options, s, dice);
      if (t.movable.length === 0) {
        this.emit({ type: 'pass', playerId: s.id, reason: 'no-moves' });
        t.step = 'wait';
        t.extra = dice === 6; // el 6 da otra tirada aunque no se pueda mover
      } else {
        t.step = 'move';
        t.deadline = this.deadlineFor(s);
      }
    }
    this.room.broadcast();
    this.plan();
  }

  /**
   * Dado justo: es aleatorio, pero quien tiene todos los peones en casa y lleva varias tiradas sin 6
   * ve crecer su probabilidad (1/6 → +20 % por intento fallido), de modo que como mucho espera 5 tiradas.
   * Con peones ya en juego el dado es 100 % normal.
   */
  private fairRoll(s: Seat): number {
    const stuck = s.pawns.every((p) => p === 0);
    if (!stuck) {
      s.drought = 0;
      return randomInt(1, 7);
    }
    const chance = Math.min(1, 1 / 6 + s.drought * 0.2);
    if (randomInt(10_000) < chance * 10_000) {
      s.drought = 0;
      return 6;
    }
    s.drought++;
    return randomInt(1, 6); // 1..5
  }

  private doMove(pawn: number) {
    const t = this.turn!;
    const s = this.seats[t.seat]!;
    const dice = t.dice!;
    const res = applyMove(this.options.board, this.options, this.seats, t.seat, pawn, dice);
    this.emit({
      type: 'move', playerId: s.id, pawn, from: res.from, to: res.to,
      captured: res.captured.map((c) => ({ playerId: this.seats[c.seat]!.id, pawn: c.pawn, from: c.from })),
    });
    for (const c of res.captured) this.room.addFeed(`${s.name} se comió un peón de ${this.seats[c.seat]!.name}`);
    if (allHome(this.options.board, s)) {
      s.rank = ++this.ranked;
      this.emit({ type: 'finish', playerId: s.id, rank: s.rank });
    }
    if (!this.checkEnd()) {
      // Repite quien sacó 6, comió una pieza o metió un peón en la meta (si todavía le quedan peones).
      const extra = dice === 6 || res.captured.length > 0 || res.reachedHome;
      this.endTurn(extra && s.rank === null);
    }
    this.room.broadcast();
    this.plan();
  }

  private endTurn(extra: boolean) {
    const t = this.turn;
    if (!t) return;
    const s = this.seats[t.seat]!;
    if (extra && !s.left && s.rank === null) this.beginTurn(t.seat, t.sixes);
    else this.beginTurn(this.nextSeat(t.seat), 0);
  }

  private nextSeat(from: number): number {
    const pos = this.order.indexOf(from);
    for (let i = 1; i <= this.order.length; i++) {
      const idx = this.order[(pos + i) % this.order.length]!;
      const s = this.seats[idx]!;
      if (!s.left && s.rank === null) return idx;
    }
    return from;
  }

  private beginTurn(seat: number, sixes: number) {
    this.turn = { seat, step: 'roll', dice: null, sixes, movable: [], deadline: this.deadlineFor(this.seats[seat]!), extra: false };
  }

  /** Termina la partida si ya no tiene sentido seguir. Devuelve true si terminó. */
  private checkEnd(): boolean {
    if (this.phase !== 'playing') return false;
    const active = this.seats.filter((s) => !s.left && s.rank === null);
    const someoneWon = this.seats.some((s) => s.rank !== null);
    const humansLeft = active.some((s) => !s.bot);
    if ((this.options.endAtFirst && someoneWon) || active.length <= 1 || !humansLeft) {
      this.finish();
      return true;
    }
    return false;
  }

  private finish() {
    // Quienes no llegaron a la meta se ordenan por lo avanzados que iban.
    const rest = this.seats
      .filter((s) => s.rank === null && !s.left)
      .sort((a, b) => b.pawns.reduce((n, x) => n + x, 0) - a.pawns.reduce((n, x) => n + x, 0));
    for (const s of rest) s.rank = ++this.ranked;
    this.phase = 'finished';
    this.turn = null;
    this.stopTimer();
    this.emit({ type: 'end' });
    const winner = this.seats.find((s) => s.rank === 1);
    if (winner) this.room.addFeed(`${winner.name} ganó el Ludo`);
    this.room.noteRound({
      game: 'ludo',
      board: this.options.board,
      durationS: Math.round((this.now() - this.startedAt) / 1000),
      players: this.seats.map((s) => ({ pid: s.bot ? undefined : s.id, name: s.name, bot: s.bot, rank: s.rank ?? undefined })),
    });
  }

  // ---------- Entradas y salidas de la mesa ----------
  /** Alguien salió de la mesa (o lo expulsaron) en plena partida. */
  onRemove(pid: string) {
    const idx = this.seats.findIndex((s) => s.id === pid);
    if (idx < 0 || this.phase !== 'playing') return;
    const s = this.seats[idx]!;
    s.left = true;
    s.pawns = new Array(PAWNS).fill(0);
    s.auto = false;
    this.emit({ type: 'leave', playerId: s.id });
    const wasTurn = this.turn?.seat === idx;
    if (!this.checkEnd() && wasTurn) this.endTurn(false);
    this.plan();
  }

  onDisconnect(pid: string) {
    const s = this.seats.find((x) => x.id === pid);
    if (s) s.dcAt = this.now();
    this.plan();
  }

  onConnect(pid: string) {
    const s = this.seats.find((x) => x.id === pid);
    if (s) s.dcAt = null;
    this.plan();
  }

  // ---------- Temporizadores ----------
  private connected(s: Seat) {
    return !s.bot && !!this.room.players.get(s.id)?.ws;
  }

  private inGrace(s: Seat) {
    return !s.bot && !this.connected(s) && s.dcAt !== null && this.now() - s.dcAt < this.timing.grace;
  }

  /** ¿Juega el servidor por este asiento? (bot, piloto automático o ausente fuera del margen) */
  private automatic(s: Seat) {
    return s.bot || s.auto || (!this.connected(s) && !this.inGrace(s));
  }

  private deadlineFor(s: Seat): number | null {
    if (this.options.turnSeconds <= 0 || this.automatic(s)) return null;
    return this.now() + this.options.turnSeconds * 1000;
  }

  /** Decide qué debe pasar solo (bot, piloto automático, límite de tiempo) y lo programa. */
  private plan() {
    this.stopTimer();
    const t = this.turn;
    if (!t || this.phase !== 'playing') return;
    if (![...this.room.players.values()].some((p) => p.ws)) return; // sin nadie mirando, la partida queda en pausa
    const s = this.seats[t.seat]!;
    const auto = this.automatic(s);
    if (!auto && !this.connected(s)) {
      // En periodo de gracia: se vuelve a decidir cuando termine.
      this.setTimer(Math.max(0, s.dcAt! + this.timing.grace - this.now()), () => this.plan());
      return;
    }
    if (!auto && t.deadline === null && t.step !== 'wait' && this.options.turnSeconds > 0) {
      t.deadline = this.deadlineFor(s); // volvió a conectarse a mitad de su turno
      this.room.broadcast();
    }
    const jitter = (ms: number) => (ms === 0 ? 0 : ms * (0.85 + Math.random() * 0.3));

    if (t.step === 'wait') {
      this.setTimer(jitter(this.timing.pass), () => {
        this.endTurn(t.extra);
        this.room.broadcast();
        this.plan();
      });
    } else if (t.step === 'roll') {
      if (auto) this.setTimer(jitter(this.timing.act), () => this.doRoll());
      else this.armDeadline(t);
    } else {
      const options = distinctMoves(s, t.movable);
      if (auto) this.setTimer(jitter(this.timing.act), () => this.doMove(this.pick(t)));
      else if (this.options.autoSingle && options.length === 1) this.setTimer(jitter(this.timing.single), () => this.doMove(options[0]!));
      else this.armDeadline(t);
    }
  }

  private armDeadline(t: Turn) {
    if (t.deadline === null) return;
    this.setTimer(Math.max(0, t.deadline - this.now()), () => this.timeout());
  }

  /** Se acabó el tiempo: se juega por esa persona y, si se repite, pasa a piloto automático. */
  private timeout() {
    const t = this.turn;
    if (!t) return;
    const s = this.seats[t.seat]!;
    s.strikes++;
    if (s.strikes >= STRIKES_FOR_AUTO) s.auto = true;
    if (t.step === 'roll') this.doRoll();
    else if (t.step === 'move') this.doMove(this.pick(t));
  }

  private pick(t: Turn): number {
    return chooseMove(this.options.board, this.options, this.seats, t.seat, t.dice!, t.movable);
  }

  /** Quien actúa por su cuenta recupera el control. */
  private active(seat: number) {
    const s = this.seats[seat]!;
    s.strikes = 0;
    s.auto = false;
  }

  private setTimer(ms: number, fn: () => void) {
    this.cancel = this.schedule(ms, () => {
      this.cancel = null;
      fn();
    });
  }

  private stopTimer() {
    this.cancel?.();
    this.cancel = null;
  }

  // ---------- Estado público ----------
  private emit(ev: DistributiveOmit<LudoEvent, 'seq'>) {
    this.events.push({ ...ev, seq: ++this.seq } as LudoEvent);
    if (this.events.length > KEEP_EVENTS) this.events.shift();
  }

  toPublic(): LudoPublic {
    const t = this.turn;
    const playing = this.phase !== 'setup';
    return {
      phase: this.phase,
      options: { ...this.options },
      seats: playing
        ? this.seats.map((s) => ({
            id: s.id, name: s.name, bot: s.bot, arm: s.arm, pawns: [...s.pawns], rank: s.rank, left: s.left, auto: s.auto,
          }))
        : this.previewSeats(),
      turn: t && {
        playerId: this.seats[t.seat]!.id,
        step: t.step,
        dice: t.dice,
        movable: [...t.movable],
        sixes: t.sixes,
        timeLeft: t.deadline === null ? null : Math.max(0, t.deadline - this.now()),
      },
      seq: this.seq,
      events: this.events,
    };
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
