import { randomInt } from 'node:crypto';
import { chooseMove } from './ai';
import {
  BOARDS,
  DEFAULT_OPTIONS,
  NAME_MAX,
  TURN_SECONDS_CHOICES,
  type BoardSize,
  type ClientMsg,
  type ErrorCode,
  type GameEvent,
  type Phase,
  type RoomOptions,
  type RoomView,
  type ServerMsg,
  type YouInfo,
} from './shared/protocol';
import { allHome, applyMove, distinctMoves, legalMoves, PAWNS, seatOrder } from './shared/rules';
import { newId, newToken } from './util';

export class RoomError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/** Lo único que la sala sabe de una conexión: poder escribirle y cerrarla. */
export interface Conn {
  send(raw: string): void;
  close(): void;
}

export interface Timing {
  /** Pausa antes de que un bot (o un jugador ausente) tire o mueva. */
  act: number;
  /** Pausa antes de mover solo cuando únicamente hay una jugada. */
  single: number;
  /** Pausa para ver el dado antes de pasar el turno si no hay jugadas. */
  pass: number;
  /** Tiempo sin conexión del líder antes de cederle el mando a otro. */
  hostGrace: number;
  /** Margen tras desconectarse en pleno turno antes de que el servidor juegue por esa persona. */
  reconnectGrace: number;
  /** Tiempo sin conexión de alguien en la sala de espera (o de un espectador) antes de quitarlo. */
  lobbyGrace: number;
}
export const REAL_TIMING: Timing = { act: 1100, single: 800, pass: 1500, hostGrace: 20_000, reconnectGrace: 8_000, lobbyGrace: 45_000 };

export type Scheduler = (ms: number, fn: () => void) => () => void;
const realScheduler: Scheduler = (ms, fn) => {
  const h = setTimeout(fn, ms);
  return () => clearTimeout(h);
};

export interface RoomHooks {
  timing?: Timing;
  schedule?: Scheduler;
  now?: () => number;
  /** Para pruebas: sustituye al dado (devuelve 1..6). */
  dice?: () => number;
}

interface Member {
  id: string;
  token: string;
  name: string;
  conn: Conn | null;
}

interface Player extends Member {
  arm: number;
  bot: boolean;
  pawns: number[];
  rank: number | null;
  left: boolean;
  /** Juega en automático por no haber respondido a tiempo. */
  auto: boolean;
  strikes: number;
  /** Cuándo perdió la conexión (null si está conectado). */
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

const MAX_SPECTATORS = 24;
const STRIKES_FOR_AUTO = 2;

export class Room {
  readonly code: string;
  options: RoomOptions = { ...DEFAULT_OPTIONS };
  phase: Phase = 'lobby';
  hostId: string | null = null;
  players: Player[] = [];
  spectators: Member[] = [];
  lastActive: number;

  private seq = 0;
  private pending: GameEvent[] = [];
  private turn: Turn | null = null;
  /** Índices de `players` ordenados por brazo (sentido horario) para pasar el turno. */
  private order: number[] = [];
  private ranked = 0;
  private botCount = 0;
  private cancelTimer: (() => void) | null = null;
  private cancelHostTimer: (() => void) | null = null;
  private readonly ghostTimers = new Map<string, () => void>();
  private readonly timing: Timing;
  private readonly schedule: Scheduler;
  private readonly now: () => number;
  private readonly rollDie: () => number;

  constructor(code: string, hooks: RoomHooks = {}) {
    this.code = code;
    this.timing = hooks.timing ?? REAL_TIMING;
    this.schedule = hooks.schedule ?? realScheduler;
    this.now = hooks.now ?? Date.now;
    this.rollDie = hooks.dice ?? (() => randomInt(1, 7));
    this.lastActive = this.now();
  }

  // ============ Entrada y salida de personas ============

