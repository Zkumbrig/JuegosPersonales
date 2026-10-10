import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    host: true,
    proxy: { '/ws': { target: 'ws://localhost:3001', ws: true } },
  },
  build: { outDir: 'dist', target: 'es2022' },
});
