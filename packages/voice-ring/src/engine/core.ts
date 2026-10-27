// Shared primitives for the voice orbs. The dotted half speaks
// thinking-orbs' language verbatim — honestly 3D (rotated, depth-shaded,
// z-sorted), depth carried by dot size and ink weight alone — and the
// line-drawn half adds polylines whose ink fades with depth along their
// length. Plain 2D canvas fills and strokes only: no ctx.filter, no SVG
// filters, no WebGL, so every type renders the same in every browser.

export interface Dot {
  x: number;
  y: number;
  z: number;
  r: number;
  /** Ink value: 0 = darkest ink on paper. Mirrored on dark themes. */
  white: number;
  a?: number;
}

/** A polyline in screen space whose opacity varies point to point. */
export interface Stroke {
  /** Flat `[x0, y0, x1, y1, …]` in CSS px. */
  pts: number[];
  /** Opacity per point — depth fades the far side of a line. */
  a: number[];
  /** Ink value, same convention as `Dot.white`. */
  white: number;
  /** Width in CSS px. */
  w: number;
  closed?: boolean;
}

/**
 * One rendered instant: a complete, final set of draw instructions.
 * Strokes paint first, then `dots` in array order (already z-sorted
 * far → near), so nodes sit on top of the lines they ride.
 */
export interface OrbFrame {
  dots: Dot[];
  strokes: Stroke[];
  /** Present on luminous types: paint the strokes as coloured light. */
  light?: FrameLight;
  /** Paint the dots as squares, `r` their half side: pixels, not points. */
  square?: boolean;
  /** Set by the lean while the orb presses on the screen's edge. */
  contact?: OrbContact;
}

/** Where a leaning orb meets the screen's edge, and how hard it presses. */
export interface OrbContact {
  /** -1 the left edge, 1 the right. */
  side: number;
  /** The edge, CSS px: marks stop here. */
  x: number;
  /** The stretch of the face that meets it, top and bottom. */
  y0: number;
  y1: number;
  /** How deep into the orb the squash reaches. */
  depth: number;
  /** 0 just touching … 1 pressing hard. */
  press: number;
  /** The refraction into the edge, for the painter; none when it is off. */
  lens?: OrbLens;
}

/**
 * The lens a pressing orb is refracted through, CSS px. A zone back from
 * the edge it begins; toward the edge it draws the image out across the
 * gap the orb rests short by, opens it taller by `flare`, parts red from
 * blue by `split` and blurs it by `blur`, each at full strength at the edge.
 */
export interface OrbLens {
  zone: number;
  gap: number;
  flare: number;
  split: number;
  blur: number;
  /** The height the flare opens from. */
  cy: number;
}

/**
 * How a luminous frame is lit. Its strokes are painted as light rather
 * than ink — a conic spectrum around the orb, bloomed in soft passes, with
 * chromatic fringes and specular hot spots — and everything the painter
 * needs is here, so a port can draw it too (an AngularGradient in SwiftUI).
 */
export interface FrameLight {
  /** Orb centre and rest radius, CSS px. */
  cx: number;
  cy: number;
  r: number;
  /** The spectrum: `[offset 0–1, r, g, b]` stops around the orb… */
  stops: Array<[number, number, number, number]>;
  /** …starting at this angle, radians clockwise from +x. */
  angle: number;
  /** Overall brightness, ~0.6 at rest to ~1.3 in full voice. */
  intensity: number;
  /** Strength of the soft halo around the rings, 0 for none. */
  halo: number;
  /** Specular hot spots, white light pooled where it touches the rings. */
  spec: Array<{ x: number; y: number; r: number; a: number }>;
  /** Chromatic fringe offset, as a share of `r`. */
  fringe: number;
}

export type Projector = (x: number, y: number, z: number) => [number, number, number];

export const TAU = Math.PI * 2;

