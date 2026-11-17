import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

/* The bench reports its frame times here, so a run in a browser that no
   test driver can reach (Safari, a real Chrome) can still be read back:
   POST adds a report, GET lists them, DELETE forgets them. */
function stats(): Plugin {
  const reports: unknown[] = [];
  return {
    name: 'distortion-waves-stats',
    configureServer(server) {
      server.middlewares.use('/__stats', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk) => (body += chunk));
          req.on('end', () => {
            try {
              reports.push(JSON.parse(body));
            } catch {
              /* not a report */
            }
            res.end('ok');
          });
          return;
        }
        if (req.method === 'DELETE') reports.length = 0;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(reports));
      });
    },
  };
}

export default defineConfig({
  root: __dirname,
  plugins: [react(), stats()],
  resolve: {
    alias: { 'distortion-waves': resolve(__dirname, '../src/index.ts') },
  },
  server: { port: 5183, strictPort: true },
});
