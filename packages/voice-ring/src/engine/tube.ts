// The tube painter: a line drawn as a lit, solid tube. The line is cut into
// short runs and the runs drawn far → near, so where it passes in front of
// itself the near side covers the far one, a clear gap cut round it.
// Each run is one gradient from its first point's light to its last's, a
// little wider the nearer it is, with a thin highlight laid along it toward
// the light. Each run starts a segment back into the run before it, with
// butt caps, so the runs meet with no seam whichever is drawn last.

import type { FrameTube, Stroke } from './core';
import { clamp01, smoothstep } from './core';
import type { OrbGlow, OrbTint } from './paint';
import { EMOTION_COLORS } from '../emotion';

// segments per run: short enough that a crossing sorts cleanly, long
// enough that a loop is a few dozen strokes
const RUN = 6;

/**
 * The brightness `look` gives a glow's colour: its emotion's own, or for a
 * colour between emotions (a crossfade, a detected mood) a blend of theirs,
 * each weighted by how near the colour is to it.
 */
function emotionBrightness(look: FrameTube, glow: OrbTint): number {
  const own = [
    [EMOTION_COLORS.positive, look.positiveBrightness ?? 1],
    [EMOTION_COLORS.negative, look.negativeBrightness ?? 1],
    [EMOTION_COLORS.calm, look.calmBrightness ?? 1]
  ] as const;
  let sum = 0;
  let weight = 0;
  for (const [c, b] of own) {
    const w = Math.exp(-((glow.r - c.r) ** 2 + (glow.g - c.g) ** 2 + (glow.b - c.b) ** 2) / 6000);
    sum += w * b;
    weight += w;
  }
  return weight > 1e-6 ? sum / weight : 1;
}

type Ctx = CanvasRenderingContext2D;

/**
 * The colour for a light value. Grey, with the tint on it; with an
 * emotion, the emotion's own colour takes the tube over by `share` (0 the
 * neutral grey … 1 all colour), lit like the grey was — deep in the
 * shadows, vivid in the light, toward white only at the very brightest.
 */
function tubeColor(s: number, dark: boolean, look: FrameTube, tint?: OrbTint, glow?: OrbGlow, share = 1): string {
  // on dark, lit parts read pale; on paper, as darker ink
  const g = dark ? 255 * (0.16 + 0.84 * s) : 255 * (0.1 + 0.6 * (1 - s));
  let r = g;
  let gr = g;
  let b = g;
  if (tint) {
    // a colour keeps the grey's light: shaded toward black on dark, toward
    // white on paper
    const shadeOf = (c: number) => (dark ? (c * g) / 255 : c + (255 - c) * (g / 255) * 0.7);
    r += (shadeOf(tint.r) - r) * 0.85;
    gr += (shadeOf(tint.g) - gr) * 0.85;
    b += (shadeOf(tint.b) - b) * 0.85;
  }
  if (glow) {
    const bright = (look.colorBrightness ?? 1) * emotionBrightness(look, glow);
    const vivid = (c: number) =>
      dark
        ? Math.min(255, c * (0.3 + 0.9 * s) * bright + 90 * s ** 4)
        : Math.min(255, c * (0.45 + 0.55 * (1 - s)) * bright);
    const k = glow.amount * share;
    r += (vivid(glow.r) - r) * k;
    gr += (vivid(glow.g) - gr) * k;
    b += (vivid(glow.b) - b) * k;
    // saturation: toward the grey below 1, past the colour above it
    const sat = look.saturation ?? 1;
    if (sat !== 1) {
      const m = (r + gr + b) / 3;
      r = m + (r - m) * sat;
      gr = m + (gr - m) * sat;
      b = m + (b - m) * sat;
    }
  }
  const c = (v: number) => Math.round(Math.max(0, Math.min(255, v)));
  return `rgb(${c(r)},${c(gr)},${c(b)})`;
}

