// Póker sin apuestas: Texas Hold'em donde gana la mejor mano. Sin fichas ni ciegas.
// Se reparten 2 cartas privadas y salen 5 comunitarias por fases (flop, turn, river). En cada fase cada
// jugador decide "Seguir" o "Retirarme"; al final gana la mejor mano entre quienes siguen (o el único que queda).
// Se lleva un marcador de victorias de la noche.

import { shuffle } from './util';
import type { Room, Player } from './room';
import { bestHand, type PCard } from './pokerEval';
import type { Card, FreePokerPublic, FreePokerSeat, Suit } from '../shared/protocol';

interface Seat {
  id: string;
  ready: boolean;
  inHand: boolean;
  folded: boolean;
  decided: boolean;
  cards: PCard[];
  hand?: string;
  won?: boolean;
  wins: number;
  /** Se levantó a mitad de mano: sigue (retirado) hasta que acabe y luego se va. */
  left?: boolean;
}

const STREETS = ['preflop', 'flop', 'turn', 'river'] as const;
const DECIDE_TIME = 20_000;
const READY_WINDOW = 10_000;
const SHOWDOWN_TIME = 8_000;
const UNCONTESTED_TIME = 4_000;
const MAX_SEATS = 8;

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const RANK_STR: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const toCard = (c: PCard): Card => ({ r: RANK_STR[c.r] ?? String(c.r), s: c.s });

