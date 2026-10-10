<script lang="ts">
  import { REACTIONS, type ReactionKind } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import { bubbles, ui } from '../lib/reactions.svelte';
  import { vibrate } from '../lib/format';
  import Icon from './Icon.svelte';

  let { bar = true }: { bar?: boolean } = $props();

  const LABEL: Record<ReactionKind, string> = {
    laugh: 'Risa', wow: 'Sorpresa', heart: 'Corazón', flame: 'Fuego', drink: 'Salud', sparkle: 'Brillo',
  };
  const nameOf = (id: string) => (id === net.pid ? 'Tú' : (net.room?.players.find((p) => p.id === id)?.name ?? ''));

  let last = 0;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const armClose = () => { clearTimeout(closeTimer); closeTimer = setTimeout(() => (ui.open = false), 3000); };
  $effect(() => { if (ui.open) armClose(); else clearTimeout(closeTimer); });

  function send(kind: ReactionKind) {
    armClose();
    const now = Date.now();
    if (now - last < 300) return; // el servidor también lo limita
    last = now;
    net.send({ t: 'react', kind });
    vibrate(8);
  }
</script>

<div class="float" aria-hidden="true">
  {#each bubbles.list as b (b.id)}
    <div class="bub" style="--x:{b.x}%">
      <span class="face"><Icon name={b.kind} size={26} /></span>
      <span class="who">{nameOf(b.from)}</span>
    </div>
  {/each}
</div>

{#if bar && ui.open}
  <nav class="bar" aria-label="Reacciones">
    {#each REACTIONS as k (k)}
      <button onclick={() => send(k)} aria-label={LABEL[k]}><Icon name={k} size={22} /></button>
    {/each}
  </nav>
{/if}

<style>
  .float { position: fixed; inset: 0; z-index: 35; pointer-events: none; overflow: hidden; }
  .bub {
    position: absolute; left: var(--x); bottom: calc(86px + var(--safe-b)); display: flex; flex-direction: column; align-items: center; gap: 3px;
    will-change: transform, opacity; animation: rise 2.5s cubic-bezier(0.2, 0.7, 0.3, 1) both;
  }
  .face {
    width: 46px; height: 46px; border-radius: 50%; display: grid; place-items: center; background: var(--gold-grad); color: var(--on-accent);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55), 0 6px 14px rgba(0, 0, 0, 0.45);
  }
  .who { font-size: 0.66rem; font-weight: 700; padding: 1px 8px; border-radius: 99px; background: rgba(0, 0, 0, 0.55); color: var(--text); white-space: nowrap; }
  @keyframes rise {
    0% { transform: translate3d(0, 20px, 0) scale(0.5); opacity: 0; }
    12% { transform: translate3d(0, 0, 0) scale(1.08); opacity: 1; }
    80% { opacity: 1; }
    100% { transform: translate3d(0, -52vh, 0) scale(0.95); opacity: 0; }
  }

  .bar {
    position: fixed; left: 50%; translate: -50% 0; top: calc(112px + var(--safe-t)); z-index: 30; animation: fadeUp 0.18s ease both;
    display: flex; gap: 2px; padding: 4px 6px; border-radius: 999px; background: var(--panel); border: 1px solid var(--line);
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.5);
  }
  .bar button { width: 46px; height: 42px; border-radius: 999px; display: grid; place-items: center; color: var(--gold-hi); transition: transform 0.1s, background 0.15s; }
  .bar button:active { transform: scale(0.82); background: rgb(var(--accent-rgb) / 0.18); }
</style>
