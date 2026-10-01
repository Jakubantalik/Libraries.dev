# Bot avatars

Animated 3D bot avatars for AI agents: a plush, furry body (or glossy plastic) with a living face that looks around, blinks and hops while it works. React, drawn on a 2D canvas (no WebGL, no runtime dependencies). npm package `bot-avatars`.

## When to use

### Where it goes

The author's placement rules. Follow them before the general list below.

- **Anything avatar related for a bot or agent**: assistant avatars in a thread, agent lists and sidebars, agent pickers, job headers and empty-state mascots.
- The state follows the agent's real status (see the status mapping under Common mistakes).

More situations it fits:

- The avatar next to an assistant's reply in a chat thread: `working` while the model streams, idle once the answer lands.
- A roster or sidebar of agents, one body shape per agent, each showing whether it is busy.
- A status chip or header for a background job or agent run ("Booking the venue…").
- An agent picker or onboarding step where the user chooses a bot.
- Empty states and "your agent is on it" screens that need a small character instead of a spinner.

### When not to use

- Human user avatars. Use a photo or initials; these are bots.
- Places that must render with no JavaScript (emails, static OG images). The avatar paints on the client only.
- Dense tables with hundreds of rows animating at once. Each visible avatar is a live canvas.
- A plain loading indicator with no agent behind it. A spinner or skeleton says less and costs less.

## Install

```bash
npm install bot-avatars
pnpm add bot-avatars
yarn add bot-avatars
```

```tsx
import { BotAvatar } from 'bot-avatars';
```

- React component only (`<BotAvatar>` renders a `<canvas>`). Peer dependency: `react >= 18`.
- ESM (`dist/index.es.js`) and CommonJS (`dist/index.cjs`) builds, with types.
- No `"use client"` directive ships in the package. In the Next.js App Router, import it from a file that starts with `"use client"`.
- Server rendering works: the server emits an empty canvas, the avatar paints on the client after mount.

The detail page also has two ports, both local to the repo (not on npm):

- React Native: `bot-avatars-native` in `packages/bot-avatars/ports/react-native/bot-avatars-native`, needs `@shopify/react-native-skia react-native-reanimated react-native-worklets`. Expo needs `expo run:ios` / `run:android`.
- SwiftUI (iOS 17+): `BotAvatarsKit` in `packages/bot-avatars/ports/ios/BotAvatarsKit`, added as a local Swift package.

Neither port has the fur or the things to wear: both draw the glossy `plastic` look by default.

## Basic usage

React, as the page's Install & Usage tab gives it:

```tsx
import { BotAvatar } from 'bot-avatars';

<BotAvatar type="clover" state={busy ? 'working' : 'default'} />
```

React Native:

```bash
npm install @shopify/react-native-skia react-native-reanimated react-native-worklets
```

```tsx
import { BotAvatar } from 'bot-avatars-native';

<BotAvatar type="clover" state={busy ? 'working' : 'default'} size={64} />
```

SwiftUI:

```swift
// Package.swift, or Xcode: File > Add Package Dependencies > Add Local...
.package(path: "packages/bot-avatars/ports/ios/BotAvatarsKit")
```

```swift
import BotAvatarsKit

BotAvatar(type: .clover, state: busy ? .working : .default)
```

The playground's live snippet has this shape (only non-default props are written):

```tsx
import { BotAvatar } from 'bot-avatars';

<BotAvatar type="star" state="working" size={96} />
```

## Options (free)

| Prop | Values | Default | What it does |
| --- | --- | --- | --- |
| `type` | `"clover"`, `"flower"`, `"star"`, `"ghost"`, `"mech"`, `"circle"`, `"hexagon"`, `"square"` | `"clover"` | Body shape. Each type has its own body colour. |
| `state` | `"default"`, `"working"` | `"default"` | `default` is idle: looks from corner to corner, blinks, a jump with a full turn now and then. `working` hops, spins every third hop, smiles and laughs now and then. |
| `size` | `96`, `64`, `32` (px) | `64` | Layout size of the avatar box. Also accepts any CSS length string. |
| `shading` | `"fabric"`, `"plastic"` | `"fabric"` | The body's material. `fabric` is a plush faux fur, like a toy's, under a studio light: a soft pile, a bright rim from a light behind, a fuzzy silhouette and glossy bead eyes. `plastic` is a glossy material shaded per pixel, with a hot spot, a sheen and a rim (the default before 0.2.0). |
| `paused` | `true` / `false` | `false` | Freezes the animation on its current frame. |

