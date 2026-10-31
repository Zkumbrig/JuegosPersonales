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
    void this.fromLink();
  }

  /**
   * Quien abre el enlace del correo vuelve a la web con un token en la dirección (#access_token=…).
   * Se manda al servidor para identificar la cuenta y se borra de la barra de direcciones enseguida.
   */
  async fromLink() {
    // Errores de Google/Supabase al volver (por ejemplo si la persona cancela) llegan en la dirección.
    const q = new URLSearchParams(location.search);
    if (q.get('error_code') || (q.get('error') && q.get('error_description'))) {
      history.replaceState(null, '', location.pathname);
      net.toast(q.get('error') === 'access_denied' ? 'Cancelaste el inicio de sesión.' : 'No se pudo iniciar sesión. Inténtalo de nuevo.');
      return;
    }
    const hash = location.hash.replace(/^#/, '');
    if (!hash.includes('access_token=') && !hash.includes('error=')) return;
    const p = new URLSearchParams(hash);
    history.replaceState(null, '', location.pathname + location.search);
    const token = p.get('access_token');
    if (!token) {
      net.toast(p.get('error_code') === 'otp_expired' ? 'El enlace caducó o ya se usó. Pide otro.' : 'No se pudo iniciar sesión con ese enlace.');
      return;
    }
    const r = await post('/api/auth/session', { token, pid: net.pid });
    if (!r.ok) { net.toast(String(r.data.error ?? 'No se pudo iniciar sesión con ese enlace.')); return; }
    const { pid, name, email } = r.data as { pid: string; name: string; email: string };
    net.adoptIdentity(pid, name === 'Jugador' ? net.name : name);
    this.email = email;
    save(email);
    net.toast(`Sesión iniciada: ${email}`, 'ok');
  }

  /** ¿Está activado "Continuar con Google" en el proyecto? */
  google = $state(false);
  /** ¿Está activado el correo? */
  mail = $state(true);

  async check() {
    try {
      const res = await fetch('/api/auth/config');
      const c = (await res.json()) as { enabled?: boolean; google?: boolean; email?: boolean };
      this.enabled = !!c.enabled;
      this.google = !!c.google;
      this.mail = c.email !== false;
    } catch {
      this.enabled = false;
    }
    this.checked = true;
  }

  /** Lleva a la persona a Google (pasando por nuestro servidor y Supabase); vuelve a esta web ya identificada. */
  signInWithGoogle() {
    location.assign('/api/auth/google');
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
