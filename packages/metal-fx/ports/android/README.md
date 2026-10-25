# MagnetKit for Android, and Magnetic Home

- `magnetkit/` — the Android twin of MagnetKit (`../ios/MagnetKit`): the same
  magnet model (`Magnet.mfxl`, one file, v1.0, loaded from the app's
  `assets/`), and the source around it — the uncalibrated magnetometer (Android's own calibration would slowly
  take a nearby magnet for part of the phone), the zero and its leftovers,
  presence, the locator, air taps and gestures. A library of its own: any app
  can read `MagnetSource.get(context).reading(now)` every frame.
- `magnetic-home/` — a home screen whose apps feel a magnet beside the phone:
  pulled toward it, resting against the rounded edge, springing back when it
  leaves; an air tap opens the app under it. Swipe up for every app; long
  press for calibrate and the grab. Make it the home app in Settings › Apps ›
  Default apps › Home app (and switch back to Pixel Launcher there).

Lengths on screen are dp (≈ iOS points); the physics and thresholds are the
iOS demo's.

The model is licensed separately under the Libraries.dev Model License
(`LICENSE-MODEL.md` at the repo root) and is not in this repo (`*.mfxl` is
ignored). Download it from libraries.dev/magnetic and put it in your app's
`src/main/assets/`. To build Magnetic Home or Magnet Bridge from here, copy it
into `magnetkit/src/main/assets/` (untracked).

Build: Android Studio (or `./gradlew :magnetic-home:installDebug` with a phone
plugged in, USB debugging on). `./gradlew :magnetkit:test` checks the model
against the trained PyTorch networks (`src/test/resources/parity.json`); it
skips when the model file is missing.

The model has only been tested on an iPhone 15 Pro. On another phone the
magnetometer sits elsewhere (the grab finds it) and leftovers after a "too
close" moment differ; record a session there before trusting the numbers.
