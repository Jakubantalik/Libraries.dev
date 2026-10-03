import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

// Dev (`npm run dev`) serves the playground from the lib root and shares the
// demo image pool from `demo/public`. The lib build (`npm run build`) sets
// publicDir=false so no static assets leak into `dist/`.
const isLibBuild = process.env.npm_lifecycle_event === 'build';

export default defineConfig({
  plugins: [
    react(),
    isLibBuild &&
      dts({
        include: ['src'],
        rollupTypes: true
      })
  ].filter(Boolean),
  publicDir: isLibBuild ? false : resolve(__dirname, 'demo/public'),
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'ImageGeneration',
      // The package is type:module, so the CJS bundle needs a real `.cjs`
      // extension — a `.js` file would be parsed as ESM and its
      // `exports.*` assignments would silently produce an empty require().
      fileName: (format) => (format === 'es' ? 'index.es.js' : 'index.cjs'),
      formats: ['es', 'cjs']
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime', 'three'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
          three: 'THREE'
        }
      }
    }
  }
});
