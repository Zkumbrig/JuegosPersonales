<script lang="ts">
  import type { SlotSymbol } from '../../shared/protocol';

  let { name, size = 64 }: { name: SlotSymbol; size?: number } = $props();
</script>

<svg class="sym" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="g-bell" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe7a1" /><stop offset=".55" stop-color="#f0b429" /><stop offset="1" stop-color="#b9791a" />
    </linearGradient>
    <linearGradient id="g-gem" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9be7ff" /><stop offset="1" stop-color="#2b8cff" />
    </linearGradient>
    <radialGradient id="g-cherry" cx=".35" cy=".3" r=".8">
      <stop offset="0" stop-color="#ff6b81" /><stop offset=".6" stop-color="#d8213a" /><stop offset="1" stop-color="#8d0f25" />
    </radialGradient>
    <radialGradient id="g-lemon" cx=".35" cy=".3" r=".9">
      <stop offset="0" stop-color="#fff59a" /><stop offset=".65" stop-color="#ffd23f" /><stop offset="1" stop-color="#e0a100" />
    </radialGradient>
    <linearGradient id="g-seven" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff5470" /><stop offset="1" stop-color="#c4152b" />
    </linearGradient>
  </defs>

  {#if name === 'cherry'}
    <path d="M34 9C30 22 24 31 21 37M34 9C37 22 41 31 42 38" fill="none" stroke="#2e7d32" stroke-width="3" stroke-linecap="round" />
    <path d="M34 9c6-5 13-4 17 0-5 5-12 5-17 0z" fill="#43a047" />
    <circle cx="20" cy="45" r="11.5" fill="url(#g-cherry)" />
    <circle cx="43" cy="46" r="11.5" fill="url(#g-cherry)" />
    <circle cx="16" cy="41" r="3" fill="#fff" opacity=".55" />
    <circle cx="39" cy="42" r="3" fill="#fff" opacity=".55" />
  {:else if name === 'lemon'}
    <g transform="rotate(-18 32 36)">
      <ellipse cx="32" cy="36" rx="23" ry="16" fill="url(#g-lemon)" />
      <circle cx="9.5" cy="36" r="3.4" fill="#f0b800" /><circle cx="54.5" cy="36" r="3.4" fill="#f0b800" />
      <ellipse cx="25" cy="30" rx="8" ry="3" fill="#fff" opacity=".5" />
    </g>
    <path d="M36 17c2-6 8-8 12-6-1 5-6 8-12 6z" fill="#43a047" />
  {:else if name === 'bell'}
    <path d="M32 8c-9 0-14 7-14 16v10l-6 8h40l-6-8V24c0-9-5-16-14-16z" fill="url(#g-bell)" />
    <path d="M12 42h40" stroke="#b9791a" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="32" cy="50" r="5" fill="#b9791a" />
    <circle cx="32" cy="7" r="3" fill="#e0a526" />
    <path d="M24 22c0-5 3-8 7-9" stroke="#fff" stroke-width="3" stroke-linecap="round" fill="none" opacity=".6" />
  {:else if name === 'diamond'}
    <path d="M16 12h32l12 14-28 30L4 26z" fill="url(#g-gem)" />
    <path d="M16 12h32l-6 14H22z" fill="#d6f4ff" opacity=".9" />
    <path d="M4 26l12-14 6 14z" fill="#8fdcff" /><path d="M60 26L48 12l-6 14z" fill="#8fdcff" />
    <path d="M22 26h20L32 56z" fill="#1d7bf0" opacity=".55" />
    <path d="M4 26h56M22 26l10 30 10-30M16 12l6 14M48 12l-6 14" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1.4" />
  {:else}
    <path d="M11 12h42v10L33 55H19l19-32H11z" fill="url(#g-seven)" stroke="#7a0c1b" stroke-width="3" stroke-linejoin="round" />
    <path d="M16 16h32" stroke="#fff" stroke-width="3" stroke-linecap="round" opacity=".5" />
  {/if}
</svg>

<style>
  .sym { display: block; flex: none; }
</style>
