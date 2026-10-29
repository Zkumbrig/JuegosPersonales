# Publicar Royale Club

La app necesita **un servidor que se mantenga encendido y acepte WebSockets**. Por eso no sirven el hosting
compartido de Hostinger (solo admite WebSockets de salida) ni Vercel (las conexiones se cortan con la función y
las mesas viven en la memoria de un único servidor). Sí sirven Render, Railway, Fly.io o un VPS.

## Reglas que valen para cualquier plataforma

1. **Una sola instancia.** Las mesas están en la memoria del servidor; con dos, cada jugador podría caer en uno distinto.
2. **`TRUST_PROXY=1`** (ya viene en el `Dockerfile`): sin ella, los límites contra abusos verían a todos con la IP del proxy.
3. **Disco persistente en `/data`** si quieres que las mesas y los perfiles sobrevivan a reinicios. Sin disco todo funciona,
   pero al reiniciar se pierden (los jugadores vuelven a crear la mesa).
4. **Comprobación de salud:** `GET /healthz` devuelve `ok`.
5. **HTTPS lo pone la plataforma**; el cliente usa `wss://` solo.
6. **Dominio propio distinto de `lumera-one.com`** y **sin anuncios** en esta app. Los juegos de fiesta (alcohol) y las
   apuestas simuladas están entre los contenidos restringidos de AdSense: no los mezcles con un dominio o subdominio con
   AdSense para no poner en riesgo esa cuenta. Revisa la política de Google antes de monetizar nada.

## Render (gratis, para probar)

1. Sube el proyecto a un repositorio de GitHub (no incluyas `node_modules`, `dist` ni `data`: ya están en `.gitignore`).
2. En Render: **New → Blueprint** y elige el repositorio. Lee `render.yaml` (plan gratuito, una instancia).
3. Cuando termine, abre la URL `https://royale-club-xxxx.onrender.com`.
4. **No se duerme:** en Render el servidor se llama a sí mismo por su URL pública (`RENDER_EXTERNAL_URL`) a `/healthz`
   cada 4 minutos, y eso cuenta como tráfico entrante (un ping a `localhost` no contaría). Se desactiva con
   `KEEPALIVE=0` y el intervalo se cambia con `KEEPALIVE_MS`. Cuidado con las horas: el plan gratuito da **750 h al mes
   por cuenta** y una app encendida todo el mes gasta unas 744, así que **solo una app puede estar siempre despierta**.
   Si hay otra en el mismo Blueprint (por ejemplo `ludo-club`), se suspende al agotarse las horas: bórrala o déjala dormir.
5. Límites: se pierden mesas y perfiles al dormirse o reiniciarse. Para uso continuo: plan de pago + disco (bloque
   comentado en `render.yaml`).

## Railway

1. Nuevo proyecto → **Deploy from GitHub** (detecta el `Dockerfile`).
2. Variables: `TRUST_PROXY=1`, `DATA_FILE=/data/rooms.json`.
3. Añade un **Volume** montado en `/data`.
4. En *Settings → Networking* genera un dominio o conecta el tuyo. Comprobación de salud: `/healthz`.

## Fly.io

```bash
fly launch --copy-config --no-deploy      # elige un nombre de app único (edita fly.toml)
fly volumes create royale_data --size 1 --region mad
fly deploy
fly scale count 1
```

`fly.toml` ya deja una máquina siempre encendida y el volumen en `/data`.

## VPS (Hostinger u otro)

```bash
docker build -t royale-club .
docker run -d --name royale --restart unless-stopped -p 3001:3001 -v royale-data:/data royale-club
```

Pon delante Caddy o Nginx con HTTPS y reenvío de WebSockets a `localhost:3001`.

## Después de publicar: lista de comprobación

- [ ] Dos celulares entran a la misma mesa con el código y con el QR.
- [ ] Jugar una ronda de cada juego, y que el anfitrión cambie de juego.
- [ ] Abrir `/?tv=CODIGO` en un laptop o una tele.
- [ ] Apagar la pantalla de un celular 10 segundos y comprobar que vuelve a la mesa.
- [ ] Compartir la imagen del resumen de la noche desde un celular.
- [ ] Instalar la app desde el navegador (icono de instalar / "Añadir a pantalla de inicio").

## Reseñas privadas (valoraciones)

Los jugadores pueden valorar el juego (1 a 5 estrellas y un comentario) desde la hoja de la mesa o los resultados de Ludo.
Son **privadas**: solo las ves tú.

1. Crea un Postgres gratuito (Supabase o Neon) y copia su **URL de conexión**.
2. En Render, en *Environment* del servicio, añade `DATABASE_URL` (esa URL) y `ADMIN_KEY` (una clave larga que inventes, mínimo 12 caracteres).
3. Al arrancar, el servidor crea solo la tabla `reviews` (id, created_at, pid, name, game, rating 1-5, comment, room_code, theme).
4. Lee las reseñas en `https://TU-APP.onrender.com/admin/reviews?key=TU_CLAVE` (promedio por juego y lista; añade `&format=json` para los datos crudos).
   Sin `ADMIN_KEY` la ruta no existe. Con `DATABASE_SSL=0` se desactiva TLS (solo para un Postgres local).

Sin `DATABASE_URL` las reseñas se guardan en un archivo local, solo útil para desarrollo: en Render gratis se perderían al dormirse.
Cada persona puede valorar cada juego una vez cada 12 horas.
