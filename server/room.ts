import type { WebSocket } from 'ws';
import { Blackjack } from './blackjack';
import { Roulette } from './roulette';
import { Poker } from './poker';
import { Party } from './party';
import { Ludo } from './ludo';
import { spin } from './slots';
import { isPosInt } from './util';
import { profiles } from './profiles';
import {
  ACHIEVEMENTS, GAMES, type CasinoGame, LUDO_GAME, MIN_REBUY_BELOW, PARTY_GAMES, REACTIONS, START_CHIPS, isPartyId,
  type ClientMsg, type FeedItem, type GameId, type PartyLevel, type ReactionKind, type RoomPublic, type RoomStats, type ServerMsg,
} from '../shared/protocol';

const EMPTY_ROOM_TTL = 10 * 60_000;
const SLOT_ANIMATION_MS = 2_400;
/** Tiempo sin conexión antes de pasar el mando a otro jugador. */
const HOST_GRACE_MS = Number(process.env.HOST_GRACE_MS) || 10_000;

/** Lo mínimo para que una mesa sobreviva a un reinicio del servidor. Las rondas en curso no se guardan: sus apuestas se devuelven. */
export interface RoomSnap {
  code: string;
  hostId: string;
  game: GameId;
  locked: boolean;
  banned: string[];
  players: { id: string; name: string; avatar: number; chips: number; stats?: Partial<PlayerCounters> }[];
  startedAt?: number;
  rounds?: number;
  party: { level: PartyLevel; soft: boolean; tally: Record<string, number> };
}

/** Contadores de la noche de cada jugador (para el resumen). */
export interface PlayerCounters {
  rebuys: number;
  bestReflex: number | null;
  bigWin: number;
  bigWinGame: string;
  bluffs: number;
}

export class Player {
  chips = START_CHIPS;
  ws: WebSocket | null = null;
  stats: PlayerCounters = { rebuys: 0, bestReflex: null, bigWin: 0, bigWinGame: '', bluffs: 0 };
  constructor(public id: string, public name: string, public avatar: number) {}
}

export class Room {
  players = new Map<string, Player>();
  hostId = '';
  /** La zona Casino está activa salvo que el servidor arranque con CASINO=0 (para una versión de tienda de apps). */
  readonly casino = process.env.CASINO !== '0';
  /** Juegos de casino abiertos: los que se juegan contra la casa. El póker solo con POKER=1. */
  readonly casinoGames: CasinoGame[] = !this.casino ? [] : GAMES.map((g) => g.id).filter((id) => id !== 'poker' || process.env.POKER === '1');
  game: GameId = this.casino ? 'blackjack' : 'party';
  private feed: FeedItem[] = [];
  private feedSeq = 0;
  private spinning = new Set<string>();
  private reaper?: NodeJS.Timeout;
  private hostTimer?: NodeJS.Timeout;
  private flushing = false;
  locked = false;
  startedAt = Date.now();
  rounds = 0;
  private lastReact = new Map<string, number>();
  readonly banned = new Set<string>();
  /** Pantallas compartidas (TV): solo miran, no juegan ni cuentan como jugadores. */
  readonly screens = new Set<WebSocket>();
  readonly screenPids = new Set<string>();
  readonly bj = new Blackjack(this);
  readonly ro = new Roulette(this);
  readonly po = new Poker(this);
  readonly pa = new Party(this);
  readonly lu = new Ludo(this);

  constructor(public code: string, private onDestroy: (code: string) => void) {}

  // ---------- Conexión ----------
  attach(p: Player, ws: WebSocket) {
    if (p.ws && p.ws !== ws) p.ws.close(4000, 'replaced');
    p.ws = ws;
    clearTimeout(this.reaper);
    this.lu.onConnect(p.id);
    this.watchHost();
    this.broadcast();
  }

  detach(p: Player, ws: WebSocket) {
    if (p.ws !== ws) return; // ya fue reemplazado por una conexión nueva
    p.ws = null;
    if (this.players.get(p.id) !== p) return; // ya no está en la mesa (expulsado o salió)
    this.watchHost();
    if (![...this.players.values()].some((q) => q.ws)) {
      this.reaper = setTimeout(() => this.destroy(), EMPTY_ROOM_TTL);
    }
    this.lu.onDisconnect(p.id);
    this.pa.onDisconnect(); // se le espera unos segundos antes de seguir sin su respuesta
    this.broadcast();
  }

