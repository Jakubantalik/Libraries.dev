# Magnet example (React Native)

A small Expo app for `react-native-magnetkit`: chips and cards the magnet
pulls, live readings, air taps, and the calibration screen.

1. Download `Magnet.mfxl` from https://libraries.dev/magnetic (Model tab) into
   `assets/`. It is licensed separately and never committed.
2. `npm install`
3. `npx expo run:ios --device` or `npx expo run:android` (a real phone: the
   Simulator and emulators have no magnetometer).

The kit is linked from `../magnetkit-native` (`file:`); Metro watches it.
