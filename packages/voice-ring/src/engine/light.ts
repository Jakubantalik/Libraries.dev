// The luminous painter: a frame's strokes drawn as coloured light instead
// of ink. One conic gradient carries the spectrum around the orb, so every
// pass — halo, bloom, core — is a handful of stroke() calls however many
// points the rings have. Bloom comes from stacking wide, faint strokes
// (no ctx.filter, so Safari draws the same picture), additively on dark
// substrates so overlaps run hot toward white, like light does.

import type { FrameLight, OrbFrame } from './core';
import { clamp01 } from './core';
import type { OrbGlow, OrbTint } from './paint';

type Stop = [number, number, number, number];

// The chromatic fringes either side of each ring: a cool teal just
// outside, a deep blue just inside — the split a lens gives bright light.
const FRINGE_OUT: [number, number, number] = [120, 232, 214];
const FRINGE_IN: [number, number, number] = [64, 72, 255];

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

// OKLab, where a straight line between two colours looks like an even blend
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gam = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055);

function toLab(r: number, g: number, b: number): [number, number, number] {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  ];
}

function fromLab(L: number, A: number, B: number): [number, number, number] {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const c = (v: number) => Math.max(0, Math.min(255, gam(v)));
  return [
    c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
  ];
}

/** The spectrum after tint, emotion and theme have had their say. */
function palette(stops: Stop[], dark: boolean, tint?: OrbTint, glow?: OrbGlow): Stop[] {
  const e = glow && glow.amount > 0.005 ? glow : undefined;
  return stops.map(([o, r, g, b]) => {
    if (tint) {
      // keep a breath of the hue variation so a tinted aura still shimmers
      r += (tint.r - r) * 0.85;
      g += (tint.g - g) * 0.85;
      b += (tint.b - b) * 0.85;
    }
    if (e) {
      // An emotion recolours the spectrum as a gradient of its own hue's
      // neighbours — green runs from teal to lime, red from magenta to
      // orange, blue from cyan to violet — swinging ±36° round the ring so
      // it closes seamlessly. Each stop takes its new hue at its own
      // saturation and lightness, so the light stays as vivid as it was.
      const [, sat, l] = toHsl(r, g, b);
      const [eh] = toHsl(e.r, e.g, e.b);
      const to = fromHsl((eh + 0.1 * Math.sin(2 * Math.PI * o) + 1) % 1, sat, l);
      // It comes and goes as an even blend from each stop's own colour, not
      // a turn of the hue: turning a whole spectrum to one hue tears the
      // ring where neighbouring stops turn opposite ways round the wheel.
      const a = toLab(r, g, b);
      const z = toLab(to[0], to[1], to[2]);
      const k = e.amount;
      [r, g, b] = fromLab(a[0] + (z[0] - a[0]) * k, a[1] + (z[1] - a[1]) * k, a[2] + (z[2] - a[2]) * k);
    }
    // on paper, light reads as deeper, saturated ink
    const d = dark ? 1 : 0.82;
    return [o, r * d, g * d, b * d];
  });
}

