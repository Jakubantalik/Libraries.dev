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
