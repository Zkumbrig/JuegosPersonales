import { rnd, shuffle } from './util';
import type { Room, Player } from './room';
import { DARES, KING_RULES, LIKELY, NEVER, TRUTHS, WOULD, type Item } from './content';
import type { PartyGame, PartyLevel, PartyPublic, Suit } from '../shared/protocol';

const REVEAL_DELAY = 700;
const WAIT_MIN = 2_000;
const WAIT_SPAN = 3_500;
const GO_WINDOW = 4_000;
const DISCONNECT_GRACE = 8_000;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

function newDeck() {
  const d: { r: string; s: Suit }[] = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  return shuffle(d);
}

export class Party {
  level: PartyLevel = 1;
  soft = false;
  phase: PartyPublic['phase'] = 'idle';
  round = 0;
  prompt: string | null = null;
  options: [string, string] | null = null;
  kind: 'truth' | 'dare' | null = null;
  target: string | null = null;
  resolved: 'done' | 'drink' | null = null;
  rule: string | null = null;
  card: { r: string; s: Suit } | null = null;
  kings = 0;
  private answers = new Map<string, string>();
  private picks: Record<string, string> | null = null;
  private drinkers: string[] = [];
  private times: PartyPublic['times'] = null;
  private tally = new Map<string, number>();
  private decks = new Map<string, number[]>();
  private lastDrawn = new Map<string, number>();
  private reaction = new Map<string, number | 'early'>();
  private kingsDeck: { r: string; s: Suit }[] = [];
  private lastTarget: string | null = null;
  private timer?: NodeJS.Timeout;
  private grace?: NodeJS.Timeout;

  constructor(private room: Room) {}

  dispose() {
    clearTimeout(this.timer);
    clearTimeout(this.grace);
  }

  tallyOf(id: string): number {
    return this.tally.get(id) ?? 0;
  }

  snapshot() {
    return { level: this.level, soft: this.soft, tally: Object.fromEntries(this.tally) };
  }

  restore(s: { level: PartyLevel; soft: boolean; tally: Record<string, number> }) {
    if (s.level === 1 || s.level === 2 || s.level === 3) this.level = s.level;
    this.soft = !!s.soft;
    for (const [id, n] of Object.entries(s.tally ?? {})) if (Number.isFinite(n)) this.tally.set(id, n);
  }

  /** Al cambiar de juego: se vacía la ronda, pero se conservan nivel, modo y marcador. */
  reset() {
    clearTimeout(this.timer);
    this.phase = 'idle';
    this.round = 0;
    this.prompt = null;
    this.options = null;
    this.kind = null;
    this.target = null;
    this.resolved = null;
    this.rule = null;
    this.card = null;
    this.kings = 0;
    this.answers.clear();
    this.picks = null;
    this.drinkers = [];
    this.times = null;
    this.reaction.clear();
    this.kingsDeck = [];
    this.lastTarget = null;
  }

  private connected(): string[] {
    return [...this.room.players.values()].filter((p) => p.ws).map((p) => p.id);
  }

  private addTally(ids: string[]) {
    for (const id of ids) {
      this.tally.set(id, (this.tally.get(id) ?? 0) + 1);
      this.room.noteDrink(id);
    }
  }

  /**
   * Saca una carta sin repetir hasta agotar el mazo. Solo salen las del nivel elegido (el "Extremo" no se diluye con
   * frases suaves); al reiniciar el mazo, la última carta no abre el siguiente.
   */
  private draw(key: string, list: Item[]): Item {
    let deck = (this.decks.get(key) ?? []).filter((i) => list[i].level === this.level);
    if (deck.length === 0) {
      deck = shuffle(list.map((_, i) => i).filter((i) => list[i].level === this.level));
      const last = this.lastDrawn.get(key);
      if (deck.length > 1 && deck[deck.length - 1] === last) deck.unshift(deck.pop()!);
    }
    const i = deck.pop()!;
    this.decks.set(key, deck);
    this.lastDrawn.set(key, i);
    return list[i];
  }