  /** Entra alguien nuevo: jugador si hay hueco en la sala de espera, espectador si no. */
  join(rawName: string, conn: Conn): YouInfo {
    const base: Member = { id: newId(), token: newToken(), name: this.uniqueName(rawName), conn };
    let role: YouInfo['role'];
    if (this.phase === 'lobby' && this.players.length < this.options.board) {
      this.players.push(this.makePlayer(base, false));
      role = 'player';
      if (!this.hostId) this.hostId = base.id;
    } else {
      if (this.spectators.length >= MAX_SPECTATORS) throw new RoomError('full', 'La sala no admite más espectadores.');
      this.spectators.push(base);
      role = 'spectator';
    }
    this.touch();
    const you: YouInfo = { id: base.id, token: base.token, role };
    conn.send(this.encode({ t: 'welcome', you, room: this.view() }));
    this.broadcast(base.id);
    return you;
  }

  /** Reconecta a quien ya estaba (por ejemplo tras perder la señal). */
  resume(token: string, conn: Conn): YouInfo | null {
    const found = this.findByToken(token);
    if (!found) return null;
    const { member, role } = found;
    if (member.conn && member.conn !== conn) member.conn.close();
    member.conn = conn;
    if (member.id === this.hostId) this.stopHostTimer();
    this.ghostTimers.get(member.id)?.();
    this.ghostTimers.delete(member.id);
    const seated = this.players.find((p) => p.id === member.id);
    if (seated) seated.dcAt = null;
    this.touch();
    const you: YouInfo = { id: member.id, token: member.token, role };
    conn.send(this.encode({ t: 'welcome', you, room: this.view() }));
    this.broadcast(member.id);
    this.plan();
    return you;
  }

  /** Se cayó la conexión. La persona sigue en la sala y puede volver con su token. */
  disconnect(id: string, conn: Conn) {
    const found = this.findById(id);
    if (!found || found.member.conn !== conn) return;
    found.member.conn = null;
    const seated = this.players.find((p) => p.id === id);
    if (seated) seated.dcAt = this.now();
    if (found.member.id === this.hostId) this.startHostTimer();
    if (found.role === 'spectator' || this.phase === 'lobby') this.startGhostTimer(found.member.id);
    this.touch();
    this.broadcast();
    this.plan();
  }

  /** Sale a propósito de la sala. */
  leave(id: string) {
    const spIdx = this.spectators.findIndex((s) => s.id === id);
    if (spIdx >= 0) {
      this.spectators.splice(spIdx, 1);
      this.touch();
      this.broadcast();
      return;
    }
    const idx = this.players.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const p = this.players[idx]!;

    p.conn = null; // ya no recibe más mensajes de la sala
    if (this.phase === 'playing') {
      p.left = true;
      p.pawns = new Array(PAWNS).fill(0);
      p.auto = false;
      this.emit({ type: 'leave', playerId: p.id });
      if (this.hostId === p.id) this.transferHost(p.id);
      const wasTurn = this.turn?.seat === idx;
      if (!this.checkEnd() && wasTurn) this.endTurn(false);
    } else {
      this.players.splice(idx, 1);
      if (this.hostId === p.id) this.transferHost(p.id);
    }
    this.touch();
    this.broadcast();
    this.plan();
  }

  /** ¿Queda alguna persona conectada? Sirve para recoger salas abandonadas. */
  hasConnectedHuman(): boolean {
    return this.players.some((p) => !p.bot && !p.left && p.conn) || this.spectators.some((s) => s.conn);
  }

  hasHuman(): boolean {
    return this.players.some((p) => !p.bot && !p.left) || this.spectators.length > 0;
  }

  // ============ Mensajes de los jugadores ============

