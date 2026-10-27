// Signal: a wireframe orb — great circles tumbling about the sphere, a
// pair of rim rings facing the viewer — seen turned and raised, so the far
// side of every line falls away. A voice deforms the whole wireframe as
// one surface: broad lobes on the lows, a finer ripple on the mids, a
// kick on every syllable, so the lines bend together like a skin rather
// than wobbling one by one.

import type { Stroke, TypeFrame } from './types';
import { TAU, clamp01, fibDir, finalizeFrame, hashD, makeProj, radiusScale, skinField } from './core';

export const frameSignal: TypeFrame = (size, t, v, o) => {
  const half = size / 2;
  const L = v.level;
  const [lo, mid] = v.softBands;
  const hi = v.bands[2];
  const T = v.drive;
  // processing draws the sphere in a touch while its circles race
  const R = half * (o.radius ?? 0.6) * (1 + (o.zoom ?? 0.06) * v.soft) * (1 - 0.08 * v.processing);
  const pt = makeProj((o.yaw ?? 0.42) + 0.08 * Math.sin(t * 0.23), o.tilt ?? 0.32, half, half, 1);
  const lw = Math.max(0.4, (o.lineW ?? 0.6) * radiusScale(size, 0.5));
  // a steep depth ramp: the far side nearly vanishes, the near side reads bright
  // full ink (white on dark): depth now lives in opacity alone
  const depthA = (z: number) => 0.06 + 0.94 * clamp01((z / R + 1) / 2) ** 2;

  // The deformation, one field over the unit sphere shared by every line.
  // Shape follows the soft envelopes so it swells into speech and eases
  // out; the fast level adds the syllable kick. Sized so the loudest bulge
  // stays inside the frame: 0.6 × 1.06 × 1.3 ≈ 0.83 of the half-size.
  const deform = o.deform ?? 1;
  const aLobe = 0.02 + (0.14 * lo + 0.06 * L) * deform;
  const aFine = 0.01 + (0.07 * mid + 0.03 * hi) * deform;
  const field = skinField(aLobe, aFine, T);

  const strokes: Stroke[] = [];
  const segs = Math.max(24, Math.round(o.segs ?? 96));

  // --- the rim: rings facing the viewer, leaning a few degrees apart ----
  const limbs = Math.max(0, Math.round(o.limbs ?? 2));
  for (let k = 0; k < limbs; k++) {
    const lean = 0.1 + 0.05 * Math.sin(t * 0.31 + k * 2.1);
    const dir = t * 0.17 * (k % 2 ? 1 : -1) + k * 2.4;
    const nx = Math.sin(lean) * Math.cos(dir);
    const ny = Math.sin(lean) * Math.sin(dir);
    const nz = Math.cos(lean);
    const ul = Math.hypot(nx, nz);
    const ux = nz / ul;
    const uz = -nx / ul;
    const vx = ny * uz;
    const vy = nz * ux - nx * uz;
    const vz = -ny * ux;
    const pts: number[] = [];
    const al: number[] = [];
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * TAU;
      const x = ux * Math.cos(th) + vx * Math.sin(th);
      const y = vy * Math.sin(th);
      const z = uz * Math.cos(th) + vz * Math.sin(th);
      const r = R * (1 + 0.006 * k + field(x, y, z));
      pts.push(half + x * r, half - y * r);
      al.push(0.55 + 0.35 * clamp01((z / Math.sin(lean) + 1) / 2));
    }
    strokes.push({ pts, a: al, white: 0, w: lw, closed: true });
  }

  // --- the sphere: great circles, each tumbling at its own rate ---------
  const circles = Math.max(2, Math.round(o.circles ?? 8));
  for (let k = 0; k < circles; k++) {
    const [nx, ny0, nz0] = fibDir(k, circles);
    const a = T * 0.16 * (0.5 + hashD(k, 2.1)) * (k % 2 ? 1 : -1) + hashD(k, 6.6) * TAU;
    const ny = ny0 * Math.cos(a) - nz0 * Math.sin(a);
    const nz = ny0 * Math.sin(a) + nz0 * Math.cos(a);
    // u ⟂ n with no y component; v = n × u
    const ul = Math.max(1e-6, Math.hypot(nz, nx));
    const ux = nz / ul;
    const uz = -nx / ul;
    const vx = ny * uz;
    const vy = nz * ux - nx * uz;
    const vz = -ny * ux;
    const pts: number[] = [];
    const al: number[] = [];
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * TAU;
      const x = ux * Math.cos(th) + vx * Math.sin(th);
      const y = vy * Math.sin(th);
      const z = uz * Math.cos(th) + vz * Math.sin(th);
      const r = R * (1 + field(x, y, z));
      const [px, py, zr] = pt(x * r, y * r, z * r);
      pts.push(px, py);
      al.push(depthA(zr));
    }
    strokes.push({ pts, a: al, white: 0, w: lw, closed: true });
  }
  return finalizeFrame([], strokes, o.rMin);
};
