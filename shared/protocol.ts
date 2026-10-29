// Contrato entre servidor y cliente. Solo fichas virtuales, nunca dinero real.

export const BRAND = 'Royale Club';
export const START_CHIPS = 1000;
export const MIN_REBUY_BELOW = 10;
export const MAX_PLAYERS = 8;
export const CHIP_VALUES = [10, 50, 100, 500, 1000] as const;

import type { LudoOptions, LudoPublic } from './ludo';
export * from './ludo';

export type CasinoGame = 'blackjack' | 'roulette' | 'slots' | 'poker' | 'freepoker';
export type PartyGame = 'never' | 'likely' | 'would' | 'truth' | 'reflex' | 'kings';
/** 'party' es el menú de la zona Fiesta; 'ludo' es la zona Ludo (4, 6 u 8 jugadores). */
export type GameId = CasinoGame | PartyGame | 'party' | 'ludo';

export const GAMES: { id: CasinoGame; name: string; short: string; tagline: string }[] = [
  { id: 'blackjack', name: 'Blackjack', short: 'Blackjack', tagline: 'Mesa compartida · 21' },
  { id: 'roulette', name: 'Ruleta', short: 'Ruleta', tagline: 'Europea · un solo cero' },
  { id: 'slots', name: 'Tragaperras', short: 'Slots', tagline: 'Gira tu suerte' },
  { id: 'poker', name: 'Póker con fichas', short: 'Fichas', tagline: "Texas Hold'em · sin límite" },
  { id: 'freepoker', name: 'Póker', short: 'Póker', tagline: 'Texas · gana la mejor mano, sin apostar' },
];

/** icon = nombre en src/lib/icons.ts */
export const PARTY_GAMES: { id: PartyGame; name: string; icon: string; tagline: string }[] = [
  { id: 'never', name: 'Yo nunca', icon: 'never', tagline: 'Quien lo hizo, bebe' },
  { id: 'likely', name: '¿Quién es más probable?', icon: 'likely', tagline: 'Voto secreto: el más votado bebe' },
  { id: 'would', name: 'Preferirías…', icon: 'would', tagline: 'La minoría bebe' },
  { id: 'truth', name: 'Verdad o reto', icon: 'truth', tagline: 'Sin escapatoria (salvo beber)' },
  { id: 'reflex', name: 'Duelo de reflejos', icon: 'reflex', tagline: 'El más lento bebe' },
  { id: 'kings', name: 'Rey de copas', icon: 'kings', tagline: 'Cada carta, una regla' },
];

export const isPartyId = (id: GameId): boolean => id === 'party' || PARTY_GAMES.some((g) => g.id === id);
export const LUDO_GAME = { id: 'ludo' as const, name: 'Ludo', tagline: 'Hasta 8 jugadores · tableros de 4, 6 y 8' };
export const isLudoId = (id: GameId): boolean => id === 'ludo';
export const isCasinoId = (id: GameId): boolean => GAMES.some((g) => g.id === id);

// ---------- Cartas ----------
export type Suit = 'S' | 'H' | 'D' | 'C';
export type Card = { r: string; s: Suit } | { hidden: true };

// ---------- Jugadores ----------
export interface PlayerPublic {
  id: string;
  name: string;
  chips: number;
  connected: boolean;
  host: boolean;
  avatar: number;
}

// ---------- Blackjack ----------
export type SeatStatus = 'betting' | 'playing' | 'stand' | 'bust' | 'blackjack';
export type BJResult = 'win' | 'lose' | 'push' | 'blackjack';
/** Una mano. Un asiento tiene una, o dos si se divide. */
export interface BJHand {
  cards: Card[];
  bet: number;
  status: SeatStatus;
  result?: BJResult;
  delta?: number;
  doubled?: boolean;
  split?: boolean; // viene de una división (un 21 así no es Blackjack)
}
export interface BJSeat {
  id: string;
  bet: number; // total apostado en las manos (sin el seguro)
  hands: BJHand[];
  active: number; // mano que se está jugando
  insurance: number; // seguro pagado (0 = sin seguro)
  decided: boolean; // ya contestó a la oferta de seguro
  delta?: number; // ganancia o pérdida neta del asiento, seguro incluido
}
export interface BJPublic {
  phase: 'betting' | 'insurance' | 'playing' | 'dealer' | 'payout';
  seats: BJSeat[];
  dealer: Card[];
  turn: string | null;
  timeLeft: number | null;
}

// ---------- Ruleta ----------
export type RouletteBetKind =
  | 'straight' | 'red' | 'black' | 'even' | 'odd' | 'low' | 'high' | 'dozen' | 'column';
