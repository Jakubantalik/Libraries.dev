import { defineConfig, mergeConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

/* The shared scripts and stylesheets live in public/, so Vite copies them
   through untouched and their URLs never change. Cloudflare serves static
   assets with a 4-hour browser cache, which left visitors pairing new HTML
   with an old site.css until it expired.

   The HTML itself is served max-age=0, so stamping each reference with a
   hash of the file's own bytes is enough: the URL changes the moment the
   file does, and never otherwise. Long caching then costs nothing. */
const SHARED = [
  "site.css",
  "playground.css",
  "examples.css",
  "site.js",
  "pro-client.js",
];

function stampSharedAssets() {
  return {
    name: "stamp-shared-assets",
    apply: "build" as const,
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      const version: Record<string, string> = {};
      for (const name of SHARED) {
        const file = resolve(dist, "assets", name);
        try {
          version[name] = createHash("sha1")
            .update(readFileSync(file))
            .digest("hex")
            .slice(0, 8);
        } catch {
          /* Not every asset ships on every build; skip what is absent. */
        }
      }

      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((entry) => {
          const full = resolve(dir, entry);
          if (statSync(full).isDirectory()) return walk(full);
          return full.endsWith(".html") ? [full] : [];
        });

      for (const page of walk(dist)) {
        const before = readFileSync(page, "utf8");
        let after = before;
        for (const [name, hash] of Object.entries(version)) {
          after = after.split(`/assets/${name}"`).join(`/assets/${name}?v=${hash}"`);
        }
        if (after !== before) writeFileSync(page, after);
      }
    },
  };
}

/* Libraries Pro runtime modules on the dev server. The live Studio fetches
   Pro code (voice-glow's mosaic, dots and lines, its emotion model) from the
   API for signed-in Pro accounts (src/studio/pro-runtime.tsx); on a dev
   server it reads the build in a local libraries-pro checkout instead, at
   /__pro/<library>.js. LIBRARIES_PRO_DIR points at the checkout, else the
   nearest "libraries-pro" folder beside a parent of this one. Nothing is
   served without one, and never from a production build. */
function findLibrariesPro(): string | null {
  if (process.env.LIBRARIES_PRO_DIR) return process.env.LIBRARIES_PRO_DIR;
  for (let dir = __dirname; ; ) {
    const candidate = resolve(dir, "libraries-pro");
    if (existsSync(resolve(candidate, "content", "libraries"))) return candidate;
    const up = resolve(dir, "..");
    if (up === dir) return null;
    dir = up;
  }
}

function proRuntimeDev() {
  return {
    name: "pro-runtime-dev",
    apply: "serve" as const,
    configureServer(server: { middlewares: { use: (path: string, fn: (req: { url?: string }, res: import("node:http").ServerResponse, next: () => void) => void) => void } }) {
      server.middlewares.use("/__pro/", (req, res, next) => {
        const m = /^\/?([a-z0-9-]{1,40})\.js$/.exec((req.url || "").split("?")[0]);
        const pro = findLibrariesPro();
        const file = m && pro ? resolve(pro, "content", "libraries", m[1], "web", "dist", `${m[1]}.js`) : null;
        if (!file || !existsSync(file)) {
          res.statusCode = 404;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: "content_not_found", note: "Build it in libraries-pro: node content/libraries/<library>/web/build.mjs" }));
          return;
        }
        res.setHeader("content-type", "text/javascript; charset=utf-8");
        res.setHeader("cache-control", "no-store");
        res.end(readFileSync(file));
      });
    },
  };
}

/* Local-only additions — extra pages, aliases — from an untracked
   vite.local.mjs beside this file, when one exists (see .gitignore). */
const localFile = resolve(__dirname, "vite.local.mjs");
const local = existsSync(localFile) ? (await import(pathToFileURL(localFile).href)).default : {};

// Multi-page static site: every top-level .html file is an entry.
export default mergeConfig(defineConfig({
  plugins: [react(), stampSharedAssets(), proRuntimeDev()],
  server: {
    // Honour PORT so a busy 5173 reassigns cleanly — several sites in this
    // repo are often run side by side (matches the gooey site's config).
    port: Number(process.env.PORT) || 5173,
    strictPort: false
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        "how-to-use": resolve(__dirname, "how-to-use.html"),
        skill: resolve(__dirname, "skill.html"),
        "skill-example": resolve(__dirname, "skill-example.html"),
        introduction: resolve(__dirname, "introduction.html"),
        accessibility: resolve(__dirname, "accessibility.html"),
        beam: resolve(__dirname, "beam.html"),
        orbs: resolve(__dirname, "orbs.html"),
        avatars: resolve(__dirname, "bots.html"),
        "orbs-carousel": resolve(__dirname, "orbs-carousel.html"),
        "bot-carousel": resolve(__dirname, "bot-carousel.html"),
        gooey: resolve(__dirname, "gooey.html"),
        metal: resolve(__dirname, "metal.html"),
        image: resolve(__dirname, "image.html"),
        magnetic: resolve(__dirname, "magnetic.html"),
        "voice-position": resolve(__dirname, "voice-position.html"),
        "mood-recognition": resolve(__dirname, "mood-recognition.html"),
        voice: resolve(__dirname, "voice.html"),
        "voice-ring": resolve(__dirname, "voice-ring.html"),
        waves: resolve(__dirname, "waves.html"),
        "wave-components": resolve(__dirname, "wave-components.html"),
        "voice-phone": resolve(__dirname, "voice-phone.html"),
        "skill-demo": resolve(__dirname, "skill-demo.html"),
        pro: resolve(__dirname, "pro.html"),
        studio: resolve(__dirname, "studio.html"),
        "studio-app": resolve(__dirname, "studio/app.html"),
        account: resolve(__dirname, "account.html"),
        activate: resolve(__dirname, "activate.html"),
        success: resolve(__dirname, "success.html"),
        terms: resolve(__dirname, "terms.html"),
        privacy: resolve(__dirname, "privacy.html")
      }
    }
  }
}), local);
