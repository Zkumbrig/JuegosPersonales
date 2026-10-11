<script lang="ts">
  import { CODE_LEN, NAME_MAX, type RoomInfo } from '$shared/protocol';
  import { apiUrl, ludo } from '$lib/game.svelte';
  import Board from './Board.svelte';

  let name = $state(ludo.name);
  let code = $state(ludo.linkCode);
  let info = $state<RoomInfo | 'missing' | null>(null);

  const cleanName = $derived(name.trim());
  const invited = ludo.linkCode.length === CODE_LEN;

  // Al escribir un código completo se consulta la API para decir si la sala existe y qué hay dentro.
  $effect(() => {
    info = null;
    if (code.length !== CODE_LEN) return;
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/rooms/${code}`), { signal: ctl.signal });
        info = res.ok ? ((await res.json()) as RoomInfo) : 'missing';
      } catch { /* sin respuesta: se intentará al entrar */ }
    }, 250);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  });

  function onCode(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    code = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LEN);
    el.value = code;
  }

  const canCreate = $derived(cleanName.length > 0 && !ludo.resuming);
  const canJoin = $derived(canCreate && code.length === CODE_LEN && info !== 'missing');
</script>

<main class="home">
  <section class="hero">
    <div class="brand">
      <span class="chips" aria-hidden="true">
        <i style="--c:#e5383b"></i><i style="--c:#22b573"></i><i style="--c:#f6b800"></i><i style="--c:#2f7de1"></i>
      </span>
      <h1>Ludo <em>Club</em></h1>
    </div>
    <p class="lead">
      El clásico de casa, online. Tableros de <strong>4, 6 y 8 jugadores</strong>: crea una sala, comparte el código y a jugar.
    </p>
    <div class="spin" aria-hidden="true">
      <Board board={8} mini />
    </div>
    <ul class="points">
      <li>Solo sales de casa con un 6</li>
      <li>Come peones rivales</li>
      <li>Bots y reconexión</li>
    </ul>
  </section>

  <section class="card panel">
    {#if ludo.resuming}
      <p class="resuming" role="status">Reconectando con tu partida…</p>
    {:else}
      <div class="field">
        <label for="name">Tu nombre</label>
        <input
          id="name"
          class="input"
          bind:value={name}
          maxlength={NAME_MAX}
          placeholder="¿Cómo te llamas?"
          autocomplete="nickname"
          enterkeyhint="go"
        />
      </div>

      {#if invited}
        <p class="invite">Te invitaron a la sala <strong>{ludo.linkCode}</strong>.</p>
      {/if}

      <div class="join">
        <div class="field">
          <label for="code">Código de sala</label>
          <input
            id="code"
            class="input code"
            value={code}
            oninput={onCode}
            maxlength={CODE_LEN}
            placeholder="ABCDE"
            inputmode="text"
            autocapitalize="characters"
            autocomplete="off"
            spellcheck="false"
            onkeydown={(e) => e.key === 'Enter' && canJoin && ludo.join(code, cleanName)}
          />
        </div>
        <button class="btn primary" disabled={!canJoin} onclick={() => ludo.join(code, cleanName)}>Entrar</button>
      </div>

      <p class="roominfo" aria-live="polite">
        {#if info === 'missing'}
          <span class="bad">No existe ninguna sala con ese código.</span>
        {:else if info}
          Sala de <strong>{info.host ?? '…'}</strong> · {info.players}/{info.capacity} jugadores ·
          {#if info.phase === 'lobby'}
            {info.joinable ? 'en espera' : 'llena (podrás mirar)'}
          {:else}
            partida en curso (podrás mirar)
          {/if}
        {/if}
      </p>

      <div class="or"><span>o</span></div>

      <button class="btn primary big" disabled={!canCreate} onclick={() => ludo.create(cleanName)}>
        Crear sala nueva
      </button>
      <p class="hint">Serás el líder: verás el código para compartirlo y elegirás el tablero.</p>
    {/if}
  </section>
</main>

<style>
  .home {
    min-height: 100dvh;
    display: grid;
    grid-template-columns: 1fr minmax(320px, 440px);
    gap: clamp(24px, 5vw, 72px);
    align-items: center;
    max-width: 1100px;
    margin: 0 auto;
    padding: 32px 20px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .chips {
    display: grid;
    grid-template: 1fr 1fr / 1fr 1fr;
    gap: 4px;
    width: 46px;
    height: 46px;
  }
  .chips i {
    background: var(--c);
    border-radius: 7px;
  }
  h1 {
    font-size: clamp(2.6rem, 7vw, 4.2rem);
    font-weight: 900;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  h1 em {
    font-style: normal;
    color: var(--accent);
  }
  .lead {
    margin-top: 16px;
    max-width: 34ch;
    font-size: 1.15rem;
    color: var(--muted);
  }
  .lead strong {
    color: var(--text);
  }
  .spin {
    width: min(100%, 340px);
    margin: 28px 0 8px;
    animation: spin 90s linear infinite;
  }
  .points {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 0;
    margin: 18px 0 0;
    list-style: none;
  }
  .points li {
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--muted);
  }
  .panel {
    display: grid;
    gap: 14px;
    padding: 24px;
  }
  .join {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: end;
  }
  .code {
    text-transform: uppercase;
    letter-spacing: 0.4em;
    text-align: center;
    font-weight: 900;
    font-size: 1.3rem;
    padding-left: 0.4em;
  }
  .roominfo {
    min-height: 1.4em;
    font-size: 0.92rem;
    color: var(--muted);
  }
  .roominfo strong {
    color: var(--text);
  }
  .bad {
    color: var(--danger);
    font-weight: 700;
  }
  .invite {
    padding: 10px 14px;
    border-radius: 12px;
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border: 1px dashed color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .or {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--muted);
    font-weight: 800;
    text-transform: uppercase;
    font-size: 0.8rem;
  }
  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }
  .big {
    min-height: 54px;
    font-size: 1.1rem;
  }
  .hint {
    font-size: 0.88rem;
    color: var(--muted);
    text-align: center;
  }
  .resuming {
    text-align: center;
    padding: 28px 0;
    font-weight: 800;
    color: var(--muted);
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @media (max-width: 820px) {
    .home {
      grid-template-columns: 1fr;
      align-content: start;
      gap: 24px;
    }
    .spin {
      width: 200px;
      margin-top: 18px;
    }
    .lead {
      font-size: 1.05rem;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spin { animation: none; }
  }
</style>
