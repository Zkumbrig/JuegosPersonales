<script lang="ts">
  import Logo from './Logo.svelte';

  let { onconfirm }: { onconfirm: () => void } = $props();
  let denied = $state(false);
</script>

<main class="gate">
  <div class="seal" aria-hidden="true">18+</div>
  <h1><Logo size={1.2} /></h1>
  {#if !denied}
    <p class="lead">Tu noche de juegos en una sola mesa.<br />Solo para mayores de 18 años.</p>
    <p class="small muted">
      Aquí se juega con <strong>fichas virtuales</strong>: no hay dinero real, ni premios, ni anuncios.
      Juega con responsabilidad y, si bebes, hazlo con moderación.
    </p>
    <div class="actions">
      <button class="btn btn-gold" onclick={onconfirm}>Tengo 18 años o más</button>
      <button class="btn btn-ghost" onclick={() => (denied = true)}>Soy menor de edad</button>
    </div>
  {:else}
    <p class="lead">Lo sentimos, este sitio es solo para adultos.</p>
    <p class="small muted">Vuelve cuando cumplas 18 años.</p>
    <button class="btn btn-ghost" onclick={() => (denied = false)}>Volver</button>
  {/if}
</main>

<style>
  .gate {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    gap: 14px;
    padding: 32px 28px calc(32px + var(--safe-b));
    max-width: 460px;
    margin: 0 auto;
    animation: fadeUp 0.5s ease both;
  }
  .seal {
    width: 92px;
    height: 92px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    font-family: var(--font-display);
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--gold-hi);
    border: 2px solid var(--gold);
    box-shadow: 0 0 0 6px rgb(var(--accent-rgb) / 0.12), inset 0 0 18px rgb(var(--accent-rgb) / 0.2);
  }
  h1 { margin: 4px 0 4px; line-height: 1; }
  .lead { font-size: 1.15rem; margin: 0; line-height: 1.4; }
  .small { font-size: 0.88rem; line-height: 1.5; margin: 0; }
  .actions { display: flex; flex-direction: column; gap: 10px; width: 100%; margin-top: 12px; }
</style>
