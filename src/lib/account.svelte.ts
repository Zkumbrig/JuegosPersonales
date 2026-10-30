// Cuenta por correo: pide un código, lo verifica y, al entrar, el dispositivo adopta el perfil de la cuenta.
// Todo pasa por el servidor (/api/auth/*): el navegador nunca habla con Supabase ni guarda claves.
import { net } from './net.svelte';

const KEY = 'rc_account';
function load(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}
function save(v: string) {
  try { localStorage.setItem(KEY, v); } catch { /* modo privado */ }
}

async function post(path: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, data: { error: 'Sin conexión. Revisa tu internet e inténtalo de nuevo.' } };
  }
}

class Account {
  /** Correo con el que se inició sesión (vacío = invitado). */
  email = $state(load());
  /** ¿El servidor tiene activado el inicio con correo? */
  enabled = $state(false);
  /** ¿Ya se preguntó al servidor si está activado? */
  checked = $state(false);

  constructor() {
    void this.check();
  }

  async check() {
    try {
      const res = await fetch('/api/auth/config');
      this.enabled = !!((await res.json()) as { enabled?: boolean }).enabled;
    } catch {
      this.enabled = false;
    }
    this.checked = true;
  }

  /** Pide el código al correo. Devuelve null si salió bien o el mensaje de error. */
  async start(email: string): Promise<string | null> {
    const r = await post('/api/auth/start', { email });
    return r.ok ? null : String(r.data.error ?? 'No se pudo enviar el código.');
  }

  /** Comprueba el código y adopta el perfil de la cuenta. Devuelve null si salió bien o el mensaje de error. */
  async verify(email: string, token: string): Promise<string | null> {
    const r = await post('/api/auth/verify', { email, token, pid: net.pid });
    if (!r.ok) return String(r.data.error ?? 'Código incorrecto.');
    const { pid, name, email: confirmed } = r.data as { pid: string; name: string; email: string };
    net.adoptIdentity(pid, name === 'Jugador' ? net.name : name);
    this.email = confirmed || email;
    save(this.email);
    return null;
  }

  logout() {
    net.newIdentity();
    this.email = '';
    save('');
  }
}

export const account = new Account();
