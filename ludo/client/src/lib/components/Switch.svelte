<script lang="ts">
  type Props = { checked: boolean; label: string; hint?: string; disabled?: boolean; onchange: (v: boolean) => void };
  let { checked, label, hint, disabled = false, onchange }: Props = $props();
</script>

<button class="row" role="switch" aria-checked={checked} {disabled} onclick={() => onchange(!checked)}>
  <span class="text">
    <span class="name">{label}</span>
    {#if hint}<span class="hint">{hint}</span>{/if}
  </span>
  <span class="track" class:on={checked}><span class="knob"></span></span>
</button>

<style>
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    padding: 10px 0;
    background: none;
    border: 0;
    text-align: left;
  }
  .row:disabled {
    cursor: default;
  }
  .text {
    display: grid;
    gap: 2px;
  }
  .name {
    font-weight: 800;
  }
  .hint {
    font-size: 0.86rem;
    color: var(--muted);
  }
  .track {
    flex: none;
    width: 46px;
    height: 28px;
    border-radius: 999px;
    background: #2a3260;
    padding: 3px;
    transition: background 0.15s;
  }
  .track.on {
    background: var(--ok);
  }
  .knob {
    display: block;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.15s;
  }
  .on .knob {
    transform: translateX(18px);
  }
  .row:disabled .track {
    opacity: 0.7;
  }
</style>
