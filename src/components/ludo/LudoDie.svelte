<script lang="ts">
  // Dado 3D de verdad: un cubo de seis caras que da vueltas y cae sobre la cara que sacó el servidor.
  // El cubo siempre está colocado en su cara final; el giro es una animación aparte que termina en esa
  // posición (así se ve rodar aunque cambie el valor). Solo transform: corre en la GPU.
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

  const pose = $derived.by(() => {
    const [bx, by] = FACE[value ?? 1] ?? FACE[1]!;
    return `rotateX(${bx - 14}deg) rotateY(${by + 18}deg)`;
  });
  const par = $derived(rollId % 2 === 0 ? 'a' : 'b');
</script>

<div class="wrap essential-motion" class:active style:--s="{size}px" style:--ring={color}>
  <span class="halo" aria-hidden="true"></span>
  <button class="stage" disabled={!active} onclick={onroll} aria-label={active ? 'Tirar el dado' : value ? `Dado: ${value}` : 'Dado'}>
    <span class="toss" class:ta={rolling && par === 'a'} class:tb={rolling && par === 'b'}>
      <span class="spin" class:sa={rolling && par === 'a'} class:sb={rolling && par === 'b'}>
        <span class="cube" style:transform={pose}>
          {#each FACES as f (f.n)}
            <span class="face" style:transform="{f.t} translateZ(calc(var(--s) / 2))">
              {#each [0, 1, 2, 3, 4, 5, 6, 7, 8] as i (i)}
                <span class="cell">{#if PIPS[f.n]!.includes(i)}<i class="pip" class:one={f.n === 1}></i>{/if}</span>
              {/each}
            </span>
          {/each}
        </span>
      </span>
    </span>
  </button>
  {#if active && !rolling}<span class="cta display">Tirar</span>{/if}
  <span class="shadow" class:rolling aria-hidden="true"></span>
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
  .toss, .spin {
    display: block;
    width: var(--s);
    height: var(--s);
    transform-style: preserve-3d;
  }
  .toss.ta { animation: toss-a 1.05s cubic-bezier(.3, .1, .3, 1); }
  .toss.tb { animation: toss-b 1.05s cubic-bezier(.3, .1, .3, 1); }
  .spin.sa { animation: spin-a 1.05s cubic-bezier(.2, .75, .25, 1); }
  .spin.sb { animation: spin-b 1.05s cubic-bezier(.2, .75, .25, 1); }
  .active:not(:has(.ta, .tb)) .toss { animation: bob 1.4s ease-in-out infinite; }
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
  .shadow.rolling { animation: shadow 1.05s ease-in-out; }
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
  /* Rebote del dado sobre la mesa (sube, cae, rebota, se asienta). */
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
  /* Giro: varias vueltas sobre los tres ejes que terminan exactamente en la cara sacada. */
  @keyframes spin-a { from { transform: rotateX(900deg) rotateY(-720deg) rotateZ(180deg); } to { transform: rotateX(0) rotateY(0) rotateZ(0); } }
  @keyframes spin-b { from { transform: rotateX(-720deg) rotateY(900deg) rotateZ(-180deg); } to { transform: rotateX(0) rotateY(0) rotateZ(0); } }
  @keyframes shadow { 0%, 100% { transform: scale(1); opacity: 1; } 22% { transform: scale(0.55); opacity: 0.4; } 46% { transform: scale(1.05); } 62% { transform: scale(0.8); opacity: 0.7; } }
  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-7%); } }
  @keyframes halo { 0%, 100% { opacity: 0.35; transform: scale(0.94); } 50% { opacity: 0.9; transform: scale(1.08); } }
  @media (prefers-reduced-motion: reduce) {
    /* Solo se apagan los vaivenes decorativos; el giro del dado es parte del juego. */
    .active .toss, .active .halo { animation: none !important; }
  }
</style>
