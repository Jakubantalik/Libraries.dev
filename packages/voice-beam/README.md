# Voice

`voice-beam` on npm.

Sound-reactive glow for React. A centered, colorful beam along the bottom edge of any element — a chat input, a search bar, a card — that rises and blooms with the intensity of a voice. Feed it a microphone stream, or drive it yourself.

It is the voice-shaped sibling of [`border-beam`](../border-beam)'s `line` type: the same three-layer construction (edge stroke, inner light, blurred bloom), the same eight palettes, but the glow sits still at the center and its height follows the sound instead of traveling.

## Install

```bash
npm install voice-beam
```

## Quick start

```tsx
import { VoiceBeam, useMicrophone } from 'voice-beam';

function Composer() {
  const mic = useMicrophone();

  return (
    <>
      <VoiceBeam stream={mic.stream}>
        <div style={{ padding: 32, borderRadius: 20, background: '#1d1d1d' }}>
          Listening…
        </div>
      </VoiceBeam>
      <button onClick={mic.state === 'live' ? mic.stop : mic.start}>
        {mic.state === 'live' ? 'Stop' : 'Listen'}
      </button>
    </>
  );
}
```

The component wraps your content and overlays the glow. It auto-detects the `border-radius` of the first child element. Call `mic.start()` from a click: browsers only grant the microphone — and Safari only starts audio — inside a user gesture.

## Types

The glow is authored for a ~350px chat input. `type` retunes its geometry for other hosts — every geometry prop below still overrides the preset:

```tsx
<VoiceBeam type="pill">      {/* a ~150×44 recording pill: glow pulled in, shallow bend, thin band */}
  <RecordingPill />
</VoiceBeam>

<VoiceBeam type="mobile">    {/* the bottom of a phone screen: wider range, taller rise, broad band */}
  <VoiceScreen />
</VoiceBeam>
```

`scale` sizes the whole effect as one thing — lobes, spacing, range, bend, band, core, blur and flow all multiply by it — on top of the preset and any individual geometry prop:

```tsx
<VoiceBeam type="pill" scale={1.3}>
```

The wrapper carries `data-voice-type`. `voiceDefaults`, `voiceTypePresets` and `resolveVoiceDefaults(type)` are exported so a host can read the numbers a preset resolves to.

## Driving it yourself

Without a `stream`, the beam follows `level` (0–1). Pass a number when it changes occasionally, or a getter when it changes every frame — the getter is sampled by the driver without re-rendering your tree:

```tsx
// From your own analyser, a playback meter, a speech API's volume event…
<VoiceBeam level={() => meter.current}>
  <Card />
</VoiceBeam>

// Or a plain value
<VoiceBeam level={speaking ? 0.8 : 0}>
  <Card />
</VoiceBeam>
```

Set `idle={0}` if you want nothing at all while silent; by default the beam keeps a soft breathing presence so it never looks dead.

## Response

Four knobs shape how the glow answers the sound:

```tsx
<VoiceBeam
  sensitivity={2}     // input gain — raise for quiet sources
  threshold={0.03}    // noise gate: below this is silence
  attack={0.1}        // seconds to rise
  release={0.5}       // seconds to settle
>
```

And four shape the glow itself:

```tsx
<VoiceBeam
  reach={1.4}   // how tall it grows at full level
  spread={0.6}  // how far it widens; the side lobes drift outward too
  flow={80}     // px/s the spectrum travels sideways at full level
  bands         // low / mid / high bands move the lobes independently (default)
>
```

`flow` is what makes the colours move: while a voice is heard the lobes slide left to right (right to left for a negative value), wrapping around at the edges, so every colour takes a turn at the centre; as the voice stops the flow settles with it. `flow={0}` holds the spectrum still.

With `bands` on, the center lobe follows the lows, its neighbours the mids and the outer pair the highs, so a voice makes the colors ripple outward rather than one blob pumping. When driving with `level`, the bands are synthesised from it, so the lobes still dance.

## Processing state

Once the voice is captured and something is working on it — transcribing, thinking — flip `processing` on. The lobes gather into one compact beam that travels the glow's range left to right and back, eased at each end and looped — `border-beam`'s traveling `line` type, confined to the voice glow, its colours still flowing inside it — and the glow is held lit so the beam has colour. Both blend in and out smoothly, so a listening → processing → idle flow needs no choreography:

