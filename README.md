# Royale Club

Casino entre amigos para jugar desde el celular: **blackjack, ruleta y tragaperras** con
**fichas virtuales** (sin dinero real), sin anuncios y con estética de casino de lujo.
Cada jugador entra desde su teléfono a una mesa con código de 4 letras.

- Cliente: Svelte 5 + Vite + TypeScript (≈27 KB de JS comprimido), instalable como PWA.
- Servidor: Node + WebSocket (`ws`). El servidor es la autoridad: reparte, gira y paga; el navegador solo dibuja.
- Un solo proceso sirve la web y el juego en tiempo real.

## Usar

```bash
npm install
npm run dev      # servidor (3001) + Vite (5173), con recarga en vivo
```

Abre `http://localhost:5173`. Para probar con el celular en la misma WiFi, usa la IP de tu PC
(`http://192.168.x.x:5173`).

```bash
npm run build    # genera dist/
npm start        # sirve dist/ + WebSocket en http://localhost:3001 (PORT para cambiarlo)
npm test         # todo: autoprueba de juego (~60 s) + robustez (~40 s)
npm run test:robust  # solo robustez: datos basura, inundación, anfitrión caído, expulsión, corte brusco
npm run check    # tipado de Svelte y TypeScript
```

## Reglas implementadas

| Juego | Reglas |
|---|---|
| Blackjack | 6 barajas, Blackjack paga 3:2, el crupier planta en 17. **Doblar** con las dos primeras cartas (también tras dividir), **dividir** pares (por valor: un 10 y una figura también cuentan; una sola división; con ases, una carta por mano; un 21 tras dividir paga 1:1) y **seguro** (la mitad de la apuesta, paga 2:1) cuando el crupier enseña un As. Mesa compartida con apuestas y turnos con temporizador. |
| Ruleta | Europea (un cero). Pleno 35:1, docenas y columnas 2:1, rojo/negro, par/impar y 1-18/19-36 a 1:1. **Repetir** la apuesta anterior y **Doblar** la actual. |
| Tragaperras | 3 rodillos, retorno teórico ≈ 96,5 % (medido en la autoprueba). |
| Póker | Texas Hold'em sin límite, 2-8 jugadores, ciegas 10/20, entrada de 200/500/1000. Subidas con mínimo válido, all-in con *runout*, botes laterales y empates. Cada jugador solo recibe sus propias cartas. |

En el póker te sientas con fichas de tu cartera; al levantarte o cambiar de juego, lo que tengas en la mesa vuelve a tu cartera.
Cada mano empieza cuando todos pulsan "Repartir" (o a los 10 s del segundo jugador listo).

El anfitrión (el que crea la mesa) elige el juego; solo se puede cambiar entre rondas.

## Zona Fiesta (+18)

Selector **Casino | Fiesta** en la sala. En Fiesta, cada uno juega desde su celular y las respuestas son **secretas hasta la revelación**:

| Juego | Cómo funciona |
|---|---|
| Yo nunca | Todos responden "yo sí / yo no" a la vez; beben quienes lo hicieron. |
| ¿Quién es más probable? | Voto secreto a una persona; el más votado bebe. |
| Preferirías… | Dos opciones; la minoría bebe (empate o unanimidad: brindis). |
| Verdad o reto | Turnos rotativos; quien está en el centro elige, el grupo lo ve y puede "pasar y beber". |
| Duelo de reflejos | Rojo → verde; bebe el más lento, el que no llega y quien se adelanta. Cada celular mide su propio tiempo, así la latencia no decide. |
| Rey de copas | Baraja compartida; cada carta es una regla; el cuarto Rey bebe el vaso central. |

- **Intensidad** Suave / Picante / Extremo (el anfitrión la cambia en cualquier momento).
- **Modo sin alcohol:** "beber" pasa a ser "perder un punto" (para conductor designado o quien no bebe).
- **Marcador "Tragos de la noche"** por mesa.
- Si alguien pierde la conexión se le espera 8 s antes de seguir sin su respuesta.
- El contenido está en `server/content.ts` (frases por nivel): es el fichero a editar para añadir o cambiar preguntas.
  Reglas de la casa: el nivel **Extremo** es de verdad para adultos (sexo, fantasías, infidelidad, sexting), pero nada gráfico ni peligroso, nada de desnudos forzados, y todo reto se puede rechazar bebiendo.

## Ludo (4, 6 y 8 jugadores)

Selector **Casino | Fiesta | Ludo** en la sala. Juegan las personas de la mesa (hasta 8) y el anfitrión puede añadir **bots**. Elige tablero de 4, 6 u 8 brazos y reglas: tiempo por turno, fin al primer ganador, tiro exacto, parejas protegidas y movimiento automático si solo hay una jugada.