/** Paint `strokes` as lit tubes: each stroke's `a` is its light, `z` its depth. */
export function paintTube(
  ctx: Ctx,
  strokes: Stroke[],
  look: FrameTube,
  dark: boolean,
  tint?: OrbTint,
  glow?: OrbGlow
): void {
  const light = (s: Stroke, i: number) => clamp01(0.5 + (s.a[i] - 0.5) * look.contrast);
  const runs: Array<{ s: Stroke; from: number; to: number; z: number }> = [];
  for (const s of strokes) {
    const n = s.pts.length >> 1;
    const segs = s.closed ? n : n - 1;
    for (let i0 = 0; i0 < segs; i0 += RUN) {
      const i1 = Math.min(segs, i0 + RUN);
      let z = 0;
      for (let i = i0; i <= i1; i++) z += s.z?.[i % n] ?? 0;
      // a segment back into the run before, so the two overlap
      const from = s.closed ? i0 - 1 : Math.max(0, i0 - 1);
      runs.push({ s, from, to: i1, z: z / (i1 - i0 + 1) });
    }
  }
  runs.sort((a, b) => a.z - b.z);

  // With an emotion, its colour fades round the orb into the neutral grey:
  // each point's share of it is set by its angle round the orb's centre,
  // full on one side, grey on the other as far as `gradient` says, the
  // whole fade turning slowly with time.
  const emo = glow && glow.amount > 0.005 ? glow : undefined;
  let cx = 0;
  let cy = 0;
  let count = 0;
  if (emo) {
    for (const s of strokes)
      for (let i = 0; i < s.pts.length; i += 2) {
        cx += s.pts[i];
        cy += s.pts[i + 1];
        count++;
      }
    cx /= count || 1;
    cy /= count || 1;
  }
  const phase = (((look.gradientAngle ?? 0) + (look.gradientSpin ?? 20) * (glow?.t ?? 0)) * Math.PI) / 180;
  const fade = clamp01(look.gradient ?? 1);
  const shareAt = (s: Stroke, i: number) => {
    if (!emo) return 1;
    const side = (Math.sin(Math.atan2(s.pts[2 * i + 1] - cy, s.pts[2 * i] - cx) + phase) + 1) / 2;
    return 1 - fade * (1 - smoothstep(0, 1, side));
  };

  ctx.save();
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  for (const { s, from, to, z } of runs) {
    const n = s.pts.length >> 1;
    const at = (i: number) => ((i % n) + n) % n;
    const path = new Path2D();
    for (let i = from; i <= to; i++) {
      const k = at(i);
      if (i === from) path.moveTo(s.pts[2 * k], s.pts[2 * k + 1]);
      else path.lineTo(s.pts[2 * k], s.pts[2 * k + 1]);
    }
    const a = at(from);
    const b = at(to);
    const d = look.depth ?? 0.15;
    const w = s.w * (1 - d + d * z);

    // the gap: whatever it passes in front of is cut back round it. Cut
    // rather than shaded, so overlapping runs never darken twice
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = w * 1.35;
    ctx.stroke(path);
    ctx.globalCompositeOperation = 'source-over';

    // the body, its light running from one end of the run to the other
    const x0 = s.pts[2 * a], y0 = s.pts[2 * a + 1];
    const x1 = s.pts[2 * b], y1 = s.pts[2 * b + 1];
    if (Math.hypot(x1 - x0, y1 - y0) > 0.5) {
      const grad = ctx.createLinearGradient(x0, y0, x1, y1);
      grad.addColorStop(0, tubeColor(light(s, a), dark, look, tint, emo, shareAt(s, a)));
      grad.addColorStop(1, tubeColor(light(s, b), dark, look, tint, emo, shareAt(s, b)));
      ctx.strokeStyle = grad;
    } else ctx.strokeStyle = tubeColor(light(s, a), dark, look, tint, emo, shareAt(s, a));
    ctx.lineWidth = w;
    ctx.stroke(path);

    // the highlight, set toward the light (up and to the left), strongest
    // where the run is brightest
    let lit = 0;
    for (let i = from; i <= to; i++) lit += light(s, at(i));
    lit /= to - from + 1;
    const alpha = clamp01(look.shine * (dark ? 0.6 : 0.45) * lit * lit);
    if (alpha > 0.01) {
      ctx.save();
      ctx.translate(-0.17 * w, -0.19 * w);
      ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = w * 0.32;
      ctx.stroke(path);
      ctx.restore();
    }
  }
  ctx.restore();
}
