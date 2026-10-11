<script lang="ts">
  import { BOARDS, TURN_SECONDS_CHOICES, type BoardSize } from '$shared/protocol';
  import { armColor, seatOrder } from '$shared/rules';
  import { ludo } from '$lib/game.svelte';
  import { sound } from '$lib/sound.svelte';
  import Board from './Board.svelte';
  import Icon from './Icon.svelte';
  import Switch from './Switch.svelte';

  const room = $derived(ludo.room!);
  const opts = $derived(room.options);
  const host = $derived(ludo.isHost);
  const hostName = $derived(room.players.find((p) => p.id === room.hostId)?.name ?? 'el líder');
  const capacity = $derived(opts.board);
  const free = $derived(capacity - room.players.length);

  // Los asientos vacíos enseñan el color que tomaría quien entre.
  const emptySeats = $derived.by(() => {
    const used = new Set(room.players.map((p) => p.arm));
    return seatOrder(opts.board)
      .filter((a) => !used.has(a))
      .slice(0, free);
  });

  const link = $derived(`${location.origin}${location.pathname}?sala=${room.code}`);

  async function copy(text: string, ok: string) {
    try {
      await navigator.clipboard.writeText(text);
      ludo.toast(ok);
    } catch {
      ludo.toast(`Copia a mano: ${text}`, 'error');
    }
  }
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Ludo Club', text: `Únete a mi sala de Ludo: ${room.code}`, url: link });
        return;
      } catch { /* cancelado */ }
    }
    await copy(link, 'Enlace copiado');
  }

  const secondsLabel = (s: number) => (s === 0 ? 'Sin límite' : `${s} segundos`);
</script>

