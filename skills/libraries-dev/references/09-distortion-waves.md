# Distortion waves

A colourful distortion wave that carries one view into another (`distortion-waves`, component `DistortionWave`): it opens from a button, an edge or an avatar with a quick pull toward the source, a soft swell with progressive blur and chromatic aberration, and colour that stays on the edges, with a hairline on the glass, after the middle has cleared. React and SwiftUI.

Three types:

- **Vertical**: up the view from a button at the bottom.
- **Horizontal**: across the view from a tall source at the left.
- **Center**: a ring out from an avatar or icon, round a sheet or card.

## When to use

### Where it goes

- **A confirmation that turns into its result**: Confirm → receipt, Send → sent, Pay → paid. The wave opens from the button that was pressed.
- **A step that hands over to the next screen** in a short flow (a sheet, a card, a checkout), where the change should feel like one motion.

More situations it fits:

- An avatar or icon that opens into a card or sheet (`type="center"`).
- A side panel or rail that sweeps its content across (`type="horizontal"`).
- Reversing back to the first view (`revealed={false}` collapses the wave into its source).

### When not to use

- Route changes across a whole app, or long scrolling pages. It pictures the element, so keep it to a card, sheet or screen-sized view.
- Waits or loading. Use **Thinking orbs** or **Border beam**.
- Many waves at once. One wave at a time per screen.

## Install

```bash
npm install distortion-waves
```

```tsx
import { DistortionWave } from 'distortion-waves';
```

- React 18+. One clear WebGL 2 canvas over your own markup, in Chrome, Safari and Firefox. Without WebGL 2, and with reduced motion, it is a crossfade.
- SwiftUI (iOS 17+), Swift Package Manager: `.product(name: "DistortionWavesKit", package: "Libraries.dev")` from `https://github.com/Jakubantalik/Libraries.dev`.

## Basic usage

```tsx
import { useRef, useState } from 'react';
import { DistortionWave } from 'distortion-waves';

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
      style={{ width: 620, borderRadius: 28, overflow: 'hidden' }}
    >
      <Review />
    </DistortionWave>
  );
}
```

Setting `revealed` runs the wave forwards; setting it back to `false` collapses it into its source. Both views are your own DOM, laid on top of each other; the element takes the size of the larger. Give them an opaque background. The wave bends a picture of the views taken just before the run, so animation inside a view stands still while the wave passes; put the button that starts it, a spinner or a video in `overlay`, which stays live above the wave.

## Options (free)

| Prop | Values | Notes |
|---|---|---|
| `children` | `ReactNode` | The view that shows first. |
| `revealedContent` | `ReactNode` | The view the wave leaves behind. Without one the wave passes over `children` and leaves them as they were. |
| `overlay` | `ReactNode` | Stays above the wave, unbent, over both views. |
| `revealed` | `boolean` | Which view shows; changing it runs the wave. Leave it out to drive the wave with the handle's `play()`. |
| `type` | `vertical` (default), `horizontal`, `center` | The shape of the front. |
| `source` | element, ref or `{ x, y, w, h }` | Where the wave starts. Default: the control last pressed. |
| `palette` | `colorful`, `green`, `ocean`, `sunset`, `mono`, or `#RRGGBB` | The colours. |
| `reducedMotion` | `system` (default), `always`, `never` | When to crossfade instead. |
| `onFinish` | `(revealed) => void` | Called when a wave ends. |

Handle (`ref`): `play()`, `reverse()`, `reset()`, `await prepare()`. Without React: `new WaveController(root, content, revealedOrNull)`.

## Accessibility & performance

- Reduced motion crossfades instead of waving.
- Images from another origin without CORS, closed shadow roots and `iframe`s cannot be pictured; mark anything to leave out with `data-dw-skip`.
- A `<canvas data-dw-live>` inside a view is read every frame, so the wave bends what it shows as it animates. Keep these small.

## Common mistakes

- Transparent views: the wave bends what is behind them too. Give each view an opaque background.
- The pressed button inside `children`: it freezes in the picture. Put it in `overlay`.
- Wrapping a whole page. Wrap the card or sheet that changes.

## Detecting a fit in a codebase

| Signal to grep for | Suggest |
|---|---|
| Confirm/success swaps: `isConfirmed`, `setSent`, `orderPlaced`, a receipt or "Payment sent" view replacing a form | `DistortionWave` with `revealed` from that flag, `source` the confirm button. |
| `AnimatePresence`, `framer-motion` crossfades between two views of one card | `vertical` from the bottom button, or `center` from an avatar. |
| Avatar or icon that opens a profile card or sheet | `type="center"`, `source` the avatar. |
| Checkout, transfer, booking or send flows with a final step | The last step's button reveals the result. |

## Go further (Pro)

- The wave's numbers (travel, swell, blur, aberration, edge, particles), custom palettes and the Pro wave types, in the Studio at https://libraries.dev/studio or through the Pro skill.
