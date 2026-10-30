// Rutas HTTP del inicio de sesión por correo: /api/auth/config, /api/auth/start y /api/auth/verify.
// Con límites por IP y por correo para que no se pueda usar para enviar correos en masa ni para adivinar códigos.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { auth as defaultAuth, cleanEmail, type AuthService } from './auth';
import { profiles as defaultProfiles, type ProfileStore } from './profiles';

const MAX_BODY = 2048;
const WINDOW_MS = 10 * 60_000;
const EMAIL_COOLDOWN_MS = 60_000;
const PID = /^[A-Za-z0-9_-]{8,64}$/;

interface Deps { auth?: AuthService; profiles?: ProfileStore; trustProxy?: boolean }

export function makeAuthRoutes(deps: Deps = {}) {
  const A = deps.auth ?? defaultAuth;
  const P = deps.profiles ?? defaultProfiles;
  const hits = new Map<string, { n: number; since: number }>();
  const lastStart = new Map<string, number>();

  /** Cuenta una petición y dice si ya se pasó del máximo en la ventana. */
  const limited = (ip: string, kind: string, max: number): boolean => {
    const now = Date.now();
    if (hits.size > 2000) for (const [k, v] of hits) if (now - v.since > WINDOW_MS) hits.delete(k);
    const key = `${kind}|${ip}`;
    const cur = hits.get(key);
    if (!cur || now - cur.since > WINDOW_MS) { hits.set(key, { n: 1, since: now }); return false; }
    cur.n++;
    return cur.n > max;
  };

  const readJson = (req: IncomingMessage): Promise<Record<string, unknown> | null | 'big'> =>
    new Promise((resolve) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) { resolve('big'); return; } // se responde 413 y se cierra la conexión
        chunks.push(c);
      });
      req.on('end', () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
        } catch { resolve(null); }
      });
      req.on('error', () => resolve(null));
    });

  /** Devuelve true si la ruta era de autenticación (y ya respondió). */
  return async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
    if (!url.pathname.startsWith('/api/auth/')) return false;
    const json = (code: number, body: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end(JSON.stringify(body));
      return true;
    };
    if (url.pathname === '/api/auth/config') return json(200, { enabled: A.enabled && P.usingDb });
    if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });
    if (!A.enabled || !P.usingDb) return json(503, { error: 'El inicio con correo no está activado todavía.' });

    const ip = deps.trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]!.trim() || (req.socket.remoteAddress ?? '?') : (req.socket.remoteAddress ?? '?');
    const body = await readJson(req);
    if (body === 'big') {
      res.writeHead(413, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' }).end(JSON.stringify({ error: 'Solicitud demasiado grande.' }));
      return true;
    }
    if (!body) return json(400, { error: 'Solicitud no válida.' });

    if (url.pathname === '/api/auth/start') {
      if (limited(ip, 'start', 6)) return json(429, { error: 'Demasiados intentos. Espera unos minutos.' });
      const email = cleanEmail(body.email);
      if (!email) return json(400, { error: 'Escribe un correo válido.' });
      const last = lastStart.get(email) ?? 0;
      if (Date.now() - last < EMAIL_COOLDOWN_MS) return json(429, { error: 'Espera un minuto antes de pedir otro código.' });
      lastStart.set(email, Date.now());
      if (lastStart.size > 2000) for (const [k, t] of lastStart) if (Date.now() - t > EMAIL_COOLDOWN_MS) lastStart.delete(k);
      const err = await A.start(email);
      if (err) { lastStart.delete(email); return json(502, { error: err }); }
      return json(200, { ok: true });
    }

    if (url.pathname === '/api/auth/verify') {
      if (limited(ip, 'verify', 12)) return json(429, { error: 'Demasiados intentos. Espera unos minutos.' });
      const email = cleanEmail(body.email);
      const token = typeof body.token === 'string' ? body.token.replace(/\s+/g, '') : '';
      const pid = typeof body.pid === 'string' ? body.pid : '';
      if (!email || !token || !PID.test(pid)) return json(400, { error: 'Solicitud no válida.' });
      const user = await A.verify(email, token);
      if (!user) return json(401, { error: 'Código incorrecto o caducado.' });
      const link = await P.linkAccount(pid, user);
      if (!link) return json(503, { error: 'No se pudo recuperar tu perfil ahora. Inténtalo de nuevo.' });
      return json(200, { pid: link.pid, name: link.name, email: user.email });
    }

    return json(404, { error: 'No existe.' });
  };
}

export const authRoutes = makeAuthRoutes({ trustProxy: process.env.TRUST_PROXY === '1' });