  // ---------- Ajustes (los comprueba la sala: solo anfitrión) ----------
  setLevel(level: PartyLevel): string | void {
    if (level !== 1 && level !== 2 && level !== 3) return 'Nivel no válido.';
    this.level = level;
    this.room.broadcast();
  }

  setSoft(soft: boolean) {
    this.soft = !!soft;
    this.room.broadcast();
  }

  // ---------- Pasar de ronda ----------
  next(p: Player): string | void {
    const g = this.room.game as PartyGame;
    const isHost = p.id === this.room.hostId;
    switch (g) {
      case 'never':
      case 'likely':
      case 'would':
        if (!isHost) return 'Solo el anfitrión pasa de ronda.';
        if (this.phase === 'asking') return 'Esperad a que responda todo el mundo (o revela ya).';
        return this.startSimple(g);
      case 'truth':
        if (!isHost && p.id !== this.target) return 'Solo el anfitrión o quien está en el centro pasa de turno.';
        if (!isHost && (this.phase === 'choose' || this.phase === 'prompt')) return 'Primero hay que resolver el turno.';
        return this.startTruth();
      case 'kings':
        if (this.phase === 'idle') return isHost ? this.startKings() : 'Solo el anfitrión empieza.';
        if (!isHost && p.id !== this.target) return 'Es el turno de otra persona.';
        return this.phase === 'ready' ? this.drawKing() : this.passKings();
      case 'reflex':
        if (!isHost) return 'Solo el anfitrión lanza el duelo.';
        if (this.phase === 'wait' || this.phase === 'go') return 'El duelo ya está en marcha.';
        return this.startReflex();
      default:
        return 'Elige primero un juego.';
    }
  }

  private startSimple(g: 'never' | 'likely' | 'would') {
    this.round++;
    this.answers.clear();
    this.picks = null;
    this.drinkers = [];
    this.options = null;
    if (g === 'never') this.prompt = this.draw('never', NEVER).text;
    else if (g === 'likely') this.prompt = `¿Quién es más probable que ${this.draw('likely', LIKELY).text}`;
    else {
      const i = this.pickPair();
      this.prompt = '¿Qué prefieres?';
      this.options = [WOULD[i].a, WOULD[i].b];
    }
    this.phase = 'asking';
    this.room.broadcast();
  }

  private pickPair(): number {
    const items: Item[] = WOULD.map((w) => ({ text: w.a, level: w.level }));
    const chosen = this.draw('would', items);
    return items.indexOf(chosen);
  }

  private startTruth() {
    const ids = this.connected();
    if (ids.length === 0) return 'No hay jugadores conectados.';
    const i = this.lastTarget ? ids.indexOf(this.lastTarget) : -1;
    this.target = ids[(i + 1) % ids.length];
    this.lastTarget = this.target;
    this.round++;
    this.kind = null;
    this.prompt = null;
    this.resolved = null;
    this.phase = 'choose';
    this.room.broadcast();
  }

  private startKings() {
    const ids = this.connected();
    if (ids.length === 0) return 'No hay jugadores conectados.';
    this.kingsDeck = newDeck();
    this.kings = 0;
    this.card = null;
    this.rule = null;
    this.prompt = null;
    this.target = ids[0];
    this.round = 1;
    this.phase = 'ready';
    this.room.broadcast();
  }

  private drawKing() {
    if (this.kingsDeck.length === 0) this.kingsDeck = newDeck();
    const card = this.kingsDeck.pop()!;
    const rule = KING_RULES[card.r];
    this.card = card;
    this.prompt = rule.title;
    this.rule = rule.text;
    if (card.r === 'K' && ++this.kings === 4) {
      this.prompt = '¡Cuarto Rey!';
      this.rule = 'Te bebes el vaso central entero. ¡Suerte!';
      if (this.target) this.addTally([this.target]);
    }
    this.room.noteRound();
    this.phase = 'prompt';
    this.room.broadcast();
  }

