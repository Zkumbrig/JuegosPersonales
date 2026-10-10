import { isPosInt, shuffle } from './util';
import type { Room, Player } from './room';
import { bestHand, splitPots, type PCard } from './pokerEval';
import {
  POKER_BB, POKER_BUYINS, POKER_SB,
  type Card, type PokerPublic, type PokerSeat, type Suit,
} from '../shared/protocol';

interface Seat {
  id: string;
  stack: number;
  bet: number; // ronda actual
  total: number; // toda la mano
  cards: PCard[];
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  acted: boolean;
  ready: boolean;
  gone: boolean; // se levantó a mitad de mano: su dinero sigue en el bote
  last?: string;
  hand?: string;
  delta?: number;
}

const TURN_WINDOW = 25_000;
const READY_WINDOW = 10_000;
const SHOWDOWN_TIME = 7_000;
const UNCONTESTED_TIME = 4_000;
const RUNOUT_STEP = 1_300;
const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const RANK_STR: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const toCard = (c: PCard): Card => ({ r: RANK_STR[c.r] ?? String(c.r), s: c.s });

function newDeck(): PCard[] {
  const d: PCard[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s });
  return shuffle(d);
}

export class Poker {
  phase: PokerPublic['phase'] = 'waiting';
  seats: Seat[] = [];
  board: PCard[] = [];
  toAct: string | null = null;
  currentBet = 0;
  minRaise = POKER_BB;
  private buttonId: string | null = null;
  private deck: PCard[] = [];
  private showCards = false;
  private deadline: number | null = null;
  private timer?: NodeJS.Timeout;

  constructor(private room: Room) {}

  idle() {
    return this.phase === 'waiting';
  }

