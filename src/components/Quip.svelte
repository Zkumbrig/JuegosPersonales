<script lang="ts">
  // Comentario de la mesa: una cita breve con la reacción a lo que acaba de pasar. Sin caritas ni globos de cómic.
  let { text }: { text: string } = $props();
</script>

{#key text}
  <aside class="quip" aria-live="polite">
    <span class="mark" aria-hidden="true">“</span>
    <p>{text}</p>
  </aside>
{/key}

<style>
  .quip {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 14px 18px 14px 14px;
    border-radius: 16px;
    background: rgb(var(--accent-rgb) / 0.08);
    border-left: 3px solid var(--gold);
    animation: pop 0.4s cubic-bezier(0.34, 1.4, 0.64, 1) both;
  }
  .mark { flex: none; font-family: Georgia, 'Times New Roman', serif; font-size: 3rem; line-height: 0.8; color: var(--gold); margin-top: 6px; }
  @media (max-height: 740px) { .quip { padding: 8px 14px 8px 12px; } .mark { font-size: 2.4rem; margin-top: 4px; } }
  p { margin: 0; font-size: 1.05rem; line-height: 1.45; font-style: italic; text-wrap: pretty; align-self: center; }
</style>
