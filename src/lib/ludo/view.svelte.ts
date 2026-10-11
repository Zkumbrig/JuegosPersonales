// Director de animación del Ludo. El servidor manda el estado y los eventos nuevos (dado, pasos, capturas);
// aquí se reproducen uno tras otro antes de mostrar el estado definitivo, así el tablero nunca "salta".

import type { LudoEvent, LudoPublic } from '../../../shared/protocol';
import { armColor, finalPos } from '../../../shared/ludo';
import { celebrate } from '../celebrate.svelte';
import { net } from '../net.svelte';
import { sfx } from '../sound.svelte';
import { geometry, type Pt } from './geometry';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface Entry { pub: LudoPublic; events: LudoEvent[]; at: number }
export interface Burst { id: number; x: number; y: number; color: string }
export interface LogLine { id: number; text: string; color: string | null }

class LudoView {
  /** Estado ya mostrado (va por detrás del servidor mientras se animan los eventos). */
  pub = $state.raw<LudoPublic | null>(null);
  /** Instante (ms locales) en que llegó el estado mostrado: sirve para las cuentas atrás. */
  at = $state(0);
  /** Progreso que se dibuja de cada peón (cambia paso a paso en las animaciones). */
  shown = $state.raw<Record<string, number[]>>({});
  /** El dado: `id` cambia en cada tirada para repetir su animación. */
  dice = $state.raw<{ id: number; value: number | null; rolling: boolean; playerId: string | null }>({ id: 0, value: null, rolling: false, playerId: null });
  /** Peones recién comidos ("playerId:pawn"). */
  popped = $state.raw<string[]>([]);
  /** Estallidos de partículas (en coordenadas del tablero sin girar). */
  bursts = $state.raw<Burst[]>([]);
  /** Último peón movido: se dibuja un poco más grande. */
  lastMoved = $state.raw<string | null>(null);
  log = $state.raw<LogLine[]>([]);

  private lastSeq = 0;
  private queue: Entry[] = [];
  private busy = false;
  private epoch = 0;
  private logSeq = 0;
  private burstSeq = 0;

  /** Milisegundos que le quedan al turno mostrado, o null. */
  turnLeft(): number | null {
    const ms = this.pub?.turn?.timeLeft;
    if (ms == null) return null;
    return Math.max(0, ms - (net.now - this.at));
  }

  /** Aplica el estado tal cual, sin animar (al entrar a la zona, al empezar o al volver a la preparación). */
  snap(lu: LudoPublic) {
    this.epoch++;
    this.queue = [];
    this.busy = false;
    this.lastSeq = lu.seq;
    this.popped = [];
    this.bursts = [];
    this.lastMoved = null;
    this.dice = { id: this.dice.id, value: lu.turn?.dice ?? null, rolling: false, playerId: lu.turn?.playerId ?? null };
    if (lu.phase === 'setup') this.log = [];
    this.commit(lu, Date.now());
  }

  /** Llega un estado nuevo de la mesa. */
  ingest(lu: LudoPublic) {
    const prev = this.pub;
    if (!prev || lu.phase === 'setup' || prev.phase === 'setup' || lu.seq < this.lastSeq) return this.snap(lu);
    const events = lu.events.filter((e) => e.seq > this.lastSeq);
    this.lastSeq = lu.seq;
    if (!events.length && !this.busy && !this.queue.length) return this.commit(lu, Date.now());
    this.queue.push({ pub: lu, events, at: Date.now() });
    void this.pump();
  }

  reset() {
    this.epoch++;
    this.queue = [];
    this.busy = false;
    this.pub = null;
  }

  private commit(lu: LudoPublic, at: number) {
    const prev = this.pub;
    this.at = at;
    this.shown = Object.fromEntries(lu.seats.map((s) => [s.id, [...s.pawns]]));
    this.pub = lu;
    // Aviso cuando te toca tirar.
    const t = lu.turn;
    const wasMine = prev?.phase === 'playing' && prev.turn?.playerId === net.pid && prev.turn?.step === 'roll';
    if (t && lu.phase === 'playing' && t.playerId === net.pid && t.step === 'roll' && !wasMine) {
      sfx.yours();
      navigator.vibrate?.(70);
    }
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    const epoch = this.epoch;
    while (this.queue.length) {
      const e = this.queue.shift()!;
      const fast = document.hidden || this.queue.length >= 2;
      for (const ev of e.events) {
        if (epoch !== this.epoch) return;
        await this.play(ev, e.pub, fast, epoch);
      }
      if (epoch !== this.epoch) return;
      this.commit(e.pub, e.at);
    }
    this.busy = false;
  }

