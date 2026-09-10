import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Aliased to the library SOURCE rather than its built dist, so editing
      // the library hot-reloads this site with no rebuild step. Matches how
      // the beam site resolves border-beam.
      'liquid-gooey': fileURLToPath(
        new URL('../../packages/liquid-gooey/src/index.ts', import.meta.url),
      ),
    },
  },
  build: {
    rollupOptions: {
      input: {
        // The root is the "moved to libraries.dev" page; the playground
        // that used to be the root now lives under /demo/.
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        demo: fileURLToPath(new URL('demo/index.html', import.meta.url)),
      },
    },
  },
  server: {
    // Honour PORT so a busy 5173 reassigns cleanly — the two sites in this
    // repo are often run side by side.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
