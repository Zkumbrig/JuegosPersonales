// Estado del cliente: conexión WebSocket con reconexión automática, sesión guardada
// y una cola que reproduce los eventos del servidor (dado, pasos, capturas) antes de mostrar el estado nuevo.

import type { ClientMsg, GameEvent, PlayerView, RoomOptions, RoomView, ServerMsg, YouInfo } from '$shared/protocol';
import { armColor, finalPos } from '$shared/rules';
import { sound } from './sound.svelte';

const SESSION_KEY = 'ludo.session';
const NAME_KEY = 'ludo.name';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface LogLine {
  id: number;
  text: string;
  color: string | null;
}
export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}
interface Session {
  code: string;
  token: string;
}

// La sesión vive en sessionStorage: cada pestaña es un jugador distinto y recargar no te saca de la partida.
function readSession(): Session | null {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    return s && typeof s.code === 'string' && typeof s.token === 'string' ? s : null;
  } catch {
    return null;
  }
}
function writeSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* sin almacenamiento */ }
}

/** URL base de la API HTTP (misma origen salvo que se configure VITE_SERVER_URL). */
export function apiUrl(path: string): string {
  const custom = import.meta.env.VITE_SERVER_URL as string | undefined;
  return (custom ? custom.replace(/^ws/, 'http').replace(/\/$/, '') : '') + path;
}

