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
| `reflectionTargets`           | `.metalReflection(of:strength:style:)`   |
| `useMetalBend` (cursor)       | `tilt: true` (CoreMotion gravity)        |
| glow (halo + catch-light)     | `glow`, `glowGain`, `MetalGlowConfig`    |
| `innerShadow`                 | `innerShadow: true`                      |
| cursor light                  | — (no pointer on a phone)                |
| —                             | `.metalEdgeHalo()` screen-edge refraction |

### Tilt bend
`MetalFx(tilt: true)` (the default) bends the ring like liquid toward the low
side of the phone: the contact point is the outline point in the tilt
direction, the amplitude follows the tilt angle, springs and a liquid stretch
term are the web's `useMetalBend` field. Tilt is measured against a slowly
adapting baseline, so it reads as a gesture and settles back when the phone
is held still. Tune with `MetalBendConfig`; drive it by hand (Simulator,
tests) through `MetalTiltSource.shared.override`.

### Reflections
Give a ring, text or badge an `id`; any view can then `.metalReflection(of:)`
it. The neighbour's facing edge gets the mirrored band (or sheet) with the
web's alpha stacking, gradient, blur and lift; `style: .glyphs` lands it on
letterforms only.

### Edge halo
`.metalEdgeHalo()` on a pure-SwiftUI view that touches the display's edge. When
a ring with an `id` sits within `reach` of that edge, a strip along it
refracts the view's content toward the edge (a lens with a chromatic split)
and blooms in the metal's most saturated colour — light leaving through the
glass edge. Inactive it costs nothing; active it is one layer pass over that
view per frame, so keep it on a card, not a `ScrollView` (UIKit-backed views
cannot be rasterised into a layer).

## Performance
- The material is a `colorEffect` on the band, the glyphs or the pill: GPU,
  fragment-only, evaluated on the few thousand pixels the shape covers.
- Nothing is read back from the GPU. The glow's luminance hunt and the halo
  tint sample a CPU port of the material at 16 points every 66 ms.
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
