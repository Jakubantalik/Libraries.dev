# Gooey (liquid-gooey)

Liquid UI for React: touching pieces merge like goo, stretch and bow like liquid, while text, icons and images stay crisp.

## When to use

- Floating action / plus button that splits into satellite actions (speed dial, "New file / Add image / New folder"). Effect: `morph`.
- Toolbar, avatar group or chip cluster whose pieces should read as one merged surface. Effect: `morph`.
- Slider thumb, segmented-control or tab indicator that should trail and stretch as it moves. Effect: `move`.
- Draggable card, list row or dropdown pill that should bow while it is dragged. Effect: `bend`.
- Two draggable photo cards that run molten into each other where they touch (before/after, "combine" gestures). Effect: `melt`.

### When not to use

- Static layouts with nothing moving or touching. The liquid only shows while pieces meet or move.
- Dense lists or grids of many items. Every group runs an SVG filter; WebKit rasterises it on the CPU.
- Non-React stacks. The package is React-only (no vanilla build, no custom element).
- Pieces with opaque backgrounds you cannot remove. The liquid is the surface; an opaque child hides it.

## Install

```bash
npm install liquid-gooey
pnpm add liquid-gooey
yarn add liquid-gooey
```

```tsx
import { Liquid } from 'liquid-gooey'
```

- React component only: `<Liquid>` (the group) and `<Liquid.Item>` (each piece).
- Peer dependencies: `react >=18`, `react-dom >=18`. No runtime dependencies.
- ESM and CJS builds, TypeScript types included.
- The dist has no `"use client"` directive. In the Next.js App Router, put the component that renders `<Liquid>` in a file that starts with `"use client"`.
- Cross-browser, Safari included: the filters run on SVG content, never CSS `url()` filters on HTML.

## Basic usage

The detail page's Install & Usage tab (React is the only platform):

```tsx
import { Liquid } from 'liquid-gooey'
<Liquid blur={6} contrast={18} fill="#fff" shadow="0 2px 6px rgba(0,0,0,.08)">
  <Liquid.Item x={open ? -54 : 0} y={open ? -34 : 0} transition="bouncy">
    <button className="round-btn">…</button>
  </Liquid.Item>
  <Liquid.Item x={0} y={open ? -64 : 0} transition="bouncy" delay={40}>
    <button className="round-btn">…</button>
  </Liquid.Item>
</Liquid>
```

The playground under the examples also renders a live "Copy Studio code" snippet for the selected effect. At its defaults (dark page) it produces:

```tsx
// Effect: Morph
import { Liquid } from 'liquid-gooey'

<Liquid fill="#202020">
  <Liquid.Item x={open ? -54 : 0} y={open ? -34 : 0} transition={{ duration: 550, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
    <button className="round-btn">…</button>
  </Liquid.Item>
  <Liquid.Item x={0} y={open ? -64 : 0} transition={{ duration: 550, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }} delay={40}>
    <button className="round-btn">…</button>
  </Liquid.Item>
  <Liquid.Item>
    <button className="round-btn">+</button>
  </Liquid.Item>
</Liquid>
```

```tsx
// Effect: Move
<Liquid fill="#525252">
  <Liquid.Item effect="move" move={{ stretch: 0.6, trail: 0.35 }}>
    <div className="thumb" style={{ transform: `translateX(${x}px)` }} />
  </Liquid.Item>
</Liquid>
```

```tsx
// Effect: Bend
<Liquid fill="#202020">
  <Liquid.Item effect="bend">
    <div className="card" style={{ transform: `translate(${x}px, ${y}px)` }}>…</div>
  </Liquid.Item>
</Liquid>
```

```tsx
// Effect: Melt
<Liquid>
  <Liquid.Item effect="melt">
    <img src="/photo-a.jpg" style={{ width: 84, height: 84, borderRadius: 16 }} />
  </Liquid.Item>
  <Liquid.Item effect="melt">
    <img src="/photo-b.jpg" style={{ width: 84, height: 84, borderRadius: 16 }} />
  </Liquid.Item>
</Liquid>
```

`blur` and `contrast` are omitted from the live snippet while they sit at their defaults (6 and 18).

## Options (free)

