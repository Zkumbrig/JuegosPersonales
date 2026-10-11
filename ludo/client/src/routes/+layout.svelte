<script lang="ts">
  import '../app.css';
  let { children } = $props();
</script>

<svelte:head>
  <title>Ludo Club · 4, 6 y 8 jugadores</title>
</svelte:head>

{@render children()}
