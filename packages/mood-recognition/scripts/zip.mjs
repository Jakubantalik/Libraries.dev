#!/usr/bin/env node
// Builds the download: dist/MoodRecognition-React-<major.minor>.zip, an mood-recognition/ folder with the
// kit's TypeScript source, its README and its MIT license. The model is a separate download.
// libraries-pro's scripts/sync-models.mjs uploads it for GET /models/mood-react.

import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const short = version.split(".").slice(0, 2).join(".");
const name = `MoodRecognition-React-${short}.zip`;
const dist = join(root, "dist");
const stage = join(dist, "stage");
const kit = join(stage, "mood-recognition");

rmSync(dist, { recursive: true, force: true });
mkdirSync(kit, { recursive: true });
cpSync(join(root, "src"), kit, { recursive: true });
cpSync(join(root, "README.md"), join(kit, "README.md"));
cpSync(join(root, "LICENSE"), join(kit, "LICENSE"));
// -X: no extra file attributes, so the zip only changes when the files do.
execFileSync("zip", ["-r", "-X", "-q", join(dist, name), "mood-recognition"], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(`dist/${name}`);
