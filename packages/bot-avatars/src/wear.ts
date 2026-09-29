/* wear.ts — things the bots can wear: a hat, glasses, headphones, a bow
   tie. Each is a small 3D object placed on the body's own geometry — the
   top of the head, the sides, the eyes, the front below the face — and
   projected through the same rotation as the slice stack, so it turns,
   tips and flips with the head instead of floating over it. They are drawn
   in the same spirit as the body: soft felt, satin, dark plastic, gold,
   each lit from the body's light, with its own small shadow where it sits
   on the body.

   Everything is canvas 2D paths and gradients, in body space (the
   context carries the body's transform when these run). */

import type { BotAvatarGlasses, BotAvatarHat } from './types';
import { rasterize, PAD, SPAN } from './plastic';
import { shade } from './color';

export interface Wear {
  hat: BotAvatarHat;
  glasses: BotAvatarGlasses;
  headphones: boolean;
  bowTie: boolean;
  /** the hat's, the headphones' and the bow tie's colour */
  color: string;
}

/** The rig as the slices use it: floored cos/sin of yaw and pitch, the
    unfloored facing, the body's half-depth, and the light on screen. */
export interface WearRig {
  cy: number; sy: number; cp: number; sp: number;
  facing: number;
  halfDepth: number;
  lx: number; ly: number;
}

/* ── the outline's landmarks, once per shape ────────────────────────── */

interface Marks {
  /** the top of the head over its middle, and the head's width a little below it */
  top: number;
  topL: number;
  topR: number;
  /** the widest row between a third and two thirds down, and its ends */
  mid: number;
  left: number;
  right: number;
  /** the bottom under the middle */
  bottom: number;
  /** each row's width, top to bottom, at `step` design units a row */
  widths: Float32Array;
  step: number;
}

/* where a hat sits: the first row, from the top, where the head is at
   least `frac` of its full width — a narrow top (a star's point, a
   triangle's apex) seats a hat lower than a round one */
function seat(m: Marks, frac: number): number {
  const W = m.right - m.left;
  for (let i = 0; i < m.widths.length; i++) if (m.widths[i] >= frac * W) return i * m.step - PAD;
  return m.top;
}
const marks = new WeakMap<Path2D, Marks>();
function marksFor(path: Path2D): Marks | null {
  const hit = marks.get(path);
  if (hit) return hit;
  const N = 128;
  const cov = rasterize(path, N);
  if (!cov) return null;
  const u = SPAN / N;
  const toX = (i: number) => (i + 0.5) * u - PAD;
  const inside = (x: number, y: number) => cov[y * N + x] >= 128;
  const c0 = Math.floor((42 + PAD) / u), c1 = Math.ceil((58 + PAD) / u);
  let top = N, bottom = -1;
  for (let x = c0; x <= c1; x++) {
    for (let y = 0; y < N; y++) if (inside(x, y)) { if (y < top) top = y; break; }
    for (let y = N - 1; y >= 0; y--) if (inside(x, y)) { if (y > bottom) bottom = y; break; }
  }
  const row = (y: number): [number, number] => {
    let l = -1, r = -1;
    for (let x = 0; x < N; x++) if (inside(x, y)) { if (l < 0) l = x; r = x; }
    return [l, r];
  };
  const yT = Math.min(N - 1, top + Math.round(8 / u));
  const [tl, tr] = row(yT);
  let best = -1, bl = 0, br = 0, by = 0;
  for (let y = Math.round((33 + PAD) / u); y <= Math.round((67 + PAD) / u); y++) {
    const [l, r] = row(y);
    if (l >= 0 && r - l > best) { best = r - l; bl = l; br = r; by = y; }
  }
  const widths = new Float32Array(N);
  for (let y = 0; y < N; y++) {
    const [l, r] = row(y);
    widths[y] = l < 0 ? 0 : (r - l + 1) * u;
  }
  const m: Marks = {
    top: toX(top) - 0.5 * u,
    topL: toX(tl),
    topR: toX(tr),
    mid: toX(by),
    left: toX(bl) - 0.5 * u,
    right: toX(br) + 0.5 * u,
    bottom: toX(bottom) + 0.5 * u,
    widths,
    step: u,
  };
  marks.set(path, m);
  return m;
}

/* ── projection ─────────────────────────────────────────────────────── */

type P3 = [number, number, number];
type P2 = [number, number];

/* the slices' orthographic turn: design (x, y) about the centre, z along
   the depth in design units (positive toward the front cap) */
function project(r: WearRig, p: P3): P2 {
  const X = p[0] - 50, Y = p[1] - 50;
  return [r.cy * X + r.sy * p[2], r.sy * r.sp * X + r.cp * Y - r.cy * r.sp * p[2]];
}
/* how far a point sits toward the viewer */
function depthOf(r: WearRig, p: P3): number {
  return -r.sy * r.cp * (p[0] - 50) + r.sp * (p[1] - 50) + r.cy * r.cp * p[2];
}
/* a direction's facing: positive when it points at the viewer */
function facingOf(r: WearRig, n: P3): number {
  return -r.sy * r.cp * n[0] + r.sp * n[1] + r.cy * r.cp * n[2];
}

