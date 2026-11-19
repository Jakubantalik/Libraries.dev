# img-fx

Animated WebGL "image generation / loader" effect for React. Wrap any card and it gets a real-time shader-driven loading mosaic that periodically reveals an image from a pool you provide. Ports the canonical `image.html` effect into a small, performant React library.

Live demo: [image.jakubantalik.com](https://image.jakubantalik.com)

## Install

```bash
npm install img-fx
```

`react`, `react-dom`, and `three` are peer dependencies.

### Local development

```bash
npm install
npm run dev          # local Vite playground
npm run build        # produce dist/ (ESM + CJS + .d.ts)
npm run build:demo   # produce dist-demo/ (static showcase site)
```

## Quick start

```tsx
import { ImageGeneration } from 'img-fx';

export function Card() {
  return (
    <ImageGeneration
      preset="pixels-organic"
      images={['/img/a.jpg', '/img/b.jpg']}
      autoReveal
    >
      <div className="card" style={{ width: 320, height: 320, borderRadius: 20 }} />
    </ImageGeneration>
  );
}
```

Three presets ship with the library: `pixels-organic` (Chromium Flow),
`pixels-mechanic` (Nebula), and `sweep-gradient` (a fast top-left → bottom-right
gradient sweep with per-cell random flicker that reads as "generating"; its
reveal materializes the image cell-by-cell along the traveling band).

## Props

| Prop                | Type                                                                  | Default     | Notes                                                                                            |
| ------------------- | --------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| `preset`            | `'pixels-organic' \| 'pixels-mechanic' \| 'sweep-gradient'`           | `'pixels-organic'` | Selects the bundled effect preset. `pixels-organic` = Chromium Flow mosaic, `pixels-mechanic` = Nebula mosaic, `sweep-gradient` = diagonal "generating" gradient sweep with per-cell flicker. |
| `theme`             | `'auto' \| 'dark' \| 'light'`                                          | `'auto'`    | `auto` checks `<html data-theme>`, `.dark`/`.light` class, inline `color-scheme`, then `prefers-color-scheme`. Live-updates via MutationObserver. |
| `strength`          | `number` (0..2)                                                       | `1`         | 0..1 multiplies the effect's opacity (the shader keeps animating at full intensity). Above 1 the effect stays opaque and the palette intensity and highlight are boosted instead. |
| `speed`             | `number`                                                              | `1`         | Animation speed multiplier on top of the preset's tempo. Scales the whole clock (drift, churn, flicker) together: `0.5` = half speed, `2` = double. |
| `pixelScale`        | `number`                                                              | `1`         | Pixel-cell size multiplier for the mosaic. `0.5` = finer grid, `2` = chunkier. The reveal dissolve stays in lockstep with the shader grid. |
| `cardBg`            | `string` (any CSS colour)                                             | preset      | Override the host card surface colour. Applied verbatim to the wrapper background (alpha preserved) AND parsed to opaque RGB for the shader's `u_cardBg` so colour-proximity logic stays in sync. Accepts hex, `rgb()`/`rgba()`, `hsl()`, named colours, etc. |
| `colors`            | `(string \| null)[]`                                                  | preset      | Per-slot palette override (up to 7 CSS colours, one per shader slot). Slots with a value replace the preset colour; `null`/missing slots keep it. Re-tints the running effect without authoring a preset. |
| `images`            | `string \| string[]`                                                  | `[]`        | Reveal pool. Random pick per cycle, never repeats last.                                          |
| `autoReveal`        | `boolean`                                                             | `false`     | When true, runs the auto-loop scheduler.                                                         |
| `revealDelayRange`  | `[number, number]` seconds                                            | `[2, 4]`    | Random shader-only gap between reveals.                                                          |
| `revealHoldMs`      | `number`                                                              | `2000`      | Image visible duration after reveal animation completes.                                         |
| `revealFadeOutMs`   | `number`                                                              | `300`       | Cross-fade back to shader.                                                                       |
| `borderRadius`      | `number`                                                              | (auto)      | Override the corner radius (px). Auto-detected from the wrapped child by default.                |
| `paused`            | `boolean`                                                             | `false`     | Freezes shader and scheduler.                                                                    |
| `onCycle`           | `(p) => void`                                                         | -           | Fires on each phase change: `idle` / `reveal` / `visible` / `hide`.                              |
| `fragmentShader`    | `string`                                                              | -           | Replacement fragment shader (GLSL 1.00, as the bundled one). Applies page-wide while set. See [Custom shader](#custom-shader). |

## Manual reveal (ref handle)

Pass a ref to trigger reveals from a button click or any other user action,
without enabling `autoReveal`:

```tsx
import { useRef } from 'react';
import { ImageGeneration, type ImageGenerationHandle } from 'img-fx';

export function Card() {
  const ref = useRef<ImageGenerationHandle>(null);
  return (
    <>
      <ImageGeneration ref={ref} preset="pixels-organic" images={['/a.jpg', '/b.jpg']}>
        <div className="card" style={{ width: 320, height: 320, borderRadius: 20 }} />
      </ImageGeneration>
      <button onClick={() => ref.current?.triggerReveal()}>
        Reveal image
      </button>
    </>
  );
}
```

`triggerReveal()` runs one full reveal -> hold -> hide pass and is a no-op
while a reveal is already in progress. Works with or without `autoReveal`.

For a **Reveal / Hide toggle** button (like the playground on the demo
page), pair `triggerReveal({ hold: 'manual' })` with `triggerHide()` and
use `isImageActive()` to drive the button label:

```tsx
const onToggle = () => {
  const h = ref.current;
  if (!h) return;
  if (h.isImageActive()) h.triggerHide();
  else h.triggerReveal({ hold: 'manual' });
};
```

## Regenerate

`triggerRegenerate()` re-runs the "generating" effect **from the currently
revealed image**: the photo breaks into the effect's pixel-cell grid and
churns (cells popping in/out with the preset's flicker clock) while the
shader plays through the gaps — then the next image from the pool dissolves
in over the churn and stays visible.

By default the effect is recolored from the outgoing image: its palette is
sampled from the visible pixels and mapped onto the preset's palette slots by
luminance rank, so the churn reads as pixelation born from the image rather
than the preset's stock colors. The palette is restored automatically once
the new image is fully visible.

The churn always uses a pixel-mosaic preset (`pixels-mechanic` /
`pixels-organic`): a `sweep-gradient` card temporarily switches to a
randomly-picked pixel preset for the churn and restores its authored preset
once the new image is fully visible.

```tsx
<button onClick={() => ref.current?.triggerRegenerate({ durationMs: 3000 })}>
  Regenerate
</button>
```

Options:

| Option          | Type      | Default | Notes                                                            |
| --------------- | --------- | ------- | ---------------------------------------------------------------- |
| `durationMs`    | `number`  | `4000`  | Churn length before the next image auto-reveals (held manually). |
| `tintFromImage` | `boolean` | `true`  | Recolor the effect from the outgoing image.                      |
| `autoReveal`    | `boolean` | `true`  | `false` churns indefinitely — end it with `triggerReveal()` or `triggerHide()`. |

No-op unless an image is currently revealed. Requires same-origin (or
CORS-enabled) images for the palette sampling; cross-origin images without
CORS fall back to the preset palette.

## Custom shader

`fragmentShader` swaps the shader every card renders with. The bundled source is
exported as `IMAGE_FRAGMENT_SHADER`; keep everything before `void main()` (the
uniforms, noise, palette, `computeEffect` and the `imgfx_*` mosaic helpers) and
write your own `main()`:

```tsx
import { ImageGeneration, IMAGE_FRAGMENT_SHADER } from 'img-fx';

const prelude = IMAGE_FRAGMENT_SHADER.slice(0, IMAGE_FRAGMENT_SHADER.indexOf('void main()'));
const shader = prelude + `
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 col = imgfx_effectColor(uv, u_resolution.x / u_resolution.y, u_time * u_speed);
  gl_FragColor = vec4(col, 1.0);
}`;

<ImageGeneration fragmentShader={shader} images={['/a.jpg']}>
  <div style={{ width: 320, height: 320, borderRadius: 20 }} />
</ImageGeneration>;
```

Every uniform keeps its name. A custom shader always renders in a single pass.

## Scale invariance

Cell size, vignette range, and edge-fade are computed in CSS pixels (the shader
gets `u_dpr` so it can convert from physical pixels back to CSS px). That means
a `pixels-organic` cell stays the same physical size whether the card is 200×200
or 600×600 — the cell *count* scales with the card, not the cell *size*. No
chunky pixels on big cards.

## Performance

- Single shared `THREE.WebGLRenderer` for the whole page; one WebGL context.
- Mosaic presets render in two passes: the effect (noise, blur taps, highlight) is evaluated once per cell into a tiny grid-sized target, then a cheap per-pixel pass draws the cell mask, vignette and edge fade. Same image as a single pass; the shader cost no longer grows with card size.
- Programs are compiled per effect, on first use, instead of one program holding every effect — much shorter compile stalls when the first card mounts.
- 10 fps default cap via rAF accumulator — ideal for the slow-drift presets. Raise it with `setFrameRate(15)` (up to 60) for faster custom presets.
- `IntersectionObserver` pauses any card that scrolls offscreen.
- Strength is implemented as `canvas.style.opacity` — no shader recompile, no uniform reupload.
- Reveal scratch canvases are reused across frames; only re-allocated when grid size changes.
- Image bitmaps cached by URL across all card instances.

## License

MIT &copy; Jakub Antalik. See [LICENSE](./LICENSE).
