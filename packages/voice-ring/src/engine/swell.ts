// Swell: a halftone sphere with clouds drifting through its dot sizes —
// the soft, living orb of the big voice apps, set in dots. A voice swells
// the sphere, bulges its surface (the lows the broad lobes, the mids and
// highs a finer ripple) and runs the clouds on the voice clock; bulging
// dots grow, so the relief reads across the face, not only at the rim.

import type { Dot, TypeFrame } from './types';
import { clamp01, fibDir, finalizeFrame, makeProj, radiusScale, smoothstep, vnoise3 } from './core';

export const frameSwell: TypeFrame = (size, t, v, o) => {
  const half = size / 2;
  const L = v.level;
  const [lo, mid, hi] = v.bands;
  const T = v.drive;
  // processing draws the sphere in and sweeps a bright band pole to pole
  const P = v.processing;
  const R = half * (o.radius ?? 0.6) * (1 + (o.zoom ?? 0.1) * L) * (1 - 0.08 * P);
  const scanY = 0.95 * Math.sin(t * 1.3);
  const pt = makeProj(t * 0.14, 0.32, half, half, 1);
  const rs = radiusScale(size, o.rsPow ?? 0.6) * (o.rMul ?? 1);
  const n = Math.max(40, Math.round(o.dotN ?? 900));
  const freq = o.cloudFreq ?? 2.3;

  // the bulges: barely there in silence, broad lobes on the lows
  const deform = o.deform ?? 1;
  const aLobe = 0.018 + (0.12 * lo + 0.04 * L) * deform;
  const aFine = (0.045 * mid + 0.03 * hi) * deform;

  // The bulges first, then their average taken out: the dots cover the
  // sphere evenly, so the plain mean is the sphere's, and the bulges then
  // reshape the swell without ever changing its size — that is "Scale up".
  const dirs: Array<[number, number, number]> = [];
  const disps: number[] = [];
  let mean = 0;
  for (let i = 0; i < n; i++) {
    const d = fibDir(i, n);
    const [dx, dy, dz] = d;
    const lobes =
      0.55 * Math.sin(2.1 * dx + 1.3 * dy + 0.9 * T) + 0.45 * Math.sin(1.7 * dz - 1.9 * dy - 0.7 * T + 1.3);
    const fine = Math.sin(5.3 * dx - 4.1 * dz + 2.3 * T) * Math.sin(4.7 * dy + 3.1 * dx - 1.7 * T);
    const disp = aLobe * lobes + aFine * fine;
    dirs.push(d);
    disps.push(disp);
    mean += disp / n;
  }

  const dots: Dot[] = [];
  for (let i = 0; i < n; i++) {
    const [dx, dy, dz] = dirs[i];
    const disp = disps[i] - mean;
    const rr = R * (1 + disp);
    const [px, py, z] = pt(dx * rr, dy * rr, dz * rr);
    const depth = clamp01((z / R + 1) / 2);

    // the clouds: two octaves of noise drifting across the surface
    const c =
      0.65 * vnoise3(dx * freq + T * 0.21, dy * freq - T * 0.15, dz * freq + T * 0.1) +
      0.35 * vnoise3(dx * freq * 2.1 - T * 0.29, dy * freq * 2.1 + 7.3, dz * freq * 2.1 + T * 0.24);
    // contrast high enough that the clouds read as halftone, not lighting
    const cloud = smoothstep(0.34, 0.68, c);
    const scan = Math.exp(-((dy - scanY) ** 2) / 0.012) * P;
    const bulge = Math.max(0, disp) / 0.16;
    dots.push({
      x: px,
      y: py,
      z,
      r: ((o.rBase ?? 0.27) + (o.rDepth ?? 0.84) * depth) * (0.22 + 0.95 * cloud + 0.6 * scan) * (1 + 0.5 * bulge) * rs,
      white: 0.62 - 0.52 * depth - 0.16 * cloud - 0.3 * scan,
      a: 0.3 + 0.7 * depth
    });
  }
  return finalizeFrame(dots, [], o.rMin ?? 0.25);
};