Tuner to props: the Type, State, Size and Shading tabs set `type`, `state`, `size` and `shading`. The State tab label "Idle" is the value `"default"`. Fabric is the default, so the snippet drops it; Plastic writes `shading="plastic"`. Crisp, Smooth and Flat are shown on the Shading tab but locked. The Hat and Glasses rows show every choice locked except None, so they change nothing. The Play / Pause button on the stage toggles `paused`; the playground loads paused, so its snippet carries `paused` until you press Play. The playground starts at 96 px; the snippet drops `size` at 64 because 64 is the package default, and drops `state` at `"default"`.

State changes are cross-animated: the rig eases from the old pose to the new one, so toggling `state` on every token or tool call is safe.

## Recipes

Thinking state in a chat reply. Use when an assistant message streams in.

```tsx
import { BotAvatar } from 'bot-avatars';

function AssistantMessage({ streaming, children }: { streaming: boolean; children: React.ReactNode }) {
  return (
    <div className="msg msg--bot">
      <BotAvatar type="clover" state={streaming ? 'working' : 'default'} size={32} />
      <div className="msg-body">{streaming ? 'Thinking…' : children}</div>
    </div>
  );
}
```

Agent roster. Use when a sidebar lists several agents and shows which ones are running.

```tsx
import { BotAvatar, type BotAvatarType } from 'bot-avatars';

type Agent = { id: string; name: string; avatar: BotAvatarType; busy: boolean; status: string };

function Roster({ agents }: { agents: Agent[] }) {
  return (
    <ul className="roster">
      {agents.map((a) => (
        <li key={a.id}>
          <BotAvatar type={a.avatar} state={a.busy ? 'working' : 'default'} size={32} />
          <span>{a.name}</span>
          <span className="muted">{a.status}</span>
        </li>
      ))}
    </ul>
  );
}
```

Each instance offsets its blink timing from its React id, so a row never blinks in unison.

Wake on hover. Use for a team row or agent picker where the hovered bot comes alive.

```tsx
import { useState } from 'react';
import { BotAvatar, type BotAvatarType } from 'bot-avatars';

const TEAM: BotAvatarType[] = ['clover', 'flower', 'ghost', 'square'];

function Team() {
  const [hot, setHot] = useState<BotAvatarType | null>(null);
  return (
    <div className="team">
      {TEAM.map((t) => (
        <button key={t} onPointerEnter={() => setHot(t)} onPointerLeave={() => setHot(null)}>
          <BotAvatar type={t} state={hot === t ? 'working' : 'default'} size={96} />
        </button>
      ))}
    </div>
  );
}
```

Still avatar in a settings card. Use when the bot identifies an agent but should not move (profile, config page).

```tsx
<BotAvatar type="hexagon" size={96} paused />
```

Job header. Use for the header of a long-running agent task.

```tsx
<header className="job">
  <BotAvatar type="mech" state={job.status === 'running' ? 'working' : 'default'} size={64} />
  <h2>{job.title}</h2>
</header>
```

## Accessibility & performance

