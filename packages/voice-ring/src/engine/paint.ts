// The 2D-canvas painters: z-sorted dots and batched strokes, monochrome ink
// by default, with an optional tint and an optional glow — a colour that
// drifts through the marks in soft patches, for an emotion the voice
// carries. Plain fills and strokes only, as everywhere else.

import type { Dot, OrbFrame, Stroke } from './core';
import { TAU, clamp01, smoothstep, vnoise3 } from './core';
import { type ColorRamp, type OrbColors, colorRamp } from './colors';
import { paintLight } from './light';
import { refractEdge } from './refract';

/** Optional ink tint, resolved to an RGB triple (0–255 each). */
export interface OrbTint {
  r: number;
  g: number;
  b: number;
}

/**
 * A colour washing through the orb. It never floods the marks: a slow
 * noise field picks out soft patches that drift across the orb, and near,
 * bright marks take it more than far, faint ones, so it reads as light
 * moving inside the form rather than paint on top of it.
 */
export interface OrbGlow extends OrbTint {
  /** 0–1: how present the colour is (eased by the component). */
  amount: number;
  /** Seconds, for the drift of the patches. */
  t: number;
  /** The orb's CSS size, so the patches scale with it. */
  size: number;
}

/** How much glow one mark at (x, y) with ink `white` takes, 0–1. */
function glowAt(x: number, y: number, white: number, g: OrbGlow): number {
  const s = 2.2 / g.size;
  const f = vnoise3(x * s + g.t * 0.11, y * s - g.t * 0.08, g.t * 0.07);
  const patch = smoothstep(0.3, 0.75, f);
  return g.amount * (0.2 + 0.75 * patch) * clamp01(1.3 - white);
}

/**
 * Map one ink value to a CSS color. Grayscale by default; with a tint (or
 * the glow) the ink ramp is kept as a ramp on that colour, so depth reads
 * the same in colour — on dark substrates it fades toward black, on light
 * ones toward white.
 */
function inkColor(
  w: number,
  alpha: number,
  dark: boolean,
  tint?: OrbTint,
  glow?: OrbGlow,
  gw = 0,
  hue?: [number, number, number],
  sat = 0
): string {
  const a = Math.round(alpha * 1000) / 1000;
  const ramp = (c: number) => (dark ? c * (1 - w) : c + (255 - c) * w);
  const g = (dark ? 1 - w : w) * 255;
  let r = tint ? ramp(tint.r) : g;
  let gr = tint ? ramp(tint.g) : g;
  let b = tint ? ramp(tint.b) : g;
  // colourful mode: the accent, on the same depth ramp, mixed in
  if (hue && sat > 0) {
    r += (ramp(hue[0]) - r) * sat;
    gr += (ramp(hue[1]) - gr) * sat;
    b += (ramp(hue[2]) - b) * sat;
  }
  if (glow && gw > 0) {
    r += (ramp(glow.r) - r) * gw;
    gr += (ramp(glow.g) - gr) * gw;
    b += (ramp(glow.b) - b) * gw;
  }
  return `rgba(${Math.round(r)},${Math.round(gr)},${Math.round(b)},${a})`;
}

// Opacity is quantised into this many steps so every segment sharing a
// step joins one path: a line-drawn orb is a handful of stroke() calls, not
// a thousand, and a line keeps real joins wherever its depth holds still.
// The glow joins the key in coarser steps, for the same reason.
const ALPHA_STEPS = 24;
const GLOW_STEPS = 8;

/** Stroke pass, batched by ink, width, quantised opacity and glow. */
export function paintStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  dark: boolean,
  tint?: OrbTint,
  glow?: OrbGlow,
  colors?: ColorRamp
): void {
  const lit = glow && glow.amount > 0.005 ? glow : undefined;
  const hued = colors && colors.saturation > 0 ? colors : undefined;
  const batches = new Map<string, { path: Path2D; white: number; w: number; a: number; gw: number; ci: number }>();
  for (const s of strokes) {
    const n = s.pts.length >> 1;
    const segs = s.closed ? n : n - 1;
    let key = '';
    let batch: { path: Path2D } | undefined;
    for (let i = 0; i < segs; i++) {
      const j = i + 1 === n ? 0 : i + 1;
      const q = Math.round(clamp01((s.a[i] + s.a[j]) / 2) * ALPHA_STEPS);
      if (q === 0) {
        key = '';
        continue;
      }
      const gq = lit
        ? Math.round(
            glowAt((s.pts[2 * i] + s.pts[2 * j]) / 2, (s.pts[2 * i + 1] + s.pts[2 * j + 1]) / 2, s.white, lit) *
              GLOW_STEPS
          )
        : 0;
      const ci = hued ? hued.at((s.pts[2 * i] + s.pts[2 * j]) / 2, (s.pts[2 * i + 1] + s.pts[2 * j + 1]) / 2) : 0;
      const k = `${q}|${s.white}|${Math.round(s.w * 20)}|${gq}|${ci}`;
      if (k !== key) {
        let b = batches.get(k);
        if (!b) {
          b = { path: new Path2D(), white: s.white, w: s.w, a: q / ALPHA_STEPS, gw: gq / GLOW_STEPS, ci };
          batches.set(k, b);
        }
        batch = b;
        key = k;
        b.path.moveTo(s.pts[2 * i], s.pts[2 * i + 1]);
      }
      batch!.path.lineTo(s.pts[2 * j], s.pts[2 * j + 1]);
    }
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const b of batches.values()) {
    ctx.strokeStyle = inkColor(clamp01(b.white), b.a, dark, tint, lit, b.gw, hued?.rgb, hued?.mix[b.ci]);
    ctx.lineWidth = b.w;
    ctx.stroke(b.path);
  }
}

/** Dot pass: matte, z-sorted, near dots bright on dark substrates. */
export function paintDots(
  ctx: CanvasRenderingContext2D,
  dots: Dot[],
  dark: boolean,
  tint?: OrbTint,
  glow?: OrbGlow,
  colors?: ColorRamp,
  square = false
): void {
  const lit = glow && glow.amount > 0.005 ? glow : undefined;
  const hued = colors && colors.saturation > 0 ? colors : undefined;
  for (const d of dots) {
    const white = clamp01(d.white);
    const gw = lit ? glowAt(d.x, d.y, white, lit) : 0;
    const ci = hued ? hued.at(d.x, d.y) : 0;
    ctx.fillStyle = inkColor(white, clamp01(d.a ?? 1), dark, tint, lit, gw, hued?.rgb, hued?.mix[ci]);
    if (square) {
      ctx.fillRect(d.x - d.r, d.y - d.r, 2 * d.r, 2 * d.r);
      continue;
    }
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, TAU);
    ctx.fill();
  }
}

/** Paint a finished frame. Strokes first, so nodes sit on their lines. */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  frame: OrbFrame,
  dark: boolean,
  tint?: OrbTint,
  glow?: OrbGlow,
  colors?: OrbColors
): void {
  // colourful mode is for the ink types; a luminous frame has its own spectrum
  const ramp = colors && colors.saturation > 0 && !frame.light ? colorRamp(colors) : undefined;
  if (frame.light) paintLight(ctx, frame, frame.light, dark, tint, glow);
  else if (frame.strokes.length) paintStrokes(ctx, frame.strokes, dark, tint, glow, ramp);
  paintDots(ctx, frame.dots, dark, tint, glow, ramp, frame.square);
  // refracted into the edge where the orb presses on it
  if (frame.contact?.lens) refractEdge(ctx, frame.contact.side, frame.contact.x, frame.contact.lens);
}