/* rotate a local offset by a tilt about the depth axis, then a lean about x */
function tilt(v: P3, roll: number, lean: number): P3 {
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const x = v[0] * cr - v[1] * sr, y = v[0] * sr + v[1] * cr;
  const cl = Math.cos(lean), sl = Math.sin(lean);
  return [x, y * cl - v[2] * sl, y * sl + v[2] * cl];
}
const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/* convex hull (monotone chain) of screen points */
function hull(pts: P2[]): P2[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [], up: P2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  lo.pop();
  up.pop();
  return lo.concat(up);
}
function polyPath(pts: P2[], close = true): Path2D {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])));
  if (close) p.closePath();
  return p;
}
function bounds(pts: P2[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/* a stable pseudo-random per index, so fuzz does not shimmer frame to frame */
const rnd = (i: number, k = 0) => {
  let h = (i * 2654435761 + k * 40503) | 0;
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};

/* ── materials ──────────────────────────────────────────────────────── */

/* a lit fill across a shape's bounds, from the light side to the far side */
function litFill(ctx: CanvasRenderingContext2D, b: ReturnType<typeof bounds>, r: WearRig, stops: [number, string][]) {
  const reach = Math.max(b.w, b.h) * 0.62;
  const g = ctx.createLinearGradient(b.cx + r.lx * reach, b.cy + r.ly * reach, b.cx - r.lx * reach, b.cy - r.ly * reach);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

/* felt's grain: a small tile of soft noise, multiplied over felt faintly */
let grain: HTMLCanvasElement | OffscreenCanvas | null = null;
function grainTile(): HTMLCanvasElement | OffscreenCanvas | null {
  if (grain) return grain;
  const n = 48;
  const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(n, n) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: n, height: n }) : null;
  const g = c && (c.getContext('2d') as CanvasRenderingContext2D | null);
  if (!c || !g) return null;
  const img = g.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    /* short diagonal fibres: noise smeared along one direction */
    const x = i % n, y = (i / n) | 0;
    let v = 0;
    for (let k = -2; k <= 2; k++) v += rnd(((x + k + n) % n) + ((y + k + n) % n) * n, 5);
    v /= 5;
    const m = Math.round(255 * (0.82 + 0.36 * v));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = Math.min(255, m);
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  grain = c;
  return c;
}

/* felt: soft and matte, lit from above and from the light's side, darker
   toward its underside, a fine grain, and a fuzzy edge */
function felt(ctx: CanvasRenderingContext2D, outline: P2[], r: WearRig, base: string, seed: number) {
  const b = bounds(outline);
  const path = polyPath(outline);
  /* the light for a hat comes from above as much as from the side */
  let ux = r.lx * 0.7, uy = r.ly * 0.7 - 0.75;
  const ul = Math.hypot(ux, uy) || 1;
  ux /= ul; uy /= ul;
  const reach = Math.max(b.w, b.h) * 0.55;
  const g = ctx.createLinearGradient(b.cx + ux * reach, b.cy + uy * reach, b.cx - ux * reach, b.cy - uy * reach);
  g.addColorStop(0, shade(base, 0.2, -0.03));
  g.addColorStop(0.5, shade(base, 0.05));
  g.addColorStop(1, shade(base, -0.1, 0.02));
  ctx.fillStyle = g;
  ctx.fill(path);
  ctx.save();
  ctx.clip(path);
  const tile = grainTile();
  if (tile) {
    const pat = ctx.createPattern(tile as HTMLCanvasElement, 'repeat');
    if (pat) {
      pat.setTransform?.(new DOMMatrix().scale(0.18));
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = pat;
      ctx.fillRect(b.x0 - 2, b.y0 - 2, b.w + 4, b.h + 4);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
  /* a soft occlusion toward the far and lower edge, so it reads as a volume */
  const o = ctx.createRadialGradient(b.cx + ux * b.w * 0.18, b.cy + uy * b.h * 0.28, 0, b.cx, b.cy, Math.max(b.w, b.h) * 0.72);
  o.addColorStop(0, 'rgba(0,0,0,0)');
  o.addColorStop(0.6, 'rgba(0,0,0,0.04)');
  o.addColorStop(1, 'rgba(0,0,0,0.32)');
  ctx.fillStyle = o;
  ctx.fillRect(b.x0 - 2, b.y0 - 2, b.w + 4, b.h + 4);
  ctx.restore();
  fuzz(ctx, outline, base, seed, 0.55);
}

/* short hairs standing off an outline: a felt or pile edge. Two batched
   strokes, a lighter and a darker set, rather than one call a hair. */
function fuzz(ctx: CanvasRenderingContext2D, outline: P2[], base: string, seed: number, len: number) {
  const n = outline.length;
  if (n < 3) return;
  let total = 0;
  const seg: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = outline[i], c = outline[(i + 1) % n];
    const d = Math.hypot(c[0] - a[0], c[1] - a[1]);
    seg.push(d);
    total += d;
  }
  const count = Math.min(360, Math.max(24, Math.round(total * 2.4)));
  const b = bounds(outline);
  const lightP = new Path2D(), darkP = new Path2D();
  let si = 0, acc = 0;
  for (let k = 0; k < count; k++) {
    const want = (k + rnd(k, seed) * 0.8) * (total / count);
    while (si < n - 1 && acc + seg[si] < want) acc += seg[si++];
    const a = outline[si], c = outline[(si + 1) % n];
    const t = seg[si] ? (want - acc) / seg[si] : 0;
    const x = a[0] + (c[0] - a[0]) * t, y = a[1] + (c[1] - a[1]) * t;
    /* outward: away from the shape's centre, turned a little at random */
    let ox = x - b.cx, oy = y - b.cy;
    const ol = Math.hypot(ox, oy) || 1;
    ox /= ol; oy /= ol;
    const ang = (rnd(k, seed + 1) - 0.5) * 0.9;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const hx = ox * ca - oy * sa, hy = ox * sa + oy * ca;
    const l = len * (0.35 + rnd(k, seed + 2));
    const p = rnd(k, seed + 3) > 0.5 ? lightP : darkP;
    p.moveTo(x - hx * 0.4, y - hy * 0.4);
    p.lineTo(x + hx * l, y + hy * l);
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.4;
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = shade(base, 0.14);
  ctx.stroke(lightP);
  ctx.strokeStyle = shade(base, -0.06);
  ctx.stroke(darkP);
  ctx.restore();
}

/* a fuzzy ball: a pompom */
function pompom(ctx: CanvasRenderingContext2D, c: P2, rad: number, r: WearRig, base: string, seed: number) {
  const pts: P2[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    pts.push([c[0] + Math.cos(a) * rad, c[1] + Math.sin(a) * rad]);
  }
  const g = ctx.createRadialGradient(c[0] + r.lx * rad * 0.45, c[1] + r.ly * rad * 0.45, rad * 0.1, c[0], c[1], rad * 1.1);
  g.addColorStop(0, shade(base, 0.18, -0.02));
  g.addColorStop(0.6, base);
  g.addColorStop(1, shade(base, -0.18, 0.02));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(c[0], c[1], rad, 0, Math.PI * 2);
  ctx.fill();
  fuzz(ctx, pts, base, seed, rad * 0.32);
}

/* a soft contact shadow cast on the body under an object's lower edge */
function contact(ctx: CanvasRenderingContext2D, clip: Path2D | null, cx: number, cy: number, rx: number, ry: number, a: number) {
  if (!(rx > 0) || !(ry > 0)) return;
  ctx.save();
  if (clip) ctx.clip(clip);
  ctx.translate(cx, cy);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(0,0,0,${a})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ── the hats ───────────────────────────────────────────────────────── */

function drawBeret(ctx: CanvasRenderingContext2D, r: WearRig, m: Marks, base: string, bodyClip: Path2D | null) {
  const W = m.right - m.left;
  const rad = 0.43 * W, dome = 0.27 * W;
  /* a soft felt dome settled over the crown of the head — its band hugs
     the head a little below the top and its puff rises above it — slid and
     tipped over to one side, seen mostly from the side with a hint of its
     top, the way a beret is worn */
  const C: P3 = [50 - 0.07 * W, Math.max(m.top + 0.2 * W, seat(m, 0.5) + 0.08 * W), 0];
  const roll = -0.22, lean = 0.1;
  const pts: P3[] = [];
  for (let ring = 0; ring <= 6; ring++) {
    const f = ring / 6;
    /* the profile: widest a little above the band, rounding in to a soft top */
    const rr = rad * (ring === 0 ? 0.86 : Math.cos((f * Math.PI) / 2 - 0.12) * 1.04);
    const hh = ring === 0 ? 0.02 * W : -dome * Math.sin((f * Math.PI) / 2);
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * Math.PI * 2;
      pts.push(add(C, tilt([rr * Math.cos(a), hh, rr * 0.9 * Math.sin(a)], roll, lean)));
    }
  }
  const outline = hull(pts.map((p) => project(r, p)));
  const b = bounds(outline);
  /* its shadow on the head, under the band */
  const band = project(r, add(C, tilt([0, 0.03 * W, 0], roll, lean)));
  contact(ctx, bodyClip, band[0] + 0.02 * W, band[1] + 0.05 * W, b.w * 0.46, 0.085 * W, 0.36);
  felt(ctx, outline, r, base, 11);
  /* the little stalk on top */
  const tip = project(r, add(C, tilt([0.05 * W, -dome - 0.02 * W, 0], roll, lean)));
  pompom(ctx, tip, 0.03 * W, r, base, 17);
}

function drawBeanie(ctx: CanvasRenderingContext2D, r: WearRig, m: Marks, base: string, bodyClip: Path2D | null) {
  const W = m.right - m.left;
  const headW = Math.max(0.5 * W, m.topR - m.topL);
  const rad = 0.53 * headW + 0.08 * W, h = 0.3 * W, cuff = 0.085 * W;
  const C: P3 = [50, seat(m, 0.72) + 0.06 * W, 0];
  const roll = 0, lean = 0.12;
  const pts: P3[] = [];
  for (let ring = 0; ring <= 6; ring++) {
    const f = ring / 6, rr = rad * Math.cos((f * Math.PI) / 2) * (1 - 0.06 * f), hh = -h * Math.sin((f * Math.PI) / 2);
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      pts.push(add(C, tilt([rr * Math.cos(a), hh, rr * 0.9 * Math.sin(a)], roll, lean)));
    }
  }
  const cuffPts: P3[] = [];
  for (let i = 0; i < 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    cuffPts.push(add(C, tilt([rad * 1.03 * Math.cos(a), 0.01 * W, rad * 0.93 * Math.sin(a)], roll, lean)));
    cuffPts.push(add(C, tilt([rad * 1.03 * Math.cos(a), cuff, rad * 0.93 * Math.sin(a)], roll, lean)));
  }
  const domeOut = hull(pts.map((p) => project(r, p)));
  const cuffOut = hull(cuffPts.map((p) => project(r, p)));
  const b = bounds(cuffOut);
  contact(ctx, bodyClip, b.cx, b.y1, b.w * 0.5, 0.05 * W, 0.28);
  felt(ctx, domeOut, r, base, 23);
  /* the knit: ribs running up the dome, on its near side */
  ctx.save();
  ctx.clip(polyPath(domeOut));
  ctx.strokeStyle = shade(base, -0.16, 0.02);
  ctx.globalAlpha = 0.35;
  ctx.lineWidth = 0.012 * W;
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2;
    const n: P3 = [Math.cos(a), 0, Math.sin(a)];
    if (facingOf(r, n) < -0.1) continue;
    ctx.beginPath();
    for (let k = 0; k <= 8; k++) {
      const f = k / 8, rr = rad * Math.cos((f * Math.PI) / 2), hh = -h * Math.sin((f * Math.PI) / 2);
      const q = project(r, add(C, tilt([rr * Math.cos(a), hh, rr * 0.9 * Math.sin(a)], roll, lean)));
      if (k) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
    }
    ctx.stroke();
  }
  ctx.restore();
  /* the folded cuff, a shade lighter, with its own ribs */
  const cuffBase = shade(base, 0.05);
  felt(ctx, cuffOut, r, cuffBase, 29);
  ctx.save();
  ctx.clip(polyPath(cuffOut));
  ctx.strokeStyle = shade(base, -0.14, 0.02);
  ctx.globalAlpha = 0.4;
  ctx.lineWidth = 0.014 * W;
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * Math.PI * 2;
    if (facingOf(r, [Math.cos(a), 0, Math.sin(a)]) < 0) continue;
    const p0 = project(r, add(C, tilt([rad * 1.03 * Math.cos(a), 0.012 * W, rad * 0.93 * Math.sin(a)], roll, lean)));
    const p1 = project(r, add(C, tilt([rad * 1.03 * Math.cos(a), cuff - 0.004 * W, rad * 0.93 * Math.sin(a)], roll, lean)));
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.lineTo(p1[0], p1[1]);
    ctx.stroke();
  }
  ctx.restore();
  const tip = project(r, add(C, tilt([0, -h - 0.04 * W, 0], roll, lean)));
  pompom(ctx, tip, 0.085 * W, r, shade(base, 0.08), 31);
}

