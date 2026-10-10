<script lang="ts">
  import { net } from './lib/net.svelte';
  import AgeGate from './components/AgeGate.svelte';
  import Home from './components/Home.svelte';
  import RoomView from './components/RoomView.svelte';
  import Celebrate from './components/Celebrate.svelte';
  import { fx } from './lib/celebrate.svelte';
  import { keepAwake } from './lib/wakelock';

  function readAge(): boolean {
    try { return localStorage.getItem('rc_age') === '1'; } catch { return false; }
  }
  let adult = $state(readAge());
  // Un dispositivo grande (TV, portátil) abre /?tv=CODIGO y se convierte en pantalla de la mesa.
  const tvCode = (new URLSearchParams(location.search).get('tv') ?? '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);

  // Pantalla siempre encendida mientras estás en una mesa
  const inRoom = $derived(!!net.room);
  $effect(() => keepAwake(inRoom));

  function confirm() {
    try { localStorage.setItem('rc_age', '1'); } catch { /* ignore */ }
    adult = true;
  }
</script>

{#if !adult}
  <AgeGate onconfirm={confirm} />
{:else if tvCode.length === 4}
  {#await import('./components/Tv.svelte') then m}
    <m.default code={tvCode} />
  {:catch}
    <p class="stale">No se pudo cargar la pantalla. Recarga la página.</p>
  {/await}
{:else if net.room}
  <RoomView />
{:else}
  <Home />
{/if}

{#key fx.n}
  {#if fx.n > 0}<Celebrate big={fx.big} />{/if}
{/key}

{#if net.error}
  <div class="toast" class:ok={net.errorKind === 'ok'} role="alert">{net.error}</div>
{/if}

<style>
  .stale { text-align: center; padding: 40px 20px; color: var(--muted); }
  .toast.ok { background: linear-gradient(135deg, #1b1a10, #141108); border-color: var(--gold); color: var(--gold-hi); }
  .toast {
    position: fixed;
    left: 50%;
    bottom: calc(24px + var(--safe-b));
    translate: -50% 0;
    max-width: calc(100vw - 32px);
    padding: 12px 20px;
    border-radius: 999px;
    background: #2b0f14;
    border: 1px solid var(--danger);
    color: #ffd2cc;
    font-size: 0.9rem;
    z-index: 50;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
    animation: fadeUp 0.25s ease both;
  }
</style>
