// Orbit: particles on tilted orbits — thinking-orbs' "working", listening,
// with the paths left out: only the particles doing the work. Drawn in
// gentle perspective, so near particles sit larger and further out than
// far ones and the cloud reads as a volume. A voice moves the whole
// system toward the viewer and back — one rigid zoom, positions and marks
// together, so no orbit bends out of shape — and the cloud turns a little
// faster on the voice clock.

import type { Dot, TypeFrame } from './types';
import { TAU, clamp01, finalizeFrame, hashD, makeProj, radiusScale } from './core';

export const frameOrbit: TypeFrame = (size, t, v, o) => {
  const cx = size / 2;
  const cy = size / 2;
  // Half the syllable, half the sentence: the zoom answers each syllable
  // but carries enough of the soft envelope not to twitch.
  const voice = 0.5 * v.level + 0.5 * v.soft;
  const zoom = (1 + (o.swell ?? 0.49) * voice) * (1 - 0.14 * v.processing);
  const R = (size / 2) * (o.radius ?? 0.56);
  // Perspective: a point at depth z (−R far … R near) scales by
  // 1 / (1 − persp·z/R). At a speaking level the nearest particle sits
  // well inside the frame; a shout can carry the front of the cloud past
  // the edge for a moment (0.56 × 1.49 × 0.97 / 0.75 ≈ 1.08).
  const persp = o.persp ?? 0.25;
  const pt = makeProj(t * 0.12 + v.drive * 0.03, 0.3, 0, 0, 1);
  // marks scale almost with the orb, keeping the 64px working proportions
  const rs = radiusScale(size, o.rsPow ?? 0.9) * (o.rMul ?? 1);

  const dots: Dot[] = [];
  const orbitN = o.orbitN ?? 12;
  const particles = o.particles ?? 6;

  for (let orb = 0; orb < orbitN; orb++) {
    const h1 = hashD(orb, 1.7);
    const h2 = hashD(orb, 5.2);
    const h3 = hashD(orb, 8.9);
    const ro = R * (0.45 + 0.52 * h1);
    const th = h1 * TAU;
    const phi = Math.acos(2 * h2 - 1);
    // orbit plane basis (u, v ⟂ normal n)
    const nx = Math.sin(phi) * Math.cos(th);
    const ny = Math.cos(phi);
    const nz = Math.sin(phi) * Math.sin(th);
    let ux = -ny;
    let uy = nx;
    const ul = Math.max(1e-6, Math.sqrt(ux * ux + uy * uy));
    ux /= ul;
    uy /= ul;
    const vx = -nz * uy;
    const vy = nz * ux;
    const vz = nx * uy - ny * ux;
    const speed = (0.25 + 0.55 * h3) * (h3 > 0.5 ? 1 : -1);

    for (let m = 0; m < particles; m++) {
      const a = v.drive * speed + (m / particles) * TAU + h2 * 6;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const [x, y, z] = pt((ux * ca + vx * sa) * ro, (uy * ca + vy * sa) * ro, vz * sa * ro);
      // depth against the whole system, so inner orbits sit mid-depth
      const depth = clamp01((z / R + 1) / 2);
      const k = zoom / (1 - (persp * z) / R);
      dots.push({
        x: cx + x * k,
        y: cy + y * k,
        z,
        r: ((o.partR ?? 0.47) + (o.partRDepth ?? 0.65) * depth) * rs * k,
        white: 0.32 - 0.24 * depth
      });
    }
  }
  return finalizeFrame(dots, [], o.rMin);
};