  handle(id: string, msg: ClientMsg) {
    this.touch();
    switch (msg.t) {
      case 'ping':
        return;
      case 'leave':
        return this.leave(id);
      case 'sit':
        return this.sit(id);
      case 'config':
        return this.configure(id, msg.patch);
      case 'bot':
        return msg.op === 'add' ? this.addBot(id) : this.removeBot(id, msg.id);
      case 'kick':
        return this.kick(id, msg.id);
      case 'start':
        return this.start(id);
      case 'rematch':
        return this.rematch(id);
      case 'roll': {
        const seat = this.mySeat(id);
        const t = this.turn;
        if (!t || t.seat !== seat || this.phase !== 'playing') throw new RoomError('not-your-turn', 'No es tu turno.');
        if (t.step !== 'roll') throw new RoomError('phase', 'Ya tiraste el dado.');
        this.markActive(seat);
        return this.doRoll();
      }
      case 'move': {
        const seat = this.mySeat(id);
        const t = this.turn;
        if (!t || t.seat !== seat || this.phase !== 'playing') throw new RoomError('not-your-turn', 'No es tu turno.');
        if (t.step !== 'move') throw new RoomError('phase', 'Primero tira el dado.');
        if (!t.movable.includes(msg.pawn)) throw new RoomError('illegal', 'Ese peón no puede moverse.');
        this.markActive(seat);
        return this.doMove(msg.pawn);
      }
      default:
        throw new RoomError('bad-request', 'Mensaje no válido aquí.');
    }
  }

  // ============ Sala de espera ============

  private configure(id: string, patch: Partial<RoomOptions>) {
    this.requireHost(id);
    this.requireLobby();
    const next = { ...this.options };
    if (patch.board !== undefined) {
      if (!BOARDS.includes(patch.board)) throw new RoomError('bad-request', 'Tablero no válido.');
      if (patch.board < this.players.length) {
        throw new RoomError('illegal', `Hay ${this.players.length} jugadores: no caben en un tablero de ${patch.board}.`);
      }
      next.board = patch.board;
    }
    for (const k of ['endAtFirst', 'exactFinish', 'towers', 'autoSingle'] as const) {
      const v = patch[k];
      if (v !== undefined) {
        if (typeof v !== 'boolean') throw new RoomError('bad-request', 'Opción no válida.');
        next[k] = v;
      }
    }
    if (patch.turnSeconds !== undefined) {
      if (!(TURN_SECONDS_CHOICES as readonly number[]).includes(patch.turnSeconds)) {
        throw new RoomError('bad-request', 'Tiempo de turno no válido.');
      }
      next.turnSeconds = patch.turnSeconds;
    }
    const boardChanged = next.board !== this.options.board;
    this.options = next;
    if (boardChanged) {
      // Con otra forma de tablero cambian los brazos: se reparten de nuevo en orden de llegada.
      const order = seatOrder(next.board);
      this.players.forEach((p, i) => (p.arm = order[i]!));
    }
    this.broadcast();
  }

  private addBot(id: string) {
    this.requireHost(id);
    this.requireLobby();
    if (this.players.length >= this.options.board) throw new RoomError('full', 'No quedan lugares libres.');
    this.botCount++;
    const bot: Member = { id: newId(), token: '', name: this.uniqueName(`Bot ${this.botCount}`), conn: null };
    this.players.push(this.makePlayer(bot, true));
    this.broadcast();
  }

  private removeBot(id: string, botId: string) {
    this.requireHost(id);
    this.requireLobby();
    const idx = this.players.findIndex((p) => p.id === botId && p.bot);
    if (idx < 0) throw new RoomError('not-found', 'Ese bot no existe.');
    this.players.splice(idx, 1);
    this.broadcast();
  }

  private kick(id: string, targetId: string) {
    this.requireHost(id);
    if (targetId === id) throw new RoomError('illegal', 'No puedes expulsarte a ti mismo.');
    if (this.players.some((p) => p.id === targetId && p.bot)) return this.removeBot(id, targetId);
    const found = this.findById(targetId);
    if (!found) throw new RoomError('not-found', 'Esa persona no está en la sala.');
    const conn = found.member.conn;
    this.leave(targetId);
    if (conn) {
      conn.send(this.encode({ t: 'kicked' }));
      conn.close();
    }
  }