- Solo se sale de casa con un **6**; un 6, comer o llegar a la meta dan otra tirada; tres seises seguidos pierden el turno. Las casillas con estrella y las salidas son seguras.
- El servidor tira los dados y valida cada jugada (`server/ludo.ts`, reglas puras en `shared/ludo.ts`). Quien no responde a tiempo pasa a piloto automático; quien se cae tiene un margen de 8 s y recupera su lugar.
- El tablero (`src/components/ludo/`) usa el fieltro y el oro de tu tema, **gira para que tu color quede abajo**, tiene dado 3D, peones con salto, efectos de captura y sonidos, y un botón de **Acercar** en tableros grandes. Funciona también en la pantalla compartida (`?tv=CODIGO`).
- Pruebas: `server/ludotest.ts` (partidas completas en los tres tableros) y un bloque de Ludo en `server/selftest.ts`. Para depurar: `DEBUG_LUDO_DICE=6,3,6,5` fuerza los dados y `LUDO_FAST=1` quita las pausas de los bots.
- La carpeta `ludo/` es la primera versión independiente (servidor y cliente propios); la zona Ludo de Royale Club es su sucesora.

## Identidad visual

No es el típico "casino negro y dorado". La firma del diseño:

- **Foil holográfico** (`--foil` en `src/app.css`): un degradado iridiscente en logotipo, botones principales, medallones y selección. Cada estilo tiene su propio foil (champán, cian-magenta, rubí, plata).
- **Iconos propios** (`src/lib/icons.ts`): una sola familia de ~35 iconos dibujados a mano en SVG (trazo + relleno translúcido, color por `currentColor`), los símbolos de la tragaperras (`SlotSym.svelte`) y los palos de las cartas. **No hay ningún emoji**, así que se ve igual en cualquier celular. Para añadir uno: una línea en `icons.ts` y `<Icon name="..." />`.
- **Boletos**: las tarjetas de juego y de pregunta llevan muescas laterales (clase `.ticket`, una máscara estática).
- **Rayos art déco** en la cabecera (un solo degradado cónico) y **destello de foil** en los botones (solo `transform`).
- **Tipografía**: Unbounded (ancha, con carácter) para títulos, botones y números; el resto, la fuente del sistema.

## Estilos y rendimiento

Cuatro estilos (botón 🎨): **Esmeralda** (por defecto), **Neón**, **Rubí** y **Zafiro**. Son solo variables CSS
(`src/app.css`), así que cambiar de estilo es instantáneo y no cuesta peso. Para crear otro, añade un bloque
`[data-theme='nombre']` y una entrada en `src/lib/theme.svelte.ts`.

Reglas para mantener la fluidez en celulares modestos:
- Solo se animan `transform` y `opacity` (GPU). Nada de animar `box-shadow`, `filter` ni `backdrop-filter`.
- El grano del fieltro es un SVG diminuto estático; no hay imágenes ni fuentes pesadas.
- Las monedas de celebración son ~14 elementos y se eliminan solas a los 3 s.
- Se respeta `prefers-reduced-motion`.

## Estructura

```
shared/     protocolo y reglas comunes (cliente y servidor)
server/     index.ts (HTTP+WS) · room.ts · blackjack.ts · roulette.ts · slots.ts · poker.ts · pokerEval.ts · party.ts · content.ts · selftest.ts
src/        App, componentes Svelte, red (net.svelte.ts), sonido (WebAudio, sin archivos)
public/     manifest, icono, service worker
```

## Para engancharse (ola 2)

- **QR de invitación:** el código de la mesa abre una hoja con "Código QR" (tamaño grande y fondo blanco para que cualquier cámara lo lea). El enlace lleva el código, y quien lo abre ve "Te han invitado a la mesa XXXX".
- **Resumen de la noche:** desde esa misma hoja se genera una **imagen** (1080 px, con los colores del estilo activo) con los premios: *Rey de los tragos*, *Dedos de rayo* (mejor tiempo de reflejos), *El suertudo* (mayor premio), *El tiburón* (más fichas), *El deudor del banco* y *El farolero* (póker sin enseñar cartas). Solo se reparten premios con datos reales; los empates se comparten. Se comparte con la hoja nativa del celular o se guarda. Las estadísticas viven en la mesa y sobreviven a reinicios.
- **Reacciones:** barra fija abajo con seis iconos (risa, sorpresa, corazón, fuego, salud, brillo). Flotan para toda la mesa con el nombre de quien reacciona y se limitan para que nadie haga spam.
- **Reglas:** el botón "?" de la cabecera explica el juego en el que estés (pagos, turnos, ranking de manos del póker...). Late una vez por juego hasta que se abre. El texto está en `src/lib/rules.ts`.
- El QR, las reglas y el resumen se descargan solo cuando se abren, para que la carga inicial siga siendo ligera.

## Perfil, logros y pantalla grande (ola 3)

