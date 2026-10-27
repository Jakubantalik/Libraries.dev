// Aura: signal's wireframe, drawn in light. A handful of rings lean a few
// degrees off the view axis, each drifting on its own heading, so the rim
// reads as a luminous ribbon that thickens where the rings part and thins
// where they meet. A conic spectrum — coral, pink, violet, blue — runs
// around it; the painter blooms it, splits a chromatic fringe off each ring
// and pools a specular hot spot on the lower left.
//
// The voice moves it exactly as it moves signal: one skin field bends every
// ring together, broad lobes and a finer ripple with the same strengths, the
// rings tumble on the voice clock at signal's rates, and the orb swells on
// the soft envelope. On top, the light brightens and the spectrum sways.
// Processing spins the colours around and sweeps the highlight like a loader.

import type { Stroke, TypeFrame } from './types';
import type { FrameLight } from './core';
import { TAU, clamp01, finalizeFrame, hashD, radiusScale, skinField } from './core';

/** The default spectrum, read clockwise from the top. */
const SPECTRUM: FrameLight['stops'] = [
  [0, 255, 150, 90],
  [0.12, 255, 110, 120],
  [0.24, 255, 80, 170],
  [0.4, 190, 80, 255],
  [0.58, 90, 92, 255],
  [0.74, 60, 132, 255],
  // violet warms through magenta into the gold at the top, so the gold
  // fades in rather than meeting the violet at an edge
  [0.84, 170, 90, 255],
  [0.93, 240, 104, 165],
  [1, 255, 150, 90]
];

