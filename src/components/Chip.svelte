<script lang="ts">
  import { chipLabel } from '../lib/format';
  import { CHIP_COLORS } from '../lib/chips';

  let {
    value,
    selected = false,
    disabled = false,
    size = 56,
    onclick,
  }: { value: number; selected?: boolean; disabled?: boolean; size?: number; onclick?: () => void } = $props();

  const color = $derived(CHIP_COLORS[value] ?? '#444');
</script>

<button
  class="chip"
  class:selected
  {disabled}
  {onclick}
  style="--c:{color}; --s:{size}px"
  aria-label="Ficha de {value}"
  aria-pressed={selected}
>
  <span class="inner">{chipLabel(value)}</span>
</button>

<style>
  .chip {
    width: var(--s);
    height: var(--s);
    border-radius: 50%;
    background:
      repeating-conic-gradient(from 0deg, #f5efe0 0 12deg, var(--c) 12deg 30deg);
    box-shadow: 0 4px 10px rgba(0, 0, 0, 0.55), inset 0 0 0 2px rgba(255, 255, 255, 0.18);
    display: grid;
    place-items: center;
    transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s;
    flex: none;
  }
  .inner {
    width: 72%;
    height: 72%;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--c) 78%, white), var(--c));
    border: 2px dashed rgba(255, 255, 255, 0.55);
    display: grid;
    place-items: center;
    font-weight: 800;
    font-size: calc(var(--s) * 0.27);
    color: #fff;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.6);
    font-variant-numeric: tabular-nums;
  }
  .chip:active:not(:disabled) { transform: scale(0.92); }
  .chip.selected {
    transform: translateY(-6px) scale(1.06);
    box-shadow: 0 10px 18px rgba(0, 0, 0, 0.6), 0 0 0 3px var(--gold), 0 0 18px rgb(var(--accent-rgb) / 0.55);
  }
  .chip:disabled { opacity: 0.32; }
</style>
