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

<section class="panel card" aria-label="Guardar tu progreso">
  <h2 class="display">Guarda tu progreso</h2>
  <p class="why">Entra con tu cuenta y tu perfil y tus logros te siguen a cualquier teléfono. Sin contraseñas.</p>

  {#if account.google}
    <button class="google" onclick={() => account.signInWithGoogle()}>
      <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Continuar con Google
    </button>
  {/if}

  <!-- El correo solo se ofrece cuando Google no está activado en Supabase. -->
  {#if account.mail && !account.google}
  {#if !sent}
    <label for="mail">Tu correo</label>
    <input id="mail" type="email" inputmode="email" autocomplete="email" autocapitalize="none" spellcheck="false" bind:value={email} placeholder="tucorreo@ejemplo.com" onkeydown={(e) => e.key === 'Enter' && send()} />
    <button class="btn btn-gold" disabled={!emailOk || busy} onclick={send}>{busy ? 'Enviando…' : 'Enviarme el código'}</button>
  {:else}
    <p class="sent">Te enviamos un correo a <b>{email.trim()}</b>. Abre el enlace que trae (en este mismo teléfono) o, si trae un código, escríbelo aquí. Revisa también el spam.</p>
    <label for="code">Código (si el correo lo trae)</label>
    <input id="code" class="codein" inputmode="numeric" autocomplete="one-time-code" maxlength="12" bind:value={code} placeholder="123456" onkeydown={(e) => e.key === 'Enter' && verify()} />
    <button class="btn btn-gold" disabled={!codeOk || busy} onclick={verify}>{busy ? 'Comprobando…' : 'Entrar'}</button>
    <div class="aux">
      <button class="link" onclick={() => { sent = false; error = ''; }}>Cambiar correo</button>
      <button class="link" disabled={wait > 0 || busy} onclick={send}>{wait > 0 ? `Reenviar en ${wait} s` : 'Reenviar código'}</button>
    </div>
  {/if}
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
  /* Botón discreto: centrado, del ancho de su texto y con medidas que se ajustan a la pantalla (no ocupa todo el ancho). */
  .google {
    align-self: center;
    min-height: 44px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.6em;
    padding: 0 clamp(14px, 5vw, 22px);
    font-size: clamp(0.85rem, 3.4vw, 0.95rem);
    font-weight: 600;
    color: #1f1f1f;
    background: #fff;
    border: 1px solid #dadce0;
    border-radius: 999px;
    box-shadow: 0 1px 0 rgba(0, 0, 0, 0.2);
    transition: transform 0.12s;
  }
  .google svg { width: 1.25em; height: 1.25em; flex: none; }
  .google:active { transform: translateY(1px); box-shadow: none; }
  .aux { display: flex; justify-content: space-between; gap: 8px; }
  .link { min-height: 44px; padding: 0 6px; color: var(--gold-hi); font-size: 0.9rem; text-decoration: underline; text-underline-offset: 3px; }
  .link:disabled { color: var(--muted); text-decoration: none; }
  .err { margin: 0; padding: 10px 12px; border-radius: 12px; background: rgba(224, 86, 75, 0.16); color: #ffb3a8; font-size: 0.9rem; }
  .guest { min-height: 44px; color: var(--muted); font-size: 0.95rem; }
  @media (max-height: 740px) { .card { padding: 14px; gap: 8px; } .why { font-size: 0.88rem; } }
</style>
