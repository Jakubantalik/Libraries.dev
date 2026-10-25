# react-native-magnetkit

Magnetic UI for React Native: a real magnet beside the phone pulls your
interface. An Expo module around MagnetKit, the on-device magnet model for
iOS (Swift) and Android (Kotlin), with React hooks, a `MagneticView` that the
magnet pulls, and a ready-made calibration screen.

Docs and the model: https://libraries.dev/magnetic

## Install

```sh
npx expo install react-native-magnetkit
```

The model (`Magnet.mfxl`, 2 MB) is not in this package. Download it from
https://libraries.dev/magnetic (Model tab), put it in your app's `assets/`,
and point the config plugin at it:

```json
{
  "expo": {
    "plugins": [["react-native-magnetkit", { "model": "./assets/Magnet.mfxl" }]]
  }
}
```

The plugin copies it into the iOS app target and Android's assets at
prebuild. It ships native code, so use a development build
(`npx expo run:ios`, `npx expo run:android` or EAS), not Expo Go.

Bare React Native: run `npx install-expo-modules`, then add `Magnet.mfxl` to
the iOS target's Copy Bundle Resources and to `android/app/src/main/assets`.

## Use

```tsx
import { Magnet, MagnetCalibration, MagneticView, useMagnet, useMagnetGestures } from "react-native-magnetkit";

// Views the magnet pulls. They collide, and spring back when it leaves.
<MagneticView style={styles.chip}><Text>Home</Text></MagneticView>

// Once per phone and magnet: five rings, about 10 s, kept across launches.
<MagnetCalibration visible={calibrating} onClose={(ok) => setCalibrating(false)} />

// Readings and gestures.
const f = useMagnet();   // f.pos (window points), f.presence, f.pull, f.strength…
useMagnetGestures((g) => { if (g.g === "tap") openMenu(g.at); });
```

- `useMagnet()` re-renders once per frame; `useMagnetFrame(cb)` gets every
  reading without rendering.
- `Magnet.hasModel()`, `Magnet.zero()`, `Magnet.getMagnet()`,
  `Magnet.clearMagnet()`, `Magnet.addFrameListener()`.
- `getMagneticField()` tunes the physics (stiffness, damping, force, reach).
- `calibrate({ onUpdate })` runs a calibration headless, to draw your own rings.

The sensor runs only while something listens. Keep the magnet 2 cm or more
from the sensor (`f.tooClose`).

## Repository layout

The Swift and Kotlin sources come from `../../ios/MagnetKit` and
`../../android/magnetkit`, and the shared TypeScript (readings, calibration
fit, Magnetic UI physics) from `packages/magnetkit-web`. `npm run sync`
copies them in (`prepare` and `build` run it); the copies are not committed.
`../magnet-example` is a working app.

## License

The code is MIT. The model is under the Libraries.dev Model License: free for
development, prototypes and non-commercial apps; a commercial app needs
Libraries.dev Pro or Business.
