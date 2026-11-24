# MetalFxKit — metal-fx v2 for SwiftUI

The liquid-metal UI from [metal-fx](../../../README.md) v2, rebuilt for iOS 17+ on
SwiftUI's shader pipeline. Same material (Paper Shaders' `liquidMetal`, ported
to Metal Shading Language), same presets, same numbers as the web engine —
with the phone's tilt playing the pointer.

```swift
import MetalFxKit

MetalFx(variant: .circle, preset: .chromatic, strength: 0.9, innerShadow: true, id: "send") {
    Image(systemName: "arrow.up").frame(width: 40, height: 40)
}

Text("Auto").metalReflection(of: "send")          // the chip catches the ring's light
MetalText("Pro", id: "pro")                        // metal inside the glyphs
Text("Plan").metalReflection(of: "pro", strength: 0.64, style: .glyphs)
MetalBadge("New")                                  // the white pill with a metal rim
```

## What's in it

| Web (`metal-fx`)              | SwiftUI                                  |
| ----------------------------- | ---------------------------------------- |
| `<MetalFx>` circle / button   | `MetalFx(variant:preset:theme:…)`        |
| `<MetalText>`                 | `MetalText(_:font:color:…)`              |
| `<MetalBadge>`                | `MetalBadge(_:…)`                        |
| `reflectionTargets`           | `MetalReflectionScope { }` (automatic), `.metalReflection(of:strength:style:)` |
| `useMetalBend` (cursor)       | `tilt: true` (CoreMotion gravity), `source: .pointer` (finger) |
| —                             | `source: .magnet` (from a provider)       |
| glow (halo + catch-light)     | `glow`, `glowGain`, `MetalGlowConfig`    |
| `innerShadow`                 | `innerShadow: true`                      |
| cursor light                  | — (no pointer on a phone)                |

### Tilt bend
`MetalFx(tilt: true)` (the default) bends the ring like liquid toward the low
side of the phone: the contact point is the outline point in the tilt
direction, the amplitude follows the tilt angle, springs and a liquid stretch
term are the web's `useMetalBend` field. Tilt is measured against a slowly
adapting baseline, so it reads as a gesture and settles back when the phone
is held still. Tune with `MetalBendConfig`; drive it by hand (Simulator,
tests) through `MetalTiltSource.shared.override`.

### Magnet
`MetalFx(source: .magnet)` bends the ring toward a real magnet near the phone
with the desktop hover bend. MetalFxKit has no magnet code of its own: it asks
`MetalMagnet.provider` every frame.
[MagnetKit](https://libraries.dev/magnetic), a separate download under the
Libraries.dev Model License, comes with the file that makes it the provider
(`Extras/MetalFxMagnet.swift`); any other source that conforms to
`MetalMagnetProvider` works too. Without one, `.magnet` rings hold their shape.

- **Bend:** the web's `useMetalBend`, ported line for line, with the magnet
  as the cursor. A virtual pointer sits on the line toward the magnet and
  closes in from `reach` as the pull rises (the hover pull, ×
  `magnetGain`); a repelling face presses it in through the edge instead,
  so the metal recoils. Same springs, liquid stretch, lag and envelope, so
  it wobbles back when the magnet leaves.
- **Other drivers:** `source: .pointer` is the finger as the desktop cursor
  (install `.metalPointerTracking()` on a root view); `source:
  .manual(driver)` takes any field (`MetalMagnetDriver`: audio bass, a game).

Bigger rings want bigger numbers: `MetalBendConfig.default.scaled(k)`
multiplies every length (the web's are tuned for a 40-pt button).

### Automatic reflections
Wrap a screen (or any container) in `MetalReflectionScope { … }` and every
`MetalFx` inside reflects onto the surfaces around it — fields, chips,
cards, text — with no per-view setup. The scope renders its content once
more off screen, without the metal, to learn where surfaces are (anything
that differs from the background), flood-fills the ones that start within
reach of each ring, measures their frame and corner radius, and draws the
same reflection `.metalReflection(of:)` does on each — so it looks
identical, following the bend. Rebuilt when the scope resizes or rings come
and go. Opt a ring out with
`MetalFx(reflection: 0)`; tune with `MetalReflectionScope(strength:)`.

### Reflections
Give a ring, text or badge an `id`; any view can then `.metalReflection(of:)`
it. The neighbour's facing edge gets the mirrored band (or sheet) with the
web's alpha stacking, gradient, blur and lift; `style: .glyphs` lands it on
letterforms only.

## Performance
- The material is a `colorEffect` on the band, the glyphs or the pill: GPU,
  fragment-only, evaluated on the few thousand pixels the shape covers.
- Nothing is read back from the GPU. The glow's luminance hunt samples a
  CPU port of the material at 16 points every 66 ms.
- Halo sprites are baked once (CoreGraphics + box-blur gaussian), then
  positioned, tinted and masked per frame.
- One `TimelineView` per instance at 60 fps; the bend physics and glow state
  are plain classes updated inside the frame, so SwiftUI diffs only the
  changed layers.

## Building
The `.metal` file is compiled by Xcode's build system, not SwiftPM alone —
build through Xcode or `xcodebuild`. The demo in `../MetalFxDemo` (xcodegen)
runs with `./run.sh`; in the Simulator, `-focus edge -holdTilt YES` and the
tilt pad stand in for CoreMotion.

Apple's cursor artwork from the web demo is not part of this package; there
is no cursor on iOS.
