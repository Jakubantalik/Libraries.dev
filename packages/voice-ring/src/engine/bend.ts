// Bend toward the pointer: a pure warp of a finished frame, applied after
// the lean. Every stroke point and dot near the pointer is drawn toward it,
// up to 90% of the way at full amount, falling off as a gaussian a little
// narrower than the ring, so the ring bulges out toward the cursor like a
// membrane while its far side stays put. From the Voice ring video's
// `pull()` (~/voice-ring-video/orb/entry.ts).

import type { OrbFrame } from './core';

export interface BendPointer {
  /** The pointer in the orb's own CSS px (0 … size). */
  x: number;
  y: number;
  /** 0 none … 1 full. */
  amount: number;
}

/** The ring's rest radius, which the bend's reach is measured in. */
export const bendRadius = (frame: OrbFrame, size: number) => frame.light?.r ?? size * 0.28;

/** `frame` bent toward `p`: a new frame, as a frame may be painted twice. */
export function bendFrame(frame: OrbFrame, size: number, p: BendPointer): OrbFrame {
  const R = bendRadius(frame, size);
  const s2 = (R * 0.7) ** 2;
  const k = 0.9 * Math.min(1, Math.max(0, p.amount));
  const pull = (x: number, y: number): [number, number] => {
    const dx = p.x - x, dy = p.y - y;
    const w = k * Math.exp(-(dx * dx + dy * dy) / s2);
    return [x + dx * w, y + dy * w];
  };
  return {
    ...frame,
    strokes: frame.strokes.map((s) => {
      const pts = s.pts.slice();
      for (let i = 0; i < pts.length; i += 2) [pts[i], pts[i + 1]] = pull(pts[i], pts[i + 1]);
      return { ...s, pts };
    }),
    dots: frame.dots.map((d) => {
      const [x, y] = pull(d.x, d.y);
      return { ...d, x, y };
    })
  };
}

/**
 * How much a pointer at `rim` px outside the ring (negative inside) bends
 * it: nothing beyond 0.8 R out, full from 0.2 R out and inside.
 */
export const bendReach = (rim: number, R: number) => Math.min(1, Math.max(0, (0.8 * R - rim) / (0.6 * R)));
