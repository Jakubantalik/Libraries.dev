/* plastic.ts — the per-texel materials, 'plastic' (a glossy toy plastic)
   and 'fabric' (a plush pile), and the inflated body they are drawn on.

   Once per outline (× texture size × depth) the outline is rasterised into
   a small grid and turned into a FORM: a signed distance, a pillow height
   field (the torsion function of the outline, so lobes are domes, rays
   are tubes and there is no crease), its normals, and baked ambient
   occlusion. Per frame the light and the view are rotated into the body's
   own frame; a small MATCAP (a lit sphere: one colour per normal) is
   evaluated with the full material — only when the light or the view has
   moved — and the texels are a bilinear lookup into it. The body is that
   lit texture drawn as a relief: the height field's level sets stacked
   back to front, each shifted by its own depth, so the body is inflated —
   round from the side as well as from the front — rather than extruded.

   Everything is canvas 2D: Path2D fills, gradients, ImageData, one small
   scratch canvas per texture size. No ctx.filter, no WebGL. */

import type { DrawConfig } from './draw';
import { parseColor } from './color';

/* ── constants ─────────────────────────────────────────────────────── */

/** The texture covers design units [-PAD, 100 + PAD]. */
export const PAD = 3;
export const SPAN = 100 + 2 * PAD;
/** Matcap side: (nx, ny) ∈ [-1, 1]² in M × M cells. */
const M = 64;
/** the matcap's side, in cells */
export const MATCAP_SIZE = M;
const MM = M * M;
/** Stops on the conic side gradients. */
const CONIC_STOPS = 24;
const INF = 1e12;
/** Light elevation off the screen plane. */
const EL = (48 * Math.PI) / 180;
const E_XY = Math.cos(EL), E_Z = Math.sin(EL);

type V3 = [number, number, number];

/* ── the form: per outline, once ───────────────────────────────────── */

export interface Form {
  N: number;
  /** bilinear cell in the matcap: index of the top-left cell … */
  i00: Uint16Array;
  /** … and the weights inside it, 0–255 */
  wx: Uint8Array;
  wy: Uint8Array;
  /** baked occlusion × edge darkening, gamma-compensated, 0–255; 0 = not drawn */
  ao: Uint8Array;
  /** signed distance to the outline in design units (positive inside) and
      the pillow height: kept for the fabric's fibres, which grow down the
      slope of the height and out past the edge */
  sd: Float32Array;
  h: Float32Array;
}

/* Felzenszwalb–Huttenlocher 1-D squared distance transform; s gets the
   index of the nearest site. */
function edt1d(f: Float32Array, n: number, d: Float32Array, s: Int32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e30;
  z[1] = 1e30;
  for (let q = 1; q < n; q++) {
    let x = 0;
    for (;;) {
      const vk = v[k];
      x = (f[q] + q * q - f[vk] - vk * vk) / (2 * (q - vk));
      if (x > z[k]) break;
      k--;
    }
    k++;
    v[k] = q;
    z[k] = x;
    z[k + 1] = 1e30;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const vk = v[k];
    d[q] = (q - vk) * (q - vk) + f[vk];
    s[q] = vk;
  }
}

/* Squared texel distance from every texel to the nearest texel whose
   mask equals `site`, and (optionally) that texel's index. */
function edt2d(mask: Uint8Array, site: number, N: number, out: Float32Array, near: Int32Array | null) {
  const f = new Float32Array(N), d = new Float32Array(N), s = new Int32Array(N), v = new Int32Array(N), z = new Float32Array(N + 1);
  const g = new Float32Array(N * N), row = new Int32Array(N * N);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) f[y] = mask[y * N + x] === site ? 0 : INF;
    edt1d(f, N, d, s, v, z);
    for (let y = 0; y < N; y++) {
      g[y * N + x] = d[y];
      row[y * N + x] = s[y];
    }
  }
  for (let y = 0; y < N; y++) {
    const o = y * N;
    for (let x = 0; x < N; x++) f[x] = g[o + x];
    edt1d(f, N, d, s, v, z);
    for (let x = 0; x < N; x++) {
      out[o + x] = d[x];
      if (near) near[o + x] = row[o + s[x]] * N + s[x];
    }
  }
}

/* Separable binomial blur [1 4 6 4 1]/16, edges clamped. */
function blur5(a: Float32Array, N: number, tmp: Float32Array) {
  for (let y = 0; y < N; y++) {
    const o = y * N;
    for (let x = 0; x < N; x++) {
      const x0 = x < 2 ? 0 : x - 2, x1 = x < 1 ? 0 : x - 1, x3 = x > N - 2 ? N - 1 : x + 1, x4 = x > N - 3 ? N - 1 : x + 2;
      tmp[o + x] = (a[o + x0] + 4 * a[o + x1] + 6 * a[o + x] + 4 * a[o + x3] + a[o + x4]) * 0.0625;
    }
  }
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      const y0 = y < 2 ? 0 : y - 2, y1 = y < 1 ? 0 : y - 1, y3 = y > N - 2 ? N - 1 : y + 1, y4 = y > N - 3 ? N - 1 : y + 2;
      a[y * N + x] = (tmp[y0 * N + x] + 4 * tmp[y1 * N + x] + 6 * tmp[y * N + x] + 4 * tmp[y3 * N + x] + tmp[y4 * N + x]) * 0.0625;
    }
  }
}

/* Δφ = −1 on the inside texels, φ = 0 outside: Gauss–Seidel with
   over-relaxation, cascaded from a quarter-size grid so the smooth part
   converges cheaply and the fine sweeps only settle the boundary. */
function poisson(cov: Uint8Array | Uint8ClampedArray, N: number, u: number): Float32Array {
  const levels: { n: number; mask: Uint8Array; phi: Float32Array }[] = [];
  for (let n = N, f = 1; f <= 4 && n % 2 === 0 || f === 1; n >>= 1, f <<= 1) {
    const mask = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let sum = 0;
        for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) sum += cov[(y * f + j) * N + x * f + i];
        mask[y * n + x] = sum >= 128 * f * f ? 1 : 0;
      }
    }
    levels.push({ n, mask, phi: new Float32Array(n * n) });
    if (f === 4) break;
  }
  const sweep = (L: { n: number; mask: Uint8Array; phi: Float32Array }, s: number, iters: number, om: number) => {
    const { n, mask, phi } = L, s2 = s * s;
    for (let it = 0; it < iters; it++) {
      for (let y = 1; y < n - 1; y++) {
        const o = y * n;
        for (let x = 1; x < n - 1; x++) {
          const i = o + x;
          if (!mask[i]) continue;
          const v = (phi[i - 1] + phi[i + 1] + phi[i - n] + phi[i + n] + s2) * 0.25;
          phi[i] += om * (v - phi[i]);
        }
      }
    }
  };
  for (let l = levels.length - 1; l >= 0; l--) {
    const L = levels[l], f = 1 << l;
    if (l < levels.length - 1) {
      /* bilinear prolongation from the coarser level */
      const C = levels[l + 1], n = L.n, cn = C.n;
      for (let y = 0; y < n; y++) {
        const fy = Math.min(cn - 1, Math.max(0, (y + 0.5) / 2 - 0.5)), y0 = fy | 0, y1 = Math.min(cn - 1, y0 + 1), ty = fy - y0;
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          if (!L.mask[i]) continue;
          const fx = Math.min(cn - 1, Math.max(0, (x + 0.5) / 2 - 0.5)), x0 = fx | 0, x1 = Math.min(cn - 1, x0 + 1), tx = fx - x0;
          L.phi[i] = (C.phi[y0 * cn + x0] * (1 - tx) + C.phi[y0 * cn + x1] * tx) * (1 - ty) + (C.phi[y1 * cn + x0] * (1 - tx) + C.phi[y1 * cn + x1] * tx) * ty;
        }
      }
    }
    /* over-relaxation converges the smooth part; plain sweeps before and
       after smooth the kinks the prolongation leaves (SOR near ω = 2 does
       not damp them, and the normals would show them as seams) */
    const om = Math.min(1.9, 2 / (1 + Math.sin(Math.PI / L.n)) - 0.05);
    sweep(L, u * f, 4, 1);
    sweep(L, u * f, l === 2 ? 100 : l === 1 ? 30 : 16, om);
    sweep(L, u * f, 8, 1);
  }
  return levels[0].phi;
}

const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];
const DL = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

/**
 * The form of one outline from its coverage raster (N × N, 0–255, over
 * design units [-PAD, 100 + PAD]): a pillow height field, its normals as
 * matcap cells, and baked occlusion; outside texels near the edge borrow
 * their nearest inside texel so upscaling never bleeds transparent black.
 */
export function buildForm(cov: Uint8Array | Uint8ClampedArray, N: number, halfDepth: number): Form {
  const u = SPAN / N, NN = N * N;
  const mask = new Uint8Array(NN);
  for (let i = 0; i < NN; i++) mask[i] = cov[i] >= 128 ? 1 : 0;

  /* signed distance to the outline, in design units, positive inside;
     antialiased edge texels give the sub-texel offset */
  const dIn = new Float32Array(NN), dOut = new Float32Array(NN), nearIn = new Int32Array(NN);
  edt2d(mask, 0, N, dIn, null);
  edt2d(mask, 1, N, dOut, nearIn);
  const sd = new Float32Array(NN), tmp = new Float32Array(NN);
  for (let i = 0; i < NN; i++) {
    const a = cov[i] / 255;
    sd[i] = u * (a > 0 && a < 1 ? a - 0.5 : mask[i] ? Math.sqrt(dIn[i]) - 0.5 : 0.5 - Math.sqrt(dOut[i]));
  }
  /* round the medial-axis crease into a ridge (σ ≈ 2.2 texels) */
  blur5(sd, N, tmp);
  blur5(sd, N, tmp);

  /* the pillow: the torsion function, Δφ = −1 inside and φ = 0 outside.
     It has no medial-axis crease; √φ is an elliptical dome over a disc, a
     round tube along a thin ray, a smooth cushion over a square, and a
     valley between two lobes. Its height follows the body's inradius, so
     thin parts are their own low tubes. */
  const phi = poisson(cov, N, u);
  let phiMax = 0;
  for (let i = 0; i < NN; i++) if (phi[i] > phiMax) phiMax = phi[i];
  const rIn = 2 * Math.sqrt(phiMax);
  /* a toy is puffed up well past its own thickness: the height grows with
     the depth asked for and with how wide the shape is inside */
  const hMax = Math.min(1.5 * halfDepth + 0.32 * rIn, 1.4 * rIn);
  const kh = phiMax > 0 ? hMax / Math.sqrt(phiMax) : 0;
  const h = new Float32Array(NN);
  for (let i = 0; i < NN; i++) h[i] = phi[i] > 0 ? kh * Math.sqrt(phi[i]) : 0;
  blur5(h, N, tmp);

  /* normals, silhouette fix, horizon AO, matcap cells */
  const form: Form = { N, i00: new Uint16Array(NN), wx: new Uint8Array(NN), wy: new Uint8Array(NN), ao: new Uint8Array(NN), sd, h };
  const { i00, wx, wy, ao } = form;
  const STEPS = N <= 64 ? [1, 2, 3, 5, 8] : N <= 96 ? [1, 2, 4, 7, 11] : [1, 2, 4, 7, 11, 15];
  const halo = 64; // outside texels within 8 texels borrow their nearest inside texel (fabric's fringe reaches that far)
  const last = N - 1;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x;
      const src = mask[i] ? i : dOut[i] <= halo ? nearIn[i] : -1;
      if (src < 0) continue;
      const sx = src % N, sy = (src - sx) / N;
      const xl = sx > 0 ? sx - 1 : 0, xr = sx < last ? sx + 1 : last, yu = sy > 0 ? sy - 1 : 0, yd = sy < last ? sy + 1 : last;
      let nx = -(h[sy * N + xr] - h[sy * N + xl]) / (2 * u);
      let ny = -(h[yd * N + sx] - h[yu * N + sx]) / (2 * u);
      let nz = 1;
      let len = Math.sqrt(nx * nx + ny * ny + 1);
      nx /= len; ny /= len; nz /= len;
      const dd = Math.max(0, sd[src]);
      if (dd < 2) {
        /* toward the in-plane outward direction, so the silhouette grazes */
        let gx = sd[sy * N + xr] - sd[sy * N + xl], gy = sd[yd * N + sx] - sd[yu * N + sx];
        const gl = Math.hypot(gx, gy) || 1;
        gx /= gl; gy /= gl;
        const w = 0.7 * (1 - dd / 2);
        nx += w * (-gx - nx); ny += w * (-gy - ny); nz += w * (0 - nz);
        len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        nx /= len; ny /= len; nz /= len;
      }
      /* horizon-based occlusion on the height field */
      const h0 = h[src];
      let occ = 0;
      for (let d = 0; d < 8; d++) {
        let m = 0;
        for (let k = 0; k < STEPS.length; k++) {
          const r = STEPS[k];
          let qx = sx + DX[d] * r, qy = sy + DY[d] * r;
          if (qx < 0) qx = 0; else if (qx > last) qx = last;
          if (qy < 0) qy = 0; else if (qy > last) qy = last;
          const t = (h[qy * N + qx] - h0) / (r * u * DL[d]);
          if (t > m) m = t;
        }
        occ += m / Math.sqrt(1 + m * m);
      }
      const e = 1 - Math.min(1, dd / 3);
      const edge = 1 - 0.2 * e * e;
      const aoLin = Math.pow(1 - 0.9 * occ / 8, 1.5) * edge;
      ao[i] = Math.max(1, Math.round(255 * Math.pow(aoLin, 1 / 2.2)));
      const fx = (nx * 0.5 + 0.5) * (M - 1), fy = (ny * 0.5 + 0.5) * (M - 1);
      const cx = Math.min(M - 2, Math.max(0, fx | 0)), cy = Math.min(M - 2, Math.max(0, fy | 0));
      i00[i] = cy * M + cx;
      wx[i] = Math.round(255 * Math.min(1, Math.max(0, fx - cx)));
      wy[i] = Math.round(255 * Math.min(1, Math.max(0, fy - cy)));
    }
  }
  return form;
}

/* ── canvases and the raster ───────────────────────────────────────── */

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
function makeCanvas(n: number): AnyCanvas | null {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(n, n);
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = c.height = n;
    return c;
  }
  return null;
}
function ctx2d(c: AnyCanvas, readBack: boolean): CanvasRenderingContext2D | null {
  return (c as HTMLCanvasElement).getContext('2d', readBack ? { willReadFrequently: true } : undefined) as CanvasRenderingContext2D | null;
}

/** Coverage raster of the outline: N × N over design units [-PAD, 100 + PAD]. */
export function rasterize(path: Path2D, N: number): Uint8ClampedArray | null {
  const c = makeCanvas(N);
  const g = c && ctx2d(c, true);
  if (!g) return null;
  const u = SPAN / N;
  g.setTransform(1 / u, 0, 0, 1 / u, PAD / u, PAD / u);
  g.fillStyle = '#fff';
  g.fill(path);
  const px = g.getImageData(0, 0, N, N).data;
  const cov = new Uint8ClampedArray(N * N);
  for (let i = 0; i < N * N; i++) cov[i] = px[i * 4 + 3];
  return cov;
}

/* the shared scratch canvases, one per texture size */

/* ── the form cache, with deferred builds ──────────────────────────── */

const forms = new Map<string, Form>();
const pending = new Set<string>();
const pathIds = new WeakMap<Path2D, string>();
let nextPathId = 0;
function pathId(p: Path2D): string {
  let id = pathIds.get(p);
  if (!id) pathIds.set(p, (id = `p${nextPathId++}`));
  return id;
}
/* bakes run one per idle slot (or one per timeout where there is no
   requestIdleCallback, as in Safari), so a page full of types never
   stacks all of them into one frame */
const queue: (() => void)[] = [];
let scheduled = false;
/* one task at least, then as many more as the idle period has room for.
   A page busy drawing a dozen avatars may never idle at all, and every
   callback is then forced by its timeout: those (and the timers where
   there is no requestIdleCallback) run steps for a few ms rather than
   just the one, or a row of fur would take a minute to land */
const FORCED_MS = 6;
const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
function pump(deadline?: { timeRemaining(): number; didTimeout?: boolean }) {
  scheduled = false;
  const t0 = clock();
  let fn = queue.shift();
  while (fn) {
    fn();
    const room = deadline && !deadline.didTimeout ? deadline.timeRemaining() - 6 : FORCED_MS - (clock() - t0);
    if (room <= 0) break;
    fn = queue.shift();
  }
  if (queue.length) schedule();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  const ric = (globalThis as { requestIdleCallback?: (cb: (d: { timeRemaining(): number; didTimeout?: boolean }) => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(pump, { timeout: 60 });
  else setTimeout(() => pump(), 24);
}
function idle(fn: () => void) {
  queue.push(fn);
  schedule();
}
/* A still avatar that stood in for a form or a pile still baking is
   drawn again as bakes land: no animation frame will come to show it.
   Draws note a stand-in in `missed`; the caller reads it right after. */
const landed = new Set<() => void>();
let missed = false;
let landing = false;
/* soon, but never inside the draw or bake that landed it */
function land() {
  if (landing || !landed.size) return;
  landing = true;
  setTimeout(() => {
    landing = false;
    for (const fn of [...landed]) fn();
  }, 0);
}
/** Call `fn` each time a form or a pile lands, until the returned function is called. */
export function onLanded(fn: () => void): () => void {
  landed.add(fn);
  return () => {
    landed.delete(fn);
  };
}
/** Whether a draw since the last call stood in for a bake still under way (and clear it). */
export function takeMissed(): boolean {
  const m = missed;
  missed = false;
  return m;
}
/** The form for an outline, built now (`sync`) or on idle time (null until then). */
function formFor(key: string, path: Path2D, N: number, halfDepth: number, sync: boolean): Form | null {
  const id = `${key}|${N}|${Math.round(halfDepth)}`;
  const hit = forms.get(id);
  if (hit) return hit;
  const build = () => {
    pending.delete(id);
    if (forms.has(id)) return;
    const cov = rasterize(path, N);
    if (!cov) return;
    if (forms.size >= 48) forms.clear();
    forms.set(id, buildForm(cov, N, halfDepth));
    land();
  };
  if (sync) {
    build();
    return forms.get(id) ?? null;
  }
  if (!pending.has(id)) {
    pending.add(id);
    idle(build);
  }
  missed = true;
  return null;
}
/** Build a form ahead of time (call from an idle callback at mount). */
export function warmPlastic(key: string, path: Path2D, devicePx = 192, depth = 0.65, fabric = false, style: FurStyle = FUR_STOCK, light = 295, lights?: FurLights) {
  const form = formFor(key, path, tierFor(devicePx), 15 * depth, true);
  if (fabric && form) {
    /* toward the light on screen. The pile is queued as idle steps rather
       than baked here in one long task. */
    const a = (light * Math.PI) / 180;
    furReady(form, key, 15 * depth, Math.ceil((SPAN * devicePx) / 100), false, Math.sin(a), -Math.cos(a), style, lights ?? stockLights(Math.sin(a), -Math.cos(a)));
  }
}
/** Texture size for an avatar `devicePx` wide (CSS px × device pixel ratio). */
export function tierFor(devicePx: number): number {
  return devicePx <= 100 ? 64 : devicePx <= 224 ? 96 : 128;
}

/* ── the profile: an inflated body, not an extruded one ────────────── */

/* A toy is an inflated shape: thickest in the middle and rounding off to
   nothing at its outline all round, like a cushion — not an outline
   pushed back into a slab with a wall for a side. The body's slices
   through its depth follow the height field: at each depth the slice is
   the outline scaled to the area and centre of where the surface stands
   at least that high, so the side silhouette is the cushion's own round
   profile. `round` bends the profile from that cushion (1) toward a slab
   with softened edges (0). Measured once per form, count and roundness. */
export interface Relief {
  /** the surface's highest point, in design units from the centre plane */
  top: number;
  /** each level's depth from the centre plane, in design units; level 0
      is the outline itself, at the centre */
  z: Float32Array;
  /** each level's region as the outline scaled about its centre: the
      scale (by area) and the centre it moves to — the far half is drawn so,
      from sprites of the outline */
  scale: Float32Array;
  cx: Float32Array;
  cy: Float32Array;
  /** how far in from the outline each level's edge lies, in design units:
      where on the front's texture its side's light is */
  inset: Float32Array;
  /** the exponent the levels were cut with: a point of height h stands at
      depth top·(h/top)^q */
  q: number;
}
const reliefs = new WeakMap<Form, Map<string, Relief>>();

export function reliefFor(form: Form, K: number, round: number): Relief {
  const q = Math.max(0.05, Math.min(1, round));
  const key = `${K}|${q.toFixed(2)}`;
  let byKey = reliefs.get(form);
  if (!byKey) reliefs.set(form, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit) return hit;
  const { N, h, sd } = form;
  let top = 0;
  for (let i = 0; i < N * N; i++) if (h[i] > top) top = h[i];
  const u = SPAN / N;
  const z = new Float32Array(K);
  const scale = new Float32Array(K), cx = new Float32Array(K), cy = new Float32Array(K), inset = new Float32Array(K);
  inset[0] = 1.2;
  /* a level's area and centre, in texels */
  const measure = (inside: (i: number) => boolean): [number, number, number] => {
    let n = 0, sx = 0, sy = 0;
    for (let j = 0, i = 0; j < N; j++) for (let x = 0; x < N; x++, i++) if (inside(i)) (n += 1), (sx += x), (sy += j);
    return n ? [n, ((sx / n + 0.5) * u) - PAD, ((sy / n + 0.5) * u) - PAD] : [0, 50, 50];
  };
  const [a0, x0, y0] = measure((i) => sd[i] >= 0);
  scale[0] = 1;
  cx[0] = x0;
  cy[0] = y0;
  for (let k = 1; k < K; k++) {
    const s = k / K;
    z[k] = top * s;
    /* level k holds every point that stands at depth top·s or more */
    const tau = top * Math.pow(s, 1 / q);
    /* inside the outline only (the height is blurred a little past it),
       and never larger than the level before */
    const [ak, xk, yk] = measure((i) => sd[i] >= 0 && h[i] >= tau);
    scale[k] = Math.min(scale[k - 1], a0 ? Math.sqrt(ak / a0) : 1);
    cx[k] = xk;
    cy[k] = yk;
    /* the mean distance in from the outline of the texels on the level's edge */
    const band = top / (2 * K);
    let n = 0, sum = 0;
    for (let i = 0; i < N * N; i++) {
      if (sd[i] > 0 && Math.abs(h[i] - tau) < band) {
        sum += sd[i];
        n++;
      }
    }
    inset[k] = Math.max(inset[k - 1], n ? sum / n : inset[k - 1]);
  }
  const r: Relief = { top, z, q, scale, cx, cy, inset };
  if (byKey.size > 6) byKey.clear();
  byKey.set(key, r);
  return r;
}

/** How high the surface stands at a design point: its depth from the
    centre plane, in design units, on whichever form of the outline is
    kept (null before one is built). */
export function surfaceAt(key: string, halfDepth: number, x: number, y: number, round = 1): number | null {
  const prefix = `${key}|`, suffix = `|${Math.round(halfDepth)}`;
  let form: Form | null = null;
  for (const [id, f] of forms) if (id.startsWith(prefix) && id.endsWith(suffix)) form = f;
  if (!form) return null;
  const { N, h } = form;
  const u = SPAN / N;
  const fx = Math.min(N - 1, Math.max(0, (x + PAD) / u - 0.5)), fy = Math.min(N - 1, Math.max(0, (y + PAD) / u - 0.5));
  const x0 = Math.min(N - 2, fx | 0), y0 = Math.min(N - 2, fy | 0), tx = fx - x0, ty = fy - y0, i = y0 * N + x0;
  const v = (h[i] * (1 - tx) + h[i + 1] * tx) * (1 - ty) + (h[i + N] * (1 - tx) + h[i + N + 1] * tx) * ty;
  let top = 0;
  for (let k = 0; k < N * N; k++) if (h[k] > top) top = h[k];
  if (top <= 0) return 0;
  const q = Math.max(0.05, Math.min(1, round));
  return top * Math.pow(Math.max(0, v) / top, q);
}

/* ── colour ────────────────────────────────────────────────────────── */

const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const linCache = new Map<string, V3>();
function linearColor(color: string): V3 {
  let c = linCache.get(color);
  if (!c) {
    let rgb = parseColor(color);
    if (!rgb) {
      /* a named colour: let a canvas resolve it */
      const cv = makeCanvas(1);
      const g = cv && ctx2d(cv, true);
      if (g) {
        g.fillStyle = color;
        g.fillRect(0, 0, 1, 1);
        const p = g.getImageData(0, 0, 1, 1).data;
        rgb = [p[0], p[1], p[2]];
      } else rgb = [128, 128, 128];
    }
    c = [toLin(rgb[0] / 255), toLin(rgb[1] / 255), toLin(rgb[2] / 255)];
    if (linCache.size > 200) linCache.clear();
    linCache.set(color, c);
  }
  return c;
}

/* tone map (soft shoulder above 0.75, keeps hue) + sRGB encode, as a table */
const TONE_N = 2048, TONE_MAX = 2.5, TONE_SCALE = TONE_N / TONE_MAX;
const toneLut = new Float32Array(TONE_N);
for (let i = 0; i < TONE_N; i++) {
  const v = (i + 0.5) / TONE_SCALE;
  const y = v <= 0.75 ? v : 0.75 + 0.25 * (1 - Math.exp(-(v - 0.75) / 0.25));
  toneLut[i] = 255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
}
const tone = (v: number) => toneLut[v <= 0 ? 0 : v >= TONE_MAX ? TONE_N - 1 : (v * TONE_SCALE) | 0];
/* linear to 0–255 sRGB, no shoulder */
const srgb = (v: number) => (v <= 0 ? 0 : v >= 1 ? 255 : 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055));

/* x^e over x ∈ [0, 1], as a table, cached by exponent */
const POW_N = 1024;
const powLuts = new Map<number, Float32Array>();
function powLut(e: number): Float32Array {
  let t = powLuts.get(e);
  if (!t) {
    t = new Float32Array(POW_N + 1);
    for (let i = 0; i <= POW_N; i++) t[i] = Math.pow(i / POW_N, e);
    if (powLuts.size > 16) powLuts.clear();
    powLuts.set(e, t);
  }
  return t;
}

/* ── the matcap: the material evaluated for every normal ───────────── */

export interface Material {
  shadow: number;
  highlight: number;
  spread: number;
  rim: number;
  /** 0–1: how much colour the light keeps past the palette's full
      saturation (see vivify) */
  vivid?: number;
  /** fabric: how far round to the front the key sits, radians — 0 grazes
      from the side, π/2 lights from the camera */
  front?: number;
  /** fabric: the strength of the light along single fibres, 1 as it comes */
  shine?: number;
  /** fabric: 0–1, how soft the back light is — 0 a small source caught on
      single fibres, 1 a large one, an even glow reaching further in */
  backSoft?: number;
  /** fabric: the smooth, satin light over the body's edge — the key's
      sheen and the back light's band, as even gradients rather than on
      single fibres; 0 by default (matte) */
  sheen?: number;
}
/* More colour than a fully saturated palette colour has: the light's own
   mixes — a highlight, a sheen, a rim, a fill — pulled away from grey
   about their luminance, as far as the gamut allows (no channel below
   zero), so a lit aqua stays aqua rather than paling toward white. The
   colour itself, already at the gamut's edge, is left as it is. In place
   on a linear triple. */
function vivify(c: V3, v: number, cap = Infinity) {
  if (!(v > 0)) return;
  const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const mn = Math.min(c[0], c[1], c[2]), mx = Math.max(c[0], c[1], c[2]);
  let k = 1 + 3 * v;
  if (mn < y) k = Math.min(k, y / (y - mn));
  if (mx > y) k = Math.min(k, Math.max(1, (cap - y) / (mx - y)));
  c[0] = y + (c[0] - y) * k;
  c[1] = y + (c[1] - y) * k;
  c[2] = y + (c[2] - y) * k;
}
export interface Frame {
  L: V3; V: V3; H: V3; U: V3; W: V3; A: V3; B: V3;
  /** down on screen, in the cap's frame: toward the floor */
  D: V3;
  /** toward the back light on screen, in the cap's frame */
  K: V3;
}
const ENV: V3 = [0.92, 0.96, 1.0];
const WARM: V3 = [1, 0.98, 0.95];
const smooth = (a: number, b: number, v: number) => {
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
};
/* 1 inside |x| < w, falling to 0 over ±s around it */
const soft = (w: number, s: number, x: number) => 1 - smooth(w - s, w + s, x);

/** Fill `out` (M × M × rgb, sRGB 0–255) with the lit sphere for body colour `c` (linear). */
export function buildMatcap(out: Float32Array, c: V3, f: Frame, p: Material) {
  const { L, V, H, U, W, A, B } = f;
  const vivid = p.vivid ?? 0, px: V3 = [0, 0, 0];
  const mx = Math.max(c[0], c[1], c[2], 0.05);
  const tint: V3 = [c[0] / mx, c[1] / mx, c[2] / mx];
  const amb = Math.max(0.03, 0.30 - 0.15 * p.shadow);
  const wrap = 0.15 + 0.14 * p.spread;
  const kd = 0.85;
  const e1 = Math.min(90, Math.round(110 / Math.pow(p.spread, 1.3))), e2 = Math.max(2, Math.round(8 / p.spread));
  const lut1 = powLut(e1), lut2 = powLut(e2);
  const ks1 = 0.45 * p.highlight, ks2 = 0.10 * p.highlight, winK = 0.11 * p.highlight, rimK = 0.30 * p.rim;
  const ambT: V3 = [amb * tint[0], amb * tint[1], amb * tint[2]];
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      let nx = (i / (M - 1)) * 2 - 1, ny = (j / (M - 1)) * 2 - 1;
      let r2 = nx * nx + ny * ny;
      /* samples lie inside the unit disc and read one cell beyond it at
         most: the corners are never read */
      if (r2 > 1.14) continue;
      if (r2 > 1) {
        const s = 1 / Math.sqrt(r2);
        nx *= s; ny *= s; r2 = 1;
      }
      const nz = Math.sqrt(1 - r2);
      const nl = nx * L[0] + ny * L[1] + nz * L[2];
      const nv = Math.max(0, nx * V[0] + ny * V[1] + nz * V[2]);
      const nh = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]);
      const dif = Math.min(1, Math.max(0, (nl + wrap) / (1 + wrap)));
      const q = 1 - nv, q2 = q * q, f3 = q2 * q, f5 = f3 * q2;
      const ni = (nh * POW_N) | 0;
      const spec = (ks1 * lut1[ni] + ks2 * lut2[ni]) * (1 + 3 * f5);
      /* the mirror direction: sky/floor gradient and the window */
      const rx = 2 * nv * nx - V[0], ry = 2 * nv * ny - V[1], rz = 2 * nv * nz - V[2];
      const sky = 0.45 + 0.55 * smooth(-0.4, 0.6, rx * U[0] + ry * U[1] + rz * U[2]);
      const rw = rx * W[0] + ry * W[1] + rz * W[2];
      let win = 0;
      if (rw > 0.5) {
        const ra = (rx * A[0] + ry * A[1] + rz * A[2]) / rw, rb = (rx * B[0] + ry * B[1] + rz * B[2]) / rw;
        win = soft(0.34, 0.12, Math.abs(ra)) * soft(0.12, 0.06, Math.abs(rb));
      }
      const env = rimK * f3 * sky + winK * win;
      const k = (j * M + i) * 3;
      /* the body's own light only: a clear coat's reflections stay white */
      px[0] = c[0] * (ambT[0] + kd * dif);
      px[1] = c[1] * (ambT[1] + kd * dif);
      px[2] = c[2] * (ambT[2] + kd * dif);
      vivify(px, vivid);
      out[k] = tone(px[0] + spec * WARM[0] + env * ENV[0]);
      out[k + 1] = tone(px[1] + spec * WARM[1] + env * ENV[1]);
      out[k + 2] = tone(px[2] + spec * WARM[2] + env * ENV[2]);
    }
  }
}

