// Inicio de sesión por correo con Supabase Auth (código de un solo uso, sin contraseñas).
// El servidor habla con Supabase por HTTP: el navegador nunca ve ninguna clave y no hace falta ninguna librería.
// Necesita SUPABASE_ANON_KEY (la clave pública "anon" del proyecto). La URL se toma de SUPABASE_URL o se deduce de DATABASE_URL.
// Sin esas variables el inicio con correo queda desactivado y todo sigue funcionando como invitado.

export interface AuthUser { id: string; email: string }

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const CODE = /^\d{6,10}$/;

export const cleanEmail = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && EMAIL.test(e) ? e : null;
};

export class AuthService {
  /** Para pruebas: sustituye a la llamada de red. */
  fetcher: typeof fetch = (...a) => fetch(...a);

  /** URL base del proyecto de Supabase. */
  get url(): string | null {
    const explicit = (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
    if (explicit) return explicit;
    // El usuario de la conexión del pooler es "postgres.<ref>": de ahí sale la dirección del proyecto.
    const m = /postgres(?:ql)?:\/\/postgres\.([a-z0-9]{10,30})[:@]/i.exec(process.env.DATABASE_URL ?? '');
    return m ? `https://${m[1]!.toLowerCase()}.supabase.co` : null;
  }

  get enabled(): boolean {
    return !!this.url && !!process.env.SUPABASE_ANON_KEY;
  }

  private async call(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
    const res = await this.fetcher(`${this.url}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_ANON_KEY! },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    let data: Record<string, unknown> = {};
    try { data = (await res.json()) as Record<string, unknown>; } catch { /* sin cuerpo */ }
    return { ok: res.ok, status: res.status, data };
  }

  /** Pide a Supabase que envíe el código al correo. Devuelve null si salió bien, o el motivo (para mostrarlo). */
  async start(email: string): Promise<string | null> {
    try {
      const r = await this.call('/auth/v1/otp', { email, create_user: true });
      if (r.ok) return null;
      if (r.status === 429) return 'Espera un minuto antes de pedir otro código.';
      if (r.status === 400 || r.status === 422) return 'No se pudo enviar el código a ese correo.';
      return 'No se pudo enviar el código ahora. Inténtalo en unos minutos.';
    } catch {
      return 'No se pudo conectar para enviar el código. Inténtalo en unos minutos.';
    }
  }

  /** Comprueba el código. Devuelve el usuario si es correcto, o null si no. */
  async verify(email: string, token: string): Promise<AuthUser | null> {
    if (!CODE.test(token)) return null;
    try {
      const r = await this.call('/auth/v1/verify', { type: 'email', email, token });
      if (!r.ok) return null;
      const u = r.data.user as { id?: unknown; email?: unknown } | undefined;
      if (typeof u?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(u.id)) return null;
      return { id: u.id, email: typeof u.email === 'string' ? u.email : email };
    } catch {
      return null;
    }
  }
}

export const auth = new AuthService();
