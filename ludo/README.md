# Ludo Club

Ludo online para jugar con amigos: **tableros de 4, 6 y 8 jugadores**, salas con código, bots y reconexión.
Son **dos proyectos independientes**:

| Carpeta | Qué es | Tecnología |
|---|---|---|
| [`server/`](server) | API REST + WebSocket. Es la autoridad: tira los dados y valida cada jugada. | Node 22+, TypeScript, `ws` |
| [`client/`](client) | La web (SPA estática). Dibuja el tablero y anima lo que cuenta el servidor. | SvelteKit 2 + Svelte 5, SVG |

> **¿Por qué SvelteKit y no React?** El tablero es un SVG con decenas de piezas animadas que cambian a cada jugada.
> Svelte actualiza justo lo que cambia, sin virtual DOM, con un bundle pequeño (importa en móviles) y menos código.
> Además es el mismo stack que Royale Club. SvelteKit se usa en modo SPA estático (`adapter-static`): no hay nada que renderizar en servidor.

## Arranque rápido

```bash
cd ludo
npm run install:all          # instala server/ y client/
```

**Desarrollo** (dos terminales; el cliente reenvía `/api` y `/ws` al servidor):

```bash
npm run dev:server           # http://localhost:3002  (API + WebSocket)
npm run dev:client           # http://localhost:5173  (la web, con recarga en caliente)
```

**Producción** (un solo proceso: el servidor también sirve el cliente compilado):

```bash
npm run build                # compila client/ -> client/build
npm start                    # http://localhost:3002
```

Con Docker (contexto = esta carpeta): `docker build -t ludo . && docker run -p 3002:3002 ludo`.

## Cómo se juega

1. Escribes tu **nombre**. Quien pulsa **Crear sala** es el **líder**: ve el **código de sala** (5 caracteres) y elige tablero y reglas.
2. Los demás escriben el **código** (o abren el enlace `?sala=ABCDE`) y entran a la sala de espera, donde ven jugadores, colores y reglas.
   Si la sala está llena o la partida ya empezó, entran como **espectadores**.
3. El líder puede añadir **bots**, expulsar gente y empezar (mínimo 2 jugadores).
4. Cada turno se tira el dado. **Solo con un 6 se saca un peón de casa**, y ahí se elige peón.

### Reglas implementadas

- Tableros de **4, 6 u 8 brazos** (hasta 4, 6 u 8 jugadores). Los colores se reparten en el orden de llegada para que los jugadores queden lo más separados posible.
- 4 peones por jugador. Circuito de 13 casillas por brazo (52 / 78 / 104), en sentido horario; después, un pasillo de llegada de 5 casillas de tu color y la meta.
- **Sacar un 6** es obligatorio para salir de casa y da **otra tirada**. **Tres seises seguidos** pierden el turno.
- **Comer**: caer en una casilla con un peón rival lo manda a casa y das **otra tirada**. Meter un peón en la meta también da otra tirada.
- **Casillas seguras** (la salida de cada color y una estrella 8 casillas después): conviven peones rivales.
- **Meta con tiro exacto** (opcional).
- Gana quien mete antes sus 4 peones; opcionalmente se sigue hasta fijar todos los puestos.
- Opciones del líder: tiempo por turno (sin límite, 20–90 s), terminar al primer ganador, tiro exacto, **parejas protegidas** (dos peones del mismo color juntos no se comen) y mover solo cuando solo hay una jugada.
- Si alguien no responde a tiempo, el servidor juega por él; a la segunda vez pasa a **piloto automático** hasta que vuelva a tocar algo. Los desconectados siguen igual y recuperan su asiento al volver.
- Si el líder sale o se cae más de 20 s, el mando pasa a otra persona.

## API

### REST

| Método | Ruta | Respuesta |
|---|---|---|
| `GET` | `/api/health` (o `/healthz`) | `{ ok, rooms, uptime }` |
| `GET` | `/api/rooms/:code` | `{ code, phase, board, players, capacity, spectators, host, joinable }` o `404 { error: "not-found" }` |

El cliente usa el segundo para decir "Sala de Lucía · 3/8 jugadores · en espera" mientras escribes el código.

### WebSocket `/ws`

Mensajes JSON con un campo `t`. El contrato completo, con tipos TypeScript, está en
[`server/src/shared/protocol.ts`](server/src/shared/protocol.ts); el cliente lo importa tal cual.

**Cliente → servidor**

