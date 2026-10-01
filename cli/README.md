# libraries-dev

Installs the Libraries.dev agent skill. The skill teaches your coding agent
(Claude Code, Cursor, Codex and others that read skills) to use the seven
Libraries.dev libraries correctly and to suggest where each one fits in your
project:

Border beam, Thinking orbs, Gooey, Voice, Bot avatars, Liquid metal, Image.

## Free skill

```bash
npx libraries-dev skill
```

Covers each library's install, usage and the options its detail page on
libraries.dev offers. No account needed. Installs to `~/.claude/skills/libraries-dev`
(`--project` for `./.claude/skills`, `--dir <path>` for anywhere).

The same skill installs into other agents with the skills CLI:

```bash
npx skills add Jakubantalik/Libraries.dev
```

## Pro skill

```bash
npx libraries-dev skill --pro
```

For Libraries Pro members. Signs you in through the browser the first time,
then installs `libraries-pro`: every option the Studio exposes, palettes,
cursor gravity, and the core customization contracts for rebuilding an
effect's geometry or shader.

It goes wherever the free skill is installed, in this project and in your
home folder, whichever agents `npx skills add` set it up for (`.agents/skills`
for Cursor and Codex, `.claude/skills`, and so on, including symlinked
copies), and removes the free copies it replaces (`--keep-free` to keep both).
With no free copy it installs to `~/.claude/skills`; `--project` or `--dir`
choose the folder yourself. Run it again to update.

## Using it

Ask your agent:

- "Review my project for libraries.dev effects" (`libraries review`)
- "Add a thinking orb to the chat reply" (`libraries apply`)
- Pro: "Make the beam match our brand colours" (`libraries match`), "calmer,
  slower orb" (`libraries tune`), "make the orb a cube" (`libraries core`)

## Commands

| Command | What it does |
| --- | --- |
| `skill` | Install the free skill |
| `skill --pro` | Install the Pro skill (signs in if needed) |
| `login` / `logout` / `whoami` | Manage the Pro sign-in |

Docs: https://libraries.dev/how-to-use
