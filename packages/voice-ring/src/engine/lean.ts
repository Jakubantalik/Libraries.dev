// Lean: the orb answering where a voice comes from. A finished frame is
// bent in screen space toward the side the sound arrives from — it drifts a
// little that way, the near side is pulled out further than the far side,
// and the near flank bulges — so every type, dots, lines or light, leans
// with the same gesture. Applied after the geometry, before the painter.

import type { OrbFrame } from './core';

/** How strongly the orb leans, each as a share of its radius at full pan. */
export interface LeanAmounts {
  /** The whole orb drifts toward the voice. */
  move: number;
  /** The near side is drawn out further than the far side — a stretch. */
  pull: number;
  /** The near flank bulges, strongest at the equator. */
  deform: number;
  /** Pressing on at the screen's edge, it squashes against it: 0 never … 1 most. */
  squash?: number;
  /** Pressing on at the edge, it is refracted into it as through glass: 0 none … 1 … 2 most. */
  lens?: number;
  /** The lens draws it out toward the edge (distortion): 0 none … 1 … 2. */
  stretch?: number;
  /** The lens parts red from blue (chromatic aberration): 0 none … 1 … 2. */
  split?: number;
  /** The lens blurs it, more the nearer the edge: 0 none … 1 … 2. */
  blur?: number;
  /** It bounces as it meets the edge: 0 none … 1 … 2. */
  bounce?: number;
}

export const LEAN_DEFAULTS: LeanAmounts = {
  move: 2,
  pull: 0.7,
  deform: 0.1,
  squash: 0.5,
  lens: 1,
  stretch: 1,
  split: 1,
  blur: 1,
  bounce: 1
};

/**
 * How far, in CSS px, the lean can carry a mark sideways at full pan — the
 * room a canvas needs either side so a leaning orb is never cut off. The
 * flank's bulge counts double: marks past the radius are pushed furthest.
 */
export function leanReach(k: LeanAmounts, size: number): number {
  const share = Math.abs(k.move) + Math.abs(k.pull) + 2 * Math.abs(k.deform);
  return share === 0 ? 0 : Math.ceil(size * 0.36 * share) + 2;
}

/**
 * The bounce as an orb meets the edge: a spring chasing how hard it presses
 * there, loose enough to overshoot — it hits, presses in a little too far,
 * comes a touch off the edge and settles. Step it once a frame with the
 * press the last frame reported (`frame.contact?.press ?? 0`) and hand what
 * it returns to `leanFrame`.
 */
export class EdgeBounce {
  private x = 0;
  private v = 0;
  /** Whether the spring has caught up with the press since the orb met the edge. */
  private landed = false;

  /**
   * How far the spring runs ahead of the press (+) or behind it (−). It
   * lags as the orb arrives, but only a rebound counts as behind: the orb
   * never backs off the edge before it has pressed into it.
   */
  step(press: number, dt: number): number {
    const w = 15;
    const z = 0.3;
    const n = Math.max(1, Math.ceil(dt * 240));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.v += (w * w * (press - this.x) - 2 * z * w * this.v) * h;
      this.x += this.v * h;
    }
    const ahead = this.x - press;
    if (press <= 0) this.landed = false;
    else if (ahead >= 0) this.landed = true;
    return ahead < 0 && !this.landed ? 0 : ahead;
  }
}

/**
 * Bend `frame` in place toward `pan` (−1 left … 1 right). Points keep their
 * height except for a slight squeeze on the near side, so a bulge reads as
 * the orb leaning, not inflating.
 *
 * `bounds` is how far past the canvas box, left and right, a mark may land
 * — the room to the edge of the screen. A lean that would carry any mark
 * further is scaled down until the outermost one lands on that edge, so the
 * orb can travel to the edge but never past it. Pressing on, it squashes
 * against the edge (`squash`) — the near side flattens and the orb swells a
 * little taller there — and is refracted into it (`lens`): it rests short
 * of the edge by a gap, and the painter draws its near side out across it,
 * parts its colours and blurs it, more the harder it pushes. `bounce` is
 * what an `EdgeBounce` returned: the press overshoots, and the orb springs
 * back off the edge.
 */
