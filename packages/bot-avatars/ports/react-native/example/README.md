# bot-avatars-native example

Expo app with the bot avatars on the phone: a grid of the eighteen types
(tap one to make it hop; drag a finger over the grid and they all look at
it; toggles for state, face, whirl, size, one canvas vs a canvas each and
sprite vs vector sides), a controls screen with every prop and the jump
group, and the reference grid — the 18 × 5 still poses the web renderer's
screenshots are compared against, drawn through the same code and
exportable as a PNG at the web's pixel geometry. A stats line at the
bottom reads the frame costs: frame rate, UI-thread recording time per
avatar (and how many frames rebuilt their lighting), JS-thread rig time,
the hand-over per frame, and the last form bake.

```bash
npm install
npx expo run:ios
```

Skia and Reanimated are native modules, so Expo Go will not work — `expo
run:*` builds the app. The first run prebuilds, installs pods and compiles
React Native from source; budget 15+ minutes.

Expo SDK 54 (React Native 0.81, Reanimated 4, react-native-skia 2.12) —
Xcode 16.1 or newer. The web package is a `file:` dependency (npm symlinks
`../../..`), so `metro.config.js` watches that folder and blocks its
`node_modules`.

## Notes from building it

- Metro must not resolve dependencies from `../bot-avatars-native/node_modules`
  or the web package's `node_modules` (those exist only for typechecks);
  `metro.config.js` blocks both folders, otherwise a second copy of Worklets
  JS runs against the app's single native build and the app fails at startup
  with `TypeError: undefined is not a function`.
- npm 11 nests `babel-preset-expo` under `expo/node_modules` instead of
  hoisting it, and `babel.config.js` cannot see it there
  (`Cannot find module 'babel-preset-expo'`), so it is a devDependency here.
- If your checkout path contains a space, two generated build steps fail
  with `…: is a directory`:
  - the app's `Bundle React Native code and images` phase runs an unquoted
    backtick substitution for `react-native-xcode.sh`; wrap it in
    `"$(…)"` in `ios/<app>.xcodeproj/project.pbxproj` after `expo prebuild`
    (`expo run:ios` re-runs prebuild only when `ios/` is missing);
  - expo-constants' `[CP-User] Generate app.config…` phase runs
    `get-app-config-ios.sh` through `bash -c` unquoted, and the script
    itself does `basename $PROJECT_DIR` unquoted. `expo run:ios` re-runs
    `pod install`, which regenerates the Pods project from the podspec, so
    patch the sources in `node_modules/expo/node_modules/expo-constants/`:
    in `ios/EXConstants.podspec` make the script
    `bash -l -c "\"$PODS_TARGET_SRCROOT/../scripts/get-app-config-ios.sh\""`,
    and in `scripts/get-app-config-ios.sh` quote `basename "$PROJECT_DIR"`.
    Or clone to a path without spaces.
- Worklets capture what their closure holds when the module evaluates:
  a helper function declared *after* the worklet that calls it is
  `undefined` inside it on the UI thread (`drawWhirl is not a function`).
  Helpers come first in `draw.ts`.
- The app can be driven from outside for the checks:
  `xcrun simctl openurl booted "botavatarsnative://x?tab=reference&export=1"`
  switches to the reference screen and writes `reference-grid.png`
  (5184 × 1440, the web reference's size) into the app's Documents folder
  (`xcrun simctl get_app_container booted com.jakubantalik.botavatarsnative data`);
  `?tab=grid&state=working&size=96&whirl=1&face=mouth&shading=crisp&count=9&sheet=0&sides=vector&poke=1`
  sets the grid; `?tab=reference&export=form&type=blob&n=96` writes
  `form.json`, the raw baked form of a type, for inspection.
- On the Simulator the stats line settles a few seconds after a change
  (the forms bake one per timer slot, about 165 ms each on Hermes at the
  96-texel tier).