function drawParty(ctx: CanvasRenderingContext2D, r: WearRig, m: Marks, base: string, bodyClip: Path2D | null) {
  const W = m.right - m.left;
  const rad = 0.17 * W, h = 0.42 * W;
  const C: P3 = [50 + 0.06 * W, seat(m, 0.3) + 0.04 * W, 0];
  const roll = 0.18, lean = 0.1;
  const baseRing: P3[] = [];
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * Math.PI * 2;
    baseRing.push(add(C, tilt([rad * Math.cos(a), 0, rad * Math.sin(a)], roll, lean)));
  }
  const apex = add(C, tilt([0, -h, 0], roll, lean));
  const outline = hull([...baseRing, apex].map((p) => project(r, p)));
  const b = bounds(outline);
  contact(ctx, bodyClip, b.cx, b.y1, rad * 1.1, 0.04 * W, 0.26);
  const path = polyPath(outline);
  ctx.fillStyle = litFill(ctx, b, r, [
    [0, shade(base, 0.2, -0.03)],
    [0.55, base],
    [1, shade(base, -0.18, 0.03)],
  ]);
  ctx.fill(path);
  /* stripes: bands spiralling up the cone, only where they face us */
  ctx.save();
  ctx.clip(path);
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.05 * W;
  ctx.strokeStyle = 'rgba(255,255,255,0.78)';
  for (let s = 0; s < 3; s++) {
    ctx.beginPath();
    let on = false;
    for (let k = 0; k <= 40; k++) {
      const t = k / 40;
      const a = s * ((Math.PI * 2) / 3) + t * Math.PI * 2 * 1.1;
      const rr = rad * (1 - t);
      const n: P3 = [Math.cos(a), 0.35, Math.sin(a)];
      const p = add(C, tilt([rr * Math.cos(a), -h * t, rr * Math.sin(a)], roll, lean));
      const q = project(r, p);
      if (facingOf(r, n) > -0.05) {
        if (!on) { ctx.moveTo(q[0], q[1]); on = true; } else ctx.lineTo(q[0], q[1]);
      } else on = false;
    }
    ctx.stroke();
  }
  ctx.restore();
  /* the paper's shading over the stripes */
  ctx.save();
  ctx.clip(path);
  const sh = ctx.createLinearGradient(b.cx + r.lx * b.w, b.cy, b.cx - r.lx * b.w, b.cy);
  sh.addColorStop(0, 'rgba(255,255,255,0.12)');
  sh.addColorStop(0.5, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = sh;
  ctx.fill(path);
  ctx.restore();
  pompom(ctx, project(r, apex), 0.06 * W, r, '#f4efe6', 37);
}