- The canvas has `role="img"` and a per-state `aria-label` by default: "Clover bot, idle", "Clover bot, working". Pass your own `aria-label` (for example the agent's name and status) and it replaces the default.
- Every other prop is passed straight to the `<canvas>`: `className`, `style`, `data-*`, `aria-*`, event handlers. When the agent's name and status are already shown as text beside the avatar, make it decorative with `aria-hidden` so screen readers do not read them twice.
- `prefers-reduced-motion: reduce`: no animation loop runs; the still pose of the current state is drawn. The media query is checked when the component renders, not watched live.
- `paused` stops the loop entirely (no per-frame cost).
- One shared `requestAnimationFrame` loop serves every avatar on the page. Each avatar leaves it when scrolled offscreen (IntersectionObserver), and the loop stops while the tab is hidden.
- Device pixel ratio is capped at 2.
- The default look (`fabric`) is a fur pile over a per-pixel material. The first time a body type appears, its form is baked (a few ms) and then its pile (30–50 ms, in small steps), both on idle time and shared by every avatar of that type; a softer look stands in for those frames. A paused or reduced-motion avatar shows the softer look too and is redrawn once its pile lands. `plastic` bakes the form only.
- Clicking an avatar makes it hop and turn round, and its eyes follow a nearby pointer. This is on by default; your own `onClick` still runs.
- Hydration: the server output is an empty `<canvas>` with the same attributes, so there is no mismatch. Nothing paints until JavaScript runs.

## Common mistakes

- Clipping the hop. The canvas is drawn 1.5x the `size` box and pulls itself back with negative margins, so the layout stays exactly `size` square while a hop or flip goes outside it. A tight parent with `overflow: hidden` crops the jump. Leave room above the avatar.
- Sizing with CSS. Set `size`, not `width`/`height`/`margin` in `style` or a class. Those override the overscan box and the negative margins, and the avatar shifts or crops.
- Importing it into a React Server Component. The component uses hooks; put it behind a `"use client"` file.
- Passing an unknown `state` string. It falls back to `"default"` silently. Map your app's statuses yourself:

  | App status | Free props |
  | --- | --- |
  | `running`, `streaming`, `pending`, `busy` | `state="working"` |
  | `idle`, `ready`, `online` | `state="default"` |
  | `offline`, `away`, `disabled` | `state="default"` with `paused` (a still bot) |

  A dedicated `sleeping` state for offline agents exists in the Pro options.
- Expecting the glossy look of 0.1. Since 0.2.0 the default is `fabric`, the plush fur; pass `shading="plastic"` for a glossy body. Leave the light props unset when you switch: each shading has its own default light (`fabric`: `shadow` 1.15, `highlight` 1.45, `light` 295, `rim` 0.6, `spread` 1.6; the others 0.35, 1.3, 300, 0.5, 1.55), and `rim` and `spread` mean different things in each (the back light and how far the light wraps in `fabric`, the Fresnel rim and the highlight's width in `plastic`).
- Putting the avatar inside a clickable row and being surprised by the hop. A click on the avatar itself triggers it; clicks on the row around it do not.
- Expecting a state to hold a loop: `working` shows while the prop says so. Drive it from your real status (streaming flag, job status), not from a timer.

## Detecting a fit in a codebase

| Signal to grep for | Suggest |
| --- | --- |
| `role === 'assistant'`, `message.role`, `AssistantMessage`, `BotMessage` | A `BotAvatar` next to assistant turns, `working` while `isStreaming` / `isLoading`. |
| Copy like `Thinking…`, `Working…`, `Generating`, `typing indicator`, three-dot loaders | Pair the text with `state="working"` on the reply's avatar. |
| Icon imports: `Bot` / `BotIcon` (lucide-react), `FaRobot`, `RiRobotLine`, `CpuChipIcon`, `Sparkles` as an assistant avatar, the robot emoji (U+1F916) | Replace the static icon with `<BotAvatar size={32} />`. |
| `agents.map(`, `AgentList`, `AgentCard`, `workers`, `assistants` arrays | A roster with one `type` per agent and `state` from each agent's status. |
| `status === 'running'`, `job.status`, `isPending`, `inProgress` next to an agent or task header | `state={running ? 'working' : 'default'}` in the header. |
| `<Avatar` components fed a placeholder for bots (`src="/bot.png"`, `fallback="AI"`) | Swap in `BotAvatar` for the bot case only. |
| Empty states for agent pages ("No runs yet", "Your agent is ready") | A 96 px idle avatar as the illustration. |

## Go further (Pro)

- The Studio unlocks the other ten body types and the `sleeping` state (head down, shut lids, slow breaths) for offline or scheduled agents.
- Face, body colour, face ink, brightness and saturation (up to 2.5, more vivid than the palette; some types carry their own brightness and saturation), plus the other shading modes (`crisp`, `smooth`, `flat`) and the lighting: shadow, highlight, light angle, depth, rim, spread and `roundness` (a cushion toward a slab).
- The fur's style (`furLength`, `furDensity`, `furFuzz`, `furClumps`, `furCurl`, `furGravity`) and its studio light (`backLight`, `lightFront`, `shine`, `backSoftness`, `sheen`).
- Things to wear: `hat` (`beret`, `beanie`, `party`, `crown`), `glasses` (`round`, `square`, `shades`), `headphones` and `bowTie`, in an `accessoryColor`.
- A body outline of your own (`path`, SVG path data in a 100×100 box) and turning the avatar round by hand (`pose`, usually with `paused`).
- Motion: speed, blink seed, side turn, pointer following and a whirl ring round a spin.
- A full Jump group: height, air time, squash and stretch, ground and rise timing with easings.

Tune it visually in the Studio at https://libraries.dev/studio, or install the Pro skill.