export interface RouletteBet {
  kind: RouletteBetKind;
  value?: number; // straight: 0-36 · dozen/column: 1-3
  amount: number;
}
export interface RoulettePublic {
  phase: 'betting' | 'spinning' | 'result';
  timeLeft: number | null;
  bets: Record<string, RouletteBet[]>;
  result: number | null;
  history: number[];
  net: Record<string, number>;
  lastTotals: Record<string, number>; // lo que cada jugador apostó en la tirada anterior (para "Repetir")
}
// Orden físico de la rueda europea
export const WHEEL = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20,
  14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
];
export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

// ---------- Tragaperras ----------
export type SlotSymbol = 'cherry' | 'lemon' | 'bell' | 'diamond' | 'seven';
export const SLOT_PAY: Record<SlotSymbol, number> = {
  cherry: 5, lemon: 10, bell: 20, diamond: 50, seven: 200,
};

// ---------- Póker (Texas Hold'em sin límite) ----------
export const POKER_SB = 10;
export const POKER_BB = 20;
export const POKER_BUYINS = [200, 500, 1000] as const;
export interface PokerSeat {
  id: string;
  stack: number;
  bet: number; // lo apostado en la ronda actual
  inHand: boolean;
  folded: boolean;
  allIn: boolean;
  ready: boolean;
  button: boolean;
  cards: Card[]; // las ajenas llegan ocultas hasta el showdown
  last?: string; // última acción ("Pasa", "Iguala", "Sube"...)
  hand?: string; // nombre de la mano en el showdown
  delta?: number; // ganancia/pérdida neta de la mano
}
export interface PokerPublic {
  phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  seats: PokerSeat[];
  board: Card[];
  pot: number;
  toAct: string | null;
  currentBet: number;
  minRaiseTo: number;
  timeLeft: number | null;
}

// ---------- Póker sin apuestas ----------
export interface FreePokerSeat {
  id: string;
  ready: boolean;
  inHand: boolean;
  folded: boolean;
  /** Ya eligió "Seguir" o "Retirarme" en esta fase. */
  decided: boolean;
  cards: Card[]; // las ajenas llegan ocultas hasta el showdown
  hand?: string; // nombre de la mano en el showdown
  won?: boolean;
  wins: number; // victorias de la noche
}
export interface FreePokerPublic {
  phase: 'waiting' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
  seats: FreePokerSeat[];
  board: Card[];
  timeLeft: number | null;
  winners: string[];
  note: string | null;
  hands: number;
}

// ---------- Fiesta ----------
export type PartyLevel = 1 | 2 | 3;
export const LEVELS: { id: PartyLevel; name: string; flames: 1 | 2 | 3; hint: string }[] = [
  { id: 1, name: 'Suave', flames: 1, hint: 'Para romper el hielo' },
  { id: 2, name: 'Picante', flames: 2, hint: 'Ya hay confianza' },
  { id: 3, name: 'Extremo', flames: 3, hint: 'Solo para valientes' },
];
export interface PartyPublic {
  level: PartyLevel;
  soft: boolean; // modo sin alcohol: "beber" pasa a ser "perder un punto"
  phase: 'idle' | 'asking' | 'reveal' | 'choose' | 'prompt' | 'done' | 'ready' | 'wait' | 'go';
  round: number;
  prompt: string | null;
  options: [string, string] | null; // Preferirías…
  kind: 'truth' | 'dare' | null;
  target: string | null; // quién está en el centro (verdad o reto / turno del rey de copas)
  answered: string[]; // quién ya respondió (sin decir qué)
  mine: string | null; // mi propia respuesta
  picks: Record<string, string> | null; // solo en la revelación
  drinkers: string[];
  times: { id: string; ms: number | null; early: boolean }[] | null; // reflejos
  resolved: 'done' | 'drink' | null;
  card: Card | null; // rey de copas
  rule: string | null;
  kings: number;
  tally: Record<string, number>; // tragos de la noche
}

// ---------- Resumen de la noche ----------
export interface PlayerStats {
  id: string;
  name: string;
  drinks: number; // tragos (o puntos perdidos) de la noche
  bestReflex: number | null; // mejor tiempo en el duelo de reflejos (ms)
  bigWin: number; // mayor premio de una sola ronda
  bigWinGame: string;
  rebuys: number; // préstamos al banco
  bluffs: number; // manos de póker ganadas sin enseñar cartas
  worth: number; // fichas totales (cartera + mesa)
}
export interface RoomStats {
  startedAt: number;
  rounds: number;
  players: PlayerStats[];
}

