import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev workflow: `npm run dev` here on :5173, API on :3000.
 * Production: `npm run build` outputs to web/dist/, which the Express
 * server in api/ serves from. No proxy in prod — same origin.
 *
 * The dev proxy includes the SSE endpoint (`/api/events`) which needs
 * `ws: false` (it's HTTP, not websocket) and no buffering. Vite's
 * default http-proxy-middleware handles this correctly as long as we
 * don't change the protocol.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: false,
        ws: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
});
