<script lang="ts">
  import { THEMES, setTheme, theme } from '../lib/theme.svelte';
  import Icon from './Icon.svelte';

  let open = $state(false);
</script>

<div class="wrap">
  <button class="icon" onclick={() => (open = !open)} aria-label="Cambiar estilo" aria-expanded={open}><Icon name="palette" size={20} /></button>
  {#if open}
    <div class="menu panel" role="menu">
      {#each THEMES as t (t.id)}
        <button
          class="opt"
          class:on={theme.id === t.id}
          role="menuitemradio"
          aria-checked={theme.id === t.id}
          onclick={() => { setTheme(t.id); open = false; }}
        >
          <span class="sw" style="--a:{t.colors[0]};--b:{t.colors[1]}"></span>
          {t.name}
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; }
  .icon { color: var(--gold-hi); width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); font-size: 1.05rem; display: grid; place-items: center; background: rgba(255, 255, 255, 0.03); }
  .menu { position: absolute; right: 0; top: 48px; z-index: 30; padding: 6px; display: grid; gap: 2px; min-width: 150px; box-shadow: 0 12px 30px rgba(0, 0, 0, 0.6); animation: fadeUp 0.18s ease both; }
  .opt { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 12px; font-size: 0.9rem; text-align: left; }
  .opt.on { background: rgb(var(--accent-rgb) / 0.14); color: var(--gold-hi); }
  .sw { width: 22px; height: 22px; border-radius: 50%; background: linear-gradient(135deg, var(--a) 50%, var(--b) 50%); border: 1px solid rgba(255, 255, 255, 0.35); flex: none; }
</style>
