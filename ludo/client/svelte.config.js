import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    // SPA estática: todo el juego es tiempo real, no hay nada que renderizar en el servidor.
    adapter: adapter({ pages: 'build', assets: 'build', fallback: 'index.html', strict: false }),
    // El protocolo y las reglas viven en el servidor y se importan tal cual (una sola fuente de verdad).
    alias: { $shared: '../server/src/shared' },
  },
};