function newDeck(): PCard[] {
  const d: PCard[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push({ r, s });
  return shuffle(d);
}

export class FreePoker {
  phase: FreePokerPublic['phase'] = 'waiting';
  seats: Seat[] = [];
  board: PCard[] = [];
  winners: string[] = [];
  note: string | null = null;
  hands = 0;
  private deck: PCard[] = [];
  private revealAll = false;
  private deadline: number | null = null;
  private timer?: NodeJS.Timeout;

  constructor(private room: Room) {}

  /** Se puede cambiar de juego (no hay una mano en curso). */
  idle() {
    return this.phase === 'waiting' || this.phase === 'showdown';
  }

  dispose() {
    clearTimeout(this.timer);
  }

  /** Al cambiar de juego la mesa se vacía (el marcador de victorias se pierde con ella). */
  reset() {
    this.setTimer(null);
    this.seats = [];
    this.board = [];
    this.winners = [];
    this.note = null;
    this.phase = 'waiting';
  }

  private setTimer(ms: number | null, fn?: () => void) {
    clearTimeout(this.timer);
    if (ms === null || !fn) { this.deadline = null; return; }
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
  }

  private nameOf(id: string) {
    return this.room.players.get(id)?.name ?? 'Alguien';
  }

  private live() {
    return this.seats.filter((s) => s.inHand && !s.folded);
  }

  // ---------- Sentarse y empezar ----------
  sit(p: Player): string | void {
    if (this.seats.some((s) => s.id === p.id)) return 'Ya estás sentado.';
    if (this.seats.length >= MAX_SEATS) return 'La mesa está llena.';
    this.seats.push({ id: p.id, ready: false, inHand: false, folded: false, decided: false, cards: [], wins: 0 });
    this.room.addFeed(`${p.name} se sentó a jugar al póker`);
    this.room.broadcast();
  }

  stand(p: Player): string | void {
    this.leave(p.id);
  }

  onRemove(pid: string) {
    this.leave(pid);
  }

  private leave(pid: string) {
    const seat = this.seats.find((s) => s.id === pid);
    if (!seat) return;
    const midHand = seat.inHand && (STREETS as readonly string[]).includes(this.phase);
    if (!midHand) {
      this.seats = this.seats.filter((s) => s !== seat);
      this.checkReady();
      this.room.broadcast();
      return;
    }
    seat.folded = true;
    seat.decided = true;
    seat.left = true;
    this.afterDecision();
  }

  ready(p: Player): string | void {
    if (this.phase !== 'waiting') return 'Hay una mano en curso.';
    const seat = this.seats.find((s) => s.id === p.id);
    if (!seat) return 'Siéntate primero.';
    seat.ready = true;
    this.checkReady();
    this.room.broadcast();
  }

  private checkReady() {
    if (this.phase !== 'waiting') return;
    const ready = this.seats.filter((s) => s.ready);
    if (ready.length < 2) { this.setTimer(null); return; }
    const everyone = this.seats.filter((s) => this.room.players.get(s.id)?.ws).every((s) => s.ready);
    this.setTimer(everyone ? 1_200 : READY_WINDOW, () => this.start());
  }

  private start() {
    const players = this.seats.filter((s) => s.ready);
    if (players.length < 2) { this.setTimer(null); return; }
    this.deck = newDeck();
    this.board = [];
    this.winners = [];
    this.note = null;
    this.revealAll = false;
    for (const s of this.seats) {
      s.inHand = s.ready;
      s.folded = false;
      s.decided = false;
      s.hand = undefined;
      s.won = undefined;
      s.cards = s.inHand ? [this.deck.pop()!, this.deck.pop()!] : [];
    }
    this.phase = 'preflop';
    this.hands++;
    this.setTimer(DECIDE_TIME, () => this.timeout());
    this.room.broadcast();
  }

  // ---------- Decisiones ----------
  choose(p: Player, stay: boolean): string | void {
    if (!(STREETS as readonly string[]).includes(this.phase)) return 'No hay una mano en curso.';
    const seat = this.seats.find((s) => s.id === p.id);
    if (!seat || !seat.inHand || seat.folded) return 'No estás en esta mano.';
    if (seat.decided) return 'Ya elegiste. Espera al resto.';
    seat.decided = true;
    if (!stay) seat.folded = true;
    this.afterDecision();
  }

  /** Se acabó el tiempo: quien no contestó sigue en la mano. */
  private timeout() {
    for (const s of this.live()) s.decided = true;
    this.afterDecision();
  }

  private afterDecision() {
    const live = this.live();
    if (live.length <= 1) { this.awardUncontested(live[0]); return; }
    if (live.every((s) => s.decided)) this.nextStreet();
    else this.room.broadcast();
  }

  private nextStreet() {
    const i = (STREETS as readonly string[]).indexOf(this.phase);
    if (i === STREETS.length - 1) { this.showdown(); return; }
    const next = STREETS[i + 1]!;
    const n = next === 'flop' ? 3 : 1;
    for (let k = 0; k < n; k++) this.board.push(this.deck.pop()!);
    this.phase = next;
    for (const s of this.live()) s.decided = false;
    this.setTimer(DECIDE_TIME, () => this.timeout());
    this.room.broadcast();
  }

  // ---------- Final de la mano ----------
  private showdown() {
    const live = this.live();
    let best = -1;
    for (const s of live) {
      const h = bestHand([...s.cards, ...this.board]);
      s.hand = h.name;
      if (h.score > best) best = h.score;
    }
    const winners = live.filter((s) => bestHand([...s.cards, ...this.board]).score === best);
    this.finish(winners, true);
  }

  private awardUncontested(winner: Seat | undefined) {
    if (!winner) { this.finish([], false); return; }
    this.note = `${this.nameOf(winner.id)} gana: los demás se retiraron`;
    this.finish([winner], false);
  }

  private finish(winners: Seat[], reveal: boolean) {
    this.revealAll = reveal;
    this.phase = 'showdown';
    this.winners = winners.map((s) => s.id);
    for (const s of winners) {
      s.won = true;
      s.wins++;
    }
    if (winners.length) {
      const names = winners.map((s) => this.nameOf(s.id)).join(' y ');
      this.room.addFeed(winners.length > 1 ? `${names} empatan en el póker` : `${names} ganó la mano de póker`);
    }
    // Sin cartas de personas que ya se fueron
    this.room.noteRound({
      game: 'freepoker',
      players: this.seats.filter((s) => s.inHand).map((s) => ({ pid: s.id, name: this.nameOf(s.id), rank: s.won ? 1 : 2 })),
    });
    this.seats = this.seats.filter((s) => !s.left && this.room.players.has(s.id));
    this.setTimer(reveal ? SHOWDOWN_TIME : UNCONTESTED_TIME, () => this.backToWaiting());
    this.room.broadcast();
  }

  private backToWaiting() {
    this.phase = 'waiting';
    this.board = [];
    for (const s of this.seats) {
      s.ready = false;
      s.inHand = false;
      s.folded = false;
      s.decided = false;
      s.cards = [];
      s.hand = undefined;
      s.won = undefined;
    }
    this.winners = [];
    this.note = null;
    this.setTimer(null);
    this.room.broadcast();
  }

  // ---------- Vista pública (las cartas privadas solo van a su dueño) ----------
  toPublic(forId: string | null): FreePokerPublic {
    const seats: FreePokerSeat[] = this.seats.map((s) => {
      const reveal = s.id === forId || (this.revealAll && s.inHand && !s.folded);
      return {
        id: s.id,
        ready: s.ready,
        inHand: s.inHand,
        folded: s.folded,
        decided: s.decided,
        cards: s.folded && s.id !== forId ? [] : s.cards.map((c) => (reveal ? toCard(c) : { hidden: true as const })),
        hand: s.hand,
        won: s.won,
        wins: s.wins,
      };
    });
    return {
      phase: this.phase,
      seats,
      board: this.board.map(toCard),
      timeLeft: this.deadline === null ? null : Math.max(0, this.deadline - Date.now()),
      winners: this.winners,
      note: this.note,
      hands: this.hands,
    };
  }
}
