# Libraries

React UI effects by [Jakub Antalik](https://github.com/Jakubantalik). Try every one on [libraries.dev](https://libraries.dev), tune it in the Studio, then install the package.

| Library | What it does | npm | Page |
| --- | --- | --- | --- |
| [Border beam](packages/border-beam) | A soft glow that rides the border of a card, button or input | `npm install border-beam` | [libraries.dev/beam](https://libraries.dev/beam) |
| [Thinking orbs](packages/thinking-orbs) | Orbs that think while you wait — nine loading states for AI interfaces | `npm install thinking-orbs` | [libraries.dev/orbs](https://libraries.dev/orbs) |
| [Gooey](packages/liquid-gooey) | Pieces that merge like goo and morph like jelly while text stays crisp | `npm install liquid-gooey` | [libraries.dev/gooey](https://libraries.dev/gooey) |
| [Voice](packages/voice-glow) | A glow that rises with your voice from the bottom of a chat input or phone screen | `npm install voice-glow` | [libraries.dev/voice](https://libraries.dev/voice) |
| [Metal](packages/metal-fx) | Liquid metal for buttons, icons, text and badges, with reflections and cursor light | `npm install metal-fx` | [libraries.dev/metal](https://libraries.dev/metal) |
| [Image](packages/img-fx) | A loader that becomes the image — a WebGL pixel mosaic that settles into the picture | `npm install img-fx` | [libraries.dev/image](https://libraries.dev/image) |

## Layout

```
packages/       published libraries — one folder per npm package
sites/          the demo site for each library
```

Each package owns its own README and LICENSE, because npm renders the readme
from the package directory rather than the repo root.

## Working on it

npm workspaces, so one install at the root covers everything:

```bash
npm install

npm run dev -w @sites/home      # libraries.dev: every library's page and the Studio
npm run dev -w @sites/beam      # the standalone beam demo
npm run dev -w @sites/gooey     # the standalone gooey demo
npm run dev -w @sites/orbs      # the standalone orbs demo
```

The standalone demos alias their library to its **source**, so editing a
library hot-reloads the site with no rebuild. The home site imports the
built packages, so build a library (below) before its page or bench.

```bash
npm run build:beam              # build one library
npm run build:orbs
npm run build:gooey
npm run build:voice
npm run build:metal
npm run build:image
npm run build:site-home         # every library + libraries.dev, as CI does
npm run build:site-beam         # a library + its standalone demo
npm run build:site-gooey
npm run build:site-orbs
npm run typecheck               # every workspace
```

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
