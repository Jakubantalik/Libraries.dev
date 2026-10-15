#!/usr/bin/env node
// Writes the files AI agents and LLM crawlers read instead of the HTML:
//
//   public/llms.txt        the llmstxt.org index: what the site is, one line
//                          and a link per library, docs and the skill
//   public/llms-full.txt   every library reference in one document
//   public/llms/<pkg>.md   one reference per library, as markdown
//
// The source is the free agent skill's references (skills/libraries-dev),
// which already describe each library's install, usage, options and fit, so
// the agent-facing docs never drift from what the skill teaches. Runs before
// every build; the output is committed so the dev server serves it too.

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const site = join(here, "..");
const refs = join(site, "..", "..", "skills", "libraries-dev", "references");
const out = join(site, "public");
const SITE = "https://libraries.dev";

// Order and page slugs as the site lists them.
const LIBS = [
  { file: "01-border-beam.md", pkg: "border-beam", name: "Border Beam", page: "beam", line: "Animated glowing border for any React card, button or input: a light beam that travels the edge, or a soft pulse. Use for AI inputs, active cards and highlighted CTAs." },
  { file: "02-thinking-orbs.md", pkg: "thinking-orbs", name: "Thinking Orbs", page: "orbs", line: "Animated AI thinking and loading indicators: small dot-orbs with states like thinking, searching, writing and listening. Use for agent status and waits over 2 seconds." },
  { file: "03-liquid-gooey.md", pkg: "liquid-gooey", name: "Gooey", page: "gooey", line: "Liquid, gooey effects for React: menus whose pieces merge like goo, blob morphs and image melts." },
  { file: "04-voice-glow.md", pkg: "voice-glow", name: "Voice Glow", page: "voice", line: "Audio-reactive glow for voice input, dictation and voice agents; reacts to a microphone stream." },
  { file: "05-bot-avatars.md", pkg: "bot-avatars", name: "Bot Avatars", page: "bots", line: "Animated avatars for AI agents and chatbots: plush 3D characters with idle, working and sleeping states." },
  { file: "06-metal-fx.md", pkg: "metal-fx", name: "Liquid Metal", page: "metal", line: "Real-time WebGL liquid metal material for buttons, badges, icons and headline text." },
  { file: "07-img-fx.md", pkg: "img-fx", name: "Image FX", page: "image", line: "WebGL loading and reveal effect for AI image generation, uploads and lazy-loaded images." },
];

const available = new Set(readdirSync(refs));
mkdirSync(join(out, "llms"), { recursive: true });

const full = [];
for (const lib of LIBS) {
  if (!available.has(lib.file)) throw new Error(`missing reference ${lib.file}`);
  const md = readFileSync(join(refs, lib.file), "utf8").trim();
  const header = `<!-- ${lib.name} (${lib.pkg}). Live playground: ${SITE}/${lib.page}. npm: https://www.npmjs.com/package/${lib.pkg} -->\n\n`;
  writeFileSync(join(out, "llms", `${lib.pkg}.md`), header + md + "\n");
  full.push(header + md);
}

const index = `# Libraries.dev

> Seven open-source (MIT) React UI effect libraries for AI interfaces, each an npm package with one component: animated borders, thinking indicators, liquid effects, voice visualizers, bot avatars, liquid metal and image-generation loaders. Built to be added by coding agents.

Install a library with \`npm install <package>\` and read its reference before writing code; never guess a prop. Placement rules: no effect for waits under 2 seconds; Thinking Orbs for waits of 2 seconds or more; add Border Beam on the working element for waits over 3 seconds; never put two effects on the same or neighbouring elements.

## Libraries

${LIBS.map((l) => `- [${l.name} (${l.pkg})](${SITE}/llms/${l.pkg}.md): ${l.line} Playground: ${SITE}/${l.page}`).join("\n")}

## For coding agents

- [Agent skill](${SITE}/skill): teaches Claude Code, Cursor, Codex and other agents all seven libraries and where each fits. Install with \`npx libraries-dev skill\` or \`npx skills add Jakubantalik/Libraries.dev\`.
- [How to use](${SITE}/how-to-use): copy a library's prompt into your agent and tune it.
- [All references in one file](${SITE}/llms-full.txt)

## Optional

- [Studio and Libraries Pro](${SITE}/pro): live tuning of every option with a built-in AI agent, Pro presets and variants, the Pro skill. Business adds a team MCP server.
- [Source on GitHub](https://github.com/Jakubantalik/Libraries.dev)
- [Accessibility](${SITE}/accessibility)
`;

writeFileSync(join(out, "llms.txt"), index);
writeFileSync(join(out, "llms-full.txt"), `# Libraries.dev: full library references\n\n${full.join("\n\n---\n\n")}\n`);
console.log(`llms.txt, llms-full.txt and ${LIBS.length} references written`);