  /** Un espectador toma asiento si en la sala de espera quedó un hueco. */
  private sit(id: string) {
    this.requireLobby();
    const idx = this.spectators.findIndex((s) => s.id === id);
    if (idx < 0) throw new RoomError('illegal', 'Ya estás sentado.');
    if (this.players.length >= this.options.board) throw new RoomError('full', 'No quedan lugares libres.');
    const [m] = this.spectators.splice(idx, 1);
    this.players.push(this.makePlayer(m!, false));
    if (!this.hostId) this.hostId = m!.id;
    this.broadcast(); // el cambio de rol llega en el estado: el cliente lo deduce porque ahora figura entre los jugadores
  }

  // ============ Partida ============

  private start(id: string) {
    this.requireHost(id);
    this.requireLobby();
    if (this.players.length < 2) throw new RoomError('illegal', 'Hacen falta al menos 2 jugadores.');
    if (!this.players.some((p) => !p.bot)) throw new RoomError('illegal', 'Tiene que haber una persona jugando.');
    for (const p of this.players) this.resetPlayer(p);
    this.order = this.players.map((_, i) => i).sort((a, b) => this.players[a]!.arm - this.players[b]!.arm);
    this.ranked = 0;
    this.phase = 'playing';
    const first = this.order[randomInt(this.order.length)]!;
    this.emit({ type: 'start', playerId: this.players[first]!.id });
    this.beginTurn(first, 0);
    this.broadcast();
    this.plan();
  }

  private rematch(id: string) {
    this.requireHost(id);
    if (this.phase !== 'finished') throw new RoomError('phase', 'La partida todavía no ha terminado.');
    this.players = this.players.filter((p) => !p.left);
    for (const p of this.players) this.resetPlayer(p);
    this.phase = 'lobby';
    this.turn = null;
    this.stopTimer();
    if (!this.players.some((p) => p.id === this.hostId)) this.transferHost(null);
    this.broadcast();
  }

  private beginTurn(seat: number, sixes: number) {
    const p = this.players[seat]!;
    this.turn = { seat, step: 'roll', dice: null, sixes, movable: [], deadline: this.deadlineFor(p), extra: false };
  }

  private deadlineFor(p: Player): number | null {
    if (this.options.turnSeconds <= 0 || this.isAutomatic(p)) return null;
    return this.now() + this.options.turnSeconds * 1000;
  }

  private isAutomatic(p: Player) {
    return p.bot || p.auto || (!p.conn && !this.inGrace(p));
  }

  /** Se acaba de caer: se le espera un momento por si solo era un parpadeo o una recarga. */
  private inGrace(p: Player) {
    return !p.conn && p.dcAt !== null && this.now() - p.dcAt < this.timing.reconnectGrace;
  }

  private doRoll() {
    const t = this.turn!;
    const p = this.players[t.seat]!;
    const dice = this.rollDie();
    t.dice = dice;
    t.sixes = dice === 6 ? t.sixes + 1 : 0;
    this.emit({ type: 'roll', playerId: p.id, dice });

    if (t.sixes >= 3) {
      // Tres seises seguidos: se pierde el turno.
      this.emit({ type: 'pass', playerId: p.id, reason: 'triple-six' });
      t.movable = [];
      t.step = 'wait';
      t.extra = false;
      t.sixes = 0;
    } else {
      t.movable = legalMoves(this.options.board, this.options, p, dice);
      if (t.movable.length === 0) {
        this.emit({ type: 'pass', playerId: p.id, reason: 'no-moves' });
        t.step = 'wait';
        t.extra = dice === 6; // el 6 da otra tirada aunque no se pueda mover
      } else {
        t.step = 'move';
        t.deadline = this.deadlineFor(p);
      }
    }
    this.broadcast();
    this.plan();
  }