  remove(p: Player) {
    this.bj.onRemove(p.id);
    this.ro.onRemove(p.id);
    this.po.onRemove(p.id);
    this.players.delete(p.id);
    this.lu.onRemove(p.id);
    if (this.players.size === 0) { this.destroy(); return; }
    if (this.hostId === p.id) {
      const next = [...this.players.values()].find((q) => q.ws) ?? [...this.players.values()][0];
      this.hostId = next.id;
    }
    this.pa.onRemove(p.id); // después de borrarlo, para que ya no cuente como conectado
    this.broadcast();
  }

  destroy() {
    clearTimeout(this.reaper);
    clearTimeout(this.hostTimer);
    this.bj.dispose();
    this.ro.dispose();
    this.po.dispose();
    this.pa.dispose();
    this.lu.dispose();
    this.onDestroy(this.code);
  }

  // ---------- Estado ----------
  addFeed(text: string) {
    this.feed.push({ id: ++this.feedSeq, text });
    if (this.feed.length > 20) this.feed.shift();
  }

  private toPublic(): RoomPublic {
    return {
      code: this.code,
      game: this.game,
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, chips: p.chips, connected: !!p.ws,
        host: p.id === this.hostId, avatar: p.avatar,
      })),
      blackjack: this.bj.toPublic(),
      roulette: this.ro.toPublic(),
      poker: this.po.toPublic(null),
      party: this.pa.toPublic(null),
      ludo: this.lu.toPublic(),
      casino: this.casino,
      casinoGames: this.casinoGames,
      locked: this.locked,
      stats: this.toStats(),
      feed: this.feed.slice(-6),
    };
  }

  /**
   * Pide enviar el estado. Varias peticiones en el mismo instante se funden en un único envío,
   * así un cliente que mande mensajes sin parar no multiplica el trabajo del servidor.
   */
  broadcast() {
    if (this.flushing) return;
    this.flushing = true;
    setImmediate(() => {
      this.flushing = false;
      this.flush();
    });
  }

  private flush() {
    this.flushPlayers();
    this.flushScreens();
  }

  private flushScreens() {
    if (this.screens.size === 0) return;
    const json = JSON.stringify({ t: 'state', room: this.toPublic() } satisfies ServerMsg); // vista pública: sin cartas ni respuestas privadas
    for (const ws of this.screens) if (ws.readyState === 1) ws.send(json);
  }

  addScreen(ws: WebSocket, pid: string): string | void {
    if (this.screens.size >= 3) return 'Ya hay 3 pantallas conectadas a esta mesa.';
    this.screens.add(ws);
    this.screenPids.add(pid);
    ws.send(JSON.stringify({ t: 'state', room: this.toPublic() } satisfies ServerMsg));
  }

  removeScreen(ws: WebSocket) {
    this.screens.delete(ws);
  }

  private flushPlayers() {
    const base = this.toPublic();
    // Salvo en el póker y la fiesta (cartas y respuestas privadas), todos reciben el mismo
    // estado: se serializa una sola vez.
    const personal = this.game === 'poker' || isPartyId(this.game);
    const shared = personal ? null : JSON.stringify({ t: 'state', room: base } satisfies ServerMsg);
    for (const p of this.players.values()) {
      if (p.ws?.readyState !== 1) continue;
      p.ws.send(
        shared ??
          JSON.stringify({
            t: 'state',
            room: { ...base, poker: this.po.toPublic(p.id), party: this.pa.toPublic(p.id) },
          } satisfies ServerMsg),
      );
    }
  }

  send(p: Player, msg: ServerMsg) {
    if (p.ws?.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  // ---------- Mensajes de juego ----------
  handle(p: Player, m: ClientMsg) {
    if (this.players.get(p.id) !== p) return; // alguien que ya no está en la mesa
    try {
      const err = this.dispatch(p, m);
      if (err) this.send(p, { t: 'err', msg: err });
    } catch (e) {
      console.error('[room ' + this.code + '] error en', m.t, e);
      this.send(p, { t: 'err', msg: 'Algo ha fallado. Inténtalo de nuevo.' });
    }
  }

  private dispatch(p: Player, m: ClientMsg): string | void {
    switch (m.t) {
      case 'game': return this.setGame(p, m.game);
      case 'rebuy': return this.rebuy(p);
      case 'bj:bet': return this.onlyIn('blackjack') ?? this.bj.bet(p, m.amount);
      case 'bj:clear': return this.onlyIn('blackjack') ?? this.bj.clear(p);
      case 'bj:hit': return this.onlyIn('blackjack') ?? this.bj.act(p.id, 'hit');
      case 'bj:stand': return this.onlyIn('blackjack') ?? this.bj.act(p.id, 'stand');
      case 'bj:double': return this.onlyIn('blackjack') ?? this.bj.act(p.id, 'double');
      case 'bj:split': return this.onlyIn('blackjack') ?? this.bj.act(p.id, 'split');
      case 'bj:insure': return this.onlyIn('blackjack') ?? this.bj.insure(p, !!m.take);
      case 'ro:bet': return this.onlyIn('roulette') ?? this.ro.bet(p, m.kind, m.value, m.amount);
      case 'ro:rebet': return this.onlyIn('roulette') ?? this.ro.rebet(p);
      case 'ro:double': return this.onlyIn('roulette') ?? this.ro.double(p);
      case 'ro:undo': return this.onlyIn('roulette') ?? this.ro.undo(p);
      case 'ro:clear': return this.onlyIn('roulette') ?? this.ro.clear(p);
      case 'sl:spin': return this.onlyIn('slots') ?? this.slotSpin(p, m.bet);
      case 'po:sit': return this.onlyIn('poker') ?? this.po.sit(p, m.buyin);
      case 'po:stand': return this.onlyIn('poker') ?? this.po.stand(p);
      case 'po:ready': return this.onlyIn('poker') ?? this.po.ready(p);
      case 'po:act': return this.onlyIn('poker') ?? this.po.act(p.id, m.action, m.amount);
      case 'react': return this.react(p, m.kind);
      case 'profile:get': return this.send(p, { t: 'profile', profile: profiles.publicOf(p.id) });
      case 'room:kick': return this.kick(p, String(m.pid));
      case 'room:lock': return this.setLocked(p, !!m.locked);
      case 'lu:config': return this.onlyIn('ludo') ?? this.lu.config(p, m.patch ?? {});
      case 'lu:start': return this.onlyIn('ludo') ?? this.lu.start(p);
      case 'lu:roll': return this.onlyIn('ludo') ?? this.lu.roll(p);
      case 'lu:move': return this.onlyIn('ludo') ?? this.lu.move(p, Number(m.pawn));
      case 'lu:reset': return this.onlyIn('ludo') ?? this.lu.reset(p);
      case 'pa:level': return this.hostParty(p) ?? this.pa.setLevel(m.level);
      case 'pa:soft': return this.hostParty(p) ?? this.pa.setSoft(m.soft);
      case 'pa:next': return this.inParty() ?? this.pa.next(p);
      case 'pa:reveal': return this.inParty() ?? this.pa.forceReveal(p);
      case 'pa:answer': return this.inParty() ?? this.pa.answer(p, String(m.value));
      case 'pa:tap': return this.inParty() ?? this.pa.tap(p, Number(m.ms));
    }
  }

  private onlyIn(game: GameId): string | void {
    if (this.game !== game) return 'Esa mesa no está activa.';
  }

  // ---------- Anfitrión, expulsiones y cierre ----------
  /** Si el anfitrión no está conectado, tras un margen el mando pasa al siguiente jugador conectado. */
  private watchHost() {
    clearTimeout(this.hostTimer);
    if (this.players.get(this.hostId)?.ws) return;
    this.hostTimer = setTimeout(() => this.electHost(), HOST_GRACE_MS);
  }

  private electHost() {
    if (this.players.get(this.hostId)?.ws) return;
    const next = [...this.players.values()].find((q) => q.ws);
    if (!next) return; // nadie conectado: el mando se decide cuando vuelva alguien
    this.hostId = next.id;
    this.addFeed(`${next.name} es ahora el anfitrión`);
    this.broadcast();
  }

  private kick(p: Player, id: string): string | void {
    if (p.id !== this.hostId) return 'Solo el anfitrión puede expulsar.';
    const target = this.players.get(id);
    if (!target || target === p) return 'Jugador no válido.';
    const ws = target.ws;
    this.banned.add(id);
    this.addFeed(`${target.name} ha sido expulsado`);
    this.remove(target);
    if (ws) {
      ws.send(JSON.stringify({ t: 'kicked' } satisfies ServerMsg));
      ws.close(4001, 'kicked');
    }
  }

  private setLocked(p: Player, locked: boolean): string | void {
    if (p.id !== this.hostId) return 'Solo el anfitrión puede cerrar la mesa.';
    this.locked = locked;
    this.addFeed(locked ? 'La mesa está cerrada a nuevos jugadores' : 'La mesa vuelve a estar abierta');
    this.broadcast();
  }

  // ---------- Estadísticas de la noche y reacciones ----------
  noteRound() {
    this.rounds++;
    for (const p of this.players.values()) {
      if (!p.ws) continue;
      profiles.bump(p.id, 'rounds');
      this.unlocks(p.id);
    }
  }

  /** Alguien bebe (o pierde un punto): cuenta para su perfil. */
  noteDrink(pid: string) {
    profiles.bump(pid, 'drinks');
    this.unlocks(pid);
  }

  /** Entra por primera vez en esta mesa (no al reconectar). */
  welcome(p: Player) {
    profiles.newNight(p.id, p.name);
    this.unlocks(p.id);
  }

  private unlocks(pid: string) {
    const p = this.players.get(pid);
    for (const id of profiles.check(pid)) {
      const def = ACHIEVEMENTS.find((a) => a.id === id);
      if (p) {
        this.send(p, { t: 'achievement', id });
        if (def) this.addFeed(`${p.name} desbloqueó «${def.name}»`);
      }
    }
  }

  noteWin(pid: string, amount: number, game: string) {
    const p = this.players.get(pid);
    if (p && amount > p.stats.bigWin) { p.stats.bigWin = amount; p.stats.bigWinGame = game; }
    profiles.win(pid, amount, game);
    this.unlocks(pid);
  }

  noteBluff(pid: string) {
    const p = this.players.get(pid);
    if (p) p.stats.bluffs++;
    profiles.bump(pid, 'bluffs');
    this.unlocks(pid);
  }

  noteReflex(pid: string, ms: number) {
    const p = this.players.get(pid);
    if (p && (p.stats.bestReflex === null || ms < p.stats.bestReflex)) p.stats.bestReflex = ms;
    profiles.reflex(pid, ms);
    this.unlocks(pid);
  }

  private toStats(): RoomStats {
    const back = this.refunds();
    return {
      startedAt: this.startedAt,
      rounds: this.rounds,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        drinks: this.pa.tallyOf(p.id),
        bestReflex: p.stats.bestReflex,
        bigWin: p.stats.bigWin,
        bigWinGame: p.stats.bigWinGame,
        rebuys: p.stats.rebuys,
        bluffs: p.stats.bluffs,
        worth: p.chips + (back.get(p.id) ?? 0),
      })),
    };
  }

  /** Reacciones efímeras: no forman parte del estado, solo se reenvían a la mesa. */
  private react(p: Player, kind: string): string | void {
    if (!(REACTIONS as readonly string[]).includes(kind)) return;
    const now = Date.now();
    if (now - (this.lastReact.get(p.id) ?? 0) < 250) return; // sin spam
    this.lastReact.set(p.id, now);
    const json = JSON.stringify({ t: 'react', from: p.id, kind: kind as ReactionKind } satisfies ServerMsg);
    for (const q of this.players.values()) if (q.ws?.readyState === 1) q.ws.send(json);
    for (const ws of this.screens) if (ws.readyState === 1) ws.send(json);
  }

  // ---------- Persistencia ----------
  /** Estado mínimo de la mesa. Lo que está apostado en rondas sin terminar se devuelve a su dueño. */
  /** Fichas que están en rondas sin terminar (apostadas o sentadas en el póker), por jugador. */
  private refunds(): Map<string, number> {
    const back = new Map<string, number>();
    for (const [id, n] of [...this.bj.refundable(), ...this.ro.refundable(), ...this.po.refundable()]) {
      back.set(id, (back.get(id) ?? 0) + n);
    }
    return back;
  }

  toSnapshot(): RoomSnap {
    const back = this.refunds();
    return {
      startedAt: this.startedAt,
      rounds: this.rounds,
      code: this.code,
      hostId: this.hostId,
      game: this.game,
      locked: this.locked,
      banned: [...this.banned],
      players: [...this.players.values()].map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar, chips: p.chips + (back.get(p.id) ?? 0), stats: { ...p.stats },
      })),
      party: this.pa.snapshot(),
    };
  }

  static restore(s: RoomSnap, onDestroy: (code: string) => void): Room {
    const r = new Room(s.code, onDestroy);
    r.hostId = s.hostId;
    r.locked = !!s.locked;
    for (const b of s.banned ?? []) r.banned.add(String(b));
    for (const sp of s.players) {
      const p = new Player(String(sp.id), String(sp.name).slice(0, 16), Number(sp.avatar) || 0);
      p.chips = Number.isFinite(sp.chips) ? Math.max(0, Math.floor(sp.chips)) : START_CHIPS;
      Object.assign(p.stats, sp.stats ?? {});
      r.players.set(p.id, p);
    }
    if (r.players.size === 0) throw new Error('mesa vacía');
    if (!r.players.has(r.hostId)) r.hostId = [...r.players.keys()][0];
    // Una mesa antigua con un juego que ya no está disponible vuelve al primero que sí lo está (o a Fiesta sin casino).
    r.game = GAMES.some((g) => g.id === s.game) && !r.casinoGames.includes(s.game as CasinoGame) ? (r.casinoGames[0] ?? 'party') : s.game;
    if (Number.isFinite(s.startedAt)) r.startedAt = Number(s.startedAt);
    if (Number.isFinite(s.rounds)) r.rounds = Number(s.rounds);
    r.pa.restore(s.party);
    // Nadie está conectado todavía: si nadie vuelve, la mesa se limpia sola.
    r.reaper = setTimeout(() => r.destroy(), EMPTY_ROOM_TTL);
    return r;
  }

  /** Los juegos de fiesta (no el menú) */
  private inParty(): string | void {
    if (!PARTY_GAMES.some((g) => g.id === this.game)) return 'Esa partida no está activa.';
  }

  private hostParty(p: Player): string | void {
    if (p.id !== this.hostId) return 'Solo el anfitrión cambia los ajustes.';
    if (!isPartyId(this.game)) return 'Esos ajustes son de la zona Fiesta.';
  }

  private setGame(p: Player, game: GameId): string | void {
    if (p.id !== this.hostId) return 'Solo el anfitrión cambia de juego.';
    const known = GAMES.some((g) => g.id === game) || PARTY_GAMES.some((g) => g.id === game) || game === 'party' || game === 'ludo';
    if (!known) return 'Juego no válido.';
    if (GAMES.some((g) => g.id === game) && !this.casinoGames.includes(game as CasinoGame)) return 'Ese juego no está disponible.';
    if (game === this.game) return;
    if (!this.bj.idle() || !this.ro.idle() || !this.po.idle()) return 'Espera a que termine la ronda en curso.';
    if (!this.lu.idle()) return 'Hay una partida de Ludo en curso: termínala o cancélala antes de cambiar.';
    if (this.game === 'poker') this.po.cashOutAll(); // todos recuperan sus fichas de la mesa
    if (this.game === 'ludo') this.lu.back(); // el Ludo vuelve a su preparación
    this.game = game;
    this.pa.reset(); // cada juego de fiesta empieza desde cero (se conserva el marcador)
    const name = [...GAMES, ...PARTY_GAMES, LUDO_GAME].find((g) => g.id === game)?.name;
    if (name) this.addFeed(`La mesa cambió a ${name}`);
    this.broadcast();
  }

  private rebuy(p: Player): string | void {
    if (!this.casino) return 'El casino está desactivado.';
    if (p.chips >= MIN_REBUY_BELOW) return 'Aún te quedan fichas.';
    p.chips = START_CHIPS;
    p.stats.rebuys++;
    profiles.bump(p.id, 'rebuys');
    this.unlocks(p.id);
    this.addFeed(`${p.name} pidió un préstamo al banco`);
    this.broadcast();
  }

  private slotSpin(p: Player, bet: number): string | void {
    if (!isPosInt(bet) || bet > p.chips) return 'No tienes fichas suficientes.';
    if (this.spinning.has(p.id)) return 'Los rodillos aún giran.';
    this.spinning.add(p.id);
    p.chips -= bet;
    const { reels, mult } = spin();
    this.noteRound();
    const win = bet * mult;
    this.send(p, { t: 'sl:result', reels, bet, win });
    this.broadcast();
    // El premio se acredita cuando termina la animación, para no destripar el resultado.
    setTimeout(() => {
      this.spinning.delete(p.id);
      p.chips += win;
      if (win > bet) this.noteWin(p.id, win - bet, 'Tragaperras');
      if (mult >= 50) this.addFeed(`${p.name} ganó ${win} en la tragaperras`);
      this.broadcast();
    }, SLOT_ANIMATION_MS);
  }
}
