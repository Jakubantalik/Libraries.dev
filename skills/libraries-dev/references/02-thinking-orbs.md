# Thinking orbs

`ThinkingOrb` from `thinking-orbs`: a small dotted 3D orb on a 2D canvas that shows what an AI agent is doing, with nine hand-tuned animated states.

## When to use

### Where it goes

The author's placement rules. Follow them before the general list below.

- **Any loading state**, usually beside a text label ("Thinking…", "Searching the web…"), or on its own where there is no room for text.
- **Not for loading under 2 seconds.** A flash of an orb reads as a glitch; show nothing or the result directly.
- Pick the `state` that names the activity (see the table under Options).

More situations it fits:

- Assistant avatar while a chat reply is being generated (`breathing`, `composing`).
- Inline status next to an agent step or tool call: "Searching the web…", "Running code…", "Reading files…" (size 20).
- Web search, retrieval or lookup in progress (`searching`).
- Code execution, math or a multi-step solve (`solving`, `working`).
- Voice input or dictation while the mic is open (`listening`).
- Connecting to a service, an MCP server, or wiring data sources (`connecting`).
- Planning steps before an agent acts (`weaving`; the page's example chip labels it "planning").
- Replacing a generic spinner, `Loader2 animate-spin` icon or three-dot typing indicator in an AI UI.

### When not to use

- Determinate progress (uploads, known step counts). Use a progress bar; the orb has no progress value.
- Page or route skeletons. The orb says "an agent is busy", not "layout is loading".
- Large hero visuals. The tuned sizes are 64 and 20 CSS px; scaling the canvas up with CSS blurs it.
- Many simultaneous orbs in a long list (dozens of canvases animating). Show one per active step.

## Install

```bash
npm install thinking-orbs
pnpm add thinking-orbs
yarn add thinking-orbs
```

```tsx
import { ThinkingOrb } from 'thinking-orbs';
```

- React component rendering a `<canvas>`. Peer dependency: `react >= 18`. No other runtime dependencies.
- ESM and CJS builds, TypeScript types included.
- SSR: the canvas renders empty on the server and paints on the client in effects. The package does not ship a `"use client"` directive, so in the Next.js App Router import it from a file marked `"use client"`.
- React Native and SwiftUI ports exist in the repo (see Basic usage). They are not on npm.

## Basic usage

React (the detail page's Install & Usage tab):

```tsx
import { ThinkingOrb } from 'thinking-orbs';
<ThinkingOrb state="searching" size={64} />
```

The playground's live snippet has the same shape:

```tsx
import { ThinkingOrb } from 'thinking-orbs';

<ThinkingOrb state="listening" size={64} />
```

With Cursor gravity switched on, the playground snippet becomes:

```tsx
import { ThinkingOrb } from 'thinking-orbs';
// A raster of the platform's own pointer — see the Gravity docs.
import { macArrow } from './cursors';

<ThinkingOrb state="listening" size={64} gravity={{ sprite: macArrow }} />
```

`./cursors` is your own file. The package does not ship a pointer image (see Cursor gravity below).

React Native tab (package lives in the repo at `packages/thinking-orbs/ports/react-native/thinking-orbs-native`, not on npm; Expo needs `expo run:ios` / `run:android`):

```bash
npm install thinking-orbs-native @shopify/react-native-skia react-native-reanimated
```

```tsx
import { ThinkingOrb } from 'thinking-orbs-native';
<ThinkingOrb state="searching" size={64} />
```

SwiftUI tab (local Swift package):

```swift
// Package.swift — or Xcode: File › Add Package Dependencies… › Add Local…
.package(path: "packages/thinking-orbs/ports/ios/ThinkingOrbsKit")
```

```swift
import ThinkingOrbsKit
ThinkingOrb(state: .searching, size: .px64)
```

## Options (free)

| Prop | Values | Default | What it does |
| --- | --- | --- | --- |
| `state` | `"working"`, `"searching"`, `"solving"`, `"listening"`, `"connecting"`, `"composing"`, `"breathing"` (tuner tabs); `"weaving"`, `"shaping"` (shown in the page's examples and Copy prompt) | `"working"` | Which animation plays. Each state is its own design, not a variation. |
| `size` | `64`, `20` | `64` | Tuned size preset in CSS px. 64 is chat-avatar scale, 20 is inline-text scale. Each has its own dot count, dot size and speed. |
| `gravity` | off, or `{ sprite }` | off | Cursor gravity: near the orb, the pointer's body bends and trails toward it. Needs a pointer raster (`sprite`). |
| `paused` | `true`, `false` | `false` | Freezes the animation on the current frame (the playground's Play / Pause button). |
| `theme` | `"auto"`, `"dark"`, `"light"` | `"auto"` | Ink for the background. `dark` draws light dots for dark backgrounds, `light` draws dark dots for light ones. |

What each state looks like (from the package types):

| State | Animation | Fits |
| --- | --- | --- |
| `working` | particles on tilted orbits | generic agent work, tool running |
| `searching` | a scan meridian sweeps a dotted globe | web search, retrieval, lookup |
| `solving` | bands scramble in quarter turns, then click back | code execution, math, debugging |
| `listening` | a waveform rolls through latitude rings | mic open, dictation, voice mode |
| `connecting` | a constellation wires itself, packets on the edges | connecting services, linking sources |
| `weaving` | three strands plait around the sphere | planning, combining results |
| `composing` | an undulating multi-band sash | writing, drafting, generating text |
| `breathing` | a face-on ring slowly morphing | idle "Thinking…", reasoning |
| `shaping` | a dotted outline morphs circle, triangle, square | designing, building layouts |

Tuner to props: the "State" tabs set `state`, the "Size" tabs (64px / 20px) set `size={64}` / `size={20}`, "Cursor gravity" On adds `gravity={{ sprite: macArrow }}`, and the stage's Play / Pause button maps to `paused`. The page's Copy prompt lists a `dark: boolean` prop; that prop does not exist. Use `theme="dark"` or `theme="light"`. The component also passes through every `<canvas>` prop (`className`, `style`, `aria-label`, `data-*`).

`theme="auto"` resolves in order: an ancestor `data-theme="dark|light"` attribute or a `dark` / `light` class (Tailwind and shadcn convention, watched live), then `prefers-color-scheme` (subscribed live).

### Cursor gravity

`gravity` takes `{ sprite }`, where `sprite` is a `CursorSprite` exported as a type from the package:

```ts
import type { CursorSprite } from 'thinking-orbs';

// cursors.ts: a raster of YOUR platform's real arrow pointer.
// Size and hotspot below are the macOS arrow's (17x23 pt, hotspot 4,4).
export const macArrow: CursorSprite = {
  src: '/cursors/arrow@2x.png', // image URL or data: URL
  width: 17,  // CSS px
  height: 23, // CSS px
  hotX: 4,    // click point, CSS px
  hotY: 4,
};
```

- The raster must match the OS pointer pixel for pixel, or the swap is visible. Without a sprite the effect stays off.
- The detail page only ships a macOS arrow, so its toggle only shows on a Mac ("Draws the macOS pointer, so it only shows on a Mac."). Gate it the same way: turn it on only where your sprite is the platform pointer.
- Off by default. Only the plain arrow is replaced; over buttons and text fields the OS cursor is left alone.

## Recipes

Assistant avatar while a reply streams. Use when: a chat message is pending and the assistant row needs a live indicator.

```tsx
import type { ReactNode } from 'react';
import { ThinkingOrb } from 'thinking-orbs';

function AssistantAvatar({ pending, avatar }: { pending: boolean; avatar: ReactNode }) {
  return pending ? <ThinkingOrb state="breathing" size={64} aria-label="Assistant is thinking" /> : <>{avatar}</>;
}
```

Inline agent-step chip. Use when: a tool call or agent step renders as a line of text.

```tsx
import { ThinkingOrb, type OrbState } from 'thinking-orbs';

const STEP_STATE: Record<string, OrbState> = {
  web_search: 'searching',
  run_code: 'solving',
  read_files: 'working',
  connect: 'connecting',
  plan: 'weaving',
  write: 'composing',
};

function StepChip({ tool, label }: { tool: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {/* the text already says what is happening, so hide the canvas from screen readers */}
      <ThinkingOrb state={STEP_STATE[tool] ?? 'working'} size={20} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
```

Pill with a 56px orb. Use when: a status pill needs a slightly smaller orb than 64. This is how the detail page's example pills are built: render the 64 preset and set the CSS box.

```tsx
<span className="pill">
  <ThinkingOrb state="composing" size={64} theme="dark" style={{ width: 56, height: 56 }} />
  <span>Thinking…</span>
</span>
```

Mic open. Use when: a voice input is recording.

```tsx
function MicStatus({ isRecording }: { isRecording: boolean }) {
  return <ThinkingOrb state="listening" size={20} paused={!isRecording} aria-label="Listening" />;
}
```

Pinned theme on a fixed dark surface. Use when: the orb sits on a dark panel inside an otherwise light app, so `auto` would pick the wrong ink.

```tsx
<div className="bg-neutral-900 rounded-xl p-3">
  <ThinkingOrb state="searching" size={64} theme="dark" />
</div>
```

## Accessibility & performance

- The canvas gets `role="img"` and a default `aria-label` per state: "Working…", "Searching…", "Solving…", "Listening…", "Connecting…", "Weaving…", "Composing…", "Thinking…" (breathing), "Shaping…". Pass `aria-label` to describe the real task, or `aria-hidden="true"` when adjacent text already says it.
- It is not a live region. If the status change must be announced, put the text in your own `role="status"` element.
- `prefers-reduced-motion: reduce`: one static frame, no animation loop. It still follows the live theme.
- Each instance pauses its `requestAnimationFrame` loop when offscreen (`IntersectionObserver`) and when the tab is hidden. All instances share one clock, so they resume in phase.
- Plain 2D canvas arcs only: no WebGL, no `ctx.filter`, no SVG filters. Device pixel ratio is capped at 2.
- Gravity turns itself off under reduced motion, forced colors, coarse or touch pointers, and page zoom. It hides the OS cursor while the pointer is near an orb. A user with an enlarged accessibility pointer sees it swap to the stock size, so offer a way to turn gravity off.

## Common mistakes

- Wrong ink for the background. `auto` reads ancestor `data-theme` / `.dark` / `.light` first, then the OS setting. An orb on a dark card in a light app renders dark dots on dark. Pin `theme`.
- Sizing with CSS instead of `size`. The canvas backing store is sized from `size`, so `style={{ width: 200 }}` on a 64 orb blurs it. Stay within a few px of the preset (the page uses 56 on a 64 orb). Only `64` and `20` are offered here.
- Passing `dark`. It is not a prop (the page's Copy prompt says it is). Use `theme`.
- Gravity without a sprite, or with a sprite that is not the platform's pointer. No sprite means nothing happens; a mismatched raster makes the cursor visibly change shape. The page's arrow is macOS only.
- Next.js App Router: importing it into a Server Component fails because it uses hooks. Wrap it in a `"use client"` file.
- Leaving an orb mounted and animating after the work finishes. Unmount it or set `paused` when the step completes.

## Detecting a fit in a codebase

| Signal to grep for | Suggest |
| --- | --- |
| Waits under 2 s: optimistic updates, cached or local reads, quick toggles | Nothing. Do not add an orb |
| `Thinking…`, `Thinking...`, `isThinking`, `reasoning` in chat components | `breathing` at 64 in the assistant avatar slot |
| `Loader2` with `animate-spin`, `<Spinner`, `CircularProgress` near chat or agent code | the orb state that names the activity, size 20 inline |
| Typing indicators: `TypingIndicator`, `typing-dots`, three bouncing dots CSS | `composing` or `breathing` |
| Vercel AI SDK `useChat` with `status === 'submitted'` or `'streaming'`, `isLoading` | orb while pending, removed on first token or on finish |
| Tool call rendering: `toolInvocations`, `tool-call`, `part.type === 'tool-...'`, `web_search`, `browse` | `searching` for search tools, `solving` for code tools, `working` otherwise |
| `Searching`, `Browsing`, `Retrieving`, RAG or vector search calls | `searching` |
| `Connecting`, MCP client setup, OAuth "linking" steps | `connecting` |
| `Planning`, `plan` steps in agent traces | `weaving` |
| `getUserMedia`, `MediaRecorder`, `SpeechRecognition`, mic buttons | `listening` while recording |
| `Generating`, `Writing`, `Drafting` labels | `composing` |

## Go further (Pro)

- The 32px size, a speed control, and all nine states in the tuner.
- Ink colour swatches or any hex, dot density and dot size.
- Per-state effect settings (orbit paths, scan, wiring, plait, sash, a held shape) and the full Cursor gravity tuning.
- Rebuilding a state's geometry with the Studio agent.

Tune it visually in the Studio at https://libraries.dev/studio, or install the Pro skill.
