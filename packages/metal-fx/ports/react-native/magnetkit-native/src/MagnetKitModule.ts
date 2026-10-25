import { NativeModule, requireNativeModule } from "expo";
import type { MagnetFrame, Pt } from "./core/types";

/** A reading as the native side sends it: the web kit's frame and a little more. */
export type NativeMagnetFrame = MagnetFrame & {
  /** Unit vector, screen axes, toward the magnet (the bearing without the locator). */
  toward: Pt;
  /** +1 attracts, −1 repels. */
  polarity: number;
  /** Rough distance to the magnet, cm; null when none is near. */
  distance: number | null;
  /** How fast the magnet comes toward the phone, cm/s (negative: away). */
  approachSpeed: number;
  /** The phone has a zero to measure from. */
  zeroed: boolean;
};

export type NativeMagnetGesture =
  | { g: "tap"; at: Pt | null }
  | { g: "push" | "pullAway"; speed: number }
  | { g: "swipe"; dir: Pt; speed: number };

export type StoredMagnet = { face: 1 | -1; strength: number; sensor: Pt };

type Events = {
  onFrame(f: NativeMagnetFrame): void;
  onGesture(g: NativeMagnetGesture): void;
};

declare class MagnetKitNative extends NativeModule<Events> {
  isAvailable(): boolean;
  hasModel(): boolean;
  start(): Promise<void>;
  stop(): Promise<void>;
  zero(): Promise<void>;
  setMagnet(face: number, strength: number, x: number, y: number): Promise<void>;
  clearMagnet(): Promise<void>;
  getMagnet(): StoredMagnet | null;
  screen(): { width: number; height: number; pointsPerCm: number };
}

export default requireNativeModule<MagnetKitNative>("MagnetKit");
