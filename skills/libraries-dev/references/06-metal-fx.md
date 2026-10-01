# Metal

Real-time WebGL2 liquid metal (`metal-fx` v2) for buttons, circular icon buttons, text and badges, with a wandering halo, reflections on neighbouring elements and a cursor-driven bend.

## When to use

### Where it goes

The author's placement rules. Follow them before the general list below.

- **A large heading**: highlight a hero `h1` or key headline with the Text type, `<MetalText>`.
- **Badges** such as "New" or "Pro": the Badge type, `<MetalBadge>`.
- **CTA buttons that sell something**, such as "Get Pro", "Upgrade" or "Start trial": the Button type, `<MetalFx variant="button">`.

All metal on a page shares one colour; keep metal elements apart rather than side by side.

More situations it fits:

- The one premium call to action on a screen: "Upgrade to Pro", "Get Pro", "Start trial".
- The send button of an AI chat composer (circle variant), with its reflection on a nearby chip such as a model picker.
- A plan name in a pricing or account card ("Plan **Pro**") where only the word should be metal.
- A "New" pill next to a feature or menu label.
- Dark UI surfaces. Reflections run in dark theme only, and the material reads best on dark grounds.

### When not to use

- Several metal elements with different colours on one page. Every instance shares one renderer and one material (see Common mistakes).
- Dense lists, table rows or repeated cards. Each instance adds a canvas, a glow SVG and per-frame compositing.
- Anything that must look identical without WebGL2. Unsupported browsers get the plain child, with no ring.
- Destructive or low-priority actions. The effect pulls the eye; use it where attention is intended.

## Install

```bash
npm install metal-fx
pnpm add metal-fx
yarn add metal-fx
```

```tsx
import { MetalFx, MetalText, MetalBadge, useMetalBend, useMetalTextReflection } from 'metal-fx';
```

- React components only. Peer deps: `react` and `react-dom` >= 18. ESM and CJS builds with types.
- Requires WebGL2. Without it `<MetalFx>` renders the child as-is inside `div.metal-fx-fallback[data-metal-fx-unsupported]`.
- Styles are injected into `<head>` on import; no CSS file to add.
- The package ships no `"use client"` directive. In the Next.js App Router, import it from a file marked `"use client"`.
- Native ports (shown on the detail page, not on npm): React Native `metal-fx-native` (Skia + Reanimated 4) and SwiftUI `MetalFxKit` (iOS 17+), both in the metal-fx repo under `ports/`.

## Basic usage

React (detail page, Install & Usage):

```tsx
import { MetalFx, MetalText, MetalBadge } from 'metal-fx';
<MetalFx preset="chromatic" strength={1}>
  <button>Upgrade to Pro</button>
</MetalFx>
<MetalText font="500 24px/1.2 Inter" color="#E2E2E2">Pro</MetalText>
<MetalBadge>New</MetalBadge>
// v1 engine: npm install metal-fx@1
```

React Native (not on npm yet; lives at `ports/react-native/metal-fx-native`; Expo needs `expo run:ios` / `run:android`):

```bash
npm install metal-fx-native @shopify/react-native-skia react-native-reanimated react-native-worklets
```

```tsx
import { MetalFx, MetalText, MetalBadge, MetalReflection, MetalEdgeHalo } from 'metal-fx-native';
<MetalFx variant="circle" preset="chromatic" strength={0.9} innerShadow id="send">
  <View style={{ width: 40, height: 40 }}><ArrowUp /></View>
</MetalFx>
<MetalReflection of="send"><Chip label="Auto" /></MetalReflection>
<MetalText fontSize={24} fontWeight="500">Pro</MetalText>
<MetalBadge>New</MetalBadge>
<MetalEdgeHalo style={styles.card}>…a ring with an id…</MetalEdgeHalo>
```

SwiftUI (iOS 17+, build through Xcode so the Metal shader compiles):

```swift
// Package.swift — or Xcode: File › Add Package Dependencies… › Add Local…
.package(path: "ports/ios/MetalFxKit")
```

```swift
import MetalFxKit
MetalFx(variant: .circle, preset: .chromatic, strength: 0.9, innerShadow: true, id: "send") {
    Image(systemName: "arrow.up").frame(width: 40, height: 40)
}
Text("Auto").metalReflection(of: "send")
MetalText("Pro")
MetalBadge("New")
card.metalEdgeHalo()   // on the view touching the screen edge
```

On phones there is no cursor: device tilt bends the rings.

Playground snippet, type "Circle button" (all toggles off):

```tsx
import { MetalFx, useMetalBend } from 'metal-fx';

const ref = useRef(null);
useMetalBend(ref); // cursor-driven liquid dent

<MetalFx ref={ref} preset="chromatic" variant="circle" innerShadow strength={0.90} reflectionTargets={[siblingRef]}>
  <button aria-label="Send"><ArrowUpIcon /></button>
</MetalFx>
```

