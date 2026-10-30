<script lang="ts">
  import { untrack } from 'svelte';
  import { LEVELS, PARTY_GAMES, type PartyGame } from '../../shared/protocol';
  import { net } from '../lib/net.svelte';
  import { soften } from '../lib/party';
  import { sfx } from '../lib/sound.svelte';
  import { vibrate } from '../lib/format';
  import Avatar from './Avatar.svelte';
  import Icon from './Icon.svelte';
  import Flames from './Flames.svelte';
  import PlayingCard from './PlayingCard.svelte';
  import Reflex from './Reflex.svelte';
  import Quip from './Quip.svelte';
  import Ambient from './Ambient.svelte';

  const pa = $derived(net.room!.party);
  const game = $derived(net.room!.game as PartyGame);
  const info = $derived(PARTY_GAMES.find((g) => g.id === game)!);
  const level = $derived(LEVELS.find((l) => l.id === pa.level)!);
  const players = $derived(net.room!.players);
  const live = $derived(players.filter((p) => p.connected));
  const isHost = $derived(!!net.me?.host);
  const imTarget = $derived(pa.target === net.pid);
  const iDrink = $derived((pa.phase === 'reveal' || pa.phase === 'done') && pa.drinkers.includes(net.pid));
  const t = (s: string | null) => soften(s, pa.soft);
  const nameOf = (id: string) => (id === net.pid ? 'Tú' : (players.find((p) => p.id === id)?.name ?? '?'));
  const names = (ids: string[]) => ids.map(nameOf).join(', ');

  const send = (value: string) => { net.send({ t: 'pa:answer', value }); vibrate(10); };
  const next = () => net.send({ t: 'pa:next' });

  // Sonido al revelar / cuando me toca beber
  let lastKey = '';
  $effect(() => {
    const key = `${game}:${pa.round}:${pa.phase}`;
    const drink = iDrink;
    const phase = pa.phase;
    untrack(() => {
      if (key !== lastKey && (phase === 'reveal' || phase === 'done')) { drink ? (sfx.drink(), vibrate(120)) : sfx.stop(); }
      if (key !== lastKey && phase === 'asking') sfx.card();
      lastKey = key;
    });
  });

  // Reparto de votos para ¿Quién es más probable? / Preferirías
  const votes = $derived.by(() => {
    const m = new Map<string, string[]>();
    for (const [voter, pick] of Object.entries(pa.picks ?? {})) m.set(pick, [...(m.get(pick) ?? []), voter]);
    return m;
  });
  const likelyRows = $derived(
    players.map((p) => ({ id: p.id, n: votes.get(p.id)?.length ?? 0 })).sort((a, b) => b.n - a.n),
  );
  const topVotes = $derived(Math.max(1, ...likelyRows.map((r) => r.n)));
  const wouldA = $derived(votes.get('A') ?? []);
  const wouldB = $derived(votes.get('B') ?? []);
  const wouldTotal = $derived(Math.max(1, wouldA.length + wouldB.length));

  // Color de ambiente: un tono suave propio de cada juego y, al revelar, una ola de color según el resultado
  // (coral si alguien bebe, verde azulado si se salva la mesa). Solo opacidad y escala: no pesa.
  const TONES: Record<string, string> = { never: 'var(--pop)', likely: 'var(--gold)', would: 'var(--felt-hi)', truth: 'var(--back-1)', kings: 'var(--gold-lo)' };
  const tone = $derived(TONES[game] ?? 'transparent');
  const revealed = $derived(game !== 'reflex' && (pa.phase === 'reveal' || pa.phase === 'done'));
  const washColor = $derived(pa.drinkers.length ? 'var(--pop)' : 'var(--felt-hi)');
</script>

<Ambient {tone} toneKey={game} washColor={revealed ? washColor : null} washKey={`${game}:${pa.round}:${pa.phase}`} strong={iDrink} />

