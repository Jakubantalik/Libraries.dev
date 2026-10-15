#!/usr/bin/env node
// Copies the free skill (../skills/libraries-dev) into this package before it
// is packed, so the published CLI carries the same files `npx skills add`
// installs from the repo. The repo folder stays the single source.
import { cpSync, rmSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "skills", "libraries-dev");
const dest = join(here, "..", "skill");
if (!existsSync(join(src, "SKILL.md"))) {
  console.error("sync-skill: " + src + "/SKILL.md not found");
  process.exit(1);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log("sync-skill: copied " + src + " -> " + dest);
