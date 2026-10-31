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
    // `path` puede llevar parámetros (por ejemplo ?redirect_to=…)
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

  private provCache: { at: number; value: { google: boolean; email: boolean } } | null = null;

  /** Qué formas de entrar tiene activadas el proyecto en Supabase (se consulta y se guarda unos minutos). */
  async providers(): Promise<{ google: boolean; email: boolean }> {
    if (this.provCache && Date.now() - this.provCache.at < 5 * 60_000) return this.provCache.value;
    let value = { google: false, email: true };
    try {
      const res = await this.fetcher(`${this.url}/auth/v1/settings`, { headers: { apikey: process.env.SUPABASE_ANON_KEY! }, signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const ext = ((await res.json()) as { external?: Record<string, unknown> }).external ?? {};
        value = { google: ext.google === true, email: ext.email !== false };
      }
    } catch { /* sin respuesta: se muestra solo el correo */ }
    this.provCache = { at: Date.now(), value };
    return value;
  }

  /** Dirección de Supabase a la que se manda a la persona para entrar con Google (y que luego la devuelve a `redirectTo`). */
  googleUrl(redirectTo?: string): string {
    const q = new URLSearchParams({ provider: 'google' });
    if (redirectTo) q.set('redirect_to', redirectTo);
    return `${this.url}/auth/v1/authorize?${q.toString()}`;
  }

  /** Pide a Supabase que envíe el código al correo. Devuelve null si salió bien, o el motivo (para mostrarlo). */
  async start(email: string, redirectTo?: string): Promise<string | null> {
    try {
      // `redirectTo` es la dirección de esta web: el enlace del correo vuelve ahí (Supabase solo lo respeta si está en su lista de URLs permitidas;
      // si no, usa la "Site URL" configurada).
      const query = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : '';
      const r = await this.call(`/auth/v1/otp${query}`, { email, create_user: true });
      if (r.ok) return null;
      if (r.status === 429) return 'Espera un minuto antes de pedir otro código.';
      if (r.status === 400 || r.status === 422) return 'No se pudo enviar el código a ese correo.';
      return 'No se pudo enviar el código ahora. Inténtalo en unos minutos.';
    } catch {
      return 'No se pudo conectar para enviar el código. Inténtalo en unos minutos.';
    }
  }

  /**
   * Enlace del correo: Supabase devuelve al usuario a la web con un token de acceso en la dirección.
   * El token solo se usa aquí para preguntarle a Supabase quién es (no se guarda ni se devuelve al navegador).
   */
  async userFromToken(accessToken: string): Promise<AuthUser | null> {
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(accessToken) || accessToken.length > 4096) return null;
    try {
      const res = await this.fetcher(`${this.url}/auth/v1/user`, {
        headers: { apikey: process.env.SUPABASE_ANON_KEY!, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const u = (await res.json()) as { id?: unknown; email?: unknown };
      if (typeof u.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(u.id) || typeof u.email !== 'string') return null;
      return { id: u.id, email: u.email };
    } catch {
      return null;
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
