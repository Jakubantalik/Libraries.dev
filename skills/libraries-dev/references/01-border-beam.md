# Border beam

An animated glow that rides the border of a card, button or input. It is a React wrapper component, pure CSS layers plus a small shared rAF loop for the pulse types. npm package `border-beam`.

## When to use

- An AI chat input or composer while the model is streaming or an agent is working: `size="md"` with `active={isStreaming}`.
- A search bar while results load: `size="line"` puts a travelling glow on the bottom edge only.
- A small icon button or pill that starts an AI action ("Generate", sparkle button): `size="sm"`.
- A card that needs attention without motion around the edge (a pending approval, the selected plan): `size="pulse-inner"` breathes inside the border.
- A hero or pricing card that should glow outward: `size="pulse-outside"` blooms a halo beyond the element.

The two families:

| Family | Types (`size`) | Motion |
| --- | --- | --- |
| Rotate | `md` (Large), `line`, `sm` | A beam travels around the border (`line`: along the bottom edge) |
| Pulse | `pulse-inner`, `pulse-outside` | No travel; the glow breathes in place |

### When not to use

- Static emphasis that never changes state. A plain border or shadow says the same thing with no paint cost.
- Many instances on one screen (every row of a list or table). Each beam repaints masked, filtered layers every frame.
- Elements whose content must spill outside their box (open dropdowns, tooltips, focus rings drawn outside). Every type except `pulse-outside` clips the wrapper with `overflow: hidden`.
- Non-React stacks on the web. The web package is React only.

## Install

```bash
npm install border-beam
pnpm add border-beam
yarn add border-beam
```

```tsx
import { BorderBeam } from 'border-beam';
```

- React component. Peer dependencies: `react >= 18`, `react-dom >= 18`. No runtime dependencies.
- ESM (`dist/index.es.js`) and CommonJS (`dist/index.cjs`) builds, with types. A default export is also provided.
- The package ships no `"use client"` directive and uses hooks. In the Next.js App Router, render it from a file that starts with `"use client"`.
- Server rendering works: instance ids come from `useId`, and the component renders its own `<style>` tag.

The detail page also lists two ports, both local to the repo (not on npm):

- React Native: `border-beam-native` in `packages/border-beam/ports/react-native/border-beam-native`. Needs `@shopify/react-native-skia` and `react-native-reanimated`. Expo needs `expo run:ios` / `run:android` (native modules).
- SwiftUI: `BorderBeamKit` in `packages/border-beam/ports/ios/BorderBeamKit`, added as a local Swift package. Build through Xcode; the Metal shader is compiled by Xcode's build system, not SwiftPM alone.

## Basic usage

