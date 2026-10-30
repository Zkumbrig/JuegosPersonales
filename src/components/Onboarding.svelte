<script lang="ts">
  // Tutorial de 5 pasos que se muestra antes de la pantalla de nombre la primera vez (y cuando se pide desde «¿Cómo funciona?»).
  // Cada paso lleva una miniatura del botón o la zona real de la app para saber dónde buscarla.
  let { ondone }: { ondone: () => void } = $props();
  let step = $state(0);

  const STEPS = [
    { title: 'Crea tu mesa', text: 'Escribe tu nombre y pulsa «Crear mesa nueva». Tú serás el anfitrión: quien lleva la mesa.', mock: 'create' },
    { title: 'Tu código está arriba', text: 'Al entrar verás un código de 4 letras arriba a la izquierda, junto a «Mesa». Tócalo para abrir la ventana de la mesa.', mock: 'code' },
    { title: 'Invita a tus amigos', text: 'En esa ventana, «Invitar» manda el enlace por WhatsApp u otra app y «Código QR» lo muestra para escanearlo. También pueden escribir el código en «Únete a una» de la portada.', mock: 'invite' },
    { title: 'Elige qué jugar', text: 'Arriba hay tres zonas: Casino (cartas y ruleta), Fiesta (juegos para reír y beber) y Ludo. Cambias de zona cuando quieras.', mock: 'zones' },
    { title: '¿Tienes una tele? (opcional)', text: 'En la ventana de la mesa pulsa «Pantalla grande (TV)», copia el enlace y ábrelo en la tele o la laptop. Verá la mesa en grande, sin las cartas privadas.', mock: 'tv' },
  ] as const;

  function next() {
    if (step < STEPS.length - 1) step++;
    else ondone();
  }
  const s = $derived(STEPS[step]!);
</script>

<section class="tour" aria-label="Cómo funciona">
  <div class="dots" aria-hidden="true">
    {#each STEPS as _, i}<span class:on={i === step} class:past={i < step}></span>{/each}
  </div>
  <p class="count muted">Paso {step + 1} de {STEPS.length}</p>

  {#key step}
    <div class="card panel">
      <div class="mock" aria-hidden="true">
        {#if s.mock === 'create'}
          <div class="field">Tu nombre</div>
          <div class="fakebtn hot">Crear mesa nueva</div>
        {:else if s.mock === 'code'}
          <div class="bar">
            <span class="hot code"><small>MESA</small> <b class="display">HQSZ</b></span>
            <span class="spacer"></span>
            <span class="dot"></span><span class="dot"></span>
          </div>
          <p class="hint">↑ Toca aquí</p>
        {:else if s.mock === 'invite'}
          <div class="two">
            <div class="fakebtn hot">Invitar</div>
            <div class="fakebtn hot">Código QR</div>
          </div>
          <p class="hint">o en la portada: <b>Únete a una</b> → código</p>
        {:else if s.mock === 'zones'}
          <div class="zones">
            <span>Casino</span><span class="on">Fiesta</span><span>Ludo</span>
          </div>
        {:else}
          <div class="fakebtn hot wide">Pantalla grande (TV)</div>
        {/if}
      </div>
      <h2 class="display">{s.title}</h2>
      <p class="text">{s.text}</p>
    </div>
  {/key}

  <div class="row">
    <button class="skip" onclick={ondone}>Saltar</button>
    <button class="btn btn-gold" onclick={next}>{step < STEPS.length - 1 ? 'Siguiente' : '¡A jugar!'}</button>
  </div>
</section>

<style>
  .tour { display: grid; gap: 14px; animation: fadeUp 0.4s ease both; }
  .dots { display: flex; justify-content: center; gap: 8px; }
  .dots span { width: 8px; height: 8px; border-radius: 50%; background: var(--line); transition: background 0.2s, transform 0.2s; }
  .dots span.past { background: var(--gold-lo); }
  .dots span.on { background: var(--gold); transform: scale(1.3); }
  .count { margin: 0; text-align: center; font-size: 0.85rem; }
  .card { padding: 16px; display: grid; gap: 8px; animation: fadeUp 0.3s ease both; align-content: start; }
  @media (min-height: 760px) { .card { min-height: 320px; padding: 18px; gap: 10px; } }
  h2 { margin: 4px 0 0; font-size: 1.3rem; font-weight: 600; }
  .text { margin: 0; font-size: 1.02rem; line-height: 1.5; }
  /* Los botones se quedan pegados abajo: siempre a mano aunque el texto de un paso sea largo. */
  .row { position: sticky; bottom: calc(8px + var(--safe-b)); z-index: 2; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 0; }
  .skip { min-height: 44px; padding: 0 12px; color: var(--muted); font-size: 0.95rem; }
  .row .btn { min-width: 150px; }

  /* Miniaturas: imitan los botones reales y marcan en ámbar el que hay que buscar. */
  .mock { display: grid; gap: 8px; padding: 12px; border-radius: 14px; background: rgba(0, 0, 0, 0.28); border: 1px dashed var(--line); min-height: 96px; align-content: center; justify-items: center; }
  .field { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--line); background: rgba(0, 0, 0, 0.3); color: var(--muted); font-size: 0.95rem; }
  .fakebtn { padding: 12px 18px; border-radius: 999px; border: 1px solid var(--line); font-size: 0.9rem; font-weight: 600; text-align: center; }
  .fakebtn.wide { width: 100%; }
  .hot { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.16); color: var(--gold-hi); box-shadow: 0 0 0 3px rgb(var(--accent-rgb) / 0.18); }
  .fakebtn.hot { animation: nudge 1.8s ease-in-out infinite; }
  .two { display: flex; gap: 10px; width: 100%; }
  .two .fakebtn { flex: 1; }
  .bar { display: flex; align-items: center; gap: 10px; width: 100%; }
  .bar .code { padding: 6px 14px; border-radius: 12px; border: 1px solid var(--gold); display: inline-flex; align-items: baseline; gap: 8px; }
  .bar small { letter-spacing: 0.15em; font-size: 0.7rem; }
  .bar b { font-size: 1.3rem; }
  .spacer { flex: 1; }
  .dot { width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--line); }
  .hint { margin: 0; font-size: 0.9rem; color: var(--gold-hi); }
  .zones { display: flex; gap: 8px; width: 100%; }
  .zones span { flex: 1; text-align: center; padding: 11px 6px; border-radius: 14px; border: 1px solid var(--line); font-size: 0.9rem; font-weight: 600; }
  .zones .on { border-color: var(--gold); background: rgb(var(--accent-rgb) / 0.16); color: var(--gold-hi); }
  @media (max-height: 740px) {
    .tour { gap: 8px; }
    .text { font-size: 0.95rem; line-height: 1.4; }
    h2 { font-size: 1.15rem; }
    .count { display: none; }
  }
  @keyframes nudge { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.04); } }
</style>