function drawCrown(ctx: CanvasRenderingContext2D, r: WearRig, m: Marks, bodyClip: Path2D | null) {
  const W = m.right - m.left;
  const headW = Math.max(0.45 * W, m.topR - m.topL);
  const rad = 0.42 * headW + 0.04 * W, band = 0.1 * W, spike = 0.11 * W;
  const C: P3 = [50, seat(m, 0.42) + 0.05 * W, 0];
  const roll = 0.05, lean = 0.14;
  const gold = (t: number) => (t < 0.2 ? '#8a5a12' : t < 0.45 ? '#e2a93b' : t < 0.6 ? '#ffe39a' : t < 0.8 ? '#d19a2a' : '#7a4c0c');
  const at = (a: number, y: number, k = 1): P3 => add(C, tilt([rad * k * Math.cos(a), y, rad * 0.9 * k * Math.sin(a)], roll, lean));
  const Nseg = 40;
  /* the band as quads, back half first (its inside, darker), then the front */
  const quads: { p: P2[]; d: number; face: number; a: number }[] = [];
  for (let i = 0; i < Nseg; i++) {
    const a0 = (i / Nseg) * Math.PI * 2, a1 = ((i + 1) / Nseg) * Math.PI * 2, am = (a0 + a1) / 2;
    const p = [at(a0, 0), at(a1, 0), at(a1, -band), at(a0, -band)].map((q) => project(r, q));
    quads.push({ p, d: depthOf(r, at(am, -band / 2)), face: facingOf(r, [Math.cos(am), 0, Math.sin(am)]), a: am });
  }
  const b = bounds(quads.flatMap((q) => q.p));
  contact(ctx, bodyClip, b.cx, b.y1, b.w * 0.5, 0.04 * W, 0.28);
  quads.sort((x, y) => x.d - y.d);
  for (const q of quads) {
    const lit = Math.max(0, Math.min(1, 0.5 + 0.5 * (Math.cos(q.a) * r.lx * 0.8 + q.face * 0.4)));
    ctx.fillStyle = q.face < 0 ? '#6b440d' : gold(lit);
    ctx.beginPath();
    q.p.forEach((pt, i) => (i ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 0.4;
    ctx.stroke();
  }
  /* five points, each a lit triangle with a gem at its tip */
  const spikes: { d: number; draw: () => void }[] = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2 + Math.PI / 5;
    const w = (Math.PI * 2) / 10;
    const l = at(a - w * 0.9, -band), rr = at(a + w * 0.9, -band), tip = at(a, -band - spike, 0.97);
    const face = facingOf(r, [Math.cos(a), 0, Math.sin(a)]);
    spikes.push({
      d: depthOf(r, tip),
      draw: () => {
        const P = [l, tip, rr].map((q) => project(r, q));
        const bb = bounds(P);
        ctx.fillStyle = face < 0 ? '#6b440d' : litFill(ctx, bb, r, [[0, '#ffe7a3'], [0.45, '#e0a634'], [1, '#8a5a12']]);
        ctx.beginPath();
        ctx.moveTo(P[0][0], P[0][1]);
        ctx.lineTo(P[1][0], P[1][1]);
        ctx.lineTo(P[2][0], P[2][1]);
        ctx.closePath();
        ctx.fill();
        if (face > -0.2) {
          const g = project(r, tip);
          const gr = 0.022 * W;
          const gg = ctx.createRadialGradient(g[0] + r.lx * gr * 0.4, g[1] + r.ly * gr * 0.4, gr * 0.1, g[0], g[1], gr);
          const hue = i % 2 ? ['#ffd1dc', '#e0245e', '#7a0f33'] : ['#d6ecff', '#2a7de1', '#0d2f6b'];
          gg.addColorStop(0, hue[0]);
          gg.addColorStop(0.5, hue[1]);
          gg.addColorStop(1, hue[2]);
          ctx.fillStyle = gg;
          ctx.beginPath();
          ctx.arc(g[0], g[1], gr, 0, Math.PI * 2);
          ctx.fill();
        }
      },
    });
  }
  spikes.sort((x, y) => x.d - y.d).forEach((s) => s.draw());
  /* a thin bright line along the band's top edge, the metal's highlight */
  ctx.save();
  ctx.strokeStyle = 'rgba(255,245,210,0.75)';
  ctx.lineWidth = 0.012 * W;
  ctx.beginPath();
  let on = false;
  for (let i = 0; i <= Nseg; i++) {
    const a = (i / Nseg) * Math.PI * 2;
    const q = project(r, at(a, -band * 0.08));
    if (facingOf(r, [Math.cos(a), 0, Math.sin(a)]) > 0) {
      if (!on) { ctx.moveTo(q[0], q[1]); on = true; } else ctx.lineTo(q[0], q[1]);
    } else on = false;
  }
  ctx.stroke();
  ctx.restore();
}

/* ── headphones ─────────────────────────────────────────────────────── */

function drawCup(ctx: CanvasRenderingContext2D, r: WearRig, m: Marks, side: -1 | 1, base: string) {
  const W = m.right - m.left;
  const rc = 0.15 * W, tc = 0.11 * W, pad = 0.045 * W;
  const x0 = side < 0 ? m.left + 0.03 * W : m.right - 0.03 * W;
  const yc = m.mid - 0.1 * W;
  /* a disc with rounded edges, its axis across the head: rings through
     its thickness, each a little smaller toward the faces */
  const disc = (xFrom: number, thick: number, radius: number, bevel: number): P3[] => {
    const out: P3[] = [];
    for (let s = 0; s <= 6; s++) {
      const t = s / 6, e = 2 * t - 1;
      const rr = radius * (1 - bevel * e * e * e * e);
      const x = xFrom + side * thick * t;
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        out.push([x, yc + rr * Math.cos(a), rr * Math.sin(a)]);
      }
    }
    return out;
  };
  /* the cushion against the head: soft, a little lighter */
  const cushion = hull(disc(x0 - side * 0.01 * W, pad, rc * 0.96, 0.35).map((p) => project(r, p)));
  const cb = bounds(cushion);
  ctx.fillStyle = litFill(ctx, cb, r, [[0, shade(base, 0.2)], [0.5, shade(base, 0.08)], [1, shade(base, -0.06)]]);
  ctx.fill(polyPath(cushion));
  /* the cup: hard, a little glossy */
  const cupPts = disc(x0 + side * pad * 0.8, tc, rc, 0.28);
  const cup = hull(cupPts.map((p) => project(r, p)));
  const b = bounds(cup);
  ctx.fillStyle = litFill(ctx, b, r, [[0, shade(base, 0.16)], [0.45, base], [1, shade(base, -0.1)]]);
  ctx.fill(polyPath(cup));
  ctx.save();
  ctx.clip(polyPath(cup));
  /* round it across: brighter through the middle of its height, darker
     top and bottom, as a thick disc seen edge-on is */
  const v = ctx.createLinearGradient(b.cx, b.y0, b.cx, b.y1);
  v.addColorStop(0, 'rgba(0,0,0,0.35)');
  v.addColorStop(0.3, 'rgba(255,255,255,0.08)');
  v.addColorStop(0.55, 'rgba(255,255,255,0.03)');
  v.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = v;
  ctx.fillRect(b.x0 - 1, b.y0 - 1, b.w + 2, b.h + 2);
  /* the outer face, when it turns toward us: a lighter disc */
  const f = facingOf(r, [side, 0, 0]);
  if (f > 0) {
    const o: P2[] = [];
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      o.push(project(r, [x0 + side * (pad * 0.8 + tc), yc + rc * 0.74 * Math.cos(a), rc * 0.74 * Math.sin(a)]));
    }
    const ob = bounds(o);
    ctx.globalAlpha = Math.min(1, f * 2.5);
    const g = ctx.createRadialGradient(ob.cx + r.lx * ob.w * 0.25, ob.cy - ob.h * 0.2, 0, ob.cx, ob.cy, Math.max(ob.w, ob.h) * 0.65);
    g.addColorStop(0, shade(base, 0.18));
    g.addColorStop(1, shade(base, -0.02));
    ctx.fillStyle = g;
    ctx.fill(polyPath(o));
    ctx.globalAlpha = 1;
  }
  /* a gloss line down the lit side */
  const hx = b.cx + r.lx * b.w * 0.28;
  const hl = ctx.createLinearGradient(hx, b.y0, hx, b.y1);
  hl.addColorStop(0, 'rgba(255,255,255,0)');
  hl.addColorStop(0.35, 'rgba(255,255,255,0.3)');
  hl.addColorStop(0.65, 'rgba(255,255,255,0.12)');
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.strokeStyle = hl;
  ctx.lineWidth = Math.max(0.6, b.w * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(hx, b.y0 + b.h * 0.18);
  ctx.lineTo(hx, b.y1 - b.h * 0.18);
  ctx.stroke();
  ctx.restore();
}

