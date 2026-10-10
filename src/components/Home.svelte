<script lang="ts">
    import { net } from '../lib/net.svelte';
  import ThemePicker from './ThemePicker.svelte';
  import Logo from './Logo.svelte';
  import Suit from './Suit.svelte';
  import Icon from './Icon.svelte';

  const params = new URLSearchParams(location.search);
  let name = $state(net.name);
  let code = $state((params.get('sala') ?? '').toUpperCase().slice(0, 4));
  const invited = (params.get('sala') ?? '').toUpperCase().slice(0, 4);
  const busy = $derived(net.link === 'connecting');
  const nameOk = $derived(name.trim().length > 0);

  function create() {
    if (nameOk) net.join(name);
  }
  let tvCode = $state('');
  function openTv() {
    if (tvCode.length === 4) location.assign(`/?tv=${tvCode}`);
  }
  function enter() {
    if (nameOk && code.length === 4) net.join(name, code);
  }
</script>

<main class="home">
  <div class="theme"><ThemePicker /></div>
  <header>
    <p class="eyebrow">Casino y fiesta entre amigos</p>
    <h1 class="brand"><Logo size={1.15} /></h1>
    <div class="rule" aria-hidden="true"><Suit s="S" size={14} /><Suit s="H" size={14} /><Suit s="D" size={14} /><Suit s="C" size={14} /></div>
  </header>

  {#if invited.length === 4}
    <p class="invite">Te han invitado a la mesa <b>{invited}</b>. Escribe tu nombre y pulsa Entrar.</p>
  {/if}

  <section class="panel card">
    <label for="name">Tu nombre</label>
    <input id="name" bind:value={name} maxlength="16" placeholder="Ej. Lucía" autocomplete="off" />

    <button class="btn btn-gold" disabled={!nameOk || busy} onclick={create}>
      {busy ? 'Conectando…' : 'Crear mesa nueva'}
    </button>

    <div class="or"><span>o únete a una</span></div>

    <div class="join">
      <input
        class="code"
        bind:value={code}
        oninput={() => (code = code.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
        maxlength="4"
        placeholder="CÓDIGO"
        aria-label="Código de la mesa"
        autocapitalize="characters"
        autocomplete="off"
        onkeydown={(e) => e.key === 'Enter' && enter()}
      />
      <button class="btn btn-ghost" disabled={!nameOk || code.length !== 4 || busy} onclick={enter}>Entrar</button>
    </div>
  </section>

  <section class="tvbox">
    <p class="muted"><Icon name="tv" size={16} /> ¿Tienes una tele o un portátil? Úsalo como pantalla de la mesa.</p>
    <div class="join">
      <input
        class="code"
        bind:value={tvCode}
        oninput={() => (tvCode = tvCode.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
        maxlength="4"
        placeholder="CÓDIGO"
        aria-label="Código de la mesa para la pantalla"
        autocapitalize="characters"
        autocomplete="off"
        onkeydown={(e) => e.key === 'Enter' && openTv()}
      />
      <button class="btn btn-ghost" disabled={tvCode.length !== 4} onclick={openTv}>Abrir pantalla</button>
    </div>
  </section>

  <footer class="muted">
    Fichas virtuales · Sin dinero real · Sin anuncios · +18
  </footer>
</main>

<style>
  .home {
    position: relative;
    min-height: 100dvh;
    max-width: 460px;
    margin: 0 auto;
    padding: calc(40px + var(--safe-t)) 22px calc(24px + var(--safe-b));
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 30px;
    animation: fadeUp 0.5s ease both;
  }
  .theme { position: absolute; top: calc(12px + var(--safe-t)); right: 14px; }
  header { text-align: center; }
  .eyebrow { margin: 0; text-transform: uppercase; letter-spacing: 0.32em; font-size: 0.72rem; color: var(--muted); }
  h1 { margin: 6px 0 16px; line-height: 1; }
  .rule { display: flex; justify-content: center; gap: 14px; color: var(--gold-lo); font-size: 1.1rem; }
  .rule :global(.suit:nth-child(even)) { color: #c8434f; }
  .card { padding: 22px; display: flex; flex-direction: column; gap: 14px; }
  label { font-size: 0.78rem; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
  input {
    width: 100%;
    height: 50px;
    padding: 0 16px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: rgba(0, 0, 0, 0.35);
    font-size: 1.05rem;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px rgb(var(--accent-rgb) / 0.18); }
  .or { display: flex; align-items: center; gap: 12px; color: var(--muted); font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.1em; }
  .or::before, .or::after { content: ''; flex: 1; height: 1px; background: var(--line); }
  .join { display: flex; gap: 10px; }
  .code { text-align: center; letter-spacing: 0.4em; font-weight: 700; font-size: 1.2rem; }
  .join .btn { flex: none; }
  .invite { margin: 0; text-align: center; padding: 12px 14px; border-radius: 16px; background: rgb(var(--accent-rgb) / 0.12); border: 1px solid var(--gold-lo); font-size: 0.9rem; line-height: 1.45; }
  .invite b { font-family: var(--font-display); letter-spacing: 0.1em; color: var(--gold-hi); }
  .tvbox { display: grid; gap: 10px; }
  .tvbox p { margin: 0; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.8rem; text-align: center; }
  footer { text-align: center; font-size: 0.74rem; letter-spacing: 0.06em; }
</style>
