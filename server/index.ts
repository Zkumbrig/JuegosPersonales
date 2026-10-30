// Variables de entorno desde .env si existe (Node ≥ 20.12); en Render vienen del panel.
try { process.loadEnvFile(); } catch { /* sin .env */ }

import http, { type IncomingMessage } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Player, Room } from './room';
import { loadRooms, saveRooms } from './persist';
import { profiles } from './profiles';
import { authRoutes } from './authHttp';
import { getDb } from './db';
import { renderMetrics, telemetry } from './telemetry';
import { renderAdmin, reviews } from './reviews';
import { timingSafeEqual } from 'node:crypto';
import { makeCode, rnd } from './util';
import { MAX_PLAYERS, type ClientMsg, type ServerMsg } from '../shared/protocol';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 3001;
const DATA_FILE = process.env.DATA_FILE ?? path.join(ROOT, 'data', 'rooms.json');
const PERSIST_MS = Number(process.env.PERSIST_MS) || 10_000;
/** Detrás de un proxy (Hostinger, Nginx, Cloudflare) la IP real viene en x-forwarded-for. */
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

// Límites contra abusos (todos ajustables por entorno; los valores por defecto sirven para una fiesta)
const RATE_BURST = Number(process.env.RATE_BURST) || 40; // mensajes seguidos permitidos
const RATE_PER_SEC = Number(process.env.RATE_PER_SEC) || 25; // y ritmo sostenido por segundo
const MAX_DROPS = 400; // mensajes descartados en 10 s antes de cortar la conexión
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP) || 30;
const JOIN_FAILS_MAX = Number(process.env.JOIN_FAILS_MAX) || 12; // códigos erróneos por minuto y IP
const JOIN_BLOCK_MS = 3 * 60_000;

// Un fallo inesperado (por ejemplo dentro de un temporizador) no debe tumbar todas las mesas.
process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

// ---------- Reseñas privadas: solo con ADMIN_KEY ----------
const adminFails = new Map<string, { n: number; since: number }>();
function adminKeyOk(given: string): boolean {
  const key = process.env.ADMIN_KEY ?? '';
  if (key.length < 12 || !given) return false; // sin clave larga configurada, la ruta no existe
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
const ADMIN_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' };
/** Comprueba la clave de administrador. Si no es válida ya respondió (404 o 429) y devuelve false. */
function adminGate(req: IncomingMessage, url: URL, res: http.ServerResponse): boolean {
  const headers = ADMIN_HEADERS;
  if ((process.env.ADMIN_KEY ?? '').length < 12) { res.writeHead(404, headers).end(); return false; }
  const ip = TRUST_PROXY ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || (req.socket.remoteAddress ?? '?') : (req.socket.remoteAddress ?? '?');
  const f = adminFails.get(ip);
  if (f && Date.now() - f.since < 10 * 60_000 && f.n >= 8) { res.writeHead(429, headers).end('Demasiados intentos'); return false; }
  const given = url.searchParams.get('key') ?? String(req.headers['x-admin-key'] ?? '');
  if (!adminKeyOk(given)) {
    const cur = f && Date.now() - f.since < 10 * 60_000 ? f : { n: 0, since: Date.now() };
    cur.n++;
    adminFails.set(ip, cur);
    res.writeHead(404, headers).end();
    return false;
  }
  return true;
}
async function adminReviews(req: IncomingMessage, url: URL, res: http.ServerResponse) {
  if (!adminGate(req, url, res)) return;
  const headers = ADMIN_HEADERS;
  const list = await reviews.list(500);
  if (url.searchParams.get('format') === 'json') {
    res.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ mode: reviews.mode, reviews: list }));
  } else {
    res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8' }).end(renderAdmin(list, reviews.mode));
  }
}

async function adminMetrics(req: IncomingMessage, url: URL, res: http.ServerResponse) {
  if (!adminGate(req, url, res)) return;
  const report = await telemetry.report();
  if (url.searchParams.get('format') === 'json') {
    res.writeHead(200, { ...ADMIN_HEADERS, 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(report));
  } else {
    res.writeHead(200, { ...ADMIN_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }).end(renderMetrics(report));
  }
}

// ---------- HTTP estático (producción) ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname === '/admin/reviews') return void (await adminReviews(req, url, res));
    if (url.pathname === '/admin/metrics') return void (await adminMetrics(req, url, res));
    if (await authRoutes(req, res, url)) return; // /api/auth/*: inicio de sesión por correo
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; } // para el monitor de la plataforma
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST)) { res.writeHead(403).end(); return; }
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    } catch {
      file = path.join(DIST, 'index.html'); // SPA fallback
    }
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Ejecuta "npm run build" primero.');
  }
});

