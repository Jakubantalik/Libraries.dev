// Sash: an undulating band of parallel dotted lanes riding a great circle —
// thinking-orbs' "composing", listening. In silence the slow traveling
// undulation keeps going; a voice deepens it (the lows the long wave, the
// mids the short one, the highs a fine ripple), runs it on the voice clock
// and fans the lanes apart.

import type { Dot, TypeFrame } from './types';
import { TAU, fibDir, finalizeFrame, makeProj, radiusScale, skinField } from './core';

export const frameSash: TypeFrame = (size, t, v, o) => {
  const cx = size / 2;
  const cy = size / 2;
  // Shape follows the soft envelopes: a band that pumped with every
  // syllable read as mechanical; this one swells into a sentence and
  // eases out of it.
  const L = v.soft;
  const [lo, mid] = v.softBands;
  // Speaking reads at a glance: the whole orb scales with the voice (the
  // fast level, so it answers each syllable) and its surface bulges like
  // swell's — the band and the ghost sphere ride the same field. Resting
  // small enough that the loudest frame still fits: 0.66 × 1.21 × 1.15 ≈ 0.92.
  const R = (size / 2) * (o.radius ?? 0.66) * (1 + (o.zoom ?? 0.21) * v.level);
  const T0 = v.drive;
  // `deform` scales how far a voice bulges the surface; `wave` how far it
  // deepens the band's undulation — the speaking knobs in the demo
  const deform = o.deform ?? 1;
  const deepen = o.wave ?? 1;
  const aLobe = 0.015 + (0.1 * lo + 0.05 * v.level) * deform;
  const aFine = 0.04 * mid * deform;
  const skin = skinField(aLobe, aFine, T0);

  // The band plane, held still as in the tuned composing preset (spin 0):
  // u along x, v tilted toward the viewer by `ta`, n = u × v.
  const ta = 0.55 + 0.05 * Math.sin(t * 0.37);
  const vy = Math.cos(ta);
  const vz = Math.sin(ta);

  // The band hugs one great circle, where the skin's sphere average does
  // not quite cancel; its own average along that circle comes out too, so
  // the bulges reshape the sash and only "Scale up" changes its size.
  let dc = 0;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * TAU;
    dc += skin(Math.cos(a), Math.sin(a) * vy, Math.sin(a) * vz);
  }
  dc /= 48;
  const bulge = (x: number, y: number, z: number) => 1 + skin(x, y, z) - dc;
  const camTilt = 0.3;
  const pt = makeProj(0, camTilt, cx, cy, 1);
  const rs = radiusScale(size, o.rsPow ?? 0.6) * (o.rMul ?? 1);
  const T = v.drive;

  const dots: Dot[] = [];
  const ghostN = o.ghostN ?? 60;
  for (let i = 0; i < ghostN; i++) {
    const d = fibDir(i, ghostN);
    const rr = R * bulge(d[0], d[1], d[2]);
    const [px, py, z] = pt(d[0] * rr, d[1] * rr, d[2] * rr);
    const depth = (z / R + 1) / 2;
    dots.push({ x: px, y: py, z, r: 0.65 * rs, white: 0.78, a: 0.1 + 0.22 * depth });
  }

  const ny = -vz;
  const nz = vy;

  const lanes = Math.max(1, Math.round(o.lanes ?? 10));
  const segs = Math.max(8, Math.round(o.segs ?? 56));
  // Processing narrows the band, calms its wave and runs a bright pulse
  // around it, like a loader travelling its track.
  const P = v.processing;
  const laneGap = (o.laneGap ?? 0.062) * (1 + 0.25 * L) * (1 - 0.4 * P);
  const pulseAt = T * 1.6;
  // amplitudes: a living band in silence, a deep one at full voice
  const aLong = 0.15 * (0.55 + 0.9 * lo * deepen) * (1 - 0.6 * P);
  const aShort = 0.06 * (0.5 + 1.2 * mid * deepen);
  // a slow two-lobe swell under both, on its own tempo, so the band never
  // quite repeats — the difference between a loop and something breathing
  const aSwell = 0.05 + 0.05 * L;
  for (let w = 0; w < lanes; w++) {
    const laneOff = (w - (lanes - 1) / 2) * laneGap;
    const edge = Math.abs(w - (lanes - 1) / 2) / Math.max(1, (lanes - 1) / 2);
    for (let k = 0; k < segs; k++) {
      const a = (k / segs) * TAU;
      const wob =
        aLong * Math.sin(a * 3 - T * 0.95 + w * 0.18) +
        aShort * Math.sin(a * 5 + T * 0.6) +
        aSwell * Math.sin(a * 2 + t * 0.31 + Math.sin(t * 0.17) * 1.5);
      // The out-of-plane offset is re-normalised onto the sphere, so the
      // silhouette is pinned at R however deep the voice pushes the wave.
      const off = laneOff + wob;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const x = ca;
      const y = sa * vy + ny * off;
      const z = sa * vz + nz * off;
      const l = Math.sqrt(x * x + y * y + z * z);
      const rr = (R * bulge(x / l, y / l, z / l)) / l;
      const [px, py, zr] = pt(x * rr, y * rr, z * rr);
      const depth = (zr / R + 1) / 2;
      // crests of the wave swell a touch, so the voice reads in the marks too
      const crest = Math.max(0, wob) * L;
      const da = Math.atan2(Math.sin(a - pulseAt), Math.cos(a - pulseAt));
      const pulse = Math.exp(-(da * da) / 0.18) * P;
      dots.push({
        x: px,
        y: py,
        z: zr,
        r: ((o.rBase ?? 0.49) + (o.rDepth ?? 0.78) * depth) * (1 - 0.25 * edge) * (1 + 1.2 * crest + 0.5 * pulse) * rs,
        white: 0.52 - 0.44 * depth + 0.18 * edge - 0.3 * pulse,
        a: 0.4 + 0.6 * depth
      });
    }
  }
  return finalizeFrame(dots, [], o.rMin);
};
