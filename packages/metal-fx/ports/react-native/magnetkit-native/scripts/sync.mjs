// Copies the shared sources in: MagnetKit for iOS (Swift) and Android
// (Kotlin) from the metal-fx ports, and the pure TypeScript (readings,
// calibration fit, Magnetic UI physics) from the web kit. The model is not
// copied: apps add Magnet.mfxl themselves (see the config plugin).
import { cpSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ports = join(root, "..", "..");
const webKit = join(ports, "..", "..", "magnetkit-web");

function copy(from, to, ext) {
  mkdirSync(to, { recursive: true });
  for (const f of readdirSync(to)) if (f.endsWith(ext)) rmSync(join(to, f));
  const files = readdirSync(from).filter((f) => f.endsWith(ext));
  for (const f of files) cpSync(join(from, f), join(to, f));
  return files.length;
}

const swift = copy(join(ports, "ios", "MagnetKit", "Sources", "MagnetKit"), join(root, "ios", "MagnetKit"), ".swift");
const kotlin = copy(
  join(ports, "android", "magnetkit", "src", "main", "kotlin", "dev", "libraries", "magnetkit"),
  join(root, "android", "src", "main", "java", "dev", "libraries", "magnetkit"),
  ".kt",
);
const core = join(root, "src", "core");
mkdirSync(core, { recursive: true });
for (const f of ["types.ts", "fit.ts", "field.ts", "calibration-core.ts"]) cpSync(join(webKit, "src", f), join(core, f));
console.log(`synced ${swift} Swift, ${kotlin} Kotlin, 4 TypeScript files`);
