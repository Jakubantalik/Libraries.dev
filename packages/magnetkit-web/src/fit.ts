/* ── Calibration ───────────────────────────────────────────────────────
   The magnet held still over a few known spots. One magnetometer gives
   three numbers per spot; a dipole whose axis points at the screen,
   seen from the sensor, explains them with four unknowns: which face is
   toward the phone, its strength, where the sensor sits, and how high
   the magnet was held. A grid over those, the strength solved in closed
   form, picks the best fit. */

import type { Pt } from "./types";

export type CalibrationSpot = { screen: Pt; delta: [number, number, number] };
export type CalibrationFit = { face: 1 | -1; strength: number; sensor: Pt; height: number; error: number };

/** Android dp per cm (160 dp per inch); an iPhone is ~60 pt per cm. */
const DP_PER_CM = 160 / 2.54;

function unitField(offX: number, offY: number, h: number, face: number): [number, number, number] {
  // Field at the sensor from a unit dipole (moment along ±z) at (offX, offY, h) cm.
  const r = Math.hypot(offX, offY, h);
  const rx = -offX / r, ry = -offY / r, rz = -h / r;
  const mDotR = face * rz;
  const k = 1 / (r * r * r);
  return [k * 3 * mDotR * rx, k * 3 * mDotR * ry, k * (3 * mDotR * rz - face)];
}

export function fitCalibration(spots: CalibrationSpot[], screenDp: Pt, PPCM = DP_PER_CM): CalibrationFit | null {
  if (spots.length < 3) return null;
  const norm = spots.reduce((a, s) => a + s.delta[0] ** 2 + s.delta[1] ** 2 + s.delta[2] ** 2, 0);
  let best: CalibrationFit | null = null;
  for (const face of [1, -1] as const) {
    for (let sx = 0; sx <= screenDp.x; sx += 8) {
      for (let sy = -30; sy <= screenDp.y * 0.5; sy += 8) {
        for (let h = 0.6; h <= 5.01; h += 0.2) {
          let bg = 0, gg = 0;
          const gs = spots.map((s) => {
            const g = unitField((s.screen.x - sx) / PPCM, -(s.screen.y - sy) / PPCM, h, face);
            bg += g[0] * s.delta[0] + g[1] * s.delta[1] + g[2] * s.delta[2];
            gg += g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
            return g;
          });
          const k = bg / gg;
          if (!(k > 0)) continue;
          let err = 0;
          spots.forEach((s, i) => {
            const g = gs[i];
            err += (s.delta[0] - k * g[0]) ** 2 + (s.delta[1] - k * g[1]) ** 2 + (s.delta[2] - k * g[2]) ** 2;
          });
          err /= norm;
          if (!best || err < best.error) best = { face, strength: k, sensor: { x: sx, y: sy }, height: h, error: err };
        }
      }
    }
  }
  return best;
}
