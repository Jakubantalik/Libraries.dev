/* One magnet session for the app: the native side runs while anything
   listens and stops when the last listener leaves. */

import Native, { type NativeMagnetFrame, type NativeMagnetGesture, type StoredMagnet } from "./MagnetKitModule";
import type { CalibrationFit } from "./core/fit";

type Subscription = { remove(): void };

let users = 0;
let frameSub: Subscription | null = null;
const frameListeners = new Set<(f: NativeMagnetFrame) => void>();
const gestureListeners = new Set<(g: NativeMagnetGesture) => void>();
let gestureSub: Subscription | null = null;

function retain() {
  if (users++ > 0) return;
  frameSub = Native.addListener("onFrame", (f) => {
    Magnet.frame = f;
    Magnet.frameAt = performance.now();
    frameListeners.forEach((l) => l(f));
  });
  gestureSub = Native.addListener("onGesture", (g) => gestureListeners.forEach((l) => l(g)));
  Native.start();
}

function release() {
  if (--users > 0) return;
  users = 0;
  frameSub?.remove();
  gestureSub?.remove();
  frameSub = gestureSub = null;
  Magnet.frame = null;
  Native.stop();
}

export const Magnet = {
  /** The latest reading while anything listens. */
  frame: null as NativeMagnetFrame | null,
  /** When it arrived, performance.now() ms (its own `t` is the native clock). */
  frameAt: 0,

  /** The phone has a magnetometer. */
  isAvailable: (): boolean => Native.isAvailable(),
  /** Magnet.mfxl is in the app (see the config plugin). Without it readings
   *  still come, but nothing is located and there are no air taps. */
  hasModel: (): boolean => Native.hasModel(),

  /** Every reading, once per display frame. Starts the sensor; returns an unsubscribe function. */
  addFrameListener(l: (f: NativeMagnetFrame) => void) {
    frameListeners.add(l);
    retain();
    return () => {
      if (frameListeners.delete(l)) release();
    };
  },

  /** Air taps, pushes, pull-aways and swipes. Starts the sensor; returns an unsubscribe function. */
  addGestureListener(l: (g: NativeMagnetGesture) => void) {
    gestureListeners.add(l);
    retain();
    return () => {
      if (gestureListeners.delete(l)) release();
    };
  },

  /** Take a new zero (keep magnets away for a second). */
  zero: () => Native.zero(),

  /** The calibrated magnet, kept across launches; null before a calibration. */
  getMagnet: (): StoredMagnet | null => Native.getMagnet(),
  setMagnet: (fit: Pick<CalibrationFit, "face" | "strength" | "sensor">) =>
    Native.setMagnet(fit.face, fit.strength, fit.sensor.x, fit.sensor.y),
  clearMagnet: () => Native.clearMagnet(),

  /** The screen as the readings measure it: size (points / dp) and points per cm. */
  screen: () => Native.screen(),
};
