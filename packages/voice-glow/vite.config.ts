import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import { resolve } from 'path';

export default defineConfig({
  // The surface looks (dots, lines) are not released yet: compiled out
  // unless VOICE_SURFACE=1 (see src/env.d.ts).
  define: {
    __VOICE_SURFACE__: JSON.stringify(process.env.VOICE_SURFACE === '1'),
  },
  plugins: [
    react(),
    dts({
      include: ['src'],
      rollupTypes: true,
    }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'VoiceBeam',
      // The package is type:module, so the CJS bundle needs a real `.cjs`
      // extension — a `.js` file would be parsed as ESM and its
      // `exports.*` assignments would silently produce an empty require().
      fileName: (format) => (format === 'es' ? 'index.es.js' : 'index.cjs'),
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      output: {
        globals: {
          react: 'React',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'jsxRuntime',
        },
      },
    },
  },
});
