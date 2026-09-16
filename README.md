# Libraries

React libraries by [Jakub Antalik](https://github.com/Jakubantalik), and the sites that demo them.

| Package | npm | Demo |
| --- | --- | --- |
| [`border-beam`](packages/border-beam) — animated border beam | `npm install border-beam` | [beam.jakubantalik.com](https://beam.jakubantalik.com) |
| [`liquid-gooey`](packages/liquid-gooey) — liquid Morph & Move effects | `npm install liquid-gooey` | [gooey.jakubantalik.com](https://gooey.jakubantalik.com) |
| [`thinking-orbs`](packages/thinking-orbs) — dotted thought-orb loaders | `npm install thinking-orbs` | [orbs.jakubantalik.com](https://orbs.jakubantalik.com) |

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

npm run dev -w @sites/beam      # beam demo
npm run dev -w @sites/gooey     # gooey demo
npm run dev -w @sites/orbs      # orbs demo
```

Both sites alias the library to its **source**, so editing a library
hot-reloads its site with no rebuild.

```bash
npm run build:beam              # build one library
npm run build:gooey
npm run build:orbs
npm run build:site-beam         # library + its site, as CI does
npm run build:site-gooey
npm run build:site-orbs
npm run typecheck               # every workspace
```

## Releasing

Publishing is per package, triggered by a GitHub release (`publish.yml`),
which runs `npm publish -w <package>`.

## Deploys

The two sites are hosted separately, because GitHub Pages serves one custom
domain per repo:

- **beam.jakubantalik.com** — GitHub Pages via `.github/workflows/deploy.yml`;
  the domain binding lives in `sites/beam/public/CNAME`.
- **gooey.jakubantalik.com** — Cloudflare Pages, built from this repo with
  `npm run build:site-gooey`, output `sites/gooey/dist`.
- **orbs.jakubantalik.com** — Cloudflare Pages, built with
  `npm run build:site-orbs`, output `sites/orbs/dist`.
- **libraries.dev** — Cloudflare Pages, static (no build command), output
  `sites/home`. The umbrella site: landing, Pro pricing, account and legal
  pages. Its backend is `api.libraries.dev`, a Worker in the private
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
