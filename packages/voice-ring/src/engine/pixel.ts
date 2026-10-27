// Pixel: a ball of square pixels — a sphere sampled on a fixed screen grid
// and shaded as halftone, the lit side in big dense pixels, the shadow side
// in small faint ones, the limb fading into the depth. A soft texture drifts
// across the surface, so the ball turns even in silence. A voice bulges the
// outline and lights the ball in rings from the centre out — the lows in
// the middle, the highs at the rim — as its spectrum moves; processing spins
// the texture and sweeps a scan line pole to pole.

import type { Dot, TypeFrame } from './types';
import { clamp01, finalizeFrame, smoothstep, vnoise3 } from './core';

// the light: up and to the left, in front
const LX = -0.45, LY = 0.55, LZ = 0.7;
const LN = Math.hypot(LX, LY, LZ);

export const framePixel: TypeFrame = (size, t, v, o) => {
  const half = size / 2;
  const L = v.level;
  const [lo, mid, hi] = v.bands;
  const T = v.drive;
  const P = v.processing;
  const base = half * (o.radius ?? 0.72);
  const R = base * (1 + (o.zoom ?? 0.3) * L) * (1 - 0.06 * P);
  // pixel size is a share of the cell, which already scales with the orb
  const rMul = o.rMul ?? 1;

  // the grid stays put; the ball's texture turns under it
  const n = Math.max(4, Math.round(o.cells ?? 17));
  const cell = (2 * base) / n;
  // the largest a pixel may grow: the cell less a gap that never closes
  const most = cell / 2 - Math.max(0.5, (cell * (o.gap ?? 0.24)) / 2);
  const reach = Math.ceil((R * 1.25) / cell);
  const yaw = (o.turn ?? 0.12) * t + 0.1 * T + 0.5 * v.spin;
  const sy = Math.sin(yaw), cyw = Math.cos(yaw);
  const st = Math.sin(0.35), ct = Math.cos(0.35);
  const shade = o.shade ?? 0.7;
  const tex = o.texture ?? 0.35;
  // how much the limb shrinks and fades, and how strong the ink is overall
  const fade = o.fade ?? 1.3;
  const strength = o.strength ?? 1.38;

  // the outline's bulges, a function of the angle round the rim; sines
  // average to nothing, so the ball bulges without changing size
  const deform = o.deform ?? 1.7;
  const aLobe = 0.012 + (0.09 * lo + 0.03 * L) * deform;
  const aFine = (0.035 * mid + 0.025 * hi) * deform;
  const rim = (a: number) =>
    aLobe * (0.55 * Math.sin(2 * a + 0.9 * T) + 0.45 * Math.sin(3 * a - 0.7 * T + 1.3)) +
    aFine * Math.sin(7 * a + 2.3 * T) * Math.sin(5 * a - 1.7 * T);
  const scanY = 0.95 * Math.sin(t * 1.3);
  const spectrum = v.spectrum;
  const slots = spectrum.length;

  const dots: Dot[] = [];
  for (let j = -reach; j <= reach; j++) {
    for (let i = -reach; i <= reach; i++) {
      const x = half + i * cell;
      const y = half + j * cell;
      const nx = (x - half) / R;
      const ny = -(y - half) / R;
      const bulge = rim(Math.atan2(ny, nx));
      const rho = Math.hypot(nx, ny) / (1 + bulge);
      if (rho >= 1) continue;
      // the point on the sphere under this pixel
      const k = 1 / (1 + bulge);
      const vx = nx * k, vy = ny * k;
      const vz = Math.sqrt(Math.max(0, 1 - vx * vx - vy * vy));

      // halftone shading: how much light the surface here catches
      const lambert = clamp01((vx * LX + vy * LY + vz * LZ) / LN);
      const lit = 1 - shade + shade * lambert;
      // the texture, turned back onto the ball so it travels with the turn
      const gy = vy * ct + vz * st;
      const z1 = -vy * st + vz * ct;
      const gx = vx * cyw - z1 * sy;
      const gz = vx * sy + z1 * cyw;
      const c =
        0.65 * vnoise3(gx * 2.2 + T * 0.15, gy * 2.2, gz * 2.2 - T * 0.1) +
        0.35 * vnoise3(gx * 4.6 - T * 0.2, gy * 4.6 + 7.3, gz * 4.6);
      const surface = 1 - tex + tex * smoothstep(0.32, 0.68, c);

      // the voice in rings, its spectrum laid from the centre to the rim
      const ring = slots ? spectrum[Math.min(slots - 1, Math.floor(rho * slots))] : L;
      const voice = 0.35 * L + 0.85 * ring;
      const scan = Math.exp(-((vy - scanY) ** 2) / 0.01) * P;

      // how much of its room the pixel fills: light and texture set the
      // halftone, the voice and the scan grow it, the limb shrinks it
      const edge = 1 - 0.4 * fade * (1 - vz);
      const fill = (0.35 + 0.75 * lit * surface + 0.3 * voice + 0.2 * scan) * edge * rMul;
      const ink = 0.22 + 0.62 * lit * surface + 0.22 * voice + 0.3 * scan;
      dots.push({
        x,
        y,
        z: vz * R,
        r: most * Math.min(1, fill),
        white: clamp01(1 - ink * strength),
        a: clamp01((1 - 0.75 * fade * (1 - Math.sqrt(vz))) * strength)
      });
    }
  }
  return { ...finalizeFrame(dots, [], o.rMin ?? 0.4), square: true };
};
