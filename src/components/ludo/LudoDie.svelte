<script lang="ts">
  // Dado 3D de verdad: un cubo de seis caras que rueda y cae sobre la cara que sacó el servidor.
  // Solo se anima transform (compositor), nada de sombras ni filtros en movimiento.
  type Props = {
    value: number | null;
    /** Cambia en cada tirada para repetir la animación. */
    rollId: number;
    rolling?: boolean;
    color?: string;
    /** Si es true es el botón de tirar. */
    active?: boolean;
    size?: number;
    onroll?: () => void;
  };
  let { value, rollId, rolling = false, color = '#d9b45a', active = false, size = 88, onroll }: Props = $props();

  // Giro del cubo que deja cada cara de frente.
  const FACE: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };
  const PIPS: Record<number, number[]> = {
    1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8],
  };
  const FACES: { n: number; t: string }[] = [
    { n: 1, t: 'rotateY(0deg)' },
    { n: 6, t: 'rotateY(180deg)' },
    { n: 3, t: 'rotateY(90deg)' },
    { n: 4, t: 'rotateY(-90deg)' },
    { n: 2, t: 'rotateX(90deg)' },
    { n: 5, t: 'rotateX(-90deg)' },
  ];

  let rx = $state(-18);
  let ry = $state(24);
  let animate = $state(false);
  let seen = -1;

  $effect(() => {
    const id = rollId;
    const v = value ?? 1;
    const [bx, by] = FACE[v] ?? FACE[1]!;
    if (seen === -1 || id === seen) {
      // Primera pintura (o mismo dado): se coloca sin girar.
      animate = false;
      rx = bx - 14;
      ry = by + 18;
    } else {
      animate = true;
      const spins = 2 + (id % 2);
      rx = Math.ceil(rx / 360) * 360 + 360 * spins + bx - 14;
      ry = Math.ceil(ry / 360) * 360 + 360 * (spins + 1) + by + 18;
    }
    seen = id;
  });
</script>

<div class="wrap" class:active style:--s="{size}px" style:--ring={color}>
  <span class="halo" aria-hidden="true"></span>
  <button class="stage" disabled={!active} onclick={onroll} aria-label={active ? 'Tirar el dado' : value ? `Dado: ${value}` : 'Dado'}>
    <span class="toss" class:ga={animate && rolling && rollId % 2 === 0} class:gb={animate && rolling && rollId % 2 === 1}>
        <span class="cube" style:transform="rotateX({rx}deg) rotateY({ry}deg)" style:transition={animate ? 'transform 1.05s cubic-bezier(.18,.72,.22,1)' : 'none'}>
          {#each FACES as f (f.n)}
            <span class="face" style:transform="{f.t} translateZ(calc(var(--s) / 2))">
              {#each [0, 1, 2, 3, 4, 5, 6, 7, 8] as i (i)}
                <span class="cell">{#if PIPS[f.n]!.includes(i)}<i class="pip" class:one={f.n === 1}></i>{/if}</span>
              {/each}
            </span>
          {/each}
        </span>
    </span>
  </button>
  {#if active && !rolling}<span class="cta display">Tirar</span>{/if}
  <span class="shadow" aria-hidden="true"></span>
</div>

<style>
  .wrap {
    position: relative;
    width: calc(var(--s) * 1.25);
    height: calc(var(--s) * 1.25);
    flex: none;
    display: grid;
    place-items: center;
    perspective: 700px;
  }
  .stage {
    position: relative;
    width: var(--s);
    height: var(--s);
    padding: 0;
    display: grid;
    place-items: center;
    cursor: default;
    transform-style: preserve-3d;
    z-index: 2;
  }
  .active .stage { cursor: pointer; }
  .toss {
    display: block;
    width: var(--s);
    height: var(--s);
    transform-style: preserve-3d;
  }
  .toss.ga { animation: toss-a 1.05s cubic-bezier(.3, .1, .3, 1); }
  .toss.gb { animation: toss-b 1.05s cubic-bezier(.3, .1, .3, 1); }
  .active:not(:has(.ga, .gb)) .toss { animation: bob 1.4s ease-in-out infinite; }
  .cube {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    transform-style: preserve-3d;
  }
  .face {
    position: absolute;
    inset: 0;
    display: grid;
    grid-template: repeat(3, 1fr) / repeat(3, 1fr);
    padding: 15%;
    border-radius: 18%;
    background: linear-gradient(145deg, #fffdf6 0%, #efe6cd 60%, #dccfae 100%);
    box-shadow: inset 0 0 0 2px rgb(var(--accent-rgb) / 0.55), inset 0 -6px 14px rgba(120, 90, 30, 0.22);
    backface-visibility: hidden;
  }
  .cell { display: grid; place-items: center; }
  .pip {
    width: 74%;
    aspect-ratio: 1;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #5a4a3a, #1a1208 70%);
  }
  .pip.one {
    width: 96%;
    background: radial-gradient(circle at 35% 30%, #d8434a, #6b1423 75%);
  }
  .halo {
    position: absolute;
    inset: 4%;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--ring) 55%, transparent) 0%, transparent 68%);
    opacity: 0.55;
    z-index: 0;
  }
  .active .halo { animation: halo 1.2s ease-in-out infinite; }
  .shadow {
    position: absolute;
    left: 50%;
    bottom: 3%;
    width: 62%;
    height: 12%;
    translate: -50% 0;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.5);
    z-index: 1;
  }
  .cta {
    position: absolute;
    bottom: -6px;
    left: 50%;
    translate: -50% 0;
    z-index: 3;
    padding: 3px 12px;
    border-radius: 999px;
    background: var(--gold-grad);
    color: var(--on-accent);
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    white-space: nowrap;
    pointer-events: none;
  }
  @keyframes toss-a {
    0% { transform: translateY(0) scale(1); }
    22% { transform: translateY(-46%) scale(1.14) rotateZ(8deg); }
    46% { transform: translateY(0) scale(0.96) rotateZ(-5deg); }
    62% { transform: translateY(-16%) scale(1.04) rotateZ(3deg); }
    80% { transform: translateY(0) scale(0.99); }
    100% { transform: translateY(0) scale(1); }
  }
  @keyframes toss-b {
    0% { transform: translateY(0) scale(1); }
    22% { transform: translateY(-46%) scale(1.14) rotateZ(-8deg); }
    46% { transform: translateY(0) scale(0.96) rotateZ(5deg); }
    62% { transform: translateY(-16%) scale(1.04) rotateZ(-3deg); }
    80% { transform: translateY(0) scale(0.99); }
    100% { transform: translateY(0) scale(1); }
  }
  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7%); } }
  @keyframes halo { 0%, 100% { opacity: 0.35; transform: scale(0.94); } 50% { opacity: 0.9; transform: scale(1.08); } }
  @media (prefers-reduced-motion: reduce) {
    .toss.ga, .toss.gb, .active .toss, .active .halo { animation: none !important; }
  }
</style>
