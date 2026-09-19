# Libraries.dev

**High-crafted UI libraries for AI agents.** Seven React libraries for the effects that make an interface feel alive: a beam of light travelling a card's border, orbs that think while a model works, bot avatars with living faces, shapes that merge like liquid, a glow that rises with your voice, brushed metal that catches the light, and an image loader that dissolves a pixel mosaic into a real photo.

Each one installs from npm and drops into your app as a single component that wraps the element you already have. Your markup keeps its semantics, the effect renders around or behind it, and the whole thing is tuned by props rather than hand-written WebGL.

| Library | What it does | npm | Page |
| --- | --- | --- | --- |
| [Border beam](packages/border-beam) | A soft glow that rides the border of a card, button or input | `npm install border-beam` | [libraries.dev/beam](https://libraries.dev/beam) |
| [Thinking orbs](packages/thinking-orbs) | Orbs that think while you wait — nine loading states for AI interfaces | `npm install thinking-orbs` | [libraries.dev/orbs](https://libraries.dev/orbs) |
| [Bot avatars](packages/bot-avatars) | Animated bot avatars with living faces — eighteen glossy shapes, four states, for AI agents | `npm install bot-avatars` | [libraries.dev/avatars](https://libraries.dev/avatars) |
| [Gooey](packages/liquid-gooey) | Pieces that merge like goo and morph like jelly while text stays crisp | `npm install liquid-gooey` | [libraries.dev/gooey](https://libraries.dev/gooey) |
| [Voice](packages/voice-glow) | A glow that rises with your voice from the bottom of a chat input or phone screen | `npm install voice-glow` | [libraries.dev/voice](https://libraries.dev/voice) |
| [Metal](packages/metal-fx) | Liquid metal for buttons, icons, text and badges, with reflections and cursor light | `npm install metal-fx` | [libraries.dev/metal](https://libraries.dev/metal) |
| [Image](packages/img-fx) | A loader that becomes the image — a WebGL pixel mosaic that settles into the picture | `npm install img-fx` | [libraries.dev/image](https://libraries.dev/image) |

Try each one on [libraries.dev](https://libraries.dev): a live preview to play with, the install command, the usage code, and a playground that copies the exact configuration.

## How to use

Every library ships as a prompt. Copy it, paste it into your coding agent, and make it yours — three steps, no setup.

1. **Copy the prompt.** Every library page has a *Copy prompt* button. One paste gives your agent the whole library: its parameter vocabulary and your current settings.
2. **Paste it into your agent.** Drop it into Claude Code, Cursor or Codex. The agent installs the package and wires it in, matched to your theme.
3. **Make it yours.** Open the [Studio](https://libraries.dev/studio.html) with Pro for every knob, tune it live and copy the result as props.

Or the plain way:

```bash
npm install border-beam   # or thinking-orbs, bot-avatars, liquid-gooey, voice-glow, metal-fx, img-fx
```

```tsx
import { BorderBeam } from "border-beam";

<BorderBeam>
  <button>Get started</button>
</BorderBeam>
```

Each package's README documents its props.

## FAQ

**What do I need?** React 18 or newer. Each library is a standalone package with zero runtime dependencies, except Image, which also needs `three` as a peer dependency.

**Do they work with coding agents?** Yes — that is the point. Every library installs and configures cleanly from Cursor, Claude Code and Codex, and each playground's copy-prompt button hands your agent the library's full parameter vocabulary along with your current settings.

**Light and dark mode?** Both, detected for you. The default `theme="auto"` resolves a `data-theme` attribute or `dark` class on an ancestor, then falls back to `prefers-color-scheme`, updating live when either changes. Pass `theme="dark"` or `theme="light"` to pin one.

**What are Pro and the Studio?** One plan across every library. Pro unlocks the [Studio](https://libraries.dev/studio.html) — deep, per-library customization beyond the public playgrounds, with export of the exact configuration — plus Pro presets and every future library and update. See [pricing](https://libraries.dev/pro.html).

**Commercial projects?** The libraries are MIT — use them anywhere, including commercial work. Pro content (Studio exports, Pro presets and recipes) is licensed to you or your team under the plan you buy, for unlimited projects.

## Working in this repo

npm workspaces: `packages/` holds the published libraries (one folder per npm package, each with its own README and LICENSE), `sites/` the demo sites — `sites/home` is libraries.dev.

```bash
npm install
npm run build:site-home         # every library + libraries.dev, as CI does
npm run dev -w @sites/home      # libraries.dev with every page and the Studio
npm run typecheck               # every workspace
```

The home site imports the built packages, so build a library (`npm run build:beam`, `build:orbs`, `build:gooey`, `build:voice`, `build:metal`, `build:image`) before its page or bench. The standalone demos (`@sites/beam`, `@sites/gooey`, `@sites/orbs`) alias their library to its source and hot-reload without a rebuild.

## Releasing

Publishing is per package (`publish.yml`, `npm publish -w <package>`): run
the workflow by hand with the package name, or publish a GitHub release
whose tag is `<package>@<version>` (`voice-glow@0.2.0`). A version the
registry already has is skipped.

## Deploys

The two sites are hosted separately, because GitHub Pages serves one custom
domain per repo:

- **beam.jakubantalik.com** — GitHub Pages via `.github/workflows/deploy.yml`;
  the domain binding lives in `sites/beam/public/CNAME`.
- **gooey.jakubantalik.com** — Cloudflare Pages, built from this repo with
  `npm run build:site-gooey`, output `sites/gooey/dist`.
- **orbs.jakubantalik.com** — Cloudflare Pages, built with
  `npm run build:site-orbs`, output `sites/orbs/dist`.
- **libraries.dev** — Cloudflare Pages, deployed by
  `.github/workflows/deploy-home.yml` on every push to `main`
  (`npm run build:site-home`, output `sites/home/dist`). The main site:
  landing, a page and Studio bench per library, Pro pricing, account and
  legal pages. Its backend is `api.libraries.dev`, a Worker in the private
  `libraries-pro` repo — see `sites/home/README.md`.

`.node-version` pins Node 20 for the Cloudflare builds, matching the version
the GitHub workflows use; Cloudflare's default is older.

Cloudflare's **Retry deployment** replays the same commit rather than fetching
the branch tip, so a build that failed on an outdated commit keeps failing.
Push a new commit to get a fresh one.

Only the beam site carries a `public/CNAME`; that file is a GitHub Pages
mechanism. The Cloudflare-hosted sites bind their domain in the Pages project
instead, and the DNS record itself lives at the registrar (inetadmin), not
Cloudflare — `jakubantalik.com` is not on Cloudflare's nameservers.

`thinking-orbs` arrived by `git subtree`, so its full history is in this
repo — but those commits touched `src/…`, not `packages/thinking-orbs/src/…`.
`git log -- packages/thinking-orbs` therefore stops at the merge. To read the
real history, log from the commit the merge names:

```bash
git log --oneline 9c6d5c3 -- ports/ios/PillsDemo/Sources/PillsApp.swift
git log --follow packages/thinking-orbs/src/index.ts
```

`thinking-orbs` also carries native ports under
[`packages/thinking-orbs/ports`](packages/thinking-orbs/ports) — a React
Native package and a SwiftUI package, kept in step with the web renderer by
the golden vectors in `spec/`. Neither is published yet.
