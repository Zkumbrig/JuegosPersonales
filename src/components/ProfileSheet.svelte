<script lang="ts">
  import { onMount } from 'svelte';
  import { ACHIEVEMENTS, CASINO_ACHIEVEMENTS } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import { fmt } from '../lib/format';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  onMount(() => {
    net.profile = null;
    net.send({ t: 'profile:get' });
  });

  const p = $derived(net.profile);
  const got = $derived(new Set(p?.achievements ?? []));
  const casino = $derived(!!net.room?.casino);
  const shown = $derived(ACHIEVEMENTS.filter((a) => casino || !CASINO_ACHIEVEMENTS.includes(a.id)));
  const since = $derived(p ? new Date(p.firstSeen).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const stats = $derived(
    p
      ? [
          { k: 'Mesas', v: fmt(p.nights) },
          { k: 'Rondas', v: fmt(p.rounds) },
          { k: 'Tragos', v: fmt(p.drinks) },
          { k: 'Mejor reflejo', v: p.bestReflex === null ? '—' : `${p.bestReflex} ms` },
          ...(casino ? [{ k: 'Mayor premio', v: p.bigWin > 0 ? `+${fmt(p.bigWin)}` : '—' }, { k: 'Faroles', v: fmt(p.bluffs) }] : []),
        ]
      : [],
  );
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onclose()} />

<div class="overlay" role="presentation" onclick={onclose}>
  <div class="sheet panel" role="dialog" aria-modal="true" aria-label="Mi perfil" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
    <header>
      <Avatar id={net.pid} size={48} />
      <div>
        <h2 class="display">{net.me?.name ?? 'Mi perfil'}</h2>
        <small class="muted">{p ? `Miembro desde el ${since}` : 'Cargando…'}</small>
      </div>
      <button class="x" onclick={onclose} aria-label="Cerrar"><Icon name="x" size={20} /></button>
    </header>

    {#if p}
      <ul class="stats">
        {#each stats as s (s.k)}
          <li><b class="num">{s.v}</b><small>{s.k}</small></li>
        {/each}
      </ul>

      <h3>Logros <span class="count">{shown.filter((a) => got.has(a.id)).length}/{shown.length}</span></h3>
      <ul class="ach">
        {#each shown as a (a.id)}
          <li class:on={got.has(a.id)}>
            <span class="medal"><Icon name={a.icon} size={22} /></span>
            <span class="txt"><b>{a.name}</b><small>{a.desc}</small></span>
          </li>
        {/each}
      </ul>
      <p class="note muted">Tu perfil se guarda en este navegador y en el servidor, sin cuenta ni correo. Si borras los datos del navegador, empiezas de cero.</p>
    {:else}
      <p class="muted center">Cargando tu perfil…</p>
    {/if}
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 45; background: rgba(0, 0, 0, 0.64); display: flex; align-items: flex-end; justify-content: center; animation: fade 0.18s ease both; }
  .sheet {
    width: 100%; max-width: 520px; max-height: 90dvh; overflow-y: auto; border-radius: 22px 22px 0 0; border-bottom: 0; background: var(--panel);
    padding: 16px 16px calc(18px + var(--safe-b)); display: flex; flex-direction: column; gap: 14px; animation: rise 0.25s cubic-bezier(0.2, 0.9, 0.3, 1) both;
  }
  header { display: flex; align-items: center; gap: 12px; }
  header div { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.2; }
  h2 { margin: 0; font-size: 1.1rem; font-weight: 800; color: var(--gold-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .x { width: 44px; height: 44px; border-radius: 50%; border: 1px solid var(--line); display: grid; place-items: center; color: var(--gold-hi); flex: none; }
  .stats { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .stats li { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 4px; border-radius: 14px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--line); }
  .stats b { font-family: var(--font-display); font-size: 1rem; color: var(--gold-hi); }
  .stats small { font-size: 0.68rem; color: var(--muted); }
  h3 { margin: 4px 0 0; font-size: 0.74rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); font-weight: 700; display: flex; justify-content: space-between; }
  .count { color: var(--gold-hi); }
  .ach { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .ach li { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 14px; background: rgba(255, 255, 255, 0.03); opacity: 0.5; }
  .ach li.on { opacity: 1; background: rgb(var(--accent-rgb) / 0.1); border: 1px solid var(--gold-lo); }
  .medal { width: 42px; height: 42px; border-radius: 50%; display: grid; place-items: center; flex: none; background: rgba(255, 255, 255, 0.1); color: var(--muted); }
  .on .medal { background: var(--gold-grad); color: var(--on-accent); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.55); }
  .txt { display: flex; flex-direction: column; line-height: 1.25; min-width: 0; }
  .txt b { font-size: 0.9rem; }
  .txt small { font-size: 0.74rem; color: var(--muted); }
  .note { margin: 0; font-size: 0.72rem; line-height: 1.45; text-align: center; }
  .center { text-align: center; margin: 12px 0; }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  @keyframes rise { from { transform: translateY(40px); opacity: 0; } to { transform: none; opacity: 1; } }
</style>
