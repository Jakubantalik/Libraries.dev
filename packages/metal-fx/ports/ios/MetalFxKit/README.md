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
| —                             | `source: .magnet` (magnetometer)         |
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
`MetalFx(source: .magnet)` bends the ring toward a real magnet near the
phone with the desktop hover bend. The iPhone's magnetometer reads how the
magnet bends the field (no permission needed); against a baseline taken
with no magnet near, the change gives a closeness (a log scale from the
3 µT noise floor up to `fullScale`, 60 µT by default — a small fridge
magnet held close; raise it for neodymium), a bearing (rough until
trained, see below) and the magnet's face.

- **Bend:** the web's `useMetalBend`, ported line for line, with the magnet
  as the cursor. A virtual pointer sits on the line toward the magnet and
  closes in from `reach` as the pull rises (the hover pull, ×
  `magnetGain`); a repelling face presses it in through the edge instead,
  so the metal recoils. Same springs, liquid stretch, lag and envelope, so
  it wobbles back when the magnet leaves.
- **Bearing:** a flat magnet on the table sits slightly below the sensor,
  so the direction toward it is `sign(Bz) · B_xy`. That survives flipping
  the magnet (both components flip), while `sign(Bz)` gives the face:
  `polarity: .auto` attracts with the north face up and repels with the
  south face up (`invertPolarity` swaps them). Held high above the phone
  the vertical component reverses, so `.auto` flips there too — use
  `.attract` if that matters.
- **Calibration:** `MetalMagnetSource.shared.calibrate()` with no magnet
  near (it also runs on first attach). It re-zeroes by itself once the
  phone settles in a new pose (`autoRecalibrate`). MagSafe accessories,
  steel tables, laptops and speakers shift the baseline: recalibrate there.
  Flat on a table is the steady case.
- **Trained directions (recommended):** the sensor sits somewhere other
  than the ring (each model differs), so the raw bearing is off by 20–40°
  for a magnet beside the phone. Record what the field looks like with the
  magnet at a few spots around the phone (`config.templates`, one
  `MetalMagnetTemplate(angle:field:)` per spot; the demo's "Train
  directions" walks through 8). The reading is matched against the
  trained spots by its field direction (vertical part down-weighted,
  `templateVerticalWeight`) and its log strength (`templateStrengthWeight`)
  — a softmax on the squared distance — and their angles are averaged;
  the reversed field is tried too, so a flipped magnet is told apart from
  one on the far side. Slow drift is re-zeroed while the field is weak and
  steady (`driftSeconds`); on a real phone ~4.5 µT was left behind after a
  magnet came close, as large as a far magnet's signal. Matching the
  3-D shape matters: on a real iPhone 15 Pro the magnetometer sits near the
  top, so a magnet anywhere along the bottom or right puts an almost
  vertical field on it (in-plane part 14–18 %), and interpolating on that
  in-plane direction landed >100° off for a fifth to a third of readings
  there; the 3-D match (how vertical the field is says how far the magnet
  is from the sensor) never did, at ~15° mean error
  (`templateSharpness` 80). Spots that look alike to the sensor blend: on
  that phone "right" and "below the bottom-right corner" read nearly the
  same, so either bends a corner ring down-right.
  Rings follow the side of the phone the magnet is on (the bearing
  from `config.templateOrigin`, the point the angles were measured from).
  Give the templates a `distance` too and the source estimates the magnet's
  position (`reading.position`); `aimRadius` lets rings near it aim at it.
  It is off by default: on that iPhone the spots along the bottom and right
  read alike, so the estimate was a blend that landed beside a bottom-right
  button and pulled it left or up. Following the side, the same readings
  bend it down-right every time.
- **Sensor spot:** alternatively set `config.sensorPosition` (window
  points) to aim each ring at the estimated magnet position; find it by
  sliding a magnet over the back and watching for the peak.
- **Other drivers:** `source: .pointer` is the finger as the desktop cursor
  (install `.metalPointerTracking()` on a root view); `source:
  .manual(driver)` takes any field (`MetalMagnetDriver` — audio bass, a
  game). `MetalMagnetSource.shared.simulatedField` feeds a raw field, and
  `MetalMagnetSimulator.field(magnet:sensor:northUp:)` computes a dipole's,
  which is how the demo's draggable puck works in the Simulator.

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