  private doMove(pawn: number) {
    const t = this.turn!;
    const p = this.players[t.seat]!;
    const dice = t.dice!;
    const res = applyMove(this.options.board, this.options, this.players, t.seat, pawn, dice);
    this.emit({
      type: 'move',
      playerId: p.id,
      pawn,
      from: res.from,
      to: res.to,
      captured: res.captured.map((c) => ({ playerId: this.players[c.seat]!.id, pawn: c.pawn, from: c.from })),
    });

    if (allHome(this.options.board, p)) {
      p.rank = ++this.ranked;
      this.emit({ type: 'finish', playerId: p.id, rank: p.rank });
    }
    if (!this.checkEnd()) {
      // Repite quien sacó 6, comió una pieza o metió un peón en la meta (si le quedan peones por mover).
      const extra = dice === 6 || res.captured.length > 0 || res.reachedHome;
      this.endTurn(extra && p.rank === null);
    }
    this.broadcast();
    this.plan();
  }

  /** Pasa el turno (o lo repite). `extra` = el mismo jugador vuelve a tirar. */
  private endTurn(extra: boolean) {
    const t = this.turn;
    if (!t) return;
    if (extra && !this.players[t.seat]!.left && this.players[t.seat]!.rank === null) {
      this.beginTurn(t.seat, t.sixes);
    } else {
      this.beginTurn(this.nextSeat(t.seat), 0);
    }
  }

  private nextSeat(from: number): number {
    const pos = this.order.indexOf(from);
    for (let i = 1; i <= this.order.length; i++) {
      const s = this.order[(pos + i) % this.order.length]!;
      const p = this.players[s]!;
      if (!p.left && p.rank === null) return s;
    }
    return from;
  }

  /** Termina la partida si ya no tiene sentido seguir. Devuelve true si terminó. */
  private checkEnd(): boolean {
    if (this.phase !== 'playing') return false;
    const active = this.players.filter((p) => !p.left && p.rank === null);
    const someoneWon = this.players.some((p) => p.rank !== null);
    const humansLeft = active.some((p) => !p.bot);
    if ((this.options.endAtFirst && someoneWon) || active.length <= 1 || !humansLeft) {
      this.finishGame();
      return true;
    }
    return false;
  }

  private finishGame() {
    // Los que no llegaron a la meta se ordenan por lo avanzados que iban.
    const rest = this.players
      .filter((p) => p.rank === null && !p.left)
      .sort((a, b) => b.pawns.reduce((s, x) => s + x, 0) - a.pawns.reduce((s, x) => s + x, 0));
    for (const p of rest) p.rank = ++this.ranked;
    this.phase = 'finished';
    this.turn = null;
    this.stopTimer();
    this.emit({ type: 'end' });
  }

  // ============ Temporizadores ============

  /** Decide qué debe pasar solo (bot, piloto automático, límite de tiempo) y lo programa. */
  private plan() {
    this.stopTimer();
    const t = this.turn;
    if (!t || this.phase !== 'playing') return;
    if (!this.hasConnectedHuman()) return; // sin nadie mirando, la partida se queda en pausa
    const p = this.players[t.seat]!;
    const auto = this.isAutomatic(p);
    if (!auto && !p.conn) {
      // En periodo de gracia: se vuelve a decidir cuando termine.
      this.setTimer(Math.max(0, p.dcAt! + this.timing.reconnectGrace - this.now()), () => this.plan());
      return;
    }
    if (!auto && t.deadline === null && t.step !== 'wait' && this.options.turnSeconds > 0) {
      // Volvió a conectarse a mitad de su turno: empieza a correr su tiempo.
      t.deadline = this.deadlineFor(p);
      this.broadcast();
    }
    const jitter = (ms: number) => (ms === 0 ? 0 : ms * (0.85 + Math.random() * 0.3));

    if (t.step === 'wait') {
      this.setTimer(jitter(this.timing.pass), () => {
        this.endTurn(t.extra);
        this.broadcast();
        this.plan();
      });
    } else if (t.step === 'roll') {
      if (auto) this.setTimer(jitter(this.timing.act), () => this.doRoll());
      else this.armDeadline(t, () => this.timeout());
    } else {
      const options = distinctMoves(p, t.movable);
      if (auto) {
        this.setTimer(jitter(this.timing.act), () => this.doMove(this.pickMove(p, t)));
      } else if (this.options.autoSingle && options.length === 1) {
        this.setTimer(jitter(this.timing.single), () => this.doMove(options[0]!));
      } else {
        this.armDeadline(t, () => this.timeout());
      }
    }
  }