export const frameAura: TypeFrame = (size, t, v, o) => {
  const half = size / 2;
  const L = v.level;
  const [lo, mid] = v.softBands;
  const hi = v.bands[2];
  const T = v.drive;
  const P = v.processing;
  const voice = 0.5 * L + 0.5 * v.soft;
  // signal's motion, value for value: the swell rides the soft envelope,
  // and the skin takes the same lobe and ripple strengths. Halo and bloom
  // spill past the rings, so they rest well inside: 0.56 × 1.06 × ~1.3 ≈ 0.77.
  const R = half * (o.radius ?? 0.56) * (1 + (o.zoom ?? 0.17) * v.soft) * (1 - 0.06 * P);
  const deform = o.deform ?? 1.45;
  const aLobe = 0.02 + (0.14 * lo + 0.06 * L) * deform;
  const aFine = 0.01 + (0.07 * mid + 0.03 * hi) * deform;
  // one field for every ring, so they bend together like a skin;
  // `deformRadius` sets the size of its bulges
  const field = skinField(aLobe, aFine, T, o.deformRadius ?? 1.75);
  const lw = Math.max(0.6, (o.lineW ?? 1.85) * radiusScale(size, 0.5));
  const rings = Math.max(1, Math.round(o.rings ?? 6));
  const segs = Math.max(24, Math.round(o.segs ?? 140));
  const spread = o.lean ?? 0.91;
  // how far apart the rings sit, each a step larger than the last
  const gap = o.ringGap ?? 0.02;

  // Rings first as directions and skin values, then drawn: the rings lie
  // near one circle rather than over the sphere, so the field's sphere
  // average does not quite cancel on them — their own shared average is
  // taken out too, and the bulges never change the aura's size (nor, see
  // below, its position).
  const built: Array<{ dirs: number[]; f: number[]; a: number[]; rk: number }> = [];
  let sum = 0;
  let count = 0;
  for (let k = 0; k < rings; k++) {
    // Each ring tumbles on the voice clock at signal's rates — alternate
    // rings turning opposite ways — and tips a little further as it goes,
    // so speech sets the ribbon twisting the way it sets signal's circles
    // sweeping. Silence leaves only the slow ambient drift.
    const spin = 0.16 * (0.5 + hashD(k, 2.1)) * (k % 2 ? 1 : -1);
    const lean = Math.max(
      0.02,
      spread * (0.2 + 0.8 * hashD(k, 3.1)) + 0.03 * Math.sin(t * 0.27 + k * 1.3) + 0.08 * Math.sin(T * 0.35 + k * 1.7)
    );
    const dir = hashD(k, 7.7) * TAU + t * 0.05 * (k % 2 ? 1 : -1) + T * spin;
    const nx = Math.sin(lean) * Math.cos(dir);
    const ny = Math.sin(lean) * Math.sin(dir);
    const nz = Math.cos(lean);
    const ul = Math.hypot(nx, nz);
    const ux = nz / ul;
    const uz = -nx / ul;
    const vx = ny * uz;
    const vy = nz * ux - nx * uz;
    const vz = -ny * ux;
    // concentric spread: a hair of it bundles the rings into one glassy
    // tube, parted only by their leans; more sets each on its own circle
    const rk = R * (1 + gap * (k - (rings - 1) / 2));
    const sl = Math.sin(lean);
    const dirs: number[] = [];
    const f: number[] = [];
    const al: number[] = [];
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * TAU;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const x = ux * c + vx * s;
      const y = vy * s;
      const z = uz * c + vz * s;
      const fi = field(x, y, z);
      dirs.push(x, y);
      f.push(fi);
      sum += fi;
      count++;
      // the near half of a ring a touch brighter than the far half
      al.push(0.62 + 0.38 * clamp01((z / sl + 1) / 2));
    }
    built.push({ dirs, f, a: al, rk });
  }
  const mean = count ? sum / count : 0;
  // The first harmonic around the ring is a shift, not a bend: a circle
  // pushed out by ε·cos(θ − φ) is the same circle moved over by ε. Broad
  // bulges are mostly that, so the ring would slide about instead of
  // bending. Measure it across all rings and take it out with the average,
  // leaving only the true bends — ovals, triangles and finer.
  let c1 = 0;
  let s1 = 0;
  for (const { dirs, f } of built) {
    for (let i = 0; i < f.length; i++) {
      const x = dirs[2 * i];
      const y = dirs[2 * i + 1];
      const l = Math.hypot(x, y) || 1;
      c1 += (f[i] - mean) * (x / l);
      s1 += (f[i] - mean) * (y / l);
    }
  }
  c1 = count ? (2 * c1) / count : 0;
  s1 = count ? (2 * s1) / count : 0;
  const strokes: Stroke[] = built.map(({ dirs, f, a, rk }) => {
    const pts: number[] = [];
    for (let i = 0; i < f.length; i++) {
      const x = dirs[2 * i];
      const y = dirs[2 * i + 1];
      const l = Math.hypot(x, y) || 1;
      const r = rk * (1 + f[i] - mean - c1 * (x / l) - s1 * (y / l));
      pts.push(half + x * r, half - y * r);
    }
    return { pts, a, white: 0, w: lw, closed: true };
  });

  // the highlight rests low on the left; processing sweeps it around
  const specAt = 2.3 + 0.25 * Math.sin(t * 0.21) + 2 * v.spin;
  const light: FrameLight = {
    cx: half,
    cy: half,
    r: R,
    stops: SPECTRUM,
    // warm at the top, cool below, swaying rather than turning — the
    // spectrum flows with the voice but keeps its sense of up; processing
    // spins it all the way round
    angle: -Math.PI / 2 - 0.35 + 0.5 * Math.sin(t * 0.07) + 0.4 * Math.sin(T * 0.2) + v.spin,
    // processing lights the ring up: brighter bloom and a bigger halo
    intensity: 0.62 + 0.55 * voice + 0.5 * P,
    halo: (o.halo ?? 0.5) * (1 + 0.6 * P),
    spec: [
      {
        x: half + Math.cos(specAt) * R,
        y: half + Math.sin(specAt) * R,
        r: R * (0.5 + 0.25 * P),
        a: 0.5 + 0.35 * voice + 0.4 * P
      }
    ],
    fringe: 0.016 + 0.012 * voice
  };
  return { ...finalizeFrame([], strokes), light };
};