/** Bilinear read of the matcap at a normal's (nx, ny). */
function sampleMatcap(mc: Float32Array, nx: number, ny: number, out: V3) {
  const fx = (nx * 0.5 + 0.5) * (M - 1), fy = (ny * 0.5 + 0.5) * (M - 1);
  const cx = Math.min(M - 2, Math.max(0, fx | 0)), cy = Math.min(M - 2, Math.max(0, fy | 0));
  const x = fx - cx, y = fy - cy, b = (cy * M + cx) * 3, R = M * 3;
  const w00 = (1 - x) * (1 - y), w10 = x * (1 - y), w01 = (1 - x) * y, w11 = x * y;
  for (let ch = 0; ch < 3; ch++) out[ch] = mc[b + ch] * w00 + mc[b + 3 + ch] * w10 + mc[b + R + ch] * w01 + mc[b + R + 3 + ch] * w11;
}

/* fabric's lift near the edge, per texel: the form bakes a darkening into
   its last few units (plastic's rim sinks into shade there), but a pile
   does the opposite — the fibres at the silhouette are seen side-on and
   catch the light — so fabric divides that darkening back out and adds a
   soft band of sheen just inside the outline */
export interface Lift {
  /** the baked occlusion with the edge's darkening taken back out */
  ao: Uint8Array;
  /** the sheen band just inside the outline, a gain */
  k: Float32Array;
}
const lifts = new WeakMap<Form, Lift>();
export function edgeLift(form: Form): Lift {
  let l = lifts.get(form);
  if (l) return l;
  const { N, sd, ao } = form;
  l = { ao: new Uint8Array(N * N), k: new Float32Array(N * N) };
  for (let i = 0; i < N * N; i++) {
    if (ao[i] === 0) continue;
    const dd = Math.max(0, sd[i]);
    const e = 1 - Math.min(1, dd / 3);
    const edge = 1 - 0.2 * e * e;
    /* undo the edge factor where it was baked: in the linear occlusion,
       before the material's strength is applied */
    const lin = Math.min(1, Math.pow(ao[i] / 255, 2.2) / edge);
    l.ao[i] = Math.max(1, Math.round(255 * Math.pow(lin, 1 / 2.2)));
    l.k[i] = 1;
  }
  lifts.set(form, l);
  return l;
}

/** Per frame: matcap lookup × baked AO into the texture's pixels; `lift`,
    fabric's edge sheen, multiplies in when given. */
/* how wide the front's texture fades out toward the outline, in design
   units: that band is the side of the form, which the slices under it
   shade — the front blends into them instead of ending at a line */
const FRONT_FADE = 5;
export function shadeTexels(form: Form, mc: Float32Array, px: Uint8ClampedArray, aoMul: Float32Array, lift?: Lift) {
  const { N, i00, wx, wy, ao, sd } = form;
  const R = M * 3;
  for (let i = 0, k = 0; i < N * N; i++, k += 4) {
    const a = ao[i];
    if (a === 0) {
      px[k + 3] = 0;
      continue;
    }
    let m = lift ? aoMul[lift.ao[i]] * lift.k[i] : aoMul[a];
    const b = i00[i] * 3, x = wx[i] * (1 / 255), y = wy[i] * (1 / 255);
    if (lift) {
      /* The occlusion is the room's light hidden by the form around a
         point — the ambient and the fill — not the key's, which reaches
         any point facing it past a dome's own sides: where the matcap is
         lit by the key it takes less of it, so the lit side stays bright
         and only the shade and the creases sink */
      const g = (mc[b + 1] * (1 - x) + mc[b + 4] * x) * (1 - y) + (mc[b + R + 1] * (1 - x) + mc[b + R + 4] * x) * y;
      m = 1 - (1 - m) * (1.1 - 0.75 * Math.min(1, g / 235));
    }
    const w00 = (1 - x) * (1 - y) * m, w10 = x * (1 - y) * m, w01 = (1 - x) * y * m, w11 = x * y * m;
    px[k] = mc[b] * w00 + mc[b + 3] * w10 + mc[b + R] * w01 + mc[b + R + 3] * w11;
    px[k + 1] = mc[b + 1] * w00 + mc[b + 4] * w10 + mc[b + R + 1] * w01 + mc[b + R + 4] * w11;
    px[k + 2] = mc[b + 2] * w00 + mc[b + 5] * w10 + mc[b + R + 2] * w01 + mc[b + R + 5] * w11;
    const t = sd[i] / FRONT_FADE;
    px[k + 3] = t >= 1 ? 255 : t <= 0 ? 0 : Math.round(255 * t * t * (3 - 2 * t));
  }
}

/* the body's outline with a plain soft edge, no fringe, at a pile's
   resolution: fabric's inner slices */
const softs = new WeakMap<Form, Map<number, AnyCanvas | null>>();
function softMask(form: Form, R: number): AnyCanvas | null {
  let byR = softs.get(form);
  if (!byR) softs.set(form, (byR = new Map()));
  if (byR.has(R)) return byR.get(R)!;
  const c = makeCanvas(R), g = c && ctx2d(c, false);
  if (!c || !g) {
    byR.set(R, null);
    return null;
  }
  const { N, sd } = form;
  const img = new ImageData(R, R), px = R / SPAN;
  for (let y = 0; y < R; y++) {
    for (let x = 0; x < R; x++) {
      const d = bilerp(sd, N, (((x + 0.5) / px) / SPAN) * N - 0.5, (((y + 0.5) / px) / SPAN) * N - 0.5);
      const t = (d + 0.2) / 0.6;
      const k = (y * R + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = t >= 1 ? 255 : t <= 0 ? 0 : Math.round(255 * t * t * (3 - 2 * t));
    }
  }
  g.putImageData(img, 0, 0);
  byR.set(R, c);
  return c;
}

/* the outline's rim as points: the texels just inside it, each with its
   distance in. A texel p that far inside reaches at least e·p + d along
   any direction e, and the one nearest the outline there reaches exactly
   its extent — so how far the outline reaches along a direction is a max
   over these few hundred points */
const rims = new WeakMap<Form, Float32Array>();
function rimOf(form: Form): Float32Array {
  let r = rims.get(form);
  if (r) return r;
  const { N, sd } = form;
  const u = SPAN / N;
  const pts: number[] = [];
  for (let j = 0, i = 0; j < N; j++) for (let x = 0; x < N; x++, i++) if (sd[i] >= 0 && sd[i] < 2 * u) pts.push((x + 0.5) * u - PAD, (j + 0.5) * u - PAD, sd[i]);
  r = Float32Array.from(pts);
  rims.set(form, r);
  return r;
}
function reach(rim: Float32Array, ex: number, ey: number): number {
  let m = -INF;
  for (let i = 0; i < rim.length; i += 3) {
    const v = rim[i] * ex + rim[i + 1] * ey + rim[i + 2];
    if (v > m) m = v;
  }
  return m;
}

/* ── fabric: a plush pile instead of a clear coat ─────────────────── */

/* The same form, dressed in a plush pile. The fibres are combed from a
   parting behind the top of the head and hang, gathered into locks that
   lie along the flow; past the edge the locks stand out as soft tufts with
   a haze of hairs, so the silhouette is soft instead of cut. Everything
   here depends only on the form, so it is made once per outline and size
   and kept. */

export interface Fur {
  /** the pile's own resolution: finer than the form, so the fibres stay
      thin on a large avatar */
  R: number;
  /** the body plus a fringe of hairs past its edge, as alpha: the halo */
  mask: AnyCanvas | null;
  /** how far the halo's hairs are lit toward their tips, as alpha */
  haze: AnyCanvas | null;
  /** the halo's complement: what laying it over the body cuts away —
      made on first use (see furCut): only a far turn needs it */
  cut: AnyCanvas | null;
  /** the body's inside, clear of the halo's band along the outline */
  core: AnyCanvas | null;
  /** the pile as a film over the wider square FILM_SPAN across, in two
      parts: black where it deepens the colour (laid over it, black at
      alpha a multiplies by 1 − a — the gaps between locks and strands,
      as occlusion does) and white where it lightens it (screens: the
      tips). Laid over the whole turned body at once, source-atop, it is
      one continuous pile. */
  dark: AnyCanvas | null;
  light: AnyCanvas | null;
  /** the light on single fibres, as alpha over the film's square, white:
      the key's highlights along the fibres where they lie across it
      (`glint`), and the back light carried through the fibres toward the
      silhouette and out along the halo's hairs (`back`) — each laid in its
      own mix of the colour and at its slider's strength (see sheenFilm) */
  glint: AnyCanvas | null;
  back: AnyCanvas | null;
  /** the same back light without single fibres: an even glow that reaches
      further in from the silhouette and fades out gently — what a softer,
      larger back light gives (see sheenFilm, `backSoft`) */
  backSoft: AnyCanvas | null;
}
/* The pile is a property of the shape, not of one avatar or one texture
   size: it is kept per outline and depth, per resolution tier (matched to
   how large the avatar is drawn, so a small one never pays for a large
   pile), and per light direction in 15° bins (the tufts are lit). A page
   of avatars of one type shares one pile. */
const furs = new Map<string, Fur>();
const furPending = new Set<string>();
const lightBin = (lx: number, ly: number) => Math.round(Math.atan2(ly, lx) / (Math.PI / 12));
/* the pile's resolution for a cap drawn `capPx` device pixels across */
const furTier = (capPx: number) => (capPx <= 200 ? 192 : capPx <= 360 ? 320 : 512);
/** The pile's style: `length` and `density` multiply the base fibres',
    `fuzz` (0–1) is how soft the silhouette is, `clumps` (0–1) how much the
    fibres gather into tufts, `curl` (0–1) how wavy they are, `gravity`
    (0–1) how much they hang down. */
export interface FurStyle {
  length: number;
  density: number;
  fuzz: number;
  clumps: number;
  curl: number;
  /** 0–1: how much the pile hangs down — combed down from a parting at the
      top rather than standing out evenly all round */
  gravity: number;
}
export const FUR_STOCK: FurStyle = { length: 1, density: 1.6, fuzz: 0.9, clumps: 0.4, curl: 0.7, gravity: 0.9 };
const styleId = (s: FurStyle) =>
  `${s.length.toFixed(2)},${s.density.toFixed(2)},${s.fuzz.toFixed(2)},${s.clumps.toFixed(2)},${s.curl.toFixed(2)},${(s.gravity ?? FUR_STOCK.gravity).toFixed(2)}`;
const furKey = (key: string, halfDepth: number, R: number, bin: number, style: FurStyle, lights: FurLights) => `${key}|${Math.round(halfDepth)}|${R}|${bin}|${styleId(style)}|${lightsId(lights)}`;
/* a slider dragged through styles queues a bake per stop: past the two
   newest for a shape, the older ones are dropped before they run */
const queuedFor = new Map<string, string[]>();
const dropped = new Set<string>();

/* the pile's neutral grey: below it the film darkens the colour, above it
   lightens it, as a hard-light blend of the grey would */
const FUR_MID = 128;
/* the locks: how many overlap each point of the pile on average, how
   many more are seeded than a surface seen face-on needs (those over
   foreshortened surface are kept), and how a lock tapers — its width
   sqrt(s)·(1 − s) brought to 1 at its widest, a third of the way from its
   root to its tip */
const LOCK_COVER = 3.2;
const LOCK_DENSE = 1 / 2.56;
const LOCK_TAPER = 1 / ((2 / 3) * Math.sqrt(1 / 3));
/* how much sparser the locks grow between the tufts they gather into (at
   full clumps): the pile parts there and the view reaches its deep floor */
const LOCK_PART = 0.6;
/* the light in the pile, relative to the key's full strength: what the
   room gives every side, what the fill (from the front, on the side away
   from the key) adds where the pile faces it — so on the shade side the
   locks are still modelled, lit from the other side and dimly — and how
   far the key wraps past the terminator through the fibres, as the
   matcap's */
const PILE_AMB = 0.07;
const PILE_FILL = 0.14;
const PILE_WRAP = 0.3;
/* how much of the key a lock's shadow takes from the pile below it, how
   dark the hollows between locks are, how much a lock's root is shaded by
   the tip lying over it, and how much less of the key a fibre lying along
   it catches than one lying across it */
const PILE_SHADOW = 0.6;
const PILE_AO = 0.35;
const PILE_ROOT = 0.3;
const PILE_KK = 0.3;
/* the pile's light against the smooth body's, brought back to about one
   on average — the shadows and hollows only take light away — and how
   far the film's light part lifts the colour per unit of it */
const PILE_GAIN = 1.26;
const PILE_LIFT = 1.6;
/* Rolled off at its lit tops (matte) and sunk at its hollows, the pile on
   average takes a little light from the body beneath it, and more the
   deeper its relief: given back as an even lift of the film, so the
   body keeps its tone and only gains texture */
const PILE_BIAS = 0.045;
/* how far a plush's fibres stand out of the surface (about 29°): seen
   straight down the slope at the silhouette a fibre shows only this much
   of its length (the sine), seen square to the surface the rest (cosine) */
const PILE_STAND = 0.5;
const PILE_COS = Math.cos(PILE_STAND), PILE_SIN = Math.sin(PILE_STAND);
/* how much of the light the pile loses at the deepest of a crease between
   lobes or under the body: its roots there are out of the room's light */
const PILE_CREASE = 0.22;
/* how high the pile's tops stand over its hollows, in design units per
   unit of its length: how far the two move apart as the body turns */
const PILE_H = 0.5;
/* the shade the film's dark part is encoded for: laid in the gaps' colour
   (see gapFilm) at full alpha it takes the colour down to about this */
const GAP_REF = 0.36;
/* the smooth body's light (room, fill and key, as the pile's light below
   reckons it) where the key is full on it, and the light the film's light
   part lifts the colour toward, against the colour fully lit: the tips'
   colour at full brightness (see tipFilm) */
const PILE_LIT = 1.1;
const TIP_TOP = 1.625;
/* the fine strands: each grows one way from its root, down the flow,
   thinning toward its tip by this much of its weight; its root lies under
   the tips of the strands before it, in their shade, and its tip lies on
   top, up in the light — how much lighter a strand's tip is than its root,
   against its own contrast */
const STRAND_TAPER = 0.5;
const STRAND_RISE = 0.9;
/* the shortest strand, against the longest at a point */
const STRAND_SHORT = 0.7;
/* how high a strand stands over the pile beside it, in design units, and
   how dark the shadow it casts there, against the strands' own contrast */
const STRAND_CAST_H = 0.15;
const STRAND_CAST = 1.3;
/* how far past the body's square the pile's film reaches, and its span */
const FILM_M = 20;
const FILM_SPAN = SPAN + 2 * FILM_M;
/* the halo: how dense its haze is at the outline, how much its hairs
   streak it, and how far each is drawn out along the flow, in design
   units per unit of the pile's length */
const HALO_A = 0.8;
const HALO_STREAK = 0.3;
const HALO_HAIR = 0.8;
/* how far the halo's hairs turn to the front's brightest colour toward
   their tips */
const HALO_LIFT = 0.7;
/* how much of the far half's shade the halo keeps where that half forms
   the silhouette */
const HALO_SHADE = 0.5;
/* how far the halo's stretched outline may miss the turned stack's
   silhouette, in design units: up to half this it is laid over the body;
   past that it cuts into the body and shows behind it instead, an
   overhanging one faded out by this and the cut receded entirely by
   twice this */
const HALO_FIT = 2.5;
/* how far in from the outline the halo's band reaches, in design units:
   under (or over) the body's edge, and no further */
const HALO_CORE = 1.2;
/* how far in on the front the halo's colour comes from at least, in
   design units: past the edge's shade, as a pile lit through */
const HALO_INSET = 3;
/* how much of the halo's colour is laid over the body's own edge */
const HALO_VEIL = 0.8;
/* over how much of the recession (`back`, see drawPlasticCap) the halo
   laid over the body is cross-faded into the cut, and how far that
   weight moves in a frame while animating: the miss is measured in steps
   of the turn, so it would otherwise step with it */
const HALO_BLEND = 0.3;
const HALO_EASE = 0.1;

/* The pile's two lights, in a frame where U is toward the light on
   screen, V toward the viewer and D down on screen. The key comes in lower
   than plastic's, from further round the side, so the far side of the
   form falls into real shade. The back light is behind the toy, above it
   and toward the side away from the key, grazing it: a pile catches it
   only toward the silhouette, and there the fibres carry it through to the
   viewer as a bright rim. */
const KEY_EL = (32 * Math.PI) / 180;
/* how soft the back light is by default (see Material.backSoft) */
const BACK_SOFT = 1;
function fabricKey(U: V3, V: V3, front = KEY_EL): V3 {
  const c = Math.cos(front), s = Math.sin(front);
  return norm3([U[0] * c + V[0] * s, U[1] * c + V[1] * s, U[2] * c + V[2] * s]);
}
function fabricBack(K: V3, V: V3): V3 {
  return norm3([0.94 * K[0] - 0.34 * V[0], 0.94 * K[1] - 0.34 * V[1], 0.94 * K[2] - 0.34 * V[2]]);
}
/** Where the back light is on screen by default, as a unit vector (y down)
    from the key's (lx, ly): above the toy and toward the side away from the
    key. */
export function backFromKey(lx: number, ly: number): [number, number] {
  const x = -0.5 * lx, y = -0.5 * ly - 0.87;
  const l = Math.hypot(x, y) || 1;
  return [x / l, y / l];
}
/** The lights the pile's own fibres are baked for: the back light's
    direction on screen (unit, y down) and how far round to the front the
    key sits (radians). */
export interface FurLights {
  bx: number;
  by: number;
  front: number;
}
/** the stock lights for a key at (lx, ly) on screen */
export const stockLights = (lx: number, ly: number): FurLights => {
  const [bx, by] = backFromKey(lx, ly);
  return { bx, by, front: KEY_EL };
};
const lightsId = (s: FurLights) => `${Math.round(Math.atan2(s.by, s.bx) / (Math.PI / 36))}|${Math.round(s.front / (Math.PI / 90))}`;

/* a stable white noise, so every avatar of a type wears the same pile */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/* a field on the form's grid read at any point, bilinear */
function bilerp(f: Float32Array, N: number, x: number, y: number): number {
  const last = N - 1;
  const fx = Math.min(last, Math.max(0, x)), fy = Math.min(last, Math.max(0, y));
  const x0 = Math.min(last - 1, fx | 0), y0 = Math.min(last - 1, fy | 0);
  const tx = fx - x0, ty = fy - y0, i = y0 * N + x0;
  return (f[i] * (1 - tx) + f[i + 1] * tx) * (1 - ty) + (f[i + N] * (1 - tx) + f[i + N + 1] * tx) * ty;
}

/* the pile takes 30–50 ms to make: on idle time, in small steps, unless
   no animation will follow (then now) */
function furReady(form: Form, key: string, halfDepth: number, capPx: number, sync: boolean, lx: number, ly: number, style: FurStyle = FUR_STOCK, lights: FurLights = stockLights(lx, ly)): Fur | null {
  const R = furTier(capPx), bin = lightBin(lx, ly);
  const id = furKey(key, halfDepth, R, bin, style, lights);
  const hit = furs.get(id);
  if (hit) return hit;
  if (sync) return furFor(form, key, halfDepth, capPx, lx, ly, style, lights);
  /* a large pile takes a while on idle time: with nothing of this shape
     to stand in meanwhile, the smallest one is baked first — in a small
     fraction of the time — and drawn until the full one lands */
  const prefix = `${key}|${Math.round(halfDepth)}|`;
  if (R > 192 && !furPending.has(id)) {
    let any = false;
    for (const k of furs.keys()) if (k.startsWith(prefix)) any = true;
    for (const k of furPending) if (k.startsWith(prefix)) any = true;
    if (!any) furReady(form, key, halfDepth, 1, false, lx, ly, style, lights);
  }
  if (!furPending.has(id)) {
    furPending.add(id);
    dropped.delete(id);
    const shape = `${key}|${Math.round(halfDepth)}|${R}|${bin}`;
    const line = queuedFor.get(shape) ?? [];
    line.push(id);
    while (line.length > 2) {
      const old = line.shift()!;
      dropped.add(old);
      furPending.delete(old);
    }
    queuedFor.set(shape, line);
    const job = furJob(form, id, R, lx, ly, style, lights);
    if (job) for (const step of job.steps) idle(() => (dropped.has(id) ? undefined : step()));
  }
  /* while it bakes, the same shape's pile at another tier or light will
     do — close enough for the few frames until this one lands */
  missed = true;
  for (const [k, f] of furs) if (k.startsWith(prefix)) return f;
  return null;
}

/* a small deterministic generator, so a type's pile is the same every bake */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* smooth value noise over the design box: clumps of fibres and the slow
   variation in the pile's colour */
function valueNoise(scale: number, seed: number) {
  return (x: number, y: number) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const h = (i: number, j: number) => hash2(i + seed * 131, j - seed * 71);
    const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
  };
}

