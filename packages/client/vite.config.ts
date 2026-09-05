import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { federation } from '@module-federation/vite';

const PORT = 4200;

export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  server: {
    port: PORT,
    strictPort: true,
    host: 'localhost',
  },
  preview: { port: PORT, strictPort: true },
  // Tailwind v4 emits modern CSS (@property, color-mix(), cascade layers) and
  // does not down-compile it. This is the v4 browser floor; it stays well
  // above Module Federation's only hard requirement (top-level await, Chrome
  // 89+). See scriptorium#55.
  build: { target: ['chrome111', 'safari16.4', 'firefox128', 'edge111'] },
  plugins: [
    tailwindcss(),
    federation({
      name: 'client',
      // No build-time `remotes:` block - the consumer registers them at
      // runtime in src/mf.ts at module load time.
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
      },
    }),
    react(),
  ],
});
