import { isPosInt, shuffle } from './util';
import type { Room, Player } from './room';
import type { BJHand, BJPublic, BJResult, BJSeat, Card, SeatStatus, Suit } from '../shared/protocol';

type RCard = { r: string; s: Suit };
interface Hand {
  cards: RCard[];
  bet: number;
  status: SeatStatus;
  result?: BJResult;
  delta?: number;
  doubled?: boolean;
  split?: boolean;
}
interface Seat {
  id: string;
  hands: Hand[];
  active: number;
  insurance: number;
  decided: boolean;
  delta?: number;
}

const BET_WINDOW = 15_000;
const INSURANCE_WINDOW = 10_000;
const TURN_WINDOW = 20_000;
const PAYOUT_WINDOW = 6_000;
const DEALER_STEP = 900;
const DECKS = 6;

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

function newShoe(): RCard[] {
  const cards: RCard[] = [];
  for (let d = 0; d < DECKS; d++)
    for (const s of SUITS) for (const r of RANKS) cards.push({ r, s });
  return shuffle(cards);
}

/** Puntos de una carta para comparar pares (el As cuenta 11; J, Q y K, 10). */
const points = (c: RCard) => (c.r === 'A' ? 11 : c.r === 'J' || c.r === 'Q' || c.r === 'K' ? 10 : Number(c.r));

export function handValue(cards: RCard[]): number {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === 'A') { aces++; total += 11; }
    else total += points(c);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

const betOf = (s: Seat) => s.hands.reduce((n, h) => n + h.bet, 0);

export class Blackjack {
  phase: BJPublic['phase'] = 'betting';
  seats: Seat[] = [];
  dealer: RCard[] = [];
  turn: string | null = null;
  private revealed = false;
  private deadline: number | null = null;
  private timer?: NodeJS.Timeout;
  private shoe: RCard[] = [];
  private fixedShoe = false;

  constructor(private room: Room) {
    // Ayuda para pruebas visuales: DEBUG_BJ_DECK="8S,6D,8H,10C,..." fija las primeras cartas. Sin la variable no hace nada.
    const dbg = process.env.DEBUG_BJ_DECK;
    if (dbg) {
      this.debugStack(dbg.split(',').map((c) => ({ r: c.trim().slice(0, -1), s: c.trim().slice(-1).toUpperCase() as Suit })));
    }
  }

  idle() {
    return this.phase === 'betting' && this.seats.length === 0;
  }

  /** Apuestas en juego que aún no se han pagado (para devolverlas si el servidor se reinicia). */
  refundable(): [string, number][] {
    return this.phase === 'payout' ? [] : this.seats.map((s) => [s.id, betOf(s) + s.insurance]);
  }

  dispose() {
    clearTimeout(this.timer);
  }

  /** Solo para pruebas: fija las próximas cartas (la primera de la lista es la primera que se reparte). */
  debugStack(cards: RCard[]) {
    this.shoe = [...cards].reverse();
    this.fixedShoe = true;
  }

  private setTimer(ms: number | null, fn?: () => void) {
    clearTimeout(this.timer);
    if (ms === null || !fn) { this.deadline = null; return; }
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
  }

  private draw(): RCard {
    if (this.shoe.length === 0) { this.shoe = newShoe(); this.fixedShoe = false; }
    return this.shoe.pop()!;
  }

  // ---------- Apuestas ----------
  bet(p: Player, amount: number): string | void {
    if (this.phase !== 'betting') return 'Ronda en curso, espera la siguiente.';
    if (!isPosInt(amount) || amount > p.chips) return 'No tienes fichas suficientes.';
    let seat = this.seats.find((s) => s.id === p.id);
    if (!seat) {
      seat = { id: p.id, hands: [{ cards: [], bet: 0, status: 'betting' }], active: 0, insurance: 0, decided: false };
      this.seats.push(seat);
    }
    seat.hands[0].bet += amount;
    p.chips -= amount;
    if (this.deadline === null) this.setTimer(BET_WINDOW, () => this.deal());
    this.checkAllBet();
    this.room.broadcast();
  }

  clear(p: Player): string | void {
    if (this.phase !== 'betting') return;
    const i = this.seats.findIndex((s) => s.id === p.id);
    if (i < 0) return;
    p.chips += betOf(this.seats[i]);
    this.seats.splice(i, 1);
    if (this.seats.length === 0) this.setTimer(null);
    else this.checkAllBet();
    this.room.broadcast();
  }

  private checkAllBet() {
    if (this.phase !== 'betting' || this.seats.length === 0) return;
    const everyoneIn = [...this.room.players.values()]
      .filter((p) => p.ws)
      .every((p) => this.seats.some((s) => s.id === p.id && betOf(s) > 0));
    if (everyoneIn) this.setTimer(700, () => this.deal());
  }

