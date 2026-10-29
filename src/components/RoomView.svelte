<script lang="ts">
  import { GAMES, isPartyId, type GameId } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import { sound, toggleMute } from '../lib/sound.svelte';
  import ThemePicker from './ThemePicker.svelte';
  import Icon from './Icon.svelte';
  import Blackjack from './Blackjack.svelte';
  import Roulette from './Roulette.svelte';
  import Slots from './Slots.svelte';
  import Poker from './Poker.svelte';
  import PartyHub from './PartyHub.svelte';
  import Ludo from './ludo/Ludo.svelte';
  import Party from './Party.svelte';
  import TableSheet from './TableSheet.svelte';
  import Reactions from './Reactions.svelte';
  import { ui as reactUi } from '../lib/reactions.svelte';

  const room = $derived(net.room!);
  const me = $derived(net.me);
  const isHost = $derived(!!me?.host);
  const lastFeed = $derived(room.feed.at(-1));
  const party = $derived(isPartyId(room.game));
  const ludo = $derived(room.game === 'ludo');
  const casino = $derived(!party && !ludo);
  const casinoOn = $derived(room.casino);
  const broke = $derived(casino && (me?.chips ?? 1) < 10);
  let showTable = $state(false);
  let showRules = $state(false);
  let showRecap = $state(false);
  let showProfile = $state(false);

  // El "?" late una vez por juego hasta que se abren sus reglas, para que nadie juegue a ciegas.
  const seenKey = (g: string) => `rc_rules_${g}`;
  const readSeen = (g: string) => { try { return localStorage.getItem(seenKey(g)) === '1'; } catch { return true; } };
  let seen = $state<Record<string, boolean>>({});
  const unseen = $derived(!(seen[room.game] ?? readSeen(room.game)));
  function openRules() {
    showRules = true;
    seen[room.game] = true;
    try { localStorage.setItem(seenKey(room.game), '1'); } catch { /* ignore */ }
  }

  function pick(g: GameId) {
    if (g !== room.game) net.send({ t: 'game', game: g });
  }

  function zone(z: 'casino' | 'party' | 'ludo') {
    const target: GameId = z === 'party' ? 'party' : z === 'ludo' ? 'ludo' : 'blackjack';
    const here = ludo ? 'ludo' : party ? 'party' : 'casino';
    if (z !== here) pick(target);
  }
</script>

