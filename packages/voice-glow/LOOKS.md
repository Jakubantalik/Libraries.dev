# Surface looks — not released yet

`look="dots"` and `look="lines"` are built and working but **not shipped**:
the default build (npm, the libraries.dev site and Studio) compiles them out.
They ship after the SwiftUI Voice release. To work on them locally:

```bash
VOICE_SURFACE=1 npm run build:voice   # then start the home dev server; the Studio shows Dots / Lines
```

To release: make `__VOICE_SURFACE__` default to true in `vite.config.ts`,
move the section and the props below back into README.md, and note it in
CHANGELOG.md.

## Looks

Three ways to draw the same voice. `look="glow"` (the default) is coloured light: soft gradients, a band of light along the glow's ceiling and a blurred bloom. `look="dots"` is a gently domed sheet of dots seen in perspective along the bottom of the element, in the dotted language of [thinking-orbs](https://libraries.dev/orbs) — white on the dark theme, near-black ink on the light one. `look="lines"` is the same sheet drawn as lines.

```tsx
<VoiceBeam look="dots" stream={mic.stream}>
  <ChatInput />
</VoiceBeam>

<VoiceBeam
  look="dots"
  dotSize={1.2}      // bolder dots
  dotGap={0.85}      // a denser, finer sheet
  dotShape="square"  // a pixel grid
  texture={0.8}      // more ripple carried by the flow
  gravity={1.6}      // drops like sand
>
  <ChatInput />
</VoiceBeam>

<VoiceBeam
  look="lines"
  linePattern="grid" // rows across, columns into the depth, or both
  lineWidth={1.4}
  lineGap={1.2}
>
  <ChatInput />
</VoiceBeam>
```

The voice raises hills out of the sheet, one per lobe, so the spectrum reads as a landscape that drifts with the flow; while the glow is gathered (`motion`) they draw together into one mound. Every point of the sheet carries its own height and velocity: it is lifted toward the voice on a fast spring, keeps its momentum when the voice stops, then falls under gravity and lands with a small bounce — so a falling hill comes down as a shower of dots, or as lines settling back like strings, rather than easing away. Depth is carried by size and ink, and lifted parts catch the light. `texture` sets a slow ripple across the sheet; `gravity` how hard it falls.

Lines run across the sheet (`linePattern="rows"`, a ridgeline landscape), into the depth (`"columns"`, converging with the perspective) or both (`"grid"`). The sheet is solid: a raised ridge hides the lines behind it. `seeThrough` draws it as a wireframe instead.

The sheet's own shape is yours to set, for dots and lines alike:

```tsx
<VoiceBeam
  look="lines"
  surfaceHeight={1.4}        // stands taller, covering more of the host
  surfaceCurve={0.5}         // a flatter arc (0 is flat, below 0 cups upward)
  surfaceTail={0.8}          // the ends curl up into the corners (below 0 they drop away)
  surfaceTailPosition={0.5}  // from halfway out to either side
  surfaceTailCurve={3}       // as a hook that whips up at the edge
  surfaceFade={0.1}          // runs nearly all the way to the sides before dissolving
>
  <VoiceScreen />
</VoiceBeam>
```

The colour props (`colorVariant`, `colors`, `bandColors`, `saturation`, the hue drift), the band and `css` do not apply to dots or lines. They are painted on one 2D canvas with plain paths — no filters — so every engine draws the same picture, and they cost less than the glow.

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `look` | `'glow' \| 'dots' \| 'lines'` | `'glow'` | Coloured light, or a surface of dots or lines the voice raises and gravity brings down (see [Looks](#looks)) |
| `dotSize` | `number` | `1` | Dot radius multiplier (`look="dots"`) |
| `dotGap` | `number` | `1` | Dot spacing multiplier; below 1 is denser (`look="dots"`) |
| `dotShape` | `'round' \| 'square'` | `'round'` | The dots' shape (`look="dots"`) |
| `lineWidth` | `number` | `1` | Line width multiplier (`look="lines"`) |
| `lineGap` | `number` | `1` | Line spacing multiplier, rows and columns alike (`look="lines"`) |
| `linePattern` | `'rows' \| 'columns' \| 'grid'` | `'rows'` | Lines across the sheet, into the depth, or both (`look="lines"`) |
| `seeThrough` | `boolean` | `false` | Show the lines behind a raised ridge instead of hiding them (`look="lines"`) |
| `texture` | `number` | `0.6` | Ripple across the sheet, 0–1 (dots, lines) |
| `gravity` | `number` | `1` | How hard the sheet falls when the voice drops (dots, lines) |
| `surfaceHeight` | `number` | `1` | How tall the sheet stands, as a multiplier (dots, lines) |
| `surfaceCurve` | `number` | `1` | How far the sheet arcs; 0 flat, below 0 cups upward (dots, lines) |
| `surfaceTail` | `number` | `0` | How far the ends rise toward the corners, × the sheet's height; below 0 they drop (dots, lines) |
| `surfaceTailPosition` | `number` | `0.6` | Where the tails start, as a share of the way from the centre to the side (dots, lines) |
| `surfaceTailCurve` | `number` | `2.4` | The tails' exponent: 1 a ramp, higher a hook (dots, lines) |
| `surfaceFade` | `number` | `0.2` | How far in from the sides the sheet dissolves, share of its half-width (dots, lines) |