export function lerp(a: number, b: number, f: number): number {
  return a + (b - a) * f;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function frac(x: number): number {
  return x - Math.floor(x);
}

const sinc = (a: number) => (a < 1e-6 ? 1 : Math.sin(a) / a);
// |wave vector| of each term of the skin field, for its sphere average
const K_LOBE_1 = Math.hypot(2.1, 1.3);
const K_LOBE_2 = Math.hypot(1.9, 1.7);
const K_FINE_DIFF = Math.hypot(4.3 - 2.9, -3.7, -3.1);
const K_FINE_SUM = Math.hypot(4.3 + 2.9, 3.7, -3.1);

/**
 * The skin deformation shared by the line types: one smooth field over the
 * unit sphere — broad lobes plus a finer ripple — so every line sampling it
 * bends together like a surface rather than wobbling on its own. `radius`
 * sets the size of the bulges: above 1 fewer, broader ones, below 1 more,
 * tighter ones; it never changes how far they push.
 *
 * The field's average over the sphere is taken out, so it only ever
 * changes the shape, never the size — otherwise broad bulges, which are
 * nearly uniform across the orb, would read as the whole orb pulsing, and
 * "Scale up" at 0 would still scale. A plane wave sin(q·r + p) averages
 * sin(p)·sinc|q| over the unit sphere, so the correction is exact and free.
 */
export function skinField(
  aLobe: number,
  aFine: number,
  T: number,
  radius = 1
): (x: number, y: number, z: number) => number {
  const k = 1 / Math.max(0.05, radius);
  const p1 = 0.9 * T;
  const p2 = -0.7 * T + 1.3;
  const p3 = 2.1 * T;
  const p4 = -1.6 * T;
  const mean =
    aLobe * (0.55 * Math.sin(p1) * sinc(K_LOBE_1 * k) + 0.45 * Math.sin(p2) * sinc(K_LOBE_2 * k)) +
    aFine * 0.5 * (Math.cos(p3 - p4) * sinc(K_FINE_DIFF * k) - Math.cos(p3 + p4) * sinc(K_FINE_SUM * k));
  return (x, y, z) => {
    x *= k;
    y *= k;
    z *= k;
    return (
      aLobe * (0.55 * Math.sin(2.1 * x + 1.3 * y + p1) + 0.45 * Math.sin(1.7 * z - 1.9 * y + p2)) +
      aFine * Math.sin(4.3 * x - 3.1 * z + p3) * Math.sin(3.7 * y + 2.9 * x + p4) -
      mean
    );
  };
}

/** Deterministic hash in [0, 1). */
export function hashD(a: number, b: number): number {
  const h = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

function hash3(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

/** Value noise on a 3D lattice, in [0, 1] — smooth, deterministic, cheap. */
export function vnoise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  let fx = x - xi;
  let fy = y - yi;
  let fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const x00 = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), fx);
  const x10 = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), fx);
  const x01 = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), fx);
  const x11 = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

/** Stable directions on a unit sphere (Fibonacci lattice). */
export function fibDir(i: number, n: number): [number, number, number] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const rad = Math.sqrt(1 - y * y);
  const a = i * golden;
  return [rad * Math.cos(a), y, rad * Math.sin(a)];
}

/** Shared spin + tilt + orthographic projection. +z faces the viewer. */
export function makeProj(yaw: number, tilt: number, cx: number, cy: number, scale: number): Projector {
  const st = Math.sin(tilt);
  const ct = Math.cos(tilt);
  const sy = Math.sin(yaw);
  const cyw = Math.cos(yaw);
  return (x, y, z) => {
    const x1 = x * cyw + z * sy;
    const z1 = -x * sy + z * cyw;
    const y1 = y * ct - z1 * st;
    const z2 = y * st + z1 * ct;
    return [cx + x1 * scale, cy - y1 * scale, z2];
  };
}

/**
 * Dot radii and line widths are tuned for a 200px orb; sub-linear scaling
 * keeps small orbs legible. Lower pow = marks shrink less with size.
 */
export function radiusScale(size: number, pow = 0.6): number {
  return (size / 200) ** pow;
}

/** How many marks a size carries, relative to the 200px design. */
export function countScale(size: number, pow = 0.8): number {
  return Math.min(1.3, Math.max(0.3, (size / 200) ** pow));
}

/**
 * Turn raw type output into a finished frame: drop invisible marks, clamp
 * radii to the type's floor, and z-sort dots far → near into draw order.
 */
export function finalizeFrame(dots: Dot[], strokes: Stroke[], rMin = 0.3): OrbFrame {
  const visible: Dot[] = [];
  for (const d of dots) {
    if ((d.a ?? 1) < 0.02) continue;
    d.r = Math.max(rMin, d.r);
    visible.push(d);
  }
  visible.sort((a, b) => a.z - b.z);
  return { dots: visible, strokes };
}