```tsx
<VoiceBeam
  stream={listening ? mic.stream : null}
  processing={thinking}
  processingDuration={1.1}  // seconds per pass
  processingLevel={0.55}    // how lit the glow is held meanwhile
  processingEase={0.6}      // seconds the morph in and out takes
  processingTravel={1.55}   // how far it sweeps to each side
  processingCurve={2.1}     // how it eases into each turn (1 = constant speed)
>
```

The wrapper carries `data-processing` while it is on. The distortion settles out in about a quarter second and stays off while processing — once it is gone the wrapper also carries `data-voice-warp="off"` and the warp layers leave the paint, so the travelling beam stays smooth where SVG filters are slow (WebKit) — and it eases back over about a second as processing ends.

## Shape

`bend` is the gravity: as the voice rises, the ceiling the glow is masked to gains extra height at the centre — none at the ends — and a faint rim traces that curve, so the glow's top contour humps upward like space bending around the voice. It is in px at full level (default 60; 0 keeps the plain ellipse). `rangeWidth` sets how wide the hump is.

The **band** is the light along that contour — an organic bell, `exp(-(|x| / spread)^curve)`, drawn on its own canvas layer and flattening onto the edge at both ends. It fades in with the bend and reacts to the voice on its own — its red and blue fringes split further from the core and it thickens as the level rises, and it turns with the glow's hue drift:

```tsx
<VoiceBeam
  bandStrength={1.55}   // opacity; 0 hides it
  bandWidth={2.15}      // thickness
  bandPosition={0.35}   // peak height as a fraction of the glow's ceiling
  bandCurve={1.75}      // bell exponent: < 2 exponential / cusp-like, 2 gaussian, > 2 flat-topped
  bandSpread={0.87}     // bell width vs the half-range: small = spike with long tails, large = dome
  bandSkew={0.12}       // asymmetry; positive widens the right, steepens the left
  bandOffset={-27}      // px shift of the whole line; negative sinks it
  bandTail={0.59}       // the ends rise again in the corners (× the peak)
  bandTailPosition={0.67} // the rise starts 67% of the way to the edge, full lift at the corner
  bandTailCurve={2.4}   // higher = a sharper hook
  bandTailOverflow={15} // runs 15px past each side; the component crops the hook
  bandAberration={0.89} // how far the red / blue fringes split, 0–1
>
```

**Distortion** warps the glow under the band sideways: a slowly drifting noise field displaces the inner light and the bloom horizontally (an SVG `feDisplacementMap`), stronger as the voice rises, so the colours shimmer and stretch like light through bent space. Only the glow *under* the band line warps — the layers are split at the line with a per-frame `clip-path` — and it is independent of `bandStrength`, so the line can be invisible and the warp strong. The edge stroke stays crisp. It is off while `processing` (see above).

```tsx
<VoiceBeam
  distortion={0.62}       // 0 turns the filter off
  distortionDetail={2.3}  // < 1 broad slow waves, > 1 finer ripples
>
```

Twelve multipliers (defaults are the tuned geometry) reshape the resting glow; the voice still drives the motion on top:

```tsx
<VoiceBeam
  bend={24}          // px the top contour humps up at full level
  glowWidth={1.2}    // every lobe wider
  glowHeight={0.8}   // every lobe shorter
  lobeSpacing={1.3}  // lobes further apart (and a longer flow ring)
  rangeWidth={1.5}   // the visible ellipse wider
  rangeHeight={1}    // … and taller
  softness={1.2}     // softer lobe edges (below 1: crisper)
  coreSize={1.4}     // the white hot spot at the centre
  strokeScale={1}    // colours in the 1px edge stroke
  innerScale={1}     // the soft light inside the element
  innerHeight={1.5}  // … reaching further in
  bloomScale={1}     // the blurred halo
  bloomHeight={1.3}  // … climbing higher
>
```

## Color variants

```tsx
<VoiceBeam colorVariant="colorful" />  {/* Full spectrum (default) */}
<VoiceBeam colorVariant="mono" />      {/* Grayscale */}
<VoiceBeam colorVariant="ocean" />     {/* Blue-purple tones */}
<VoiceBeam colorVariant="sunset" />    {/* Orange-yellow-red tones */}
<VoiceBeam colorVariant="forest" />    {/* Green-teal tones */}
<VoiceBeam colorVariant="candy" />     {/* Pink-magenta tones */}
<VoiceBeam colorVariant="ice" />       {/* Cyan-pale blue tones */}
<VoiceBeam colorVariant="gold" />      {/* Amber-yellow tones */}
```

All variants except `mono` drift slowly through a hue cycle (`hueRange`, `hueDuration`); `staticColors` holds them still.

