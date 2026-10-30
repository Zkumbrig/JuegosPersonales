# Base de datos (Supabase)

Esquema de Royale Club en Postgres. Las migraciones están en [`migrations/`](migrations) y se aplican en orden.

## Poner en marcha

1. En [supabase.com](https://supabase.com) crea un proyecto (elige la región más cercana a tus jugadores y a Render).
2. **Aplica la migración**: *SQL Editor* → pega el contenido de `migrations/0001_init.sql` → *Run*.
   (Se puede ejecutar más de una vez sin problema.)
3. Copia la **cadena de conexión** en *Project Settings → Database → Connection string*.
   Desde Render usa la del **pooler** (modo *Transaction*, puerto 6543), que aguanta muchas conexiones cortas.
4. En Render (*Environment*) añade `DATABASE_URL` con esa cadena (con tu contraseña) y `ADMIN_KEY`. En local, ponlas en `.env`.
5. Al arrancar, el servidor comprueba que la tabla `reviews` existe; si no, lo dice en el log y usa un archivo local.

## Qué usa ya la base de datos

- **Perfiles y logros** (`profiles`, `achievements_unlocked`): se cargan al entrar cada jugador y se guardan en segundo plano (cada 10 s y al apagar). Si es la primera vez y la tabla está vacía, se importa una sola vez el archivo local de perfiles.
- **Reseñas** (`reviews`).
- El resto de tablas está listo para cuando se usen. Sin `DATABASE_URL`, o si Supabase no responde, el servidor sigue con archivos locales.

## Qué hay

| Tabla | Para qué |
|---|---|
| `profiles` | Un jugador: identificador anónimo del dispositivo (`pid`) y/o cuenta (`user_id` → `auth.users`), con sus estadísticas. |
| `achievements_unlocked` | Logros ganados por perfil. |
| `game_results` · `game_result_players` | Histórico de partidas y de quién jugó/ganó (marcadores). |
| `reviews` | Valoraciones y comentarios privados. |
| `ai_phrases` | Frases generadas con IA, para conservarlas y moderarlas. |
| `consents` | Qué aceptó cada persona (mayoría de edad, términos, privacidad) y en qué versión. |
| `audit_log` | Acciones sensibles (cambios de plan, borrados, accesos de administrador). |

**Identidad:** las cuentas las lleva Supabase Auth (`auth.users`); aquí no hay contraseñas ni sesiones propias.
Un perfil puede existir solo con `pid` y enlazarse a una cuenta más adelante sin perder su historial.

**Negocio (pendiente):** planes, suscripciones, pagos y permisos (`entitlements`) se diseñan cuando se decida el modelo de venta; irán en `0002_*.sql`.

## Seguridad: reglas que no se rompen

- **RLS activado en todas las tablas y sin políticas.** La API pública de Supabase (clave `anon`) no puede leer ni escribir nada.
  Solo el servidor accede, con `DATABASE_URL`. Si el cliente necesitara leer algo, se añade una política concreta, nunca se desactiva RLS.
- **Nunca** pongas en el navegador ni en el repositorio la clave `service_role` ni la contraseña de la base de datos.
  Viven solo en variables de entorno del servidor (`.env` está en `.gitignore`).
- Las fechas van en UTC (`timestamptz`) y lo que tenga datos personales lleva `deleted_at` (borrado suave) para poder atender peticiones de borrado.
- Guarda **hash** de la IP, nunca la IP en claro.

## Cómo cambiar el esquema

Una migración nueva por cambio (`0002_...sql`, `0003_...sql`), nunca editar las ya aplicadas en producción.
Pruébalas antes en un proyecto de Supabase de desarrollo. Haz copia (*Database → Backups*) antes de migrar en producción.
