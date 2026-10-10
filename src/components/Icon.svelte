<script lang="ts">
  import { ICONS } from '../lib/icons';

  let { name, size = 20 }: { name: string; size?: number } = $props();
</script>

<svg
  class="ic"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>{@html ICONS[name] ?? ''}</svg>

<style>
  .ic { flex: none; display: block; overflow: visible; }
  .ic :global(.d) { fill: currentColor; fill-opacity: 0.2; }
</style>