- **Perfil y logros** (hoja "Mesa" → "Mi perfil"): mesas jugadas, rondas, tragos, mejor tiempo de reflejos, mayor premio y faroles, acumulados **entre mesas**. Ocho logros (*Bienvenido al club*, *De la casa*, *Rata de casino*, *Sed de fiesta*, *Dedos de rayo*, *Gran golpe*, *Cara de póker*, *Cliente del banco*) que avisan al desbloquearse. Es anónimo: se identifica por el navegador, sin cuenta ni correo, y se guarda en `data/*.profiles.json`. Si se borran los datos del navegador, se empieza de cero. Las condiciones de cada logro están en `server/profiles.ts`.
- **Pantalla grande (TV):** abre `/?tv=CODIGO` en una tele o un laptop (o desde la portada: "Abrir pantalla"). Muestra la mesa en grande, con el código y el QR para que se una más gente, la rueda de la ruleta, las cartas comunes del póker, las preguntas de la fiesta y el marcador. **Solo mira**: no cuenta como jugador, no ve cartas ni respuestas privadas y no puede actuar. Máximo 3 pantallas por mesa; una pantalla ya conocida puede reconectar aunque la mesa esté cerrada.
- Para probar el blackjack con cartas fijas hay una ayuda: arranca el servidor con `DEBUG_BJ_DECK="8S,6D,8H,10C,..."` (rango+palo; reparte primero: jugador, crupier, jugador, crupier). Sin esa variable no hace nada.

## Fiabilidad

- **Anfitrión caído:** si pierde la conexión, a los 10 s el mando pasa al siguiente jugador conectado (se avisa en la mesa). Si vuelve, sigue en la mesa pero ya no manda.
- **Expulsar y cerrar:** el código de la mesa (arriba a la izquierda) abre la hoja con jugadores, invitación, **Cerrar la mesa** y **Expulsar** (doble toque). Un expulsado no puede volver a entrar.
- **Mesas que sobreviven a reinicios:** el servidor guarda las mesas en `data/rooms.json` cada 10 s y al apagarse, y las recupera al arrancar con las fichas de cada uno. Lo que estaba apostado en una ronda sin terminar se **devuelve** (la ronda queda anulada). Si nadie vuelve en 10 min, la mesa se borra.
- **Abusos:** límite de ritmo por conexión (ráfagas de 40 y 25 mensajes/s sostenidos; si insiste, se corta), máximo de conexiones por IP y bloqueo de 3 min tras 12 códigos de mesa erróneos en un minuto.
- **Errores inesperados:** se registran y no tumban el servidor ni las demás mesas.
- **Pantalla encendida** mientras estás en una mesa (donde el navegador lo permita), para que el celular no se duerma y se corte la conexión.

Variables de entorno, todas opcionales: `PORT`, `DATA_FILE`, `PERSIST_MS`, `TRUST_PROXY=1` (**actívala detrás de un proxy** para que los límites usen la IP real), `HOST_GRACE_MS`, `RATE_BURST`, `RATE_PER_SEC`, `MAX_CONN_PER_IP`, `JOIN_FAILS_MAX`.

`npm run icons` regenera los iconos PNG a partir de `public/icon.svg`.

## Publicar

**Guía completa en [DEPLOY.md](DEPLOY.md)** (Render gratis para probar, Railway, Fly.io, VPS, y qué comprobar después). Resumen: hace falta un servidor siempre encendido que acepte WebSockets; no sirven el hosting compartido ni Vercel. Hay `Dockerfile`, `render.yaml` y `fly.toml` listos, y `/healthz` para el monitor.

Hace falta alojamiento con **Node.js** (el hosting estático no sirve: necesita WebSockets).
Compila con `npm run build` y arranca con `npm start`. Pon HTTPS por delante (el cliente usa `wss://` automáticamente) y activa `TRUST_PROXY=1`. Conviene un supervisor que reinicie el proceso si muere (pm2 o el propio panel del hosting): gracias a la copia en disco, un reinicio apenas se nota.

## Pendiente / ideas

- Más juegos de fiesta: ideas pendientes: "Dos verdades y una mentira", "Confesiones anónimas" (cada uno escribe y se adivina quién fue), "Cultura chupística" con cuenta atrás por turnos, ruleta de castigos.
- Más contenido: ampliar `server/content.ts` (ahora unas 36 frases por nivel en Yo nunca, 32 en ¿Quién es más probable?, 24 en Preferirías y 20 en Verdad y Reto) o permitir que la mesa añada las suyas.
- Fichas que se llevan de una mesa a otra (hoy cada mesa empieza con 1000) y un ranking global.
- Blackjack: rendirse y varias divisiones por mano.
- Límite de conexiones por IP antes de abrirlo al público.

> Contenido +18: la app pide confirmar la mayoría de edad. Es solo un aviso: no sustituye
> a una verificación real si algún día se publica en tiendas.