  private armDeadline(t: Turn, fn: () => void) {
    if (t.deadline === null) return;
    this.setTimer(Math.max(0, t.deadline - this.now()), fn);
  }

  /** Se acabó el tiempo de un jugador: se juega por él y, si se repite, pasa a piloto automático. */
  private timeout() {
    const t = this.turn;
    if (!t) return;
    const p = this.players[t.seat]!;
    p.strikes++;
    if (p.strikes >= STRIKES_FOR_AUTO) p.auto = true;
    if (t.step === 'roll') this.doRoll();
    else if (t.step === 'move') this.doMove(this.pickMove(p, t));
  }

  private pickMove(p: Player, t: Turn): number {
    return chooseMove(this.options.board, this.options, this.players, t.seat, t.dice!, t.movable);
  }

  /** Quien actúa por su cuenta recupera el control y se le perdona el aviso. */
  private markActive(seat: number) {
    const p = this.players[seat]!;
    p.strikes = 0;
    p.auto = false;
  }

  private setTimer(ms: number, fn: () => void) {
    this.cancelTimer = this.schedule(ms, () => {
      this.cancelTimer = null;
      fn();
    });
  }

  private stopTimer() {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private startHostTimer() {
    this.stopHostTimer();
    this.cancelHostTimer = this.schedule(this.timing.hostGrace, () => {
      this.cancelHostTimer = null;
      const host = this.players.find((p) => p.id === this.hostId);
      if (host && !host.conn) {
        this.transferHost(host.id);
        this.broadcast();
      }
    });
  }

  /** Quien se desconecta en la sala de espera (o un espectador) y no vuelve a tiempo deja su lugar libre. */
  private startGhostTimer(id: string) {
    this.ghostTimers.get(id)?.();
    this.ghostTimers.set(
      id,
      this.schedule(this.timing.lobbyGrace, () => {
        this.ghostTimers.delete(id);
        const found = this.findById(id);
        if (!found || found.member.conn) return;
        if (found.role === 'player' && this.phase !== 'lobby') return;
        this.leave(id);
      }),
    );
  }

  private stopHostTimer() {
    this.cancelHostTimer?.();
    this.cancelHostTimer = null;
  }

  /** Libera todos los temporizadores (al borrar la sala). */
  dispose() {
    this.stopTimer();
    this.stopHostTimer();
    for (const cancel of this.ghostTimers.values()) cancel();
    this.ghostTimers.clear();
  }

  // ============ Utilidades ============

  private transferHost(leaving: string | null) {
    this.stopHostTimer();
    const next = this.players.find((p) => !p.bot && !p.left && p.conn && p.id !== leaving);
    this.hostId = next?.id ?? this.players.find((p) => !p.bot && !p.left && p.id !== leaving)?.id ?? null;
  }

  private requireHost(id: string) {
    if (id !== this.hostId) throw new RoomError('not-host', 'Solo el líder de la sala puede hacer eso.');
  }

  private requireLobby() {
    if (this.phase !== 'lobby') throw new RoomError('phase', 'La partida ya empezó.');
  }

  private mySeat(id: string): number {
    const i = this.players.findIndex((p) => p.id === id);
    if (i < 0) throw new RoomError('illegal', 'Eres espectador: solo puedes mirar.');
    return i;
  }

  private makePlayer(m: Member, bot: boolean): Player {
    return { ...m, arm: this.freeArm(), bot, pawns: new Array(PAWNS).fill(0), rank: null, left: false, auto: false, strikes: 0, dcAt: null };
  }

  private resetPlayer(p: Player) {
    p.pawns = new Array(PAWNS).fill(0);
    p.rank = null;
    p.left = false;
    p.auto = false;
    p.strikes = 0;
  }

  private freeArm(): number {
    const used = new Set(this.players.map((p) => p.arm));
    return seatOrder(this.options.board).find((a) => !used.has(a)) ?? 0;
  }

  private uniqueName(raw: string): string {
    const taken = new Set([...this.players, ...this.spectators].map((m) => m.name.toLowerCase()));
    if (!taken.has(raw.toLowerCase())) return raw;
    for (let n = 2; n < 100; n++) {
      const suffix = ` ${n}`;
      const cand = [...raw].slice(0, NAME_MAX - suffix.length).join('').trimEnd() + suffix;
      if (!taken.has(cand.toLowerCase())) return cand;
    }
    return raw;
  }

  private findById(id: string): { member: Member; role: YouInfo['role'] } | null {
    const p = this.players.find((x) => x.id === id && !x.bot);
    if (p) return { member: p, role: 'player' };
    const s = this.spectators.find((x) => x.id === id);
    return s ? { member: s, role: 'spectator' } : null;
  }

  private findByToken(token: string): { member: Member; role: YouInfo['role'] } | null {
    if (!token) return null;
    const p = this.players.find((x) => !x.bot && !x.left && x.token === token);
    if (p) return { member: p, role: 'player' };
    const s = this.spectators.find((x) => x.token === token);
    return s ? { member: s, role: 'spectator' } : null;
  }

  private touch() {
    this.lastActive = this.now();
  }

  private emit(ev: DistributiveOmit<GameEvent, 'seq'>) {
    this.pending.push({ ...ev, seq: ++this.seq } as GameEvent);
  }

  private encode(msg: ServerMsg) {
    return JSON.stringify(msg);
  }

  /** Envía el estado actual a todos (menos a `except`, que ya recibió su bienvenida). */
  private broadcast(except?: string) {
    const events = this.pending;
    this.pending = [];
    const raw = this.encode({ t: 'state', room: this.view(events) });
    for (const m of [...this.players, ...this.spectators]) {
      if (m.conn && m.id !== except) m.conn.send(raw);
    }
  }

  view(events: GameEvent[] = []): RoomView {
    const t = this.turn;
    return {
      code: this.code,
      phase: this.phase,
      options: { ...this.options },
      hostId: this.hostId,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        arm: p.arm,
        bot: p.bot,
        connected: p.bot || p.conn !== null,
        host: p.id === this.hostId,
        pawns: [...p.pawns],
        rank: p.rank,
        left: p.left,
        auto: p.auto,
      })),
      spectators: this.spectators.length,
      turn: t && {
        playerId: this.players[t.seat]!.id,
        step: t.step,
        dice: t.dice,
        movable: [...t.movable],
        sixes: t.sixes,
        deadline: t.deadline,
      },
      seq: this.seq,
      events,
      serverTime: this.now(),
    };
  }

  /** Datos públicos para GET /api/rooms/:code */
  info() {
    const host = this.players.find((p) => p.id === this.hostId);
    return {
      code: this.code,
      phase: this.phase,
      board: this.options.board as BoardSize,
      players: this.players.length,
      capacity: this.options.board,
      spectators: this.spectators.length,
      host: host?.name ?? null,
      joinable: this.phase === 'lobby' && this.players.length < this.options.board,
    };
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
