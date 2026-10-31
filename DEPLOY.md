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
   Ludo ya va dentro de Royale Club: no hace falta un servicio aparte. Si en tu cuenta sigue existiendo el antiguo `ludo-club`, bórralo desde el panel de Render (quitarlo del archivo no lo borra) para no gastar horas del plan gratuito.
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
3. Aplica la migración `db/migrations/0001_init.sql` en el *SQL Editor* de Supabase (ver `db/README.md`): crea `reviews` y el resto del esquema. El servidor ya no crea tablas por su cuenta y avisa en el log si falta.
4. Lee las reseñas en `https://TU-APP.onrender.com/admin/reviews?key=TU_CLAVE` (promedio por juego y lista; añade `&format=json` para los datos crudos).
   Sin `ADMIN_KEY` la ruta no existe. Con `DATABASE_SSL=0` se desactiva TLS (solo para un Postgres local).

Sin `DATABASE_URL` las reseñas se guardan en un archivo local, solo útil para desarrollo: en Render gratis se perderían al dormirse.
Cada persona puede valorar cada juego una vez cada 12 horas.

## Métricas de producto (privadas)

Con la base de datos conectada y las migraciones `0001` y `0002` aplicadas, el servidor mide mesas, rondas y regresos. Míralo en `/admin/metrics?key=TU_CLAVE` (mismo `ADMIN_KEY` que las reseñas): uso por juego, mesas por día y regreso a 7 y 30 días por semana de llegada. Son solo conteos, sin datos personales.

## Inicio con Google (recomendado)

El botón **Continuar con Google** guarda el progreso en la cuenta de Google de cada persona: un toque, sin correos que esperar y sin necesitar SMTP. La app solo muestra el botón si Google está activado en Supabase.

Se configura en dos paneles (las claves las pegas tú, nunca en un chat):

1. **Google Cloud Console** ([console.cloud.google.com](https://console.cloud.google.com)): crea un proyecto (o usa uno). En **APIs y servicios → Pantalla de consentimiento de OAuth** elige *Externo* y pon el nombre de la app (**Royale Club**) y tu correo de soporte. Los permisos básicos (correo, perfil, openid) no suelen requerir verificación. Mientras la pantalla esté en modo *Prueba* solo pueden entrar los usuarios de prueba que añadas; para el público general pásala a *En producción*.
2. En **Credenciales → Crear credenciales → ID de cliente de OAuth** elige *Aplicación web*. En **URI de redireccionamiento autorizados** pega la dirección que te muestra Supabase en su pantalla de Google (termina en `/auth/v1/callback`). Al crearlo te da un **Client ID** y un **Client Secret**.
3. **Supabase → Authentication → Sign In / Providers → Google**: actívalo y pega el Client ID y el Client Secret. Guarda.
4. **Supabase → Authentication → URL Configuration** (igual que para el correo): **Site URL** con la dirección de la app y, en **Redirect URLs**, esa dirección con `/**` y `http://localhost:3001/**` para probar en tu equipo.

Qué ocurre: el botón lleva a Supabase, que lleva a Google; al volver, la web recibe un token que nuestro servidor usa para identificar la cuenta y vincular su perfil. El token se borra de la barra de direcciones al instante y no se guarda. Con Google no se envía ningún correo, así que no hay límite de envíos ni hace falta SMTP.

## Inicio con correo (cuentas y progreso)

Quien entra con su correo conserva perfil, logros y estadísticas aunque cambie de teléfono o borre el navegador. El correo trae un **enlace** (un toque y entras) y, si lo configuras así, también un **código**: sirve cualquiera de los dos. No hay contraseñas. Quien prefiere jugar sin cuenta puede hacerlo (los invitados a una mesa entran directo, sin registrarse).

Todo se configura en el panel de Supabase (sin escribir claves en ningún chat):

1. **Authentication → Providers → Email**: déjalo activado.
2. **Authentication → URL Configuration** (esto es lo que evita el error de `localhost` al abrir el enlace):
   - **Site URL**: la dirección pública de la app, por ejemplo `https://TU-SERVICIO.onrender.com`. Por defecto es `http://localhost:3000`, y por eso el enlace llevaba a una página que no existe.
   - **Redirect URLs**: añade la misma dirección con `/**` al final (`https://TU-SERVICIO.onrender.com/**`) y, para probar en tu equipo, `http://localhost:3001/**`. El servidor le pide a Supabase volver a la dirección desde la que se pidió el correo, pero Supabase solo lo respeta si está en esta lista.
3. **Authentication → Emails → Templates** (opcional): con las plantillas por defecto el correo trae **solo el enlace**, y eso basta: la app funciona con el enlace. Supabase **no deja editar las plantillas hasta configurar un SMTP propio** (paso 5). Cuando lo tengas, en **Confirm sign up** y en **Magic link or OTP** puedes añadir el código, por ejemplo:
   `<p><a href="{{ .ConfirmationURL }}">Entrar a Royale Club</a></p><p>O escribe este código: <b>{{ .Token }}</b></p>`
4. **Project Settings → API**: copia la clave **anon / public** (no la `service_role`) y ponla en Render (y en tu `.env`) como `SUPABASE_ANON_KEY`. La dirección del proyecto se deduce de `DATABASE_URL`; si quieres fijarla, añade `SUPABASE_URL=https://TU_REF.supabase.co`.
5. **Envío de correos**: el servicio integrado de Supabase es solo para pruebas: envía muy pocos correos por hora y, según lo que he leído, solo a miembros de tu equipo del proyecto (confírmalo en su documentación). **Antes de invitar a amigos hay que configurar tu propio SMTP** en **Authentication → Emails → SMTP Settings** (por ejemplo Brevo, que permite verificar un solo correo remitente sin tener dominio, o Resend si tienes dominio propio; revisa sus límites gratuitos vigentes).
6. El código puede tener 6 u 8 dígitos según el proyecto; la app acepta de 6 a 10.

Qué ocurre al abrir el enlace: Supabase devuelve a la persona a la web con un token en la dirección; la web se lo manda a nuestro servidor, que le pregunta a Supabase quién es y vincula su perfil. El token se borra de la barra de direcciones de inmediato y no se guarda. Si el enlace se abre en otro navegador distinto de donde se pidió (por ejemplo la app instalada y el navegador del móvil), la sesión se inicia en el que se abrió; el código permite entrar en el mismo donde se pidió.

Sin `SUPABASE_ANON_KEY` o sin `DATABASE_URL` la opción de correo no aparece y todo funciona como invitado. El correo lo guarda Supabase Auth, no nuestras tablas; nuestro perfil solo guarda el identificador de la cuenta (`profiles.user_id`).