React (the detail page's Install & Usage tab):

```tsx
import { BorderBeam } from 'border-beam';

<BorderBeam>
  <YourCard>Content</YourCard>
</BorderBeam>
```

React Native:

```bash
npm install border-beam-native @shopify/react-native-skia react-native-reanimated
```

```tsx
import { BorderBeam } from 'border-beam-native';

<BorderBeam>
  <Card />
</BorderBeam>
```

SwiftUI:

```swift
// Package.swift — or Xcode: File › Add Package Dependencies… › Add Local…
.package(path: "packages/border-beam/ports/ios/BorderBeamKit")
```

```swift
import BorderBeamKit

BorderBeam(
    borderRadius: 16
) {
    Card()
}
```

The ports do not auto-detect the child's corner radius, so pass `borderRadius` there. The web component detects it.

The playground's live snippet keeps only non-default props. For example, Line + Mono:

```tsx
<BorderBeam size="line" colorVariant="mono">
  <Card>Content</Card>
</BorderBeam>
```

## Options (free)

| Prop | Values | Default | What it does |
| --- | --- | --- | --- |
| `size` | `"md"`, `"line"`, `"pulse-inner"`, `"pulse-outside"` (tuner); `"sm"` (Copy prompt) | `"md"` | Beam type. `md` full-border travelling beam, `line` bottom-edge travelling glow, `sm` compact beam for button-sized elements, `pulse-inner` breathes inside the border, `pulse-outside` blooms outward |
| `colorVariant` | `"colorful"`, `"mono"` (tuner); `"ocean"`, `"sunset"` (Copy prompt) | `"colorful"` | Palette. `colorful` full spectrum, `mono` grayscale (always static, softer), `ocean` blues and purples, `sunset` oranges and reds |
| `active` | `true`, `false` (Play / Pause) | `true` | Runs the effect. Switching fades in (0.6 s) or out (0.5 s); when off, no effect layers render |
| `strength` | `0` to `1` (Copy prompt) | `1` | Opacity of the beam layers only. Never dims the wrapped content |
| `theme` | `"dark"`, `"light"` (Copy prompt) | `"dark"` | Tunes glow colours and blending for a dark or light surface. The package types also accept `"auto"`, which follows `prefers-color-scheme` |

Tuner to props: **Family** is not a prop. It only switches which **Type** tabs show (Rotate: Large = `md`, Line = `line`; Pulse: Pulse Inner, Pulse Outside). **Type** sets `size`. **Color** sets `colorVariant`. **Play / Pause** sets `active`. The stage is always `theme="dark"`. The page's "Copy prompt" text adds `sm`, `ocean`, `sunset`, `strength` and `theme`. The web component also forwards any standard `<div>` attribute (`className`, `style`, `id`, `data-*`, `ref`) to the wrapper.

## Recipes

Chat composer while the model streams. Use when an input should show "the assistant is working" without a separate spinner.

```tsx
import { BorderBeam } from 'border-beam';

function Composer({ isStreaming }: { isStreaming: boolean }) {
  return (
    <BorderBeam active={isStreaming} strength={0.8}>
      <form className="composer" style={{ borderRadius: 16, background: '#1d1d1d' }}>
        <textarea placeholder="Ask anything" aria-busy={isStreaming} />
      </form>
    </BorderBeam>
  );
}
```

Search bar while searching. Use when a single-line field is fetching results.

```tsx
<BorderBeam size="line" active={isSearching}>
  <div className="search" style={{ borderRadius: 20, background: '#1d1d1d' }}>
    <input type="search" placeholder="Search" />
  </div>
</BorderBeam>
```

AI action button. Use for a compact "Generate" or sparkle button that should read as AI-powered.

```tsx
<BorderBeam size="sm" colorVariant="ocean" style={{ display: 'inline-block' }}>
  <button className="ai-btn" style={{ borderRadius: 18, background: '#1d1d1d' }}>
    Generate
  </button>
</BorderBeam>
```

Card awaiting a decision, on a light page. Use for a pending approval or a highlighted item where travelling motion would be too loud.

```tsx
<BorderBeam size="pulse-inner" colorVariant="mono" theme="light" strength={0.7}>
  <article className="approval-card" style={{ borderRadius: 12, background: '#fff' }}>
    Agent wants to send 3 emails. Approve?
  </article>
</BorderBeam>
```

Featured pricing card with an outward halo. Use when one card in a row should stand out.

```tsx
<BorderBeam size="pulse-outside" colorVariant="sunset">
  <div
    className="plan plan--featured"
    style={{ borderRadius: 16, background: '#1d1d1d', border: '1px solid rgba(255,255,255,0.1)' }}
  >
    Pro plan
  </div>
</BorderBeam>
```

## Accessibility & performance

- Rotate types (`md`, `sm`, `line`) do not handle `prefers-reduced-motion`. Handle it yourself by turning the beam off:

```tsx
import { useEffect, useState } from 'react';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

// <BorderBeam active={isStreaming && !reduced}>
```

- Pulse types (`pulse-inner`, `pulse-outside`) ship a `prefers-reduced-motion: reduce` block that sets `animation: none` on every layer, including the fade-in. The glow then never becomes visible, and the breathing loop is not started. Pair it with a non-motion cue if the glow carries meaning.
- The effect is decorative. Layers are `::before`, `::after` and an empty `<div data-beam-bloom>`, all `pointer-events: none`. The component sets no ARIA. Put state on the real control (`aria-busy`, a visible "Thinking…" label, a live region).
- Offscreen instances pause. An `IntersectionObserver` (256 px margin) sets `data-paused`, which pauses every CSS animation, and unregisters pulse instances from the loop.
- Pulse breathing runs on one shared `requestAnimationFrame` loop capped near 30 fps for all instances. Rotate types animate registered CSS custom properties (`@property`).
- Paint cost comes from masks, conic/radial gradients and blur filters redrawn every frame. Keep a handful of live beams per screen. Set `active={false}` when the state ends; inactive beams render no layers.
- `@property` is needed for smooth motion (Chrome 85+, Safari 15.4+, Firefox 128+). Older browsers step instead of interpolating.
- SSR: with `theme="auto"`, the server renders the dark styles and the client's first render may pick light, which can cause a hydration mismatch. Prefer an explicit `theme` driven by your own theme state.

## Common mistakes

- **The wrapper is a plain block `<div>`.** The beam draws on the wrapper's edge, not the child's. In normal block flow the wrapper stretches to full width while a button or fixed-width card stays narrow. Place it in a flex or grid parent, give it `style={{ display: 'inline-block' }}` or `width: 'fit-content'`, or make the child fill the wrapper.
- **Most types clip.** `md`, `sm`, `line` and `pulse-inner` set `overflow: hidden` and the border radius on the wrapper. A child's `box-shadow`, an open dropdown, or an outside focus ring gets cut. Put the shadow on the wrapper (`className` or `style`), and portal popovers out.
- **Corner radius comes from the first child.** The component reads `border-top-left-radius` of the wrapper's first element child. If that element is not the rounded one, or has no radius, the beam falls back to 16 px (`sm`: 32 px) and the corners do not line up. Put the rounded element directly inside `<BorderBeam>`.
- **Copying the playground while paused.** The playground starts paused, so its snippet contains `active={false}`, which renders nothing. Drop that prop or drive it from state.
- **Transparent child with `pulse-outside`.** Its core and halo sit behind the content (`z-index: -1`) and spill outward (`overflow: visible`). The child needs an opaque background, a 1 px border (it rides the child's own edge), and ancestors that do not clip the halo.
- **Wrong theme on light surfaces.** The default is `"dark"`. On a white card, set `theme="light"`. The dark tuning looks washed out there.

## Detecting a fit in a codebase

| Signal to grep for | Suggest |
| --- | --- |
| Chat composers: `<textarea` next to `onSubmit`, `ChatInput`, `Composer`, `PromptInput`, `useChat`, `isStreaming`, `isLoading`, `status === 'streaming'` | `md` beam around the composer with `active={isStreaming}` |
| Copy like `Thinking…`, `Generating`, `Working…`, `Agent is running`, `aria-busy` on a card | `md` or `pulse-inner` on that card while the state holds |
| Search inputs: `type="search"`, `SearchBar`, `CommandMenu`, `cmdk`, `isSearching`, `isFetching` | `line` beam with `active={isSearching}` |
| AI action buttons: `Sparkles`, `Wand`, `MagicWand` icons, "Generate", "Ask AI", "Enhance" labels | `sm` beam around the button |
| Featured cards: `featured`, `recommended`, `popular`, `highlight` classes on pricing or plan cards | `pulse-outside` on the featured card |
| Pending or selected states: `needsApproval`, `pendingReview`, `isSelected` on a card | `pulse-inner`, `colorVariant="mono"` for restraint |
| Hand-rolled beams: `conic-gradient` with `@keyframes` rotate, `animate-border`, `border-beam`, `shine-border`, `magic-border` | Replace with `<BorderBeam>` |
| Light-mode UI: `bg-white` cards, `data-theme="light"`, `prefers-color-scheme: light` | Set `theme="light"` on those beams |

## Go further (Pro)

- Four more palettes (Forest, Candy, Ice, Gold) and the full Type set in one bench, in dark and light.
- Motion and glow styling: duration, corner radius, glow size, brightness, saturation, per-layer stroke / inner glow / bloom, hue range and hue shift, line spikes, pulse glow spread and boost.
- An Agent tab that tunes the beam from a description and can rewrite the beam's stylesheet itself.
- Saved presets per theme, and exported React, React Native and SwiftUI snippets that match the tuning.

Tune it visually in the Studio at https://libraries.dev/studio, or install the Pro skill.
