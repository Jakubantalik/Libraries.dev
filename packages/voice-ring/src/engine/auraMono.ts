// Aura mono: the aura's rings as two loops of solid tube, in greys. Waiting,
// they lie almost face-on, a few degrees apart, so the orb reads as one
// round loop, barely bent. A voice opens them out into a globe, each loop
// leaning away from the other like two great circles of a sphere, and sets
// them warping — a saddle out of the plane, an oval and a three-lobed
// wobble in it — while the voice clock spins everything much faster. Every
// motion is a sum of slow, incommensurate sines on that clock, and the
// voice comes in on the slow envelope only, so it morphs, never jumps.
//
// Waiting, it never quite rests: on the type's own slow clock the loops sway
// apart and back, swell gently out of round and drift a little off centre,
// all of it handing over to the voice's motion as someone speaks.
//
// The loops are drawn as lit tubes: brightest where a tube faces the light,
// nearer parts thicker and lighter, the near side over the far one where
// they cross. Processing contracts it a touch and spins the loops round.

import type { Stroke, TypeFrame } from './types';
import { TAU, clamp01, radiusScale, smoothstep } from './core';

// The light: from the upper left, a little in front.
const LX = -0.45;
const LY = 0.55;
const LZ = 0.7;
const LN = Math.hypot(LX, LY, LZ);