  /** Fichas de la mesa de póker + lo ya apostado en una mano sin terminar. */
  refundable(): [string, number][] {
    const live = (STREETS as readonly string[]).includes(this.phase);
    return this.seats.map((s) => [s.id, s.stack + (live ? s.total : 0)]);
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private setTimer(ms: number | null, fn?: () => void, visible = true) {
    clearTimeout(this.timer);
    if (ms === null || !fn) { this.deadline = null; return; }
    this.deadline = visible ? Date.now() + ms : null;
    this.timer = setTimeout(fn, ms);
  }

  private nameOf(id: string) {
    return this.room.players.get(id)?.name ?? 'Alguien';
  }

  private live() {
    return this.seats.filter((s) => s.inHand && !s.folded && !s.gone);
  }

  // ---------- Sentarse / levantarse ----------
  sit(p: Player, buyin: number): string | void {
    const existing = this.seats.find((s) => s.id === p.id);
    if (existing) return existing.gone ? 'Espera a que termine la mano.' : 'Ya estás sentado.';
    if (!(POKER_BUYINS as readonly number[]).includes(buyin)) return 'Entrada no válida.';
    if (buyin > p.chips) return 'No tienes fichas suficientes.';
    p.chips -= buyin;
    this.seats.push({
      id: p.id, stack: buyin, bet: 0, total: 0, cards: [], inHand: false,
      folded: false, allIn: false, acted: false, ready: false, gone: false,
    });
    this.room.addFeed(`${p.name} se sentó a la mesa de póker`);
    this.room.broadcast();
  }

  stand(p: Player): string | void {
    const seat = this.seats.find((s) => s.id === p.id && !s.gone);
    if (seat) this.release(seat);
  }

  /** Devuelve las fichas de la mesa al jugador y lo saca de la partida. */
  private release(seat: Seat) {
    const p = this.room.players.get(seat.id);
    if (p) p.chips += seat.stack;
    seat.stack = 0;
    const midHand = seat.inHand && (STREETS as readonly string[]).includes(this.phase);
    if (!midHand && this.phase !== 'showdown') {
      this.seats = this.seats.filter((s) => s !== seat);
      this.checkReady();
      this.room.broadcast();
      return;
    }
    seat.gone = true;
    if (this.phase === 'showdown') { this.room.broadcast(); return; }
    seat.folded = true;
    seat.last = 'Se levanta';
    const live = this.live();
    if (live.length <= 1) { this.awardUncontested(live[0]); return; }
    if (this.toAct === seat.id) this.advance(seat.id);
    else this.room.broadcast();
  }

  /** Al cambiar de juego: todos recuperan sus fichas. */
  cashOutAll() {
    for (const s of this.seats) {
      const p = this.room.players.get(s.id);
      if (p) p.chips += s.stack;
    }
    this.seats = [];
    this.setTimer(null);
    this.phase = 'waiting';
    this.board = [];
  }

  onRemove(pid: string) {
    const seat = this.seats.find((s) => s.id === pid && !s.gone);
    if (seat) this.release(seat);
  }

  // ---------- Empezar la mano ----------
  ready(p: Player): string | void {
    if (this.phase !== 'waiting') return 'Hay una mano en curso.';
    const seat = this.seats.find((s) => s.id === p.id && !s.gone);
    if (!seat) return 'Siéntate primero.';
    seat.ready = true;
    this.checkReady();
    this.room.broadcast();
  }

  private checkReady() {
    if (this.phase !== 'waiting') return;
    const eligible = this.seats.filter((s) => !s.gone && s.stack > 0);
    if (eligible.filter((s) => s.ready).length < 2) { this.setTimer(null); return; }
    const everyone = eligible.filter((s) => this.room.players.get(s.id)?.ws).every((s) => s.ready);
    if (everyone) this.setTimer(700, () => this.startHand());
    else if (this.deadline === null) this.setTimer(READY_WINDOW, () => this.startHand());
  }

  private commit(seat: Seat, n: number) {
    seat.stack -= n;
    seat.bet += n;
    seat.total += n;
    if (seat.stack === 0) seat.allIn = true;
  }

  private startHand() {
    this.setTimer(null);
    const dealt = this.seats.filter((s) => !s.gone && s.ready && s.stack > 0);
    if (dealt.length < 2) { this.room.broadcast(); return; }
    this.deck = newDeck();
    this.board = [];
    this.showCards = false;
    for (const s of this.seats) {
      s.inHand = dealt.includes(s);
      s.bet = 0; s.total = 0; s.cards = [];
      s.folded = false; s.allIn = false; s.acted = false; s.ready = false;
      s.last = undefined; s.hand = undefined; s.delta = undefined;
    }
    const prev = this.buttonId ? dealt.findIndex((s) => s.id === this.buttonId) : -1;
    const bi = (prev + 1) % dealt.length;
    this.buttonId = dealt[bi].id;
    const n = dealt.length;
    const sb = n === 2 ? dealt[bi] : dealt[(bi + 1) % n];
    const bb = n === 2 ? dealt[(bi + 1) % 2] : dealt[(bi + 2) % n];
    this.commit(sb, Math.min(POKER_SB, sb.stack));
    this.commit(bb, Math.min(POKER_BB, bb.stack));
    sb.last = 'Ciega pequeña';
    bb.last = 'Ciega grande';
    this.currentBet = Math.max(sb.bet, bb.bet);
    this.minRaise = POKER_BB;
    for (let i = 0; i < 2; i++) for (const s of dealt) s.cards.push(this.deck.pop()!);
    this.phase = 'preflop';
    this.advance(bb.id);
  }

  // ---------- Turnos ----------
  private nextActor(fromId: string): Seat | null {
    const n = this.seats.length;
    const i = this.seats.findIndex((s) => s.id === fromId);
    for (let k = 1; k <= n; k++) {
      const s = this.seats[(i + k) % n];
      if (s.inHand && !s.folded && !s.gone && !s.allIn && (!s.acted || s.bet < this.currentBet)) return s;
    }
    return null;
  }

  private advance(fromId: string) {
    const next = this.nextActor(fromId);
    if (!next) { this.endRound(); return; }
    this.toAct = next.id;
    this.setTimer(TURN_WINDOW, () => this.timeout(next.id));
    this.room.broadcast();
  }

  private timeout(pid: string) {
    if (this.toAct !== pid) return;
    const seat = this.seats.find((s) => s.id === pid);
    if (!seat) return;
    this.act(pid, seat.bet === this.currentBet ? 'check' : 'fold');
  }

  act(pid: string, action: 'fold' | 'check' | 'call' | 'raise', amount?: number): string | void {
    if (!(STREETS as readonly string[]).includes(this.phase) || this.toAct !== pid) return 'No es tu turno.';
    const seat = this.seats.find((s) => s.id === pid);
    if (!seat) return;
    const toCall = this.currentBet - seat.bet;

    if (action === 'fold') {
      seat.folded = true;
      seat.last = 'Se retira';
    } else if (action === 'check') {
      if (toCall > 0) return 'No puedes pasar: hay una apuesta.';
      seat.acted = true;
      seat.last = 'Pasa';
    } else if (action === 'call') {
      if (toCall <= 0) { seat.acted = true; seat.last = 'Pasa'; }
      else {
        this.commit(seat, Math.min(toCall, seat.stack));
        seat.acted = true;
        seat.last = seat.allIn ? 'All-in' : 'Iguala';
      }
    } else if (action === 'raise') {
      if (!isPosInt(amount)) return 'Cantidad no válida.';
      const maxTo = seat.bet + seat.stack;
      const to = Math.min(amount, maxTo);
      if (to <= this.currentBet) return 'Tienes que superar la apuesta actual.';
      const minTo = this.currentBet + this.minRaise;
      if (to < minTo && to < maxTo) return `La subida mínima es a ${minTo}.`;
      const hadBet = this.currentBet > 0;
      const size = to - this.currentBet;
      this.commit(seat, to - seat.bet);
      if (size >= this.minRaise) {
        this.minRaise = size;
        for (const o of this.seats) {
          if (o !== seat && o.inHand && !o.folded && !o.allIn && !o.gone) o.acted = false;
        }
      }
      this.currentBet = to;
      seat.acted = true;
      seat.last = seat.allIn ? 'All-in' : hadBet ? 'Sube' : 'Apuesta';
    } else {
      return 'Acción no válida.';
    }

    const live = this.live();
    if (live.length === 1) { this.awardUncontested(live[0]); return; }
    this.advance(pid);
  }

  // ---------- Calles ----------
  private nextStreet() {
    const draw = (n: number) => { for (let i = 0; i < n; i++) this.board.push(this.deck.pop()!); };
    if (this.phase === 'preflop') { draw(3); this.phase = 'flop'; }
    else if (this.phase === 'flop') { draw(1); this.phase = 'turn'; }
    else if (this.phase === 'turn') { draw(1); this.phase = 'river'; }
  }

  private endRound() {
    this.toAct = null;
    this.setTimer(null);
    for (const s of this.seats) { s.bet = 0; s.acted = false; if (!s.folded) s.last = undefined; }
    this.currentBet = 0;
    this.minRaise = POKER_BB;
    if (this.phase === 'river') { this.showdown(); return; }
    const canBet = this.live().filter((s) => !s.allIn);
    if (canBet.length <= 1) { this.runout(); return; }
    this.nextStreet();
    this.advance(this.buttonId!);
  }

  /** Todos (o todos menos uno) están all-in: se reparten las cartas que faltan con suspense. */
  private runout() {
    this.showCards = this.live().length > 1;
    this.room.broadcast();
    const step = () => {
      if (this.phase === 'river') { this.showdown(); return; }
      this.nextStreet();
      this.room.broadcast();
      this.setTimer(RUNOUT_STEP, step, false);
    };
    this.setTimer(RUNOUT_STEP, step, false);
  }

  // ---------- Final de la mano ----------
  private showdown() {
    this.setTimer(null);
    this.toAct = null;
    this.phase = 'showdown';
    const live = this.live();
    this.showCards = live.length > 1;
    const inHand = this.seats.filter((s) => s.inHand);
    const evaluated = new Map<string, { score: number; name: string }>();
    for (const s of live) evaluated.set(s.id, bestHand([...s.cards, ...this.board]));
    const bi = inHand.findIndex((s) => s.id === this.buttonId);
    const order = [...inHand.slice(bi + 1), ...inHand.slice(0, bi + 1)].map((s) => s.id);
    const pay = splitPots(
      inHand.map((s) => ({ id: s.id, total: s.total, folded: s.folded, score: evaluated.get(s.id)?.score ?? 0 })),
      order,
    );
    let top: { id: string; gain: number } | null = null;
    for (const s of inHand) {
      const won = pay.get(s.id) ?? 0;
      s.stack += won;
      s.delta = won - s.total;
      if (s.delta > 0) this.room.noteWin(s.id, s.delta, 'Póker');
      s.hand = evaluated.get(s.id)?.name;
      if (s.delta > 0 && (!top || s.delta > top.gain)) top = { id: s.id, gain: s.delta };
    }
    if (top && top.gain >= 100) {
      this.room.addFeed(`${this.nameOf(top.id)} ganó ${top.gain} con ${evaluated.get(top.id)?.name.toLowerCase()}`);
    }
    this.room.noteRound();
    this.setTimer(SHOWDOWN_TIME, () => this.finishHand(), false);
    this.room.broadcast();
  }

  private awardUncontested(winner: Seat | undefined) {
    this.setTimer(null);
    this.toAct = null;
    this.phase = 'showdown';
    this.showCards = false;
    const pot = this.seats.reduce((n, s) => n + s.total, 0);
    for (const s of this.seats.filter((x) => x.inHand)) {
      const won = s === winner ? pot : 0;
      s.stack += won;
      s.delta = won - s.total;
    }
    if (winner && winner.delta! > 0) {
      this.room.noteWin(winner.id, winner.delta!, 'Póker');
      this.room.noteBluff(winner.id); // se llevó el bote sin enseñar cartas
    }
    this.room.noteRound();
    if (winner && winner.delta! >= 100) this.room.addFeed(`${this.nameOf(winner.id)} ganó ${winner.delta} sin enseñar cartas`);
    this.setTimer(UNCONTESTED_TIME, () => this.finishHand(), false);
    this.room.broadcast();
  }

  private finishHand() {
    for (const s of this.seats) {
      if (!s.gone && s.stack === 0) this.room.addFeed(`${this.nameOf(s.id)} se quedó sin fichas`);
    }
    this.seats = this.seats.filter((s) => !s.gone && s.stack > 0);
    for (const s of this.seats) {
      s.cards = []; s.inHand = false; s.bet = 0; s.total = 0;
      s.folded = false; s.allIn = false; s.acted = false; s.ready = false;
      s.last = undefined; s.hand = undefined; s.delta = undefined;
    }
    this.board = [];
    this.showCards = false;
    this.toAct = null;
    this.currentBet = 0;
    this.phase = 'waiting';
    this.setTimer(null);
    this.room.broadcast();
  }

  // ---------- Vista pública (las cartas privadas solo van a su dueño) ----------
  toPublic(forId: string | null): PokerPublic {
    const seats: PokerSeat[] = this.seats.map((s) => {
      const reveal = s.id === forId || (this.showCards && s.inHand && !s.folded);
      return {
        id: s.id,
        stack: s.stack,
        bet: s.bet,
        inHand: s.inHand,
        folded: s.folded,
        allIn: s.allIn,
        ready: s.ready,
        button: s.inHand && s.id === this.buttonId,
        cards: s.folded && s.id !== forId ? [] : s.cards.map((c) => (reveal ? toCard(c) : { hidden: true as const })),
        last: s.last,
        hand: s.hand,
        delta: s.delta,
      };
    });
    return {
      phase: this.phase,
      seats,
      board: this.board.map(toCard),
      pot: this.seats.reduce((n, s) => n + s.total, 0),
      toAct: this.toAct,
      currentBet: this.currentBet,
      minRaiseTo: this.currentBet + this.minRaise,
      timeLeft: this.deadline === null ? null : Math.max(0, this.deadline - Date.now()),
    };
  }
}
