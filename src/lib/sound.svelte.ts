// Efectos sintetizados con WebAudio: cero archivos, cero peso.
function loadMuted(): boolean {
  try { return localStorage.getItem('rc_muted') === '1'; } catch { return false; }
}

export const sound = $state({ muted: loadMuted() });

export function toggleMute() {
  sound.muted = !sound.muted;
  try { localStorage.setItem('rc_muted', sound.muted ? '1' : '0'); } catch { /* ignore */ }
}

let ctx: AudioContext | null = null;
function ac(): AudioContext | null {
  if (sound.muted) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

interface ToneOpts { type?: OscillatorType; vol?: number; at?: number; slide?: number }
function tone(freq: number, dur: number, { type = 'sine', vol = 0.08, at = 0, slide = 0 }: ToneOpts = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + at;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

export const sfx = {
  chip() { tone(1500, 0.06, { type: 'triangle', vol: 0.07 }); tone(950, 0.06, { type: 'triangle', vol: 0.06, at: 0.04 }); },
  card() { tone(260, 0.05, { type: 'square', vol: 0.025, slide: -90 }); },
  tick() { tone(1900, 0.025, { vol: 0.03 }); },
  stop() { tone(520, 0.09, { type: 'triangle', vol: 0.08 }); },
  win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, { type: 'triangle', vol: 0.1, at: i * 0.09 })); },
  jackpot() { [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone(f, 0.26, { type: 'triangle', vol: 0.11, at: i * 0.1 })); },
  pop() { tone(640, 0.07, { type: 'sine', vol: 0.035, slide: 380 }); },
  go() { tone(1320, 0.18, { type: 'square', vol: 0.07 }); },
  drink() { tone(520, 0.12, { type: 'triangle', vol: 0.09 }); tone(390, 0.12, { type: 'triangle', vol: 0.09, at: 0.12 }); tone(260, 0.2, { type: 'triangle', vol: 0.09, at: 0.24 }); },
  // ----- Ludo -----
  /** Traqueteo del dado sobre la mesa. */
  dice() { for (let i = 0; i < 8; i++) tone(260 + Math.random() * 420, 0.04, { type: 'square', vol: 0.028, at: i * 0.075 }); tone(180, 0.12, { type: 'triangle', vol: 0.07, at: 0.62 }); },
  hop() { tone(520, 0.05, { type: 'triangle', vol: 0.05, slide: 160 }); },
  thud() { tone(210, 0.26, { type: 'sawtooth', vol: 0.06, slide: -140 }); tone(110, 0.3, { type: 'square', vol: 0.04, at: 0.04, slide: -60 }); },
  home() { [523, 659, 784].forEach((f, i) => tone(f, 0.16, { type: 'triangle', vol: 0.07, at: i * 0.08 })); },
  yours() { tone(880, 0.1, { vol: 0.07 }); tone(1320, 0.16, { vol: 0.06, at: 0.09 }); },
  lose() { tone(240, 0.35, { type: 'sawtooth', vol: 0.045, slide: -90 }); },
};