function drawBand(ctx: CanvasRenderingContext2D, r: WearRig, m: Marks, base: string) {
  const W = m.right - m.left;
  const yc = m.mid - 0.1 * W - 0.1 * W;
  const ax = (m.right - m.left) / 2 + 0.05 * W, ay = yc - (m.top - 0.035 * W);
  const pts: P2[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = Math.PI + (i / 32) * Math.PI;
    pts.push(project(r, [50 + ax * Math.cos(t), yc + ay * Math.sin(t), 0]));
  }
  const b = bounds(pts);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = litFill(ctx, b, r, [[0, shade(base, 0.12)], [0.5, base], [1, shade(base, -0.1)]]);
  ctx.lineWidth = 0.075 * W;
  ctx.stroke(polyPath(pts, false));
  /* the padded underside and a highlight along the top */
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.lineWidth = 0.018 * W;
  const top = pts.map(([x, y]) => [x, y - 0.022 * W] as P2);
  ctx.stroke(polyPath(top, false));
  ctx.restore();
}

/* ── the bow tie ────────────────────────────────────────────────────── */

function drawBowTie(ctx: CanvasRenderingContext2D, r: WearRig, m: Marks, base: string, zFront: number, bodyClip: Path2D | null, face: { y: number; scale: number }) {
  if (r.facing < 0.05) return;
  const W = m.right - m.left;
  /* under the face, clear of anything worn on it, and small enough to fit
     between the face and the bottom — a low face (a triangle's) gets a
     smaller bow */
  const clear = face.y + 22 * face.scale;
  const cyB = Math.max(clear, m.bottom - 0.15 * W);
  const room = Math.max(0, m.bottom - 3 - cyB);
  const k = Math.min(W, 100) * Math.max(0.5, Math.min(1, room / 15));
  /* in the bow's own plane, in fractions of the body's width: x across,
     y down; the projection is affine, so control points map exactly */
  const P = (x: number, y: number): P2 => project(r, [50 + x * k, cyB + y * k, zFront]);
  const wing = (dir: -1 | 1): Path2D => {
    const q = (x: number, y: number) => P(dir * x, y);
    const p = new Path2D();
    const a = q(0.06, -0.05), b = q(0.33, -0.15), c = q(0.3, 0), d = q(0.33, 0.15), e = q(0.06, 0.05);
    const c1 = q(0.17, -0.07), c2 = q(0.27, -0.17);
    const c3 = q(0.36, -0.08), c4 = q(0.36, 0.08);
    const c5 = q(0.27, 0.17), c6 = q(0.17, 0.07);
    p.moveTo(a[0], a[1]);
    p.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], b[0], b[1]);
    p.quadraticCurveTo(c3[0], c3[1], c[0], c[1]);
    p.quadraticCurveTo(c4[0], c4[1], d[0], d[1]);
    p.bezierCurveTo(c5[0], c5[1], c6[0], c6[1], e[0], e[1]);
    p.closePath();
    return p;
  };
  const ends = [P(-0.36, -0.18), P(0.36, 0.18)];
  const bb = bounds([...ends, P(-0.36, 0.18), P(0.36, -0.18)]);
  if (bodyClip) {
    const sh = P(0.01, 0.07);
    contact(ctx, bodyClip, sh[0], sh[1], bb.w * 0.52, bb.h * 0.45, 0.24);
  }
  for (const dir of [-1, 1] as const) {
    const w = wing(dir);
    const wb = bounds([P(dir * 0.06, -0.15), P(dir * 0.36, 0.15)]);
    ctx.fillStyle = litFill(ctx, wb, r, [[0, shade(base, 0.2)], [0.45, base], [1, shade(base, -0.12)]]);
    ctx.fill(w);
    ctx.save();
    ctx.clip(w);
    /* satin folds gathering toward the knot */
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 0.011 * W;
    ctx.lineCap = 'round';
    for (const fy of [-0.06, 0.06]) {
      const a = P(dir * 0.08, fy * 0.4), c = P(dir * 0.2, fy * 1.25), d = P(dir * 0.3, fy * 1.6);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.quadraticCurveTo(c[0], c[1], d[0], d[1]);
      ctx.stroke();
    }
    /* the sheen along the upper edge, and a darker lower edge */
    ctx.strokeStyle = 'rgba(255,255,255,0.24)';
    ctx.lineWidth = 0.022 * W;
    const u0 = P(dir * 0.09, -0.07), u1 = P(dir * 0.2, -0.1), u2 = P(dir * 0.31, -0.13);
    ctx.beginPath();
    ctx.moveTo(u0[0], u0[1]);
    ctx.quadraticCurveTo(u1[0], u1[1], u2[0], u2[1]);
    ctx.stroke();
    ctx.restore();
  }
  /* the knot: a rounded quad, puffed, lit */
  const kn = [P(-0.065, -0.07), P(0.065, -0.07), P(0.075, 0.07), P(-0.075, 0.07)];
  const kb = bounds(kn);
  ctx.fillStyle = litFill(ctx, kb, r, [[0, shade(base, 0.24)], [0.5, shade(base, 0.05)], [1, shade(base, -0.1)]]);
  const rr = 0.025 * W;
  ctx.beginPath();
  ctx.moveTo((kn[0][0] + kn[1][0]) / 2, (kn[0][1] + kn[1][1]) / 2);
  for (let i = 1; i <= 4; i++) {
    const c = kn[i % 4], d = kn[(i + 1) % 4];
    ctx.arcTo(c[0], c[1], d[0], d[1], rr);
  }
  ctx.closePath();
  ctx.fill();
}