<div class="room" class:wide={ludo}>
  <header>
    <button class="code" onclick={() => (showTable = true)} aria-label="Mesa {room.code}: jugadores y ajustes">
      <span class="lbl">Mesa</span>
      <span class="val display gold-text">{room.code}</span>
      <span class="ico"><Icon name={room.locked ? 'lock' : 'users'} size={16} /><b>{room.players.length}</b></span>
    </button>
    <div class="right">
      <button class="icon" class:pulse={unseen} onclick={openRules} aria-label="Reglas de este juego"><Icon name="help" size={20} /></button>
      <ThemePicker />
      <button class="icon" onclick={toggleMute} aria-label={sound.muted ? 'Activar sonido' : 'Silenciar'}><Icon name={sound.muted ? 'mute' : 'sound'} size={20} /></button>
    </div>
  </header>

  <div class="zones" style:--zn={casinoOn ? 3 : 2}>
    {#if casinoOn}<button class="zone" class:on={casino} role="tab" aria-selected={casino} disabled={!isHost && !casino} onclick={() => zone('casino')}><Icon name="chip" size={18} /> Casino</button>{/if}
    <button class="zone" class:on={party} role="tab" aria-selected={party} disabled={!isHost && !party} onclick={() => zone('party')}><Icon name="party" size={18} /> Fiesta</button>
    <button class="zone" class:on={ludo} role="tab" aria-selected={ludo} disabled={!isHost && !ludo} onclick={() => zone('ludo')}><Icon name="ludo" size={18} /> Ludo</button>
    <button class="zone react" class:on={reactUi.open} onclick={() => (reactUi.open = !reactUi.open)} aria-label="Reacciones" aria-expanded={reactUi.open}><Icon name="sparkle" size={20} /></button>
  </div>

  {#if casino}
    <nav class="tabs" aria-label="Juegos" style:--gn={room.casinoGames.length}>
      {#each GAMES.filter((x) => room.casinoGames.includes(x.id)) as g (g.id)}
        <button class="tab" class:on={room.game === g.id} disabled={!isHost && room.game !== g.id} onclick={() => pick(g.id)}>
          {g.short}
        </button>
      {/each}
    </nav>
  {/if}
  {#if !isHost}<p class="hint muted">El anfitrión elige el juego de la mesa.</p>{/if}

  {#if net.link === 'retrying'}
    <p class="banner">Reconectando…</p>
  {/if}

  {#if broke}
    <div class="panel broke">
      <p>Te quedaste sin fichas.</p>
      <button class="btn btn-gold" onclick={() => net.send({ t: 'rebuy' })}>Pedir préstamo al banco</button>
    </div>
  {/if}

  <main>
    {#key room.game}
      {#if room.game === 'blackjack'}<Blackjack />
      {:else if room.game === 'roulette'}<Roulette />
      {:else if room.game === 'poker'}<Poker />
      {:else if room.game === 'ludo'}<Ludo />
      {:else if room.game === 'party'}<PartyHub />
      {:else if party}<Party />
      {:else}<Slots />{/if}
    {/key}
  </main>

  {#if showTable}<TableSheet onclose={() => (showTable = false)} onrecap={() => { showTable = false; showRecap = true; }} onprofile={() => { showTable = false; showProfile = true; }} />{/if}
  {#if showRules}
    {#await import('./RulesSheet.svelte') then m}<m.default game={room.game} onclose={() => (showRules = false)} />{:catch}{@render stale(() => (showRules = false))}{/await}
  {/if}
  {#if showProfile}
    {#await import('./ProfileSheet.svelte') then m}<m.default onclose={() => (showProfile = false)} />{:catch}{@render stale(() => (showProfile = false))}{/await}
  {/if}
  {#if showRecap}
    {#await import('./Recap.svelte') then m}<m.default onclose={() => (showRecap = false)} />{:catch}{@render stale(() => (showRecap = false))}{/await}
  {/if}
  <Reactions />

  {#if lastFeed}
    {#key lastFeed.id}<p class="feed" aria-live="polite"><Icon name="sparkle" size={14} /> {lastFeed.text}</p>{/key}
  {/if}
</div>

{#snippet stale(close: () => void)}
  <div class="stale panel" role="alert">
    <p>Hay una versión nueva de la app. Recarga para poder abrir esto.</p>
    <div><button class="btn btn-gold" onclick={() => location.reload()}>Recargar</button> <button class="btn btn-ghost" onclick={close}>Ahora no</button></div>
  </div>
{/snippet}

<style>
  .stale { position: fixed; left: 16px; right: 16px; bottom: calc(20px + var(--safe-b)); z-index: 60; padding: 14px; display: grid; gap: 10px; text-align: center; max-width: 480px; margin: 0 auto; }
  .stale p { margin: 0; font-size: 0.88rem; }
  .stale div { display: flex; gap: 8px; justify-content: center; }
  .room.wide { max-width: 1040px; }
  .room { max-width: 520px; margin: 0 auto; padding: calc(10px + var(--safe-t)) 12px calc(20px + var(--safe-b)); display: flex; flex-direction: column; gap: 10px; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .code { display: flex; align-items: baseline; gap: 8px; padding: 4px 10px 4px 0; text-align: left; }
  .lbl { font-size: 0.66rem; text-transform: uppercase; letter-spacing: 0.22em; color: var(--muted); }
  .val { font-size: 1.5rem; font-weight: 800; letter-spacing: 0.1em; line-height: 1; }
  .ico { color: var(--gold); align-self: center; display: inline-flex; align-items: center; gap: 4px; font-size: 0.8rem; }
  .right { display: flex; gap: 5px; flex: none; }
  @media (max-width: 420px) { .lbl { display: none; } }
  .icon { color: var(--gold-hi); width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); font-size: 1.05rem; display: grid; place-items: center; background: rgba(255, 255, 255, 0.03); }
  .zones { display: grid; grid-template-columns: repeat(var(--zn, 3), 1fr) 46px; gap: 6px; }
  .zone.react { padding: 0; }
  .zone { display: inline-flex; align-items: center; justify-content: center; gap: 8px; font-family: var(--font-display); min-height: 40px; border-radius: 12px; border: 1px solid var(--line); font-size: 0.82rem; font-weight: 700; color: var(--muted); letter-spacing: 0.03em; }
  .zone.on { border-color: var(--gold); color: var(--gold-hi); background: rgb(var(--accent-rgb) / 0.12); }
  .zone:disabled:not(.on) { opacity: 0.45; }
  .tabs { display: grid; grid-template-columns: repeat(var(--gn, 4), 1fr); gap: 4px; padding: 4px; border-radius: 999px; background: rgba(0, 0, 0, 0.4); border: 1px solid var(--line); }
  .tab { min-height: 40px; border-radius: 999px; font-family: var(--font-display); font-size: 0.62rem; font-weight: 600; letter-spacing: 0.02em; color: var(--muted); transition: background 0.2s, color 0.2s; }
  .tab.on { background: var(--gold-grad); color: var(--on-accent); }
  .tab:disabled:not(.on) { opacity: 0.45; }
  .hint { margin: -4px 0 0; text-align: center; font-size: 0.74rem; }
  .banner { margin: 0; text-align: center; padding: 8px; border-radius: 12px; background: rgba(224, 86, 75, 0.18); color: #ffb3a8; font-size: 0.85rem; }
  .broke { padding: 14px; text-align: center; display: grid; gap: 10px; animation: fadeUp 0.3s ease both; }
  .broke p { margin: 0; }
  .feed { margin: 0; display: flex; align-items: center; justify-content: center; gap: 6px; text-align: center; font-size: 0.82rem; color: var(--gold-hi); animation: fadeUp 0.4s ease both; }
</style>