  // ---------- Reparto ----------
  private deal() {
    this.setTimer(null);
    this.seats = this.seats.filter((s) => betOf(s) > 0);
    if (this.seats.length === 0) return;
    if (!this.fixedShoe && this.shoe.length < 60) this.shoe = newShoe();
    this.phase = 'playing';
    this.revealed = false;
    this.dealer = [];
    for (const s of this.seats) {
      s.hands = [{ cards: [], bet: betOf(s), status: 'playing' }];
      s.active = 0;
      s.insurance = 0;
      s.decided = false;
    }
    for (let round = 0; round < 2; round++) {
      for (const s of this.seats) s.hands[0].cards.push(this.draw());
      this.dealer.push(this.draw());
    }
    for (const s of this.seats) if (handValue(s.hands[0].cards) === 21) s.hands[0].status = 'blackjack';

    // Con un As a la vista se ofrece el seguro antes de mirar la carta oculta.
    if (this.dealer[0].r === 'A') {
      this.phase = 'insurance';
      this.setTimer(INSURANCE_WINDOW, () => this.resolveInsurance());
      this.room.broadcast();
      return;
    }
    this.peekAndGo();
  }

  /** El crupier mira su carta oculta: si tiene Blackjack, la ronda termina ya. */
  private peekAndGo() {
    this.phase = 'playing';
    if (handValue(this.dealer) === 21) {
      this.revealed = true;
      this.settle();
      return;
    }
    this.advance();
  }

  // ---------- Seguro ----------
  insure(p: Player, take: boolean): string | void {
    if (this.phase !== 'insurance') return 'Ahora no se ofrece seguro.';
    const seat = this.seats.find((s) => s.id === p.id);
    if (!seat) return 'No estás en esta ronda.';
    if (seat.decided) return 'Ya has contestado.';
    if (take) {
      const cost = Math.floor(betOf(seat) / 2);
      if (cost < 1 || p.chips < cost) return 'No tienes fichas para el seguro.';
      p.chips -= cost;
      seat.insurance = cost;
    }
    seat.decided = true;
    this.room.broadcast();
    if (this.seats.every((s) => s.decided)) this.setTimer(600, () => this.resolveInsurance());
  }

  private resolveInsurance() {
    if (this.phase !== 'insurance') return;
    for (const s of this.seats) s.decided = true;
    this.peekAndGo();
  }

  // ---------- Turnos ----------
  private advance() {
    const seat = this.seats.find((s) => s.hands.some((h) => h.status === 'playing'));
    if (!seat) { this.dealerPlay(); return; }
    seat.active = seat.hands.findIndex((h) => h.status === 'playing');
    this.turn = seat.id;
    this.setTimer(TURN_WINDOW, () => this.act(seat.id, 'stand'));
    this.room.broadcast();
  }

  act(pid: string, action: 'hit' | 'stand' | 'double' | 'split'): string | void {
    if (this.phase !== 'playing' || this.turn !== pid) return 'No es tu turno.';
    const seat = this.seats.find((s) => s.id === pid);
    if (!seat) return;
    const hand = seat.hands[seat.active];
    const p = this.room.players.get(pid);

    if (action === 'hit') {
      hand.cards.push(this.draw());
      const t = handValue(hand.cards);
      if (t > 21) hand.status = 'bust';
      else if (t === 21) hand.status = 'stand';
    } else if (action === 'stand') {
      hand.status = 'stand';
    } else if (action === 'double') {
      if (hand.cards.length !== 2) return 'Solo puedes doblar con tus dos primeras cartas.';
      if (!p || p.chips < hand.bet) return 'No tienes fichas para doblar.';
      p.chips -= hand.bet;
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(this.draw());
      hand.status = handValue(hand.cards) > 21 ? 'bust' : 'stand';
    } else if (action === 'split') {
      const [a, b] = hand.cards;
      if (seat.hands.length !== 1 || hand.cards.length !== 2 || points(a) !== points(b)) return 'Solo puedes dividir un par.';
      if (!p || p.chips < hand.bet) return 'No tienes fichas para dividir.';
      p.chips -= hand.bet;
      const second: Hand = { cards: [hand.cards.pop()!], bet: hand.bet, status: 'playing', split: true };
      hand.split = true;
      hand.cards.push(this.draw());
      second.cards.push(this.draw());
      seat.hands.push(second);
      // Con ases solo se recibe una carta por mano; un 21 tras dividir se planta solo.
      for (const h of seat.hands) {
        if (a.r === 'A' || handValue(h.cards) === 21) h.status = 'stand';
      }
    } else {
      return 'Acción no válida.';
    }

    const next = seat.hands.findIndex((h) => h.status === 'playing');
    if (next >= 0) {
      seat.active = next;
      this.setTimer(TURN_WINDOW, () => this.act(pid, 'stand'));
      this.room.broadcast();
    } else {
      this.turn = null;
      this.advance();
    }
  }

