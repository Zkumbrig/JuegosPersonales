<script lang="ts">
  // Icono de intensidad (1 Suave, 2 Picante, 3 Extremo). Un glifo distinto por nivel, en línea fina y un toque de color:
  // un cubo de hielo para romper el hielo, una cerilla encendida y una calavera para los valientes.
  let { n, size = 14 }: { n: number; size?: number } = $props();
  const px = $derived(Math.round(size * 1.5));
</script>

<span class="lv" class:hot={n === 3} role="img" aria-label="Intensidad {n} de 3">
  <svg width={px} height={px} viewBox="0 0 24 24" aria-hidden="true">
    {#if n === 1}
      <!-- copo de nieve -->
      <path d="M12 2.5v19M3.8 7.25l16.4 9.5M20.2 7.25l-16.4 9.5" />
      <path d="M9.6 4.4L12 6.6l2.4-2.2M9.6 19.6L12 17.4l2.4 2.2" />
      <path d="M4.9 11.2l3.3.1.9-2.9M19.1 12.8l-3.3-.1-.9 2.9M4.9 12.8l3.3-.1.9 2.9M19.1 11.2l-3.3.1-.9-2.9" />
      <circle class="acc" cx="12" cy="12" r="1.8" />
    {:else if n === 2}
      <!-- chile -->
      <path class="acc" d="M15.4 5.6C19.4 8.4 18.4 15.4 9.6 19.6 6.6 21 4 20.6 3.4 19.4c4.2-1.2 6.4-5 7.8-9.8.8-2.6 2.4-4.4 4.2-4z" />
      <path d="M13 5.8c.8-1.6 2.6-2 4-1.2M17 4.6c.6-1.4 1.8-2.2 3.2-2.1" />
    {:else}
      <path d="M12 3C7.6 3 5 6 5 9.8c0 2.4 1 4 2.5 5.1V18h9v-3.1c1.5-1.1 2.5-2.7 2.5-5.1C19 6 16.4 3 12 3z" />
      <circle class="acc" cx="9" cy="10" r="2" />
      <circle class="acc" cx="15" cy="10" r="2" />
      <path d="M12 12.6l-1 2h2zM10 18v2.6M12 18v2.6M14 18v2.6" />
    {/if}
  </svg>
</span>

<style>
  .lv { display: inline-flex; color: var(--gold-hi); }
  svg { display: block; overflow: visible; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .acc { fill: var(--gold); stroke: var(--gold); }
  .hot .acc { fill: var(--pop); stroke: var(--pop); }
</style>