/* the same in three dimensions: a solid texture, read on the body's
   surface, so its cells crowd together where the surface turns away */
function hash3(x: number, y: number, z: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise3(scale: number, seed: number) {
  return (x: number, y: number, z: number) => {
    const fx = x / scale, fy = y / scale, fz = z / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
    const tx = fx - x0, ty = fy - y0, tz = fz - z0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty), sz = tz * tz * (3 - 2 * tz);
    const h = (i: number, j: number, k: number) => hash3(i + seed * 131, j - seed * 71, k + seed * 17);
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const c00 = lerp(h(x0, y0, z0), h(x0 + 1, y0, z0), sx), c10 = lerp(h(x0, y0 + 1, z0), h(x0 + 1, y0 + 1, z0), sx);
    const c01 = lerp(h(x0, y0, z0 + 1), h(x0 + 1, y0, z0 + 1), sx), c11 = lerp(h(x0, y0 + 1, z0 + 1), h(x0 + 1, y0 + 1, z0 + 1), sx);
    return lerp(lerp(c00, c10, sy), lerp(c01, c11, sy), sz);
  };
}

/**
 * The pile for a form: made once per outline, texture size and light.
 *
 * A faux fur like a plush toy's: fine strands lying in one flow — combed
 * from a parting behind the top of the head and falling — gathered into
 * locks, and the locks into tufts. Each lock is a tapering mound laid on
 * the body's curved surface and seen as that surface is, foreshortened
 * toward the silhouette; together they make a height field, lit by the
 * same key and fill as the body: a lock is lit on its side toward the key
 * and shaded on the other, its tip lies over the root of the next and
 * casts a shadow on it, the hollows between locks and the creases between
 * the body's lobes sink into shade, and the pile parts between tufts down
 * to its deep floor. Over that, strands — a sparse bright noise drawn out
 * one way along each lock (a line-integral blur), spreading from its root
 * and gathering to its tip, each strand's root under the tips of those
 * before it and in their shade, its tip up in the light, and each casting
 * a thin shadow beside it away from the key — and single hairs, each
 * running from a shaded root to a lit tip, with a few longer guard hairs.
 * It is kept as a film in two parts, black where it deepens the colour and
 * white where it lightens it, over a square wider than the body's, so one
 * film covers the whole turned body. The silhouette breaks into tufts of
 * hairs standing past it, with a haze of fine hairs between them.
 */
export function furFor(form: Form, key = 'custom', halfDepth = 9.75, capPx = 320, lx = -1, ly = 0, style: FurStyle = FUR_STOCK, lights: FurLights = stockLights(lx, ly)): Fur {
  const R = furTier(capPx);
  const id = furKey(key, halfDepth, R, lightBin(lx, ly), style, lights);
  const hit = furs.get(id);
  if (hit) return hit;
  const job = furJob(form, id, R, lx, ly, style, lights);
  if (job) for (const step of job.steps) step();
  return furs.get(id) ?? { R: 0, mask: null, haze: null, cut: null, core: null, dark: null, light: null, glint: null, back: null, backSoft: null };
}

/* the bake as a list of steps sharing one closure; the last one files the
   finished pile in the cache */