Your own colours, over any variant:

```tsx
<VoiceBeam
  colors={['#ffc915', '#7ec4ff', '#b428e6', '#eb64a0', '#ffb07a', '#9aa0ff', '#7fd9ee']}  // 7 lobes: centre, then pairs outward
  bandColors={{ core: '#c58bff', above: '#ff7ab6', mid: '#7ec4ff', below: '#2dffab' }}      // the band's ridge and fringes
>
```

Slots you leave out keep the variant's colour for the theme. Light mode ships a candy palette (gold, sky, violet, rose, peach) with a violet-cored band; dark keeps the deeper spectrum and a white-cored band.

## Theme

```tsx
<VoiceBeam theme="dark" />   {/* Dark background (default) */}
<VoiceBeam theme="light" />  {/* Light background */}
<VoiceBeam theme="auto" />   {/* Follows prefers-color-scheme */}
```

## Strength and play / pause

```tsx
<VoiceBeam strength={0.7} active={listening} onDeactivate={() => console.log('faded out')}>
  <Card />
</VoiceBeam>
```

`strength` scales the beam layers only, never the children. `active={false}` fades the beam out and stops the audio analysis.

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `children` | `ReactNode` | — | Content to wrap |
| `type` | `'default' \| 'pill' \| 'mobile'` | `'default'` | Host preset; sets the geometry defaults |
| `scale` | `number` | `1` | Size of the whole effect — every px dimension at once |
| `stream` | `MediaStream \| null` | — | Audio to react to; wins over `level` |
| `level` | `number \| () => number` | `0` | Manual drive, 0–1 |
| `sensitivity` | `number` | `3.1` | Input gain on the analysed audio |
| `threshold` | `number` | `0.015` | Noise gate, 0–1 |
| `attack` | `number` | `0.325` | Seconds to rise toward a louder level |
| `release` | `number` | `0.86` | Seconds to settle after the sound drops |
| `idle` | `number` | `0.23` | Resting presence while silent, 0–1 |
| `breatheDuration` | `number` | `5.2` | Period of the idle breathing, seconds |
| `reach` | `number` | `1.2` | Height gain at full level (1.8 on light; 1.35 for `pill`, 3 for `mobile`) |
| `spread` | `number` | `1.05` | Width gain at full level (0.8 on light; 1.1 for `pill`, 0.45 for `mobile`) |
| `bands` | `boolean` | `true` | Let the frequency bands move the lobes independently |
| `flow` | `number` | `48` | Sideways travel of the spectrum, px/s at full level; negative reverses, 0 holds |
| `processing` | `boolean` | `false` | Gather the glow into a beam that travels its range, ping-pong, while work is in progress |
| `processingDuration` | `number` | `1.1` | Seconds per beam pass (1.05 for `mobile`) |
| `processingLevel` | `number` | `0.55` | Level the glow is held at while processing (0.35 for `mobile`) |
| `processingEase` | `number` | `0.6` | Seconds the morph into / out of processing takes |
| `cornerFollow` | `number` | `0.45` | The glow rides the corner arcs while processing; the band line always does (0 for `pill`, 0.4 for `mobile`) |
| `processingTravel` | `number` | `1.55` | How far the beam travels to each side, × half the lobe ring (2 for `pill`, 1 for `mobile`) |
| `processingCurve` | `number` | `2.1` | How the sweep eases into each turn: 1 constant speed with sharp turns, 2 smooth, higher dwells at the ends |
| `colorVariant` | `'colorful' \| 'mono' \| 'ocean' \| 'sunset' \| 'forest' \| 'candy' \| 'ice' \| 'gold'` | `'colorful'` | Color palette |
| `colors` | `string[]` | — | Up to 7 lobe colours overriding the palette |
| `bandColors` | `{ core?, above?, mid?, below? }` | — | The band's ridge and fringe colours |
| `theme` | `'dark' \| 'light' \| 'auto'` | `'dark'` | Background adaptation |
| `staticColors` | `boolean` | `false` | Disable the hue drift |
| `hueRange` | `number` | `24` / `40` | Hue drift range in degrees (dark / light) |
| `hueDuration` | `number` | `12` / `8.5` | Hue drift period in seconds (dark / light) |
| `active` | `boolean` | `true` | Whether the effect is on |
| `paused` | `boolean` | `false` | Freezes the effect in place (glow, band and analysis hold their last frame) without fading it out |
| `borderRadius` | `number` | auto-detected | Custom border radius in px |
| `brightness` | `number` | `1.15` / `0.95` | Glow brightness multiplier (dark / light; the dark theme itself is 1.1, `pill` runs 1.35, `mobile` 1.2 on dark) |
| `saturation` | `number` | `1.2` / `1.6` | Glow saturation multiplier (dark / light; `pill` and `mobile` run 1.5 on dark) |
| `glowSize` | `number` | `1` | Multiplies the bloom blur radius |
| `strokeOpacity` / `innerOpacity` / `bloomOpacity` | `number` | `1` | Per-layer opacity multipliers on the theme's own (same as the `--voice-*-opacity` CSS hooks) |
| `bend` | `number` | `60` | Px the glow's top contour humps up at the centre at full level; 0 is the plain ellipse |
| `bandStrength` | `number` | `1.55` (1.8 for `mobile`; on light 1.7, or 2 for `pill`) | Opacity of the band along the contour; 0 hides it |
| `bandWidth` | `number` | `2.15` | Thickness of the band |
| `bandPosition` | `number` | `0.35` | Peak height as a fraction of the glow's ceiling |
| `bandCurve` | `number` | `1.75` | Bell exponent; < 2 exponential, 2 gaussian, > 2 flat-topped |
| `bandSpread` | `number` | `0.87` | Bell width vs the half-range |
| `bandSkew` | `number` | `0.12` | Asymmetry, −0.6–0.6 |
| `bandOffset` | `number` | `-27` | Px shift of the whole band line |
| `bandTail` | `number` | `0.59` | Rise of the band's ends in the corners, × the peak; 0 for `pill` |
| `bandTailPosition` | `number` | `0.67` | Where the rise starts, × the centre-to-edge distance; full lift at the corner |
| `bandTailCurve` | `number` | `2.4` | Exponent of the rise; higher = a sharper hook at the corner |
| `bandTailOverflow` | `number` | `15` | Px the band runs past each side, so the hook is cropped by the component |
| `bandAberration` | `number` | `0.89` | Chromatic split of the band's fringes, 0–1 |
| `distortion` (off on WebKit / Safari for large hosts, see notes) | `number` | `0.62` | Horizontal warp of the glow under the band, 0–1; 0 removes the filter |
| `distortionDetail` | `number` | `2.3` | Grain of the distortion noise |
| `glowWidth` / `glowHeight` | `number` | `0.65` / `1.25` | Width / height of every lobe, all layers |
| `lobeSpacing` | `number` | `0.85` | Distance between lobes, and the flow ring |
| `rangeWidth` / `rangeHeight` | `number` | `0.75` / `1` | The visible ellipse the glow is masked to |
| `softness` | `number` | `1.07` | Lobe edge fade: below 1 crisper, above 1 softer |
| `coreSize` | `number` | `1` | The white hot spot at the centre |
| `coreLight` | `number` | `0` | The epicentre: a white wash under the band line so the source reads lighter than the band, 0–3 (1.8 on light; past 1 the solid core widens and the wash grows) |
| `coreLightWidth` / `coreLightHeight` | `number` | `1` | Size of the epicentre wash |
| `strokeScale` | `number` | `1` | Size of the colours in the edge stroke |
| `innerScale` / `innerHeight` | `number` | `1` | Size and reach of the inner light |
| `bloomScale` / `bloomHeight` | `number` | `1` | Size and climb of the blurred halo |
| `strength` | `number` | `1` / `0.8` | Effect opacity (0–1), beam layers only (dark / light; `mobile` is 1 on both) |
| `className` | `string` | — | Additional class on the wrapper |
| `style` | `CSSProperties` | — | Additional inline styles on the wrapper |
| `css` | `string` | — | Extra CSS appended after the generated stylesheet; write `{id}` for the instance id |
| `onLevel` | `(level: number) => void` | — | Called every frame with the smoothed level |
| `onActivate` | `() => void` | — | Called when the fade-in completes |
| `onDeactivate` | `() => void` | — | Called when the fade-out completes |

