# MagnetKit — a magnet as input, for any iPhone app

The iPhone's magnetometer, turned into a magnet you can design with: where a
magnet is (over the screen or beside the phone), whether it is really there,
and taps in the air — from one small on-device model. No permission prompt,
no network, no data from users. MagnetKit is input only: pair it with any
view or library (MetalFxKit's liquid-metal rings are one).

```swift
// Package.swift
.package(url: "https://github.com/Jakubantalik/Libraries.dev", branch: "main")
// target dependencies
.product(name: "MagnetKit", package: "Libraries.dev")
```

```swift
import SwiftUI
import MagnetKit

let magnet = MagnetSource.shared
magnet.config.locatorEnabled = true
magnet.config.sensorPosition = CGPoint(x: 70, y: 86)   // the magnetometer, window points (iPhone 15 Pro)

struct MagnetDot: View {
    var body: some View {
        TimelineView(.animation) { ctx in
            let r = MagnetSource.shared.reading(now: ctx.date.timeIntervalSinceReferenceDate)
            if let p = r.screenPosition, r.presence > 0.5 {
                Circle().fill(.white).frame(width: 24, height: 24).position(p)
            }
        }
        .ignoresSafeArea()
        .onAppear { MagnetSource.shared.attach() }
        .onDisappear { MagnetSource.shared.detach() }
    }
}

MagnetSource.shared.addGestureHandler { g in
    if case .tap(let at) = g { print("air tap at", at as Any) }
}
```

iOS 17+, iPhone. The Simulator has no magnetometer: feed
`MagnetSource.shared.simulatedField` from `MagnetSimulator.field(magnet:sensor:northUp:)`
(the demo app drives it with a draggable puck).

## The magnet model

One model, one file (`Magnet.mfxl`, ~2 MB, half precision, v1.0), run with
Accelerate on every frame. `MagnetModel.bundled` loads it; `MagnetSource`
runs it for you. It answers three things:

| | Reads | Answers |
|---|---|---|
| **Where** | one magnetometer change, plus the magnet's face and strength when known | position relative to the sensor (screen points via `sensorPosition`), height, and its own uncertainty |
| **Whether** | the last 15 s of the field, and whether the phone was overloaded since its last zero | presence 0–1 and the phone's own offset, so leftovers are cleared and a resting magnet is kept |
| **Tap** | the last 1.28 s at 50 Hz | an air tap — the hovering magnet dipped toward the glass and back — about 0.1 s before the hand is back, with where it landed |

Inside it has three parts (7 → 512 → 512 → 512 → 256 → 6; 238 → 256 → 256 →
128 → 4; 257 → 256 → 256 → 128 → 1), packed into the one file by
`training/pack_model.py`. It was trained only on simulated magnet physics —
dipoles of every size, tilt and face, hand tremor, sensor noise, drift and
leftovers — with the simulator fitted to real recordings on an iPhone 15
Pro (`training/FINETUNE_PLAN.md` has the plan and the results).

## Pairing with other libraries

A reading is plain values — position, presence, pull and its direction,
distance, approach speed — so anything can follow it: a SwiftUI offset, a
spring, a shader uniform. MetalFxKit reads it for rings with
`source: .magnet`:

```swift
import MetalFxKit   // brings MagnetKit along

MetalFx(variant: .circle, source: .magnet) {
    Image(systemName: "arrow.right").frame(width: 52, height: 52)
}
```

## Calibration and the zero

The magnet is seen against a zero taken with no magnet near (Earth plus the
phone's own magnets, e.g. MagSafe). `calibrate()` takes one (it also runs on
the first `attach()` — keep magnets away then). It re-zeros by itself once the
phone settles in a new pose (`autoRecalibrate`). MagSafe accessories, steel
tables, laptops and speakers shift it: recalibrate there.

## Where the magnet is
The model's locator is a small network (7 → 512 → 512 → 512 → 256 → 6,
~660k weights, 1.3 MB in half precision, run with Accelerate) that turns one
magnetometer change into where a magnet hovering over the screen is, relative
to the sensor, plus its own uncertainty — over the screen and around the
phone (v5: on the desk beside it and held in the air beside it). It was
trained only on simulated physics — a dipole hovering or sliding on the
glass or beside the phone, tilted, either face down, strengths from a small
ring to a large N52 block, with sensor noise, leftover drift and small
distortions — so it needs no data from users. `training/` has the scripts,
including calibrating and fine-tuning on real recordings.

Turn it on with `config.locatorEnabled = true` and a `sensorPosition` (the
magnetometer's spot in window points). Readings then carry `screenPosition`,
`screenSpread` and `height`. Two things sharpen
it, and the demo app's Follow screen measures both with nine dots (it also
reports the accuracy it got on that phone):

- `config.magnetStrength` (µT·cm³: a 10×8×2 mm N52 ring is ~6500).
- `config.magnetFace` (+1 north toward the user, −1 south). Without it, a
  magnet beside or above the sensor reads the same as a turned-over one on
  the other side, and the network assumes "below the sensor".

Accuracy is best near the sensor: one magnetometer gives three numbers, so
far from it different heights and tilts look alike.

**Around the phone, not just over it.** `config.locatorMode = .dipole` solves
the physics directly (`MagnetDipole.locate`) instead of using the
network: exact for a magnet whose axis points roughly at the screen, anywhere
above the sensor's height, over the glass or beside the phone. It needs the
face; the strength only sets the distance (2× off moves it by about a
quarter). `MagnetDipole.learn(field:magnetAt:)` gets both from one
reading with the magnet held over a known spot; `MagnetDipole.strength`
re-measures the strength from a spot far from the sensor, where height and
tilt hardly matter, and re-solving the first spot with it gives the
sensor's real position. The demo's Follow screen does this as two
one-second grabs ("hold the magnet over the ring", top then bottom).
Physics limits, worth designing around:

- With the strength unknown only the direction is known: a magnet twice as
  far and eight times as strong reads the same.
- A magnet resting on the desk sits at about the sensor's height, where its
  field is almost vertical and the "which side" part is small: a few degrees
  of tilt swamp it. Held 2–5 cm above the desk it is reliable (simulated:
  bearing ~4–7°, 10–20° tilt tolerated).

**A magnet resting on the desk beside the phone** sits at about the
sensor's height: its field is almost vertical and the sideways part that
carries the bearing is a few %, so a slight tilt swings the bearing by 50°.
Its distance (|B| ≈ K / r³) and its side are still reliable, so with
`config.deskPrior` (on by default) such a reading is placed beside that
edge, ~1.5 cm out, at that distance.

## Keeping the zero honest
A magnet brought within ~2 cm of the phone's magnetometer (above ~2,000 µT)
can magnetise parts near it: the no-magnet reading then shifts by 50–250 µT
for minutes, which reads as a phantom magnet and drowns a real one anywhere
but next to the sensor. `reading.tooClose` says when that is happening.
`config.steadyRezero` (on by default) catches the leftover: right after such
an overload, when the magnet is yanked away, whatever settles within the
next 10 s is zeroed — and the old zero restored if the field comes back to
it. A magnet simply set down near the phone is never zeroed. The source also
remembers its recent calibrations across launches and snaps back to one when
the field settles onto it — so a magnet that was lying next to the phone
during a calibration stops reading as a phantom once it is taken away.

`config.presenceModel` (on by default) runs the model's presence part
(v6c, 238 → 256 → 256 → 128 → 4, ~160k weights,
trained only on simulated sequences, its simulator fitted to a real session). It reads the last 15 s of the field
(1.28 s in detail at 50 Hz, a 10 Hz magnitude history and the overload
peak) and answers whether a magnet is really there. Readings carry
`presence` (0–1) and `offsetEstimate` (the non-magnet part, µT; reliable
once the magnet is gone). `pull` fades out as presence drops below 0.5, and
a confident "no magnet" with a steady field re-zeros the sensor, so
leftovers from an overload are cleared while a magnet resting beside the
phone is kept. On simulated sequences: resting magnet kept 99.7 %, leftover
cleared 97.6 %, magnet taken away 99.9 %, held magnet 99.9 %; a magnet held
while a large leftover dominates is the weak case (66 %). Fine-tuning on
real phones is described in `training/FINETUNE_PLAN.md`.

Measured on an iPhone 15 Pro, a strong magnet touching the glass over the
sensor leaves 160–250 µT that lasts more than six minutes — far beyond the
network's 15 s. So the source remembers an overload until it next zeroes
(a calibration, a leftover re-zero, a snap to a remembered zero) and tells
the network, but only right after the field drops: steady, a leftover and a
magnet lying still read alike, and a resting magnet must not be mistaken
for one. On the recorded session, a magnet taken away after an overload is
now recognised as gone 96–100 % of the time (v6: 53–62 %), so the leftover
is zeroed and the pull lets go; the price is that a magnet set down right
after an overload is sometimes taken for the leftover.

## Gestures
The rate of change of ln|B| over the last ~0.12 s says how fast the magnet
is closing in or leaving (the field goes as 1/r³, so the distance changes
at a third of that rate). Readings carry `approachRate` (1/s) and
`approachSpeed` (cm/s, + toward the phone), and with the locator on,
`lateralVelocity` (points/s). `MagnetSource.shared.addGestureHandler`
reports quick moves on the main queue:

- `.push(speed:)`: the magnet darted toward the phone.
- `.pullAway(speed:)`: it was yanked away.
- `.tap(at:)`: an air tap — the magnet hovering over the glass, dipped
  quickly toward the screen (2–3 cm) and brought back. `at` is the located
  point (global screen points, the bottom of the dip) when the locator is on.
  Recognised by the tap network (below); with `config.tapModel` off, a push
  and a pull-away within `gestureTapWindow` (0.45 s) count instead.
- `.swipe(direction:speed:)`: the located point moved faster than
  `gestureSwipeSpeed` across the screen (locator on).

Thresholds live on `MagnetConfig` (`gesturePushRate`,
`gesturePullRate`, `gestureMinPull`, …).

The air tap is the model's tap part (v7b, 257 → 256 → 256
→ 128 → 1, ~165k weights, trained only on simulated sequences). The size of
the field alone cannot tell a dip from a sweep across the sensor or a flick
of the magnet — all make it jump and fall — but its direction can: in a dip
it barely turns. The network reads the last 1.28 s at 50 Hz and fires about
0.1 s before the hand is back. A dip has to be seen: the field must rise at
least ~8 µT and 1.5× over the hover, so taps far from the sensor with a weak
magnet are missed rather than guessed. Its simulator is fitted to a real
session (iPhone 15 Pro): a tap has to lift the field at least 2× over the
hover, and the phone may carry a leftover offset of up to 300 µT. On that
real session: all 11 taps over the top half recognised, and not one tap
fired during the near-miss takes (slow, tiny and stay-down dips, lifts,
sweeps, flicks — 34 moves).
Over the bottom half, far from the sensor, the dips hardly change the field
and are not recognised.