function furJob(form: Form, id: string, R: number, lx: number, ly: number, style: FurStyle = FUR_STOCK, lights: FurLights = stockLights(lx, ly)): { steps: (() => void)[] } | null {
  if (furs.has(id)) return null;
  /* files the finished pile, keeping the cache to a couple of dozen */
  const file = (f: Fur) => {
    if (furs.size >= 24) furs.delete(furs.keys().next().value as string);
    furs.set(id, f);
    furPending.delete(id);
    land();
  };
  const { N } = form;
  const px = R / SPAN; // pixels per design unit
  const at = (f: Float32Array, x: number, y: number) => bilerp(f, N, ((x + PAD) / SPAN) * N - 0.5, ((y + PAD) / SPAN) * N - 0.5);
  const sdAt = (x: number, y: number) => at(form.sd, x, y);
  /* the pile's grey is made over a wider square than the body's, FILM_M
     units past it all round, so the film laid over a turned body still
     covers the back half showing past the front's outline */
  const O = PAD + FILM_M, Rb = Math.round((R * FILM_SPAN) / SPAN);
  const fur: Fur = { R, mask: null, haze: null, cut: null, core: null, dark: null, light: null, glint: null, back: null, backSoft: null };
  const dc = makeCanvas(Rb), lc = makeCanvas(Rb), mc = makeCanvas(R), gc = makeCanvas(Rb), bc = makeCanvas(Rb), sc2 = makeCanvas(Rb);
  const dg = dc && ctx2d(dc, false), lg = lc && ctx2d(lc, false), mg = mc && ctx2d(mc, false);
  const gg = gc && ctx2d(gc, false), bg = bc && ctx2d(bc, false), sg2 = sc2 && ctx2d(sc2, false);
  if (!dc || !lc || !mc || !gc || !bc || !sc2 || !dg || !lg || !mg || !gg || !bg || !sg2) {
    file(fur);
    return null;
  }
  const rand = rng(N * 7919 + 17);
  const lean = valueNoise(3.4, 21), tone = valueNoise(22, 9);
  /* slow swirls across the body: where the pile parts and turns, so it is
     not combed the same way everywhere */
  const swirl = valueNoise(13, 57);
  /* the style: longer or shorter fibres, more or fewer, gathered into
     tufts more or less, straighter or wavier, hanging or standing, and a
     softer or crisper edge */
  const { length: kLen, density: kDen, fuzz, clumps, curl } = style;
  const gravity = style.gravity ?? FUR_STOCK.gravity;
  const ll = Math.hypot(lx, ly) || 1;
  const Lx = lx / ll, Ly = ly / ll;
  /* the matcap's key, back light and fill as the front sees them
     head-on, and the key's half vector: the fibres' own highlights and the
     locks' light are baked for them */
  const Uf: V3 = [Lx, Ly, 0], Vf: V3 = [0, 0, 1], Df: V3 = [0, 1, 0];
  const K3 = fabricKey(Uf, Vf, lights.front), B3 = fabricBack([lights.bx, lights.by, 0], Vf), H3 = norm3([K3[0], K3[1], K3[2] + 1]);
  const F3 = norm3([-0.55 * Uf[0] + 0.85 * Vf[0] + 0.15 * Df[0], -0.55 * Uf[1] + 0.85 * Vf[1] + 0.15 * Df[1], -0.55 * Uf[2] + 0.85 * Vf[2] + 0.15 * Df[2]]);

  /* the parting: at the top of the head over its middle */
  /* the parting: over the top of the head, behind it — seen from the
     front the pile comes over the top and falls, with no parting line */
  let crownY = 12;
  for (let y = -PAD; y < 60; y += 0.5) if (sdAt(50, y) > 0.5) { crownY = y + 1; break; }
  crownY -= 18;
  const crownX = 50;
  /* the outline's outward direction at a point */
  const outward = (x: number, y: number): [number, number] => {
    const e = 0.8;
    const ox = sdAt(x - e, y) - sdAt(x + e, y), oy = sdAt(x, y - e) - sdAt(x, y + e);
    const ol = Math.hypot(ox, oy) || 1;
    return [ox / ol, oy / ol];
  };
  /* The flow: away from the parting, and falling — with gravity the pile
     hangs, so away from the parting it points down more and more. Near the
     edge it turns out over the outline, but only where the edge faces
     sideways or down: over the top of the head it lies down the front
     instead of standing up. Each tuft leans its own way, and slow swirls
     turn whole patches, so it is not the same all over. */
  const flow = (x: number, y: number): [number, number] => {
    let rx = x - crownX, ry = y - crownY;
    const rl = Math.hypot(rx, ry) || 1;
    rx /= rl;
    ry /= rl;
    const fall = gravity * (1 - 0.6 * Math.exp(-rl / 8));
    let dx = rx * (1 - 0.8 * fall), dy = ry * (1 - 0.8 * fall) + fall;
    const d0 = sdAt(x, y);
    if (d0 < 5) {
      const [ox, oy] = outward(x, y);
      /* the edge's own direction: out, pulled down by gravity — at the top
         the pull wins and the fibres lie down over the edge */
      const up = Math.max(0, -oy);
      const ex = ox * (1 - gravity * up), ey = oy * (1 - gravity * up) + 1.2 * gravity;
      const w = Math.max(0, Math.min(1, 1 - d0 / 5)) * 0.75;
      dx = dx * (1 - w) + ex * w * 1.6;
      dy = dy * (1 - w) + ey * w * 1.6;
    }
    const a = (lean(x, y) - 0.5) * (0.5 + 1.6 * curl) + (swirl(x, y) - 0.5) * (0.6 + curl);
    const ca = Math.cos(a), sa = Math.sin(a);
    const qx = dx * ca - dy * sa, qy = dx * sa + dy * ca;
    const m = Math.hypot(qx, qy) || 1;
    return [qx / m, qy / m];
  };

  const steps: (() => void)[] = [];
  /* a pass over n rows as several steps of `chunk` rows, so no one idle
     task runs long */
  const rows = (n: number, chunk: number, fn: (y0: number, y1: number) => void) => {
    for (let y0 = 0; y0 < n; y0 += chunk) steps.push(() => fn(y0, Math.min(n, y0 + chunk)));
  };
  /* the body's height at a point, and the surface's slope there: which way
     is downhill, and how steep (0 facing the viewer … toward 1 at the
     outline) */
  const hAt = (x: number, y: number) => at(form.h, x, y);
  const slopeAt = (x: number, y: number): [number, number, number] => {
    const e = 0.6;
    const gx = (hAt(x + e, y) - hAt(x - e, y)) / (2 * e), gy = (hAt(x, y + e) - hAt(x, y - e)) / (2 * e);
    const m = Math.hypot(gx, gy);
    return [m > 1e-6 ? -gx / m : 0, m > 1e-6 ? -gy / m : 0, m / Math.sqrt(1 + m * m)];
  };

  /* 1. the flow on a coarse grid, read bilinearly by everything after:
     away from the parting and falling, and where the surface turns away
     lying down its slope — except over the top, where gravity lays it down
     the front rather than up over the edge */
  const G = 112, gu = FILM_SPAN / G;
  const flowX = new Float32Array(G * G), flowY = new Float32Array(G * G), tiltG = new Float32Array(G * G);
  /* and the surface's normal there, as the form's own: off the height
     field, turned out toward the outline over its last two units, and
     lying flat (facing out) past it, where the halo's hairs stand */
  const nXg = new Float32Array(G * G), nYg = new Float32Array(G * G), nZg = new Float32Array(G * G);
  /* and how far the halo's hairs reach there: the fibres' own light is on
     the body and its halo, none past them (where a turned body's side
     lies under the film) */
  const onG = new Float32Array(G * G);
  /* The pile lies on the curved body, so what the viewer sees of it is
     its projection: a fibre combed down the slope near the outline runs
     away from the viewer and shows short, one combed along the outline
     keeps its length — so the strands bend round the form and shorten
     toward the silhouette, as a texture on a sphere does at its limb.
     `pfX`/`pfY` is that projected direction and `foreG` how much of a
     fibre's length shows (1 seen side-on); the plain flow is kept for what
     works out its own projection (the locks) and for the halo's hairs,
     which stand free of the body past its edge. */
  const pfX = new Float32Array(G * G), pfY = new Float32Array(G * G), foreG = new Float32Array(G * G);
  /* and the body's height there, and how deep in a crease or under the
     body the pile lies: a valley between lobes, where the body around
     stands higher than the point (the height above a wide average of it),
     and the underside, which faces the floor — both hide the room's light
     from the roots */
  const hG = new Float32Array(G * G), creaseG = new Float32Array(G * G);
  /* and the slow drift in the pile's tone, smooth enough to be read off
     the grid */
  const toneG = new Float32Array(G * G);
  rows(G, 28, (j0, j1) => {
    for (let j = j0, i = j0 * G; j < j1; j++) {
      for (let x = 0; x < G; x++, i++) {
        const X = (x + 0.5) * gu - O, Y = (j + 0.5) * gu - O;
        let [fx, fy] = flow(X, Y);
        const [dx, dy, tiltS] = slopeAt(X, Y);
        /* a hanging pile lies down its slope only as far as gravity lets
           it: on the sides it falls rather than standing out */
        const w = tiltS * (0.25 + 0.5 * (1 - gravity)) * (1 - gravity * Math.max(0, -dy));
        fx = fx * (1 - w) + dx * w;
        fy = fy * (1 - w) + (dy + 0.35 * gravity) * w;
        const fl = Math.hypot(fx, fy) || 1;
        fx /= fl;
        fy /= fl;
        flowX[i] = fx;
        flowY[i] = fy;
        tiltG[i] = tiltS;
        let nx = dx * tiltS, ny = dy * tiltS, nz = Math.sqrt(Math.max(0, 1 - tiltS * tiltS));
        const d0 = sdAt(X, Y);
        if (d0 < 2) {
          const [ox, oy] = outward(X, Y);
          const w = d0 >= 0 ? 0.7 * (1 - d0 / 2) : Math.min(1, 0.7 - 0.2 * d0);
          nx += w * (ox - nx);
          ny += w * (oy - ny);
          nz -= w * nz;
          const nl = Math.hypot(nx, ny, nz) || 1;
          nx /= nl;
          ny /= nl;
          nz /= nl;
        }
        nXg[i] = nx;
        nYg[i] = ny;
        nZg[i] = nz;
        onG[i] = smooth(-3.5, -1.5, d0);
        toneG[i] = tone(X, Y);
        hG[i] = d0 > 0 ? hAt(X, Y) : 0;
        /* the flow as a direction on the surface, its part down the slope
           (along the normal's lean ĝ) seen foreshortened by the surface's
           cosine, then raised out of the surface at the pile's angle */
        const s = Math.sqrt(nx * nx + ny * ny), gx = s > 1e-4 ? nx / s : 0, gy = s > 1e-4 ? ny / s : 0;
        const a = fx * gx + fy * gy, k = (1 - Math.max(0, nz)) * a;
        let qx = PILE_COS * (fx - k * gx) + PILE_SIN * s * gx, qy = PILE_COS * (fy - k * gy) + PILE_SIN * s * gy;
        /* past the outline the halo's hairs stand free, seen whole */
        const att = smooth(-0.5, 1.5, d0);
        qx = fx + (qx - fx) * att;
        qy = fy + (qy - fy) * att;
        const ql = Math.sqrt(qx * qx + qy * qy) || 1;
        pfX[i] = qx / ql;
        pfY[i] = qy / ql;
        foreG[i] = 1 + (Math.min(1, ql) - 1) * att;
      }
    }
  });
  steps.push(() => {
    /* the crease: the body's height under a wide average of it (a valley
       between lobes is lower than its surroundings, a dome higher), and
       the underside, by how far the surface faces the floor */
    const tmp = new Float32Array(G * G), avg = Float32Array.from(hG);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0, i = 0; y < G; y++) for (let x = 0; x < G; x++, i++) {
        let acc = 0;
        for (let t = -2; t <= 2; t++) acc += avg[y * G + Math.min(G - 1, Math.max(0, x + t))];
        tmp[i] = acc / 5;
      }
      for (let y = 0, i = 0; y < G; y++) for (let x = 0; x < G; x++, i++) {
        let acc = 0;
        for (let t = -2; t <= 2; t++) acc += tmp[Math.min(G - 1, Math.max(0, y + t)) * G + x];
        avg[i] = acc / 5;
      }
    }
    for (let j = 0, i = 0; j < G; j++) for (let x = 0; x < G; x++, i++) {
      /* only on the body: past the outline the average takes its height
         and every edge would read as a valley */
      const inside = smooth(0.2, 2, sdAt((x + 0.5) * gu - O, (j + 0.5) * gu - O));
      const valley = smooth(0.3, 3.5, avg[i] - hG[i]) * inside;
      const under = smooth(0.15, 0.85, nYg[i]) * (1 - nZg[i]);
      creaseG[i] = Math.min(1, valley + 0.45 * under) * onG[i];
    }
  });
  const gridAt = (f: Float32Array, X: number, Y: number) => bilerp(f, G, (X + O) / gu - 0.5, (Y + O) / gu - 0.5);
  /* the projected flow's unit direction at a design point: how the strands
     are seen lying on the body */
  const dirAt = (X: number, Y: number): [number, number] => {
    const ux = gridAt(pfX, X, Y), uy = gridAt(pfY, X, Y);
    const ul = Math.sqrt(ux * ux + uy * uy);
    return ul > 1e-4 ? [ux / ul, uy / ul] : [0, 1];
  };
  /* and the plain flow's, for the locks (laid on the surface by their own
     reckoning) and the hairs standing free past the edge */
  const freeDirAt = (X: number, Y: number): [number, number] => {
    const ux = gridAt(flowX, X, Y), uy = gridAt(flowY, X, Y);
    const ul = Math.sqrt(ux * ux + uy * uy);
    return ul > 1e-4 ? [ux / ul, uy / ul] : [0, 1];
  };

  /* 2. the locks: a plush's fibres gather into small locks — each a
     tapering bundle rooted in the backing, standing a little out of it and
     lying along the flow, rounded across like a brush stroke and drawn to
     a point at its tip, which lies over the root of the next lock down.
     Each is laid as its own mound on the body's curved surface and seen as
     that surface is: one lying toward the silhouette foreshortened, one
     lying along it seen edge-on. The mounds are kept as one height field
     over the film at its own resolution — at each point the highest lock
     is the one seen — with the index of the lock seen there. */
  const Rl = Rb >> 1, pl = Rl / FILM_SPAN;
  /* the same at half the resolution, for the strokes and the silhouette's
     tufts: how high the pile stands there (`lock`, normalised) and how it
     is lit (`lockLit`) */
  const lock = new Float32Array(Rl * Rl), lockLit = new Float32Array(Rl * Rl);
  const lockAt = (f: Float32Array, X: number, Y: number) => bilerp(f, Rl, (X + O) * pl - 0.5, (Y + O) * pl - 0.5);
  /* the silhouette is not a clean curve: the locks along it stand a little
     past it and the gaps between them fall a little short, so the edge
     breaks into soft tufts — the locks' own pattern and a rounder bump of
     their size, as far out as the pile is long */
  const bump = valueNoise(0.7 + 0.35 * kLen, 61), swell = valueNoise(2.2 + 0.6 * kLen, 67);
  const tuftK = (0.2 + 0.5 * fuzz) * Math.min(1.8, kLen);
  const tuftAt = (X: number, Y: number) => {
    const v = 0.3 * Math.max(-1.6, Math.min(1.6, lockAt(lock, X, Y))) / 1.6 + 0.25 * (bump(X, Y) - 0.5) * 2.4 + 0.45 * (swell(X, Y) - 0.5) * 2.4;
    return tuftK * Math.max(-1, Math.min(1, v));
  };
  const lockW = 0.8 + 0.45 * kLen;
  /* a lock's size on the surface, in design units — as wide as the clumps
     gather it, about three times as long as wide — and how high it stands over
     the pile between locks: with no clumps the pile is nearly even */
  const lockWd = lockW * (0.65 + 0.4 * clumps), lockLd = 1.5 + 1.6 * kLen;
  const hMax = 0.32 * lockWd * (0.15 + 0.85 * clumps);
  const pileH = new Float32Array(Rb * Rb).fill(-0.25 * hMax), own = new Int32Array(Rb * Rb).fill(-1);
  /* per lock: its root and unit axis on the film's screen (in pixels), its
     length and half-width there, how high it sits, how it bends, its axis
     and its across direction on the surface, and its size on it */
  const LP = 16;
  /* the locks are seeded on a jittered grid at LOCK_DENSE times the
     density a surface seen face-on needs, and kept as far as the surface
     is foreshortened there */
  const cell = Math.sqrt((0.6 * lockWd * lockLd) / LOCK_COVER / LOCK_DENSE);
  const gn = Math.ceil(FILM_SPAN / cell);
  const locks = new Float32Array(gn * gn * LP);
  let nLocks = 0;
  /* a hanging pile lies flatter */
  const stand0 = 0.45 - 0.2 * gravity;
  /* a scale above the locks: neighbouring locks gather into tufts, a few
     locks across, that stand together over the pile around them — so a
     tuft is a soft lit mound of its own, its locks lying over the next
     tuft's — and the locks run a little larger in some places than in
     others. The tufts are a solid noise read on the body's surface, so
     toward the outline, where it turns away, they crowd together as the
     locks do. */
  const tuftN = valueNoise3(1.6 * lockLd, 79), sizeN = valueNoise(9, 73);
  const tuftH = 1.5 * hMax * (0.25 + clumps);
  steps.push(() => {
    for (let gy = 0; gy < gn; gy++) for (let gx = 0; gx < gn; gx++) {
      const X = (gx + rand()) * cell - O, Y = (gy + rand()) * cell - O;
      const r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand(), r5 = rand(), r6 = rand(), r7 = rand();
      let nx = gridAt(nXg, X, Y), ny = gridAt(nYg, X, Y), nz = gridAt(nZg, X, Y);
      const nl = Math.hypot(nx, ny, nz) || 1;
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const [fx, fy] = freeDirAt(X, Y);
      const ja = (r1 - 0.5) * (0.2 + 0.45 * curl), cj = Math.cos(ja), sj = Math.sin(ja);
      const ux = fx * cj - fy * sj, uy = fx * sj + fy * cj;
      /* the flow laid onto the surface; where it runs straight out over
         the silhouette the lock runs on round the side, away from view */
      const a = ux * nx + uy * ny;
      let tx = ux - a * nx, ty = uy - a * ny, tz = -a * nz;
      let tl = Math.hypot(tx, ty, tz);
      if (tl < 0.05) {
        tx = nz * nx;
        ty = nz * ny;
        tz = nz * nz - 1;
        tl = Math.hypot(tx, ty, tz) || 1;
      }
      tx /= tl;
      ty /= tl;
      tz /= tl;
      /* across it, on the surface */
      let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
      /* the lock stands a little out of the surface from its root */
      const st = stand0 + 0.2 * r2, cs = Math.cos(st), sn = Math.sin(st);
      const grow = 0.8 + 0.45 * sizeN(X, Y);
      const Wd = lockWd * grow * (0.8 + 0.4 * r3), Ld = lockLd * grow * (0.75 + 0.5 * r4);
      let ax = (tx * cs + nx * sn) * Ld * px, ay = (ty * cs + ny * sn) * Ld * px;
      let La = Math.hypot(ax, ay);
      if (La < 1.5) {
        ax = ux;
        ay = uy;
        La = 1.5;
      } else {
        ax /= La;
        ay /= La;
      }
      /* its width on screen, across its axis there */
      let across = -bx * ay + by * ax;
      if (across < 0) {
        bx = -bx;
        by = -by;
        bz = -bz;
        across = -across;
      }
      const Wa = Math.max(0.6, 0.5 * Wd * px * Math.max(0.15, across));
      /* as many locks on each piece of the surface wherever it is: more on
         the screen where it turns away and they are foreshortened */
      const seen = (La / (Ld * px)) * (Wa / (0.5 * Wd * px));
      /* and fewer between the tufts than in them: the locks gather, and
         where they part the pile's floor shows */
      const tn = tuftN(X, Y, hAt(X, Y));
      if (r5 > (LOCK_DENSE / Math.max(LOCK_DENSE, seen)) * (1 - LOCK_PART * clumps * (1 - smooth(0.25, 0.65, tn)))) continue;
      const b = nLocks++ * LP;
      locks[b] = (X + O) * px;
      locks[b + 1] = (Y + O) * px;
      locks[b + 2] = ax;
      locks[b + 3] = ay;
      locks[b + 4] = La;
      locks[b + 5] = Wa;
      locks[b + 6] = 0.1 * hMax * r6 + tuftH * tn;
      locks[b + 7] = (r7 - 0.5) * 1.2 * curl;
      locks[b + 8] = tx;
      locks[b + 9] = ty;
      locks[b + 10] = tz;
      locks[b + 11] = bx;
      locks[b + 12] = by;
      locks[b + 13] = bz;
      locks[b + 14] = Ld;
      locks[b + 15] = Wd;
    }
  });
  /* each lock into the height field: along it (s, root 0 to tip 1) it
     rises from its root over the first quarter and sinks to half its
     height at the tip; across it (q, −1 to 1 within its width there) it is
     rounded, a parabola; its width sqrt(s)·(1 − s), round at the root and
     drawn to a point at the tip, and it bends a little as the pile curls */
  const lockAlong = (s: number) => (s < 0.25 ? 4 * s : 1) * (1 - 0.5 * s);
  const SPLAT_PARTS = 6;
  for (let part = 0; part < SPLAT_PARTS; part++) steps.push(() => {
    const k0 = Math.floor((nLocks * part) / SPLAT_PARTS), k1 = Math.floor((nLocks * (part + 1)) / SPLAT_PARTS);
    for (let k = k0; k < k1; k++) {
      const b = k * LP;
      const ox = locks[b], oy = locks[b + 1], ax = locks[b + 2], ay = locks[b + 3], La = locks[b + 4], Wa = locks[b + 5], z0 = locks[b + 6], bend = locks[b + 7];
      const ext = Wa * (1 + Math.abs(bend)) + 1, ex = ox + ax * La, ey = oy + ay * La;
      const xa = Math.max(0, Math.floor(Math.min(ox, ex) - ext)), xb = Math.min(Rb - 1, Math.ceil(Math.max(ox, ex) + ext));
      const ya = Math.max(0, Math.floor(Math.min(oy, ey) - ext)), yb = Math.min(Rb - 1, Math.ceil(Math.max(oy, ey) + ext));
      const iLa = 1 / La, iWa = 1 / Wa;
      for (let y = ya; y <= yb; y++) {
        const dy = y + 0.5 - oy;
        for (let x = xa, i = y * Rb + xa; x <= xb; x++, i++) {
          const dx = x + 0.5 - ox;
          const s = (dx * ax + dy * ay) * iLa;
          if (s <= 0 || s >= 1) continue;
          const w = LOCK_TAPER * Math.sqrt(s) * (1 - s);
          const v = (dy * ax - dx * ay) * iWa - bend * s * s;
          if (v >= w || v <= -w) continue;
          const q = v / w;
          const h = z0 + hMax * lockAlong(s) * (1 - q * q);
          if (h > pileH[i]) {
            pileH[i] = h;
            own[i] = k;
          }
        }
      }
    }
  });
  /* the pile's height averaged over about a lock's width: what lies below
     it is a hollow — between locks, at their roots, under a tip lying over
     the next — and the fibres there are in each other's shade. Two passes
     of a box each way, so a lone lock's hollow is round, not square. */
  const pileB = new Float32Array(Rb * Rb);
  const rB = Math.max(1, Math.round(0.3 * lockWd * px));
  /* a box of half-width r along rows (stride 1) or columns (stride Rb),
     from src into dst through one line's copy */
  const line = new Float32Array(Rb);
  const box = (src: Float32Array, dst: Float32Array, r: number, k: number, stride: number) => {
    const step = stride === 1 ? Rb : 1, inv = 1 / (2 * r + 1);
    const at = (t: number) => line[t < 0 ? 0 : t >= Rb ? Rb - 1 : t];
    const o = k * step;
    for (let t = 0; t < Rb; t++) line[t] = src[o + t * stride];
    let acc = 0;
    for (let t = -r; t <= r; t++) acc += at(t);
    for (let t = 0; t < Rb; t++) {
      dst[o + t * stride] = acc * inv;
      acc += at(t + r + 1) - at(t - r);
    }
  };
  steps.push(() => {
    for (let y = 0; y < Rb; y++) box(pileH, pileB, rB, y, 1);
    for (let y = 0; y < Rb; y++) box(pileB, pileB, rB, y, 1);
  });
  steps.push(() => {
    for (let x = 0; x < Rb; x++) box(pileB, pileB, rB, x, Rb);
    for (let x = 0; x < Rb; x++) box(pileB, pileB, rB, x, Rb);
  });
  /* and the pile itself softened by a pixel: fibres of neighbouring locks
     cross where they meet, so a lock's edge is not cut */
  steps.push(() => {
    for (let y = 0; y < Rb; y++) box(pileH, pileH, 1, y, 1);
    for (let x = 0; x < Rb; x++) box(pileH, pileH, 1, x, Rb);
  });

  /* 3. the fleece: every pixel's fibres, lit. The lock seen there gives
     the pile's own surface — its normal tilted by the mound's slope, so a
     lock is lit on the side toward the key and shaded on the other — and
     its strands, spreading from the root and gathering to the tip. The key
     on that surface, against the key on the smooth body (which the matcap
     already shades), is how much lighter or darker the pile is there: the
     relief shows most where the key grazes the body, least where it faces
     it, and the shade side keeps only its hollows. A lock's tip shades the
     pile beyond it toward the light, and the hollows are in shade
     whatever the light. Then fine strands — a sparse bright noise drawn
     out along them, longer where the surface turns away and they are seen
     side-on — and a slow drift in the pile's tone. Kept as the film's two
     parts: darker as black (laid as the colour's own deep shade, see
     gapFilm), lighter as white. */
  const darkImg = new ImageData(Rb, Rb), lightImg = new ImageData(Rb, Rb);
  const glintImg = new ImageData(Rb, Rb), backImg = new ImageData(Rb, Rb), softImg = new ImageData(Rb, Rb);
  const white = new Float32Array(Rb * Rb);
  /* The light on single fibres at a design point, for a fibre lying along
     (ux, uy) on screen and standing `stand` radians out of the surface:
     into `fib` the key's highlight along it, the back light it carries,
     how far the point faces the key at all, and the even glow of a soft
     back light; the body's own normal there and how far it faces the key;
     how deep in a crease or under the body the point lies; how far it is
     on the body and its halo at all; and the pile's tone there. */
  const fib = new Float32Array(11);
  const fibreLight = (X: number, Y: number, ux: number, uy: number, stand: number) => {
    /* the grids read at one set of bilinear weights */
    const fx = Math.min(G - 1, Math.max(0, (X + O) / gu - 0.5)), fy = Math.min(G - 1, Math.max(0, (Y + O) / gu - 0.5));
    const x0 = Math.min(G - 2, fx | 0), y0 = Math.min(G - 2, fy | 0);
    const u = fx - x0, v = fy - y0, j = y0 * G + x0;
    const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
    const read = (f: Float32Array) => f[j] * w00 + f[j + 1] * w10 + f[j + G] * w01 + f[j + G + 1] * w11;
    let nx = read(nXg), ny = read(nYg), nz = read(nZg);
    const nn = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nn;
    ny /= nn;
    nz /= nn;
    const nK = nx * K3[0] + ny * K3[1] + nz * K3[2];
    fib[4] = nx;
    fib[5] = ny;
    fib[6] = nz;
    fib[7] = nK;
    fib[8] = read(creaseG);
    /* past the halo, under a turned body's side, the tips keep most of
       their light and there is no light on single fibres */
    const on = read(onG);
    fib[9] = on;
    fib[10] = read(toneG);
    if (on <= 0) {
      fib[0] = fib[1] = fib[3] = 0;
      fib[2] = 0.7;
      return;
    }
    const key = smooth(-0.2, 0.5, nK);
    /* the fibre: the flow laid onto the surface, then raised out of it at
       the pile's angle — a plush's fibres stand, they do not lie flat */
    const along = ux * nx + uy * ny;
    let tx = ux - along * nx, ty = uy - along * ny, tz = -along * nz;
    const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
    if (tl > 1e-3) {
      tx /= tl;
      ty /= tl;
      tz /= tl;
    } else (tx = 0), (ty = 0), (tz = 1);
    const cs = Math.cos(stand), sn = Math.sin(stand);
    tx = tx * cs + nx * sn;
    ty = ty * cs + ny * sn;
    tz = tz * cs + nz * sn;
    /* Kajiya–Kay: a fibre reflects the key into a cone about itself, seen
       brightest where the fibre lies square to the half vector. Two
       reflections, as Marschner's: off the fibre's surface, sharp and
       white, its cone tilted toward the root; and through the fibre and
       back, broad and in the dye's colour, tilted toward the tip */
    const tH = tx * H3[0] + ty * H3[1] + tz * H3[2], nH = nx * H3[0] + ny * H3[1] + nz * H3[2];
    const a1 = tH - 0.12 * nH, a2 = tH + 0.2 * nH;
    /* (1 − a²)³⁶ and (1 − a²)⁴, by squaring */
    const b1 = Math.max(0, 1 - a1 * a1), b2 = b1 * b1, b4 = b2 * b2, b8 = b4 * b4, b16 = b8 * b8;
    const c1 = Math.max(0, 1 - a2 * a2), c2 = c1 * c1;
    fib[0] = key * (0.85 * b16 * b16 * b4 + 0.15 * c2 * c2);
    /* and brightest where the key grazes the pile: there the fibres stand
       across it, their tips lit over roots already in shade */
    fib[0] *= (0.4 + 0.6 * (1 - smooth(0.35, 0.85, nK))) * on;
    /* the back light: where the pile faces it at all, carried through the
       fibres to the viewer — the more pile the view passes through, the
       more: toward the silhouette, and on a fibre seen side-on; the
       underside, over the floor, gets little */
    const side = Math.sqrt(Math.max(0, 1 - tz * tz));
    fib[1] = smooth(-0.3, 0.6, nx * B3[0] + ny * B3[1] + nz * B3[2]) * Math.pow(1 - nz, 1.6) * (0.4 + 0.6 * side) * (1 - 0.6 * Math.max(0, ny)) * on;
    /* and as a large soft source gives it: facing it more widely, reaching
       further in from the silhouette, the same on every fibre */
    fib[3] = smooth(-0.5, 0.75, nx * B3[0] + ny * B3[1] + nz * B3[2]) * Math.pow(1 - nz, 0.85) * (1 - 0.6 * Math.max(0, ny)) * on;
    fib[2] = key * on + 0.7 * (1 - on);
  };
  steps.push(() => {
    for (let y = 0, i = 0; y < Rb; y++) for (let x = 0; x < Rb; x++, i++) {
      const h = hash2(x + 911, y + 37);
      white[i] = h * h * h;
    }
  });
  /* a triangle kernel of half-width n: its weights' sum and the spread its
     average of the noise keeps, to bring every length to one contrast (the
     halo's hairs, below) */
  const W_MEAN = 0.25, W_SD = Math.sqrt(1 / 7 - 1 / 16);
  const strandHalf = Math.max(1, Math.round((0.35 + 0.4 * kLen) * px));
  /* The fleece's strands are one-sided: a pixel reads the seeds of the
     sparse noise upstream of it, each the root of a strand running down the
     flow to it, as long as its seed says — between STRAND_SHORT and 1 of
     the longest, so their ends do not line up — and thinning toward its
     tip.
     For each longest length L, the kernel's weights, and the mean and
     spread its sum of the noise has (a strand reaches t with the chance
     its random length allows), to bring every length to one contrast. */
  const strandW: Float32Array[] = [], strandMean = new Float32Array(2 * strandHalf + 1), strandSd = new Float32Array(2 * strandHalf + 1);
  for (let L = 0; L <= 2 * strandHalf; L++) {
    const w = new Float32Array(L + 1);
    let m1 = 0, v2 = 0;
    for (let t = 0; t <= L; t++) {
      const tau = L ? t / L : 0, p = tau <= STRAND_SHORT ? 1 : (1 - tau) / (1 - STRAND_SHORT);
      w[t] = 1 - STRAND_TAPER * tau;
      m1 += w[t] * p * W_MEAN;
      v2 += w[t] * w[t] * (p / 7 - W_MEAN * W_MEAN * p * p);
    }
    strandW.push(w);
    strandMean[L] = m1;
    strandSd[L] = Math.sqrt(Math.max(1e-6, v2));
  }
  /* the strands' contrast; a small pile is drawn small, its strands finer
     than the pixels they land on, where they would only be grain */
  const strandK = 0.12 * (R >= 512 ? 1 : R >= 320 ? 0.75 : 0.4) * Math.min(1.4, 0.55 + 0.35 * kDen);
  /* the key's shadow on the pile: looked for toward the light, as far as
     a lock's shadow can reach over the pile below it, as film offsets */
  const reach = Math.max(1, 1.5 * lockWd * px), NSH = Math.max(1, Math.min(5, Math.round(reach)));
  const shX = new Int32Array(NSH), shY = new Int32Array(NSH), shD = new Float32Array(NSH);
  for (let t = 0; t < NSH; t++) {
    const d = ((t + 1) / NSH) * reach;
    shX[t] = Math.round(Lx * d);
    shY[t] = Math.round(Ly * d);
    shD[t] = Math.hypot(shX[t], shY[t]) / px;
  }
  /* the key on a surface facing it by n·k, wrapped a little past the
     terminator by the pile scattering it, as the matcap's */
  const difLut = powLut(1.35), gamLut = powLut(1 / 2.2);
  const keyOn = (nk: number) => {
    const q = (nk + PILE_WRAP) / (1 + PILE_WRAP);
    return q <= 0 ? 0 : q >= 1 ? 1 : difLut[(q * POW_N) | 0];
  };
  /* a small pile is drawn small: its relief is a few pixels, which would
     read as specks rather than depth, so it is shallower */
  const depthK = R >= 512 ? 1 : R >= 320 ? 0.8 : 0.55;
  /* The lock seen at a film pixel (x, y), design point (X, Y), into
     `seen`: its strands' way there (unit, on screen), how far along the
     lock the point lies (0 root … 1 tip) and how high in it (0 … 1) — with
     no lock, the flow and the middle of a lock. */
  const seen = new Float32Array(4);
  const lockSeen = (x: number, y: number, X: number, Y: number, k: number) => {
    if (k < 0) {
      const [ux, uy] = dirAt(X, Y);
      seen[0] = ux;
      seen[1] = uy;
      seen[2] = 0.5;
      seen[3] = 0;
      return;
    }
    const b = k * LP;
    const ax = locks[b + 2], ay = locks[b + 3], La = locks[b + 4], Wa = locks[b + 5], bend = locks[b + 7];
    const dx = x + 0.5 - locks[b], dy = y + 0.5 - locks[b + 1];
    const s = Math.min(0.995, Math.max(0.005, (dx * ax + dy * ay) / La));
    const ss = Math.sqrt(s), w = LOCK_TAPER * ss * (1 - s), dw = LOCK_TAPER * ((0.5 * (1 - s)) / ss - ss);
    const q = Math.max(-1, Math.min(1, ((dy * ax - dx * ay) / Wa - bend * s * s) / w));
    /* a strand keeps its place across the lock as it narrows: out from the
       root, then in to the tip */
    const sl = Math.max(-1.2, Math.min(1.2, q * dw + 2 * bend * s));
    const ux = La * ax - sl * Wa * ay, uy = La * ay + sl * Wa * ax;
    const ul = Math.sqrt(ux * ux + uy * uy) || 1;
    seen[0] = ux / ul;
    seen[1] = uy / ul;
    seen[2] = s;
    seen[3] = lockAlong(s) * (1 - q * q);
  };
  /* The fine strands first, into a buffer of their own, so the pass after
     can read a strand's neighbours. Along the lock's own way: longer where
     the pile is seen side-on, and shortened by as much of each as the
     curve of the body hides (see foreG). Each strand grows one way from
     its root (see strandW); a pixel lies some way along the strands
     reaching it, 0 at their roots and 1 at their tips — a strand's root is
     in the shade of the tips lying over it and its tip up in the light, so
     a strand reads as lying over the next rather than drawn on the pile. */
  const strandBuf = new Float32Array(Rb * Rb);
  rows(Rb, 32, (y0, y1) => {
    for (let y = y0; y < y1; y++) {
      const Y = (y + 0.5) / px - O;
      for (let x = 0, i = y * Rb; x < Rb; x++, i++) {
        const X = (x + 0.5) / px - O;
        lockSeen(x, y, X, Y, own[i]);
        const ux = seen[0], uy = seen[1];
        /* the surface's tilt and the share of a fibre seen, at one set of
           bilinear weights */
        const gx = Math.min(G - 1, Math.max(0, (X + O) / gu - 0.5)), gy = Math.min(G - 1, Math.max(0, (Y + O) / gu - 0.5));
        const gx0 = Math.min(G - 2, gx | 0), gy0 = Math.min(G - 2, gy | 0), gtx = gx - gx0, gty = gy - gy0, gj = gy0 * G + gx0;
        const tilt = (tiltG[gj] * (1 - gtx) + tiltG[gj + 1] * gtx) * (1 - gty) + (tiltG[gj + G] * (1 - gtx) + tiltG[gj + G + 1] * gtx) * gty;
        const fore = (foreG[gj] * (1 - gtx) + foreG[gj + 1] * gtx) * (1 - gty) + (foreG[gj + G] * (1 - gtx) + foreG[gj + G + 1] * gtx) * gty;
        const L = 2 * Math.max(1, Math.min(strandHalf, Math.round((strandHalf * (0.5 + 0.5 * tilt) * fore) / PILE_COS)));
        const sw = strandW[L];
        let acc = 0, accR = 0;
        for (let t = 0; t <= L; t++) {
          const sx = Math.round(x - ux * t), sy = Math.round(y - uy * t);
          if (sx < 0 || sy < 0 || sx >= Rb || sy >= Rb) {
            acc += strandMean[L] / (L + 1);
            continue;
          }
          const m = white[sy * Rb + sx], f = m * 53.7, Ls = L * (STRAND_SHORT + (1 - STRAND_SHORT) * (f - Math.floor(f)));
          if (t <= Ls) {
            acc += m * sw[t];
            accR += (m * sw[t] * t) / (Ls || 1);
          }
        }
        const strand = (acc - strandMean[L]) / strandSd[L];
        const along = acc > 1e-4 ? accR / acc : 0.5;
        strandBuf[i] = strand + STRAND_RISE * Math.min(2.5, Math.max(0, strand)) * (along - 0.45);
      }
    }
  });
  let lsum = 0, lsum2 = 0;
  rows(Rb, 16, (y0, y1) => {
    const dd = darkImg.data, ld = lightImg.data, gd = glintImg.data, bd = backImg.data, sd2 = softImg.data;
    for (let y = y0; y < y1; y++) {
      const Y = (y + 0.5) / px - O;
      for (let x = 0; x < Rb; x++) {
        const X = (x + 0.5) / px - O;
        const i = y * Rb + x, k = own[i], b = k * LP;
        /* the lock seen here: where along it, and its strands' way */
        lockSeen(x, y, X, Y, k);
        const ux = seen[0], uy = seen[1], s = seen[2], hgt = seen[3];
        /* each strand stands at its own angle, so a highlight breaks up
           along the fibres instead of lying across them as one band */
        fibreLight(X, Y, ux, uy, 0.25 + 0.2 * hgt);
        const nx = fib[4], ny = fib[5], nz = fib[6], nKb = fib[7];
        /* The pile's own surface: the body's, tilted by the slope of the
           pile's height. The slope is read on the screen; on the surface
           it is that slope along the two directions that lie on it — one
           square to the screen's view of the normal (seen full length) and
           one down the surface toward the silhouette (seen shortened by
           how far the surface turns away, so its slope is that much less
           than it looks). */
        const xl0 = x > 0 ? i - 1 : i, xr0 = x < Rb - 1 ? i + 1 : i, yu0 = y > 0 ? i - Rb : i, yd0 = y < Rb - 1 ? i + Rb : i;
        const gx = ((pileH[xr0] - pileH[xl0]) * px) / (xr0 - xl0 || 1), gy = ((pileH[yd0] - pileH[yu0]) * px * Rb) / (yd0 - yu0 || 1);
        const l1 = Math.sqrt(nx * nx + ny * ny);
        let t1x = 1, t1y = 0, t2x = 0, t2y = 1, t2z = 0;
        if (l1 > 1e-3) {
          t1x = -ny / l1;
          t1y = nx / l1;
          t2x = (-nz * nx) / l1;
          t2y = (-nz * ny) / l1;
          t2z = l1;
        }
        const g1 = Math.max(-1.5, Math.min(1.5, gx * t1x + gy * t1y)), g2 = Math.max(-1.5, Math.min(1.5, gx * t2x + gy * t2y));
        let mx = nx - g1 * t1x - g2 * t2x, my = ny - g1 * t1y - g2 * t2y, mz = nz - g2 * t2z;
        const ml = Math.sqrt(mx * mx + my * my + mz * mz) || 1;
        mx /= ml;
        my /= ml;
        mz /= ml;
        /* a fibre catches the key as far as it lies across it: the
           strands' way on the surface, standing a little out of it */
        let kk = 1;
        if (k >= 0) {
          const tx = locks[b + 8], ty = locks[b + 9], tz = locks[b + 10];
          const fx = 0.9 * tx + 0.44 * nx, fy = 0.9 * ty + 0.44 * ny, fz = 0.9 * tz + 0.44 * nz;
          const fK = (fx * K3[0] + fy * K3[1] + fz * K3[2]) / (Math.sqrt(fx * fx + fy * fy + fz * fz) || 1);
          kk = 1 - PILE_KK + PILE_KK * Math.min(1.2, Math.sqrt(Math.max(0, 1 - fK * fK)) / 0.85);
        }
        const nKp = mx * K3[0] + my * K3[1] + mz * K3[2];
        /* the key's shadow: a lock standing higher toward the light, by
           more than the light rises over the distance to it */
        const h0 = pileH[i];
        let sh = 1;
        if (nKb > -0.25) {
          const sinE = Math.min(0.97, Math.max(0.05, nKb)), tanE = sinE / Math.sqrt(1 - sinE * sinE);
          let occ = 0;
          for (let t = 0; t < NSH; t++) {
            const sx = x + shX[t], sy = y + shY[t];
            if (sx < 0 || sy < 0 || sx >= Rb || sy >= Rb) break;
            const o = pileH[sy * Rb + sx] - h0 - shD[t] * tanE;
            if (o > occ) occ = o;
          }
          sh = 1 - PILE_SHADOW * smooth(0, 0.35 * hMax, occ);
        }
        /* the hollows, and a lock's root under the tip lying over it */
        let ao = 1 - PILE_AO * smooth(0, 0.6 * hMax, pileB[i] - h0);
        if (k >= 0) ao *= 1 - PILE_ROOT * (1 - smooth(0, 0.35, s));
        /* the pile against the smooth body, in the same light; the tips
           thin out and let a little more light through */
        const fillP = PILE_AMB + PILE_FILL * Math.max(0, mx * F3[0] + my * F3[1] + mz * F3[2]);
        const fillB = PILE_AMB + PILE_FILL * Math.max(0, nx * F3[0] + ny * F3[1] + nz * F3[2]);
        let r = (ao * (fillP + keyOn(nKp) * sh * kk) * PILE_GAIN) / (fillB + keyOn(nKb));
        if (k >= 0) r *= (1 + 0.15 * s * s) * (1 + 0.08 * (hash2(k, 5) - 0.5));
        /* in a crease between lobes or under the body the room's light
           hardly reaches the roots: the pile sinks into a deeper shade
           there, its hollows most */
        const crease = fib[8];
        r *= 1 - PILE_CREASE * crease * (0.6 + 0.4 * smooth(0, 0.6 * hMax, pileB[i] - h0));
        r = 1 + (r - 1) * depthK;
        /* the smooth body's own light here, as the screen shows it (its
           sRGB value, 1 where the key is full on): the films lighten and
           darken the colour as it is laid there, so the same share of light
           is a smaller step where the body is in shade. Off the body, under
           a turned body's side, an even middle light. */
        const on = fib[9], lq = (fillB + keyOn(nKb)) / PILE_LIT;
        const lbs = (lq >= 1 ? 1 : gamLut[(lq * POW_N) | 0]) * on + 0.75 * (1 - on);
        /* matte: the lit side of a lock lifts the colour, but rolls off
           well before it would turn white — where the body is in shade
           there is room below that, and a lock the key grazes stands out
           of the shade around it the more */
        let m0 = Math.sqrt(r > 2.4 ? 2.4 : r);
        if (m0 > 1) m0 = 1 + (m0 - 1) / (1 + 2.5 * lbs * (m0 - 1));
        /* the fine strands, and the shadow a strand standing over the pile
           casts beside it, away from the key: the key's way along the
           surface, as long as the strand's height over the key's rise
           (longer where it grazes), read between pixels */
        const strand = strandBuf[i];
        let cast = 0;
        if (nKb > 0) {
          const kx = K3[0] - nKb * nx, ky = K3[1] - nKb * ny, kt = Math.sqrt(1 - nKb * nKb);
          const reachS = kt > 1e-3 ? (STRAND_CAST_H * px * Math.min(3, kt / Math.max(0.2, nKb))) / kt : 0;
          const cx = Math.min(Rb - 1.001, Math.max(0, x + kx * reachS)), cy = Math.min(Rb - 1.001, Math.max(0, y + ky * reachS));
          const cx0 = cx | 0, cy0 = cy | 0, tx = cx - cx0, ty = cy - cy0, ci = cy0 * Rb + cx0;
          const caster = (strandBuf[ci] * (1 - tx) + strandBuf[ci + 1] * tx) * (1 - ty) + (strandBuf[ci + Rb] * (1 - tx) + strandBuf[ci + Rb + 1] * tx) * ty;
          cast = Math.max(0, caster - Math.max(0, strand)) * smooth(0, 0.3, nKb);
        }
        let m = m0 * (1 + strandK * (strand * (0.45 + 0.55 * fib[2]) * (0.75 + 0.5 * s) - STRAND_CAST * cast)) + 0.04 * (fib[10] - 0.5) + PILE_BIAS * depthK * on;
        /* toward the film's own edge the pile thins out to nothing, so
           where a body turned far round reaches past it the fur gives way
           softly instead of ending at a straight line */
        const edgeD = Math.min(X + O, FILM_SPAN - O - X, Y + O, FILM_SPAN - O - Y);
        const fadeE = edgeD >= 8 ? 1 : edgeD <= 0 ? 0 : (edgeD / 8) * (edgeD / 8) * (3 - (2 * edgeD) / 8);
        m = 1 + (m - 1) * fadeE;
        const k4 = i * 4;
        /* darker as the gap film's alpha: laid in the colour's own deep
           shade (about GAP_REF of it fully lit, see gapFilm) over the colour
           as lit here (lbs of it), it takes that to m of itself */
        if (m < 1) dd[k4 + 3] = Math.round(255 * Math.min(1, ((1 - m) * lbs) / Math.max(0.4, lbs - GAP_REF)));
        else {
          /* lighter as the tips' film: it lifts the colour as lit here
             toward the tips' (TIP_TOP of the colour fully lit) — fully lit,
             PILE_LIFT per unit of m; in shade a smaller step. In a crease
             the tips stay in its shade too. */
          ld[k4] = ld[k4 + 1] = ld[k4 + 2] = 255;
          ld[k4 + 3] = Math.round(255 * Math.min(1, ((PILE_LIFT * (TIP_TOP - 1) * lbs) / (TIP_TOP - lbs)) * (m - 1) * (1 - 0.7 * crease)));
        }
        /* the lock's height and light at half the resolution */
        const lit = Math.max(-2, Math.min(2, 4 * (m0 - 1)));
        const xl = x >> 1, yl = y >> 1;
        if (xl < Rl && yl < Rl) {
          const j = yl * Rl + xl;
          lock[j] += 0.25 * h0;
          lockLit[j] += 0.25 * lit;
        }
        /* the fibres' own light is on the strands standing out and the
           locks facing the light, not in the gaps between them */
        const tipK = smooth(-0.4, 1, lit) * Math.max(0, Math.min(1.4, 0.65 + 0.25 * strand));
        gd[k4] = gd[k4 + 1] = gd[k4 + 2] = bd[k4] = bd[k4 + 1] = bd[k4 + 2] = 255;
        gd[k4 + 3] = Math.round(255 * Math.min(1, fib[0] * tipK));
        bd[k4 + 3] = Math.round(255 * Math.min(1, fib[1] * Math.max(0, Math.min(1.6, 0.5 + 0.4 * strand))));
        /* the soft back light's glow is soft, but still on the pile: a
           little more on the strands and locks standing out into it than in
           the hollows between them, so it does not lie over them as a mist */
        const onPile = Math.max(0.55, Math.min(1.3, 0.85 + 0.15 * strand + 0.12 * lit));
        sd2[k4] = sd2[k4 + 1] = sd2[k4 + 2] = 255;
        sd2[k4 + 3] = Math.round(255 * Math.min(1, 0.85 * fib[3] * onPile));
      }
    }
  });
  /* the half-resolution height brought to one spread, as the tufts read it */
  steps.push(() => {
    const n = Rl * Rl;
    for (let i = 0; i < n; i++) {
      lsum += lock[i];
      lsum2 += lock[i] * lock[i];
    }
    const mean = lsum / n, sdv = Math.sqrt(Math.max(1e-9, lsum2 / n - mean * mean));
    for (let i = 0; i < n; i++) lock[i] = Math.max(-2.5, Math.min(2.5, (lock[i] - mean) / sdv));
  });
  /* the two parts of the film into their canvases; the strokes after them
     are drawn in the body's square, inside the wider one */
  steps.push(() => {
    dg.putImageData(darkImg, 0, 0);
    lg.putImageData(lightImg, 0, 0);
    gg.putImageData(glintImg, 0, 0);
    sg2.putImageData(softImg, 0, 0);
    bg.putImageData(backImg, 0, 0);
    for (const g of [dg, lg, gg, bg]) {
      g.setTransform(1, 0, 0, 1, FILM_M * px, FILM_M * px);
      g.lineCap = 'round';
      g.lineJoin = 'round';
    }
  });

  /* 2. single hairs over the fleece, at two scales. Guard hairs: sparse,
     longer fibres combed with the flow but messily. Fine hairs: many short
     single fibres, crisp, of mixed length and curl, gathered in twos and
     threes, most up in the light and a few deeper in the pile and darker —
     only on a pile large enough to hold them (finer than its pixels they
     would only be noise), and crowding toward the outline as the surface
     turns away. Each runs from its root, deep in the pile and in its
     shade, to its tip, up in the light; one standing proud of the pile
     hides the gaps beneath it and casts a thin shadow onto the pile beside
     it, away from the key — none at the root, where it meets the pile, and
     furthest off at the tip. Strokes are bucketed by shade, so a kind is a
     few dozen stroke calls however many hairs it draws. */
  const SHADES = 16;
  /* rooted over the film's whole square, not only the body's: turned, the
     body's side shows past the front's outline, and the film laid over it
     must carry the same hairs there or the pile would end at a seam */
  const area = FILM_SPAN * FILM_SPAN;
  const fine = R >= 512 ? 1 : R >= 320 ? 0.45 : 0;
  /* count: per unit² of the square (times the density); len, vary: the
     base length and how much longer at most, in units; endOn: how much
     shorter it looks where the surface faces the viewer, standing out of
     it toward the eye; width: in units; spread, alpha: the shades' range
     and strength, and deep: how much of it the shaded hairs keep — one
     dye, so a hair in shade is only a little deeper than the gaps around
     it, where one in the light stands out; lift: how far into the light
     the kind sits; light, dark: the shares of hairs catching the light and
     of those in shade; bend: how wavy; clump, clumpW: how many hairs
     gather into one (at least, and up to how many more) and how wide their
     roots spread, in units; shadow, shadowW: how far a clump's shadow
     falls, in units, and how wide it is against a hair; over: how much of
     the gaps it hides; crowd: denser where the surface turns away; short:
     how much finer and fainter it is on a shorter pile, whose hairs stand
     lower and thinner (a velvet's are barely seen) */
  const kinds = [
    { count: 0.12, len: 1.2, vary: 1.0, endOn: 0.6, width: 0.09, spread: 30, alpha: 0.4, deep: 1, lift: 0.25, light: 0.46, dark: 0.34, bend: 0.93, clump: [1, 0], clumpW: 0, shadow: 0, shadowW: 1, over: 0, crowd: false, short: 0 },
    { count: 0.4 * fine, len: 0.9, vary: 1.2, endOn: 0.35, width: 0.13, spread: 100, alpha: 0.26, deep: 0.2, lift: 0.18, light: 0.55, dark: 0.06, bend: 1.2, clump: [1, Math.round(1 + 2 * clumps)], clumpW: 0.08 + 0.07 * clumps, shadow: 0.25, shadowW: 2, over: 0.25, crowd: true, short: 1 },
  ];
  const shadeOf = (v: number) => Math.min(SHADES - 1, Math.max(0, Math.round(((Math.max(-1, Math.min(1, v)) + 1) / 2) * (SHADES - 1))));
  /* the fibres that catch the key or the back light, by how much: their
     tips drawn again into the fibres' own light, crisp single hairs */
  const GLINTS = 6;
  const glintOf = (v: number) => Math.min(GLINTS - 1, (v * GLINTS) | 0);
  /* a hair's points from root to tip, on a cubic through two bends */
  const SEGS = 4;
  const hx = new Float32Array(SEGS + 1), hy = new Float32Array(SEGS + 1);
  for (const L of kinds) {
    if (L.count <= 0) continue;
    /* a dense kind goes in more, smaller steps, so no one idle task runs
       long enough to cost a frame */
    const perRoot = L.clump[0] + 0.5 * L.clump[1];
    const parts = Math.max(1, Math.ceil((area * L.count * kDen * (L.crowd ? 2 : 1) * (0.5 + 0.5 * perRoot)) / 9000));
    for (let part = 0; part < parts; part++) steps.push(() => {
    const buckets: Path2D[] = [], glints: Path2D[] = [], backs: Path2D[] = [], shades: Path2D[] = [];
    for (let i = 0; i < SHADES; i++) buckets.push(new Path2D());
    for (let i = 0; i < GLINTS; i++) glints.push(new Path2D()), backs.push(new Path2D());
    for (let i = 0; i < 3; i++) shades.push(new Path2D());
    const over = new Path2D();
    /* crowding: twice the tries, kept as the surface faces away */
    const count = Math.round((area * L.count * kDen * (L.crowd ? 2 : 1)) / parts);
    for (let n = 0; n < count; n++) {
      const X = rand() * FILM_SPAN - O, Y = rand() * FILM_SPAN - O;
      const r0 = rand(), r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand(), r5 = rand();
      /* toward the film's own edge the hairs thin out with the fleece */
      if (r5 * 8 > Math.min(X + O, FILM_SPAN - O - X, Y + O, FILM_SPAN - O - Y)) continue;
      if (L.crowd && r5 > (sdAt(X, Y) > 0 ? 0.5 / Math.max(0.25, gridAt(nZg, X, Y)) : 0.5)) continue;
      /* with the strand as seen (see pfX): where the surface faces the
         viewer a standing fibre is seen end-on and looks short; where it
         turns away it is seen side-on, at full length along the outline
         and foreshortened across it */
      const [fx, fy] = dirAt(X, Y);
      const tiltS = gridAt(tiltG, X, Y), vl = gridAt(foreG, X, Y) / PILE_COS;
      const ang = (r1 - 0.5) * (0.6 + 0.8 * curl) * (1 - 0.5 * tiltS);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const ux = fx * ca - fy * sa, uy = fx * sa + fy * ca;
      /* mostly the kind's length, now and then one half as long again */
      const longer = r2 < 0.1 ? 1.35 + 0.6 * r3 : 1;
      const len = (L.len + L.vary * r3 * r3) * px * kLen * longer * vl * (1 - L.endOn + 1.25 * L.endOn * tiltS);
      /* lit by the key where it reaches the pile, in shade where it does
         not, and deeper in a crease or under the body */
      fibreLight(X, Y, ux, uy, 0.1 + 0.5 * hash2(n, 7 + part));
      /* the clump's own shade: its lock's light and height, and whether it
         is one catching the light — only where the key reaches: on the
         shade side a hair standing out of the pile is no lighter than it —
         or one deeper in the pile */
      let v = 0.22 * lockAt(lock, X, Y) + 0.3 * lockAt(lockLit, X, Y);
      const lit = r0 < L.light * (0.4 + 0.6 * fib[2]);
      if (lit) v += 0.2 + 0.28 * r4;
      else if (r0 < L.light + L.dark) v -= 0.2 + 0.28 * r4;
      v += L.lift;
      /* a hair up in the light is only as light as the key makes it there */
      v += 0.45 * (fib[2] - 0.5) - 0.35 * fib[8];
      if (v > 0) v *= 0.3 + 0.7 * fib[2];
      /* and in the shade the pile's depth shows the more: its roots deeper */
      const deepen = 0.15 * (1 - fib[2]);
      const x0 = (X + PAD) * px, y0 = (Y + PAD) * px;
      /* the two bends: mostly one arc, now and then an S */
      const b1 = (rand() - 0.5) * L.bend * curl * len, b2 = r4 < 0.3 ? -0.6 * b1 : b1 * (0.6 + 0.8 * rand());
      /* a clump: hairs rooted side by side across the flow, gathering
         toward one tip, as the fibres of a small lock cling together */
      const hairs = L.clump[0] + ((rand() * (L.clump[1] + 1)) | 0);
      const wC = L.clumpW * px * Math.min(1.5, kLen);
      for (let k = 0; k < hairs; k++) {
        const o = hairs > 1 ? rand() - 0.5 : 0, f = hairs > 1 ? 0.7 + 0.3 * rand() : 1, j = hairs > 1 ? (rand() - 0.5) * 0.3 : 0;
        const rx = x0 - uy * o * wC, ry = y0 + ux * o * wC;
        const lk = len * f, e1 = b1 + j * lk, e2 = b2 + j * lk - o * wC * 0.7;
        const c1x = rx + ux * lk * 0.33 - uy * e1, c1y = ry + uy * lk * 0.33 + ux * e1;
        const c2x = rx + ux * lk * 0.67 - uy * e2, c2y = ry + uy * lk * 0.67 + ux * e2;
        const x1 = rx + ux * lk - uy * (b2 - o * wC * 0.75), y1 = ry + uy * lk + ux * (b2 - o * wC * 0.75);
        /* a short hair needs fewer pieces to bend and shade along */
        const sg = lk < 4 ? 2 : lk < 10 ? 3 : SEGS;
        for (let s = 0; s <= sg; s++) {
          const t = s / sg, q = 1 - t;
          const a = q * q * q, b = 3 * q * q * t, c = 3 * q * t * t, d = t * t * t;
          hx[s] = a * rx + b * c1x + c * c2x + d * x1;
          hy[s] = a * ry + b * c1y + c * c2y + d * y1;
        }
        /* root in the pile's shade, tip in the light — risen out of it as
           far as the key lights it; each hair of a clump a shade of its own */
        const vh = v + (hairs > 1 ? (rand() - 0.5) * 0.25 : 0), rise = 0.3 + 0.15 * fib[2];
        for (let s = 0; s < sg; s++) {
          const bk = buckets[shadeOf(vh - 0.3 - deepen * (1 - s / sg) + (rise * (s + 0.5)) / sg)];
          bk.moveTo(hx[s], hy[s]);
          bk.lineTo(hx[s + 1], hy[s + 1]);
        }
        if (lit && L.over > 0) {
          over.moveTo(hx[1], hy[1]);
          for (let s = 2; s <= sg; s++) over.lineTo(hx[s], hy[s]);
        }
        /* the clump's shadow, once, along its middle hair */
        if (k === 0 && L.shadow > 0 && fib[2] > 0.25 && v > -0.2) {
          const kk = L.shadow * px * Math.min(1, kLen), sh = shades[Math.min(2, ((fib[2] - 0.25) * 4) | 0)];
          for (let s = 1; s <= sg; s++) {
            const t = s / sg, ox = -Lx * kk * t, oy = -Ly * kk * t + 0.3 * kk * t;
            if (s === 1) sh.moveTo(hx[0], hy[0]);
            sh.lineTo(hx[s] + ox, hy[s] + oy);
          }
        }
        const h = sg >> 1;
        if (fib[0] > 0.3) {
          const gb = glints[glintOf(fib[0])];
          gb.moveTo(hx[h], hy[h]);
          for (let s = h + 1; s <= sg; s++) gb.lineTo(hx[s], hy[s]);
        }
        if (fib[1] > 0.1) {
          const bb = backs[glintOf(fib[1])];
          bb.moveTo(hx[h], hy[h]);
          for (let s = h + 1; s <= sg; s++) bb.lineTo(hx[s], hy[s]);
        }
      }
    }
    const shortK = Math.min(1, kLen) ** L.short;
    const lw = Math.max(0.45, L.width * px * (0.5 + 0.5 * shortK));
    /* first what the hairs hide and the shadows they cast, then the hairs */
    if (L.over > 0) {
      dg.globalCompositeOperation = 'destination-out';
      dg.lineWidth = lw;
      dg.globalAlpha = L.over * shortK;
      dg.strokeStyle = '#000';
      dg.stroke(over);
      dg.globalCompositeOperation = 'source-over';
    }
    if (L.shadow > 0) {
      /* a clump's shadow is soft: wider than a hair, and faint */
      dg.lineWidth = lw * L.shadowW;
      dg.strokeStyle = '#000';
      for (let i = 0; i < 3; i++) {
        dg.globalAlpha = 0.03 * (i + 1) * shortK;
        dg.stroke(shades[i]);
      }
    }
    /* a grey stroke as the film's black or white at the matching alpha */
    for (let i = 0; i < SHADES; i++) {
      const v = FUR_MID + ((i / (SHADES - 1)) * 2 - 1) * L.spread;
      const g = v < FUR_MID ? dg : lg;
      g.lineWidth = lw;
      g.globalAlpha = L.alpha * shortK * (v < FUR_MID ? L.deep * (1 - v / FUR_MID) : (v - FUR_MID) / (255 - FUR_MID));
      g.strokeStyle = v < FUR_MID ? '#000' : '#fff';
      g.stroke(buckets[i]);
    }
    for (const g of [gg, bg]) {
      g.lineWidth = lw;
      g.strokeStyle = '#fff';
    }
    for (let i = 0; i < GLINTS; i++) {
      gg.globalAlpha = (0.4 * (i + 0.5)) / GLINTS;
      bg.globalAlpha = (0.8 * (i + 0.5)) / GLINTS;
      gg.stroke(glints[i]);
      bg.stroke(backs[i]);
    }
    dg.globalAlpha = lg.globalAlpha = gg.globalAlpha = bg.globalAlpha = 1;
    });
  }

  /* 3. the fuzz: fibres rooted just inside the edge, standing out past it —
     many, very fine, of mixed length (mostly short, a few long), leaning
     with the flow, so the edge is a soft haze rather than a comb */
  const fringe = new Path2D();
  /* the same hairs again, by how much of the back light they carry: the
     edge's hairs stand free of the body, so on its side they glow */
  const fringeBack: Path2D[] = [];
  for (let i = 0; i < GLINTS; i++) fringeBack.push(new Path2D());
  /* tried only in the form's cells along the outline, where a hair can
     root: as many tries per unit of that band as over the whole square */
  const cells: number[] = [];
  const cu = SPAN / N;
  let edgeTries = 0;
  /* the path is built over two steps (the same draws in the same order, so
     the same hairs) and stroked whole in a third, so no one idle task runs
     long */
  const FRINGE_PARTS = 2;
  for (let part = 0; part < FRINGE_PARTS; part++) steps.push(() => {
  if (part === 0) {
    for (let i = 0; i < N * N; i++) if (form.sd[i] > -1.6 && form.sd[i] < 2.2) cells.push(i);
    /* fewer on a small pile, whose hairs are finer than its pixels, and
       where the pile is fine enough for the tufts (below) to carry the
       silhouette */
    edgeTries = Math.round(cells.length * cu * cu * 24 * (0.3 + 1.4 * fuzz) * Math.sqrt(kDen) * (0.5 + 0.5 * Math.min(1, R / 512)) * (1 - 0.55 * fine));
  }
  const n1 = Math.floor((edgeTries * (part + 1)) / FRINGE_PARTS);
  for (let n = Math.floor((edgeTries * part) / FRINGE_PARTS); n < n1; n++) {
    const c = cells[(rand() * cells.length) | 0];
    const X = ((c % N) + rand()) * cu - PAD, Y = (((c / N) | 0) + rand()) * cu - PAD;
    const d0 = sdAt(X, Y);
    if (d0 < -1.2 || d0 > 1.8) continue;
    const d = d0 + tuftAt(X, Y);
    if (d < -0.2 || d > 1.2) continue;
    const [fx, fy] = flow(X, Y);
    const [ox, oy] = outward(X, Y);
    const ang = (rand() - 0.5) * 1.1;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let ux = fx * ca - fy * sa, uy = fx * sa + fy * ca;
    const r1 = rand();
    /* hanging hairs are longer below and at the sides than on top */
    const hang = 1 + 0.5 * gravity * Math.max(0, oy) - 0.35 * gravity * Math.max(0, -oy);
    let fl = (0.3 + 1.5 * r1 * r1 * r1) * px * kLen * (0.5 + fuzz) * hang;
    const x0 = (X + PAD) * px, y0 = (Y + PAD) * px;
    let bend = (rand() - 0.5) * 1.17 * curl * fl;
    /* a few flyaways on top: out over the edge, then arching down */
    if (oy < -0.3 && rand() < 0.06 * (0.3 + fuzz)) {
      ux = ox * 0.8 + (rand() - 0.5) * 0.6;
      uy = oy * 0.8;
      fl *= 1.2;
      bend = (rand() < 0.5 ? -1 : 1) * (0.25 + 0.3 * gravity) * fl;
    }
    fringe.moveTo(x0, y0);
    /* and the tip sags a little more under its own weight */
    const qx = x0 + ux * fl * 0.5 - uy * bend, qy = y0 + uy * fl * 0.5 + ux * bend, ex = x0 + ux * fl, ey = y0 + uy * fl + gravity * fl * 0.25;
    fringe.quadraticCurveTo(qx, qy, ex, ey);
    fibreLight(X, Y, ux, uy, 0.3);
    if (fib[1] > 0.08) {
      const fb = fringeBack[glintOf(fib[1])];
      fb.moveTo(x0, y0);
      fb.quadraticCurveTo(qx, qy, ex, ey);
    }
  }
  });
  /* The silhouette is made of locks: tufts of hairs standing past it, each
     a few hairs from roots side by side just inside the outline that leave
     the surface standing out, bend over with the flow and the pull of
     gravity, and gather toward one tip, as a lock's hairs cling together.
     Seen against the backdrop they are single strands, where the haze
     between them is thin. Spaced about a lock apart along the outline,
     rooted where a lock is rather than in the gaps between them. */
  /* the tufts' hairs whole (for the halo), and their outer halves by how
     far the key lights them (for the tips' film) */
  const tufts = new Path2D(), tuftTips = [new Path2D(), new Path2D(), new Path2D()];
  const tuftBack: Path2D[] = [];
  for (let i = 0; i < GLINTS; i++) tuftBack.push(new Path2D());
  steps.push(() => {
    const band = cells.length * cu * cu, around = band / 3.8;
    const count = Math.round((around / (0.45 + 0.3 * kLen)) * (0.3 + 0.8 * fuzz) * Math.sqrt(kDen) * (1 + 0.6 * fine));
    for (let n = 0, tries = 0; n < count && tries < 6 * count; tries++) {
      const c = cells[(rand() * cells.length) | 0];
      const X = ((c % N) + rand()) * cu - PAD, Y = (((c / N) | 0) + rand()) * cu - PAD;
      const r0 = rand(), r1 = rand(), r2 = rand(), r3 = rand();
      const d0 = sdAt(X, Y);
      if (d0 < -0.5 || d0 > 1.6) continue;
      const d = d0 + tuftAt(X, Y);
      if (d < 0 || d > 0.9) continue;
      if (lockAt(lock, X, Y) < -0.4 + 0.8 * r3) continue;
      n++;
      const [fx, fy] = flow(X, Y);
      const [ox, oy] = outward(X, Y);
      /* it leaves the surface standing out, then bends over with the flow
         and down; the tuft leans its own way */
      const a = (r0 - 0.5) * 0.8 * (0.5 + curl), ca = Math.cos(a), sa = Math.sin(a);
      let sx = 0.75 * ox + 0.25 * fx, sy = 0.75 * oy + 0.25 * fy;
      let ex = 0.55 * fx + 0.45 * ox, ey = 0.55 * fy + 0.45 * oy + 0.35 * gravity;
      const sl = Math.hypot(sx, sy) || 1, el = Math.hypot(ex, ey) || 1;
      [sx, sy] = [(sx * ca - sy * sa) / sl, (sx * sa + sy * ca) / sl];
      [ex, ey] = [(ex * ca - ey * sa) / el, (ex * sa + ey * ca) / el];
      const hang = 1 + 0.5 * gravity * Math.max(0, oy) - 0.35 * gravity * Math.max(0, -oy);
      const Lt = (0.5 + 1.1 * r1 * r1) * px * kLen * (0.5 + fuzz) * hang;
      const wT = (0.3 + 0.35 * r2) * px * Math.min(1.5, kLen);
      const x0 = (X + PAD) * px, y0 = (Y + PAD) * px;
      const cx = x0 + sx * Lt * 0.5, cy = y0 + sy * Lt * 0.5;
      const tx = x0 + (sx * 0.4 + ex * 0.6) * Lt, ty = y0 + (sy * 0.4 + ey * 0.6) * Lt;
      const qx = -sy, qy = sx;
      fibreLight(X, Y, ex, ey, 0.4);
      const fb = fib[1] > 0.08 ? tuftBack[glintOf(fib[1])] : null;
      const tt = tuftTips[Math.min(2, (fib[2] * 3) | 0)];
      const hairs = 4 + ((rand() * 5) | 0);
      for (let k = 0; k < hairs; k++) {
        const o = rand() - 0.5, f = 0.7 + 0.3 * rand(), w = (rand() - 0.5) * 0.35;
        const hx0 = x0 + qx * o * wT, hy0 = y0 + qy * o * wT;
        const hcx = cx + qx * o * wT * 0.6, hcy = cy + qy * o * wT * 0.6;
        const htx = hx0 + (tx + qx * (o * 0.25 + w) * wT - hx0) * f, hty = hy0 + (ty + qy * (o * 0.25 + w) * wT - hy0) * f;
        tufts.moveTo(hx0, hy0);
        tufts.quadraticCurveTo(hcx, hcy, htx, hty);
        /* the outer half, up in the light, for the tips' film */
        const mx = 0.25 * hx0 + 0.5 * hcx + 0.25 * htx, my = 0.25 * hy0 + 0.5 * hcy + 0.25 * hty;
        tt.moveTo(mx, my);
        tt.quadraticCurveTo(0.5 * (hcx + htx), 0.5 * (hcy + hty), htx, hty);
        if (fb) {
          fb.moveTo(mx, my);
          fb.quadraticCurveTo(0.5 * (hcx + htx), 0.5 * (hcy + hty), htx, hty);
        }
      }
    }
  });
  steps.push(() => {
  /* the tufts: their tips a touch lighter, clear of the gaps' shade */
  const tw = Math.max(0.4, 0.11 * px);
  dg.lineWidth = lg.lineWidth = bg.lineWidth = tw;
  dg.globalCompositeOperation = 'destination-out';
  dg.globalAlpha = 0.6;
  dg.strokeStyle = '#000';
  lg.strokeStyle = '#fff';
  for (let i = 0; i < 3; i++) {
    dg.stroke(tuftTips[i]);
    lg.globalAlpha = 0.08 + 0.11 * i;
    lg.stroke(tuftTips[i]);
  }
  dg.globalCompositeOperation = 'source-over';
  bg.strokeStyle = '#fff';
  for (let i = 0; i < GLINTS; i++) {
    bg.globalAlpha = (i + 0.5) / GLINTS;
    bg.stroke(tuftBack[i]);
  }
  dg.globalAlpha = lg.globalAlpha = bg.globalAlpha = 1;
  /* the edge hairs are seen side-on against the light: a touch lighter,
     and clear of the gaps' shade the film holds where they stand */
  lg.lineWidth = dg.lineWidth = Math.max(0.35, 0.08 * px);
  lg.globalAlpha = 0.5 * ((140 - FUR_MID) / (255 - FUR_MID));
  lg.strokeStyle = '#fff';
  lg.stroke(fringe);
  lg.globalAlpha = 1;
  bg.lineWidth = lg.lineWidth;
  bg.strokeStyle = '#fff';
  for (let i = 0; i < GLINTS; i++) {
    bg.globalAlpha = (i + 0.5) / GLINTS;
    bg.stroke(fringeBack[i]);
  }
  bg.globalAlpha = 1;
  dg.globalCompositeOperation = 'destination-out';
  dg.globalAlpha = 0.7;
  dg.strokeStyle = '#000';
  dg.stroke(fringe);
  dg.globalAlpha = 1;
  dg.globalCompositeOperation = 'source-over';
  });

  /* 4. the halo: the body's coverage, laid over the silhouette of the
     whole turned body. Solid inside, to the outline; past it the pile's
     outermost tips, a haze of fine hairs thinning outward — drawn out
     along the flow from the same sparse noise as the fleece's strands, so
     it is streaked with hairs rather than blurred — sparse enough at its
     edge to see the backdrop through, with the fuzz's longer hairs
     standing in it. The tufts push it out and pull it in, so the
     silhouette breaks into soft bumps. */
  const mi = new ImageData(R, R), zi = new ImageData(R, R), ci = new ImageData(R, R);
  const hOut = 0.5 + 1.2 * fuzz, reachOut = hOut + tuftK;
  /* where the pile is fine enough to show single strands, the haze between
     the tufts is thinner and more streaked: strands with the backdrop
     between them, not a mist */
  const haloA = HALO_A * (1 - 0.6 * fine), haloStreak = HALO_STREAK * (1 + 1.2 * fine);
  /* the halo's hairs are seen whole, standing free: drawn out further
     than the fleece's strands */
  const hn = Math.max(1, Math.round(HALO_HAIR * kLen * px)), hs1 = hn + 1;
  const hsd = (W_SD * Math.sqrt(1 + (hn * (2 * hn + 1)) / (3 * hs1))) / hs1;
  const off = Math.round(FILM_M * px);
  rows(R, 64, (y0, y1) => {
    const md = mi.data, zd = zi.data, cd = ci.data;
    for (let y = y0; y < y1; y++) {
      const Y = (y + 0.5) / px - PAD;
      for (let x = 0; x < R; x++) {
        const X = (x + 0.5) / px - PAD;
        const k = (y * R + x) * 4;
        md[k] = md[k + 1] = md[k + 2] = zd[k] = zd[k + 1] = zd[k + 2] = 255;
        const d0 = sdAt(X, Y);
        if (d0 >= tuftK + HALO_CORE) {
          md[k + 3] = cd[k + 3] = 255;
          continue;
        }
        const d = d0 <= -reachOut ? d0 : d0 + tuftAt(X, Y);
        if (d >= 0) {
          md[k + 3] = 255;
          cd[k + 3] = Math.round(255 * smooth(0.25 * HALO_CORE, HALO_CORE, d));
          continue;
        }
        /* past the outline the hairs are lit, the further out the more */
        const z = Math.min(1, -d / (2 * hOut));
        /* most where the halo faces the back light: there its hairs glow */
        const nB = gridAt(nXg, X, Y) * B3[0] + gridAt(nYg, X, Y) * B3[1];
        zd[k + 3] = Math.round(255 * HALO_LIFT * z * z * (3 - 2 * z) * (0.45 + 0.55 * smooth(-0.3, 0.6, nB)));
        if (d <= -hOut) continue;
        const o = 1 + d / hOut, f = o * o * (3 - 2 * o);
        const [ux, uy] = freeDirAt(X, Y);
        let acc = 0;
        for (let t = -hn; t <= hn; t++) {
          const sx = Math.round(x + off + ux * t), sy = Math.round(y + off + uy * t);
          acc += (sx < 0 || sy < 0 || sx >= Rb || sy >= Rb ? W_MEAN : white[sy * Rb + sx]) * (1 - Math.abs(t) / hs1);
        }
        const strand = (acc / hs1 - W_MEAN) / hsd;
        md[k + 3] = Math.round(255 * Math.max(0, Math.min(1, f * (haloA + haloStreak * strand))));
      }
    }
  });
  steps.push(() => {
  const zc = makeCanvas(R), zg = zc && ctx2d(zc, false);
  if (zc && zg) {
    zg.putImageData(zi, 0, 0);
    fur.haze = zc;
  }
  mg.putImageData(mi, 0, 0);
  mg.lineCap = 'round';
  mg.lineWidth = Math.max(0.35, 0.08 * px);
  mg.strokeStyle = 'rgba(255,255,255,0.45)';
  mg.stroke(fringe);
  /* the tufts, whole strands */
  mg.lineWidth = Math.max(0.4, 0.11 * px);
  mg.strokeStyle = 'rgba(255,255,255,0.8)';
  mg.stroke(tufts);
  const oc = makeCanvas(R), og = oc && ctx2d(oc, false);
  if (oc && og) {
    og.putImageData(ci, 0, 0);
    fur.core = oc;
  }

  fur.dark = dc;
  fur.light = lc;
  fur.glint = gc;
  fur.back = bc;
  fur.backSoft = sc2;
  fur.mask = mc;
  file(fur);
  });

  return { steps };
}