All standard `HTMLDivElement` attributes are also forwarded to the wrapper. The wrapper carries `data-listening` while a stream is attached and `data-processing` while processing, for styling the host.

### CSS hooks

The generated stylesheet reads a few custom properties with a fallback of 1, so a host can retune a layer without touching the props:

| Variable | Layer |
|----------|-------|
| `--voice-stroke-opacity` | The colored 1px edge stroke |
| `--voice-inner-opacity` | The soft light inside the element |
| `--voice-bloom-opacity` | The blurred halo |
| `--voice-band-opacity` | The band along the bend |
| `--voice-hue-base` | A fixed hue shift added to the drift (`deg`) |

The driver also writes `--vb-level-{id}` (the smoothed 0–1 level) on the wrapper each frame, for anything else in the host that wants to follow the voice.

## `useMicrophone`

```tsx
const { stream, state, error, supported, start, stop } = useMicrophone({
  constraints: { deviceId: '…' },  // extra getUserMedia audio constraints
  autoStart: false,
});
```

`state` is one of `idle`, `requesting`, `live`, `denied`, `unsupported`, `error`. By default the hook turns the browser's echo cancellation, noise suppression and auto gain off, so the beam sees the real dynamics of the voice; pass `constraints: {}` to keep the browser defaults. The stream is stopped on unmount.

