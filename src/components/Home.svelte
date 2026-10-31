<script lang="ts">
    import { net } from '../lib/net.svelte';
  import ThemePicker from './ThemePicker.svelte';
  import Logo from './Logo.svelte';
  import Icon from './Icon.svelte';
  import Onboarding from './Onboarding.svelte';
  import AccountLogin from './AccountLogin.svelte';
  import { account } from '../lib/account.svelte';

  const params = new URLSearchParams(location.search);
  let name = $state(net.name);
  let code = $state((params.get('sala') ?? '').toUpperCase().slice(0, 4));
  const invited = (params.get('sala') ?? '').toUpperCase().slice(0, 4);
  // El tutorial va primero (una sola vez); quien llega con un enlace de invitación va directo a poner su nombre.
  function tourSeen(): boolean {
    try { return localStorage.getItem('rc_onboard') === '1'; } catch { return false; }
  }
  let touring = $state(!tourSeen() && invited.length !== 4);
  function finishTour() {
    touring = false;
    try { localStorage.setItem('rc_onboard', '1'); } catch { /* modo privado */ }
  }
  // Entrar con el correo guarda el progreso en una cuenta. Quien prefiere jugar sin cuenta (o llega por invitación) pasa directo.
  let guest = $state(invited.length === 4 || sessionStorage.getItem('rc_guest') === '1');
  // Si la sesión se inicia desde el enlace del correo, el nombre del perfil se rellena solo.
  $effect(() => { if (account.email && net.name) name = net.name; });
  const showLogin = $derived(account.checked && account.enabled && !account.email && !guest);
  function chooseGuest() {
    guest = true;
    try { sessionStorage.setItem('rc_guest', '1'); } catch { /* modo privado */ }
  }
  function wantLogin() {
    guest = false;
    try { sessionStorage.removeItem('rc_guest'); } catch { /* modo privado */ }
  }
  function signOut() {
    account.logout();
    name = '';
    chooseGuest();
  }
  const busy = $derived(net.link === 'connecting');
  const nameOk = $derived(name.trim().length > 0);

  function create() {
    if (nameOk) net.join(name);
  }
  let tvCode = $state('');
  let tvOpen = $state(false);
  function openTv() {
    if (tvCode.length === 4) location.assign(`/?tv=${tvCode}`);
  }
  function enter() {
    if (nameOk && code.length === 4) net.join(name, code);
  }
</script>

<main class="home">
  <div class="theme"><ThemePicker /></div>
  <header class:compact={touring || showLogin}>
    <h1 class="brand"><Logo size={1.15} /></h1>
    <div class="rule" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
    <p class="promise display">Tu noche de juegos en una sola mesa</p>
    <p class="sub">Juegos de fiesta, Ludo y cartas para jugar con tus amigos desde el móvil.</p>
  </header>

  {#if touring}
    <Onboarding ondone={finishTour} />
  {:else if !account.checked}
    <p class="muted wait">Cargando…</p>
  {:else if showLogin}
    <AccountLogin ondone={() => (name = net.name)} onguest={chooseGuest} />
  {:else}
  {#if account.email}
    <p class="acct"><span>Sesión: <b>{account.email}</b></span> <button class="link" onclick={signOut}>Salir</button></p>
  {/if}
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
    <button class="tvtoggle" aria-expanded={tvOpen} onclick={() => (tvOpen = !tvOpen)}><Icon name="tv" size={16} /> ¿Tienes una tele o una laptop? Úsala como pantalla</button>
    {#if tvOpen}
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
    {/if}
  </section>

  {#if account.enabled && !account.email}
    <button class="how" onclick={wantLogin}>Guarda tu progreso: entrar con tu correo</button>
  {/if}
  <button class="how" onclick={() => (touring = true)}>¿Cómo funciona?</button>
  {/if}

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
  /* Durante el tutorial la cabecera se compacta para que los botones queden a la vista en móviles pequeños. */
  header.compact .sub, header.compact .rule { display: none; }
  header.compact h1 { margin-bottom: 4px; }
  header.compact .promise { margin-top: 8px; font-size: 1.2rem; }
  .promise { margin: 18px 0 6px; font-size: 1.45rem; font-weight: 600; line-height: 1.2; }
  .sub { margin: 0; font-size: 1rem; line-height: 1.45; color: var(--muted); }
  h1 { margin: 6px 0 16px; line-height: 1; }
  /* Confeti de colores bajo el logo; rebotan una vez al entrar. */
  .rule { display: flex; justify-content: center; gap: 10px; }
  .rule i { width: 10px; height: 10px; border-radius: 50%; background: var(--gold); animation: bounceIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) both; }
  .rule i:nth-child(2) { background: var(--pop); animation-delay: 0.08s; }
  .rule i:nth-child(3) { background: var(--felt-hi); animation-delay: 0.16s; }
  .rule i:nth-child(4) { background: var(--pop); animation-delay: 0.24s; }
  .rule i:nth-child(5) { background: var(--gold); animation-delay: 0.32s; }
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
  .tvtoggle { min-height: 44px; display: flex; align-items: center; justify-content: center; gap: 8px; font-size: 0.85rem; text-align: center; color: var(--muted); }
  /* Móviles bajos: menos aire para que la portada y el formulario quepan sin deslizar. */
  @media (max-height: 740px) {
    .home { padding-top: calc(20px + var(--safe-t)); padding-bottom: calc(12px + var(--safe-b)); gap: 12px; justify-content: flex-start; }
    h1 { margin: 0 0 8px; }
    .promise { margin: 10px 0 4px; font-size: 1.25rem; }
    .sub { font-size: 0.92rem; line-height: 1.35; }
    .card { padding: 16px; gap: 10px; }
    footer { font-size: 0.7rem; }
  }
  @media (max-height: 620px) { .sub { display: none; } .rule { display: none; } .promise { font-size: 1.15rem; } }
  .wait { text-align: center; margin: 24px 0; }
  .acct { margin: 0; display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 0.88rem; color: var(--muted); flex-wrap: wrap; }
  .acct b { color: var(--text); word-break: break-all; }
  .link { min-height: 44px; padding: 0 8px; color: var(--gold-hi); text-decoration: underline; text-underline-offset: 3px; }
  .how { align-self: center; min-height: 44px; padding: 0 14px; color: var(--gold-hi); font-size: 0.95rem; text-decoration: underline; text-underline-offset: 3px; }
  footer { text-align: center; font-size: 0.74rem; letter-spacing: 0.06em; }
</style>