/* the halo's complement, made the first time a turn needs it and kept */
function furCut(fur: Fur): AnyCanvas | null {
  if (fur.cut || !fur.mask) return fur.cut;
  const R = fur.mask.width, cc = makeCanvas(R), cg = cc && ctx2d(cc, false);
  if (cc && cg) {
    cg.fillRect(0, 0, R, R);
    cg.globalCompositeOperation = 'destination-out';
    cg.drawImage(fur.mask as HTMLCanvasElement, 0, 0);
    fur.cut = cc;
  }
  return fur.cut;
}

/** The lit sphere for the pile, as a studio photograph of a plush toy
    lights it: a clear key high on the light's side with a soft but
    readable terminator and a real shade side (about 4:1), the shade the
    colour deepened rather than greyed, a saturated band where the key
    turns into shade (light that has passed through dyed fibres), a sheen
    where the fibres at the lit side's silhouette lie side-on to the key,
    and a strong back light: from behind, above and away from the key, it
    catches the pile all along the silhouette as a bright rim — the colour
    at full brightness, whitening toward the outermost hairs — widest over
    the top and on the side away from the key. No specular lobe and no
    reflections — fur has no clear coat; its own fibre highlights are in
    the pile's film (see furJob). */
export function buildFabricMatcap(out: Float32Array, c: V3, f: Frame, p: Material) {
  const { V, U, D } = f;
  const vivid = p.vivid ?? 0, px: V3 = [0, 0, 0];
  const L = fabricKey(U, V, p.front);
  const Lb = fabricBack(f.K, V);
  /* the shade side: a little ambient from the room and a dim fill from the
     other side and the front; `shadow` takes both down, so the key to fill
     ratio runs from about 2:1 to 6:1 */
  const amb = Math.max(0.03, 0.2 - 0.15 * p.shadow);
  const fillK = Math.max(0.04, 0.24 - 0.13 * p.shadow);
  /* the key wraps a little past the terminator — the pile scatters it —
     and more toward the silhouette, where the fibres stand in the light */
  const wrap = Math.min(0.7, 0.05 + 0.12 * p.spread);
  const kd = 1.3;
  const floorK = 0.34 * Math.min(1.6, p.shadow / 0.35);
  const Fl = norm3([-0.55 * U[0] + 0.85 * V[0] + 0.15 * D[0], -0.55 * U[1] + 0.85 * V[1] + 0.15 * D[1], -0.55 * U[2] + 0.85 * V[2] + 0.15 * D[2]]);
  /* `sheen` scales the smooth light — the key's sheen and the back light's
     band laid as one even gradient over the body's edge, a satin look —
     not the light the fibres themselves carry (the pile's film, the halo) */
  const satin = p.sheen ?? 0;
  const backSoft = Math.min(1, Math.max(0, p.backSoft ?? BACK_SOFT));
  const sheenK = 0.16 * p.highlight * satin, rimK = 1.15 * p.rim * satin, sssK = 0.2 + 0.25 * vivid;
  /* the colour at full brightness, and the key's sheen: mostly the colour,
     a quarter of the light's own white */
  const mx = Math.max(c[0], c[1], c[2], 0.02);
  const cb: V3 = [c[0] / mx, c[1] / mx, c[2] / mx];
  /* the back light through the pile: carried through the dyed fibres it
     comes out in their colour at full brightness — only the outermost
     hairs, thin and seen against it, pass some of its white */
  const rimIn: V3 = [cb[0], cb[1], cb[2]];
  /* past the palette's saturation (vivid) the light's white gives way to
     the colour itself */
  const wR = 0.45 * (1 - vivid), wS = 0.25 * (1 - vivid);
  const rimOut: V3 = [wR + (1 - wR) * cb[0], wR + (1 - wR) * cb[1], wR + (1 - wR) * cb[2]];
  const sheenC: V3 = [wS + (1 - wS) * cb[0], wS + (1 - wS) * cb[1], wS + (1 - wS) * cb[2]];
  /* the shade's colour: the body's twice filtered through its own dye —
     deeper in hue, as a dyed pile is in its shade — brought back to the
     body's luminance, so how dark the shade is stays the light's to say */
  const yOf = (v: V3) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  /* past the palette's saturation (vivid) the shade is richer still */
  const de = 1.8 + 2.2 * vivid;
  const d0: V3 = [Math.pow(c[0], de), Math.pow(c[1], de), Math.pow(c[2], de)];
  const dk = yOf(c) / Math.max(1e-4, yOf(d0));
  const deep: V3 = [d0[0] * dk, d0[1] * dk, d0[2] * dk];
  /* and the band at the terminator: light that has passed through the
     fibres, the colour filtered once more */
  const sc: V3 = [cb[0] * cb[0] * c[0], cb[1] * cb[1] * c[1], cb[2] * cb[2] * c[2]];
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      let nx = (i / (M - 1)) * 2 - 1, ny = (j / (M - 1)) * 2 - 1;
      let r2 = nx * nx + ny * ny;
      if (r2 > 1.14) continue;
      if (r2 > 1) {
        const s = 1 / Math.sqrt(r2);
        nx *= s; ny *= s; r2 = 1;
      }
      const nz = Math.sqrt(1 - r2);
      const nl = nx * L[0] + ny * L[1] + nz * L[2];
      const nv = Math.max(0, nx * V[0] + ny * V[1] + nz * V[2]);
      const nd = nx * D[0] + ny * D[1] + nz * D[2];
      const nb = nx * Lb[0] + ny * Lb[1] + nz * Lb[2];
      const q = 1 - nv;
      const w = wrap + (0.45 - wrap) * q * q;
      let dif = Math.min(1, Math.max(0, (nl + w) / (1 + w)));
      dif = Math.pow(dif, 1.35);
      const fill = fillK * Math.max(0, nx * Fl[0] + ny * Fl[1] + nz * Fl[2]);
      const floor = 1 - floorK * Math.max(0, nd) * (0.6 + 0.4 * q);
      const light = (amb + kd * dif + fill) * floor;
      /* toward the shade the colour deepens rather than greys */
      const t = Math.min(1, Math.max(0, 1 - light));
      const sb = Math.max(0, 1 - ((nl + 0.08) * (nl + 0.08)) / 0.18);
      const sss = sssK * sb * sb * floor;
      /* the key's sheen on the lit side where the fibres lie side-on to it */
      const lit = Math.min(1, Math.max(0, (nl + 0.2) / 0.8));
      const sheen = sheenK * q * q * lit;
      /* the back light: where the pile faces it at all (the fibres scatter
         it a little round), seen through the most pile toward the
         silhouette; the underside, facing the floor, catches little */
      const bl = smooth(-0.3, 0.6, nb);
      const rq = smooth(0.18 - 0.12 * backSoft, 0.62 + 0.18 * backSoft, q);
      const rim = rimK * rq * Math.sqrt(rq) * (0.3 + 0.7 * bl) * (1 - 0.7 * Math.max(0, nd));
      const hot = rq * rq * Math.sqrt(rq) * (1 - 0.5 * backSoft);
      const k = (j * M + i) * 3;
      let r = 0, g = 0, b = 0;
      for (let ch = 0; ch < 3; ch++) {
        const base = c[ch] + (deep[ch] - c[ch]) * t * 0.9;
        const v = base * light + sss * sc[ch] + sheen * sheenC[ch] + rim * (rimIn[ch] + (rimOut[ch] - rimIn[ch]) * hot);
        if (ch === 0) r = v;
        else if (ch === 1) g = v;
        else b = v;
      }
      /* bright parts roll off as a whole, not channel by channel: a lit
         yellow stays yellow instead of its red clipping first and the rest
         running on toward green */
      const m = Math.max(r, g, b);
      if (m > 0.8) {
        const kk = (0.8 + 0.2 * (1 - Math.exp(-(m - 0.8) / 0.2))) / m;
        r *= kk;
        g *= kk;
        b *= kk;
      }
      /* past the palette's saturation, more colour at the same luminance,
         under full: a brighter channel would only be rolled off again */
      if (vivid > 0) {
        px[0] = r;
        px[1] = g;
        px[2] = b;
        vivify(px, vivid, 1);
        [r, g, b] = px;
      }
      out[k] = srgb(r);
      out[k + 1] = srgb(g);
      out[k + 2] = srgb(b);
    }
  }
}

