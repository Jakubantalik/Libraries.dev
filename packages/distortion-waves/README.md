# Distortion waves

A colourful distortion wave that opens from a button, an edge or an avatar
and carries one view into another: a quick pull toward the source, a soft
swell with progressive blur and chromatic aberration, and colour that stays on
the edges, with a hairline on the glass, after the middle has cleared.

Three types:

- **Vertical** — up the view from a button at the bottom.
- **Horizontal** — across the view from a tall source at the left.
- **Center** — a ring out from an avatar or icon, round a sheet or card.

For React on the web and for SwiftUI. Try it on
[libraries.dev/waves](https://libraries.dev/waves), and tune every option in
the Studio.

## React

```bash
npm install distortion-waves
```

React 18 or later. The wave is one clear WebGL 2 canvas over your own markup,
in Chrome, Safari and Firefox. Without WebGL 2, and when the visitor asks for
reduced motion, it is a crossfade.

```tsx
import { useRef, useState } from "react";
import { DistortionWave } from "distortion-waves";

function Transfer() {
  const [sent, setSent] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  return (
    <DistortionWave
      revealed={sent}
      source={button}
      revealedContent={<Receipt />}
      overlay={
        <button ref={button} onClick={() => setSent(true)}>
          Confirm
        </button>
      }
      style={{ width: 620, borderRadius: 28, overflow: "hidden" }}
    >
      <Review />
    </DistortionWave>
  );
}
```

Setting `revealed` runs the wave forwards; setting it back to `false` collapses
the wave into its source. A click on the source leans the front toward the
pointer.

Both views are your own DOM, laid on top of each other; the element takes the
size of the larger. Give them an opaque background, or put one behind the
whole element. The wave bends a picture of the views, taken ahead of the run,
so what animates inside a view stands still while the wave passes. Put the
button that starts it, a spinner or a video in `overlay`, which stays live
above the wave.

### Props

Every other prop goes to the element, a `div`.

| Prop | Type | Default | |
| --- | --- | --- | --- |
| `children` | `ReactNode` | | The view that shows first. |
| `revealedContent` | `ReactNode` | | The view the wave leaves behind. Without one the wave passes over `children` and leaves them as they were. |
| `overlay` | `ReactNode` | | Stays above the wave, unbent and uncoloured, over both views. |
| `revealed` | `boolean` | | Which view shows. Changing it runs the wave. Leave it out to drive the wave with `play()`. |
| `type` | `"vertical" \| "horizontal" \| "center"` | `"vertical"` | The shape of the front. |
| `source` | element, ref or `{ x, y, w, h }` | the control last pressed | Where the wave starts. |
| `focus` | `{ x, y } \| null` | the last press | The point the front leans toward, in the element's CSS pixels. |
| `palette` | `"colorful" \| "green" \| "ocean" \| "sunset" \| "mono"`, `#RRGGBB` or a `Palette` | the type's own | The colours. |
| `waveStyle` | `Partial<WaveStyle>` | the type's own | Any of the wave's numbers: travel, swell, blur, aberration, edge, particles. |
| `scale` | `number \| "auto"` | `"auto"` | CSS pixels per point. `"auto"` sizes the wave to the element. |
| `cornerRadius` | `number` | the element's border radius | The radius the edge colour follows. |
| `scrub` | `number \| null` | | Holds the wave at this point of its run, 0 to 1, instead of playing. |
| `capture` | `boolean \| CaptureFunction` | `true` | How the element is pictured. `false` draws the colour alone. |
| `live` | `boolean \| "animations"` | `true` | Whether the picture follows the element while the wave is out. |
| `prewarm` | `boolean` | `true` | Takes the first picture when the browser is idle after mounting. |
| `resolution` | `number` | the display's | Canvas pixels per CSS pixel. |
| `reducedMotion` | `"system" \| "always" \| "never"` | `"system"` | When to crossfade instead. |
| `onFinish` | `(revealed: boolean) => void` | | Called when a wave ends. |

### Handle

```tsx
const wave = useRef<DistortionWaveHandle>(null);

wave.current?.play();     // from the start; takes { source, focus }
wave.current?.reverse();  // back to the first view
wave.current?.reset();    // straight back, with no wave
await wave.current?.prepare(); // picture the element now
```

### What the picture can hold

The lens works on a picture of your markup, drawn by the library: text, images
from the same origin or served with CORS, SVG, gradients, shadows and web
fonts. A `<canvas>` and a `<video>` are copied as the frame they show.

It cannot see images and fonts from another origin served without CORS, closed
shadow roots, or a WebGL canvas that does not preserve its drawing buffer.
`iframe`, `object`, `embed` and `audio` are left out. Add `data-dw-skip` to
leave any element out of the picture, and pass your own `capture` function to
replace the built-in one.

A `<canvas data-dw-live>` inside a view is read every frame instead: the wave
bends what it shows as it animates, such as an avatar turning into a check
while the front passes over it. Keep these small; each one is copied to the GPU
on every frame of the wave.

### Without React

```ts
import { WaveController } from "distortion-waves";

const wave = new WaveController(root, content, revealedOrNull);
wave.update({ type: "center", palette: "ocean" });
wave.play({ source: button });
// …
wave.destroy();
```

The model (`waveFront`, `defaultStyle`, `PALETTES`) and the `WaveRenderer` are
exported too, for drawing the wave over something else.

## SwiftUI

iOS 17 and later: [`ports/ios/DistortionWavesKit`](ports/ios/DistortionWavesKit).

## Licence

MIT — see [LICENSE](LICENSE).