// ---------- Mesas (con copia en disco para sobrevivir a reinicios) ----------
const rooms = new Map<string, Room>();
for (const r of loadRooms(DATA_FILE, (c) => rooms.delete(c))) rooms.set(r.code, r);
if (rooms.size) console.log(`Recuperadas ${rooms.size} mesa(s) de la última copia`);
profiles.init(DATA_FILE.replace(/\.json$/, '') + '.profiles.json');
const db = await getDb();
await profiles.attachDb(db); // con Supabase, los perfiles y logros se guardan allí
telemetry.attach(db); // y la medición de sesiones, rondas y regresos
await reviews.init(DATA_FILE.replace(/\.json$/, '') + '.reviews.json');
const persistTimer = setInterval(() => { saveRooms(DATA_FILE, rooms.values()); void profiles.save().then(() => telemetry.flush()); }, PERSIST_MS);
persistTimer.unref();

// ---------- Límites por IP ----------
const connsByIp = new Map<string, number>();
const joinFails = new Map<string, { n: number; since: number; blockedUntil: number }>();
setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of joinFails) if (now > f.blockedUntil && now - f.since > 60_000) joinFails.delete(ip);
}, 60_000).unref();

const ipOf = (req: IncomingMessage): string => {
  if (TRUST_PROXY) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
};

const joinBlocked = (ip: string) => (joinFails.get(ip)?.blockedUntil ?? 0) > Date.now();
function noteJoinFail(ip: string) {
  const now = Date.now();
  let f = joinFails.get(ip);
  if (!f || now - f.since > 60_000) f = { n: 0, since: now, blockedUntil: f?.blockedUntil ?? 0 };
  if (++f.n >= JOIN_FAILS_MAX) f.blockedUntil = now + JOIN_BLOCK_MS;
  joinFails.set(ip, f);
}

/** Cubo de fichas: permite ráfagas cortas y limita el ritmo sostenido. */
class Bucket {
  private tokens = RATE_BURST;
  private last = Date.now();
  take(): boolean {
    const now = Date.now();
    this.tokens = Math.min(RATE_BURST, this.tokens + ((now - this.last) / 1000) * RATE_PER_SEC);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });
