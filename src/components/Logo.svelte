<script lang="ts">
  let { size = 1 }: { size?: number } = $props();
</script>

<div class="logo" style="--k:{size}">
  <span class="word foil-text">ROYALE</span>
  <span class="sub">
    <i class="line"></i>
    <i class="pip"></i><span class="club foil-text">CLUB</span><i class="pip b"></i>
    <i class="line"></i>
  </span>
</div>

<style>
  .logo { display: inline-flex; flex-direction: column; align-items: center; gap: calc(6px * var(--k)); filter: drop-shadow(0 3px 0 rgba(0, 0, 0, 0.45)); }
  .word {
    font-family: var(--font-display); font-weight: 900; font-size: calc(3.1rem * var(--k)); line-height: 1;
    letter-spacing: -0.02em; padding: 0 0.04em 0.06em;
  }
  .sub { display: flex; align-items: center; gap: calc(8px * var(--k)); color: var(--gold); }
  .club { font-family: var(--font-display); font-weight: 700; font-size: calc(0.95rem * var(--k)); letter-spacing: 0.5em; margin-right: -0.5em; }
  .line { display: block; width: calc(34px * var(--k)); height: 1.5px; background: linear-gradient(90deg, transparent, var(--gold-lo)); }
  /* Confeti: dos puntos de color en lugar de palos de cartas. */
  .pip { display: block; width: calc(8px * var(--k)); height: calc(8px * var(--k)); border-radius: 50%; background: var(--gold); }
  .pip.b { background: var(--pop, var(--gold-lo)); }
  .line:last-child { transform: scaleX(-1); }
</style>
