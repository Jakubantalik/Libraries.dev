import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// parity.html is intentionally NOT a build input: it is the frozen-time
// harness used to diff the web renderer against the native ports, and it has
// no place on the public site. Vite still serves it during `vite dev`.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  server: { port: 5177 },
  resolve: {
    alias: {
      // Aliased to the library SOURCE, as the beam site does, so editing the
      // library hot-reloads the site with no rebuild step in between.
      // engine first: a bare 'thinking-orbs' alias would also swallow
      // 'thinking-orbs/engine' and resolve it to the component entry.
      'thinking-orbs/engine': resolve(__dirname, '../../packages/thinking-orbs/src/engine/index.ts'),
      'thinking-orbs': resolve(__dirname, '../../packages/thinking-orbs/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        // The root is the "moved to libraries.dev" page; the playground
        // that used to be the root now lives under /demo/.
        index: resolve(__dirname, 'index.html'),
        demo: resolve(__dirname, 'demo/index.html'),
        simple: resolve(__dirname, 'simple.html'),
      },
    },
  },
});
