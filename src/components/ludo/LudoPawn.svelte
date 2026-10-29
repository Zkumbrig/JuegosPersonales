<script lang="ts">
  import { onMount } from 'svelte';
  // Peón dentro del SVG del tablero: el desplazamiento entre casillas es una transición de transform y
  // cada paso reinicia un saltito (squash & stretch) en un grupo interior. Todo transform/opacity.
  type Props = {
    uid: string;
    arm: number;
    x: number;
    y: number;
    color: string;
    scale?: number;
    /** Progreso actual: el salto cambia si vuelve a casa (0). */
    p: number;
    movable?: boolean;
    popped?: boolean;
    label: string;
    onpick?: () => void;
    onhover?: (on: boolean) => void;
  };
  let { uid, arm, x, y, color, scale = 1, p, movable = false, popped = false, label, onpick, onhover }: Props = $props();

  // El primer dibujado no salta: solo los cambios posteriores.
  // (objeto plano a propósito: no es reactivo, solo se lee al crear cada salto)
  const flags = { ready: false };
  onMount(() => { flags.ready = true; });

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onpick?.();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<g
  class="pawn essential-motion"
  class:movable
  style:transform="translate({x}px, {y}px)"
  style:transition-duration={p === 0 ? '520ms' : '250ms'}
  style:transition-timing-function={p === 0 ? 'cubic-bezier(0.3, 0.7, 0.3, 1)' : 'linear'}
  style:--c={color}
  role={movable ? 'button' : undefined}
  tabindex={movable ? 0 : undefined}
  aria-label={movable ? label : undefined}
  onclick={movable ? onpick : undefined}
  onkeydown={movable ? key : undefined}
  onpointerenter={() => onhover?.(true)}
  onpointerleave={() => onhover?.(false)}
  onfocus={() => onhover?.(true)}
  onblur={() => onhover?.(false)}
>
  {#if movable}
    <circle class="ring" r="0.66" cy="0.02" />
    <circle class="ring2" r="0.66" cy="0.02" />
    <circle r="0.7" cy="0.02" fill="transparent" />
  {/if}
  <ellipse class="gshadow" cx="0" cy="0.38" rx="0.36" ry="0.12" fill="rgba(0,0,0,.4)" />
  {#key p}
    <g class="hop" class:go={flags.ready && p !== 0} class:fly={flags.ready && p === 0} class:hit={popped}>
      <g transform="scale({scale})">
        <ellipse cx="0" cy="0.31" rx="0.33" ry="0.14" fill="url(#pw-{uid}-{arm})" stroke="rgba(0,0,0,.45)" stroke-width="0.04" />
        <path
          d="M -0.25 0.3 C -0.25 0.04 -0.12 -0.02 -0.1 -0.12 L 0.1 -0.12 C 0.12 -0.02 0.25 0.04 0.25 0.3 Z"
          fill="url(#pw-{uid}-{arm})"
          stroke="rgba(0,0,0,.45)"
          stroke-width="0.04"
          stroke-linejoin="round"
        />
        <circle cx="0" cy="-0.27" r="0.21" fill="url(#pw-{uid}-{arm})" stroke="rgba(0,0,0,.45)" stroke-width="0.04" />
        <ellipse cx="-0.08" cy="-0.35" rx="0.075" ry="0.045" fill="#fff" opacity="0.75" transform="rotate(-30 -0.08 -0.35)" />
        <path d="M -0.2 0.2 Q 0 0.26 0.2 0.2" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="0.035" stroke-linecap="round" />
      </g>
    </g>
  {/key}
</g>

<style>
  .pawn {
    transition-property: transform;
    outline: none;
  }
  .movable { cursor: pointer; }
  .hop { transform-box: fill-box; transform-origin: 50% 100%; }
  .hop.go { animation: hop 250ms cubic-bezier(0.3, 0.1, 0.5, 1); }
  .gshadow { animation: none; }
  .pawn:has(.hop.go) .gshadow { animation: shad 250ms ease-in-out; transform-box: fill-box; transform-origin: center; }
  .hop.fly { animation: fly 480ms cubic-bezier(0.3, 0.1, 0.3, 1); }
  .hop.hit { animation: hit 560ms ease-in-out; }
  .ring {
    fill: color-mix(in srgb, var(--c) 28%, transparent);
    stroke: var(--gold-hi);
    stroke-width: 0.09;
    transform-box: fill-box;
    transform-origin: center;
    animation: pulse 0.95s ease-in-out infinite;
  }
  .ring2 {
    fill: none;
    stroke: #fff;
    stroke-width: 0.05;
    opacity: 0.8;
  }
  .movable:hover .ring, .movable:focus-visible .ring { stroke: #fff; }
  @keyframes hop {
    0% { transform: translateY(0) scale(1, 1); }
    12% { transform: translateY(0) scale(1.12, 0.84); }
    45% { transform: translateY(-0.85px) scale(0.9, 1.14); }
    82% { transform: translateY(0) scale(1.14, 0.82); }
    92% { transform: translateY(0) scale(0.96, 1.05); }
    100% { transform: translateY(0) scale(1, 1); }
  }
  @keyframes shad { 0%, 100% { transform: scale(1); opacity: 1; } 45% { transform: scale(0.65); opacity: 0.5; } }
  @keyframes fly {
    0% { transform: translateY(0) scale(1) rotate(0); }
    45% { transform: translateY(-1.6px) scale(1.15) rotate(220deg); }
    100% { transform: translateY(0) scale(1) rotate(360deg); }
  }
  @keyframes hit {
    0%, 100% { transform: translateX(0) scale(1); opacity: 1; }
    15% { transform: translateX(-0.14px) scale(1.12); }
    30% { transform: translateX(0.14px) scale(1.12); opacity: 0.35; }
    45% { transform: translateX(-0.1px) scale(1.08); opacity: 1; }
    60% { transform: translateX(0.1px) scale(1.05); opacity: 0.4; }
    80% { transform: translateX(0) scale(1); opacity: 1; }
  }
  @keyframes pulse {
    0%, 100% { transform: scale(0.9); opacity: 0.65; }
    50% { transform: scale(1.12); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ring { animation: none; }
  }
</style>
