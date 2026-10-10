<script lang="ts">
  import Icon from './Icon.svelte';

  let { n, size = 14 }: { n: number; size?: number } = $props();
</script>

<span class="fl" role="img" aria-label="Intensidad {n} de 3">
  {#each [1, 2, 3] as i (i)}
    <span class:off={i > n}><Icon name="flame" {size} /></span>
  {/each}
</span>

<style>
  .fl { display: inline-flex; gap: 1px; color: var(--gold-hi); }
  .off { opacity: 0.22; }
</style>
