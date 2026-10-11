import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { Room, RoomError, type Conn } from './room';
import { parseClientMsg } from './validate';
import { Bucket, cleanCode, makeCode } from './util';
import type { ErrorCode, ServerMsg } from './shared/protocol';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3002;
/** Carpeta con el cliente compilado (client/build). Si existe, este mismo proceso lo sirve. */
const CLIENT_DIR = path.resolve(process.env.CLIENT_DIR ?? path.join(HERE, '..', '..', 'client', 'build'));
/** Detrás de un proxy (Nginx, Cloudflare, Hostinger…) la IP real llega en x-forwarded-for. */
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
/** Orígenes permitidos para el WebSocket y la API, separados por comas. Vacío = cualquiera. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const MAX_ROOMS = Number(process.env.MAX_ROOMS) || 500;
const MAX_CONN_PER_IP = Number(process.env.MAX_CONN_PER_IP) || 40;
const RATE_BURST = 30;
const RATE_PER_SEC = 12;
const MAX_DROPS = 200;
const JOIN_FAILS_MAX = 10; // códigos erróneos por minuto y por IP
const JOIN_BLOCK_MS = 3 * 60_000;
const CREATES_PER_MIN = 8;
const IDLE_ANY_MS = 60 * 60_000; // ni siquiera conectados hacen nada en una hora
const IDLE_ABANDONED_MS = 10 * 60_000;

process.on('uncaughtException', (e) => console.error('[uncaughtException]', e));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

// ---------- Salas ----------
const rooms = new Map<string, Room>();

/** Solo para pruebas manuales: LUDO_DEBUG_DICE=6,3,6,5 hace que los dados salgan en ese orden (en bucle). */
function debugDice(): (() => number) | undefined {
  const list = (process.env.LUDO_DEBUG_DICE ?? '').split(',').map(Number).filter((n) => n >= 1 && n <= 6);
  if (!list.length) return undefined;
  let i = 0;
  return () => list[i++ % list.length]!;
}

function createRoom(): Room {
  if (rooms.size >= MAX_ROOMS) throw new RoomError('full', 'El servidor está lleno, inténtalo en unos minutos.');
  let code = makeCode();
  while (rooms.has(code)) code = makeCode();
  const room = new Room(code, { dice: debugDice() });
  rooms.set(code, room);
  return room;
}

function dropRoom(room: Room) {
  room.dispose();
  rooms.delete(room.code);
}

setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    const idle = now - room.lastActive;
    const abandoned = !room.hasConnectedHuman() && idle > IDLE_ABANDONED_MS;
    if (!room.hasHuman() || abandoned || idle > IDLE_ANY_MS) dropRoom(room);
  }
}, 60_000).unref();

// ---------- Límites por IP ----------
const connsByIp = new Map<string, number>();
const joinFails = new Map<string, { n: number; since: number; blockedUntil: number }>();
const creates = new Map<string, number[]>();

function clientIp(req: IncomingMessage): string {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function isBlocked(ip: string) {
  const f = joinFails.get(ip);
  return !!f && Date.now() < f.blockedUntil;
}

function registerJoinFail(ip: string) {
  const now = Date.now();
  let f = joinFails.get(ip);
  if (!f || now - f.since > 60_000) f = { n: 0, since: now, blockedUntil: 0 };
  f.n++;
  if (f.n >= JOIN_FAILS_MAX) f.blockedUntil = now + JOIN_BLOCK_MS;
  joinFails.set(ip, f);
}

function canCreate(ip: string) {
  const now = Date.now();
  const list = (creates.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= CREATES_PER_MIN) return false;
  list.push(now);
  creates.set(ip, list);
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, f] of joinFails) if (now > f.blockedUntil && now - f.since > 60_000) joinFails.delete(ip);
  for (const [ip, l] of creates) if (!l.some((t) => now - t < 60_000)) creates.delete(ip);
}, 60_000).unref();

function originOk(req: IncomingMessage) {
  if (ALLOWED_ORIGINS.length === 0) return true;
  const origin = req.headers.origin;
  return !!origin && ALLOWED_ORIGINS.includes(origin);
}

// ---------- HTTP: API REST + cliente estático ----------
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function json(req: IncomingMessage, res: ServerResponse, status: number, body: unknown) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin))) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
  }
  res.writeHead(status, headers).end(JSON.stringify(body));
}