const send = (ws: WebSocket, msg: ServerMsg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

wss.on('connection', (ws, req) => {
  const ip = ipOf(req);
  const open = (connsByIp.get(ip) ?? 0) + 1;
  if (open > MAX_CONN_PER_IP) { ws.close(1013, 'demasiadas conexiones'); return; }
  connsByIp.set(ip, open);

  let room: Room | null = null;
  let screenRoom: Room | null = null;
  let player: Player | null = null;
  let alive = true;
  const bucket = new Bucket();
  let drops = 0;
  let dropsSince = Date.now();
  ws.on('pong', () => (alive = true));

  ws.on('message', async (raw) => {
    try {
      if (!bucket.take()) {
        if (Date.now() - dropsSince > 10_000) { drops = 0; dropsSince = Date.now(); }
        if (++drops > MAX_DROPS) ws.close(1008, 'ritmo excesivo');
        return; // se ignora sin responder, para no multiplicar el trabajo
      }
      let m: ClientMsg;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (!m || typeof m.t !== 'string') return;

      if (m.t === 'join') {
        if (room || screenRoom) return;
        const name = String(m.name ?? '').trim().slice(0, 16);
        const pid = String(m.pid ?? '');
        if (!name) return send(ws, { t: 'err', msg: 'Escribe tu nombre.' });
        if (pid.length < 8 || pid.length > 64) return;
        if (joinBlocked(ip)) return send(ws, { t: 'err', msg: 'Demasiados intentos. Espera unos minutos.' });
        if (!m.screen) {
          await profiles.hydrate(pid); // trae su historial de la base de datos antes de sentarlo
          if (room || screenRoom) return; // otra unión terminó mientras esperábamos
        }

        if (m.screen) {
          // Pantalla compartida: solo mira. Una pantalla ya conocida puede volver aunque la mesa esté cerrada.
          const t = rooms.get(String(m.code ?? '').toUpperCase().trim());
          if (!t) { noteJoinFail(ip); return send(ws, { t: 'err', msg: 'Esa sala no existe.' }); }
          if (t.locked && !t.screenPids.has(pid)) return send(ws, { t: 'err', msg: 'La mesa está cerrada a nuevos jugadores.' });
          const err = t.addScreen(ws, pid);
          if (err) return send(ws, { t: 'err', msg: err });
          screenRoom = t;
          return;
        }

        let target: Room | undefined;
        if (m.code) {
          target = rooms.get(String(m.code).toUpperCase().trim());
          if (!target) { noteJoinFail(ip); return send(ws, { t: 'err', msg: 'Esa sala no existe.' }); }
          if (target.banned.has(pid)) return send(ws, { t: 'err', msg: 'El anfitrión te ha expulsado de esta mesa.' });
          if (target.locked && !target.players.has(pid)) return send(ws, { t: 'err', msg: 'La mesa está cerrada a nuevos jugadores.' });
        } else {
          let code = makeCode();
          while (rooms.has(code)) code = makeCode();
          target = new Room(code, (c) => rooms.delete(c));
          rooms.set(code, target);
        }
        let p = target.players.get(pid);
        let isNew = false;
        if (!p) {
          if (target.players.size >= MAX_PLAYERS) return send(ws, { t: 'err', msg: 'La mesa está llena.' });
          p = new Player(pid, name, rnd(8));
          target.players.set(pid, p);
          if (!target.hostId) target.hostId = pid;
          isNew = true;
        } else {
          p.name = name;
        }
        room = target;
        player = p;
        room.attach(p, ws);
        if (isNew) room.welcome(p);
        return;
      }

      if (!room || !player) return;
      if (m.t === 'leave') {
        room.remove(player);
        room = null;
        player = null;
        send(ws, { t: 'left' });
        return;
      }
      room.handle(player, m);
    } catch (e) {
      console.error('[ws] error procesando mensaje', e);
    }
  });

  ws.on('close', () => {
    connsByIp.set(ip, Math.max(0, (connsByIp.get(ip) ?? 1) - 1));
    if (room && player) room.detach(player, ws);
    screenRoom?.removeScreen(ws);
  });
  ws.on('error', () => ws.terminate());

  // Detecta conexiones muertas (móvil que pierde señal)
  const ping = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 20_000);
  ws.on('close', () => clearInterval(ping));
});

// ---------- Apagado limpio: guarda las mesas para recuperarlas al volver ----------
async function shutdown() {
  saveRooms(DATA_FILE, rooms.values());
  for (const code of rooms.keys()) telemetry.sessionClose(code);
  await Promise.race([profiles.save().then(() => telemetry.flush()), new Promise((r) => setTimeout(r, 4000))]); // con base de datos, escribe lo pendiente
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

server.listen(PORT, () => console.log(`Royale Club escuchando en http://localhost:${PORT}`));

// ---------- Mantener despierto el servicio (Render, plan gratuito) ----------
// Render duerme el servicio tras 15 min sin tráfico ENTRANTE. Un ping a localhost no pasa por su proxy y no
// cuenta, así que el servidor se llama a sí mismo por su URL pública (RENDER_EXTERNAL_URL, que pone Render).
// Solo actúa en Render; KEEPALIVE=0 lo desactiva. Ojo: el plan gratuito da 750 h al mes por cuenta.
const SELF_URL = process.env.RENDER_EXTERNAL_URL || process.env.KEEPALIVE_URL;
if (SELF_URL && process.env.KEEPALIVE !== '0') {
  const every = Number(process.env.KEEPALIVE_MS) || 4 * 60_000;
  const ping = () => fetch(new URL('/healthz', SELF_URL), { signal: AbortSignal.timeout(10_000) }).catch(() => { /* sin red un momento: se reintenta */ });
  setInterval(ping, every).unref();
  console.log(`Keep-alive: ping a ${SELF_URL}/healthz cada ${Math.round(every / 1000)} s`);
}
