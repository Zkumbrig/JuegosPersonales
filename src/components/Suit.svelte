<script lang="ts">
  import { SUITS } from '../lib/icons';

  let { s, size = 16 }: { s: string; size?: number } = $props();
</script>

<svg class="suit" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{@html SUITS[s] ?? ''}</svg>

<style>
  .suit { display: block; flex: none; }
</style>