  private passKings() {
    if (this.kings >= 4) { this.kingsDeck = newDeck(); this.kings = 0; }
    const ids = this.connected();
    const i = this.target ? ids.indexOf(this.target) : -1;
    this.target = ids.length ? ids[(i + 1) % ids.length] : null;
    this.round++;
    this.card = null;
    this.prompt = null;
    this.rule = null;
    this.phase = 'ready';
    this.room.broadcast();
  }

  // ---------- Respuestas ----------
  answer(p: Player, value: string): string | void {
    const g = this.room.game as PartyGame;
    if (g === 'truth') return this.answerTruth(p, value);
    if (g !== 'never' && g !== 'likely' && g !== 'would') return 'Esa partida no admite respuestas.';
    if (this.phase !== 'asking') return 'La ronda ya se reveló.';
    if (g === 'never' && value !== 'yes' && value !== 'no') return 'Respuesta no válida.';
    if (g === 'likely' && !this.room.players.has(value)) return 'Jugador no válido.';
    if (g === 'would' && value !== 'A' && value !== 'B') return 'Respuesta no válida.';
    this.answers.set(p.id, value);
    this.room.broadcast();
    this.checkAll();
  }

  private answerTruth(p: Player, value: string): string | void {
    if (p.id !== this.target) return 'No te toca.';
    if (this.phase === 'choose') {
      if (value !== 'truth' && value !== 'dare') return 'Elige verdad o reto.';
      this.kind = value;
      this.prompt = (value === 'truth' ? this.draw('truth', TRUTHS) : this.draw('dare', DARES)).text;
      this.phase = 'prompt';
      this.room.broadcast();
      return;
    }
    if (this.phase === 'prompt') {
      if (value !== 'done' && value !== 'drink') return 'Respuesta no válida.';
      this.resolved = value;
      if (value === 'drink') this.addTally([p.id]);
      this.room.noteRound();
      this.phase = 'done';
      this.room.broadcast();
      return;
    }
    return 'Ahora no.';
  }

