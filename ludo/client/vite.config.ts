import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// En desarrollo el cliente corre en :5173 y reenvía la API y el WebSocket al servidor (:3002).
const SERVER = process.env.LUDO_SERVER ?? 'http://localhost:3002';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    fs: { allow: ['..'] },
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER, ws: true },
    },
  },
});
