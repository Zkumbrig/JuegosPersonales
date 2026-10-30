<script lang="ts">
  import { net } from '../lib/net.svelte';
  import AnimatedNumber from './AnimatedNumber.svelte';
  import Icon from './Icon.svelte';

  let { activeId = null }: { activeId?: string | null } = $props();

  const HUES = [38, 12, 160, 200, 280, 330, 90, 20];
</script>

<ul class="strip" aria-label="Jugadores en la mesa">
  {#each net.room?.players ?? [] as p (p.id)}
    <li class="p" class:me={p.id === net.pid} class:pulse={p.id === activeId} class:off={!p.connected}>
      <span class="avatar" style="--h:{HUES[p.avatar % HUES.length]}">
        {p.name.slice(0, 1).toUpperCase()}
        {#if p.host}<b class="crown" title="Anfitrión"><Icon name="kings" size={14} /></b>{/if}
      </span>
      <span class="name">{p.id === net.pid ? 'Tú' : p.name}</span>
      <span class="chips num"><AnimatedNumber value={p.chips} /></span>
    </li>
  {/each}
</ul>

<style>
  .strip {
    display: flex;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 6px 2px 8px;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .strip::-webkit-scrollbar { display: none; }
  @media (max-height: 740px) {
    .strip { padding: 2px 2px 4px; }
    .p { padding: 4px 10px 4px 4px; min-width: 96px; }
    .avatar { width: 30px; height: 30px; }
  }
  .p {
    flex: none;
    display: grid;
    grid-template-columns: auto 1fr;
    grid-template-rows: auto auto;
    column-gap: 8px;
    align-items: center;
    padding: 6px 12px 6px 6px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: rgba(255, 255, 255, 0.03);
    min-width: 104px;
  }
  .p.me { border-color: var(--gold-lo); }
  .p.off { opacity: 0.45; }
  .avatar {
    grid-row: 1 / 3;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-weight: 800;
    color: #1a1208;
    background: linear-gradient(135deg, hsl(var(--h) 80% 72%), hsl(var(--h) 65% 48%));
    position: relative;
  }
  .crown {
    position: absolute;
    top: -9px;
    right: -5px;
    font-size: 0.85rem;
    color: var(--gold-hi);
    text-shadow: 0 1px 3px #000;
  }
  .name { font-size: 0.74rem; color: var(--muted); max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 1.1; }
  .chips { font-weight: 700; color: var(--gold-hi); font-size: 0.9rem; line-height: 1.1; }
</style>
