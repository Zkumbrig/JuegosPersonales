import type { PlayerStats, RoomStats } from '../../shared/protocol';
import { ICONS } from './icons';
import { fmt } from './format';

export interface Award { key: string; icon: string; title: string; who: string; detail: string }

/** Premios de la noche. Solo se reparten los que tienen datos reales (nadie recibe un premio por nada). */
export function computeAwards(stats: RoomStats, soft: boolean): Award[] {
  const ps = stats.players;
  /** Mejor puntuación y todos los que la comparten (un empate se comparte, no se regala). */
  const top = (score: (p: PlayerStats) => number | null, higher = true) => {
    let best: number | null = null;
    for (const p of ps) {
      const s = score(p);
      if (s !== null && (best === null || (higher ? s > best : s < best))) best = s;
    }
    if (best === null) return null;
    return { who: ps.filter((p) => score(p) === best), s: best };
  };
  const names = (who: PlayerStats[]) => (who.length <= 2 ? who.map((p) => p.name).join(' y ') : 'Varios');
  const out: Award[] = [];

  const drinks = top((p) => (p.drinks > 0 ? p.drinks : null));
  if (drinks) out.push({
    key: 'drinks', icon: 'drink',
    title: soft ? 'El que más puntos perdió' : 'Rey de los tragos',
    who: names(drinks.who), detail: `${drinks.s} ${soft ? 'puntos' : 'tragos'}`,
  });

  const reflex = top((p) => p.bestReflex, false);
  if (reflex) out.push({ key: 'reflex', icon: 'reflex', title: 'Dedos de rayo', who: names(reflex.who), detail: `${reflex.s} ms` });

  const lucky = top((p) => (p.bigWin > 0 ? p.bigWin : null));
  if (lucky) {
    out.push({ key: 'lucky', icon: 'trophy', title: 'El suertudo', who: names(lucky.who), detail: `+${fmt(lucky.s)} en ${lucky.who[0].bigWinGame}` });
  }

  // Con todos igualados en fichas no hay tiburón.
  const shark = ps.length >= 2 ? top((p) => p.worth) : null;
  if (shark && shark.who.length < ps.length) {
    out.push({ key: 'shark', icon: 'chip', title: 'El tiburón', who: names(shark.who), detail: `${fmt(shark.s)} fichas` });
  }

  const debt = top((p) => (p.rebuys > 0 ? p.rebuys : null));
  if (debt) out.push({
    key: 'debt', icon: 'minus', title: 'El deudor del banco',
    who: names(debt.who), detail: `${debt.s} ${debt.s === 1 ? 'préstamo' : 'préstamos'}`,
  });

  const bluff = top((p) => (p.bluffs > 0 ? p.bluffs : null));
  if (bluff) out.push({
    key: 'bluff', icon: 'truth', title: 'El farolero',
    who: names(bluff.who), detail: `${bluff.s} ${bluff.s === 1 ? 'bote' : 'botes'} sin enseñar`,
  });

  return out;
}

