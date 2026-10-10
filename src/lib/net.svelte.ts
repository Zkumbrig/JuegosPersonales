import { ACHIEVEMENTS, type ClientMsg, type ProfilePublic, type RoomPublic, type ServerMsg, type SlotSymbol } from '../../shared/protocol';
import { celebrate } from './celebrate.svelte';
import { pushReaction } from './reactions.svelte';
import { sfx } from './sound.svelte';

export interface SlotResult { seq: number; reels: SlotSymbol[]; bet: number; win: number }

function load(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* modo privado */ }
}

function makePid(): string {
  const stored = load('rc_pid');
  if (stored.length >= 8) return stored;
  const bytes = crypto.getRandomValues(new Uint8Array(16)); // randomUUID no existe en http de la LAN
  const pid = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  save('rc_pid', pid);
  return pid;
}

class Net {
  pid = makePid();
  name = $state(load('rc_name'));
  room = $state.raw<RoomPublic | null>(null);
  link = $state<'idle' | 'connecting' | 'open' | 'retrying'>('idle');
  error = $state('');
  errorKind = $state<'err' | 'ok'>('err');
  profile = $state.raw<ProfilePublic | null>(null);
  slot = $state.raw<SlotResult | null>(null);
  now = $state(Date.now());

  private ws: WebSocket | null = null;
  private want: { name: string; code?: string; screen?: boolean } | null = null;
  private stamp = Date.now();
  private retry = 0;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private errTimer?: ReturnType<typeof setTimeout>;
  private slotSeq = 0;

  private auto = false;

  constructor() {
    // Si la página se recargó (o el móvil descartó la pestaña), volvemos a la última mesa.
    const lastRoom = load('rc_room');
    if (lastRoom && this.name) {
      this.auto = true;
      this.want = { name: this.name, code: lastRoom };
      this.connect();
    }
    setInterval(() => { if (this.room) this.now = Date.now(); }, 250);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.want && this.ws?.readyState !== WebSocket.OPEN) {
        this.connect();
      }
    });
  }

  get me() {
    return this.room?.players.find((p) => p.id === this.pid);
  }

  /** Milisegundos restantes de una cuenta atrás que el servidor midió al enviar el estado. */
  left(ms: number | null | undefined): number | null {
    if (ms == null) return null;
    return Math.max(0, ms - (this.now - this.stamp));
  }

  join(name: string, code?: string) {
    this.name = name.trim();
    save('rc_name', this.name);
    this.want = { name: this.name, code: code?.toUpperCase().trim() || undefined };
    this.error = '';
    this.connect();
  }

  leave() {
    this.send({ t: 'leave' });
    this.want = null;
    this.room = null;
    this.link = 'idle';
    save('rc_room', '');
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    setTimeout(() => ws?.close(), 200);
    this.ws = null;
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Entra como pantalla compartida (TV): solo mira la mesa. */
  joinScreen(code: string) {
    this.want = { name: 'Pantalla', code: code.toUpperCase().trim(), screen: true };
    this.error = '';
    this.connect();
  }

  toast(text: string, kind: 'err' | 'ok' = 'err') {
    this.errorKind = kind;
    this.error = text;
    clearTimeout(this.errTimer);
    this.errTimer = setTimeout(() => (this.error = ''), 3200);
  }

  private connect() {
    if (!this.want) return;
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) {
      if (this.ws.readyState === WebSocket.OPEN) this.sendJoin();
      return;
    }
    clearTimeout(this.retryTimer);
    this.link = this.room ? 'retrying' : 'connecting';
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => { this.retry = 0; this.sendJoin(); };
    ws.onmessage = (ev) => this.onMessage(JSON.parse(ev.data) as ServerMsg);
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.want) return;
      this.link = 'retrying';
      this.retryTimer = setTimeout(() => this.connect(), Math.min(5000, 800 * ++this.retry));
    };
  }

  private sendJoin() {
    if (!this.want) return;
    // Si ya estábamos en una sala, reentramos en esa, no en una nueva.
    const code = this.room?.code ?? this.want.code;
    this.send({ t: 'join', pid: this.pid, name: this.want.name, code, screen: this.want.screen });
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'state':
        this.room = m.room;
        this.stamp = Date.now();
        this.now = this.stamp;
        this.link = 'open';
        this.auto = false;
        if (!this.want?.screen) save('rc_room', m.room.code); // una pantalla no debe reentrar como jugador al recargar
        break;
      case 'profile':
        this.profile = m.profile;
        break;
      case 'achievement': {
        const def = ACHIEVEMENTS.find((a) => a.id === m.id);
        celebrate(false);
        sfx.win();
        this.toast(`Logro desbloqueado: ${def?.name ?? m.id}`, 'ok');
        break;
      }
      case 'react':
        pushReaction(m.from, m.kind);
        sfx.pop();
        break;
      case 'kicked':
        this.room = null;
        this.want = null;
        this.link = 'idle';
        save('rc_room', '');
        this.toast('El anfitrión te ha expulsado de la mesa.');
        break;
      case 'err': {
        if (this.room && !/no existe/.test(m.msg)) { this.toast(m.msg); break; }
        // No pudimos entrar (o la sala desapareció): volvemos a la portada.
        const hadRoom = !!this.room;
        this.room = null;
        this.want = null;
        this.link = 'idle';
        save('rc_room', '');
        if (this.auto) this.auto = false; // reingreso silencioso: sin aviso
        else this.toast(hadRoom ? 'La mesa ya no existe (se cerró mientras estabas fuera).' : m.msg);
        break;
      }
      case 'sl:result':
        this.slot = { seq: ++this.slotSeq, reels: m.reels, bet: m.bet, win: m.win };
        break;
    }
  }
}

export const net = new Net();