export function leanFrame(
  frame: OrbFrame,
  pan: number,
  size: number,
  k: LeanAmounts,
  bounds: [number, number] = [Infinity, Infinity],
  bounce = 0
): OrbFrame {
  if (Math.abs(pan) < 0.002 || (k.move === 0 && k.pull === 0 && k.deform === 0)) return frame;
  const c = size / 2;
  // the orbs fill roughly this much of their canvas
  const R = size * 0.36;
  const side = pan < 0 ? -1 : 1;
  const amount = Math.abs(pan);
  const shift = (x: number, y: number): number => {
    const nx = (x - c) / R;
    const ny = (y - c) / R;
    // 0 on the far side … 1 on the near side
    const near = Math.max(0, Math.min(1, (nx * side + 1) / 2));
    const flank = Math.max(0, nx * side);
    return pan * R * (k.move + k.pull * near * near + k.deform * flank * flank * Math.exp(-ny * ny * 1.5));
  };

  // The lens needs room: against an edge the orb stops short of it by a
  // gap from the start, and pressing on, the lens draws it out across the
  // gap — so it reaches the edge without ever backing off it.
  const lens = Math.max(0, Math.min(2, k.lens ?? 1));
  const zone = R * 0.9;
  const bound = side > 0 ? bounds[1] : bounds[0];
  const gap = Number.isFinite(bound) ? Math.min(zone * 0.45, R * 0.3 * lens * Math.max(0, k.stretch ?? 1)) : 0;

  // the share of the lean that keeps every mark inside the room
  let scale = 1;
  let edge = Infinity;
  let biggest = 1;
  if (Number.isFinite(bound)) {
    edge = side > 0 ? size + bound : -bound;
    const fit = (x: number, y: number, r: number) => {
      biggest = Math.max(biggest, r);
      const dx = shift(x, y) * side;
      if (dx > 1e-9) scale = Math.min(scale, Math.max(0, ((edge - x) * side - r - gap) / dx));
    };
    for (const d of frame.dots) fit(d.x, d.y, d.r);
    for (const s of frame.strokes) for (let i = 0; i < s.pts.length; i += 2) fit(s.pts[i], s.pts[i + 1], 1);
  }

  // At the edge and pushing on, the orb presses on it: how hard grows as the
  // lean it wanted outruns the room. The bounce runs the press past that
  // and back, and on its way back springs the orb off the edge.
  const pressure = scale < 1 ? Math.min(1, (1 - scale) / 0.35) : 0;
  const hit = pressure > 0 ? bounce * (k.bounce ?? 1) : 0;
  const pressed = Math.min(1.4, pressure + Math.max(0, hit));
  const recoil = R * 0.12 * Math.max(0, -hit);
  const wall = edge - side * biggest;
  // the squash: a soft zone against where it rests
  const rest = wall - side * gap;
  const band = R * 0.55 * pressed * (k.squash ?? 0);

  // the stretch of the face that meets the edge, for the painter
  let y0 = Infinity, y1 = -Infinity, track = true;
  const bend = (x: number, y: number): [number, number] => {
    const near = Math.max(0, Math.min(1, (((x - c) / R) * side + 1) / 2));
    const squeeze = 1 - 0.15 * k.deform * amount * scale * near;
    let bx = x + shift(x, y) * scale + side * (band * 0.5 - recoil);
    let by = c + (y - c) * squeeze;
    if (band > 0) {
      // the depth into the soft zone, eased so nothing reaches where it
      // rests — gently enough that the pressed side stays rounded, not cut
      const into = (bx - (rest - side * band)) * side;
      if (into > 0) {
        const q = into / band;
        const flat = band * (q / Math.sqrt(1 + q * q));
        bx = rest - side * band + side * flat;
        by = c + (by - c) * (1 + 0.18 * pressed * (k.squash ?? 0) * (flat / band));
      }
    }
    if (track && (rest - bx) * side < Math.max(band, zone * 0.3)) {
      y0 = Math.min(y0, by);
      y1 = Math.max(y1, by);
    }
    return [bx, by];
  };
  for (const d of frame.dots) {
    [d.x, d.y] = bend(d.x, d.y);
  }
  for (const s of frame.strokes) {
    for (let i = 0; i < s.pts.length; i += 2) {
      const [x, y] = bend(s.pts[i], s.pts[i + 1]);
      s.pts[i] = x;
      s.pts[i + 1] = y;
    }
  }
  if (pressure > 0 && y1 > y0) {
    const K = lens * pressed;
    frame.contact = {
      side,
      x: wall,
      y0,
      y1,
      depth: band,
      press: pressure,
      lens:
        K > 0.02
          ? {
              zone,
              // drawn across the gap as it presses, all the way at full press
              gap: gap * Math.min(1, pressed),
              flare: 0.22 * K * Math.max(0, k.stretch ?? 1),
              split: zone * 0.1 * K * Math.max(0, k.split ?? 1),
              blur: zone * 0.075 * K * Math.max(0, k.blur ?? 1),
              cy: c
            }
          : undefined
    };
  }
  track = false;
  if (frame.light) {
    // the spectrum's centre and the highlight travel with the rings
    const L = frame.light;
    [L.cx, L.cy] = bend(L.cx, L.cy);
    for (const sp of L.spec) [sp.x, sp.y] = bend(sp.x, sp.y);
  }
  return frame;
}
