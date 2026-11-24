#!/usr/bin/env node
// Copies the model's runtime from the frustration-ui project into src/core/:
// the recorder, the 43 features, the fast signals, the tree evaluator and the
// detector. features.ts is the single source for training and runtime, so a
// model only runs with the features it was trained on (checkModel enforces
// it); copy again whenever the model is retrained with new features.
//
//   node scripts/sync-core.mjs                      # finds ../frustration-ui upward
//   FRUSTRATION_UI_DIR=/path node scripts/sync-core.mjs
//
// The kit's changes to the copies are applied here, each one asserted, so a
// change upstream fails loudly instead of slipping through.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "core");

function findSource() {
  if (process.env.FRUSTRATION_UI_DIR) return process.env.FRUSTRATION_UI_DIR;
  for (let dir = here; ; ) {
    const candidate = resolve(dir, "frustration-ui");
    if (existsSync(join(candidate, "src", "features.ts"))) return candidate;
    const up = resolve(dir, "..");
    if (up === dir) throw new Error("frustration-ui not found; set FRUSTRATION_UI_DIR");
    dir = up;
  }
}

const src = join(findSource(), "src");
const FILES = ["events.ts", "features.ts", "fast.ts", "model.ts", "detector.ts"];

/** Exact replacements per file: [from, to]. */
const PATCHES = {
  "events.ts": [
    // The kit's own attribute for parts of the page it should not read.
    ["const IGNORE = '[data-frustration-ignore]'", "const IGNORE = '[data-mood-ignore]'"],
    // A scope: the provider reads only what happens inside its own element.
    [
      "  onEvent?: (e: RawEvent) => void\n}",
      "  onEvent?: (e: RawEvent) => void\n  /** Read only events whose target is inside this element (the page's own scroll still counts). */\n  scope?: Element\n}",
    ],
    ["  private onEvent?: (e: RawEvent) => void\n", "  private onEvent?: (e: RawEvent) => void\n  private scope?: Element\n"],
    ["    this.onEvent = opts.onEvent\n", "    this.onEvent = opts.onEvent\n    this.scope = opts.scope\n"],
    [
      "    return target instanceof Element && target.closest(IGNORE) !== null",
      "    if (!(target instanceof Element)) return false\n    if (this.scope && !this.scope.contains(target)) return true\n    return target.closest(IGNORE) !== null",
    ],
  ],
  "detector.ts": [["'frustration-baseline'", "'mood-baseline'"]],
};

const HEADER = (file) =>
  `// Copied from frustration-ui/src/${file} by scripts/sync-core.mjs. Edit it there and copy again.\n\n`;

for (const file of FILES) {
  let text = readFileSync(join(src, file), "utf8");
  // Extensionless imports, for any bundler.
  text = text.replace(/(from\s+'\.\/[a-z-]+)\.ts'/g, "$1'");
  for (const [from, to] of PATCHES[file] ?? []) {
    if (!text.includes(from)) throw new Error(`${file}: patch anchor not found: ${from.slice(0, 60)}`);
    text = text.replace(from, to);
  }
  writeFileSync(join(out, file), HEADER(file) + text);
  console.log(`  ${file}`);
}
console.log(`Copied from ${src}`);