const css = (r: number, g: number, b: number) => `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;

/**
 * The ring's colours resampled every 10° along a smooth curve through the
 * stops, in OKLab. Joined in straight lines, the colours turn sharply at a
 * stop — the warm one at the top peaks there — and the additive bloom, which
 * runs a channel into white, turns that corner into a visible edge.
 */
export function smoothSpectrum(stops: Stop[], samples = 36): Stop[] {
  // the ring closes on itself: the stop at 1 is the one at 0 again
  const ring = stops.filter(([o]) => o < 1);
  const m = ring.length;
  if (m < 3) return stops;
  const lab = ring.map(([, r, g, b]) => toLab(r, g, b));
  const at = (i: number) => ((i % m) + m) % m;
  // where stop i sits, counting laps round the ring
  const pos = (i: number) => ring[at(i)][0] + Math.floor(i / m);
  // the slope through each stop, from its neighbours: no corner at the stop
  const slope = (i: number) => {
    const d = pos(i + 1) - pos(i - 1);
    return lab[at(i + 1)].map((v, c) => (v - lab[at(i - 1)][c]) / d);
  };
  const out: Stop[] = [];
  for (let k = 0; k <= samples; k++) {
    const u = k / samples;
    let i = -1;
    while (i < m - 1 && pos(i + 1) <= u) i++;
    const h = pos(i + 1) - pos(i);
    const t = (u - pos(i)) / h;
    const t2 = t * t, t3 = t2 * t;
    const a = lab[at(i)], b = lab[at(i + 1)], ma = slope(i), mb = slope(i + 1);
    const v = [0, 1, 2].map(
      (c) =>
        (2 * t3 - 3 * t2 + 1) * a[c] + (t3 - 2 * t2 + t) * h * ma[c] + (-2 * t3 + 3 * t2) * b[c] + (t3 - t2) * h * mb[c]
    );
    const [r, g, bl] = fromLab(v[0], v[1], v[2]);
    out.push([u, r, g, bl]);
  }
  return out;
}

function spectrum(ctx: CanvasRenderingContext2D, L: FrameLight, stops: Stop[]): CanvasGradient {
  // conic where the browser has it (all current ones); a diagonal sweep otherwise
  const grad =
    typeof ctx.createConicGradient === 'function'
      ? ctx.createConicGradient(L.angle, L.cx, L.cy)
      : ctx.createLinearGradient(L.cx - L.r, L.cy - L.r, L.cx + L.r, L.cy + L.r);
  for (const [o, r, g, b] of stops) grad.addColorStop(clamp01(o), css(r, g, b));
  return grad;
}

/** Paint `frame`'s strokes as light, lit by `L`. */
export function paintLight(
  ctx: CanvasRenderingContext2D,
  frame: OrbFrame,
  L: FrameLight,
  dark: boolean,
  tint?: OrbTint,
  glow?: OrbGlow
): void {
  const grad = spectrum(ctx, L, smoothSpectrum(palette(L.stops, dark, tint, glow)));
  // one path per ring, lit at its mean depth: per-segment opacity would
  // seam where the wide, additive bloom strokes overlap
  const rings = frame.strokes.map((s) => {
    const p = new Path2D();
    const n = s.pts.length >> 1;
    let a = 0;
    for (let i = 0; i < n; i++) {
      if (i === 0) p.moveTo(s.pts[0], s.pts[1]);
      else p.lineTo(s.pts[2 * i], s.pts[2 * i + 1]);
      a += s.a[i];
    }
    if (s.closed) p.closePath();
    return { p, a: n ? a / n : 1, w: s.w };
  });
  const n = Math.max(1, rings.length);
  const I = L.intensity;
  const pass = (width: (w: number) => number, alpha: (a: number) => number) => {
    for (const r of rings) {
      ctx.lineWidth = width(r.w);
      ctx.globalAlpha = clamp01(alpha(r.a));
      ctx.stroke(r.p);
    }
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
  ctx.strokeStyle = grad;

  // 1 · halo: very wide, very faint, shared out between the rings so the
  // total stays the same however many there are
  const haloK = (L.halo * I * (dark ? 1 : 0.2)) / n;
  for (const [wk, ak] of [
    [0.7, 0.045],
    [0.42, 0.075],
    [0.24, 0.11],
    [0.12, 0.16]
  ]) {
    pass(
      () => L.r * wk,
      () => ak * haloK
    );
  }

  // 2 · bloom: three soft passes hugging each ring; across a bundle of
  // rings they sum into one luminous band, the glassy ribbon
  const bloomK = I * (dark ? 1 : 0.6);
  for (const [wk, ak] of [
    [16, 0.05],
    [8, 0.11],
    [4, 0.2]
  ]) {
    pass(
      (w) => w * wk,
      (a) => ak * bloomK * a
    );
  }

  // 3 · chromatic fringes, scaled about the centre (dark substrates only)
  if (dark && L.fringe > 0) {
    for (const [scale, rgb, ak] of [
      [1 + L.fringe, FRINGE_OUT, 0.16],
      [1 - L.fringe, FRINGE_IN, 0.22]
    ] as const) {
      ctx.save();
      ctx.translate(L.cx, L.cy);
      ctx.scale(scale, scale);
      ctx.translate(-L.cx, -L.cy);
      ctx.strokeStyle = css(rgb[0], rgb[1], rgb[2]);
      pass(
        (w) => (w * 1.4) / scale,
        (a) => ak * I * a
      );
      ctx.restore();
    }
    ctx.strokeStyle = grad;
  }

  // 4 · the crisp core of every ring
  pass(
    (w) => w,
    (a) => 0.7 * a * (0.75 + 0.25 * I)
  );

  // 5 · specular hot spots: white pooled where the light sits
  if (dark) {
    for (const s of L.spec) {
      const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.strokeStyle = g;
      pass(
        (w) => w * 2.2,
        (a) => s.a * a
      );
    }
  }
  ctx.restore();
}