/* ── glasses: in face space, on the eyes ────────────────────────────── */

export interface EyeSpot {
  x: number;
  y: number;
  sx: number;
  sy: number;
  z: number;
}

/** Glasses over two eye spots (face space, already placed on the face's
    sphere), `lens` the eye-lens radius in face units. Drawn after the face,
    unclipped, with a soft shadow on the face laid first (clipped by the
    caller's face clip through `shadow`). */
export function drawGlasses(
  ctx: CanvasRenderingContext2D,
  kind: BotAvatarGlasses,
  eyes: [EyeSpot, EyeSpot],
  light: { lx: number; ly: number },
  pass: 'shadow' | 'frame'
) {
  if (kind === 'none') return;
  const R = kind === 'square' ? 11.5 : 11;
  const frame = '#161618';
  const lens = (e: EyeSpot, path: (c: CanvasRenderingContext2D) => void) => {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.scale(Math.max(0.05, e.sx), Math.max(0.05, e.sy));
    path(ctx);
    ctx.restore();
  };
  const shape = (c: CanvasRenderingContext2D) => {
    c.beginPath();
    if (kind === 'round') c.arc(0, 0, R, 0, Math.PI * 2);
    else {
      const w = kind === 'shades' ? 12.5 : 12, h = kind === 'shades' ? 10 : 9.5, rr = kind === 'shades' ? 5 : 4;
      c.roundRect(-w, -h, 2 * w, 2 * h, rr);
    }
  };
  const vis = eyes.map((e) => Math.max(0, Math.min(1, (e.z - 0.18) * 3.2)));
  if (pass === 'shadow') {
    for (let i = 0; i < 2; i++) {
      if (vis[i] <= 0) continue;
      const e = eyes[i];
      ctx.save();
      ctx.globalAlpha = 0.22 * vis[i];
      ctx.translate(-light.lx * 1.6, -light.ly * 1.6 + 0.8);
      lens(e, (c) => {
        shape(c);
        c.lineWidth = 3;
        c.strokeStyle = '#000';
        c.stroke();
      });
      ctx.restore();
    }
    return;
  }
  /* the bridge between the two rims */
  const a = eyes[0], b = eyes[1];
  if (Math.min(vis[0], vis[1]) > 0) {
    const ax = a.x + R * 0.95 * a.sx, bx = b.x - R * 0.95 * b.sx;
    const yy = (a.y + b.y) / 2 - R * 0.35;
    ctx.save();
    ctx.globalAlpha = Math.min(vis[0], vis[1]);
    ctx.strokeStyle = frame;
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(ax, yy + 1.2);
    ctx.quadraticCurveTo((ax + bx) / 2, yy - 2.6, bx, yy + 1.2);
    ctx.stroke();
    ctx.restore();
  }
  for (let i = 0; i < 2; i++) {
    if (vis[i] <= 0) continue;
    const e = eyes[i];
    ctx.save();
    ctx.globalAlpha = vis[i];
    /* the glass: clear with a faint tint and a diagonal glint, or dark for shades */
    lens(e, (c) => {
      shape(c);
      if (kind === 'shades') {
        const g = c.createLinearGradient(-R, -R, R, R);
        g.addColorStop(0, 'rgba(40,40,48,0.96)');
        g.addColorStop(1, 'rgba(8,8,12,0.98)');
        c.fillStyle = g;
      } else c.fillStyle = 'rgba(210,230,255,0.1)';
      c.fill();
      c.save();
      c.clip();
      c.globalAlpha = kind === 'shades' ? 0.5 : 0.35;
      c.fillStyle = '#fff';
      c.beginPath();
      c.moveTo(-R * 0.9, -R * 0.2);
      c.lineTo(-R * 0.2, -R * 0.95);
      c.lineTo(R * 0.15, -R * 0.95);
      c.lineTo(-R * 0.9, R * 0.3);
      c.closePath();
      c.fill();
      c.restore();
      /* the rim: dark, a rounded wire with a light edge toward the light */
      shape(c);
      c.lineWidth = kind === 'round' ? 2.3 : 2.6;
      c.strokeStyle = frame;
      c.stroke();
      c.save();
      c.translate(light.lx * 0.6, light.ly * 0.6);
      shape(c);
      c.lineWidth = 0.7;
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.stroke();
      c.restore();
    });
    ctx.restore();
  }
}

