# DistortionWavesKit

**Distortion waves** for SwiftUI: a colourful wave that opens from the view
that started it — a button, a screen edge, an avatar — and carries one screen
into another. Everything falls toward the source for a moment, tiny white
sparks with it; then the front leaves the source and travels out as one soft
swell, lifting and bending what it passes, with a progressive blur and
chromatic aberration peaking on it. Its colour stays on the view's edges, with
a hairline on the glass, and is wiped away after the middle has cleared.

iOS 17+ / macOS 14+, rendered with SwiftUI Metal shaders. Free and MIT.

## Install

```swift
// Package.swift, or in Xcode: File › Add Package Dependencies… › paste the URL (Branch: main)
.package(url: "https://github.com/Jakubantalik/Libraries.dev", branch: "main")
// …and in your target's dependencies:
.product(name: "DistortionWavesKit", package: "Libraries.dev")
```

## Usage

```swift
import DistortionWavesKit

struct Transfer: View {
    @State private var sent = false
    @State private var button = CGRect.zero

    var body: some View {
        DistortionWave(isRevealed: sent, source: button, style: .vertical) {
            ReviewScreen()
        } revealed: {
            ReceiptScreen()
        }
        .overlay(alignment: .bottom) {
            Button("Confirm") { sent = true }
                .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { button = $0 }
        }
        .ignoresSafeArea()
    }
}
```

Flip `isRevealed` to send the wave out, flip it back to collapse it into the
source. `source` is in the wave's own coordinate space. Give both sides an
opaque background, and keep them free of UIKit-backed views and materials,
which SwiftUI cannot pass through a shader. The same view on both sides works
too: the wave then carries the screen into itself while you change it.

## Types

| Type | From | Use it for |
| --- | --- | --- |
| `.vertical` | a wide source at the bottom, up the screen | confirming a payment, sending, submitting |
| `.horizontal` | a tall source at the left, across the screen | an edge swipe, a side tab, going on to the next step |
| `.center` | the centre of a round source, as a ring | a success on an avatar or icon, inside a sheet or card |

`DistortionWaveStyle.vertical`, `.horizontal` and `.center` are the tuned
defaults for each — `.center` is tuned for a sheet about 500pt tall, in greens,
with the source itself held sharp at the middle so it can morph in place.

```swift
var style = DistortionWaveStyle(type: .center)
style.cornerRadius = 48          // the corners of the view the wave fills
style.palette = .green           // .colorful, .green, .ocean, .sunset, .mono, .single(color)
DistortionWave(isRevealed: done, source: avatarFrame, style: style) { Sheet() } revealed: { Sheet() }
```

The vertical and horizontal waves lean toward where the source was touched:
pass `focus:` (the touch point) and set `orientation` 0–1.

## Options

`DistortionWaveStyle`, grouped as in the Studio:

- **Timing** — `anticipation` (s), `travel` (s), `easing`, `returnSpeed`,
  `pull` (pt), `inhale` (pt), `gatherGlow`, `gatherDots`, `launchGap` (pt).
- **Edges** — `rimWidth`, `rimUnevenness`, `rimStrength`, `rimPulse`,
  `hairlineWidth`, `hairlineOpacity`, `hairlineWhite`, `hairlineLinger`,
  `hairlineFade`, `linger`, `rimFade`, `rimSoftness`, `rimEasing`,
  `cornerRadius`.
- **Wave** — `amplitude`, `lensWidth`, `aberration`, `swell`, `blur`,
  `blurAhead`, `blurBehind`, `lead`, `tail`, `strength`.
- **Dots** — `particleCount`, `particleSize`, `particleReach`,
  `particleFlight`, `particleGap`, `particleLife`, `particleSpread`.
- **Touch** — `orientation`.
- **Colour** — `palette` (`DistortionWavePalette`: the colours along the
  front and round the edges, plus a fringe ahead and one behind).

`scrub:` holds the wave at a progress 0–1 for screenshots; `onFinish` is
called once it has left and the edges have cleared, or once it has collapsed
back. Reduce Motion turns it into a plain crossfade.

## Testing

The `.metal` shader is compiled by Xcode's build system; the timeline itself
is plain Swift and tested with `swift test`:

```bash
swift test
```

The demo app with the Send money (vertical), Horizontal and USDC sheet (center)
prototypes lives in the Waves project.
