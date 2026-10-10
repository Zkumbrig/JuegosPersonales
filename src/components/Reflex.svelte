<script lang="ts">
  import { untrack } from 'svelte';
  import { net } from '../lib/net.svelte';
  import { sfx } from '../lib/sound.svelte';
  import { soften } from '../lib/party';
  import { vibrate } from '../lib/format';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';

  const pa = $derived(net.room!.party);
  const isHost = $derived(!!net.me?.host);
  const nameOf = (id: string) => (id === net.pid ? 'Tú' : (net.room!.players.find((p) => p.id === id)?.name ?? '?'));
  const iTapped = $derived(pa.answered.includes(net.pid));
  const iDrink = $derived(pa.phase === 'reveal' && pa.drinkers.includes(net.pid));

  // El móvil mide su propio tiempo de reacción desde que recibe el "¡YA!".
  let goAt = 0;
  let myMs = $state<number | null>(null);
  let lastPhase = '';
  $effect(() => {
    const phase = pa.phase;
    const round = pa.round;
    untrack(() => {
      if (phase === 'go' && lastPhase !== 'go') { goAt = performance.now(); myMs = null; sfx.go(); vibrate(40); }
      if (phase === 'wait' && lastPhase !== 'wait') myMs = null;
      if (phase === 'reveal' && lastPhase !== 'reveal') (pa.drinkers.includes(net.pid) ? sfx.drink : sfx.stop)();
      lastPhase = phase;
      void round;
    });
  });

  function tap() {
    if (iTapped) return;
    if (pa.phase === 'go') {
      myMs = Math.round(performance.now() - goAt);
      net.send({ t: 'pa:tap', ms: myMs });
    } else if (pa.phase === 'wait') {
      net.send({ t: 'pa:tap', ms: 0 });
      vibrate(30);
    }
  }
</script>

<div class="wrap">
  {#if pa.phase === 'idle' || pa.phase === 'reveal'}
    {#if pa.phase === 'reveal' && pa.times}
      <section class="panel result">
        <h3 class="display">{#if iDrink}<Icon name={pa.soft ? 'minus' : 'drink'} size={22} /> {pa.soft ? 'Pierdes un punto' : '¡Bebes tú!'}{:else}Resultado{/if}</h3>
        <ol>
          {#each pa.times as r, i (r.id)}
            <li class:drink={pa.drinkers.includes(r.id)}>
              <span class="pos">{i + 1}</span>
              <Avatar id={r.id} size={30} />
              <span class="name">{nameOf(r.id)}</span>
              <b class="num">{r.early ? 'Se adelantó' : r.ms === null ? 'No llegó' : `${r.ms} ms`}</b>
              {#if pa.drinkers.includes(r.id)}<span class="beer">{#if pa.soft}−1{:else}<Icon name="drink" size={18} />{/if}</span>{/if}
            </li>
          {/each}
        </ol>
        <p class="muted small">{soften('Bebe el más lento, el que no llegó y quien se adelanta.', pa.soft)}</p>
      </section>
    {:else}
      <section class="panel intro">
        <p class="display lead">Duelo de reflejos</p>
        <p class="muted">Cuando la pantalla se ponga <b class="g">verde</b>, toca lo más rápido que puedas. Si tocas antes, {soften('bebes', pa.soft)}.</p>
      </section>
    {/if}
    {#if isHost}
      <button class="btn btn-gold" onclick={() => net.send({ t: 'pa:next' })}>{pa.phase === 'idle' ? 'Empezar' : 'Otra vez'}</button>
    {:else}
      <p class="muted center">Esperando al anfitrión…</p>
    {/if}
  {:else}
    <button
      class="zone"
      class:wait={pa.phase === 'wait'}
      class:go={pa.phase === 'go'}
      class:done={iTapped}
      onpointerdown={tap}
      aria-label={pa.phase === 'go' ? '¡Ya! Toca' : 'Espera, no toques'}
    >
      {#if iTapped}
        <span class="big">{myMs !== null ? `${myMs} ms` : 'Te adelantaste'}</span>
        <span class="sub">Esperando al resto…</span>
      {:else if pa.phase === 'wait'}
        <span class="big">Espera…</span>
        <span class="sub">No toques todavía</span>
      {:else}
        <span class="big">¡YA!</span>
        <span class="sub">Toca</span>
      {/if}
    </button>
    <ul class="who">
      {#each net.room!.players.filter((p) => p.connected) as p (p.id)}
        <li class:ok={pa.answered.includes(p.id)}><Avatar id={p.id} size={26} /></li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .wrap { display: flex; flex-direction: column; gap: 12px; }
  .intro, .result { padding: 18px 16px; text-align: center; }
  .lead { font-size: 1.3rem; font-weight: 800; margin: 0 0 8px; color: var(--gold-hi); }
  .intro p { margin: 0; line-height: 1.5; }
  .g { color: var(--ok); }
  .result h3 { margin: 0 0 12px; font-size: 1.15rem; display: inline-flex; align-items: center; gap: 8px; color: var(--gold-hi); }
  ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; text-align: left; }
  li { display: grid; grid-template-columns: 20px 30px 1fr auto auto; align-items: center; gap: 10px; padding: 6px 10px; border-radius: 12px; background: rgba(255, 255, 255, 0.03); }
  li.drink { background: rgb(var(--accent-rgb) / 0.14); }
  .pos { color: var(--muted); font-weight: 700; text-align: center; }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .beer { display: inline-flex; color: var(--gold-hi); }
  .small { font-size: 0.74rem; margin: 10px 0 0; }
  .center { text-align: center; margin: 0; }

  .zone {
    min-height: 360px; border-radius: 24px; display: grid; place-content: center; gap: 4px; text-align: center; user-select: none;
    touch-action: manipulation; border: 2px solid rgba(255, 255, 255, 0.25);
  }
  .zone.wait { background: linear-gradient(160deg, #8a1c26, #4b0c13); }
  .zone.go { background: linear-gradient(160deg, #1fae5f, #0d6b38); border-color: #aaf5c9; }
  .zone.done { opacity: 0.8; }
  .big { font-family: var(--font-display); font-size: 2.6rem; font-weight: 900; line-height: 1; }
  .sub { font-size: 0.9rem; opacity: 0.85; }
  .who { display: flex; justify-content: center; gap: 10px; list-style: none; margin: 0; padding: 0; }
  .who li { display: block; padding: 3px; background: none; opacity: 0.4; border-radius: 50%; }
  .who li.ok { opacity: 1; box-shadow: 0 0 0 2px var(--ok); }
</style>