Playground snippet, type "Text":

```tsx
import { MetalText, useMetalTextReflection } from 'metal-fx';

const planRef = useRef(null);
useMetalTextReflection(planRef); // "Plan" catches the metal

<span ref={planRef}>Plan</span>
<MetalText font="500 24px/1.2 Inter, sans-serif" color="#E2E2E2" strength={0.90} reflectionTargets={[{ ref: planRef, strength: 0.64 }]}>
  Pro
</MetalText>
```

## Options (free)

`<MetalFx>`:

| Prop | Values | Default | What it does |
|---|---|---|---|
| `variant` | `"button"` \| `"circle"` | `"button"` | `button` is a pill with a 1 px ring; `circle` a round icon button with a 2 px ring. |
| `preset` | `"chromatic"` \| `"silver"` \| `"gold"` | `"chromatic"` | Metal colour. Each ships a dark and a light tuning. The playground fixes it to `chromatic`. |
| `theme` | `"auto"` \| `"dark"` \| `"light"` | `"auto"` | Picks the preset's dark or light side. `auto` follows `prefers-color-scheme` live. |
| `strength` | `0`–`1` | `1` | Multiplies the metal opacity and glow alpha. The playground snippet emits `0.90`. |
| `innerShadow` | boolean | off | Light rim along the ring's top inside edge. On in the Circle button snippet. |
| `reflectionTargets` | array of refs, or `{ ref, strength }` | none | Neighbours that catch a mirrored reflection. Dark theme only. |
| `disableGlow` | boolean | `false` | Removes the wandering halo. The ring still renders. |
| `glowGain` | number | `1` | Multiplier on the glow only, on top of `strength` (clamped to 0..1 after multiplying). |
| `paused` | boolean | `false` | Freezes this instance on its current frame. |

`<MetalText>`: `children` (string, required), `font` (CSS `font` shorthand, required), `color` (base text colour, required), `strength`, `reflectionTargets`.

`<MetalBadge>`: `children` (string, default `"New"`).

Hooks and config:

| API | What it does |
|---|---|
| `useMetalBend(ref)` | Cursor-driven liquid dent on the ring. `ref` goes on `<MetalFx>`. |
| `useMetalTextReflection(ref)` | Confines a reflection to the glyphs of a text element that is a `reflectionTargets` entry. |
| `setCursorLightConfig({ cursor: false })` | Turns off the cursor reflection (the ring lighting the pointer) for the whole page. |

Tuner to code: **Version** v2 / v1 switches engine (v1 = `metal-fx@1`). **Type** "Circle button" = `<MetalFx variant="circle" innerShadow>` + `useMetalBend`; "Text" = `<MetalText>` + `useMetalTextReflection`. "Button" and "Badge" types are shown but locked on the page. **No Glow** adds `disableGlow`. **No Reflection** drops `reflectionTargets`. **No Cursor Reflection** adds `setCursorLightConfig({ cursor: false })`. **Play / Pause** maps to `paused` (the playground starts paused; the snippet does not emit it).

## Recipes

Chat composer send button, reflecting on the model chip. Use when: the send action of an AI prompt box.

```tsx
import { useMemo, useRef } from 'react';
import { MetalFx, useMetalBend } from 'metal-fx';

export function Composer() {
  const chipRef = useRef<HTMLButtonElement>(null);
  const sendRef = useRef<HTMLDivElement>(null);
  useMetalBend(sendRef);
  const targets = useMemo(() => [chipRef], []);
  return (
    <div className="composer-bar">
      <button ref={chipRef} className="chip">Auto</button>
      <MetalFx ref={sendRef} variant="circle" preset="chromatic" innerShadow strength={0.9} reflectionTargets={targets}>
        <button type="button" aria-label="Send" style={{ width: 40, height: 40, borderRadius: 999 }}>↑</button>
      </MetalFx>
    </div>
  );
}
```

Upgrade pill in the top nav. Use when: one paid-tier CTA per screen.

```tsx
<MetalFx preset="silver" strength={0.7}>
  <a href="/pricing" style={{ display: 'inline-flex', alignItems: 'center', height: 36, padding: '0 16px', borderRadius: 999 }}>
    Upgrade to Pro
  </a>
</MetalFx>
```

Plan name in an account card. Use when: only the tier word should be metal.

```tsx
import { useMemo, useRef } from 'react';
import { MetalText, useMetalTextReflection } from 'metal-fx';

export function PlanLine() {
  const planRef = useRef<HTMLSpanElement>(null);
  useMetalTextReflection(planRef);
  const targets = useMemo(() => [{ ref: planRef, strength: 0.64 }], []);
  return (
    <div className="plan-line">
      <span ref={planRef}>Plan</span>
      <MetalText font="500 24px/1.2 Inter, sans-serif" color="#E2E2E2" strength={0.9} reflectionTargets={targets}>
        Pro
      </MetalText>
    </div>
  );
}
```

