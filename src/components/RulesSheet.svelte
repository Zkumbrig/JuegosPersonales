<script lang="ts">
  import type { GameId } from '../../shared/protocol';
  import { RULES } from '../lib/rules';
  import { soften } from '../lib/party';
  import { net } from '../lib/net.svelte';
  import Icon from './Icon.svelte';

  let { game, onclose }: { game: GameId; onclose: () => void } = $props();
  const r = $derived(RULES[game]);
  const soft = $derived(!!net.room?.party.soft);
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="overlay" role="presentation" onclick={onclose}>
  <div class="sheet panel" role="dialog" aria-modal="true" aria-label="Reglas de {r.title}" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <header>
      <span class="medal"><Icon name={r.icon} size={26} /></span>
      <div>
        <small class="muted">Cómo se juega</small>
        <h2 class="display">{r.title}</h2>
      </div>
      <button class="x" onclick={onclose} aria-label="Cerrar"><Icon name="x" size={20} /></button>
    </header>

    <p class="lead">{soften(r.lead, soft)}</p>
    <ul class="points">
      {#each r.points as p (p)}<li>{soften(p, soft)}</li>{/each}
    </ul>

    {#if r.ranking}
      <h3>{r.ranking.title}</h3>
      <ol class="rank">
        {#each r.ranking.items as it, i (it)}<li><b>{i + 1}</b> {it}</li>{/each}
      </ol>
    {/if}

    <button class="btn btn-gold" onclick={onclose}>Entendido</button>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 45; background: rgba(0, 0, 0, 0.64); display: flex; align-items: flex-end; justify-content: center; animation: fade 0.18s ease both; }
  .sheet {
    width: 100%; max-width: 520px; max-height: 88dvh; overflow-y: auto; border-radius: 22px 22px 0 0; border-bottom: 0; background: var(--panel);
    padding: 16px 18px calc(18px + var(--safe-b)); display: flex; flex-direction: column; gap: 14px; animation: rise 0.25s cubic-bezier(0.2, 0.9, 0.3, 1) both;
  }
  header { display: flex; align-items: center; gap: 12px; }
  header div { flex: 1; display: flex; flex-direction: column; line-height: 1.15; min-width: 0; }
  h2 { margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--gold-hi); }
  .medal {
    width: 48px; height: 48px; border-radius: 50%; display: grid; place-items: center; flex: none; background: var(--gold-grad); color: var(--on-accent);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 6px 14px rgb(var(--accent-rgb) / 0.22);
  }
  .x { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--line); display: grid; place-items: center; color: var(--gold-hi); flex: none; }
  .lead { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 0.95rem; line-height: 1.4; }
  .points { margin: 0; padding: 0; list-style: none; display: grid; gap: 10px; }
  .points li { position: relative; padding-left: 20px; font-size: 0.9rem; line-height: 1.5; color: var(--text); }
  .points li::before { content: ''; position: absolute; left: 2px; top: 0.6em; width: 8px; height: 8px; border-radius: 2px; rotate: 45deg; background: var(--gold-grad); }
  h3 { margin: 4px 0 0; font-size: 0.72rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
  .rank { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .rank li { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border-radius: 10px; background: rgba(255, 255, 255, 0.04); font-size: 0.86rem; }
  .rank b { width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 0.72rem; background: rgb(var(--accent-rgb) / 0.18); color: var(--gold-hi); }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes rise { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