export const frameAuraMono: TypeFrame = (size, t, v, o) => {
  const half = size / 2;
  const P = v.processing;
  // the slow envelope only: the shape breathes with speech, it doesn't pump
  const voice = v.soft;
  const mids = v.softBands[1];
  // the loops reach out to ~1.25 R at the most: 0.44 × 1.08 × 1.25 ≈ 0.6
  const R = half * (o.radius ?? 0.44) * (1 + (o.zoom ?? 0.08) * voice) * (1 - 0.06 * P);
  const deform = o.deform ?? 1.85;
  const rings = Math.max(1, Math.round(o.rings ?? 2));
  const segs = Math.max(48, Math.round(o.segs ?? 180));
  const lw = Math.max(0.5, (o.lineW ?? 1.7) * radiusScale(size, 0.6));
  // how far the loops lean off the view axis: a few degrees waiting, a
  // globe while someone speaks
  const lean = (o.tilt ?? 0.22) + (o.open ?? 0.75) * voice;
  // how bent they are: all but round waiting, warped while someone speaks
  const rest = clamp01(o.restBend ?? 0.12);
  const bend = rest + (1 - rest) * clamp01(voice * deform);
  const twist = (o.twist ?? 1.69) * bend;
  const wobble = (o.wobble ?? 0.31) * bend;

  // the voice clock, which runs much faster while someone speaks
  const u = v.drive * (o.pace ?? 2.1);
  // no perspective by default, the loops drawn flat on; `persp` puts the
  // eye at 1 / persp radii, so the near side reads larger
  const D = 1 / Math.max(0.02, o.persp ?? 0);

  // the waiting motion, gone once the voice has the orb
  const calm = 1 - smoothstep(0.1, 0.5, voice);
  const sway = (o.idleSway ?? 0.18) * calm;
  const swell = (o.idleDeform ?? 0.05) * calm;
  const drift = (o.idleDrift ?? 0.03) * calm;
  const cx = half + R * drift * Math.sin(0.9 * t + 0.6);
  const cy = half + R * drift * Math.sin(0.7 * t + 2.1);

  const strokes: Stroke[] = [];
  for (let k = 0; k < rings; k++) {
    // each loop on its own phases, a golden turn apart, so they never
    // move in step
    const ph = k * 2.399;
    // its lean: the loops tip opposite ways, so they cross like the lines
    // of a globe, and wander round as they turn
    const tip = lean * (1 + 0.25 * Math.sin(0.17 * u + ph)) + sway * Math.sin(1.3 * t + 1.3 * ph);
    const dir = (k * TAU) / rings + 0.23 * u * (k % 2 ? -1 : 1) + 0.4 * Math.sin(0.11 * u + ph) + v.spin;
    const nx = Math.sin(tip) * Math.cos(dir);
    const ny = Math.sin(tip) * Math.sin(dir);
    const nz = Math.cos(tip);
    // the loop's plane: u ⟂ n with no y component, v = n × u
    const ul = Math.hypot(nx, nz) || 1;
    const ux = nz / ul;
    const uz = -nx / ul;
    const vx = ny * uz;
    const vy = nz * ux - nx * uz;
    const vz = -ny * ux;

    // out of the plane: a saddle and a gentler three-fold
    const b2 = 0.2 * twist * Math.sin(0.29 * u + 1.3 + ph);
    const p2 = 0.37 * u + ph;
    const b3 = 0.07 * twist * Math.sin(0.23 * u + 0.4 + ph);
    const p3 = -0.31 * u + 2.1 + ph;
    // in the plane: an oval and a three-lobed wobble; the mids add a
    // four-fold swell
    const a2 = 0.07 * wobble * Math.sin(0.33 * u + 0.4 + ph);
    const q2 = 0.41 * u + ph;
    const a3 = 0.04 * wobble * Math.sin(0.27 * u + 1 + ph);
    const q3 = -0.35 * u + 0.8 + ph;
    const a4 = 0.04 * deform * mids;
    const q4 = 0.5 * u + ph;
    // waiting: a slow oval and three-lobed swell, turning round the loop
    const s2 = swell * Math.sin(1.1 * t + 0.7 + ph);
    const r2 = 0.7 * t + ph;
    const s3 = 0.6 * swell * Math.sin(1.5 * t + 1.9 + ph);
    const r3 = -0.5 * t + ph;
    // each a hair smaller than the last, so where they meet they part
    const rk = 1 - (o.ringGap ?? 0.035) * k;

    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let i = 0; i < segs; i++) {
      const th = (i / segs) * TAU;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const r =
        rk *
        (1 +
          a2 * Math.cos(2 * th + q2) +
          a3 * Math.cos(3 * th + q3) +
          a4 * Math.cos(4 * th + q4) +
          s2 * Math.cos(2 * th + r2) +
          s3 * Math.cos(3 * th + r3));
      const h = rk * (b2 * Math.sin(2 * th + p2) + b3 * Math.sin(3 * th + p3));
      xs.push((ux * c + vx * s) * r + nx * h);
      ys.push(vy * s * r + ny * h);
      zs.push((uz * c + vz * s) * r + nz * h);
    }

    const pts: number[] = [];
    const shade: number[] = [];
    const depth: number[] = [];
    for (let i = 0; i < segs; i++) {
      const f = D / (D - zs[i]);
      pts.push(cx + xs[i] * R * f, cy - ys[i] * R * f);
      // a tube is brightest across the light, darkest along it: the
      // tangent against the light tells how much of its round face catches it
      const j = (i + 1) % segs;
      const m = (i + segs - 1) % segs;
      const tx = xs[j] - xs[m], ty = ys[j] - ys[m], tz = zs[j] - zs[m];
      const tl = Math.hypot(tx, ty, tz) || 1;
      const along = (tx * LX + ty * LY + tz * LZ) / (tl * LN);
      const lit = Math.sqrt(Math.max(0, 1 - along * along));
      const near = clamp01((zs[i] + 1) / 2);
      shade.push(clamp01(0.12 + 0.6 * lit * (0.55 + 0.45 * near) + 0.28 * near + 0.08 * voice));
      depth.push(near * 2 - 1);
    }
    strokes.push({ pts, a: shade, z: depth, white: 0, w: lw, closed: true });
  }

  return {
    dots: [],
    strokes,
    tube: {
      shine: o.shine ?? 1,
      // one even grey all round: the highlight alone gives it its roundness
      contrast: o.contrast ?? 0,
      depth: o.depthWidth ?? 0,
      // an emotion's colour as deep as it goes, a touch dark, fading most
      // of the way into the grey on one side of the orb, the fade holding
      // still; green a shade darker than the others
      saturation: o.colorSaturation ?? 2,
      gradient: o.colorGradient ?? 0.69,
      gradientAngle: o.gradientAngle ?? 0,
      gradientSpin: o.gradientSpin ?? 0,
      colorBrightness: o.colorBrightness ?? 0.9,
      positiveBrightness: o.positiveBrightness ?? 0.93,
      negativeBrightness: o.negativeBrightness ?? 1,
      calmBrightness: o.calmBrightness ?? 1
    }
  };
};
