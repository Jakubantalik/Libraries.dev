import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// The standalone showcase page (showcase.html) is intentionally NOT a build
// input, so it is excluded from the deployed site. It remains fully previewable
// during `vite` dev (Vite serves any root .html by URL); only `vite build`
// limits its emitted entry points to the main demo.
export default defineConfig({
  plugins: [react()],
  base: '/',
  resolve: {
    alias: {
      // Aliased to the library SOURCE (not its built dist) so editing the
      // library hot-reloads the site with no rebuild — the behaviour this
      // demo has always had. Only the path changed when the library moved
      // from the repo root into packages/.
      'border-beam': resolve(__dirname, '../../packages/border-beam/src/index.ts'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        // The root is the "moved to libraries.dev" page; the playground
        // that used to be the root now lives under /demo/.
        index: resolve(__dirname, 'index.html'),
        demo: resolve(__dirname, 'demo/index.html'),
      },
    },
  },
});
