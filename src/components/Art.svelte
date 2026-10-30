<script lang="ts">
  // Ilustraciones de los juegos de fiesta. Estilo adulto: línea fina, formas geométricas y un solo toque de color (el acento).
  // Sin caras ni dibujos de caricatura. Usan los colores del estilo activo.
  let { name, size = 52 }: { name: string; size?: number } = $props();
</script>

<svg class="art" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
  {#if name === 'never'}
    <!-- Yo nunca: ojo de cerradura (un secreto) -->
    <circle class="w" cx="24" cy="24" r="19" />
    <circle class="a" cx="24" cy="20" r="4.6" />
    <path class="a" d="M21.6 23.6L19.6 34h8.8l-2-10.4z" />
    <path d="M24 2.5v3M24 42.5v3M2.5 24h3M42.5 24h3" />
  {:else if name === 'likely'}
    <!-- ¿Quién es más probable?: foco sobre una silueta -->
    <path d="M18 3h12" />
    <path class="w" d="M19 5h10l9 34H10z" />
    <circle class="a" cx="24" cy="25" r="4.4" />
    <path d="M15 40c0-6 3.8-9.4 9-9.4s9 3.4 9 9.4" />
    <path d="M7 43.5h34" />
  {:else if name === 'would'}
    <!-- Preferirías: una bifurcación, dos caminos -->
    <path d="M24 44V29" />
    <path d="M24 29L12 16M24 29l12-13" />
    <path d="M12 24v-8h8M28 16h8v8" />
    <circle class="w" cx="12" cy="9" r="4.2" />
    <circle class="a" cx="36" cy="9" r="4.2" />
  {:else if name === 'truth'}
    <!-- Verdad o reto: antifaz -->
    <path class="w" d="M4 19c0-5 6-7 20-3 14-4 20-2 20 3 0 11-8 15-14 11-3-2-4-4-6-4s-3 2-6 4C12 34 4 30 4 19z" />
    <ellipse class="a" cx="14" cy="22" rx="4.6" ry="2.7" transform="rotate(-14 14 22)" />
    <ellipse class="a" cx="34" cy="22" rx="4.6" ry="2.7" transform="rotate(14 34 22)" />
  {:else if name === 'reflex'}
    <!-- Duelo de reflejos: cronómetro -->
    <path d="M19 4.5h10M24 4.5V12" />
    <circle class="w" cx="24" cy="28" r="15.5" />
    <path d="M24 14.5v2.5M24 39.5V42M10.5 28H13M35 28h2.5" />
    <path class="as" d="M24 28l7-8" />
    <path class="as" d="M24 12.5A15.5 15.5 0 0 1 39.5 28" />
    <circle class="a" cx="24" cy="28" r="2.4" />
  {:else if name === 'kings'}
    <!-- Rey de copas: corona -->
    <path class="w" d="M6 36L4 16l11 9 9-15 9 15 11-9-2 20z" />
    <path d="M6 41.5h36" />
    <circle class="a" cx="4" cy="15.5" r="2.4" />
    <circle class="a" cx="24" cy="9.5" r="2.4" />
    <circle class="a" cx="44" cy="15.5" r="2.4" />
    <path class="a" d="M24 27l4 4.2-4 4.2-4-4.2z" />
  {/if}
</svg>

<style>
  .art { flex: none; display: block; overflow: visible; fill: none; stroke: var(--gold-hi); stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }
  .w { fill: rgb(var(--accent-rgb) / 0.14); }
  .a { fill: var(--gold); stroke: var(--gold); }
  .as { stroke: var(--gold); stroke-width: 2.4; }
</style>
