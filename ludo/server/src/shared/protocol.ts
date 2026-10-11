// Contrato entre servidor y cliente. Módulo puro (sin imports de Node): el cliente
// lo importa tal cual a través del alias `$shared`, así hay una sola fuente de verdad.

export type BoardSize = 4 | 6 | 8;
export const BOARDS: readonly BoardSize[] = [4, 6, 8];

export const NAME_MAX = 16;
export const CODE_LEN = 5;
/** Alfabeto de los códigos de sala: sin I, O, 0 ni 1 para que no se confundan al dictarlos. */
export const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const TURN_SECONDS_CHOICES = [0, 20, 30, 45, 60, 90] as const;

export interface RoomOptions {
  /** Forma del tablero y capacidad máxima: 4, 6 u 8 jugadores. */
  board: BoardSize;
  /** true: la partida acaba cuando alguien mete sus 4 peones. false: se sigue hasta fijar todos los puestos. */
  endAtFirst: boolean;
  /** true: para entrar en la meta hay que sacar el número justo. false: basta con pasarse. */
  exactFinish: boolean;
  /** true: dos peones del mismo color en una casilla forman pareja y no pueden ser comidos. */
  towers: boolean;
  /** true: si solo hay un movimiento posible, el servidor lo hace solo. */
  autoSingle: boolean;
  /** Segundos que tiene cada jugador para actuar (0 = sin límite). */
  turnSeconds: number;
}

export const DEFAULT_OPTIONS: RoomOptions = {
  board: 4,
  endAtFirst: true,
  exactFinish: true,
  towers: false,
  autoSingle: true,
  turnSeconds: 45,
};

export type Phase = 'lobby' | 'playing' | 'finished';

export interface PlayerView {
  id: string;
  name: string;
  /** Brazo del tablero (0 = arriba, en sentido horario). Determina el color. */
  arm: number;
  bot: boolean;
  connected: boolean;
  host: boolean;
  /** Progreso de cada uno de los 4 peones (ver `rules.ts`): 0 = en casa, final = en la meta. */
  pawns: number[];
  /** Puesto final (1 = ganador). null mientras sigue jugando. */
  rank: number | null;
  /** Abandonó la partida en curso. */
  left: boolean;
  /** Juega en piloto automático por no responder a tiempo. */
  auto: boolean;
}

export interface TurnView {
  playerId: string;
  /** roll: toca tirar · move: hay que elegir peón · wait: se está resolviendo (sin movimientos). */
  step: 'roll' | 'move' | 'wait';
  dice: number | null;
  /** Peones (índices 0..3) que pueden moverse con el dado actual. */
  movable: number[];
  /** Seises seguidos en este turno. */
  sixes: number;
  /** Instante (ms epoch del servidor) en que se juega solo, o null. */
  deadline: number | null;
}

export type GameEvent =
  | { seq: number; type: 'start'; playerId: string }
  | { seq: number; type: 'roll'; playerId: string; dice: number }
  | {
      seq: number;
      type: 'move';
      playerId: string;
      pawn: number;
      from: number;
      to: number;
      captured: { playerId: string; pawn: number; from: number }[];
    }
  | { seq: number; type: 'pass'; playerId: string; reason: 'no-moves' | 'triple-six' }
  | { seq: number; type: 'finish'; playerId: string; rank: number }
  | { seq: number; type: 'leave'; playerId: string }
  | { seq: number; type: 'end' };

export interface RoomView {
  code: string;
  phase: Phase;
  options: RoomOptions;
  hostId: string | null;
  players: PlayerView[];
  spectators: number;
  turn: TurnView | null;
  seq: number;
  /** Eventos ocurridos desde el mensaje anterior, para animar. */
  events: GameEvent[];
  serverTime: number;
}

export type ErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'not-host'
  | 'not-your-turn'
  | 'illegal'
  | 'phase'
  | 'full'
  | 'rate-limit'
  | 'blocked';

// ---------- Cliente → servidor ----------
export type ClientMsg =
  | { t: 'create'; name: string }
  | { t: 'join'; code: string; name: string }
  | { t: 'resume'; code: string; token: string }
  | { t: 'config'; patch: Partial<RoomOptions> }
  | { t: 'bot'; op: 'add' }
  | { t: 'bot'; op: 'remove'; id: string }
  | { t: 'kick'; id: string }
  | { t: 'sit' }
  | { t: 'start' }
  | { t: 'roll' }
  | { t: 'move'; pawn: number }
  | { t: 'rematch' }
  | { t: 'leave' }
  | { t: 'ping' };

// ---------- Servidor → cliente ----------
export interface YouInfo {
  id: string;
  /** Secreto para reanudar la sesión tras una desconexión. */
  token: string;
  role: 'player' | 'spectator';
}

export type ServerMsg =
  | { t: 'welcome'; you: YouInfo; room: RoomView }
  | { t: 'state'; room: RoomView; you?: YouInfo }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'kicked' }
  | { t: 'pong' };

/** Respuesta de GET /api/rooms/:code */
export interface RoomInfo {
  code: string;
  phase: Phase;
  board: BoardSize;
  players: number;
  capacity: number;
  spectators: number;
  host: string | null;
  joinable: boolean;
}
