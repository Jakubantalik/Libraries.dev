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
  { file: "08-voice-ring.md", pkg: "voice-ring", name: "Voice Ring", page: "voice-ring", line: "A voice-reactive ring of light at the centre of a voice screen: listens, thinks and speaks, takes the voice's emotion and leans toward the speaker. React and SwiftUI." },
  { file: "09-distortion-waves.md", pkg: "distortion-waves", name: "Distortion Waves", page: "waves", line: "A colourful WebGL distortion wave that carries one view into another, opening from a button, an edge or an avatar. React and SwiftUI." },
  { file: "05-bot-avatars.md", pkg: "bot-avatars", name: "Bot Avatars", page: "bots", line: "Animated avatars for AI agents and chatbots: plush 3D characters with idle, working and sleeping states." },
  { file: "06-metal-fx.md", pkg: "metal-fx", name: "Liquid Metal", page: "metal", line: "Real-time WebGL liquid metal material for buttons, badges, icons and headline text." },
  { file: "07-img-fx.md", pkg: "img-fx", name: "Image FX", page: "image", line: "WebGL loading and reveal effect for AI image generation, uploads and lazy-loaded images." },
];

// The on-device models: input for a UI, not effects. Their files are
// downloads (free account), never npm packages.
const MODELS = [
  { file: "12-mood-recognition.md", slug: "mood-recognition", name: "Mood recognition (beta)", page: "mood-recognition", line: "Reads the user's mood (frustrated, confused, lost) from the pointer, presses, scrolling and typing, in the browser; a React kit tells components when to bring forward what helps." },
  { file: "11-voice-position.md", slug: "voice-position", name: "Voice Position (beta)", page: "voice-position", line: "Which side of an iPhone a voice comes from and how far off it is, from the built-in stereo microphones. SwiftUI." },
  { file: "10-magnetic-ui.md", slug: "magnetic-ui", name: "Magnetic UI", page: "magnetic", line: "A real magnet pulls the interface and air taps act as input, from the phone's magnetometer. React (via the Magnet Bridge app), SwiftUI, Android, React Native." },
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
for (const m of MODELS) {
  if (!available.has(m.file)) throw new Error(`missing reference ${m.file}`);
  const md = readFileSync(join(refs, m.file), "utf8").trim();
  const header = `<!-- ${m.name}, an on-device model. Page and downloads: ${SITE}/${m.page} -->\n\n`;
  writeFileSync(join(out, "llms", `${m.slug}.md`), header + md + "\n");
  full.push(header + md);
}

const index = `# Libraries.dev

> Nine open-source (MIT) UI effect libraries for AI interfaces, each an npm package with one React component (several also in SwiftUI): animated borders, thinking indicators, liquid effects, voice visualizers, a voice ring, view-to-view distortion waves, bot avatars, liquid metal and image-generation loaders. Plus three on-device models that let an interface respond to the user: their mood, where their voice is, and a magnet. Built to be added by coding agents.

Install a library with \`npm install <package>\` and read its reference before writing code; never guess a prop. Placement rules: no effect for waits under 2 seconds; Thinking Orbs for waits of 2 seconds or more; add Border Beam on the working element for waits over 3 seconds; never put two effects on the same or neighbouring elements.

## Libraries

${LIBS.map((l) => `- [${l.name} (${l.pkg})](${SITE}/llms/${l.pkg}.md): ${l.line} Playground: ${SITE}/${l.page}`).join("\n")}

## Models

Model files are downloads with a free account, shipped inside the app under the Libraries.dev Model License (free for development and non-commercial apps; a commercial release needs Pro or Business).

${MODELS.map((m) => `- [${m.name}](${SITE}/llms/${m.slug}.md): ${m.line} Page: ${SITE}/${m.page}`).join("\n")}

## For coding agents

- [Agent skill](${SITE}/skill): teaches Claude Code, Cursor, Codex and other agents all nine libraries and three models, and where each fits. Install with \`npx libraries-dev skill\` or \`npx skills add Jakubantalik/Libraries.dev\`.
- [How to use](${SITE}/how-to-use): copy a library's prompt into your agent and tune it.
- [All references in one file](${SITE}/llms-full.txt)

## Optional

- [Studio and Libraries Pro](${SITE}/pro): live tuning of every option with a built-in AI agent, Pro presets and variants, the Pro skill. Business adds a team MCP server.
- [Source on GitHub](https://github.com/Jakubantalik/Libraries.dev)
- [Accessibility](${SITE}/accessibility)
`;

writeFileSync(join(out, "llms.txt"), index);
writeFileSync(join(out, "llms-full.txt"), `# Libraries.dev: full library and model references\n\n${full.join("\n\n---\n\n")}\n`);
console.log(`llms.txt, llms-full.txt and ${LIBS.length + MODELS.length} references written`);