  private checkAll() {
    if (this.phase !== 'asking') return;
    const need = this.connected();
    if (need.length > 0 && need.every((id) => this.answers.has(id))) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.reveal(), REVEAL_DELAY);
    }
  }

  forceReveal(p: Player): string | void {
    if (p.id !== this.room.hostId) return 'Solo el anfitrión puede revelar.';
    if (this.phase !== 'asking') return;
    if (this.answers.size === 0) return 'Todavía no ha respondido nadie.';
    this.reveal();
  }

  private reveal() {
    if (this.phase !== 'asking') return;
    clearTimeout(this.timer);
    const g = this.room.game;
    const entries = [...this.answers].filter(([id]) => this.room.players.has(id));
    this.picks = Object.fromEntries(entries);
    if (g === 'never') {
      this.drinkers = entries.filter(([, v]) => v === 'yes').map(([id]) => id);
    } else if (g === 'likely') {
      const counts = new Map<string, number>();
      for (const [, v] of entries) counts.set(v, (counts.get(v) ?? 0) + 1);
      const max = Math.max(0, ...counts.values());
      this.drinkers = max > 0 ? [...counts].filter(([, c]) => c === max).map(([id]) => id) : [];
    } else if (g === 'would') {
      const a = entries.filter(([, v]) => v === 'A').length;
      const b = entries.filter(([, v]) => v === 'B').length;
      const minority = a < b ? 'A' : 'B';
      this.drinkers = a === b ? [] : entries.filter(([, v]) => v === minority).map(([id]) => id);
    }
    this.addTally(this.drinkers);
    this.room.noteRound();
    this.phase = 'reveal';
    this.room.broadcast();
  }

  // ---------- Duelo de reflejos ----------
  private startReflex() {
    this.round++;
    this.reaction.clear();
    this.times = null;
    this.drinkers = [];
    this.phase = 'wait';
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.go(), WAIT_MIN + rnd(WAIT_SPAN));
    this.room.broadcast();
  }

  private go() {
    if (this.phase !== 'wait') return;
    this.phase = 'go';
    this.timer = setTimeout(() => this.finishReflex(), GO_WINDOW);
    this.room.broadcast();
  }

  /** `ms` lo mide el propio móvil desde que le llega el "¡YA!", para que la latencia no decida. */
  tap(p: Player, ms: number): string | void {
    if (this.room.game !== 'reflex') return 'Esa partida no está activa.';
    if (this.reaction.has(p.id)) return;
    if (this.phase === 'wait') {
      this.reaction.set(p.id, 'early'); // se adelantó
      this.room.broadcast();
    } else if (this.phase === 'go') {
      const v = Math.min(5000, Math.max(80, Math.round(Number(ms)) || 5000));
      this.reaction.set(p.id, v);
      this.room.broadcast();
      this.checkReflexDone();
    }
  }

  private checkReflexDone() {
    if (this.phase !== 'go') return;
    if (this.connected().every((id) => this.reaction.has(id))) {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.finishReflex(), 500);
    }
  }

  private finishReflex() {
    if (this.phase !== 'go') return;
    clearTimeout(this.timer);
    const rows = this.connected().map((id) => {
      const r = this.reaction.get(id);
      return { id, ms: typeof r === 'number' ? r : null, early: r === 'early' };
    });
    const rank = (r: { ms: number | null; early: boolean }) => (r.early ? 2 : r.ms === null ? 1 : 0);
    rows.sort((a, b) => rank(a) - rank(b) || (a.ms ?? 0) - (b.ms ?? 0));
    let drinkers = rows.filter((r) => r.early || r.ms === null).map((r) => r.id);
    if (drinkers.length === 0 && rows.length > 0) drinkers = [rows[rows.length - 1].id]; // el más lento
    this.drinkers = drinkers;
    this.times = rows;
    this.addTally(drinkers);
    for (const r of rows) if (r.ms !== null) this.room.noteReflex(r.id, r.ms);
    this.room.noteRound();
    this.phase = 'reveal';
    this.room.broadcast();
  }

  // ---------- Presencia ----------
  /** Alguien salió: puede que ya hubieran respondido todos los demás. */
  onPresenceChange() {
    this.checkAll();
    this.checkReflexDone();
  }

  /**
   * Alguien perdió la conexión. En el móvil las microcaídas (o recargar la página) son normales,
   * así que se le espera unos segundos antes de seguir sin su respuesta.
   */
  onDisconnect() {
    clearTimeout(this.grace);
    this.grace = setTimeout(() => this.onPresenceChange(), DISCONNECT_GRACE);
  }

  onRemove(pid: string) {
    this.answers.delete(pid);
    this.reaction.delete(pid);
    this.tally.delete(pid);
    if (this.target === pid) {
      const g = this.room.game;
      if (g === 'truth' && this.phase !== 'idle') { this.startTruth(); return; }
      if (g === 'kings' && this.phase !== 'idle') {
        this.target = this.connected()[0] ?? null;
        this.card = null;
        this.prompt = null;
        this.rule = null;
        this.phase = 'ready';
      }
    }
    this.onPresenceChange();
  }

  // ---------- Vista pública ----------
  toPublic(forId: string | null): PartyPublic {
    const reflex = this.room.game === 'reflex';
    const mineRaw = forId ? (reflex ? this.reaction.get(forId) : this.answers.get(forId)) : undefined;
    return {
      level: this.level,
      soft: this.soft,
      phase: this.phase,
      round: this.round,
      prompt: this.prompt,
      options: this.options,
      kind: this.kind,
      target: this.target,
      answered: reflex ? [...this.reaction.keys()] : [...this.answers.keys()],
      mine: mineRaw === undefined ? null : String(mineRaw),
      picks: this.phase === 'reveal' ? this.picks : null,
      drinkers: this.phase === 'reveal' || this.phase === 'done' ? this.drinkers : [],
      times: this.times,
      resolved: this.resolved,
      card: this.card,
      rule: this.rule,
      kings: this.kings,
      tally: Object.fromEntries(this.tally),
    };
  }
}