  private setShown(playerId: string, pawn: number, p: number) {
    const arr = [...(this.shown[playerId] ?? [0, 0, 0, 0])];
    arr[pawn] = p;
    this.shown = { ...this.shown, [playerId]: arr };
  }

  private say(text: string, who: { arm: number } | null | undefined, lu: LudoPublic) {
    const color = who ? armColor(lu.options.board, who.arm).hex : null;
    this.log = [...this.log.slice(-29), { id: ++this.logSeq, text, color }];
  }

  private async play(ev: LudoEvent, lu: LudoPublic, fast: boolean, epoch: number) {
    const board = lu.options.board;
    const seat = (id: string) => lu.seats.find((s) => s.id === id);
    const actor = 'playerId' in ev ? seat(ev.playerId) : undefined;
    const name = actor ? (actor.id === net.pid ? 'Tú' : actor.name) : '…';
    const wait = async (ms: number) => {
      if (!fast && ms > 0) await sleep(ms);
    };

    switch (ev.type) {
      case 'start':
        this.say(`Empieza la partida. Abre ${name}.`, actor, lu);
        break;
      case 'roll':
        this.dice = { id: this.dice.id + 1, value: ev.dice, rolling: true, playerId: ev.playerId };
        if (!fast) sfx.dice();
        await wait(1050);
        if (epoch !== this.epoch) return;
        this.dice = { ...this.dice, rolling: false };
        this.say(`${name} ${name === 'Tú' ? 'sacaste' : 'sacó'} un ${ev.dice}.`, actor, lu);
        await wait(150);
        break;
      case 'move': {
        const key = `${ev.playerId}:${ev.pawn}`;
        this.lastMoved = key;
        if (ev.from === 0) {
          this.setShown(ev.playerId, ev.pawn, 1);
          if (!fast) sfx.hop();
          await wait(380);
          this.say(`${name} saca un peón.`, actor, lu);
        } else {
          for (let p = ev.from + 1; p <= ev.to; p++) {
            if (epoch !== this.epoch) return;
            this.setShown(ev.playerId, ev.pawn, p);
            if (!fast) sfx.hop();
            await wait(190);
          }
          const home = ev.to === finalPos(board);
          this.say(home ? `${name} metió un peón en la meta.` : `${name} avanza ${ev.to - ev.from}.`, actor, lu);
          if (home) {
            if (!fast) sfx.home();
            this.burst(geometry(board).pawnPoint(actor?.arm ?? 0, ev.to, ev.pawn), armColor(board, actor?.arm ?? 0).hex);
            await wait(250);
          }
        }
        if (ev.captured.length) {
          if (!fast) sfx.thud();
          if (!fast) navigator.vibrate?.(40);
          this.popped = ev.captured.map((c) => `${c.playerId}:${c.pawn}`);
          for (const c of ev.captured) {
            const victim = seat(c.playerId);
            if (victim) this.burst(geometry(board).pawnPoint(victim.arm, c.from, c.pawn), armColor(board, victim.arm).hex);
            this.setShown(c.playerId, c.pawn, 0);
            this.say(`${name} se comió un peón de ${victim?.id === net.pid ? 'ti' : (victim?.name ?? '…')}.`, actor, lu);
          }
          await wait(620);
          this.popped = [];
        }
        break;
      }
      case 'pass':
        this.say(ev.reason === 'triple-six' ? `${name} sacó tres 6 seguidos y pierde el turno.` : `${name} no puede mover.`, actor, lu);
        break;
      case 'finish':
        this.say(`${name} terminó en el puesto ${ev.rank}.`, actor, lu);
        if (!fast && ev.rank !== 1) sfx.home();
        break;
      case 'leave':
        this.say(`${name} abandonó la partida.`, actor, lu);
        break;
      case 'end': {
        this.say('Fin de la partida.', null, lu);
        const mine = lu.seats.find((s) => s.id === net.pid);
        if (mine?.rank === 1 && !fast) {
          celebrate(true);
          sfx.jackpot();
        } else if (!fast) sfx.win();
        break;
      }
    }
  }

  private burst(pt: Pt, color: string) {
    const id = ++this.burstSeq;
    this.bursts = [...this.bursts, { id, x: pt.x, y: pt.y, color }];
    setTimeout(() => (this.bursts = this.bursts.filter((b) => b.id !== id)), 900);
  }
}

export const lv = new LudoView();