| `t` | Campos | Quién | Efecto |
|---|---|---|---|
| `create` | `name` | cualquiera | crea una sala; quien la crea es el líder |
| `join` | `code`, `name` | cualquiera | entra como jugador (si hay sitio en la sala de espera) o espectador |
| `resume` | `code`, `token` | cualquiera | recupera tu asiento tras una desconexión |
| `config` | `patch` (parcial de las opciones) | líder, sala de espera | cambia tablero y reglas |
| `bot` | `op: "add"` / `op: "remove", id` | líder, sala de espera | añade o quita bots |
| `kick` | `id` | líder | expulsa a alguien |
| `sit` | — | espectador | se sienta si queda hueco |
| `start` | — | líder | empieza la partida |
| `roll` | — | jugador con el turno | tira el dado |
| `move` | `pawn` (0–3) | jugador con el turno | mueve ese peón (debe estar en `movable`) |
| `rematch` | — | líder, partida terminada | vuelve a la sala de espera |
| `leave` | — | cualquiera | sale de la sala |
| `ping` | — | cualquiera | responde `pong` |

**Servidor → cliente**

| `t` | Contenido |
|---|---|
| `welcome` | `you: { id, token, role }` y `room` (al entrar o reanudar). Guarda el `token` para `resume`. |
| `state` | `room`: instantánea completa tras cada cambio, con `events[]` (dado, movimientos, capturas…) para animar. |
| `error` | `code` (`not-host`, `not-your-turn`, `illegal`, `phase`, `full`, `not-found`, `rate-limit`, `blocked`, `bad-request`) y `message` en español. |
| `kicked` | te han expulsado. |

Todo el estado es público, así que todos reciben el mismo `state`. El servidor valida cada acción: nadie puede tirar fuera de turno,
mover un peón que no puede moverse ni cambiar las reglas sin ser líder.

**Progreso de un peón** (`players[].pawns[]`): `0` en casa · `1` salida · `1…T-1` circuito (`T = 13 × brazos`) · `T…T+4` pasillo de llegada · `T+5` meta.
La geometría que convierte eso en coordenadas vive en el cliente ([`client/src/lib/geometry.ts`](client/src/lib/geometry.ts));
las reglas puras (`server/src/shared/rules.ts`) las comparten ambos lados.

### Ejemplo

```js
const ws = new WebSocket('ws://localhost:3002/ws');
ws.onopen = () => ws.send(JSON.stringify({ t: 'create', name: 'Lucía' }));
ws.onmessage = (e) => console.log(JSON.parse(e.data)); // { t: 'welcome', you, room: { code: 'K7XQ2', ... } }
```

## Configuración del servidor (variables de entorno)

| Variable | Por defecto | Para qué |
|---|---|---|
| `PORT` | `3002` | puerto HTTP/WebSocket |
| `CLIENT_DIR` | `../client/build` | carpeta del cliente compilado que se sirve |
| `TRUST_PROXY` | — | `1` si hay un proxy delante (Nginx, Cloudflare…): usa `X-Forwarded-For` para los límites por IP |
| `ALLOWED_ORIGINS` | cualquiera | orígenes permitidos para WebSocket y API, separados por comas |
| `MAX_ROOMS` / `MAX_CONN_PER_IP` | `500` / `40` | límites de capacidad |
| `LUDO_DEBUG_DICE` | — | solo pruebas manuales: `6,3,6,5` fuerza el orden de los dados |

Si el cliente se sirve desde **otro dominio**, compílalo con `VITE_SERVER_URL=wss://api.ejemplo.com npm run build` y pon ese dominio del cliente en `ALLOWED_ORIGINS`.

Defensas incluidas: mensajes de máx. 2 KB, límite de ritmo por conexión, límite de conexiones y de salas creadas por IP, bloqueo temporal tras demasiados códigos de sala erróneos, nombres saneados y tokens de sesión aleatorios.

## Tests

```bash
npm test          # server (45) + client (12)
npm run check     # tipos: tsc en el servidor, svelte-check en el cliente
```

- `server/test/rules.test.ts`: reglas (salir con 6, tiro exacto, comer, casillas seguras, parejas, pasillo privado) en los tres tableros.
- `server/test/room.test.ts`: sala de espera, líder, bots, reconexión, turnos, tres seises, tiempo agotado, abandonos y **partidas completas de bots** en 4, 6 y 8 con comprobación de invariantes.
- `server/test/integration.test.ts`: servidor real con clientes WebSocket (crear, unirse con código, configurar, jugar, reconectar, espectadores).
- `client/src/lib/geometry.test.ts`: el tablero de cada tamaño no solapa casillas, los patios caben y el recorrido es continuo.

## Límites conocidos

- Las salas viven **en memoria**: si el servidor se reinicia, las partidas en curso se pierden (los clientes vuelven al inicio con un aviso). Las salas sin nadie se borran solas.
- Sin cuentas ni ranking permanente. La sesión de cada jugador vive en la pestaña (`sessionStorage`).
- Necesita un hosting con **Node y WebSockets** (un hosting estático no vale). El `Dockerfile` no se ha podido probar en esta máquina porque el motor de Docker estaba apagado.
