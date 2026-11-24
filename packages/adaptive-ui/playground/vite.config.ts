import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/* The kit's playground. The model is never committed to this repo: on the
   dev server it is read from a local frustration-ui checkout (or
   ADAPTIVE_MODEL, a path to AdaptiveUI.json) and served at /model.json.
   Without one the playground runs on the fast signals alone. */
function findModel(): string | null {
  if (process.env.ADAPTIVE_MODEL) return process.env.ADAPTIVE_MODEL;
  for (let dir = __dirname; ; ) {
    const candidate = resolve(dir, "frustration-ui", "models", "frustration.json");
    if (existsSync(candidate)) return candidate;
    const up = resolve(dir, "..");
    if (up === dir) return null;
    dir = up;
  }
}

export default defineConfig({
  root: __dirname,
  plugins: [
    react(),
    {
      name: "adaptive-model",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use("/model.json", (_req, res) => {
          const file = findModel();
          if (!file) {
            res.statusCode = 404;
            res.end("{}");
            return;
          }
          res.setHeader("content-type", "application/json");
          res.end(readFileSync(file));
        });
      },
    },
  ],
  server: { port: Number(process.env.PORT) || 5290, strictPort: false },
});