The hook is a convenience; any `MediaStream` with an audio track works, including a remote WebRTC peer's — a voice call UI can light up with the other side's voice.

## How it works

`VoiceBeam` renders a wrapper `<div>` with three bottom-centered layers, clipped to the element:

- **`::after`** — the stroke: the palette painted into the 1px edge ring, with a hot white core at the center
- **`::before`** — the inner glow: the same lobes as soft light inside the element, faded off at the corners
- **`[data-voice-beam-bloom]`** — the bloom: a blurred halo above the content
- **`[data-voice-beam-warp="inner"]` / `[data-voice-beam-warp="bloom"]`** — with `distortion` on, mirrors of the two soft layers clipped to below the band line, carrying the displacement filter
- **`[data-voice-beam-band]`** — a canvas the driver draws the band on, above everything

Every lobe's size and position multiplies a per-instance custom property. A single shared `requestAnimationFrame` loop (capped at ~60 fps) reads the audio each frame — RMS level plus low / mid / high band energy from one `AnalyserNode` per instance — shapes it (gain, gate, soft saturation), follows it with an attack/release envelope, advances the flow, folds in the idle breathing and the hue drift, and writes the properties. The browser does the painting; the loop is a few arithmetic ops per instance.

The Web Audio graph is one shared `AudioContext`, one source node per stream (reference-counted, so several beams can share a microphone), and nothing connected to the output — the audio is analysed, never played. The loop pauses while the instance is inactive or scrolled offscreen, and under `prefers-reduced-motion` the breathing, flow and hue drift stop while the reaction to sound stays, since that is a meter rather than decoration.

## Project structure

```
voice-beam/
├── src/
│   ├── index.ts           # Public exports
│   ├── VoiceBeam.tsx      # React component
│   ├── types.ts           # TypeScript type definitions
│   ├── styles.ts          # CSS generation engine, palettes and lobe geometry
│   ├── voiceDriver.ts     # Shared rAF loop: analysis, envelope, custom properties
│   ├── audio.ts           # Shared AudioContext and analyser leases
│   └── useMicrophone.ts   # getUserMedia hook
├── dist/                  # Built output (ESM + CJS + types)
├── package.json
├── LICENSE
└── README.md
```

## Requirements

- React 18+
- Web Audio API and `getUserMedia` for the microphone path (every modern browser; a secure context — `https` or `localhost` — is required for the microphone)
- CSS `@property` for the interpolated fade in / out (Chrome 85+, Safari 15.4+, Firefox 128+); without it the fade steps rather than tweens
- Phones: the soft layers (inner light, bloom, their warp mirrors, the epicentre) are rastered at half resolution and scaled back up by the compositor — the same picture for blurred gradients at a quarter of the raster and filter work — the band canvas caps its backing store at 2×, and when a device still cannot hold 60 the driver updates every other frame (the glow's dynamics are far slower than 30 Hz) and probes full rate again every few seconds. Engines without CSS `zoom` keep the full-resolution path.
- WebKit / Safari notes: the `distortion` warp is off there on hosts larger than about 400×400 px (Safari evaluates SVG filters on HTML content on the CPU every paint, which on a phone-sized host costs an order of magnitude in frame rate; a chat input or pill keeps it), and the band's blur runs in CSS on two canvases instead of the 2D context's `filter`, which Safari lacks. The look otherwise matches Chromium.

## Accessibility

The effect layers are purely decorative and use `pointer-events: none`. They do not affect keyboard navigation or screen readers. Under `prefers-reduced-motion: reduce` the idle breathing, the flow and the hue drift are disabled. The microphone is only ever requested by your own call to `start()`.

## License

[MIT](./LICENSE)
