import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";

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

// Multi-page static site: every top-level .html file is an entry.
export default defineConfig({
  plugins: [react(), stampSharedAssets()],
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
        introduction: resolve(__dirname, "introduction.html"),
        accessibility: resolve(__dirname, "accessibility.html"),
        beam: resolve(__dirname, "beam.html"),
        orbs: resolve(__dirname, "orbs.html"),
        "orbs-carousel": resolve(__dirname, "orbs-carousel.html"),
        gooey: resolve(__dirname, "gooey.html"),
        metal: resolve(__dirname, "metal.html"),
        image: resolve(__dirname, "image.html"),
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
});
