/* What the magnet model answers, shared by the web bridge and React Native. */

export type Pt = { x: number; y: number };

export type MagnetFrame = {
  t: number;
  /** Where the magnet is, screen dp (null while the locator is unsure). */
  pos: Pt | null;
  spread: number;
  height: number | null;
  presence: number;
  pull: number;
  strength: number;
  /** Field change from the zero, µT, device axes (x right, y up, z out of the screen). */
  delta: [number, number, number];
  tooClose: boolean;
  calibrating: boolean;
};

export type MagnetGesture =
  | { g: "tap"; at: Pt | null }
  | { g: "push" | "pullAway"; speed: number }
  | { g: "swipe"; dir: Pt; speed: number };

export type ModelHello = {
  screenDp: [number, number];
  grabStage: number;
  face: number | null;
  strength: number | null;
  sensorDp: [number, number];
  model: boolean;
};