"New" badge beside a menu item. Use when: flagging a freshly shipped feature.

```tsx
<li className="menu-item">
  <span>Live mode</span>
  <MetalBadge>New</MetalBadge>
</li>
```

App-driven theme and reduced motion. Use when: the app has its own theme toggle.

```tsx
const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

<MetalFx theme={appTheme} paused={reduce} disableGlow={reduce}>
  <button>Upgrade to Pro</button>
</MetalFx>
```

## Accessibility & performance

- The shader does not honour `prefers-reduced-motion` on its own. Pass `paused` (and optionally `disableGlow`) yourself. `useMetalBend` does not check it either.
- The cursor reflection swaps the OS pointer for a sprite. It turns itself off under `prefers-reduced-motion`, `forced-colors`, touch/pen/coarse pointers and pinch-zoom, and it needs a sprite registered with `setCursorSprite` (none ships in the package). Without a sprite it stays off.
- Canvases, glow and rim layers are `aria-hidden`. The wrapped child keeps its semantics and stays interactive; give icon-only children an `aria-label`.
- `MetalText` and `MetalBadge` set `aria-label` to their text on the inner span.
- One shared WebGL2 context and one `requestAnimationFrame` loop drive every instance. The main loop composites at about 15 fps.
- An `IntersectionObserver` (64 px margin) skips offscreen instances; the loop stops when the tab is hidden.
- Reflections do no work in light theme.
- SSR: on the server the component renders the fallback markup (no WebGL there), and the client renders the canvas version. Render it client-only (for example `next/dynamic` with `ssr: false`, or a mounted gate) to avoid a hydration mismatch.

## Common mistakes

- Mixing presets or themes on one page. All instances share one renderer and one material; the last preset/theme applied wins. `MetalText` and `MetalBadge` always set `chromatic`.
- Styling the child's background. With default settings the wrapper strips the child's background, border, outline and box-shadow and paints its own fill (`#272727` dark, `#ffffff` light). Put a custom fill on `<MetalFx style={{ background }}>` instead.
- Passing more than one child, or a child with no size. The wrapper is `inline-flex` and sizes to the child; give icon buttons explicit width and height. The ring radius comes from the child's computed `border-radius` (`circle` always uses a true circle).
- Inline `reflectionTargets={[ref]}` arrays. A new array each render tears down and re-adds reflections. Memoise it. Targets with `position: static` get `position: relative` and `isolation: isolate` set inline.
- `useMetalBend` or `useMetalTextReflection` with a ref that is not mounted yet (a conditional render inside the same component). Put each metal element in its own component so the hook runs against a mounted node.
- Expecting reflections in light theme. They only render when the resolved theme is `dark`.
- The wrapper, child included, stays invisible until the first metal frame is painted. Do not measure or animate the child before then.
- React StrictMode: the Libraries.dev playground mounts without it because the simulated double mount froze the shared renderer in development.

## Detecting a fit in a codebase

| Signal to grep | Suggest |
|---|---|
| `Upgrade to Pro`, `Get Pro`, `Go Pro`, `Upgrade`, `/pricing` links in nav or sidebars | `<MetalFx>` button variant around that one CTA |
| Chat composer: `<textarea` with `placeholder="Ask`/`Message`/`Build anything`, `aria-label="Send"`, `ArrowUp`/`SendIcon`/`PaperPlane` icons | `<MetalFx variant="circle" innerShadow>` + `useMetalBend`, reflecting on a sibling chip |
| Model or mode pickers next to the send button (`Auto`, `Agent`, `model-select`) | Use them as `reflectionTargets` |
| Hero or page headline: the `<h1>` on a landing, pricing or launch page, a key display heading | `<MetalText>` on that heading |
| Pricing/plan UI: `plan`, `tier`, `Pro`, `Premium`, `Plus` labels | `<MetalText>` on the tier word, `useMetalTextReflection` on the label before it |
| `New` / `Beta` badges, `badge--new`, `<Badge>New</Badge>` | `<MetalBadge>New</MetalBadge>` |
| Hand-rolled shine: `shimmer`, `shine`, `conic-gradient` borders, `animate-border`, `gradient-border` on a button | Replace with `<MetalFx>` |

## Go further (Pro)

- Button and Badge types with their own tuned baselines, and a Color switch for the ring types.
- Shader scale, ring width and metal opacity sliders, and the badge's layer controls (white core, gradient, inner glow).
- Engine-wide tuning: glow intensity and timing, cursor bend strength and reach, cursor reflection distance and falloff.
- React Native and SwiftUI snippets generated from the same tuned values.

Tune it visually in the Studio at https://libraries.dev/studio, or install the Pro skill.