async function serveStatic(pathname: string, res: ServerResponse) {
  let file = path.join(CLIENT_DIR, decodeURIComponent(pathname));
  if (!file.startsWith(CLIENT_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(CLIENT_DIR, 'index.html'); // la app es una SPA: cualquier ruta desconocida abre el index
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
      'Cache-Control': file.includes(`${path.sep}immutable${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Falta el cliente: ejecuta "npm run build" en ludo/client.');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;

    if (req.method === 'OPTIONS' && p.startsWith('/api/')) {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': req.headers.origin ?? '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
      }).end();
      return;
    }

    if (p === '/healthz' || p === '/api/health') {
      return json(req, res, 200, { ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) });
    }

    // GET /api/rooms/:code — ¿existe la sala y se puede entrar?
    const m = /^\/api\/rooms\/([^/]+)$/.exec(p);
    if (m && req.method === 'GET') {
      const ip = clientIp(req);
      if (isBlocked(ip)) return json(req, res, 429, { error: 'blocked' satisfies ErrorCode });
      const code = cleanCode(decodeURIComponent(m[1]!));
      const room = code ? rooms.get(code) : undefined;
      if (!room) {
        registerJoinFail(ip);
        return json(req, res, 404, { error: 'not-found' satisfies ErrorCode });
      }
      return json(req, res, 200, room.info());
    }

    if (p.startsWith('/api/')) return json(req, res, 404, { error: 'not-found' satisfies ErrorCode });
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    await serveStatic(p, res);
  } catch (e) {
    console.error('[http]', e);
    if (!res.headersSent) res.writeHead(500).end();
  }
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });

server.on('upgrade', (req, socket, head) => {
  const ip = clientIp(req);
  const pathname = new URL(req.url ?? '/', 'http://x').pathname;
  if (pathname !== '/ws' || !originOk(req) || (connsByIp.get(ip) ?? 0) >= MAX_CONN_PER_IP) {
    socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const ip = clientIp(req);
  connsByIp.set(ip, (connsByIp.get(ip) ?? 0) + 1);

  const conn: Conn = {
    send: (raw) => {
      if (ws.readyState === ws.OPEN) ws.send(raw);
    },
    close: () => ws.close(1000),
  };
  const sendMsg = (msg: ServerMsg) => conn.send(JSON.stringify(msg));
  const sendError = (code: ErrorCode, message: string) => sendMsg({ t: 'error', code, message });

  let ctx: { room: Room; id: string } | null = null;
  const bucket = new Bucket(RATE_BURST, RATE_PER_SEC);
  let drops = 0;
  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, 25_000);

  /** Una sala vacía de personas no tiene sentido: se borra enseguida. */
  const cleanupIfEmpty = (room: Room) => {
    if (!room.hasHuman()) dropRoom(room);
  };

  const leaveCurrent = () => {
    if (!ctx) return;
    const { room, id } = ctx;
    ctx = null;
    room.leave(id);
    cleanupIfEmpty(room);
  };

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    if (!bucket.take()) {
      if (++drops > MAX_DROPS) ws.close(1008, 'rate');
      else sendError('rate-limit', 'Vas demasiado rápido.');
      return;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(data.toString());
    } catch {
      return sendError('bad-request', 'Mensaje ilegible.');
    }
    const msg = parseClientMsg(raw);
    if (!msg) return sendError('bad-request', 'Mensaje no válido.');

    try {
      switch (msg.t) {
        case 'create': {
          if (isBlocked(ip)) throw new RoomError('blocked', 'Demasiados intentos. Espera unos minutos.');
          if (!canCreate(ip)) throw new RoomError('rate-limit', 'Estás creando salas demasiado rápido.');
          leaveCurrent();
          const room = createRoom();
          const you = room.join(msg.name, conn);
          ctx = { room, id: you.id };
          return;
        }
        case 'join': {
          if (isBlocked(ip)) throw new RoomError('blocked', 'Demasiados intentos. Espera unos minutos.');
          const room = rooms.get(msg.code);
          if (!room) {
            registerJoinFail(ip);
            throw new RoomError('not-found', 'No existe ninguna sala con ese código.');
          }
          leaveCurrent();
          const you = room.join(msg.name, conn);
          ctx = { room, id: you.id };
          return;
        }
        case 'resume': {
          if (isBlocked(ip)) throw new RoomError('blocked', 'Demasiados intentos. Espera unos minutos.');
          const room = rooms.get(msg.code);
          const you = room?.resume(msg.token, conn);
          if (!room || !you) {
            registerJoinFail(ip);
            throw new RoomError('not-found', 'La sesión ya no existe.');
          }
          ctx = { room, id: you.id };
          return;
        }
        case 'ping':
          return sendMsg({ t: 'pong' });
        case 'leave':
          leaveCurrent();
          return;
        default: {
          if (!ctx) throw new RoomError('bad-request', 'Primero entra en una sala.');
          ctx.room.handle(ctx.id, msg);
          return;
        }
      }
    } catch (e) {
      if (e instanceof RoomError) sendError(e.code, e.message);
      else {
        console.error('[ws]', e);
        sendError('bad-request', 'Error inesperado.');
      }
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    const n = (connsByIp.get(ip) ?? 1) - 1;
    if (n <= 0) connsByIp.delete(ip);
    else connsByIp.set(ip, n);
    if (ctx) {
      ctx.room.disconnect(ctx.id, conn);
      cleanupIfEmpty(ctx.room);
    }
  });
  ws.on('error', () => ws.terminate());
});

server.listen(PORT, () => {
  console.log(`Ludo: API y WebSocket en http://localhost:${PORT}  (cliente: ${CLIENT_DIR})`);
});

function shutdown() {
  for (const room of rooms.values()) room.dispose();
  wss.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