/* The gaps between locks and strands are the pile's own colour in shade —
   a dyed fibre deepens and warms there, it does not grey — so the film's
   dark part is laid in a deep, richer shade of the body colour rather
   than black: one copy per pile and colour, made on first use. A gap is
   shade inside the pile, a share of whatever light reaches that point of
   the body, so it must darken the lit side and the shade side alike: its
   shade is darker than the body's own shade side (about GAP_DEEP of the
   colour, deeper still in hue), so a gap there deepens it rather than
   lighting it up. A light, pale dye lets the light scatter far down into
   the pile and fill its depths in, where a dark or strong one swallows
   it: the lighter and paler the colour, the lighter its gaps
   (GAP_SCATTER), so a cream pile reads warm and soft rather than dirty. */
const GAP_DEEP = 0.28, GAP_SCATTER = 0.42;
const gapFilms = new WeakMap<Fur, Map<string, AnyCanvas | null>>();
function gapFilm(fur: Fur, color: string, vivid = 0): AnyCanvas | null {
  const src = fur.dark;
  if (!src) return null;
  let byColor = gapFilms.get(fur);
  if (!byColor) gapFilms.set(fur, (byColor = new Map()));
  const vq = Math.round(Math.min(1, vivid) * 10) / 10;
  const key = `${color}|${vq}`;
  const hit = byColor.get(key);
  if (hit !== undefined) return hit;
  const c = makeCanvas(src.width), g = c && ctx2d(c, false);
  if (c && g) {
    /* GAP_DEEP as light or a little more, and each channel scaled again by
       its share of the strongest, so the hue holds and the saturation
       grows — light bounced between dyed fibres before it leaves a gap,
       filtered each time */
    const lin = linearColor(color);
    const e: V3 = [srgb(lin[0]) / 255, srgb(lin[1]) / 255, srgb(lin[2]) / 255];
    const mx = Math.max(e[0], e[1], e[2], 1e-3);
    const lu = 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2];
    const pale = Math.min(e[0], e[1], e[2]) / mx;
    const kd = GAP_DEEP + GAP_SCATTER * lu * lu * pale;
    /* and past the palette's saturation (vivid) richer still */
    const ch = (v: number) => Math.round(255 * kd * v * Math.pow(v / mx, 3.2 + 3 * vq));
    const r = ch(e[0]), gr = ch(e[1]), b = ch(e[2]);
    /* The film is encoded for a shade GAP_REF of the colour; a strong dye's
       shade is deeper than that, so laid in full it would darken the whole
       body, not only its gaps. It is laid at the share that halves the
       difference: a strong colour's gaps read a little deeper and richer,
       its body keeps its tone. */
    const deep = (0.2126 * r + 0.7152 * gr + 0.0722 * b) / 255 / Math.max(1e-3, lu);
    g.globalAlpha = Math.min(1, Math.sqrt((1 - GAP_REF) / Math.max(0.05, 1 - deep)));
    g.drawImage(src as HTMLCanvasElement, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = `rgb(${r} ${gr} ${b})`;
    g.fillRect(0, 0, src.width, src.height);
  }
  if (byColor.size >= 4) byColor.clear();
  byColor.set(key, c && g ? c : null);
  return c && g ? c : null;
}

/* The fibres' lit tips and the lit sides of the locks are the key come
   through a dyed fibre: the film's light part is laid in the colour at
   full brightness, TIP_TINT of the way from white — and past the
   palette's saturation (vivid) further, all the way at 1 — so lighting a
   lock lifts its colour rather than chalking it. One copy per pile,
   colour and step of it. */
