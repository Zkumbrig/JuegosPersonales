// Efectos de sonido sintetizados con WebAudio (sin archivos). Se desactivan con el botón de altavoz.

const KEY = 'ludo.muted';

class Sound {
  muted = $state(false);
  private ctx: AudioContext | null = null;

  constructor() {
    try {
      this.muted = localStorage.getItem(KEY) === '1';
    } catch { /* sin almacenamiento */ }
  }

  toggle() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(KEY, this.muted ? '1' : '0');
    } catch { /* sin almacenamiento */ }
    if (!this.muted) this.tick();
  }

  /** Los navegadores solo dejan sonar tras un gesto del usuario. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; at?: number; to?: number } = {}) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const { type = 'sine', vol = 0.07, at = 0, to } = opts;
    const t0 = this.ctx.currentTime + at;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Traqueteo del dado. */
  roll() {
    for (let i = 0; i < 7; i++) this.tone(300 + Math.random() * 500, 0.04, { type: 'square', vol: 0.03, at: i * 0.07 });
  }
  /** Paso de un peón. */
  tick() {
    this.tone(660, 0.06, { type: 'triangle', vol: 0.05 });
  }
  capture() {
    this.tone(220, 0.28, { type: 'sawtooth', vol: 0.06, to: 70 });
    this.tone(110, 0.3, { type: 'square', vol: 0.04, at: 0.05, to: 50 });
  }
  /** Aviso de que es tu turno. */
  ping() {
    this.tone(880, 0.12, { vol: 0.07 });
    this.tone(1320, 0.18, { vol: 0.06, at: 0.1 });
  }
  /** Un peón llegó a la meta. */
  home() {
    [523, 659, 784].forEach((f, i) => this.tone(f, 0.16, { type: 'triangle', vol: 0.06, at: i * 0.09 }));
  }
  win() {
    [523, 659, 784, 1047, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.07, at: i * 0.13 }));
  }
}

export const sound = new Sound();
