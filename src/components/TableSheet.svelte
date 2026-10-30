<script lang="ts">
  import { BRAND } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import { reviewUi } from '../lib/review.svelte';

  let { onclose, onrecap, onprofile }: { onclose: () => void; onrecap: () => void; onprofile: () => void } = $props();

  const room = $derived(net.room!);
  const isHost = $derived(!!net.me?.host);
  let confirming = $state<string | null>(null); // doble toque para expulsar, sin diálogos del navegador
  let copied = $state(false);
  let showQr = $state(false);
  let showTv = $state(false);
  let tvCopied = $state(false);
  const tvUrl = $derived(`${location.origin}/?tv=${room.code}`);
  async function copyTv() {
    try { await navigator.clipboard.writeText(tvUrl); tvCopied = true; setTimeout(() => (tvCopied = false), 1800); } catch { /* sin permiso */ }
  }
  const inviteUrl = $derived(`${location.origin}/?sala=${room.code}`);

  function kick(id: string) {
    if (confirming !== id) { confirming = id; setTimeout(() => confirming === id && (confirming = null), 3000); return; }
    net.send({ t: 'room:kick', pid: id });
    confirming = null;
  }

  async function share() {
    const url = `${location.origin}/?sala=${room.code}`;
    try {
      if (navigator.share) { await navigator.share({ title: BRAND, text: `Únete a mi mesa en ${BRAND}. Código: ${room.code}`, url }); return; }
      await navigator.clipboard.writeText(url);
      copied = true;
      setTimeout(() => (copied = false), 1800);
    } catch { /* cancelado o sin permiso */ }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="overlay" role="presentation" onclick={onclose}>
  <div class="sheet panel" role="dialog" aria-modal="true" aria-label="Mesa" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <header>
      <div>
        <small class="muted">Mesa</small>
        <b class="code display foil-text">{room.code}</b>
      </div>
      <button class="x" onclick={onclose} aria-label="Cerrar"><Icon name="x" size={20} /></button>
    </header>

    <div class="two">
      <button class="btn btn-ghost" onclick={share}>
        <Icon name="share" size={16} /> {copied ? 'Copiado' : 'Invitar'}
      </button>
      <button class="btn btn-ghost" onclick={() => (showQr = !showQr)} aria-expanded={showQr}>
        <Icon name="qr" size={16} /> {showQr ? 'Ocultar QR' : 'Código QR'}
      </button>
    </div>
    {#if showQr}
      <div class="qr">
        {#await import('./QrCode.svelte') then m}
          <m.default value={inviteUrl} size={224} />
        {:catch}
          <small class="muted">No se pudo cargar el QR. Recarga la página.</small>
        {/await}
        <small class="muted">Que lo escaneen con la cámara del celular para entrar a la mesa {room.code}.</small>
      </div>
    {/if}

    {#if isHost}
      <label class="lock">
        <input type="checkbox" checked={room.locked} onchange={(e) => net.send({ t: 'room:lock', locked: e.currentTarget.checked })} />
        <span>
          <b><Icon name={room.locked ? 'lock' : 'unlock'} size={16} /> Cerrar la mesa</b>
          <small>Nadie nuevo podrá entrar, aunque tenga el código. Quien ya está dentro puede volver.</small>
        </span>
      </label>
    {:else if room.locked}
      <p class="note muted"><Icon name="lock" size={14} /> La mesa está cerrada a nuevos jugadores.</p>
    {/if}

    <ul>
      {#each room.players as p (p.id)}
        <li class:off={!p.connected}>
          <Avatar id={p.id} size={36} />
          <span class="who">
            <b>{p.id === net.pid ? 'Tú' : p.name}</b>
            <small class="muted">{p.host ? 'Anfitrión' : p.connected ? 'Conectado' : 'Sin conexión'}</small>
          </span>
          {#if p.host}<span class="crown" title="Anfitrión"><Icon name="kings" size={18} /></span>{/if}
          {#if isHost && p.id !== net.pid}
            <button class="kick" class:sure={confirming === p.id} onclick={() => kick(p.id)} aria-label="Expulsar a {p.name}">
              {#if confirming === p.id}¿Seguro?{:else}<Icon name="ban" size={16} /> Expulsar{/if}
            </button>
          {/if}
        </li>
      {/each}
    </ul>

    {#if !isHost}<p class="note muted">Solo el anfitrión puede expulsar o cerrar la mesa.</p>{/if}

    <div class="two">
      <button class="btn btn-ghost" onclick={onprofile}><Icon name="user" size={16} /> Mi perfil</button>
      <button class="btn btn-ghost" onclick={onrecap}><Icon name="trophy" size={16} /> Resumen</button>
    </div>
    <button class="btn btn-ghost" onclick={() => { reviewUi.open = true; onclose(); }}><Icon name="sparkle" size={16} /> Valorar el juego</button>
    <button class="btn btn-ghost" onclick={() => (showTv = !showTv)} aria-expanded={showTv}><Icon name="tv" size={16} /> Pantalla grande (TV)</button>
    {#if showTv}
      <div class="tvinfo">
        <p>Abre este enlace en la tele o la laptop. Verá la mesa en grande, sin cartas privadas, y no cuenta como jugador:</p>
        <code>{tvUrl}</code>
        <button class="btn btn-ghost" onclick={copyTv}>{tvCopied ? 'Copiado' : 'Copiar enlace de la pantalla'}</button>
      </div>
    {/if}
    <button class="btn btn-ghost leave" onclick={() => net.leave()}><Icon name="exit" size={16} /> Salir de la mesa</button>
  </div>
</div>

<style>
  .overlay {
    position: fixed; inset: 0; z-index: 40; background: rgba(0, 0, 0, 0.62);
    display: flex; align-items: flex-end; justify-content: center; animation: fade 0.18s ease both;
  }
  .sheet {
    width: 100%; max-width: 520px; max-height: 86dvh; overflow-y: auto; border-radius: 22px 22px 0 0; border-bottom: 0;
    padding: 16px 16px calc(18px + var(--safe-b)); display: flex; flex-direction: column; gap: 14px; background: var(--panel);
    animation: rise 0.25s cubic-bezier(0.2, 0.9, 0.3, 1) both;
  }
  header { display: flex; justify-content: space-between; align-items: center; }
  header div { display: flex; flex-direction: column; line-height: 1.1; }
  .code { font-size: 1.7rem; font-weight: 900; letter-spacing: 0.16em; }
  .x { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); display: grid; place-items: center; color: var(--gold-hi); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .two .btn { padding: 0 0.6rem; }
  .tvinfo { display: grid; gap: 10px; padding: 12px; border-radius: 14px; background: rgba(255, 255, 255, 0.04); }
  .tvinfo p { margin: 0; font-size: 0.8rem; line-height: 1.45; color: var(--muted); }
  .tvinfo code { font-size: 0.78rem; padding: 8px 10px; border-radius: 10px; background: rgba(0, 0, 0, 0.4); word-break: break-all; user-select: all; color: var(--gold-hi); }
  .qr { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 14px; border-radius: 16px; background: rgba(255, 255, 255, 0.04); }
  .qr small { text-align: center; font-size: 0.76rem; line-height: 1.4; max-width: 260px; }
  .leave { border-color: rgba(224, 86, 75, 0.5); color: #ffb3a8; background: rgba(224, 86, 75, 0.08); }
  .lock { display: flex; gap: 12px; align-items: flex-start; }
  .lock input {
    appearance: none; -webkit-appearance: none; position: relative; flex: none; width: 46px; height: 28px; margin: 2px 0 0;
    border-radius: 99px; background: rgba(255, 255, 255, 0.1); border: 1px solid var(--line); transition: background 0.2s;
  }
  .lock input::after { content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--muted); transition: transform 0.2s, background 0.2s; }
  .lock input:checked { background: var(--gold-grad); border-color: transparent; }
  .lock input:checked::after { transform: translateX(18px); background: var(--on-accent); }
  .lock span { display: flex; flex-direction: column; gap: 3px; }
  .lock b { display: inline-flex; align-items: center; gap: 6px; font-size: 0.92rem; }
  .lock small { font-size: 0.74rem; color: var(--muted); line-height: 1.35; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  li { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 14px; background: rgba(255, 255, 255, 0.03); }
  li.off { opacity: 0.55; }
  .who { display: flex; flex-direction: column; line-height: 1.2; flex: 1; min-width: 0; }
  .who b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .who small { font-size: 0.72rem; }
  .crown { color: var(--gold-hi); display: inline-flex; }
  .kick {
    display: inline-flex; align-items: center; gap: 6px; min-height: 36px; padding: 0 12px; border-radius: 999px; font-size: 0.74rem; font-weight: 700;
    border: 1px solid var(--line); color: var(--muted);
  }
  .kick.sure { border-color: var(--danger); color: #ffd2cc; background: rgba(224, 86, 75, 0.18); }
  .note { margin: 0; font-size: 0.78rem; text-align: center; display: flex; align-items: center; justify-content: center; gap: 6px; }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes rise { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