export function duration(startedAt: number): string {
  const min = Math.max(1, Math.round((Date.now() - startedAt) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

// ---------- Imagen ----------
function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function iconImage(name: string, color: string, px: number): Promise<HTMLImageElement> {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 24 24" fill="none" stroke="${color}" ` +
    `stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><style>.d{fill:${color};fill-opacity:.2}</style>${ICONS[name] ?? ''}</svg>`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

function fit(c: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (c.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && c.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

/** Dibuja la tarjeta de la noche con los colores del estilo activo. */
export async function renderRecap(stats: RoomStats, soft: boolean, code: string): Promise<HTMLCanvasElement> {
  try {
    await Promise.all([document.fonts.load('900 100px Unbounded'), document.fonts.load('700 40px Unbounded'), document.fonts.load('500 30px Unbounded')]);
  } catch { /* sin fuente: se usa la de reserva */ }

  const awards = computeAwards(stats, soft);
  const cs = getComputedStyle(document.documentElement);
  const v = (k: string) => cs.getPropertyValue(k).trim();
  const bg = v('--bg'), glow = v('--bg-glow'), gold = v('--gold'), goldHi = v('--gold-hi'), goldLo = v('--gold-lo');
  const text = v('--text'), muted = v('--muted'), panel = v('--panel'), accent = v('--accent-rgb').split(/\s+/).join(',');
  const foilStops = v('--foil').match(/#[0-9a-fA-F]{6}/g) ?? [goldHi, gold, goldLo];
  const FONT = "'Unbounded', 'Arial Black', system-ui, sans-serif";

  const W = 1080;
  const ROW = 150;
  const H = 520 + Math.max(1, awards.length) * ROW + 120;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d')!;
  const foil = (x0: number, y0: number, x1: number, y1: number) => {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    foilStops.forEach((s, i) => g.addColorStop(i / Math.max(1, foilStops.length - 1), s));
    return g;
  };

  // Fondo + rayos art déco
  c.fillStyle = bg;
  c.fillRect(0, 0, W, H);
  const rg = c.createRadialGradient(W / 2, -40, 0, W / 2, -40, 900);
  rg.addColorStop(0, glow);
  rg.addColorStop(1, 'transparent');
  c.fillStyle = rg;
  c.fillRect(0, 0, W, H);
  c.fillStyle = `rgba(${accent},0.09)`;
  for (let a = 0; a < 360; a += 9) {
    const a0 = ((a - 90) * Math.PI) / 180, a1 = ((a + 4.5 - 90) * Math.PI) / 180;
    c.beginPath();
    c.moveTo(W / 2, -60);
    c.lineTo(W / 2 + Math.cos(a0) * 1800, -60 + Math.sin(a0) * 1800);
    c.lineTo(W / 2 + Math.cos(a1) * 1800, -60 + Math.sin(a1) * 1800);
    c.closePath();
    c.fill();
  }
  const fade = c.createLinearGradient(0, 0, 0, 640);
  fade.addColorStop(0, 'transparent');
  fade.addColorStop(1, bg);
  c.fillStyle = fade;
  c.fillRect(0, 0, W, 640);

  // Marca
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillStyle = foil(250, 80, 830, 230);
  c.font = `900 150px ${FONT}`;
  c.fillText('ROYALE', W / 2, 210);
  c.font = `700 40px ${FONT}`;
  c.fillStyle = gold;
  try { (c as unknown as { letterSpacing: string }).letterSpacing = '16px'; } catch { /* no soportado */ }
  c.fillText('CLUB', W / 2 + 8, 275);
  try { (c as unknown as { letterSpacing: string }).letterSpacing = '0px'; } catch { /* no soportado */ }

  c.font = `500 34px ${FONT}`;
  c.fillStyle = text;
  c.fillText('Resumen de la noche', W / 2, 360);
  c.font = `500 26px ${FONT}`;
  c.fillStyle = muted;
  c.fillText(new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }), W / 2, 403);

  // Datos de la mesa
  const facts = [
    [String(stats.rounds), stats.rounds === 1 ? 'ronda' : 'rondas'],
    [duration(stats.startedAt), 'de fiesta'],
    [String(stats.players.length), stats.players.length === 1 ? 'jugador' : 'jugadores'],
  ];
  const fw = 290, gap = 25, fx0 = (W - (fw * 3 + gap * 2)) / 2;
  facts.forEach(([big, small], i) => {
    const x = fx0 + i * (fw + gap);
    c.fillStyle = panel;
    roundRect(c, x, 440, fw, 96, 22);
    c.fill();
    c.strokeStyle = goldLo;
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = goldHi;
    c.font = `700 34px ${FONT}`;
    c.fillText(big, x + fw / 2, 490);
    c.fillStyle = muted;
    c.font = `500 20px ${FONT}`;
    c.fillText(small, x + fw / 2, 520);
  });

  // Premios
  const icons = await Promise.all(awards.map((a) => iconImage(a.icon, '#1a1208', 96).catch(() => null)));
  if (awards.length === 0) {
    c.fillStyle = muted;
    c.font = `500 30px ${FONT}`;
    c.fillText('Todavía no hay premios: ¡jueguen unas rondas!', W / 2, 640);
  }
  awards.forEach((a, i) => {
    const y = 580 + i * ROW;
    c.fillStyle = panel;
    roundRect(c, 60, y, W - 120, 124, 28);
    c.fill();
    c.strokeStyle = `rgba(${accent},0.35)`;
    c.lineWidth = 2;
    c.stroke();
    // medallón
    c.fillStyle = foil(80, y + 14, 180, y + 110);
    c.beginPath();
    c.arc(122, y + 62, 46, 0, Math.PI * 2);
    c.fill();
    const img = icons[i];
    if (img) c.drawImage(img, 122 - 30, y + 62 - 30, 60, 60);
    // textos
    c.textAlign = 'left';
    c.fillStyle = gold;
    c.font = `600 22px ${FONT}`;
    c.fillText(a.title.toUpperCase(), 188, y + 42);
    c.fillStyle = text;
    c.font = `800 44px ${FONT}`;
    c.fillText(fit(c, a.who, 440), 188, y + 94);
    c.textAlign = 'right';
    c.fillStyle = goldHi;
    c.font = `700 28px ${FONT}`;
    c.fillText(fit(c, a.detail, 330), W - 92, y + 74);
    c.textAlign = 'center';
  });

  // Pie
  c.fillStyle = muted;
  c.font = `500 22px ${FONT}`;
  c.fillText(`Mesa ${code} · fichas virtuales · sin dinero real · +18`, W / 2, H - 46);
  return canvas;
}
