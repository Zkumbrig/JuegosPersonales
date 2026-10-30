<script lang="ts">
  // Entrar con el correo: se pide el correo, llega un código de un solo uso y se escribe aquí. Sin contraseñas.
  import { account } from '../lib/account.svelte';

  let { ondone, onguest }: { ondone: () => void; onguest: () => void } = $props();

  let email = $state('');
  let code = $state('');
  let sent = $state(false);
  let busy = $state(false);
  let error = $state('');
  let wait = $state(0);
  let timer: ReturnType<typeof setInterval> | undefined;

  const emailOk = $derived(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()));
  const codeOk = $derived(/^\d{6,10}$/.test(code.replace(/\s+/g, '')));

  function cooldown() {
    wait = 60;
    clearInterval(timer);
    timer = setInterval(() => { wait = Math.max(0, wait - 1); if (wait === 0) clearInterval(timer); }, 1000);
  }

  async function send() {
    if (!emailOk || busy) return;
    busy = true;
    error = '';
    const err = await account.start(email.trim());
    busy = false;
    if (err) { error = err; return; }
    sent = true;
    code = '';
    cooldown();
  }

  async function verify() {
    if (!codeOk || busy) return;
    busy = true;
    error = '';
    const err = await account.verify(email.trim().toLowerCase(), code.replace(/\s+/g, ''));
    busy = false;
    if (err) { error = err; return; }
    ondone();
  }
</script>

<section class="panel card" aria-label="Entrar con tu correo">
  <h2 class="display">Guarda tu progreso</h2>
  <p class="why">Entra con tu correo y tu perfil y tus logros te siguen a cualquier teléfono. Te enviamos un código: sin contraseñas.</p>

  {#if !sent}
    <label for="mail">Tu correo</label>
    <input id="mail" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" bind:value={email} placeholder="tucorreo@ejemplo.com" onkeydown={(e) => e.key === 'Enter' && send()} />
    <button class="btn btn-gold" disabled={!emailOk || busy} onclick={send}>{busy ? 'Enviando…' : 'Enviarme el código'}</button>
  {:else}
    <p class="sent">Te enviamos un código a <b>{email.trim()}</b>. Escríbelo aquí (revisa también el spam).</p>
    <label for="code">Código</label>
    <input id="code" class="codein" inputmode="numeric" autocomplete="one-time-code" maxlength="12" bind:value={code} placeholder="123456" onkeydown={(e) => e.key === 'Enter' && verify()} />
    <button class="btn btn-gold" disabled={!codeOk || busy} onclick={verify}>{busy ? 'Comprobando…' : 'Entrar'}</button>
    <div class="aux">
      <button class="link" onclick={() => { sent = false; error = ''; }}>Cambiar correo</button>
      <button class="link" disabled={wait > 0 || busy} onclick={send}>{wait > 0 ? `Reenviar en ${wait} s` : 'Reenviar código'}</button>
    </div>
  {/if}

  {#if error}<p class="err" role="alert">{error}</p>{/if}

  <button class="guest" onclick={onguest}>Jugar sin cuenta</button>
</section>

<style>
  .card { padding: 18px; display: flex; flex-direction: column; gap: 10px; animation: fadeUp 0.35s ease both; }
  h2 { margin: 0; font-size: 1.2rem; font-weight: 600; }
  .why, .sent { margin: 0; font-size: 0.95rem; line-height: 1.4; color: var(--muted); }
  .sent { color: var(--text); }
  label { font-size: 0.78rem; letter-spacing: 0.06em; color: var(--muted); }
  input { width: 100%; height: 50px; padding: 0 16px; border-radius: 14px; border: 1px solid var(--line); background: rgba(0, 0, 0, 0.35); font-size: 1.05rem; outline: none; transition: border-color 0.15s, box-shadow 0.15s; }
  input:focus { border-color: var(--gold); box-shadow: 0 0 0 3px rgb(var(--accent-rgb) / 0.18); }
  .codein { text-align: center; letter-spacing: 0.35em; font-weight: 700; font-size: 1.3rem; }
  .aux { display: flex; justify-content: space-between; gap: 8px; }
  .link { min-height: 44px; padding: 0 6px; color: var(--gold-hi); font-size: 0.9rem; text-decoration: underline; text-underline-offset: 3px; }
  .link:disabled { color: var(--muted); text-decoration: none; }
  .err { margin: 0; padding: 10px 12px; border-radius: 12px; background: rgba(224, 86, 75, 0.16); color: #ffb3a8; font-size: 0.9rem; }
  .guest { min-height: 44px; color: var(--muted); font-size: 0.95rem; }
  @media (max-height: 740px) { .card { padding: 14px; gap: 8px; } .why { font-size: 0.88rem; } }
</style>