| Option / prop | Values | Default | What it does |
| --- | --- | --- | --- |
| `Liquid.Item effect` | `"morph"`, `"move"`, `"bend"`, `"melt"` | `"morph"` | Morph: pieces merge and split. Move: the surface trails a moving element with a droplet tail. Bend: the body bows with drag velocity. Melt: two images run molten into each other. |
| `Liquid blur` | 0 to 16, step 0.5 | `6` | Goo blur in px. Higher bridges pieces from farther apart and reads softer. Not used by `melt`. |
| `Liquid contrast` | 4 to 40, step 1 | `18` | Sharpness of the liquid edge. Higher is crisper and beadier; lower is hazier. Not used by `melt`. |
| `Liquid fill` | any CSS colour | `'#fff'` | Colour of the liquid surface. Page snippets use `"#fff"`, `"#202020"` (morph, bend) and `"#525252"` (move). |
| `Liquid shadow` | `box-shadow` syntax, multi-layer | none | Shadow drawn on the merged silhouette, so it follows every merge and split. |
| `Liquid.Item x`, `y` | number (px) | `0` | Morph position offset. The library animates the element and its liquid together. |
| `Liquid.Item transition` | `"snappy"`, `"smooth"`, `"bouncy"`, or `{ duration, ease }` | `"smooth"` | Timing for `x`/`y` changes. |
| `Liquid.Item delay` | ms | `0` | Delay before an `x`/`y` transition starts. Use it to stagger. |
| `Liquid.Item move` | `{ stretch: 0.6, trail: 0.35 }` in the page snippet | library tuning | Move-only tuning object. The page shows these values; it does not expose sliders for them. |

The playground tuner has three controls: the Effect tabs (Morph / Move / Bend / Melt) set `effect`, "Goo blur" sets `blur`, and "Contrast" sets `contrast`. Blur and contrast are hidden for Melt, which carries its own surface tuning. Fill, shadow, `x`/`y`, `transition` and `delay` come from the Install & Usage snippet and the Copy prompt text, not from tuner controls.

Rule of thumb from the package docs: neighbours bridge once `blur` is roughly as large as the gap between them. Items 8px apart barely bridge at `blur={5}` and merge cleanly at `blur={12}`.

## Recipes

### Plus menu that splits into actions (morph)

Use when: a floating "+" button should bloom into two or three action buttons.

```tsx
import { useState } from 'react'
import { Liquid } from 'liquid-gooey'

const ACTIONS = [
  { label: 'New file', x: -54, y: -34 },
  { label: 'Add image', x: 0, y: -64 },
  { label: 'New folder', x: 54, y: -34 },
]

export function PlusMenu() {
  const [open, setOpen] = useState(false)
  return (
    // Sized to hold the open footprint; items stack at one slot.
    <Liquid fill="#202020" shadow="0 2px 6px rgba(0,0,0,.08)" style={{ width: 200, height: 140 }}>
      {ACTIONS.map((a, i) => (
        <Liquid.Item
          key={a.label}
          style={{ position: 'absolute', left: 80, top: 80 }}
          x={open ? a.x : 0}
          y={open ? a.y : 0}
          transition="bouncy"
          delay={i * 40}
        >
          <button className="round-btn" aria-label={a.label} tabIndex={open ? 0 : -1}>…</button>
        </Liquid.Item>
      ))}
      <Liquid.Item style={{ position: 'absolute', left: 80, top: 80 }}>
        <button className="round-btn" aria-expanded={open} aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(o => !o)}>+</button>
      </Liquid.Item>
    </Liquid>
  )
}
```

`.round-btn` is 40x40, `border-radius: 50%`, `background: transparent`.

### Liquid slider thumb (move)

Use when: a custom range control should feel like a drop of liquid being dragged.

```tsx
<Liquid fill="#525252" style={{ position: 'relative', width: 240, height: 80 }}>
  <div className="track" aria-hidden="true" style={{ zIndex: -2 }} />
  <Liquid.Item effect="move" move={{ stretch: 0.6, trail: 0.35 }}>
    <div
      className="thumb"
      role="slider"
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      tabIndex={0}
      style={{ transform: `translateX(${x}px)` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    />
  </Liquid.Item>
</Liquid>
```

The thumb has a size and `border-radius: 50%` but no background. The track uses `z-index: -2` so the liquid paints over it.

### Tab indicator that stretches between tabs (move)

Use when: a segmented control or tab bar has a sliding highlight.

```tsx
<Liquid fill="#e9e9e9" style={{ position: 'relative' }}>
  <Liquid.Item effect="move" move={{ stretch: 0.6, trail: 0.35 }}>
    <div
      className="indicator"
      style={{ transform: `translateX(${active * 96}px)`, transition: 'transform 300ms ease' }}
    />
  </Liquid.Item>
  {tabs}
</Liquid>
```

You animate the element however you like. The liquid follows its rendered rect.

