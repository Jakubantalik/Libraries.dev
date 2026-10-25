/* Calibration without UI or transport: the magnet held still over a few
   spots on the screen, fitted to the magnet's face, strength and the
   sensor's spot. Shared by the web bridge and React Native, which each
   hand it a `CalibrationIO`. */

import { fitCalibration, type CalibrationFit, type CalibrationSpot } from "./fit";
import type { MagnetFrame, Pt } from "./types";

export type CalibrationState = {
  phase: "zeroing" | "spot" | "done" | "failed" | "cancelled";
  /** Which spot (0-based) and how many. */
  index: number;
  total: number;
  /** Where to draw the ring, in the app's own coordinates (client px, or RN points). */
  spot: Pt | null;
  /** 0…1, how long the magnet has been held still over this spot. */
  progress: number;
  /** The field reported right now, µT; null while no readings arrive. */
  field: number | null;
  /** True while the phone is taking its zero. */
  zeroing: boolean;
  fit: CalibrationFit | null;
};

export type CalibrationOptions = {
  /** Spots as fractions of the viewport. Five by default: middle, top, bottom, left, right. */
  spots?: Array<[number, number]>;
  onUpdate?: (s: CalibrationState) => void;
};

/** What a calibration needs from where the readings come from. */
export type CalibrationIO = {
  /** Take a new zero (keep magnets away). */
  zero(): void;
  addFrameListener(l: (f: MagnetFrame) => void): () => void;
  /** Hand the fit to the phone. */
  setMagnet(fit: CalibrationFit): void;
  /** The area the rings are drawn in, in the app's own coordinates. */
  viewport(): Pt;
  /** The app's coordinates onto the screen's, as the readings use. */
  toScreen(p: Pt): Pt;
  /** The screen's size and density, as the readings use. */
  screenSize(): Pt;
  pointsPerCm: number;
};

export const DEFAULT_SPOTS: Array<[number, number]> = [[0.5, 0.45], [0.5, 0.12], [0.5, 0.88], [0.15, 0.5], [0.85, 0.5]];

/** Runs a calibration; resolves with the fit (already handed to the phone), or null. */
export function runCalibration(io: CalibrationIO, opts: CalibrationOptions = {}) {
  const SPOTS = opts.spots ?? DEFAULT_SPOTS;
  const spots: CalibrationSpot[] = [];
  let i = 0;
  let hold: MagnetFrame[] = [];
  let lastFrame: MagnetFrame | null = null;
  let lastFrameAt = 0;
  const zeroUntil = performance.now() + 1500;
  let done = false;
  let resolve!: (f: CalibrationFit | null) => void;
  const promise = new Promise<CalibrationFit | null>((r) => (resolve = r));

  const spotAt = (k: number): Pt => {
    const v = io.viewport();
    return { x: SPOTS[k][0] * v.x, y: SPOTS[k][1] * v.y };
  };
  const state = (phase: CalibrationState["phase"], progress = 0, fit: CalibrationFit | null = null): CalibrationState => ({
    phase, index: i, total: SPOTS.length, spot: phase === "spot" ? spotAt(i) : null, progress,
    field: lastFrame && performance.now() - lastFrameAt < 2000 ? lastFrame.strength : null,
    zeroing: !!lastFrame?.calibrating, fit,
  });
  const emit = (s: CalibrationState) => opts.onUpdate?.(s);

  const finish = (phase: "done" | "failed" | "cancelled", fit: CalibrationFit | null) => {
    if (done) return;
    done = true;
    off();
    clearInterval(tick);
    emit(state(phase, 1, fit));
    resolve(fit);
  };

  io.zero();
  emit(state("zeroing"));
  const tick = setInterval(() => {
    if (!done && performance.now() < zeroUntil) emit(state("zeroing"));
  }, 300);

  const off = io.addFrameListener((f) => {
    lastFrame = f; lastFrameAt = performance.now();
    if (performance.now() < zeroUntil || f.calibrating) { emit(state("zeroing")); return; }
    if (f.strength < 15) { hold = []; emit(state("spot", 0)); return; }
    hold.push(f);
    hold = hold.filter((h) => h.t > f.t - 1200);
    const med = (j: number) => { const v = hold.map((h) => h.delta[j]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const m: [number, number, number] = [med(0), med(1), med(2)];
    const spread = Math.max(...hold.map((h) => Math.hypot(h.delta[0] - m[0], h.delta[1] - m[1], h.delta[2] - m[2])));
    if (spread > Math.max(4, 0.12 * f.strength)) { hold = [f]; emit(state("spot", 0)); return; }
    const progress = Math.min(1, (f.t - hold[0].t) / 1000);
    emit(state("spot", progress));
    if (progress < 1) return;
    spots.push({ screen: io.toScreen(spotAt(i)), delta: m });
    i++;
    hold = [];
    if (i < SPOTS.length) { emit(state("spot", 0)); return; }
    const fit = fitCalibration(spots, io.screenSize(), io.pointsPerCm);
    if (!fit) return finish("failed", null);
    io.setMagnet(fit);
    finish("done", fit);
  });

  return { promise, cancel: () => finish("cancelled", null) };
}