// ---------- Reacciones ----------
// ---------- Perfil y logros ----------
export interface AchievementDef { id: string; name: string; desc: string; icon: string }
export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first-night', name: 'Bienvenido al club', desc: 'Entra en tu primera mesa', icon: 'chip' },
  { id: 'regular', name: 'De la casa', desc: 'Juega en 5 mesas distintas', icon: 'users' },
  { id: 'grinder', name: 'Rata de casino', desc: 'Juega 100 rondas', icon: 'blackjack' },
  { id: 'thirsty', name: 'Sed de fiesta', desc: 'Suma 20 tragos (o puntos) en total', icon: 'drink' },
  { id: 'lightning', name: 'Dedos de rayo', desc: 'Baja de 250 ms en el duelo de reflejos', icon: 'reflex' },
  { id: 'whale', name: 'Gran golpe', desc: 'Gana 1.000 fichas o más en una sola ronda', icon: 'trophy' },
  { id: 'bluffer', name: 'Cara de póker', desc: 'Gana 3 botes sin enseñar cartas', icon: 'truth' },
  { id: 'borrower', name: 'Cliente del banco', desc: 'Pide 3 préstamos al banco', icon: 'minus' },
];
/** Logros que solo se pueden ganar en el casino: se ocultan si la zona está desactivada. */
export const CASINO_ACHIEVEMENTS = ['whale', 'bluffer', 'borrower'];

export interface ProfilePublic {
  name: string;
  firstSeen: number;
  nights: number; // mesas en las que ha jugado
  rounds: number;
  drinks: number;
  bestReflex: number | null;
  bigWin: number;
  bigWinGame: string;
  bluffs: number;
  rebuys: number;
  achievements: string[];
}

// ---------- Reacciones ----------
export const REACTIONS = ['laugh', 'wow', 'heart', 'flame', 'drink', 'sparkle'] as const;
export type ReactionKind = (typeof REACTIONS)[number];

// ---------- Sala ----------
export interface FeedItem { id: number; text: string }
export interface RoomPublic {
  code: string;
  game: GameId;
  players: PlayerPublic[];
  blackjack: BJPublic;
  roulette: RoulettePublic;
  poker: PokerPublic;
  party: PartyPublic;
  ludo: LudoPublic;
  freepoker: FreePokerPublic;
  /** ¿Está activa la zona Casino? (activa por defecto; CASINO=0 en el servidor la oculta). */
  casino: boolean;
  /** Juegos de casino disponibles (póker y tragaperras están ocultos salvo POKER=1 / SLOTS=1). */
  casinoGames: CasinoGame[];
  locked: boolean; // el anfitrión cerró la mesa a nuevos jugadores
  stats: RoomStats;
  feed: FeedItem[];
}

// ---------- Mensajes ----------
export type ClientMsg =
  | { t: 'join'; pid: string; name: string; code?: string; screen?: boolean }
  | { t: 'profile:get' }
  | { t: 'leave' }
  | { t: 'game'; game: GameId }
  | { t: 'rebuy' }
  | { t: 'bj:bet'; amount: number }
  | { t: 'bj:clear' }
  | { t: 'bj:hit' }
  | { t: 'bj:stand' }
  | { t: 'bj:double' }
  | { t: 'bj:split' }
  | { t: 'bj:insure'; take: boolean }
  | { t: 'ro:bet'; kind: RouletteBetKind; value?: number; amount: number }
  | { t: 'ro:undo' }
  | { t: 'ro:rebet' }
  | { t: 'ro:double' }
  | { t: 'ro:clear' }
  | { t: 'sl:spin'; bet: number }
  | { t: 'po:sit'; buyin: number }
  | { t: 'po:stand' }
  | { t: 'po:ready' }
  | { t: 'po:act'; action: 'fold' | 'check' | 'call' | 'raise'; amount?: number }
  | { t: 'fp:sit' }
  | { t: 'fp:stand' }
  | { t: 'fp:ready' }
  | { t: 'fp:choose'; stay: boolean }
  | { t: 'lu:config'; patch: Partial<LudoOptions> }
  | { t: 'lu:start' }
  | { t: 'lu:roll' }
  | { t: 'lu:move'; pawn: number }
  | { t: 'lu:reset' }
  | { t: 'pa:level'; level: PartyLevel }
  | { t: 'pa:soft'; soft: boolean }
  | { t: 'pa:next' }
  | { t: 'pa:reveal' }
  | { t: 'pa:answer'; value: string }
  | { t: 'pa:tap'; ms: number }
  | { t: 'room:kick'; pid: string }
  | { t: 'room:lock'; locked: boolean }
  | { t: 'react'; kind: ReactionKind }
  | { t: 'review'; rating: number; comment?: string };

export type ServerMsg =
  | { t: 'state'; room: RoomPublic }
  | { t: 'err'; msg: string }
  | { t: 'left' }
  | { t: 'review:ok' }
  | { t: 'kicked' }
  | { t: 'profile'; profile: ProfilePublic }
  | { t: 'achievement'; id: string }
  | { t: 'react'; from: string; kind: ReactionKind }
  | { t: 'sl:result'; reels: SlotSymbol[]; bet: number; win: number };
