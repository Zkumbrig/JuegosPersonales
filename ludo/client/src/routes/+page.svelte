<script lang="ts">
  import { onMount } from 'svelte';
  import { ludo } from '$lib/game.svelte';
  import Game from '$lib/components/Game.svelte';
  import Home from '$lib/components/Home.svelte';
  import Lobby from '$lib/components/Lobby.svelte';
  import Toasts from '$lib/components/Toasts.svelte';

  let ready = $state(false);
  onMount(() => {
    ludo.init();
    ready = true;
  });
</script>

{#if ready}
  {#if !ludo.room}
    <Home />
  {:else if ludo.room.phase === 'lobby'}
    <Lobby />
  {:else}
    <Game />
  {/if}
{/if}
<Toasts />
