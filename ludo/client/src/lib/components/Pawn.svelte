<script lang="ts">
  // Un peón dentro del SVG del tablero. La posición se anima con una transición CSS de transform.
  type Props = {
    x: number;
    y: number;
    color: string;
    scale?: number;
    /** Progreso actual: al volver a casa (0) la transición es más lenta y vistosa. */
    p: number;
    movable?: boolean;
    popped?: boolean;
    label: string;
    onpick?: () => void;
    onhover?: (on: boolean) => void;
  };
  let { x, y, color, scale = 1, p, movable = false, popped = false, label, onpick, onhover }: Props = $props();

  function key(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onpick?.();
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<g
  class="pawn"
  class:movable
  class:popped
  style:transform="translate({x}px, {y - 0.06}px)"
  style:transition-duration={p === 0 ? '420ms' : '150ms'}
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
    <circle class="ring" r="0.62" cy="0.06" />
    <circle r="0.62" cy="0.06" fill="transparent" />
  {/if}
  <g transform="scale({scale})">
    <ellipse cx="0" cy="0.34" rx="0.34" ry="0.12" fill="rgba(0,0,0,.28)" />
    <path
      d="M -0.31 0.3 Q -0.31 0.02 -0.11 -0.06 L 0.11 -0.06 Q 0.31 0.02 0.31 0.3 Z"
      fill={color}
      stroke="color-mix(in srgb, {color} 55%, #000)"
      stroke-width="0.07"
      stroke-linejoin="round"
    />
    <circle cx="0" cy="-0.2" r="0.2" fill={color} stroke="color-mix(in srgb, {color} 55%, #000)" stroke-width="0.07" />
    <circle cx="-0.07" cy="-0.27" r="0.055" fill="#fff" opacity="0.6" />
  </g>
</g>

<style>
  .pawn {
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.3, 0.7, 0.3, 1);
    outline: none;
  }
  .movable {
    cursor: pointer;
  }
  .ring {
    fill: color-mix(in srgb, var(--c) 25%, transparent);
    stroke: #fff;
    stroke-width: 0.09;
    transform-box: fill-box;
    transform-origin: center;
    animation: pulse 0.9s ease-in-out infinite;
  }
  .movable:focus-visible .ring,
  .movable:hover .ring {
    stroke: #ffc933;
  }
  .popped {
    animation: pop 0.45s ease-out;
  }
  @keyframes pulse {
    0%, 100% { transform: scale(0.92); opacity: 0.7; }
    50% { transform: scale(1.12); opacity: 1; }
  }
  @keyframes pop {
    0% { opacity: 1; }
    40% { opacity: 0.2; }
    100% { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .ring, .popped { animation: none; }
  }
</style>
