// Conexión compartida a Postgres (Supabase). Sin DATABASE_URL o si no se puede conectar devuelve null y el servidor
// sigue funcionando con archivos locales. Desde Render conviene la URL del pooler (puerto 6543).

export interface SqlDb {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, any>[] }>;
}

let cached: Promise<SqlDb | null> | null = null;

export function getDb(): Promise<SqlDb | null> {
  cached ??= connect();
  return cached;
}

async function connect(): Promise<SqlDb | null> {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    const { default: pg } = await import('pg');
    // Supabase y Neon exigen TLS; DATABASE_SSL=0 lo desactiva (por ejemplo, un Postgres local).
    const pool = new pg.Pool({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      ssl: process.env.DATABASE_SSL === '0' ? false : { rejectUnauthorized: false },
    });
    pool.on('error', (e) => console.error('[db] error en una conexión inactiva:', e.message));
    await pool.query('select 1');
    return pool as unknown as SqlDb;
  } catch (e) {
    console.error('[db] no se pudo conectar a Postgres; se usan archivos locales:', String((e as Error).message).replace(/postgres(ql)?:\/\/\S+/g, '<url>'));
    return null;
  }
}