<div class="wrap">
  <header class="topbar">
    {#if isHost}
      <button class="back" onclick={() => net.send({ t: 'game', game: 'party' })}><Icon name="back" size={16} /> Fiesta</button>
    {:else}
      <span class="back ghost">Fiesta</span>
    {/if}
    <span class="title"><Icon name={info.icon} size={20} /> {info.name}</span>
    <span class="lvl" title={level.name}><Flames n={level.flames} size={14} /></span>
  </header>

  {#if game === 'reflex'}
    <Reflex />
  {:else}
    {#if iDrink}
      <div class="banner" role="status"><Icon name={pa.soft ? 'minus' : 'drink'} size={20} /> {pa.soft ? 'Pierdes un punto' : '¡Te toca beber!'}</div>
    {/if}

    <!-- ===================== Yo nunca ===================== -->
    {#if game === 'never'}
      {#if pa.phase === 'idle'}
        {@render intro('Cada uno responde en secreto y a la vez. Quien lo haya hecho, bebe.')}
      {:else}
        {@render card('Yo nunca', t(pa.prompt))}
        {#if pa.phase === 'asking'}
          <div class="two">
            <button class="big yes" class:on={pa.mine === 'yes'} onclick={() => send('yes')}><Icon name="drink" size={22} /> Yo sí</button>
            <button class="big no" class:on={pa.mine === 'no'} onclick={() => send('no')}><Icon name="ban" size={22} /> Yo no</button>
          </div>
          {@render roster()}
        {:else}
          <section class="panel verdict">
            {#if pa.drinkers.length}
              <h3 class="display">{pa.soft ? 'Pierden un punto' : '¡Beben!'}</h3>
              <p class="who">{names(pa.drinkers)}</p>
            {:else}
              <h3 class="display">Nadie lo ha hecho</h3>
              <p class="muted">Qué santos son… o qué mentirosos.</p>
            {/if}
          </section>
        {/if}
      {/if}

    <!-- ===================== ¿Quién es más probable? ===================== -->
    {:else if game === 'likely'}
      {#if pa.phase === 'idle'}
        {@render intro('Todos votan en secreto a la persona que mejor encaja. El más votado bebe.')}
      {:else}
        {@render card('¿Quién es más probable?', t(pa.prompt)?.replace(/^¿Quién es más probable que /, 'Que ') ?? '')}
        {#if pa.phase === 'asking'}
          <div class="votes">
            {#each players as p (p.id)}
              <button class="vote" class:on={pa.mine === p.id} onclick={() => send(p.id)}>
                <Avatar id={p.id} size={36} />
                <span>{nameOf(p.id)}</span>
              </button>
            {/each}
          </div>
          {@render roster()}
        {:else}
          <section class="panel bars">
            {#each likelyRows as r (r.id)}
              <div class="row" class:hot={pa.drinkers.includes(r.id)}>
                <Avatar id={r.id} size={28} />
                <span class="nm">{nameOf(r.id)}</span>
                <span class="bar"><i style="width:{(r.n / topVotes) * 100}%"></i></span>
                <b class="num">{r.n}{#if pa.drinkers.includes(r.id)}{#if pa.soft} −1{:else} <Icon name="drink" size={15} />{/if}{/if}</b>
              </div>
            {/each}
          </section>
        {/if}
      {/if}

    <!-- ===================== Preferirías… ===================== -->
    {:else if game === 'would'}
      {#if pa.phase === 'idle'}
        {@render intro('Elige una de las dos opciones. La minoría bebe; si hay empate, brindan.')}
      {:else if pa.options}
        <div class="options">
          {#each [['A', pa.options[0], wouldA], ['B', pa.options[1], wouldB]] as const as [key, text, who] (key)}
            <button
              class="opt panel"
              class:on={pa.mine === key}
              class:lose={pa.phase === 'reveal' && pa.drinkers.length > 0 && who.some((id) => pa.drinkers.includes(id))}
              disabled={pa.phase !== 'asking'}
              onclick={() => send(key)}
            >
              <span class="letter">{key}</span>
              <span class="txt">{t(text)}</span>
              {#if pa.phase === 'reveal'}
                <span class="pct num">{Math.round((who.length / wouldTotal) * 100)}%</span>
                <span class="whom">{who.length ? names(who) : '—'}</span>
              {/if}
            </button>
          {/each}
        </div>
        {#if pa.phase === 'asking'}
          {@render roster()}
        {:else}
          <section class="panel verdict">
            {#if pa.drinkers.length}
              <h3 class="display">{pa.soft ? 'La minoría pierde un punto' : 'La minoría bebe'}</h3>
              <p class="who">{names(pa.drinkers)}</p>
            {:else}
              <h3 class="display">{wouldA.length === wouldB.length ? '¡Empate!' : '¡Unanimidad!'}</h3>
              <p class="muted">{wouldA.length === wouldB.length ? 'Nadie bebe… brinden.' : 'Nadie es minoría. Brinden.'}</p>
            {/if}
          </section>
        {/if}
      {/if}

    <!-- ===================== Verdad o reto ===================== -->
    {:else if game === 'truth'}
      {#if pa.phase === 'idle'}
        {@render intro('Cada turno hay una persona en el centro. Elige verdad o reto y el grupo lo ve a la vez. Si no quiere cumplirlo, bebe.')}
      {:else}
        <section class="panel spot">
          <Avatar id={pa.target ?? ''} size={44} />
          <div>
            <small class="muted">En el centro</small>
            <b class="display">{pa.target ? nameOf(pa.target) : '…'}</b>
          </div>
        </section>
        {#if pa.phase === 'choose'}
          {#if imTarget}
            <div class="two">
              <button class="big yes" onclick={() => send('truth')}><Icon name="truth" size={22} /> Verdad</button>
              <button class="big no" onclick={() => send('dare')}><Icon name="flame" size={22} /> Reto</button>
            </div>
          {:else}
            <p class="muted center">{nameOf(pa.target ?? '')} está eligiendo…</p>
          {/if}
        {:else}
          {@render card(pa.kind === 'truth' ? 'Verdad' : 'Reto', t(pa.prompt))}
          {#if pa.phase === 'prompt'}
            {#if imTarget}
              <div class="two">
                <button class="big yes" onclick={() => send('done')}><Icon name="check" size={22} /> Cumplido</button>
                <button class="big no" onclick={() => send('drink')}><Icon name={pa.soft ? 'minus' : 'drink'} size={22} /> {pa.soft ? 'Paso (−1)' : 'Paso y bebo'}</button>
              </div>
            {:else}
              <p class="muted center">Esperando a que {nameOf(pa.target ?? '')} responda…</p>
            {/if}
          {:else}
            <section class="panel verdict">
              <h3 class="display"><Icon name={pa.resolved === 'drink' ? (pa.soft ? 'minus' : 'drink') : 'check'} size={22} /> {pa.resolved === 'drink' ? (pa.soft ? 'Prefirió perder un punto' : 'Prefirió beber') : 'Lo cumplió'}</h3>
            </section>
          {/if}
        {/if}
      {/if}

    <!-- ===================== Rey de copas ===================== -->
    {:else if game === 'kings'}
      {#if pa.phase === 'idle'}
        {@render intro('Por turnos, cada persona saca una carta y toca cumplir su regla. Con el cuarto Rey, ¡al fondo!')}
      {:else}
        <section class="panel spot">
          <Avatar id={pa.target ?? ''} size={44} />
          <div>
            <small class="muted">Turno de</small>
            <b class="display">{pa.target ? nameOf(pa.target) : '…'}</b>
          </div>
          <span class="kings" title="Reyes sacados">{#each [1, 2, 3, 4] as i (i)}<span class:dim={i > pa.kings}><Icon name="kings" size={17} /></span>{/each}</span>
        </section>
        {#if pa.card && pa.phase === 'prompt'}
          <section class="panel kingcard">
            <div class="cardbox"><PlayingCard card={pa.card} /></div>
            <h3 class="display">{pa.prompt}</h3>
            <p>{t(pa.rule)}</p>
          </section>
        {:else}
          <p class="muted center">{imTarget ? 'Es tu turno: saca una carta' : `Le toca a ${nameOf(pa.target ?? '')}`}</p>
        {/if}
      {/if}
    {/if}

    {#if pa.quip && (pa.phase === 'reveal' || pa.phase === 'done')}
      <Quip text={t(pa.quip)} />
    {/if}

    <!-- ===================== Controles comunes ===================== -->
    <div class="controls">
      {#if pa.phase === 'idle'}
        {#if isHost}<button class="btn btn-gold" onclick={next}>Empezar</button>{:else}<p class="muted center">Esperando al anfitrión…</p>{/if}
      {:else if (game === 'never' || game === 'likely' || game === 'would') && pa.phase === 'asking'}
        {#if isHost}<button class="btn btn-ghost" disabled={pa.answered.length === 0} onclick={() => net.send({ t: 'pa:reveal' })}>Revelar ya</button>{/if}
      {:else if game === 'kings'}
        {#if imTarget || isHost}
          <button class="btn btn-gold" onclick={next}>{pa.phase === 'ready' ? 'Sacar carta' : 'Siguiente turno'}</button>
        {/if}
      {:else if game === 'truth'}
        {#if pa.phase === 'done' && (imTarget || isHost)}
          <button class="btn btn-gold" onclick={next}>Siguiente jugador</button>
        {:else if isHost && (pa.phase === 'choose' || pa.phase === 'prompt')}
          <button class="btn btn-ghost small" onclick={next}>Saltar turno</button>
        {/if}
      {:else if isHost}
        <button class="btn btn-gold" onclick={next}>Siguiente</button>
      {/if}
    </div>
  {/if}
</div>

{#snippet intro(text: string)}
  <section class="panel intro">
    <p class="display lead">{info.name}</p>
    <p class="muted">{t(text)}</p>
  </section>
{/snippet}

{#snippet card(kicker: string, text: string)}
  {#key `${pa.round}-${text}`}
    <section class="card ticket">
      <span class="kicker">{kicker} · <Flames n={level.flames} size={12} /></span>
      <p class="prompt">{text}</p>
    </section>
  {/key}
{/snippet}

{#snippet roster()}
  <div class="roster">
    <ul>
      {#each live as p (p.id)}
        <li class:ok={pa.answered.includes(p.id)} title={nameOf(p.id)}><Avatar id={p.id} size={30} /></li>
      {/each}
    </ul>
    <small class="muted">{pa.answered.length}/{live.length} han respondido</small>
  </div>
{/snippet}

<style>
  .wrap { display: flex; flex-direction: column; gap: 12px; }
  .topbar { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
  .back { justify-self: start; display: inline-flex; align-items: center; gap: 4px; font-size: 0.78rem; color: var(--gold-hi); min-height: 44px; padding: 6px 10px 6px 2px; }
  .back.ghost { color: var(--muted); }
  .title { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-display); font-weight: 700; font-size: 0.82rem; color: var(--gold-hi); text-align: center; }
  .lvl { justify-self: end; font-size: 0.9rem; }

  .banner {
    display: flex; align-items: center; justify-content: center; gap: 10px; font-family: var(--font-display); font-size: 0.8rem;
    text-align: center; padding: 10px; border-radius: 14px; font-weight: 800; letter-spacing: 0.03em;
    background: var(--gold-grad); color: var(--on-accent); animation: fadeUp 0.25s ease both;
  }
  .intro { padding: 22px 18px; text-align: center; }
  .lead { margin: 0 0 8px; font-size: 1.3rem; font-weight: 800; color: var(--gold-hi); }
  .intro p { margin: 0; line-height: 1.5; }

  .card {
    padding: 26px 20px 28px; border-radius: 22px; text-align: center; animation: fadeUp 0.35s ease both;
    background: linear-gradient(160deg, rgb(var(--accent-rgb) / 0.12), rgba(0, 0, 0, 0.25)), var(--panel);
    border: 1.5px solid var(--gold-lo); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .kicker { display: inline-flex; align-items: center; gap: 8px; font-family: var(--font-display); font-size: 0.6rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--gold); margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1.5px dashed var(--gold-lo); }
  .prompt { margin: 0; font-family: var(--font-display); font-weight: 600; font-size: 1.12rem; line-height: 1.4; letter-spacing: -0.01em; text-wrap: balance; }

  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .big {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px; font-family: var(--font-display); letter-spacing: 0.01em;
    min-height: 66px; border-radius: 18px; font-weight: 700; font-size: 0.8rem; border: 1.5px solid var(--line);
    background: rgba(255, 255, 255, 0.04); transition: transform 0.1s, border-color 0.15s, background 0.15s;
  }
  .big:active { transform: scale(0.97); }
  .big.on { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.2); color: var(--gold-hi); }

  .roster { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .roster ul { display: flex; gap: 10px; list-style: none; margin: 0; padding: 0; }
  .roster li { padding: 3px; border-radius: 50%; opacity: 0.4; }
  .roster li.ok { opacity: 1; box-shadow: 0 0 0 2px var(--ok); }

  .verdict { padding: 16px; text-align: center; animation: fadeUp 0.3s ease both; }
  .verdict h3 { margin: 0; display: inline-flex; align-items: center; gap: 10px; font-size: 1.1rem; font-weight: 800; color: var(--gold-hi); }
  .verdict p { margin: 6px 0 0; }
  .who { font-weight: 700; font-size: 1.05rem; }

  .votes { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .vote {
    display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 16px; text-align: left;
    border: 1.5px solid var(--line); background: rgba(255, 255, 255, 0.04);
  }
  .vote.on { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.2); }
  .vote span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }

  .bars { padding: 12px; display: grid; gap: 8px; }
  .row { display: grid; grid-template-columns: 28px 70px 1fr auto; align-items: center; gap: 8px; font-size: 0.88rem; }
  .row.hot .nm { color: var(--gold-hi); font-weight: 800; }
  .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar { height: 10px; border-radius: 99px; background: rgba(255, 255, 255, 0.07); overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: inherit; background: var(--gold-grad); transition: width 0.5s ease; }
  .row b { min-width: 34px; text-align: right; }

  .options { display: grid; gap: 10px; }
  .opt { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 4px 12px; padding: 16px; text-align: left; border-width: 1.5px; }
  .opt.on { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.16); }
  .opt.lose { opacity: 0.75; }
  .opt:disabled { cursor: default; }
  .letter { font-family: var(--font-display); width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font-weight: 800; background: var(--gold-grad); color: var(--on-accent); grid-row: 1 / 3; }
  .txt { font-family: var(--font-display); font-weight: 600; font-size: 0.95rem; line-height: 1.35; }
  .pct { font-weight: 800; color: var(--gold-hi); grid-row: 1 / 3; grid-column: 3; }
  .whom { font-size: 0.74rem; color: var(--muted); grid-column: 2; }

  .spot { display: flex; align-items: center; gap: 12px; padding: 12px 14px; }
  .spot div { display: flex; flex-direction: column; line-height: 1.15; flex: 1; }
  .spot b { font-size: 1.05rem; color: var(--gold-hi); }
  .kings { display: inline-flex; gap: 3px; color: var(--gold-hi); }
  .dim { opacity: 0.25; }
  .kingcard { padding: 18px 16px; text-align: center; display: grid; gap: 8px; justify-items: center; animation: fadeUp 0.3s ease both; }
  .kingcard .cardbox { --card-w: 74px; }
  .kingcard h3 { margin: 0; font-size: 1.15rem; font-weight: 800; color: var(--gold-hi); }
  .kingcard p { margin: 0; line-height: 1.45; }

  .controls { display: flex; flex-direction: column; gap: 8px; }
  .center { text-align: center; margin: 0; }
  .btn.small { min-height: 44px; font-size: 0.7rem; align-self: center; }

  /* Móviles bajos: se aprieta el espacio para que pregunta, respuesta y botón quepan sin deslizar. */
  @media (max-height: 740px) {
    .wrap { gap: 8px; }
    .kicker { margin-bottom: 8px; padding-bottom: 8px; }
    .verdict { padding: 10px; }
    .intro { padding: 16px 14px; }
    .big { min-height: 56px; }
    /* El botón de avanzar se queda pegado abajo: siempre a la vista aunque el resultado sea largo. */
    .controls { position: sticky; bottom: calc(8px + var(--safe-b)); z-index: 3; }
    .controls :global(.btn) { box-shadow: 0 4px 0 #b36a2c, 0 10px 22px rgba(0, 0, 0, 0.45); }
  }
</style>
