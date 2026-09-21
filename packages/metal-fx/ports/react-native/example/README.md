# metal-fx-native example

Expo app with the metal-fx v2 demo cards on the phone: the composer (send
ring reflecting onto the Auto chip), Plan Pro, Live mode · New, a pill
button, and a ring at the screen edge for the edge halo. A tilt pad bends
the rings by hand where there is no accelerometer.

```bash
npm install
npx expo run:ios
```

Skia and Reanimated are native modules, so Expo Go will not work — `expo
run:*` builds a dev client. The first run prebuilds, installs pods and
compiles React Native from source; budget 15+ minutes.

Expo SDK 54 (React Native 0.81, Reanimated 4) — Xcode 16.1 or newer.

## Notes from building it

- Metro must not resolve dependencies from `../metal-fx-native/node_modules`
  (those exist only for the package's typecheck); `metro.config.js` blocks
  that folder, otherwise a second copy of Worklets JS runs against the app's
  single native build and the app fails at startup with
  `TypeError: undefined is not a function`.
- Skia 2.12 needs `react-native-worklets` ≥ 0.7 to hand Skia objects to
  worklets; this example pins 0.8 with Reanimated 4.1.
- If your checkout path contains a space, Expo's generated Xcode script phases
  (`[CP-User] Generate app.config…` and `Bundle React Native code and images`)
  fail with `…: is a directory` — they run their script paths unquoted. Quote
  them in the generated `ios/` projects, or clone to a path without spaces.