/* ── the pass entry points ──────────────────────────────────────────── */

/** Behind the body: the far headphone cup once the head turns it away. */
export function drawWearBehind(ctx: CanvasRenderingContext2D, path: Path2D, r: WearRig, wear: Wear) {
  if (!wear.headphones) return;
  const m = marksFor(path);
  if (!m) return;
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? m.left : m.right;
    if (depthOf(r, [x, m.mid, 0]) < -2) drawCup(ctx, r, m, side, wear.color);
  }
}

/** Over the body: the hat, the band and the near cups, the bow tie. The
    `bodyClip` is the body's front outline, for the shadows things cast on it. */
export function drawWearFront(
  ctx: CanvasRenderingContext2D,
  path: Path2D,
  r: WearRig,
  wear: Wear,
  bodyClip: Path2D | null,
  zFront: number,
  face: { y: number; scale: number }
) {
  const m = marksFor(path);
  if (!m) return;
  if (wear.bowTie) drawBowTie(ctx, r, m, wear.color, zFront, bodyClip, face);
  if (wear.headphones) {
    drawBand(ctx, r, m, wear.color);
    for (const side of [-1, 1] as const) {
      const x = side < 0 ? m.left : m.right;
      if (depthOf(r, [x, m.mid, 0]) >= -2) drawCup(ctx, r, m, side, wear.color);
    }
  }
  switch (wear.hat) {
    case 'beret':
      drawBeret(ctx, r, m, wear.color, bodyClip);
      break;
    case 'beanie':
      drawBeanie(ctx, r, m, wear.color, bodyClip);
      break;
    case 'party':
      drawParty(ctx, r, m, wear.color, bodyClip);
      break;
    case 'crown':
      drawCrown(ctx, r, m, bodyClip);
      break;
  }
}
