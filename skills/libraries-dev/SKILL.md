---
name: libraries-dev
description: Use the Libraries.dev UI effect libraries correctly and find where they fit in a project. Covers Border beam (border-beam), Thinking orbs (thinking-orbs), Gooey (liquid-gooey), Voice (voice-glow), Bot avatars (bot-avatars), Liquid metal (metal-fx) and Image (img-fx). Use when adding an AI thinking or loading state, a glowing or animated border around an input or card, a voice or microphone visualizer, an animated bot or agent avatar, a liquid metal button or badge, an image generation placeholder or reveal, a gooey blob or liquid menu, or when the user mentions libraries.dev or any of these packages. Also "review my project for libraries.dev", "where could I use these effects", and the commands libraries reveal, libraries review, libraries apply.
---

# Libraries.dev

Seven UI effect libraries for AI-era interfaces, each an npm package with a
React component. This skill knows what each one is for, how to install it,
and the options its libraries.dev detail page offers. Read the library's
reference file before writing any code for it; never guess a prop.

## Quick reference

| Library | Package | Component | Use it for | Reference |
| --- | --- | --- | --- | --- |
| **Border beam** | `border-beam` | `BorderBeam` | A light that travels around an element's border: AI inputs, active cards, highlighted buttons. | [01-border-beam.md](references/01-border-beam.md) |
| **Thinking orbs** | `thinking-orbs` | `ThinkingOrb` | Small dot-orb indicators for what an agent is doing: thinking, searching, writing, listening. | [02-thinking-orbs.md](references/02-thinking-orbs.md) |
| **Gooey** | `liquid-gooey` | `Liquid` | Liquid, melting and merging shapes and images: gooey menus, blob transitions, organic backdrops. | [03-liquid-gooey.md](references/03-liquid-gooey.md) |
| **Voice** | `voice-glow` | `VoiceBeam` | An audio-reactive glow for voice input, dictation and voice agents. | [04-voice-glow.md](references/04-voice-glow.md) |
| **Bot avatars** | `bot-avatars` | `BotAvatar` | Animated bot characters with idle, working and sleeping states for agents and assistants. | [05-bot-avatars.md](references/05-bot-avatars.md) |
| **Liquid metal** | `metal-fx` | `MetalFx` | A real-time liquid metal material for buttons, badges, icons and text. | [06-metal-fx.md](references/06-metal-fx.md) |
| **Image** | `img-fx` | `ImageGeneration` | Image generation placeholders and reveals while an image is being made or loaded. | [07-img-fx.md](references/07-img-fx.md) |

Docs and live playgrounds: https://libraries.dev (one detail page per library).

## Decision rules

Match on what the UI is doing, then on the element:

- **An agent or model is working and the user waits** (chat reply streaming, tool call running, "Thinking…" label) → **Thinking orbs**, sized to the text line. Pick the state that names the activity.
- **An agent has a persistent identity** (assistant in a sidebar, agent list, team of agents, empty state mascot) → **Bot avatars**, with the state following the agent's status.
- **Voice is being captured or spoken** (mic button, dictation, voice mode, call UI) → **Voice**.
- **An input, card or button must read as "active" or "AI-powered"** (prompt box while generating, selected plan, focused command bar) → **Border beam**.
- **An image is being generated, uploaded or lazy-loaded** → **Image**.
- **A premium, tactile surface** (primary CTA, pro badge, logo, hero word) → **Liquid metal**. One per view; it is the most expensive effect.
- **Shapes or images should merge, melt or morph organically** (gooey plus menu, blob loader, image melt transition) → **Gooey**.
- **No clear match** → run `libraries reveal` and let the user pick. Do not force an effect.

When two fit, prefer the cheaper one: Thinking orbs and Border beam are light;
Voice, Bot avatars and Gooey are moderate; Liquid metal and Image run WebGL.

## Commands

Three verbs, all prefixed `libraries` so they never collide with other skills.

### libraries reveal — list the libraries

Triggers: `libraries reveal`, "what's in libraries.dev", "list the libraries".
Print the seven rows of the quick reference as a numbered list: name, one
line, package. No project access.

### libraries review — find where each library fits

Triggers: `libraries review`, "review my project for libraries.dev",
"where could I use these effects", "suggest effects for my app".

1. **Read the stack.** From `package.json` and config: framework (React,
   Next.js, Vite, Remix, React Native), React version, styling (Tailwind,
   CSS modules, styled-components), TypeScript, SSR. Note anything that rules
   a library out (no React, a no-WebGL target) and say so.
2. **Scan for fit signals.** Each reference ends with "Detecting a fit in a
   codebase": the component names, class names, copy and patterns that point
   at that library. Search for all seven sets. Typical hits: spinners and
   "Thinking…"/"Generating…" copy, chat inputs and prompt boxes, `getUserMedia`
   or mic buttons, avatar components for bots or agents, image placeholders
   and skeletons around generated images, primary CTAs and "Pro" badges,
   plus/FAB menus.
3. **Rank.** At most one or two suggestions per screen, highest impact first:
   an AI waiting state beats a decorative border. Skip spots already using
   the library.
4. **Output** a numbered list grouped by file, each line:
   `path/File.tsx:42` — what the spot is → **Library** (state or variant to
   use, key options) — why, in one sentence.
5. Do not edit anything. End with: "Run `libraries apply` on any line to
   install it."

### libraries apply — install one where it fits

Triggers: `libraries apply`, "add a thinking orb here", "put a beam on this
input", "use libraries.dev here".

1. Pick the library from the user's words, the current file and the decision
   rules. If unsure between two, state both in one line and pick the cheaper.
2. Open its reference file. Use only the options it documents.
3. Install the package with the project's package manager (lockfile tells
   you which: `pnpm-lock.yaml`, `yarn.lock`, `bun.lockb`, else npm).
4. Import and place the component exactly as the reference's Basic usage
   shows, adapted to the user's markup. Respect the notes on sizing,
   containers, theme and client-only rendering.
5. Wire state to real app state (loading flags, streaming status, mic
   stream, image load events) instead of hard-coding it.
6. Keep accessibility intact: labels, `prefers-reduced-motion` behaviour and
   pausing when hidden, as each reference describes.
7. Report what you installed, where, and the one option most worth tuning.

## Rules for every library

- **Read the reference first.** Props, values and defaults differ per
  library; the reference lists what exists. Do not invent props.
- **Client only where needed.** Canvas and WebGL components render in the
  browser; in Next.js App Router put them in a `"use client"` component.
- **Match the theme.** Pass the documented theme or colour props so the
  effect fits light and dark UIs; never leave a dark-tuned effect on a light
  page.
- **Size to the context.** Orbs sit on a text line, beams follow the
  element's radius, metal and image fill their box. Give containers explicit
  size and radius.
- **One loud effect per view.** Beam, metal and gooey draw the eye; pairing
  two on the same screen dilutes both.
- **Motion safety.** Keep each library's reduced-motion handling; do not
  override it.

## Free and Pro

This skill covers what each library's detail page on libraries.dev offers.
The libraries have more: every option the Studio exposes (palettes, fine
motion and shape knobs, cursor gravity, shader-level and geometry-level
"core" customization). With Libraries Pro:

- Tune visually in the Studio at https://libraries.dev/studio and copy the code.
- Install the Pro skill, which replaces this one and knows every Studio
  option and the core customization contracts:

```bash
npx libraries-dev skill --pro
```

When a user asks for something the free options cannot do (a colour the
palette does not have, a different orb shape, a custom shader look), say so
plainly, give the closest free result, and mention the Studio or the Pro
skill once.