<main class="lobby">
  <header class="top">
    <button class="btn ghost small" onclick={() => ludo.leave()}><Icon name="exit" size={16} /> Salir</button>
    <h1>Sala de espera</h1>
    <button class="btn ghost small icon" onclick={() => sound.toggle()} aria-label={sound.muted ? 'Activar sonido' : 'Silenciar'}>
      <Icon name={sound.muted ? 'mute' : 'sound'} size={18} />
    </button>
  </header>

  <div class="grid">
    <!-- Columna izquierda: código y jugadores -->
    <div class="col">
      <section class="card code-card">
        <span class="label">{host ? 'Eres el líder · comparte este código' : `Sala de ${hostName}`}</span>
        <div class="code" aria-label={`Código de sala ${room.code.split('').join(' ')}`}>
          {#each room.code.split('') as ch}<b>{ch}</b>{/each}
        </div>
        <div class="actions">
          <button class="btn small" onclick={() => copy(room.code, 'Código copiado')}><Icon name="copy" size={16} /> Copiar código</button>
          <button class="btn small" onclick={share}><Icon name={'share' in navigator ? 'share' : 'link'} size={16} /> Invitar</button>
        </div>
      </section>

      <section class="card">
        <div class="head">
          <h2><Icon name="users" size={18} /> Jugadores <span class="count">{room.players.length}/{capacity}</span></h2>
          {#if host && free > 0}
            <button class="btn small" onclick={() => ludo.addBot()}><Icon name="bot" size={16} /> Añadir bot</button>
          {/if}
        </div>

        <ul class="players">
          {#each room.players as p (p.id)}
            {@const c = armColor(opts.board, p.arm)}
            <li class:me={p.id === ludo.you?.id}>
              <span class="dot" style:--c={c.hex} title={c.name}></span>
              <span class="who">
                <span class="nm">{p.name}</span>
                <span class="colorname">{c.name}</span>
              </span>
              <span class="tags">
                {#if p.host}<span class="tag host"><Icon name="crown" size={12} /> Líder</span>{/if}
                {#if p.bot}<span class="tag"><Icon name="bot" size={12} /> Bot</span>{/if}
                {#if p.id === ludo.you?.id}<span class="tag">Tú</span>{/if}
                {#if !p.connected}<span class="tag warn">Sin conexión</span>{/if}
              </span>
              {#if host && p.id !== ludo.you?.id}
                <button
                  class="btn small icon ghost"
                  aria-label={p.bot ? `Quitar a ${p.name}` : `Expulsar a ${p.name}`}
                  onclick={() => (p.bot ? ludo.removeBot(p.id) : ludo.kick(p.id))}
                >
                  <Icon name="x" size={16} />
                </button>
              {/if}
            </li>
          {/each}
          {#each emptySeats as arm}
            <li class="empty">
              <span class="dot" style:--c={armColor(opts.board, arm).hex}></span>
              <span class="who"><span class="nm">Esperando jugador…</span></span>
            </li>
          {/each}
        </ul>

        {#if room.spectators > 0}
          <p class="spectators"><Icon name="eye" size={14} /> {room.spectators} {room.spectators === 1 ? 'persona mirando' : 'personas mirando'}</p>
        {/if}
        {#if !ludo.isPlayer}
          <div class="watching">
            <p><Icon name="eye" size={16} /> Estás mirando la sala.</p>
            {#if free > 0}<button class="btn small primary" onclick={() => ludo.sit()}>Sentarme</button>{/if}
          </div>
        {/if}
      </section>
    </div>

    <!-- Columna derecha: tablero, reglas e inicio -->
    <div class="col">
      <section class="card">
        <h2>Tablero</h2>
        <div class="boards" role="radiogroup" aria-label="Tablero">
          {#each BOARDS as b (b)}
            {@const tooSmall = b < room.players.length}
            <button
              class="boardopt"
              class:on={opts.board === b}
              role="radio"
              aria-checked={opts.board === b}
              disabled={!host || tooSmall}
              title={tooSmall ? `Hay ${room.players.length} jugadores: no caben` : undefined}
              onclick={() => ludo.config({ board: b as BoardSize })}
            >
              <span class="thumb"><Board board={b} players={opts.board === b ? room.players : []} mini /></span>
              <strong>{b}</strong>
              <small>jugadores</small>
            </button>
          {/each}
        </div>
        {#if !host}<p class="note">Solo {hostName} puede cambiar el tablero y las reglas.</p>{/if}
      </section>

      <section class="card">
        <h2>Reglas de la sala</h2>
        <div class="field timer">
          <label for="turn"><Icon name="clock" size={14} /> Tiempo por turno</label>
          <select
            id="turn"
            class="input"
            disabled={!host}
            value={opts.turnSeconds}
            onchange={(e) => ludo.config({ turnSeconds: Number(e.currentTarget.value) })}
          >
            {#each TURN_SECONDS_CHOICES as s}<option value={s}>{secondsLabel(s)}</option>{/each}
          </select>
        </div>
        <Switch
          checked={opts.endAtFirst}
          disabled={!host}
          label="Termina con el primer ganador"
          hint={opts.endAtFirst ? 'La partida acaba cuando alguien mete sus 4 peones.' : 'Se sigue jugando hasta fijar todos los puestos.'}
          onchange={(v) => ludo.config({ endAtFirst: v })}
        />
        <Switch
          checked={opts.exactFinish}
          disabled={!host}
          label="Tiro exacto para la meta"
          hint="Para entrar a la meta hay que sacar el número justo."
          onchange={(v) => ludo.config({ exactFinish: v })}
        />
        <Switch
          checked={opts.towers}
          disabled={!host}
          label="Parejas protegidas"
          hint="Dos peones del mismo color en una casilla no se pueden comer."
          onchange={(v) => ludo.config({ towers: v })}
        />
        <Switch
          checked={opts.autoSingle}
          disabled={!host}
          label="Mover solo si hay una jugada"
          hint="Evita pulsar cuando no hay nada que elegir."
          onchange={(v) => ludo.config({ autoSingle: v })}
        />
      </section>

      <details class="card how">
        <summary><Icon name="help" size={16} /> ¿Cómo se juega?</summary>
        <ul>
          <li>Cada turno tiras el dado. <strong>Solo con un 6</strong> puedes sacar un peón de casa.</li>
          <li>Un 6 te da otra tirada. Tres seises seguidos y pierdes el turno.</li>
          <li>Si caes sobre un peón rival lo mandas a casa y vuelves a tirar. Las casillas con estrella y las de salida son seguras.</li>
          <li>Tras dar la vuelta entras al pasillo de tu color y llegas a la meta con el tiro justo.</li>
          <li>Gana quien primero lleve sus 4 peones a la meta.</li>
        </ul>
      </details>

      <section class="start">
        {#if host}
          <button class="btn primary big" disabled={room.players.length < 2} onclick={() => ludo.start()}>
            <Icon name="play" size={18} /> Empezar partida
          </button>
          {#if room.players.length < 2}<p class="note">Hacen falta al menos 2 jugadores. Invita a alguien o añade un bot.</p>{/if}
        {:else}
          <p class="waiting" role="status">Esperando a que {hostName} empiece la partida…</p>
        {/if}
      </section>
    </div>
  </div>
</main>

<style>
  .lobby {
    max-width: 1080px;
    margin: 0 auto;
    padding: 16px 16px 40px;
  }
  .top {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    margin-bottom: 16px;
  }
  .top .btn:first-child {
    justify-self: start;
  }
  .top .btn:last-child {
    justify-self: end;
  }
  h1 {
    font-size: 1.2rem;
    font-weight: 900;
  }
  h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 1.05rem;
    font-weight: 900;
    margin-bottom: 12px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    align-items: start;
  }
  .col {
    display: grid;
    gap: 16px;
  }
  .code-card {
    text-align: center;
    display: grid;
    gap: 12px;
    justify-items: center;
    background:
      radial-gradient(400px 120px at 50% 0%, color-mix(in srgb, var(--accent) 16%, transparent), transparent),
      var(--surface);
  }
  .code {
    display: flex;
    gap: 8px;
  }
  .code b {
    display: grid;
    place-items: center;
    width: clamp(42px, 12vw, 58px);
    aspect-ratio: 0.82;
    border-radius: 12px;
    background: #fff;
    color: #1a1f3c;
    font-size: clamp(1.7rem, 7vw, 2.4rem);
    font-weight: 900;
    box-shadow: 0 5px 0 rgba(0, 0, 0, 0.35);
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    justify-content: center;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
  }
  .head h2 {
    margin: 0;
  }
  .count {
    color: var(--muted);
    font-weight: 700;
  }
  .players {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .players li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 12px;
    background: #10162f;
    border: 1px solid transparent;
  }
  .players li.me {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .players li.empty {
    opacity: 0.55;
    border: 1px dashed var(--line);
    background: transparent;
  }
  .dot {
    flex: none;
    width: 28px;
    height: 28px;
    border-radius: 9px;
    background: var(--c);
    box-shadow: inset 0 -3px 0 rgba(0, 0, 0, 0.25);
  }
  .who {
    display: grid;
    min-width: 0;
    flex: 1;
  }
  .nm {
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .colorname {
    font-size: 0.78rem;
    color: var(--muted);
  }
  .tags {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .spectators {
    margin-top: 10px;
    font-size: 0.88rem;
    color: var(--muted);
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .watching {
    margin-top: 12px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 12px;
    background: var(--surface-2);
  }
  .watching p {
    display: flex;
    gap: 6px;
    align-items: center;
    font-weight: 700;
  }
  .boards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
  }
  .boardopt {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 10px 6px;
    border-radius: 14px;
    border: 2px solid var(--line);
    background: #10162f;
    transition: border-color 0.15s, transform 0.12s;
  }
  .boardopt:hover:not(:disabled) {
    border-color: var(--muted);
  }
  .boardopt.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, #10162f);
  }
  .boardopt:disabled {
    cursor: default;
    opacity: 0.5;
  }
  .boardopt.on:disabled {
    opacity: 1;
  }
  .thumb {
    width: 100%;
    max-width: 120px;
  }
  .boardopt strong {
    font-size: 1.5rem;
    line-height: 1;
    margin-top: 4px;
  }
  .boardopt small {
    color: var(--muted);
    font-weight: 700;
  }
  .note {
    margin-top: 10px;
    font-size: 0.88rem;
    color: var(--muted);
  }
  .timer {
    margin-bottom: 6px;
  }
  .timer label {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  select.input {
    min-height: 44px;
    font-size: 1rem;
  }
  .how summary {
    cursor: pointer;
    font-weight: 900;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .how ul {
    margin: 12px 0 0;
    padding-left: 18px;
    display: grid;
    gap: 8px;
    color: var(--muted);
  }
  .how strong {
    color: var(--text);
  }
  .start {
    display: grid;
    gap: 8px;
    justify-items: stretch;
  }
  .big {
    min-height: 56px;
    font-size: 1.15rem;
  }
  .waiting {
    text-align: center;
    padding: 16px;
    border-radius: var(--radius);
    border: 1px dashed var(--line);
    color: var(--muted);
    font-weight: 800;
  }
  @media (max-width: 860px) {
    .grid {
      grid-template-columns: 1fr;
    }
  }
</style>