  private dealerPlay() {
    this.phase = 'dealer';
    this.turn = null;
    this.revealed = true;
    this.setTimer(null);
    this.room.broadcast();
    const live = this.seats.some((s) => s.hands.some((h) => h.status === 'stand'));
    const step = () => {
      if (live && handValue(this.dealer) < 17) {
        this.dealer.push(this.draw());
        this.room.broadcast();
        this.timer = setTimeout(step, DEALER_STEP);
      } else {
        this.settle();
      }
    };
    this.timer = setTimeout(step, DEALER_STEP);
  }

  // ---------- Pagos ----------
  private settle() {
    this.phase = 'payout';
    this.turn = null;
    const d = handValue(this.dealer);
    const dealerBJ = this.dealer.length === 2 && d === 21;
    for (const seat of this.seats) {
      const p = this.room.players.get(seat.id);
      let back = 0; // fichas que vuelven al jugador
      let staked = seat.insurance;
      for (const hand of seat.hands) {
        const t = handValue(hand.cards);
        let result: BJResult;
        let handBack = 0;
        if (hand.status === 'blackjack') {
          if (dealerBJ) { result = 'push'; handBack = hand.bet; }
          else { result = 'blackjack'; handBack = Math.floor(hand.bet * 2.5); }
        } else if (hand.status === 'bust' || dealerBJ) {
          result = 'lose';
        } else if (d > 21 || t > d) {
          result = 'win'; handBack = hand.bet * 2;
        } else if (t === d) {
          result = 'push'; handBack = hand.bet;
        } else {
          result = 'lose';
        }
        hand.result = result;
        hand.delta = handBack - hand.bet;
        back += handBack;
        staked += hand.bet;
      }
      if (dealerBJ && seat.insurance > 0) back += seat.insurance * 3; // el seguro paga 2 a 1 (más lo apostado)
      seat.delta = back - staked;
      if (seat.delta > 0) this.room.noteWin(seat.id, seat.delta, 'Blackjack');
      if (p) {
        p.chips += back;
        const first = seat.hands[0];
        if (first.result === 'blackjack' && seat.hands.length === 1) this.room.addFeed(`${p.name} hizo Blackjack (+${seat.delta})`);
        else if (seat.delta >= 500) this.room.addFeed(`${p.name} ganó ${seat.delta} en el blackjack`);
      }
    }
    this.room.noteRound({
      game: 'blackjack',
      players: this.seats.map((s) => ({ pid: s.id, name: this.room.players.get(s.id)?.name ?? 'Jugador', score: s.delta ?? 0 })),
    });
    this.setTimer(PAYOUT_WINDOW, () => this.reset());
    this.room.broadcast();
  }

  private reset() {
    this.seats = [];
    this.dealer = [];
    this.revealed = false;
    this.phase = 'betting';
    this.turn = null;
    this.setTimer(null);
    this.room.broadcast();
  }

  // ---------- Jugadores que se van ----------
  onRemove(pid: string) {
    const i = this.seats.findIndex((s) => s.id === pid);
    if (i < 0) return;
    if (this.phase === 'betting') {
      this.seats.splice(i, 1);
      if (this.seats.length === 0) this.setTimer(null);
      else this.checkAllBet();
    } else if (this.phase === 'insurance') {
      this.seats[i].decided = true;
      if (this.seats.every((s) => s.decided)) this.setTimer(600, () => this.resolveInsurance());
    } else if (this.phase === 'playing') {
      const seat = this.seats[i];
      for (const h of seat.hands) if (h.status === 'playing') h.status = 'stand';
      if (this.turn === pid) { this.turn = null; this.advance(); }
    }
    // En dealer/payout la mano ya está decidida: se liquida con normalidad.
  }

  toPublic(): BJPublic {
    const seats: BJSeat[] = this.seats.map((s) => ({
      id: s.id,
      bet: betOf(s),
      hands: s.hands.map((h): BJHand => ({
        cards: h.cards, bet: h.bet, status: h.status, result: h.result, delta: h.delta, doubled: h.doubled, split: h.split,
      })),
      active: s.active,
      insurance: s.insurance,
      decided: s.decided,
      delta: s.delta,
    }));
    const dealer: Card[] = this.dealer.map((c, i) => (i === 1 && !this.revealed ? { hidden: true } : c));
    return {
      phase: this.phase,
      seats,
      dealer,
      turn: this.turn,
      timeLeft: this.deadline === null ? null : Math.max(0, this.deadline - Date.now()),
    };
  }
}