### Draggable card that bows (bend)

Use when: a card, list row or pill is dragged and should feel soft.

```tsx
<Liquid fill="#202020" style={{ position: 'relative', height: 210 }}>
  <Liquid.Item effect="bend">
    <div
      className="card"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)` }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
    >
      Gooey Project
    </div>
  </Liquid.Item>
</Liquid>
```

### Two photos that melt together (melt)

Use when: two image cards are dragged into each other (compare, merge, combine).

```tsx
<Liquid style={{ position: 'relative', width: 420, height: 200 }}>
  <Liquid.Item effect="melt">
    <img src={a} alt="" style={{ position: 'absolute', left: ax, top: ay, width: 84, height: 84, borderRadius: 16 }} />
  </Liquid.Item>
  <Liquid.Item effect="melt">
    <img src={b} alt="" style={{ position: 'absolute', left: bx, top: by, width: 84, height: 84, borderRadius: 16 }} />
  </Liquid.Item>
</Liquid>
```

## Accessibility & performance

- The liquid layer is an `<svg aria-hidden="true" focusable="false">` with `pointer-events: none`. Your content stays real DOM: focus, hit targets and ARIA are yours to set. The demos use `aria-label` on icon buttons, `aria-expanded` on the toggle, `tabIndex={-1}` on hidden actions, and `role="slider"` with `aria-valuenow` on the thumb.
- Reduced motion: `x`/`y` transitions (morph) snap instantly under `prefers-reduced-motion: reduce`. Move, bend and melt follow motion you drive, so gate your own drag or CSS animation for reduced-motion users.
- Cost: every group runs an SVG filter. WebKit rasterises SVG filters on the CPU. Blurred outer shadows are moved to CSS `drop-shadow()` on the svg (GPU). Keep groups small and few.
- Move and bend share one measuring loop per group. It sleeps after about 30 still frames and wakes on style/class changes, transitions, animations, pointerdown and scroll. There is no offscreen (IntersectionObserver) pause.
- Melt polls its pair's rects every animation frame for as long as two melt items are mounted. Unmount it when not visible.
- SSR: content renders on the server; the liquid appears after hydration once the group is measured. Layout effects are guarded for the server.

## Common mistakes

- Giving items an opaque background. The liquid below is the surface; item backgrounds should be transparent. An opaque round photo that covers its own liquid is fine.
- Group too small. The filter region is the group's box plus padding. Size `<Liquid>` to contain the full travel of its items, like a menu reserving its open footprint.
- Rendering `<Liquid.Item>` outside `<Liquid>`. It throws `<Gooey.Item> must be rendered inside a <Gooey> group.`
- Setting `transform` or a CSS transition on a morph item's wrapper. With `x`/`y`, the library owns the wrapper's transform. For move and bend, put the transform on the child element instead.
- Expecting pieces 10px apart to merge at `blur={6}`. Raise `blur` or close the gap.
- Decorative layers under the liquid. The svg sits at `z-index: -1` inside an isolated group; a track or backdrop must use `z-index: -2` or it will cover the liquid.
- Melt with more than two items or no image. Only the first two melt items pair, and each needs an `<img>` inside.

## Detecting a fit in a codebase

| Signal to grep for | Suggest |
| --- | --- |
| FAB, speed dial, "plus menu", `aria-expanded` on a round "+" button with action buttons | `morph` plus menu |
| Avatar stacks, chip groups, toolbars with rounded buttons touching | `morph` group with a shared `fill` |
| `input type="range"`, `role="slider"`, custom slider thumbs | `move` thumb |
| Segmented controls, tab bars with a sliding indicator (`layoutId`, `translateX` on an indicator) | `move` indicator |
| Drag libraries (`@dnd-kit`, `react-beautiful-dnd`, `framer-motion` `drag`), sortable cards or rows | `bend` on the dragged item |
| Before/after or image-compare components, two draggable image cards | `melt` pair |
| Hand-rolled goo: `feColorMatrix` with `0 0 0 18 -7`, `filter: url(#goo)`, "metaball" | Replace with `<Liquid>` to keep text crisp and Safari correct |

## Go further (Pro)

- Surface waviness and fill swatches, with dark and light surface themes.
- Morph choreography: open and close durations, staggers, spread, anticipation and icon timing.
- Move, bend and melt physics knobs (springiness, wobble, bow, content bend, reach, marbling and more).
- Core customization: rebuild the liquid's SVG filter chain with the agent.

Tune it visually in the Studio at https://libraries.dev/studio, or install the Pro skill.