const TIP_TINT = 0.6;
const tipFilms = new WeakMap<Fur, Map<string, AnyCanvas | null>>();
function tipFilm(fur: Fur, color: string, vivid: number): AnyCanvas | null {
  const src = fur.light;
  if (!src) return null;
  const v = Math.round((TIP_TINT + (1 - TIP_TINT) * Math.min(1, Math.max(0, vivid))) * 10) / 10;
  const key = `${color}|${v}`;
  let byKey = tipFilms.get(fur);
  if (!byKey) tipFilms.set(fur, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const c = makeCanvas(src.width), g = c && ctx2d(c, false);
  if (c && g) {
    g.drawImage(src as HTMLCanvasElement, 0, 0);
    g.globalCompositeOperation = 'source-in';
    const lin = linearColor(color);
    const e: V3 = [srgb(lin[0]), srgb(lin[1]), srgb(lin[2])];
    const mx = Math.max(e[0], e[1], e[2], 1);
    const ch = (u: number) => Math.round(255 + ((255 * u) / mx - 255) * Math.min(1, v));
    g.fillStyle = `rgb(${ch(e[0])} ${ch(e[1])} ${ch(e[2])})`;
    g.fillRect(0, 0, src.width, src.height);
  }
  if (byKey.size >= 6) byKey.clear();
  byKey.set(key, c && g ? c : null);
  return c && g ? c : null;
}

/* The fibres' own light as one film for a colour and material: the key's
   highlights along the fibres, white with about half the dye's colour in
   them (as strong as `highlight` says), and the back light the fibres
   carry, mostly in the dye's colour at full brightness (as strong as
   `rim` says) — the light's white come through a dyed fibre. Past the
   palette's saturation (vivid) both keep more of the colour. Laid over
   the body's colour, as the film's light part is. One copy per pile,
   colour and material, made on first use. */
const sheenFilms = new WeakMap<Fur, Map<string, AnyCanvas | null>>();
function sheenFilm(fur: Fur, color: string, p: Material): AnyCanvas | null {
  const gl = fur.glint, bk = fur.back;
  if (!gl || !bk) return null;
  const hk = Math.min(1, 0.45 * p.highlight * (p.shine ?? 0)), rk = Math.min(1, 1.1 * p.rim);
  if (hk <= 0.01 && rk <= 0.01) return null;
  const vivid = Math.min(1, p.vivid ?? 0);
  /* a softer back light: its even glow in place of the light on single
     fibres, as far as `backSoft` says */
  const soft = Math.min(1, Math.max(0, Math.round((p.backSoft ?? BACK_SOFT) * 20) / 20));
  const key = `${color}|${hk.toFixed(2)}|${rk.toFixed(2)}|${vivid.toFixed(1)}|${soft}`;
  let byKey = sheenFilms.get(fur);
  if (!byKey) sheenFilms.set(fur, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit !== undefined) return hit;
  const W = gl.width;
  const c = makeCanvas(W), g = c && ctx2d(c, false);
  const t = makeCanvas(W), tg = t && ctx2d(t, false);
  if (c && g && t && tg) {
    const lin = linearColor(color);
    const e: V3 = [srgb(lin[0]), srgb(lin[1]), srgb(lin[2])];
    const mx = Math.max(e[0], e[1], e[2], 1);
    const mix = (k: number) => `rgb(${[0, 1, 2].map((i) => Math.round(255 + ((255 * e[i]) / mx - 255) * k)).join(' ')})`;
    const layers: [AnyCanvas | null, string, number][] = [
      [bk, mix(0.65 + 0.35 * vivid), rk * (1 - 0.85 * soft)],
      [fur.backSoft, mix(0.7 + 0.3 * vivid), rk * soft],
      [gl, mix(0.45 + 0.55 * vivid), hk],
    ];
    for (const [src, fill, a] of layers) {
      if (!src) continue;
      if (a <= 0.01) continue;
      tg.globalCompositeOperation = 'copy';
      tg.drawImage(src as HTMLCanvasElement, 0, 0);
      tg.globalCompositeOperation = 'source-in';
      tg.fillStyle = fill;
      tg.fillRect(0, 0, W, W);
      g.globalAlpha = a;
      g.drawImage(t as HTMLCanvasElement, 0, 0);
    }
    g.globalAlpha = 1;
  }
  if (byKey.size >= 6) byKey.clear();
  byKey.set(key, c && g ? c : null);
  return c && g ? c : null;
}

/* ── the cap's frame: light and view in the cap's own space ────────── */

export interface Rig {
  /** the rig's (floored) cos/sin of yaw and pitch, as used by the slice affines */
  cy: number; sy: number; cp: number; sp: number;
  /** cos(yaw)·cos(pitch), unfloored: the front cap faces the viewer while positive */
  facing: number;
  roll: number;
  halfDepth: number;
  cap: number;
  /** unit vector toward the light on screen */
  lx: number; ly: number;
  /** unit vector toward the back light on screen (fabric); from the key's
      when not given */
  bx?: number; by?: number;
  /** the avatar box in device pixels (CSS px × dpr) */
  dev: number;
  /** the context's transform for body space (a, b, c, d, e, f): the
      slices set theirs from it directly rather than through save/restore */
  ctm: readonly number[];
  /** no animation loop will follow: build the form now rather than on idle time */
  still?: boolean;
  /** the profile through the depth: 1 a cushion, rounding off to nothing at
      the outline all round; toward 0 a slab with softened edges */
  round?: number;
}

const norm3 = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

/** Screen-space vectors into the cap's frame: un-roll, then the transpose
    of the rig's rotation; the back cap is the front mirrored in z. */
export function capFrame(r: Rig): Frame {
  const cr = Math.cos(r.roll), sr = Math.sin(r.roll);
  const lx = cr * r.lx + sr * r.ly, ly = -sr * r.lx + cr * r.ly;
  const mirror = r.facing < 0 ? -1 : 1;
  /* the flip passes through edge-on: fade the mirrored component so the
     light does not pop from one side of the sliver to the other */
  const zf = mirror * Math.min(1, Math.abs(r.facing) / 0.16);
  const { cy, sy, cp, sp } = r;
  const local = (x: number, y: number, z: number, zk = zf): V3 =>
    norm3([cy * x + sy * sp * y - sy * cp * z, cp * y + sp * z, zk * (sy * x - cy * sp * y + cy * cp * z)]);
  const L = local(E_XY * lx, E_XY * ly, E_Z);
  const V = local(0, 0, 1, mirror);
  const H = norm3([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
  const U = local(lx, ly, 0, mirror);
  /* the window: 80° round from the light, 34° off the view axis */
  const cw = Math.cos((80 * Math.PI) / 180), sw = Math.sin((80 * Math.PI) / 180);
  const wx = cw * lx - sw * ly, wy = sw * lx + cw * ly;
  const Ws = norm3([0.55 * wx, 0.55 * wy, 0.83]);
  const As = norm3([Ws[1], -Ws[0], 0]);
  const Bs: V3 = [Ws[1] * As[2] - Ws[2] * As[1], Ws[2] * As[0] - Ws[0] * As[2], Ws[0] * As[1] - Ws[1] * As[0]];
  const W = local(Ws[0], Ws[1], Ws[2], mirror), A = local(As[0], As[1], As[2], mirror), B = local(Bs[0], Bs[1], Bs[2], mirror);
  /* screen down, un-rolled the same way as the light */
  const D = local(sr, cr, 0, mirror);
  const [kx0, ky0] = r.bx !== undefined && r.by !== undefined ? [r.bx, r.by] : backFromKey(r.lx, r.ly);
  const K = local(cr * kx0 + sr * ky0, -sr * kx0 + cr * ky0, 0, mirror);
  return { L, V, H, U, W, A, B, D, K };
}

/* ── per-instance state, hung on the canvas ────────────────────────── */

interface State {
  N: number;
  img: ImageData | null;
  mc: Float32Array;
  /** what the matcap holds: the light and view directions, the light on
      screen, the colour and the material; rebuilt when any moves */
  L: V3 | null;
  V: V3 | null;
  lx: number;
  ly: number;
  base: string;
  shadow: number;
  highlight: number;
  spread: number;
  rim: number;
  vivid: number;
  front: number;
  sheen: number;
  backSoft: number;
  K: V3 | null;
  /** bumped on every matcap rebuild */
  version: number;
  /** the matcap the texels show: the last one cross-faded into the new
      one over as many frames as the last bin took, so a slow turn's
      lighting moves every frame instead of stepping a bin at a time */
  mcPrev: Float32Array;
  mcMix: Float32Array;
  mixVersion: number;
  blendT: number;
  blendFrames: number;
  sinceBuild: number;
  imgVersion: number;
  imgAoK: number;
  imgForm: Form | null;
  aoK: number;
  aoMul: Float32Array;
  /** the texels as a canvas, two in turn: Safari reads a drawImage source
      when the frame flushes, so one that is redrawn right after drawing
      shows the later texels (a shared one showed another avatar's) */
  scratch: ({ c: AnyCanvas; g: CanvasRenderingContext2D } | null)[];
  scratchIdx: number;
  scratchN: number;
  scratchStale: boolean;
  /** the far half's sprites: the outline in the side's light — its rim and
      its shaded back — with the pile and its fringe for fabric; redrawn
      with the matcap. Fabric's halo takes the first (its fringe, over its
      tips' colour) and the fifth (its band along the outline). */
  sprites: ({ c: AnyCanvas; g: CanvasRenderingContext2D } | null)[];
  /** the near half's slices' side light, one gradient a slice, and what
      they were made for */
  sliceG: CanvasGradient[];
  sliceKey: string;
  /** fabric: the slices' own buffer, two in turn */
  body: ({ c: AnyCanvas; g: CanvasRenderingContext2D; w: number; h: number } | null)[];
  bodyIdx: number;
  spriteVersion: number;
  spritePx: number;
  spriteFur: Fur | null;
    /** fabric: the last turn's halo miss (see haloMiss), and the turn it
      was measured at */
  miss: [number, number];
  missAt: [number, number];
  /** fabric: the last frame's turn, to tell a quick turn from a slow one */
  turnAt: [number, number];
  /** fabric: the halo's recession and overhang fade last drawn, which a
      moving avatar eases toward the miss's (that is measured per turn step,
      on a coarse grid, so it moves in steps); and the weight shown of the
      halo laid over the body, with the copy of the body it is drawn on
      while both looks are shown */
  fade: [number, number] | null;
  lay: number;
  layTmp: { c: AnyCanvas; g: CanvasRenderingContext2D } | null;
  /** WebKit: the layer the halo is laid on before it is composited (see
      the halo pass) */
  haloTmp: { c: AnyCanvas; g: CanvasRenderingContext2D } | null;
}
const states = new WeakMap<object, Map<string, State>>();
function stateFor(ctx: CanvasRenderingContext2D, outline: string): State {
  const key = (ctx.canvas as object) ?? ctx;
  let byOutline = states.get(key);
  if (!byOutline) {
    byOutline = new Map();
    states.set(key, byOutline);
  }
  let s = byOutline.get(outline);
  if (!s) {
    s = {
      N: 0, img: null, mc: new Float32Array(MM * 3),
      mcPrev: new Float32Array(MM * 3), mcMix: new Float32Array(MM * 3), mixVersion: 0, blendT: 1, blendFrames: 1, sinceBuild: 0,
      L: null, V: null, lx: NaN, ly: NaN, base: '', shadow: NaN, highlight: NaN, spread: NaN, rim: NaN, vivid: NaN, front: NaN, sheen: NaN, backSoft: NaN, K: null,
      version: 0, imgVersion: -1, imgAoK: NaN, imgForm: null, aoK: -1, aoMul: new Float32Array(256),
      scratch: [null, null], scratchIdx: 0, scratchN: 0, scratchStale: true,
      sprites: [null, null, null, null, null], sliceG: [], sliceKey: '', body: [null, null], bodyIdx: 0, spriteVersion: -1, spritePx: 0, spriteFur: null, miss: [0, 0], missAt: [0, 0], turnAt: [0, 0], fade: null, lay: 1, layTmp: null, haloTmp: null,
    };
    if (byOutline.size > 4) byOutline.clear();
    byOutline.set(outline, s);
  }
  return s;
}
/* the matcap is rebuilt once a direction has moved a bin (1/48) from the
   one it was built for — the same resolution as a bin grid, without the
   rebuilds a direction jittering on a bin edge would cause */
const BIN = 1 / 48;
const moved = (a: V3, b: V3 | null) => !b || Math.abs(a[0] - b[0]) >= BIN || Math.abs(a[1] - b[1]) >= BIN || Math.abs(a[2] - b[2]) >= BIN;
/** A · B for canvas affines (a, b, c, d, e, f) */
export function mulAffine(A: readonly number[], B: readonly number[]): number[] {
  return [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}

/* The front's colour along 24 rays out from the centre, sampled every
   half unit with how far each sample is from the outline: any inset's
   colour all the way round is then a lookup, for a whole stack of slices */
interface Rays {
  /** per ray: the samples' distance in from the outline, and their colours */
  d: Float32Array[];
  c: Float32Array[];
}
function raysOf(img: ImageData, form: Form, c0: [number, number]): Rays {
  const { N, sd } = form;
  const data = img.data;
  const toG = (v: number) => ((v + PAD) / SPAN) * N - 0.5;
  const dOut: Float32Array[] = [], cOut: Float32Array[] = [];
  for (let s = 0; s < CONIC_STOPS; s++) {
    const phi = (s / CONIC_STOPS) * Math.PI * 2, ux = Math.cos(phi), uy = Math.sin(phi);
    const ds: number[] = [], cs: number[] = [];
    for (let r = 0; r < 80; r += 0.5) {
      const x = c0[0] + ux * r, y = c0[1] + uy * r;
      const d = bilerp(sd, N, toG(x), toG(y));
      if (d < 0) break;
      const gx = Math.round(toG(x)), gy = Math.round(toG(y));
      if (gx < 0 || gy < 0 || gx >= N || gy >= N) break;
      const k = (gy * N + gx) * 4;
      ds.push(d);
      cs.push(data[k], data[k + 1], data[k + 2]);
    }
    dOut.push(Float32Array.from(ds));
    cOut.push(Float32Array.from(cs));
  }
  return { d: dOut, c: cOut };
}
/* one slice's side light: every ray's colour at `inset` from the outline,
   darkened by `dark` (either the same for every ray or one per ray), as a
   conic ramp round the centre (a linear one along the light where conic
   fills are slow) */
function sliceGradient(ctx: CanvasRenderingContext2D, rays: Rays, inset: number | Float32Array, dark: number | Float32Array, c0: [number, number], lxy: [number, number], linear: boolean): CanvasGradient {
  const at = (s: number): string => {
    const d = rays.d[s], c = rays.c[s];
    const ins = typeof inset === 'number' ? inset : inset[s], k = 1 - (typeof dark === 'number' ? dark : dark[s]);
    /* the samples run from the centre out, their distance to the outline
       falling: the last one at least `inset` in */
    let j = 0;
    for (let i = 0; i < d.length; i++) if (d[i] >= ins) j = i;
    return c.length ? `rgb(${(c[j * 3] * k) | 0} ${(c[j * 3 + 1] * k) | 0} ${(c[j * 3 + 2] * k) | 0})` : 'rgb(0 0 0)';
  };
  if (!linear && typeof ctx.createConicGradient === 'function') {
    const g = ctx.createConicGradient(0, c0[0], c0[1]);
    for (let s = 0; s <= CONIC_STOPS; s++) g.addColorStop(s / CONIC_STOPS, at(s % CONIC_STOPS));
    return g;
  }
  const g = ctx.createLinearGradient(c0[0] + lxy[0] * 50, c0[1] + lxy[1] * 50, c0[0] - lxy[0] * 50, c0[1] - lxy[1] * 50);
  const ray = (a: number) => ((Math.round((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / ((Math.PI * 2) / CONIC_STOPS))) % CONIC_STOPS);
  g.addColorStop(0, at(ray(Math.atan2(lxy[1], lxy[0]))));
  g.addColorStop(0.5, at(ray(Math.atan2(lxy[0], -lxy[1]))));
  g.addColorStop(1, at(ray(Math.atan2(-lxy[1], -lxy[0]))));
  return g;
}

/* the halo's lit tips: the front's brightest colour, and toward the back
   light's own through the dyed fibres — the colour at full brightness,
   paled halfway to white — as far as `rim` says: seen against the back
   light a pile's outermost hairs glow */
function hazeColor(rays: Rays, base: string, rim: number, vivid = 0): string {
  const m = /rgb\((\d+) (\d+) (\d+)\)/.exec(brightest(rays));
  const b = m ? [+m[1], +m[2], +m[3]] : [255, 255, 255];
  const lin = linearColor(base);
  const e = [srgb(lin[0]), srgb(lin[1]), srgb(lin[2])];
  const mx = Math.max(e[0], e[1], e[2], 1);
  const k = Math.min(0.85, 0.75 * rim);
  /* paled toward white, less so past the palette's saturation (vivid) */
  const pale = 0.45 + 0.55 * Math.min(1, vivid);
  const q = (i: number) => Math.round(b[i] + (255 + ((255 * e[i]) / mx - 255) * pale - b[i]) * k);
  return `rgb(${q(0)} ${q(1)} ${q(2)})`;
}
/* the front's brightest colour, where it faces the light */
function brightest(rays: Rays): string {
  let best = -1, r = 0, g = 0, b = 0;
  for (const c of rays.c) {
    for (let i = 0; i < c.length; i += 3) {
      const l = 0.2126 * c[i] + 0.7152 * c[i + 1] + 0.0722 * c[i + 2];
      if (l > best) (best = l), (r = c[i]), (g = c[i + 1]), (b = c[i + 2]);
    }
  }
  /* in steps of four, so a turn that barely moves it keeps the colour */
  const q = (v: number) => Math.min(255, Math.round(v / 4) * 4);
  return `rgb(${q(r)} ${q(g)} ${q(b)})`;
}

/* Fabric's halo is the outline's fringe laid over the turned body's
   silhouette. Turned, that silhouette is no longer the outline but the
   slice stack's: the near half's slices reach out on the side turning
   toward the viewer, the far half's on the other. The halo takes the
   outline stretched along the turn to span exactly that reach on both
   sides (face-on, the outline itself), and in each of the rays'
   directions the colour of the slice that forms the silhouette there —
   where on the front that slice's edge lies, and how deep in the far
   half's shade — so the body's edge runs on into it without a step. */

/* the stack's reach along a direction v, given the outline's (h): the
   furthest of the slices of either half that way — and which one it is */
interface Reach {
  k: number;
  far: boolean;
}
function stackReach(rel: Relief, K: number, ex: number, ey: number, dl1: number, vx: number, vy: number, h: number, at?: Reach): number {
  const v0 = vx * rel.cx[0] + vy * rel.cy[0], ve = (vx * ex + vy * ey) * dl1;
  let best = h, kb = 0, far = false;
  for (let k = 1; k < K; k++) {
    const r = vx * rel.cx[k] + vy * rel.cy[k] + rel.scale[k] * (h - v0);
    if (r + rel.z[k] * ve > best) (best = r + rel.z[k] * ve), (kb = k), (far = false);
    if (r - rel.z[k] * ve > best) (best = r - rel.z[k] * ve), (kb = k), (far = true);
  }
  if (at) (at.k = kb), (at.far = far);
  return best;
}
/* the stretch, as a canvas affine in design units: along the turn e by
   1 + s1, shifted by t, so the outline spans the stack's reach both ways */
function haloStretch(form: Form, rel: Relief, K: number, ex: number, ey: number, dl1: number): number[] {
  if (dl1 <= 1e-4) return [1, 0, 0, 1, 0, 0];
  const rim = rimOf(form);
  const hp = reach(rim, ex, ey), hn = reach(rim, -ex, -ey);
  const up = stackReach(rel, K, ex, ey, dl1, ex, ey, hp), un = stackReach(rel, K, ex, ey, dl1, -ex, -ey, hn);
  const s1 = (up + un) / Math.max(1, hp + hn) - 1, t = up - (s1 + 1) * hp;
  return [1 + s1 * ex * ex, s1 * ex * ey, s1 * ex * ey, 1 + s1 * ey * ey, ex * t, ey * t];
}
/* the halo's colour along each ray: that of the slice forming the stack's
   silhouette where the stretched outline's ray lands */
function haloRays(form: Form, rel: Relief, K: number, ex: number, ey: number, dl1: number, S: number[], backShade: number): { inset: Float32Array; dark: Float32Array } {
  const rim = rimOf(form);
  const inset = new Float32Array(CONIC_STOPS), dark = new Float32Array(CONIC_STOPS);
  const s1 = S[0] + S[3] - 2, at: Reach = { k: 0, far: false };
  for (let s = 0; s < CONIC_STOPS; s++) {
    const phi = (s / CONIC_STOPS) * Math.PI * 2, ux = Math.cos(phi), uy = Math.sin(phi);
    /* the direction the stretched outline faces where this ray lands */
    const ue = ux * ex + uy * ey, q = s1 / (1 + s1);
    let vx = ux - q * ue * ex, vy = uy - q * ue * ey;
    const vl = Math.hypot(vx, vy);
    vx /= vl;
    vy /= vl;
    stackReach(rel, K, ex, ey, dl1, vx, vy, reach(rim, vx, vy), at);
    /* never from the front's outermost units, which are in the edge's
       shade: the hairs past the edge are lit through */
    inset[s] = Math.max(HALO_INSET, rel.inset[at.k]);
    /* the hairs standing past the far half's edge stand out of its shade,
       into the light: they keep only a little of it */
    dark[s] = at.far ? HALO_SHADE * backShade * (1 - Math.exp(-2.4 * (at.k / K))) : 0;
  }
  return { inset, dark };
}

/* How far the stretched outline misses the stack's silhouette, in design
   units: a rounded body fits at any turn, but a lobed or pointed one only
   while the turn is moderate — far round, the stack sweeps the lobes into
   one rounded side, which the stretched outline cuts into (the stack
   reaching past it) or overhangs (reaching past the stack). Measured on a
   coarse grid with the stretch undone, where the outline is the form's
   own: the stack's cells outside the outline, and the outline's cells
   away from the stack. Once per form and turn, in steps of MISS_STEP of
   the slices' shift per unit of depth, on idle time while the avatar
   moves slowly (a millisecond or so a turn) — a quick turn is measured at
   once (see drawPlasticCap). */
const misses = new WeakMap<Form, Map<string, [number, number] | null>>();
const MISS_N = 96, MISS_STEP = 0.1;
/* the measure, or null while it waits for idle time (unless `sync`) */
function haloMiss(form: Form, path: Path2D, rel: Relief, K: number, S: number[], dxs: number, dys: number, sync: boolean): [number, number] | null {
  const key = `${K}|${rel.q}|${Math.round(dxs / MISS_STEP)}|${Math.round(dys / MISS_STEP)}`;
  let byKey = misses.get(form);
  if (!byKey) misses.set(form, (byKey = new Map()));
  const hit = byKey.get(key);
  if (hit || (hit === null && !sync)) return hit ?? null;
  if (byKey.size > 256) byKey.clear();
  if (!sync) {
    byKey.set(key, null);
    idle(() => {
      byKey.set(key, measureMiss(form, path, rel, K, S, dxs, dys));
    });
    return null;
  }
  const r = measureMiss(form, path, rel, K, S, dxs, dys);
  byKey.set(key, r);
  return r;
}
function measureMiss(form: Form, path: Path2D, rel: Relief, K: number, S: number[], dxs: number, dys: number): [number, number] {
  const c = makeCanvas(MISS_N), g = c && ctx2d(c, true);
  if (!g) return [0, 0];
  const u = SPAN / MISS_N;
  /* the stretch undone: S⁻¹ of a symmetric stretch along e */
  const det = S[0] * S[3] - S[1] * S[2];
  const ia = S[3] / det, ib = -S[1] / det, ic = -S[2] / det, id = S[0] / det;
  const ie = -(ia * S[4] + ic * S[5]), jf = -(ib * S[4] + id * S[5]);
  g.fillStyle = '#fff';
  for (let k = 0; k < K; k++) {
    for (const z of k ? [rel.z[k], -rel.z[k]] : [0]) {
      g.setTransform(1 / u, 0, 0, 1 / u, PAD / u, PAD / u);
      g.transform(ia, ib, ic, id, ie, jf);
      g.translate(z * dxs, z * dys);
      const sk = rel.scale[k];
      if (k) g.transform(sk, 0, 0, sk, rel.cx[k] - sk * rel.cx[0], rel.cy[k] - sk * rel.cy[0]);
      g.fill(path);
    }
  }
  const px = g.getImageData(0, 0, MISS_N, MISS_N).data;
  const on = new Uint8Array(MISS_N * MISS_N), dist = new Float32Array(MISS_N * MISS_N);
  for (let i = 0; i < MISS_N * MISS_N; i++) on[i] = px[i * 4 + 3] > 127 ? 1 : 0;
  edt2d(on, 1, MISS_N, dist, null);
  let cut = 0, over = 0;
  for (let y = 0, i = 0; y < MISS_N; y++) {
    for (let x = 0; x < MISS_N; x++, i++) {
      const d = bilerp(form.sd, form.N, ((x + 0.5) / MISS_N) * form.N - 0.5, ((y + 0.5) / MISS_N) * form.N - 0.5);
      if (on[i] && d < 0) cut = Math.max(cut, -d);
      if (!on[i] && d > 0) over = Math.max(over, Math.sqrt(dist[i]) * u);
    }
  }
  return [cut, over];
}

/**
 * Draw the plastic or fabric body as a relief: the far half's levels from
 * sprites, the outline, then the near half's levels as the lit texture.
 * Call inside the body transform (translate / roll / squash applied),
 * instead of the slice loop. Returns false when the form is not built
 * yet (it is being built on idle time): draw the stock slices that frame.
 */
/* WebKit rasterises a conic-gradient fill slowly — about 60 µs each where
   a flat fill is 2 µs — so there the side sprite takes a linear ramp. */
const WEBKIT =
  typeof navigator !== 'undefined' && /AppleWebKit\//.test(navigator.userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(navigator.userAgent);

export function drawPlasticCap(
  ctx: CanvasRenderingContext2D,
  cfg: DrawConfig,
  rig: Rig,
  pal: { base: string },
  union: Path2D | null,
  mat: Material
): boolean {
  const N = tierFor(rig.dev);
  const form = formFor(cfg.typeKey ?? pathId(cfg.path), cfg.path, N, rig.halfDepth, !!rig.still);
  if (!form) return false;
  /* fabric wears the same form in a pile instead of a clear coat */
  const fabric = cfg.shading === 'fabric';
  const capPx = Math.ceil((SPAN * rig.dev) / 100);
  const lights: FurLights = (() => {
    const [bx, by] = rig.bx !== undefined && rig.by !== undefined ? [rig.bx, rig.by] : backFromKey(rig.lx, rig.ly);
    return { bx, by, front: mat.front ?? KEY_EL };
  })();
  /* a still frame makes its pile now, unless the caller redraws when it
     lands (`furOnIdle`, the component): made now it holds the page for a
     few hundred ms, and a row of still avatars for seconds */
  const fur = fabric ? furReady(form, cfg.typeKey ?? pathId(cfg.path), rig.halfDepth, capPx, !!rig.still && !cfg.furOnIdle, rig.lx, rig.ly, cfg.fur ?? FUR_STOCK, lights) : null;
  if (fabric && !fur) return false;
  const st = stateFor(ctx, (cfg.typeKey ?? pathId(cfg.path)) + (fabric ? '|fabric' : ''));
  const f = capFrame(rig);
  const lxy: [number, number] = (() => {
    const l = Math.hypot(f.L[0], f.L[1]);
    return l < 0.05 ? [0, -1] : [f.L[0] / l, f.L[1] / l];
  })();
  if (
    moved(f.L, st.L) || moved(f.V, st.V) || rig.lx !== st.lx || rig.ly !== st.ly || pal.base !== st.base ||
    mat.shadow !== st.shadow || mat.highlight !== st.highlight || mat.spread !== st.spread || mat.rim !== st.rim || (mat.vivid ?? 0) !== st.vivid || (mat.front ?? KEY_EL) !== st.front || (mat.sheen ?? 0) !== st.sheen || (mat.backSoft ?? BACK_SOFT) !== st.backSoft || (fabric && moved(f.K, st.K))
  ) {
    /* the fade starts from what is showing now, so a rebuild during a
       fade does not jump */
    if (st.version > 0) st.mcPrev.set(st.mcMix);
    if (fabric) buildFabricMatcap(st.mc, linearColor(pal.base), f, mat);
    else buildMatcap(st.mc, linearColor(pal.base), f, mat);
    /* a still frame shows the new light at once: no frames follow to fade */
    if (st.version === 0 || rig.still) {
      st.mcMix.set(st.mc);
      st.blendT = 1;
    } else {
      st.blendFrames = Math.min(10, Math.max(1, st.sinceBuild));
      st.blendT = 0;
    }
    st.sinceBuild = 0;
    st.mixVersion++;
    st.L = f.L;
    st.V = f.V;
    st.lx = rig.lx;
    st.ly = rig.ly;
    st.base = pal.base;
    st.shadow = mat.shadow;
    st.highlight = mat.highlight;
    st.spread = mat.spread;
    st.rim = mat.rim;
    st.vivid = mat.vivid ?? 0;
    st.front = mat.front ?? KEY_EL;
    st.sheen = mat.sheen ?? 0;
    st.backSoft = mat.backSoft ?? BACK_SOFT;
    st.K = f.K;
    st.version++;
  }
  st.sinceBuild++;
  if (st.blendT < 1) {
    st.blendT = Math.min(1, st.blendT + 1 / st.blendFrames);
    const e = st.blendT >= 1 ? 1 : st.blendT * st.blendT * (3 - 2 * st.blendT);
    const a = st.mcPrev, b = st.mc, o = st.mcMix;
    for (let i = 0; i < MM * 3; i++) o[i] = a[i] + (b[i] - a[i]) * e;
    st.mixVersion++;
  }
  /* the occlusion strength follows `shadow`; a pile sinks deeper into its
     creases than a clear coat does, which is what keeps fur's lobes apart */
  const aoK = fur ? Math.min(1.2, 0.3 + 0.8 * mat.shadow) : Math.min(1.3, 1.2 * mat.shadow);
  if (aoK !== st.aoK) {
    for (let a = 0; a < 256; a++) st.aoMul[a] = Math.max(0, 1 - aoK * (1 - a / 255));
    st.aoK = aoK;
  }
  if (!st.img || st.N !== N) {
    st.img = new ImageData(N, N);
    st.N = N;
    st.imgVersion = -1;
  }
  if (st.imgVersion !== st.mixVersion || st.imgAoK !== aoK || st.imgForm !== form) {
    shadeTexels(form, st.mcMix, st.img.data, st.aoMul, fur ? edgeLift(form) : undefined);
    st.imgVersion = st.mixVersion;
    st.imgAoK = aoK;
    st.imgForm = form;
    st.scratchStale = true;
  }
  if (st.scratchN !== N) {
    st.scratch = [null, null];
    st.scratchN = N;
    st.scratchStale = true;
  }
  if (st.scratchStale) {
    st.scratchIdx ^= 1;
    let sc = st.scratch[st.scratchIdx];
    if (!sc) {
      const c = makeCanvas(N);
      const g = c && ctx2d(c, false);
      if (!c || !g) return false;
      sc = st.scratch[st.scratchIdx] = { c, g };
    }
    sc.g.putImageData(st.img, 0, 0);
    st.scratchStale = false;
  }
  const sc = st.scratch[st.scratchIdx]!;
  const capSrc: AnyCanvas = sc.c;

  /* the body: slices of the outline through the depth, each scaled to the
     cushion's profile there and shaded as the form's side at that depth —
     the far half sinking into shade toward its back, each slice of the
     near half in the front's own colour where its edge lies on the front —
     back to front; then the lit front laid over them once (below). No
     texture is repeated in the slices, so a side view is one smooth
     rounded surface that carries the front's light round onto the side;
     fabric's pile is laid over the whole at once. */
  const K = rig.dev <= 100 ? 14 : rig.dev <= 224 ? 20 : 26;
  const rel = reliefFor(form, K, rig.round ?? 1);
  const { cy, sy, cp, sp } = rig;
  const [ca, cb, cc, cd, ce, cf] = rig.ctm;
  const m1 = sy * sp;
  const ta = ca * cy + cc * m1, tb = cb * cy + cd * m1, tc = cc * cp, td = cd * cp;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const near = rig.facing >= 0 ? 1 : -1;

  /* the lit front's place, once, at the equator plane: turned, the front's
     projection runs from the equator on the side turning away to the
     shoulder's silhouette on the side turning toward the viewer, so the
     texture is stretched along the turn to span exactly that (no stretch
     head-on) */
  const dxs = sy / cy, dys = -sp / (cy * cp);
  const dl1 = Math.hypot(dxs, dys);
  let lead = 50;
  for (let k = 1; k < K; k++) lead = Math.max(lead, 50 * rel.scale[k] + rel.z[k] * dl1);
  const ex = dl1 > 1e-6 ? (near * dxs) / dl1 : 1, ey = dl1 > 1e-6 ? (near * dys) / dl1 : 0;
  const backShade = Math.min(0.7, 0.55 * Math.min(1.6, mat.shadow / 0.35));
  /* fabric's halo: where the turned body's silhouette is, and how well
     the stretched outline fits it there (below) */
  const haloS = fur ? haloStretch(form, rel, K, ex, ey, dl1) : null;
  /* the slices' sprites — fabric's halo (the outline and its fringe, laid
     over the whole stack after the front), black for the far half's shade,
     the side's light at the equator without the fringe, and the halo's
     band — at the avatar's device size */
  const spx = Math.ceil((SPAN * rig.dev) / 100);
  if (st.spritePx !== spx) {
    st.sprites = [null, null, null, null, null];
    st.spritePx = spx;
    st.spriteVersion = -1;
  }
  if (st.spriteVersion !== st.version || st.spriteFur !== fur) {
    const k = spx / SPAN;
    /* fabric: no slice carries the fringe, the equator's included; each
       ends in a plain soft edge, and the fringe is the halo laid over the
       whole stack after the front, so a side view is not combed with
       fringes */
    const soft = fur ? softMask(form, fur.R) : null;
    const rays = raysOf(st.img!, form, [rel.cx[0], rel.cy[0]]);
    for (let i = 0; i < 4; i++) {
      if (i === 2) continue;
      let spr = st.sprites[i];
      if (!spr) {
        const c = makeCanvas(spx);
        const g = c && ctx2d(c, false);
        if (!c || !g) return false;
        spr = st.sprites[i] = { c, g };
      }
      const g = spr.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.clearRect(0, 0, spx, spx);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      /* the side's light at the equator (with the fringe, and again
         without), and a black silhouette laid over the far half's deeper
         slices. Fabric's fringe is the halo round the whole turned body:
         in each direction it takes the colour of the slice that forms the
         silhouette there, so the body's edge runs on into it without a
         step — and its hairs are lit toward their tips, out of the body's
         shade and thin enough for the backdrop's light to come through,
         so past the edge they turn to the front's brightest colour: that
         where the haze says, the silhouette's own under it */
      const halo = i === 0 && fur && fur.mask ? fur : null;
      if (halo && halo.haze) {
        /* the tips' layer, straight into this sprite and under what
           follows: the haze in the front's brightest colour */
        g.imageSmoothingQuality = 'low';
        g.drawImage(halo.haze as HTMLCanvasElement, 0, 0, spx, spx);
        g.imageSmoothingQuality = 'high';
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = hazeColor(rays, pal.base, mat.rim, mat.vivid ?? 0);
        g.fillRect(0, 0, spx, spx);
        g.globalCompositeOperation = 'destination-over';
      }
      g.setTransform(k, 0, 0, k, PAD * k, PAD * k);
      const edge = halo && haloS ? haloRays(form, rel, K, ex, ey, dl1, haloS, backShade) : null;
      g.fillStyle = i === 1 ? '#000' : sliceGradient(g, rays, edge ? edge.inset : fur ? Math.max(HALO_INSET, rel.inset[0]) : rel.inset[0], edge ? edge.dark : 0, [rel.cx[0], rel.cy[0]], lxy, WEBKIT);
      if (fur && fur.mask) {
        /* the square in the side's light, then cut to the body and its
           fringe; no pile here: the film laid over all the slices at once
           brings it (the fringe's hairs too) */
        g.fillRect(-PAD, -PAD, SPAN, SPAN);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(((i === 0 ? fur.mask : soft) ?? fur.mask) as HTMLCanvasElement, 0, 0, spx, spx);
        g.globalCompositeOperation = 'source-over';
      } else g.fill(cfg.path);
    }
    /* and the halo's band: the halo less the body's inside, for what of
       it is veiled over the body's edge */
    if (fur && fur.core) {
      let band = st.sprites[4];
      if (!band) {
        const c = makeCanvas(spx);
        const bg = c && ctx2d(c, false);
        if (c && bg) band = st.sprites[4] = { c, g: bg };
      }
      if (band) {
        band.g.setTransform(1, 0, 0, 1, 0, 0);
        band.g.globalCompositeOperation = 'copy';
        band.g.drawImage(st.sprites[0]!.c as HTMLCanvasElement, 0, 0);
        band.g.globalCompositeOperation = 'destination-out';
        band.g.drawImage(fur.core as HTMLCanvasElement, 0, 0, spx, spx);
        band.g.globalCompositeOperation = 'source-over';
      }
    }
    st.spriteVersion = st.version;
    st.spriteFur = fur;
  }
  const stretch = (lead + 50) / 100, shift = (lead - 50) / 2;
  const A = 1 + (stretch - 1) * ex * ex, B = (stretch - 1) * ex * ey, D = 1 + (stretch - 1) * ey * ey;
  const capM = mulAffine(mulAffine(rig.ctm, [cy, m1, 0, cp, 0, 0]), [A, B, B, D, shift * ex - 50 * A - 50 * B, shift * ey - 50 * B - 50 * D]);

  /* fabric draws its slices into a buffer of their own, then lays the
     pile over all of them at once as one film lined up with the front's —
     a pile carried slice by slice would show every slice's edge as a ring.
     The buffer covers where the slices can reach on the canvas. */
  const film = fur?.dark && fur.light ? fur : null;
  let g: CanvasRenderingContext2D = ctx, ox = 0, oy = 0, bw = 0, bh = 0;
  if (film) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const z of [-rel.top, rel.top]) {
      const e = z * sy - 50 * cy, fo = -z * cy * sp - 50 * m1 - 50 * cp;
      const E = ca * e + cc * fo + ce, F = cb * e + cd * fo + cf;
      for (const x of [-PAD, 100 + PAD]) for (const y of [-PAD, 100 + PAD]) {
        const X = ta * x + tc * y + E, Y = tb * x + td * y + F;
        if (X < x0) x0 = X;
        if (X > x1) x1 = X;
        if (Y < y0) y0 = Y;
        if (Y > y1) y1 = Y;
      }
    }
    ox = Math.floor(x0) - 1;
    oy = Math.floor(y0) - 1;
    bw = Math.ceil(x1) + 1 - ox;
    bh = Math.ceil(y1) + 1 - oy;
    /* two in turn, as for the scratch: Safari reads a drawImage source
       when the frame flushes */
    st.bodyIdx ^= 1;
    let b = st.body[st.bodyIdx];
    if (!b || b.w < bw || b.h < bh || b.w > 2 * bw + 64 || b.h > 2 * bh + 64) {
      const w = Math.ceil(bw / 64) * 64, h = Math.ceil(bh / 64) * 64;
      /* a document canvas where there is one: an OffscreenCanvas made on the
         main thread is drawn in software by some browsers, many times slower
         for a body's worth of gradient fills */
      let c: AnyCanvas | null = null;
      if (typeof document !== 'undefined') {
        c = document.createElement('canvas');
        c.width = w;
        c.height = h;
      } else if (typeof OffscreenCanvas !== 'undefined') c = new OffscreenCanvas(w, h);
      const cg = c && ctx2d(c, false);
      b = c && cg ? (st.body[st.bodyIdx] = { c, g: cg, w: c.width, h: c.height }) : null;
    }
    if (b) {
      g = b.g;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-over';
      g.globalAlpha = 1;
      g.clearRect(0, 0, bw, bh);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
    } else ox = oy = 0;
  }

  /* at depth z: yaw about Y then pitch about X, orthographic */
  const at = (z: number) => {
    const e = z * sy - 50 * cy, fo = -z * cy * sp - 50 * m1 - 50 * cp;
    g.setTransform(ta, tb, tc, td, ca * e + cc * fo + ce - ox, cb * e + cd * fo + cf - oy);
  };
  const [fringed, black, , side] = st.sprites as { c: AnyCanvas }[];
  /* each slice in the front's own colour where that slice's edge lies on
     it — the same on both halves, so the side's light runs on round the
     equator without a step; the far half's sinks into shade besides */
  const c0: [number, number] = [rel.cx[0], rel.cy[0]];
  const sliceKey = `${st.version}|${K}|${rel.q}`;
  if (st.sliceKey !== sliceKey) {
    const rays = raysOf(st.img!, form, c0);
    st.sliceG = [];
    /* fabric's from past the front's outermost units, whose light is the
       pile's rim — lit where the fibres at the silhouette catch it, which
       turned into view is no longer the silhouette, a light ring inside it */
    for (let k = 0; k < K; k++) st.sliceG.push(sliceGradient(ctx, rays, fur ? Math.max(HALO_INSET, rel.inset[k]) : rel.inset[k], 0, c0, lxy, WEBKIT));
    st.sliceKey = sliceKey;
  }
  const slice = (k: number, z: number, dark: number) => {
    at(z);
    const sk = rel.scale[k];
    if (k > 0) {
      g.transform(sk, 0, 0, sk, rel.cx[k] - sk * rel.cx[0], rel.cy[k] - sk * rel.cy[0]);
      g.fillStyle = st.sliceG[k];
      g.fill(cfg.path);
      if (dark > 0.01) {
        g.globalAlpha = dark;
        g.fillStyle = '#000';
        g.fill(cfg.path);
        g.globalAlpha = 1;
      }
      return;
    }
    /* the equator: fabric's ends in its soft edge (its fringe is the halo
       laid over the whole stack) */
    if (fur) g.drawImage(side.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
    else {
      g.fillStyle = st.sliceG[0];
      g.fill(cfg.path);
    }
    /* with no body buffer there is no halo pass (below): the fringe on the
       equator, seen face-on, as before the halo */
    if (fur && g === ctx && fringeA > 0.01) {
      g.globalAlpha = fringeA;
      g.drawImage(fringed.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
      g.globalAlpha = 1;
    }
    if (dark > 0.01) {
      g.globalAlpha = dark;
      g.drawImage(black.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
      g.globalAlpha = 1;
    }
  };
  const faceOn = Math.abs(rig.facing);
  const fringeA = faceOn >= 0.8 ? 1 : faceOn <= 0.45 ? 0 : (faceOn - 0.45) / 0.35;
  /* the far half, deepest first, each slice a little further into shade */
  for (let k = K - 1; k >= 1; k--) slice(k, -near * rel.z[k], fur ? 0 : backShade * (1 - Math.exp(-2.4 * (k / K))));
  /* fabric's far half sinks into shade smoothly rather than a step a slice
     (the steps show through a pile as fine stripes): one ramp laid over
     it, from the outline's far edge out to the stack's, as deep as the
     slices' shade would be at that depth */
  if (fur && dl1 > 1e-3) {
    const hn = reach(rimOf(form), -ex, -ey), span = 1.3 * rel.top * dl1;
    at(0);
    const ramp = g.createLinearGradient(-ex * hn, -ey * hn, -ex * (hn + span), -ey * (hn + span));
    /* easing in from nothing at the far edge: seen side-on the ramp spans
       only a few pixels, where a steep start reads as a hard line */
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      ramp.addColorStop(t, `rgba(0,0,0,${(backShade * (1 - Math.exp(-2.4 * t)) * t * t * (3 - 2 * t)).toFixed(3)})`);
    }
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = ramp;
    g.fillRect(-PAD - 60, -PAD - 60, SPAN + 120, SPAN + 120);
    g.globalCompositeOperation = 'source-over';
  }
  slice(0, 0, 0);
  /* the near half */
  for (let k = 1; k < K; k++) slice(k, near * rel.z[k], 0);

  /* The front fades out over its outer band into the slices under it; the
     silhouette is the slices' (and fabric's fringe is the halo's, below).
     Turned far round, the front is seen so obliquely that a flat picture
     of it no longer fits the form: it gives way to the slices' own smooth
     light, so a side view is one rounded surface without a seam. */
  const face = Math.abs(rig.facing);
  const frontA = face >= 0.72 ? 1 : face <= 0.34 ? 0 : ((face - 0.34) / 0.38) ** 1.5;
  if (frontA > 0.01) {
    g.save();
    g.setTransform(capM[0], capM[1], capM[2], capM[3], capM[4] - ox, capM[5] - oy);
    g.globalAlpha = frontA;
    g.drawImage(capSrc as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
    g.restore();
  }

  /* Fabric's halo over the silhouette: the outline stretched to the
     turned stack's reach (see haloStretch), laid over the body keeping the
     body only where the halo covers it — the body's edge thins into the
     halo's and breaks with its tufts, and the halo shows past it, the
     body's own colour running on into the hairs'. Where the stretch no
     longer fits the stack (see haloMiss), that would cut the body back to
     the stretched outline, or show a body that is not: the same is drawn
     in two steps — the cut the halo makes into the body, then the halo
     behind it — and as the miss grows the cut recedes outward, past
     whatever of the stack reaches beyond the outline (never thinning it,
     which would show the backdrop through the body), and an overhanging
     halo fades, so the stack's own silhouette stands. */
  if (fur && fur.mask && haloS && g !== ctx) {
    /* a turn not measured yet is taken as the last one measured while
       that is within a step or so of it (a slow turn); further off (a
       quick one, a spin), it is measured now: the last one may be a front
       view's, whose outline is no side view's silhouette */
    const mx = near * dxs, my = near * dys;
    const stale = Math.abs(mx - st.missAt[0]) > 1.5 * MISS_STEP || Math.abs(my - st.missAt[1]) > 1.5 * MISS_STEP;
    const measured = dl1 > 1e-4 ? haloMiss(form, cfg.path, rel, K, haloS, mx, my, !!rig.still || stale) : ([0, 0] as [number, number]);
    if (measured) {
      st.miss = measured;
      st.missAt = [mx, my];
    }
    const [cut, over] = st.miss;
    const miss = Math.max(cut, over);
    let back = smooth(HALO_FIT / 2, 2 * HALO_FIT, miss), gone = smooth(HALO_FIT / 2, HALO_FIT, over);
    /* the miss moves in steps — once per turn step, on a coarse grid — so a
       slowly turning avatar eases toward it rather than jumping with it; a
       quick turn (a spin) follows it at once, since easing would trail the
       wrong silhouette behind a body moving that fast */
    const quick = Math.abs(mx - st.turnAt[0]) > MISS_STEP || Math.abs(my - st.turnAt[1]) > MISS_STEP;
    st.turnAt = [mx, my];
    const settle = !rig.still && !quick;
    if (settle && st.fade) {
      const ease = (a: number, b: number) => (Math.abs(b - a) < 0.02 ? b : a + (b - a) * 0.2);
      back = ease(st.fade[0], back);
      gone = ease(st.fade[1], gone);
    }
    st.fade = [back, gone];
    const band = st.sprites[4];
    /* the sprites are at the device size: plain bilinear filtering draws
       them the same as the high-quality filter, for a fraction of it */
    g.imageSmoothingQuality = 'low';
    at(0);
    g.transform(haloS[0], haloS[1], haloS[2], haloS[3], haloS[4], haloS[5]);
    /* The two looks differ all along the outline (laid over, the body's
       edge is see-through and veiled; cut, the halo behind fills it in),
       so they are not switched at once: over the first HALO_BLEND of the
       recession the halo laid over, drawn on a copy of the body, is
       cross-faded into the cut, and an overhanging one fades with it as it
       does behind */
    const layTo = (1 - smooth(0, HALO_BLEND, back)) * (1 - gone);
    const lay = (st.lay = !settle ? layTo : st.lay + Math.max(-HALO_EASE, Math.min(HALO_EASE, layTo - st.lay)));
    let h: CanvasRenderingContext2D | null = null;
    if (lay > 0 && lay < 1) {
      let t = st.layTmp;
      if (!t || t.c.width < bw || t.c.height < bh) {
        /* a document canvas where there is one, as for the body */
        const n = Math.ceil(Math.max(bw, bh) / 64) * 64;
        let c: AnyCanvas | null = null;
        if (typeof document !== 'undefined') {
          c = document.createElement('canvas');
          c.width = c.height = n;
        } else c = makeCanvas(n);
        const cg = c && ctx2d(c, false);
        t = st.layTmp = c && cg ? { c, g: cg } : null;
      }
      if (t) {
        h = t.g;
        h.setTransform(1, 0, 0, 1, 0, 0);
        h.globalAlpha = 1;
        h.globalCompositeOperation = 'copy';
        h.drawImage(g.canvas as HTMLCanvasElement, 0, 0, bw, bh, 0, 0, bw, bh);
        h.imageSmoothingQuality = 'low';
        h.setTransform(g.getTransform());
      }
    }
    /* the veil below comes in with the turn: face-on no slice reaches past
       the outline, and it would only lay the halo's lighter colour over the
       edge's own shade, a light contour on a dark page */
    const veil = HALO_VEIL * Math.min(1, dl1 / 0.2);
    const laid = (d: CanvasRenderingContext2D) => {
      if (WEBKIT) {
        /* WebKit clears outside the halo for destination-atop by a box it
           rounds to whole pixels — under a scaled transform that box jumps
           a pixel as the avatar drifts by a fraction of one, and the whole
           silhouette shakes. The halo is laid on a layer first, then
           composited at whole pixels over the whole buffer, which is exact */
        let t = st.haloTmp;
        if (!t || t.c.width < bw || t.c.height < bh) {
          const n = Math.ceil(Math.max(bw, bh) / 64) * 64;
          let c: AnyCanvas | null = null;
          if (typeof document !== 'undefined') {
            c = document.createElement('canvas');
            c.width = c.height = n;
          } else c = makeCanvas(n);
          const cg = c && ctx2d(c, false);
          t = st.haloTmp = c && cg ? { c, g: cg } : null;
        }
        if (t) {
          const tg = t.g;
          tg.setTransform(1, 0, 0, 1, 0, 0);
          tg.globalCompositeOperation = 'source-over';
          tg.globalAlpha = 1;
          tg.clearRect(0, 0, bw, bh);
          tg.imageSmoothingEnabled = true;
          tg.imageSmoothingQuality = 'low';
          tg.setTransform(d.getTransform());
          tg.drawImage(fringed.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
          d.save();
          d.setTransform(1, 0, 0, 1, 0, 0);
          d.globalCompositeOperation = 'destination-atop';
          d.drawImage(t.c as HTMLCanvasElement, 0, 0, bw, bh, 0, 0, bw, bh);
          d.restore();
        }
      } else {
        d.globalCompositeOperation = 'destination-atop';
        d.drawImage(fringed.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
      }
      /* and over the body's own edge, in part, the halo's colour: the
         stack's outermost slices, reaching a little past the outline,
         would otherwise show there as a dark line inside the halo */
      if (band && veil > 0.01) {
        d.globalCompositeOperation = 'source-atop';
        d.globalAlpha = veil;
        d.drawImage(band.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
        d.globalAlpha = 1;
      }
      d.globalCompositeOperation = 'source-over';
    };
    if (h) laid(h);
    if (lay >= 1 || (!h && lay >= 0.5)) laid(g);
    else {
      const cutAway = back < 1 ? furCut(fur) : null;
      if (cutAway) {
        /* the cut grown about the outline's centre, by as much as the
           stack may reach past it at the outline's middle distance */
        const f = 1 + (back * (miss + HALO_FIT)) / 25, cx = rel.cx[0], cy = rel.cy[0];
        g.save();
        g.transform(f, 0, 0, f, cx * (1 - f), cy * (1 - f));
        g.globalCompositeOperation = 'destination-out';
        g.drawImage(cutAway as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
        g.restore();
      }
      if (gone < 1) {
        g.globalAlpha = 1 - gone;
        g.globalCompositeOperation = 'destination-over';
        /* the whole halo, solid inside and all: the body hides it but where
           the outline overhangs the stack — by no more than `over`, which
           `gone` fades — so the halo meets the body's edge there */
        g.drawImage(fringed.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
        g.globalAlpha = 1;
      }
      if (h) {
        /* (1 − lay) of the cut plus lay of the halo laid over, both
           premultiplied */
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalCompositeOperation = 'destination-in';
        g.globalAlpha = 1 - lay;
        g.fillStyle = '#000';
        g.fillRect(0, 0, bw, bh);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = lay;
        g.drawImage(h.canvas as HTMLCanvasElement, 0, 0, bw, bh, 0, 0, bw, bh);
        g.globalAlpha = 1;
      }
    }
    g.globalCompositeOperation = 'source-over';
  }

  if (g !== ctx && film) {
    /* the pile over the whole body at once, only where it is: its dark
       part in full, in a deep shade of the colour (see gapFilm), its light
       part less on a dark colour, whose tips are a lighter shade of it
       rather than white */
    g.globalCompositeOperation = 'source-atop';
    /* the film is drawn at about its own resolution: plain bilinear
       filtering looks the same, where the high-quality filter costs
       milliseconds on a large avatar */
    g.imageSmoothingQuality = 'low';
    const lin = linearColor(pal.base);
    const lum = Math.pow(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2], 1 / 2.2);
    const dark = gapFilm(film, pal.base, mat.vivid ?? 0) ?? film.dark, tips = tipFilm(film, pal.base, mat.vivid ?? 0) ?? film.light;
    /* the fibres' own light over it all: the key's highlights along them
       and the back light they carry, the halo's hairs included — baked for
       the front seen head-on, so it gives way as the body turns, to the
       matcap's own rim; and on a small avatar single fibres are finer than
       its pixels, so the matcap's rim and the halo carry the light there */
    const sheenA = rig.dev < 160 ? 0 : face >= 0.88 ? 1 : face <= 0.55 ? 0 : (face - 0.55) / 0.33;
    const sheen = sheenA > 0.01 ? sheenFilm(film, pal.base, mat) : null;
    /* The pile has depth: its tops stand over its hollows by about its
       length, so as the body turns they move across the view a little
       further than the surface under them does — the film's light part
       (the lit tops and tips) is laid that much further along the turn than
       its dark part (the hollows and gaps), and the pile is seen to have
       thickness as it moves */
    const lift = near * PILE_H * (cfg.fur ?? FUR_STOCK).length;
    const capT = mulAffine(mulAffine(mulAffine(rig.ctm, [1, 0, 0, 1, lift * sy, -lift * cy * sp]), [cy, m1, 0, cp, 0, 0]), [A, B, B, D, shift * ex - 50 * A - 50 * B, shift * ey - 50 * B - 50 * D]);
    const lay = (M: number[], a: number, withSheen: boolean, T: number[] = M) => {
      g.setTransform(M[0], M[1], M[2], M[3], M[4] - ox, M[5] - oy);
      g.globalAlpha = a;
      g.drawImage(dark as HTMLCanvasElement, -PAD - FILM_M, -PAD - FILM_M, FILM_SPAN, FILM_SPAN);
      if (T !== M) g.setTransform(T[0], T[1], T[2], T[3], T[4] - ox, T[5] - oy);
      g.globalAlpha = a * (0.25 + 0.75 * lum);
      g.drawImage(tips as HTMLCanvasElement, -PAD - FILM_M, -PAD - FILM_M, FILM_SPAN, FILM_SPAN);
      if (withSheen && sheen) {
        g.globalAlpha = a * sheenA;
        g.drawImage(sheen as HTMLCanvasElement, -PAD - FILM_M, -PAD - FILM_M, FILM_SPAN, FILM_SPAN);
      }
      g.globalAlpha = 1;
    };
    /* The film follows the front (capM), which turned far round is seen so
       obliquely that it squeezes into a strip and no longer covers the
       back half showing past it: from there on the pile is laid square to
       the view instead, over the whole turned body, at its own size — the
       front is gone by then, so nothing needs it to line up */
    const sideU = face >= 0.62 ? 0 : face <= 0.36 ? 1 : (0.62 - face) / 0.26;
    if (sideU < 1) lay(capM, 1 - sideU, true, capT);
    if (sideU > 0) {
      const k = rig.dev / 100, cxs = ox + bw / 2, cys = oy + bh / 2;
      lay([k, 0, 0, k, cxs - 50 * k, cys - 50 * k], sideU, false);
    }
    g.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(g.canvas as HTMLCanvasElement, 0, 0, bw, bh, ox, oy, bw, bh);
    ctx.restore();
  }

  ctx.setTransform(ca, cb, cc, cd, ce, cf);

  /* 3. large avatars: the texture is upscaled 2–3×, so a crisp hairline of
     the environment along the lit side of the silhouette */
  /* the line is drawn on the front's outline at the equator plane: turned,
     the back half shows past that outline, which then runs inside the
     silhouette, so it fades out as the turn begins */
  const hairA = face >= 0.95 ? 1 : face <= 0.8 ? 0 : (face - 0.8) / 0.15;
  if (!fur && rig.dev >= 256 && mat.rim > 0 && mat.highlight > 0 && hairA > 0.01) {
    ctx.save();
    if (union) ctx.clip(union);
    else ctx.globalCompositeOperation = 'source-atop';
    ctx.setTransform(capM[0], capM[1], capM[2], capM[3], capM[4], capM[5]);
    const al = hairA * Math.min(0.5, 0.3 * mat.rim * Math.min(1.4, mat.highlight));
    const g = ctx.createLinearGradient(50 + lxy[0] * 50, 50 + lxy[1] * 50, 50 - lxy[0] * 50, 50 - lxy[1] * 50);
    g.addColorStop(0, `rgba(235,244,255,${al.toFixed(3)})`);
    g.addColorStop(0.45, `rgba(235,244,255,${(0.35 * al).toFixed(3)})`);
    g.addColorStop(0.75, 'rgba(235,244,255,0)');
    ctx.strokeStyle = g;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.3;
    ctx.stroke(cfg.path);
    ctx.restore();
  }
  return true;
}
