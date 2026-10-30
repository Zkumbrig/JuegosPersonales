<script lang="ts">
  import { LEVELS, PARTY_GAMES } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import { drinkNoun } from '../lib/party';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Art from './Art.svelte';
  import Flames from './Flames.svelte';

  const pa = $derived(net.room!.party);
  const isHost = $derived(!!net.me?.host);
  const ranking = $derived(
    net.room!.players
      .map((p) => ({ id: p.id, name: p.id === net.pid ? 'Tú' : p.name, n: pa.tally[p.id] ?? 0 }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.n - a.n),
  );
  const top = $derived(ranking[0]?.n ?? 1);
</script>

<div class="hub">
  <header>
    <h2 class="display gold-text">Zona Fiesta</h2>
    <p class="muted">{isHost ? 'Elige un juego para la mesa' : 'El anfitrión elige el juego'}</p>
  </header>

  <div class="grid">
    {#each PARTY_GAMES as g (g.id)}
      <button class="tile ticket panel" disabled={!isHost} onclick={() => net.send({ t: 'game', game: g.id })}>
        <span class="ico" aria-hidden="true"><Art name={g.id} size={46} /></span>
        <span class="name">{g.name}</span>
        <span class="tag">{g.tagline}</span>
      </button>
    {/each}
  </div>

  <section class="panel box">
    <h3>Intensidad</h3>
    <div class="levels" role="radiogroup" aria-label="Intensidad">
      {#each LEVELS as l (l.id)}
        <button
          class="lv"
          class:on={pa.level === l.id}
          role="radio"
          aria-checked={pa.level === l.id}
          disabled={!isHost}
          onclick={() => net.send({ t: 'pa:level', level: l.id })}
        >
          <span class="fl"><Flames n={l.flames} size={20} /></span>
          <b>{l.name}</b>
          <small>{l.hint}</small>
        </button>
      {/each}
    </div>
    <label class="soft">
      <input type="checkbox" checked={pa.soft} disabled={!isHost} onchange={(e) => net.send({ t: 'pa:soft', soft: e.currentTarget.checked })} />
      <span>
        <b>Modo sin alcohol</b>
        <small>"Beber" pasa a ser "perder un punto". Ideal si alguien conduce o no bebe.</small>
      </span>
    </label>
  </section>

  {#if ranking.length}
    <section class="panel box">
      <h3>{pa.soft ? 'Puntos perdidos de la noche' : 'Tragos de la noche'}</h3>
      <ol class="rank">
        {#each ranking as r, i (r.id)}
          <li>
            <span class="pos">{#if i === 0}<Icon name="trophy" size={16} />{:else}{i + 1}{/if}</span>
            <Avatar id={r.id} size={26} />
            <span class="n">{r.name}</span>
            <span class="bar"><i style="width:{(r.n / top) * 100}%"></i></span>
            <b class="num">{r.n}</b>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  <p class="care muted">
    Beban con moderación y solo si quieren. Cualquier reto se puede rechazar. Si alguien ha bebido de más,
    el siguiente trago es agua. Nadie conduce después de beber.
  </p>
</div>

<style>
  .hub { display: flex; flex-direction: column; gap: 10px; }
  header { text-align: center; }
  h2 { margin: 0; font-size: 1.4rem; line-height: 1.2; font-weight: 800; }
  header p { margin: 0; font-size: 0.85rem; }
  /* Tres columnas: los seis juegos caben en dos filas y todo el menú entra sin deslizar en un móvil. */
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .tile {
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 10px 12px; text-align: left;
    min-height: 112px; transition: transform 0.12s, border-color 0.2s; animation: fadeUp 0.35s ease both;
  }
  .tag { display: none; }
  @media (min-width: 520px) { .tag { display: block; } .tile { min-height: 132px; } }
  .tile:not(:disabled):active { transform: scale(0.97); }
  .tile:not(:disabled) { border-color: var(--gold-lo); }
  .tile:disabled { opacity: 0.75; }
  .ico { width: 44px; height: 44px; display: grid; place-items: center; transition: transform 0.25s ease; }
  .tile:not(:disabled):hover .ico, .tile:not(:disabled):focus-visible .ico { transform: scale(1.06); }
  .name { font-family: var(--font-display); font-weight: 700; font-size: 0.82rem; line-height: 1.2; color: var(--gold-hi); margin-top: 4px; letter-spacing: -0.01em; }
  .tag { font-size: 0.74rem; color: var(--muted); line-height: 1.3; }

  .box { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
  @media (max-height: 760px) { .soft small, .lv small { display: none; } }
  /* Móviles muy bajos: la pestaña ya dice "Fiesta", así que se quita el título para ganar sitio. */
  @media (max-height: 620px) { header { display: none; } .tile { min-height: 96px; } .box { padding: 10px; gap: 8px; } }
  h3 { margin: 0; font-size: 0.78rem; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); font-weight: 700; }
  .levels { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .lv {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 8px 4px; min-height: 64px; border-radius: 14px;
    border: 1px solid var(--line); text-align: center;
  }
  .lv.on { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.14); }
  .lv:disabled:not(.on) { opacity: 0.5; }
  .fl { display: inline-flex; }
  .lv b { font-size: 0.85rem; color: var(--gold-hi); }
  .lv small { font-size: 0.64rem; color: var(--muted); line-height: 1.2; }
  .soft { display: flex; gap: 12px; align-items: flex-start; }
  .soft input {
    appearance: none; -webkit-appearance: none; position: relative; flex: none; width: 46px; height: 28px; margin: 2px 0 0; border-radius: 99px;
    background: rgba(255, 255, 255, 0.1); border: 1px solid var(--line); transition: background 0.2s;
  }
  .soft input::after {
    content: ''; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: var(--muted);
    transition: transform 0.2s, background 0.2s;
  }
  .soft input:checked { background: var(--gold-grad); border-color: transparent; }
  .soft input:checked::after { transform: translateX(18px); background: var(--on-accent); }
  .soft input:disabled { opacity: 0.6; }
  .soft span { display: flex; flex-direction: column; gap: 2px; }
  .soft b { font-size: 0.92rem; }
  .soft small { font-size: 0.74rem; color: var(--muted); line-height: 1.35; }

  .rank { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .rank li { display: grid; grid-template-columns: 22px 26px 64px 1fr 24px; align-items: center; gap: 8px; font-size: 0.85rem; }
  .pos { display: grid; place-items: center; color: var(--gold-hi); font-weight: 700; }
  .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar { height: 8px; border-radius: 99px; background: rgba(255, 255, 255, 0.07); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: inherit; background: var(--gold-grad); }
  .rank b { text-align: right; color: var(--gold-hi); }
  .care { margin: 4px 6px 0; text-align: center; font-size: 0.72rem; line-height: 1.5; }
</style>