function serverUrl(): string {
  const custom = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (custom) return custom.replace(/\/$/, '') + '/ws';
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

class Ludo {
  /** open = conectado · connecting = intentándolo · offline = sin conexión (se reintenta solo) */
  status = $state<'idle' | 'connecting' | 'open' | 'offline'>('idle');
  /** Estado de la sala ya mostrado (va detrás del servidor mientras se animan los eventos). */
  room = $state.raw<RoomView | null>(null);
  you = $state.raw<YouInfo | null>(null);
  /** Progreso que se está dibujando de cada peón (cambia paso a paso en las animaciones). */
  shown = $state.raw<Record<string, number[]>>({});
  dice = $state.raw<{ value: number | null; rolling: boolean; playerId: string | null }>({ value: null, rolling: false, playerId: null });
  /** Peones recién comidos, para el efecto visual: "playerId:pawn". */
  popped = $state.raw<string[]>([]);
  /** Último peón movido, para resaltarlo. */
  lastMoved = $state.raw<{ playerId: string; pawn: number } | null>(null);
  log = $state.raw<LogLine[]>([]);
  toasts = $state.raw<Toast[]>([]);
  name = $state('');
  /** Código que viene en el enlace (?sala=ABCDE), para rellenar el formulario. */
  linkCode = $state('');
  /** Se está intentando recuperar la sesión guardada. */
  resuming = $state(false);
  /** Diferencia entre el reloj del servidor y el local, para las cuentas atrás. */
  clockOffset = 0;

  private ws: WebSocket | null = null;
  private onOpen: ClientMsg | null = null;
  private wantOnline = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private resumeSent = false;
  private queue: RoomView[] = [];
  private busy = false;
  private epoch = 0;
  /** Mientras una acción de juego espera respuesta se ignoran nuevas pulsaciones (dobles clics). */
  private locked = false;
  private lockTimer: ReturnType<typeof setTimeout> | null = null;
  private seqLog = 0;
  private seqToast = 0;

  // ---------- Derivados cómodos ----------
  get me(): PlayerView | null {
    return this.room?.players.find((p) => p.id === this.you?.id) ?? null;
  }
  get isPlayer() {
    return this.me !== null;
  }
  get isHost() {
    return !!this.room && this.room.hostId === this.you?.id;
  }
  get turnPlayer(): PlayerView | null {
    const t = this.room?.turn;
    return t ? (this.room!.players.find((p) => p.id === t.playerId) ?? null) : null;
  }
  get myTurn() {
    return !!this.room?.turn && this.room.turn.playerId === this.you?.id && this.room.phase === 'playing';
  }
  get canRoll() {
    return this.myTurn && this.room!.turn!.step === 'roll' && !this.dice.rolling;
  }
  get canMove() {
    return this.myTurn && this.room!.turn!.step === 'move';
  }
  color(p: PlayerView) {
    return armColor(this.room!.options.board, p.arm);
  }

  // ---------- Arranque ----------
  init() {
    try {
      this.name = localStorage.getItem(NAME_KEY) ?? '';
    } catch { /* sin almacenamiento */ }
    const code = new URLSearchParams(location.search).get('sala');
    if (code) this.linkCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    const s = readSession();
    if (s) {
      this.resuming = true;
      this.wantOnline = true;
      this.connect();
    }
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.wantOnline && !this.ws) this.connect();
    });
    window.addEventListener('online', () => {
      if (this.wantOnline && !this.ws) this.connect();
    });
    window.addEventListener('pointerdown', () => sound.unlock(), { once: true });
  }

  setName(n: string) {
    this.name = n;
    try {
      localStorage.setItem(NAME_KEY, n);
    } catch { /* sin almacenamiento */ }
  }

  // ---------- Conexión ----------
  private connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.status = this.room ? 'offline' : 'connecting';
    let ws: WebSocket;
    try {
      ws = new WebSocket(serverUrl());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      this.status = 'open';
      const session = readSession();
      if (this.onOpen) {
        this.rawSend(this.onOpen);
        this.onOpen = null;
      } else if (session) {
        this.resumeSent = true;
        this.rawSend({ t: 'resume', code: session.code, token: session.token });
      }
      this.pingTimer = setInterval(() => this.rawSend({ t: 'ping' }), 20_000);
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data as string) as ServerMsg);
      } catch (err) {
        console.error('mensaje ilegible', err);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.wantOnline) this.scheduleRetry();
      else this.status = 'idle';
    };
    ws.onerror = () => ws.close();
  }

  private scheduleRetry() {
    this.status = this.room || this.resuming ? 'offline' : 'connecting';
    const delay = Math.min(8000, 400 * 2 ** this.retries++);
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private rawSend(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Envía una acción de juego; avisa si no hay conexión. */
  send(msg: ClientMsg) {
    if (this.ws?.readyState !== WebSocket.OPEN) return this.toast('Sin conexión con el servidor. Reintentando…', 'error');
    this.rawSend(msg);
  }

  /** Envía un mensaje que abre o cambia de sala, conectando antes si hace falta. */
  private open(msg: ClientMsg) {
    this.wantOnline = true;
    if (this.ws?.readyState === WebSocket.OPEN) this.rawSend(msg);
    else {
      this.onOpen = msg;
      this.connect();
    }
  }

  // ---------- Mensajes del servidor ----------
  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.resuming = false;
        this.resumeSent = false;
        this.you = m.you;
        writeSession({ code: m.room.code, token: m.you.token });
        this.syncUrl(m.room.code);
        this.reset(m.room);
        break;
      case 'state':
        if (!this.you) break; // llega tarde tras haber salido de la sala
        this.queue.push(m.room);
        void this.pump();
        break;
      case 'error':
        if (this.resumeSent) {
          // La sesión guardada ya no existe (sala cerrada o servidor reiniciado).
          this.resumeSent = false;
          this.resuming = false;
          writeSession(null);
          this.wantOnline = false;
          this.room = null;
          this.you = null;
          this.syncUrl(null);
          this.toast('La partida en la que estabas ya terminó.', 'info');
        } else {
          this.unlock();
          this.toast(m.message, 'error');
        }
        break;
      case 'kicked':
        this.clearLocal();
        this.toast('El líder te sacó de la sala.', 'error');
        break;
    }
  }

  private clearLocal() {
    writeSession(null);
    this.wantOnline = false;
    this.epoch++;
    this.queue = [];
    this.busy = false;
    this.room = null;
    this.you = null;
    this.log = [];
    this.dice = { value: null, rolling: false, playerId: null };
    this.syncUrl(null);
  }

  private syncUrl(code: string | null) {
    try {
      const url = new URL(location.href);
      if (code) url.searchParams.set('sala', code);
      else url.searchParams.delete('sala');
      history.replaceState(null, '', url);
    } catch { /* entorno sin history */ }
  }

  /** Aplica un estado completo sin animar (al entrar o al volver a conectar). */
  private reset(room: RoomView) {
    this.epoch++;
    this.queue = [];
    this.busy = false;
    this.log = [];
    this.popped = [];
    this.lastMoved = null;
    this.dice = { value: room.turn?.dice ?? null, rolling: false, playerId: room.turn?.playerId ?? null };
    this.commit(room);
  }

  private commit(room: RoomView) {
    this.unlock();
    const prev = this.room;
    this.clockOffset = room.serverTime - Date.now();
    this.shown = Object.fromEntries(room.players.map((p) => [p.id, [...p.pawns]]));
    this.room = room;
    if (room.phase !== 'playing') {
      if (room.phase === 'lobby') this.dice = { value: null, rolling: false, playerId: null };
      this.popped = [];
    }
    // Aviso cuando te toca tirar.
    const t = room.turn;
    const wasMine = prev?.turn?.playerId === this.you?.id && prev?.turn?.step === 'roll' && prev?.phase === 'playing';
    if (t && t.playerId === this.you?.id && t.step === 'roll' && room.phase === 'playing' && !wasMine) {
      sound.ping();
      navigator.vibrate?.(80);
    }
  }

  // ---------- Reproducción de eventos ----------
  private async pump() {
    if (this.busy) return;
    this.busy = true;
    const epoch = this.epoch;
    while (this.queue.length) {
      const room = this.queue.shift()!;
      const fast = document.hidden || this.queue.length >= 2;
      for (const ev of room.events) {
        if (epoch !== this.epoch) return;
        await this.play(ev, room, fast, epoch);
      }
      if (epoch !== this.epoch) return;
      this.commit(room);
    }
    this.busy = false;
  }

  private setShown(playerId: string, pawn: number, p: number) {
    const arr = [...(this.shown[playerId] ?? [0, 0, 0, 0])];
    arr[pawn] = p;
    this.shown = { ...this.shown, [playerId]: arr };
  }

  private addLog(text: string, player?: PlayerView | null, room?: RoomView) {
    const color = player && room ? armColor(room.options.board, player.arm).hex : null;
    this.log = [...this.log.slice(-39), { id: ++this.seqLog, text, color }];
  }

  private async play(ev: GameEvent, room: RoomView, fast: boolean, epoch: number) {
    const who = (id: string) => room.players.find((p) => p.id === id) ?? null;
    const actor = 'playerId' in ev ? who(ev.playerId) : null;
    const name = actor?.name ?? '…';
    const wait = async (ms: number) => {
      if (!fast && ms > 0) await sleep(ms);
    };

    switch (ev.type) {
      case 'start':
        this.addLog(`Empieza la partida. Abre ${name}.`, actor, room);
        break;
      case 'roll':
        this.dice = { value: null, rolling: true, playerId: ev.playerId };
        if (!fast) sound.roll();
        await wait(650);
        if (epoch !== this.epoch) return;
        this.dice = { value: ev.dice, rolling: false, playerId: ev.playerId };
        this.addLog(`${name} sacó un ${ev.dice}.`, actor, room);
        await wait(250);
        break;
      case 'move': {
        const FIN = finalPos(room.options.board);
        this.lastMoved = { playerId: ev.playerId, pawn: ev.pawn };
        if (ev.from === 0) {
          this.setShown(ev.playerId, ev.pawn, 1);
          if (!fast) sound.tick();
          await wait(320);
          this.addLog(`${name} saca un peón.`, actor, room);
        } else {
          for (let p = ev.from + 1; p <= ev.to; p++) {
            if (epoch !== this.epoch) return;
            this.setShown(ev.playerId, ev.pawn, p);
            if (!fast) sound.tick();
            await wait(150);
          }
          this.addLog(ev.to === FIN ? `${name} metió un peón en la meta.` : `${name} avanza ${ev.to - ev.from}.`, actor, room);
          if (ev.to === FIN && !fast) sound.home();
        }
        if (ev.captured.length) {
          if (!fast) sound.capture();
          this.popped = ev.captured.map((c) => `${c.playerId}:${c.pawn}`);
          for (const c of ev.captured) {
            this.setShown(c.playerId, c.pawn, 0);
            this.addLog(`${name} se comió un peón de ${who(c.playerId)?.name ?? '…'}.`, actor, room);
          }
          await wait(450);
          this.popped = [];
        }
        break;
      }
      case 'pass':
        this.addLog(
          ev.reason === 'triple-six' ? `${name} sacó tres 6 seguidos y pierde el turno.` : `${name} no puede mover.`,
          actor,
          room,
        );
        break;
      case 'finish':
        this.addLog(`${name} terminó en el puesto ${ev.rank}.`, actor, room);
        if (!fast) ev.rank === 1 ? sound.win() : sound.home();
        break;
      case 'leave':
        this.addLog(`${name} abandonó la partida.`, actor, room);
        break;
      case 'end':
        this.addLog('Fin de la partida.', null, room);
        break;
    }
  }

  // ---------- Acciones ----------
  create(name: string) {
    this.setName(name);
    this.open({ t: 'create', name });
  }
  join(code: string, name: string) {
    this.setName(name);
    this.open({ t: 'join', code, name });
  }
  roll() {
    if (this.canRoll && this.lock()) {
      sound.unlock();
      this.send({ t: 'roll' });
    }
  }
  move(pawn: number) {
    if (this.canMove && this.room!.turn!.movable.includes(pawn) && this.lock()) this.send({ t: 'move', pawn });
  }
  private lock(): boolean {
    if (this.locked) return false;
    this.locked = true;
    this.lockTimer = setTimeout(() => this.unlock(), 2500);
    return true;
  }
  private unlock() {
    this.locked = false;
    if (this.lockTimer) clearTimeout(this.lockTimer);
    this.lockTimer = null;
  }
  config(patch: Partial<RoomOptions>) {
    this.send({ t: 'config', patch });
  }
  addBot() {
    this.send({ t: 'bot', op: 'add' });
  }
  removeBot(id: string) {
    this.send({ t: 'bot', op: 'remove', id });
  }
  kick(id: string) {
    this.send({ t: 'kick', id });
  }
  start() {
    this.send({ t: 'start' });
  }
  rematch() {
    this.send({ t: 'rematch' });
  }
  sit() {
    this.send({ t: 'sit' });
  }
  leave() {
    this.rawSend({ t: 'leave' });
    this.clearLocal();
  }

  // ---------- Avisos ----------
  toast(text: string, kind: Toast['kind'] = 'info') {
    const id = ++this.seqToast;
    this.toasts = [...this.toasts.slice(-2), { id, text, kind }];
    setTimeout(() => (this.toasts = this.toasts.filter((t) => t.id !== id)), 4200);
  }
}

export const ludo = new Ludo();
