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
/* one task at least, then as many more as the idle period has room for;
   a callback forced by its timeout runs just the one */
function pump(deadline?: { timeRemaining(): number; didTimeout?: boolean }) {
  scheduled = false;
  let fn = queue.shift();
  while (fn) {
    fn();
    if (!deadline || deadline.didTimeout || deadline.timeRemaining() < 6) break;
    fn = queue.shift();
  }
  if (queue.length) schedule();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  const ric = (globalThis as { requestIdleCallback?: (cb: (d: { timeRemaining(): number; didTimeout?: boolean }) => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(pump, { timeout: 120 });
  else setTimeout(() => pump(), 16);
}
function idle(fn: () => void) {
  queue.push(fn);
  schedule();
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
  };
  if (sync) {
    build();
    return forms.get(id) ?? null;
  }
  if (!pending.has(id)) {
    pending.add(id);
    idle(build);
  }
  return null;
}
/** Build a form ahead of time (call from an idle callback at mount). */
export function warmPlastic(key: string, path: Path2D, devicePx = 192, depth = 0.65, fabric = false, style: FurStyle = FUR_STOCK) {
  const form = formFor(key, path, tierFor(devicePx), 15 * depth, true);
  if (fabric && form) {
    /* the stock light, 300°: toward the source on screen. The pile is
       queued as idle steps rather than baked here in one long task. */
    const a = (300 * Math.PI) / 180;
    furReady(form, key, 15 * depth, Math.ceil((SPAN * devicePx) / 100), false, Math.sin(a), -Math.cos(a), style);
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
  const scale = new Float32Array(K), cx = new Float32Array(K), cy = new Float32Array(K);
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
    const [ak, xk, yk] = measure((i) => h[i] >= tau);
    scale[k] = a0 ? Math.sqrt(ak / a0) : 1;
    cx[k] = xk;
    cy[k] = yk;
  }
  const r: Relief = { top, z, q, scale, cx, cy };
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
}
export interface Frame {
  L: V3; V: V3; H: V3; U: V3; W: V3; A: V3; B: V3;
  /** down on screen, in the cap's frame: toward the floor */
  D: V3;
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
      out[k] = tone(c[0] * (ambT[0] + kd * dif) + spec * WARM[0] + env * ENV[0]);
      out[k + 1] = tone(c[1] * (ambT[1] + kd * dif) + spec * WARM[1] + env * ENV[1]);
      out[k + 2] = tone(c[2] * (ambT[2] + kd * dif) + spec * WARM[2] + env * ENV[2]);
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
    const band = Math.max(0, 1 - dd / 2.6);
    l.k[i] = 1 + 0.1 * band * band;
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
    const m = lift ? aoMul[lift.ao[i]] * lift.k[i] : aoMul[a];
    const b = i00[i] * 3, x = wx[i] * (1 / 255), y = wy[i] * (1 / 255);
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
      const t = (d + 0.6) / 1.2;
      const k = (y * R + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = t >= 1 ? 255 : t <= 0 ? 0 : Math.round(255 * t * t * (3 - 2 * t));
    }
  }
  g.putImageData(img, 0, 0);
  byR.set(R, c);
  return c;
}

/* the same fade as a mask at a pile's resolution, for fabric's front,
   whose own fringe the equator's slice carries instead */
const fades = new WeakMap<Form, Map<number, AnyCanvas | null>>();
function fadeMask(form: Form, R: number): AnyCanvas | null {
  let byR = fades.get(form);
  if (!byR) fades.set(form, (byR = new Map()));
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
      const t = d / FRONT_FADE;
      const k = (y * R + x) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 255;
      img.data[k + 3] = t >= 1 ? 255 : t <= 0 ? 0 : Math.round(255 * t * t * (3 - 2 * t));
    }
  }
  g.putImageData(img, 0, 0);
  byR.set(R, c);
  return c;
}

/* ── fabric: a plush pile instead of a clear coat ─────────────────── */

/* The same form, dressed in a short dense pile. The fibres grow down the
   slope of the pillow — out from the top of every lobe, the way a plush
   toy's fur lies — and past the edge they stand out as a ragged fringe,
   so the silhouette is soft instead of cut. Everything here depends only
   on the form, so it is made once per outline and size and kept. */

export interface Fur {
  /** the pile's own resolution: finer than the form, so the fibres stay
      thin on a large avatar */
  R: number;
  /** the pile's fibres in greys about FUR_MID, soft-lit over the lit texels */
  fibre: AnyCanvas | null;
  /** the body plus a fringe of hairs past its edge, as alpha */
  mask: AnyCanvas | null;
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
export const FUR_STOCK: FurStyle = { length: 1.4, density: 1.6, fuzz: 0.9, clumps: 0.35, curl: 0.3, gravity: 0.6 };
const styleId = (s: FurStyle) =>
  `${s.length.toFixed(2)},${s.density.toFixed(2)},${s.fuzz.toFixed(2)},${s.clumps.toFixed(2)},${s.curl.toFixed(2)},${(s.gravity ?? FUR_STOCK.gravity).toFixed(2)}`;
const furKey = (key: string, halfDepth: number, R: number, bin: number, style: FurStyle) => `${key}|${Math.round(halfDepth)}|${R}|${bin}|${styleId(style)}`;
/* a slider dragged through styles queues a bake per stop: past the two
   newest for a shape, the older ones are dropped before they run */
const queuedFor = new Map<string, string[]>();
const dropped = new Set<string>();

/* the pile's mean grey: laid over the lit texels with a soft-light blend,
   which leaves mid-grey alone, deepens the colour in the gaps (a yellow
   toward orange, not toward olive) and lifts the tips paler */
const FUR_MID = 128;

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
function furReady(form: Form, key: string, halfDepth: number, capPx: number, sync: boolean, lx: number, ly: number, style: FurStyle = FUR_STOCK): Fur | null {
  const R = furTier(capPx), bin = lightBin(lx, ly);
  const id = furKey(key, halfDepth, R, bin, style);
  const hit = furs.get(id);
  if (hit) return hit;
  if (sync) return furFor(form, key, halfDepth, capPx, lx, ly, style);
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
    const job = furJob(form, id, R, lx, ly, style);
    if (job) for (const step of job.steps) idle(() => (dropped.has(id) ? undefined : step()));
  }
  /* while it bakes, the same shape's pile at another tier or light will
     do — close enough for the few frames until this one lands */
  const prefix = `${key}|${Math.round(halfDepth)}|`;
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
 * Real plush is built in layers: a dense, fine undercoat; the main fibres,
 * darker at the root and lighter toward the tip; a few long guard hairs
 * with bright tips standing over them; all gathered into small tufts that
 * lean together and catch the light on the side that faces it. The fibres
 * are combed in one flow — away from a crown near the top of the head and
 * down, turning outward at the edge. So the pile is drawn stroke by stroke
 * into a grey layer about mid-grey and laid over the lit texels with a
 * soft-light blend: the tips come out paler than the colour, the gaps
 * deeper — a yellow going toward orange rather than olive — and the colour
 * keeps its saturation throughout. The silhouette stays a smooth curve with a haze
 * of fine hairs standing past it.
 */
export function furFor(form: Form, key = 'custom', halfDepth = 9.75, capPx = 320, lx = -1, ly = 0, style: FurStyle = FUR_STOCK): Fur {
  const R = furTier(capPx);
  const id = furKey(key, halfDepth, R, lightBin(lx, ly), style);
  const hit = furs.get(id);
  if (hit) return hit;
  const job = furJob(form, id, R, lx, ly, style);
  if (job) for (const step of job.steps) step();
  return furs.get(id) ?? { R: 0, fibre: null, mask: null };
}

/* the bake as a list of steps sharing one closure; the last one files the
   finished pile in the cache */
function furJob(form: Form, id: string, R: number, lx: number, ly: number, style: FurStyle = FUR_STOCK): { steps: (() => void)[] } | null {
  if (furs.has(id)) return null;
  /* files the finished pile, keeping the cache to a couple of dozen */
  const file = (f: Fur) => {
    if (furs.size >= 24) furs.delete(furs.keys().next().value as string);
    furs.set(id, f);
    furPending.delete(id);
  };
  const { N } = form;
  const px = R / SPAN; // pixels per design unit
  const at = (f: Float32Array, x: number, y: number) => bilerp(f, N, ((x + PAD) / SPAN) * N - 0.5, ((y + PAD) / SPAN) * N - 0.5);
  const sdAt = (x: number, y: number) => at(form.sd, x, y);
  const fur: Fur = { R, fibre: null, mask: null };
  const fc = makeCanvas(R), mc = makeCanvas(R);
  const fg = fc && ctx2d(fc, false), mg = mc && ctx2d(mc, false);
  if (!fc || !mc || !fg || !mg) {
    file(fur);
    return null;
  }
  const rand = rng(N * 7919 + 17);
  const clump = valueNoise(2.6, 3), lean = valueNoise(3.4, 21), tone = valueNoise(22, 9);
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
  /* a tuft is a small mound: lit on the side toward the light, in shade on
     the other — the clump noise read as a height, its slope against the light */
  const tuftLit = (x: number, y: number) => {
    const e = 0.5;
    const gx = clump(x + e, y) - clump(x - e, y), gy = clump(x, y + e) - clump(x, y - e);
    return Math.max(-1, Math.min(1, ((gx * Lx + gy * Ly) / (2 * e)) * 2.6 * 1.4));
  };

  /* the parting: at the top of the head over its middle */
  let crownY = 12;
  for (let y = -PAD; y < 60; y += 0.5) if (sdAt(50, y) > 0.5) { crownY = y + 1; break; }
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
    const a = (lean(x, y) - 0.5) * 1.3 + (swirl(x, y) - 0.5) * 1.1;
    const ca = Math.cos(a), sa = Math.sin(a);
    const qx = dx * ca - dy * sa, qy = dx * sa + dy * ca;
    const m = Math.hypot(qx, qy) || 1;
    return [qx / m, qy / m];
  };

  const steps: (() => void)[] = [];
  /* 1. the fleece: a plush like this is a dense, very short pile, and what
     the eye reads is its grain — a fine stipple of fibre tips and the dark
     gaps between them, gathered into tiny tufts that each catch the light
     on one side — over a slow drift in the pile's tone. It is made per
     pixel, a band of rows at a time. */
  const img = new ImageData(R, R);
  const white = new Float32Array(R * R);
  /* the body's height at a point, and so the surface under the pile: the
     grain and the tufts are a solid texture read on it — their cells crowd
     together where the surface turns away toward the outline, as a real
     fabric's do seen at a slant — and the fibres stand end-on (dots) where
     it faces the viewer and lie side-on (streaks) where it turns away */
  const hAt = (x: number, y: number) => at(form.h, x, y);
  const tuft = valueNoise3(0.55 + 0.35 * kLen, 77);
  const grain3 = valueNoise3(0.34, 5);
  /* the surface's slope at a point: which way is downhill, and how steep
     (0 facing the viewer … toward 1 at the outline) */
  const slopeAt = (x: number, y: number): [number, number, number] => {
    const e = 0.6;
    const gx = (hAt(x + e, y) - hAt(x - e, y)) / (2 * e), gy = (hAt(x, y + e) - hAt(x, y - e)) / (2 * e);
    const m = Math.hypot(gx, gy);
    return [m > 1e-6 ? -gx / m : 0, m > 1e-6 ? -gy / m : 0, m / Math.sqrt(1 + m * m)];
  };
  const BAND = 96;
  for (let y0 = 0; y0 < R; y0 += BAND) {
    steps.push(() => {
      const y1 = Math.min(R, y0 + BAND);
      /* white noise for these rows and one either side, for the blur */
      for (let y = Math.max(0, y0 - 1); y < Math.min(R, y1 + 1); y++) for (let x = 0; x < R; x++) white[y * R + x] = hash2(x + 911, y + 37);
      const grainA = 38, tuftA = 26 * (0.35 + clumps), litA = 20 * (0.3 + clumps);
      /* the grain's cells: about a third of a unit, never under a pixel */
      const gc = Math.max(1, 0.34 * px);
      /* the surface height and the tufts for these rows and one either side,
         so each tuft's light is a difference of its neighbours */
      const ya = Math.max(0, y0 - 1), yb = Math.min(R, y1 + 1);
      const zs = new Float32Array((yb - ya) * R), ts = new Float32Array((yb - ya) * R);
      for (let y = ya; y < yb; y++) {
        const Y = (y + 0.5) / px - PAD;
        for (let x = 0; x < R; x++) {
          const X = (x + 0.5) / px - PAD;
          const o = (y - ya) * R + x;
          zs[o] = hAt(X, Y);
          ts[o] = tuft(X, Y, zs[o]);
        }
      }
      const dk = (px / 2) * 1.1;
      for (let y = y0; y < y1; y++) {
        const Y = (y + 0.5) / px - PAD;
        for (let x = 0; x < R; x++) {
          const X = (x + 0.5) / px - PAD;
          const i = y * R + x;
          const o = (y - ya) * R + x;
          const Z = zs[o];
          const tl = x > 0 ? ts[o - 1] : ts[o], tr = x < R - 1 ? ts[o + 1] : ts[o];
          const tu = y > ya ? ts[o - R] : ts[o], td = y < yb - 1 ? ts[o + R] : ts[o];
          const lit = ((tr - tl) * Lx + (td - tu) * Ly) * dk;
          const tuftLit3 = lit < -1 ? -1 : lit > 1 ? 1 : lit;
          let grain: number;
          if (gc <= 1.05) {
            /* a pixel is already as fine as the grain: blurred white noise */
            const l = x > 0 ? white[i - 1] : white[i], r = x < R - 1 ? white[i + 1] : white[i];
            const u = y > 0 ? white[i - R] : white[i], d = y < R - 1 ? white[i + R] : white[i];
            grain = (4 * white[i] + l + r + u + d) / 8 - 0.5;
          } else grain = (grain3(X, Y, Z) - 0.5) * 1.35;
          const v =
            FUR_MID +
            (tone(X, Y) - 0.5) * 14 +
            grain * 2 * grainA +
            (ts[o] - 0.5) * 2 * tuftA +
            tuftLit3 * litA;
          const k = i * 4;
          img.data[k] = img.data[k + 1] = img.data[k + 2] = v < 0 ? 0 : v > 255 ? 255 : v;
          img.data[k + 3] = 255;
        }
      }
      fg.putImageData(img, 0, 0, 0, y0, R, y1 - y0);
      fg.lineCap = 'round';
      fg.lineJoin = 'round';
    });
  }

  /* 2. the pile over it: short fibres combed with the flow but messily,
     root in shade and tip in the light, and a sparse few longer ones that
     glint — strokes bucketed by shade, so a layer is a few dozen stroke
     calls however many fibres it draws */
  const SHADES = 16;
  const area = SPAN * SPAN;
  const layers = [
    { count: 1.4, len: [0.45, 0.65], width: 0.12, spread: 56, alpha: 0.5, split: true, lift: 0.02 },
    { count: 0.12, len: [1.0, 0.9], width: 0.1, spread: 50, alpha: 0.36, split: true, lift: 0.16 },
  ];
  const shadeOf = (v: number) => Math.min(SHADES - 1, Math.max(0, Math.round(((Math.max(-1, Math.min(1, v)) + 1) / 2) * (SHADES - 1))));
  /* a dense layer goes in more, smaller steps, so no one idle task runs
     long enough to cost a frame */
  for (const L of layers) {
    const parts = Math.max(1, Math.ceil((L.count * kDen) / 1.2));
    for (let part = 0; part < parts; part++) steps.push(() => {
    const buckets: Path2D[] = [];
    for (let i = 0; i < SHADES; i++) buckets.push(new Path2D());
    const count = Math.round((area * L.count * kDen) / parts);
    for (let n = 0; n < count; n++) {
      const X = rand() * SPAN - PAD, Y = rand() * SPAN - PAD;
      if (sdAt(X, Y) < -0.3) continue;
      let [fx, fy] = flow(X, Y);
      /* where the surface turns away the fibres lie down its slope, seen
         side-on; where it faces the viewer they stand end-on, short */
      const [dx, dy, tiltS] = slopeAt(X, Y);
      fx = fx * (1 - tiltS) + dx * tiltS;
      fy = fy * (1 - tiltS) + (dy + 0.35 * gravity) * tiltS;
      const fl = Math.hypot(fx, fy) || 1;
      fx /= fl;
      fy /= fl;
      const ang = (rand() - 0.5) * (0.6 + 0.8 * curl) * (1 - 0.5 * tiltS);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const ux = fx * ca - fy * sa, uy = fx * sa + fy * ca;
      /* mostly the layer's length, now and then a stray half as long again */
      const stray = rand() < 0.1 ? 1.35 + 0.6 * rand() : 1;
      const len = (L.len[0] + L.len[1] * rand()) * px * kLen * stray * (0.35 + 0.95 * tiltS);
      /* the fibre's own shade: its tuft's light and height, and whether it
         is one catching the light or one in a gap */
      const r0 = rand();
      let v = (clump(X, Y) - 0.5) * 1.2 * clumps + tuftLit(X, Y) * 0.8 * clumps;
      /* seen from above, a pile is mostly tips: more fibres catch the
         light than fall into the gaps between them */
      if (r0 < 0.46) v += 0.2 + 0.28 * rand();
      else if (r0 < 0.8) v -= 0.2 + 0.28 * rand();
      v += L.lift;
      const x0 = (X + PAD) * px, y0 = (Y + PAD) * px;
      const bend = (rand() - 0.5) * 0.93 * curl * len;
      const mx = x0 + ux * len * 0.45 - uy * bend, my = y0 + uy * len * 0.45 + ux * bend;
      const x1 = x0 + ux * len, y1 = y0 + uy * len;
      if (L.split) {
        /* root in shade, tip in the light */
        const rb = buckets[shadeOf(v - 0.2)], tb = buckets[shadeOf(v + 0.12)];
        rb.moveTo(x0, y0);
        rb.lineTo(mx, my);
        tb.moveTo(mx, my);
        tb.lineTo(x1, y1);
      } else {
        const b = buckets[shadeOf(v)];
        b.moveTo(x0, y0);
        b.quadraticCurveTo(mx, my, x1, y1);
      }
    }
    fg.lineWidth = Math.max(0.45, L.width * px);
    fg.globalAlpha = L.alpha;
    for (let i = 0; i < SHADES; i++) {
      const g = Math.min(255, Math.round(FUR_MID + ((i / (SHADES - 1)) * 2 - 1) * L.spread));
      fg.strokeStyle = `rgb(${g},${g},${g})`;
      fg.stroke(buckets[i]);
    }
    fg.globalAlpha = 1;
    });
  }

  /* 3. the fuzz: fibres rooted just inside the edge, standing out past it —
     many, very fine, of mixed length (mostly short, a few long), leaning
     with the flow, so the edge is a soft haze rather than a comb */
  steps.push(() => {
  const fringe = new Path2D();
  const edgeTries = Math.round(area * 12 * (0.3 + 1.4 * fuzz) * Math.sqrt(kDen));
  for (let n = 0; n < edgeTries; n++) {
    const X = rand() * SPAN - PAD, Y = rand() * SPAN - PAD;
    const d = sdAt(X, Y);
    if (d < -0.2 || d > 1.0) continue;
    const [fx, fy] = flow(X, Y);
    const [ox, oy] = outward(X, Y);
    const ang = (rand() - 0.5) * 1.1;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let ux = fx * ca - fy * sa, uy = fx * sa + fy * ca;
    const r1 = rand();
    /* hanging hairs are longer below and at the sides than on top */
    const hang = 1 + 0.5 * gravity * Math.max(0, oy) - 0.35 * gravity * Math.max(0, -oy);
    let fl = (0.25 + 1.1 * r1 * r1 * r1) * px * kLen * (0.5 + fuzz) * hang;
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
    fringe.quadraticCurveTo(x0 + ux * fl * 0.5 - uy * bend, y0 + uy * fl * 0.5 + ux * bend, x0 + ux * fl, y0 + uy * fl + gravity * fl * 0.25);
  }
  /* the edge hairs are seen side-on against the light: a touch lighter */
  fg.lineWidth = Math.max(0.35, 0.08 * px);
  fg.globalAlpha = 0.5;
  fg.strokeStyle = 'rgb(200,200,200)';
  fg.stroke(fringe);
  fg.globalAlpha = 1;

  /* 4. the coverage: the outline with a soft feather — a smooth curve, as
     plush is — and the fuzz standing past it */
  /* the feather spans a unit and a half: half the resolution, scaled up,
     draws it the same */
  const Rh = R >> 1, ph = Rh / SPAN;
  const hc = makeCanvas(Rh), hg = hc && ctx2d(hc, false);
  const mi = new ImageData(Rh, Rh);
  for (let y = 0; y < Rh; y++) {
    for (let x = 0; x < Rh; x++) {
      const d = sdAt((x + 0.5) / ph - PAD, (y + 0.5) / ph - PAD);
      const fIn = 0.2 + 0.35 * fuzz, fOut = 0.35 + 0.9 * fuzz;
      const a = d >= fIn ? 1 : d <= -fOut ? 0 : (d + fOut) / (fIn + fOut);
      const k = (y * Rh + x) * 4;
      mi.data[k] = mi.data[k + 1] = mi.data[k + 2] = 255;
      mi.data[k + 3] = Math.round(255 * a * a * (3 - 2 * a));
    }
  }
  if (hc && hg) {
    hg.putImageData(mi, 0, 0);
    mg.imageSmoothingEnabled = true;
    mg.imageSmoothingQuality = 'high';
    mg.drawImage(hc as HTMLCanvasElement, 0, 0, R, R);
  }
  mg.lineCap = 'round';
  mg.lineWidth = Math.max(0.35, 0.08 * px);
  mg.strokeStyle = 'rgba(255,255,255,0.24)';
  mg.stroke(fringe);

  fur.fibre = fc;
  fur.mask = mc;
  file(fur);
  });
  return { steps };
}

/** The lit sphere for the pile: a softly wrapped diffuse that still
    rounds every lobe, and a sheen that grows toward the silhouette, where
    the fibres catch the light side-on. No specular lobe and no
    reflections — fur has no clear coat. */
export function buildFabricMatcap(out: Float32Array, c: V3, f: Frame, p: Material) {
  const { V, U, D } = f;
  /* the key comes in lower than plastic's, from further round the side, so
     the far side of the form falls into real shade */
  const EK = (34 * Math.PI) / 180;
  const L = norm3([U[0] * Math.cos(EK) + V[0] * Math.sin(EK), U[1] * Math.cos(EK) + V[1] * Math.sin(EK), U[2] * Math.cos(EK) + V[2] * Math.sin(EK)]);
  /* A plush toy under studio light: a large soft key high on the light's
     side, turning into shade gradually — the pile scatters it, so the
     terminator is wide and the shade keeps the body's colour, deepened
     rather than greyed; a dim fill from the other side and the front, so
     no side goes flat; a thin back light the fibres at the silhouette catch
     all round; and the floor's occlusion under the body. */
  const amb = Math.max(0.03, 0.12 - 0.1 * p.shadow);
  const wrap = Math.min(0.9, 0.2 + 0.16 * p.spread);
  const kd = 1.4;
  const fillK = 0.1, floorK = 0.34 * Math.min(1.5, p.shadow / 0.35);
  /* the fill: from the other side of the screen, a little low, mostly from
     the front */
  const Fl = norm3([-0.55 * U[0] + 0.85 * V[0] + 0.15 * D[0], -0.55 * U[1] + 0.85 * V[1] + 0.15 * D[1], -0.55 * U[2] + 0.85 * V[2] + 0.15 * D[2]]);
  const sheenK = 0.26 * p.highlight, rimK = 0.16 * p.rim;
  /* the sheen and the back light are the body colour itself: plush keeps
     its colour where it catches the light, it does not go white */
  const tint: V3 = [c[0], c[1], c[2]];
  /* the shade is the colour deepened: a little more saturated, not grey */
  const deep: V3 = [c[0] * c[0] * 0.9 + c[0] * 0.1, c[1] * c[1] * 0.9 + c[1] * 0.1, c[2] * c[2] * 0.9 + c[2] * 0.1];
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
      /* the key, wrapped, with a gamma on it so the light falls off toward
         the shade like a round form's, and a little more wrap toward the
         silhouette where the fibres scatter it */
      const w = wrap + (1.2 - wrap) * (1 - nz) * (1 - nz);
      let dif = Math.min(1, Math.max(0, (nl + w) / (1 + w)));
      dif = Math.pow(dif, 1.25);
      const fill = fillK * Math.max(0, nx * Fl[0] + ny * Fl[1] + nz * Fl[2]);
      const floor = 1 - floorK * Math.max(0, nx * D[0] + ny * D[1] + nz * D[2]) * (0.6 + 0.4 * (1 - nv));
      const q = 1 - nv, graze = q * q;
      const lit = Math.min(1, Math.max(0, (nl + 0.3) / 1.3));
      /* the sheen on the lit side where the fibres lie side-on, and the back
         light round the whole silhouette, strongest away from the key */
      const away = 0.45 + 0.55 * Math.max(0, -(nx * U[0] + ny * U[1] + nz * U[2]));
      const sheen = sheenK * graze * lit + rimK * graze * graze * graze * away;
      const light = (amb + kd * dif + fill) * floor;
      /* toward the shade the colour deepens rather than greys */
      const t = Math.min(1, Math.max(0, (1.1 - light) / 1.1));
      const k = (j * M + i) * 3;
      let r = 0, g = 0, b = 0;
      for (let ch = 0; ch < 3; ch++) {
        const base = c[ch] + (deep[ch] - c[ch]) * t * 0.85;
        const v = base * light + sheen * tint[ch];
        if (ch === 0) r = v;
        else if (ch === 1) g = v;
        else b = v;
      }
      /* bright parts roll off as a whole, not channel by channel: a lit
         yellow stays yellow instead of its red clipping first and the rest
         running on toward green */
      const mx = Math.max(r, g, b);
      if (mx > 0.8) {
        const kk = (0.8 + 0.2 * (1 - Math.exp(-(mx - 0.8) / 0.2))) / mx;
        r *= kk;
        g *= kk;
        b *= kk;
      }
      out[k] = srgb(r);
      out[k + 1] = srgb(g);
      out[k + 2] = srgb(b);
    }
  }
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
  return { L, V, H, U, W, A, B, D };
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
      with the matcap */
  sprites: ({ c: AnyCanvas; g: CanvasRenderingContext2D } | null)[];
  spriteVersion: number;
  spritePx: number;
  spriteFur: Fur | null;
  /** fabric: the lit texels at the pile's resolution with its streaks and
      fringe applied, two in turn for the same reason as the scratch */
  furCap: ({ c: AnyCanvas; g: CanvasRenderingContext2D } | null)[];
  furCapIdx: number;
  furCapFrom: AnyCanvas | null;
  furCapR: number;
  /** the pile the composite was made with: a new light bakes a new one */
  furCapFur: Fur | null;
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
      L: null, V: null, lx: NaN, ly: NaN, base: '', shadow: NaN, highlight: NaN, spread: NaN, rim: NaN,
      version: 0, imgVersion: -1, imgAoK: NaN, imgForm: null, aoK: -1, aoMul: new Float32Array(256),
      scratch: [null, null], scratchIdx: 0, scratchN: 0, scratchStale: true,
      sprites: [null, null, null, null], spriteVersion: -1, spritePx: 0, spriteFur: null,
      furCap: [null, null], furCapIdx: 0, furCapFrom: null, furCapR: 0, furCapFur: null,
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
function sideGradient(ctx: CanvasRenderingContext2D, mc: Float32Array, nz: number, dark: number, lxy: [number, number], linear = false): CanvasGradient {
  const rr = Math.sqrt(1 - nz * nz), c: V3 = [0, 0, 0], k = 1 - dark;
  if (!linear && typeof ctx.createConicGradient === 'function') {
    const g = ctx.createConicGradient(0, 50, 50);
    for (let s = 0; s <= CONIC_STOPS; s++) {
      const phi = (s / CONIC_STOPS) * Math.PI * 2;
      sampleMatcap(mc, rr * Math.cos(phi), rr * Math.sin(phi), c);
      g.addColorStop(s / CONIC_STOPS, `rgb(${(c[0] * k) | 0} ${(c[1] * k) | 0} ${(c[2] * k) | 0})`);
    }
    return g;
  }
  /* no conic gradients (Safari < 16.4): a ramp along the light */
  const g = ctx.createLinearGradient(50 + lxy[0] * 50, 50 + lxy[1] * 50, 50 - lxy[0] * 50, 50 - lxy[1] * 50);
  const at = (nx: number, ny: number, t: number) => {
    sampleMatcap(mc, nx, ny, c);
    g.addColorStop(t, `rgb(${(c[0] * k) | 0} ${(c[1] * k) | 0} ${(c[2] * k) | 0})`);
  };
  at(rr * lxy[0], rr * lxy[1], 0);
  at(-rr * lxy[1], rr * lxy[0], 0.5);
  at(-rr * lxy[0], -rr * lxy[1], 1);
  return g;
}

/* The side's light taken from the front's own texels just inside the
   outline, all the way round: the slices then carry exactly the colour the
   front has at its edge — its occlusion, its rim — so the front blends
   into them with no ring. `inset` is how far in, in design units. */
function edgeGradient(
  ctx: CanvasRenderingContext2D,
  img: ImageData,
  form: Form,
  inset: number,
  c0: [number, number],
  lxy: [number, number],
  linear: boolean
): CanvasGradient {
  const { N, sd } = form;
  const d = img.data;
  const toG = (v: number) => ((v + PAD) / SPAN) * N - 0.5;
  const sample = (phi: number): V3 => {
    const ux = Math.cos(phi), uy = Math.sin(phi);
    /* out from the centre to where the body is `inset` from its edge */
    let r = 0;
    for (let s = 0; s < 80; s += 0.5) {
      if (bilerp(sd, N, toG(c0[0] + ux * s), toG(c0[1] + uy * s)) < inset) break;
      r = s;
    }
    const out: V3 = [0, 0, 0];
    let n = 0;
    for (const back of [0, 0.8, 1.6]) {
      const gx = Math.round(toG(c0[0] + ux * (r - back))), gy = Math.round(toG(c0[1] + uy * (r - back)));
      if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
      const k = (gy * N + gx) * 4;
      if (d[k + 3] === 0 && back > 0) continue;
      out[0] += d[k];
      out[1] += d[k + 1];
      out[2] += d[k + 2];
      n++;
    }
    return n ? [out[0] / n, out[1] / n, out[2] / n] : out;
  };
  const css3 = (c: V3) => `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0})`;
  if (!linear && typeof ctx.createConicGradient === 'function') {
    const g = ctx.createConicGradient(0, c0[0], c0[1]);
    for (let s = 0; s <= CONIC_STOPS; s++) g.addColorStop(s / CONIC_STOPS, css3(sample((s / CONIC_STOPS) * Math.PI * 2)));
    return g;
  }
  const g = ctx.createLinearGradient(c0[0] + lxy[0] * 50, c0[1] + lxy[1] * 50, c0[0] - lxy[0] * 50, c0[1] - lxy[1] * 50);
  g.addColorStop(0, css3(sample(Math.atan2(lxy[1], lxy[0]))));
  g.addColorStop(0.5, css3(sample(Math.atan2(lxy[0], -lxy[1]))));
  g.addColorStop(1, css3(sample(Math.atan2(-lxy[1], -lxy[0]))));
  return g;
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
  const fur = fabric ? furReady(form, cfg.typeKey ?? pathId(cfg.path), rig.halfDepth, capPx, !!rig.still, rig.lx, rig.ly, cfg.fur ?? FUR_STOCK) : null;
  if (fabric && !fur) return false;
  const st = stateFor(ctx, (cfg.typeKey ?? pathId(cfg.path)) + (fabric ? '|fabric' : ''));
  const f = capFrame(rig);
  const lxy: [number, number] = (() => {
    const l = Math.hypot(f.L[0], f.L[1]);
    return l < 0.05 ? [0, -1] : [f.L[0] / l, f.L[1] / l];
  })();
  if (
    moved(f.L, st.L) || moved(f.V, st.V) || rig.lx !== st.lx || rig.ly !== st.ly || pal.base !== st.base ||
    mat.shadow !== st.shadow || mat.highlight !== st.highlight || mat.spread !== st.spread || mat.rim !== st.rim
  ) {
    /* the fade starts from what is showing now, so a rebuild during a
       fade does not jump */
    if (st.version > 0) st.mcPrev.set(st.mcMix);
    if (fabric) buildFabricMatcap(st.mc, linearColor(pal.base), f, mat);
    else buildMatcap(st.mc, linearColor(pal.base), f, mat);
    if (st.version === 0) {
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
  const aoK = fur ? Math.min(1.5, 0.4 + 1.3 * mat.shadow) : Math.min(1.3, 1.2 * mat.shadow);
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
  /* fabric: the texels enlarged to the pile's resolution, the streaks
     multiplied in, then cut to the body plus its fringe — redone only when
     the texels change */
  let capSrc: AnyCanvas = sc.c;
  if (fur && fur.fibre && fur.mask) {
    if (st.furCapR !== fur.R) {
      st.furCap = [null, null];
      st.furCapR = fur.R;
      st.furCapFrom = null;
    }
    if (st.furCapFrom !== sc.c || st.furCapFur !== fur) {
      st.furCapIdx ^= 1;
      let fc = st.furCap[st.furCapIdx];
      if (!fc) {
        const c = makeCanvas(fur.R);
        const g = c && ctx2d(c, false);
        if (c && g) fc = st.furCap[st.furCapIdx] = { c, g };
      }
      if (fc) {
        const R = fur.R;
        fc.g.globalCompositeOperation = 'copy';
        fc.g.imageSmoothingEnabled = true;
        fc.g.imageSmoothingQuality = 'high';
        fc.g.drawImage(sc.c as HTMLCanvasElement, 0, 0, R, R);
        fc.g.globalCompositeOperation = 'soft-light';
        fc.g.globalAlpha = 1;
        fc.g.drawImage(fur.fibre as HTMLCanvasElement, 0, 0);
        /* the pile changes how light the colour is, never the colour: its
           hue and saturation come back from the lit texels, so paler tips
           do not wash a saturated yellow out */
        fc.g.globalCompositeOperation = 'color';
        fc.g.drawImage(sc.c as HTMLCanvasElement, 0, 0, R, R);
        fc.g.globalCompositeOperation = 'destination-in';
        fc.g.drawImage((fadeMask(form, R) ?? fur.mask) as HTMLCanvasElement, 0, 0);
        fc.g.globalCompositeOperation = 'source-over';
        st.furCapFrom = sc.c;
        st.furCapFur = fur;
      }
    }
    const fc = st.furCap[st.furCapIdx];
    if (fc) capSrc = fc.c;
  }

  /* the body: slices of the outline through the depth, each scaled to the
     cushion's profile there and shaded as the form's side at that depth —
     the far half sinking into shade toward its back, the near half's
     shoulder turning toward the light of the front — back to front; then
     the lit front laid over them once (below). No texture is repeated in
     the slices, so a side view is one smooth rounded surface. */
  const K = rig.dev <= 100 ? 10 : rig.dev <= 224 ? 14 : 18;
  const rel = reliefFor(form, K, rig.round ?? 1);
  /* the slices' three sprites — the side's light at the equator, black for
     the far half's shade, the side's light at the shoulder — at the
     avatar's device size */
  const spx = Math.ceil((SPAN * rig.dev) / 100);
  if (st.spritePx !== spx) {
    st.sprites = [null, null, null, null];
    st.spritePx = spx;
    st.spriteVersion = -1;
  }
  if (st.spriteVersion !== st.version || st.spriteFur !== fur) {
    const k = spx / SPAN;
    /* fabric: only the equator's slice carries the fringe; the others end
       in a plain soft edge, so a side view is not combed with fringes */
    const soft = fur ? softMask(form, fur.R) : null;
    for (let i = 0; i < 4; i++) {
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
      g.setTransform(k, 0, 0, k, PAD * k, PAD * k);
      /* the side's light at the equator (with the fringe, and again without),
         a black silhouette laid over the deeper slices of the far half, and
         the side's light turned toward the front for the near half's shoulder */
      g.fillStyle = i === 1 ? '#000' : edgeGradient(g, st.img!, form, i === 2 ? 6 : 2.5, [rel.cx[0], rel.cy[0]], lxy, WEBKIT);
      if (fur && fur.fibre && fur.mask) {
        /* the square in the side's light, the pile multiplied in, then cut
           to the body and its fringe */
        g.fillRect(-PAD, -PAD, SPAN, SPAN);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        if (i !== 1) {
          g.globalCompositeOperation = 'soft-light';
          g.drawImage(fur.fibre as HTMLCanvasElement, 0, 0, spx, spx);
          /* and the side's own colour back over the grain, as for the texture */
          g.globalCompositeOperation = 'color';
          g.setTransform(k, 0, 0, k, PAD * k, PAD * k);
          g.fillRect(-PAD, -PAD, SPAN, SPAN);
          g.setTransform(1, 0, 0, 1, 0, 0);
        }
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(((i === 0 ? fur.mask : soft) ?? fur.mask) as HTMLCanvasElement, 0, 0, spx, spx);
        g.globalCompositeOperation = 'source-over';
      } else g.fill(cfg.path);
    }
    st.spriteVersion = st.version;
    st.spriteFur = fur;
  }
  const { cy, sy, cp, sp } = rig;
  const [ca, cb, cc, cd, ce, cf] = rig.ctm;
  const m1 = sy * sp;
  const ta = ca * cy + cc * m1, tb = cb * cy + cd * m1, tc = cc * cp, td = cd * cp;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  /* at depth z: yaw about Y then pitch about X, orthographic */
  const at = (z: number) => {
    const e = z * sy - 50 * cy, fo = -z * cy * sp - 50 * m1 - 50 * cp;
    ctx.setTransform(ta, tb, tc, td, ca * e + cc * fo + ce, cb * e + cd * fo + cf);
  };
  const [fringed, black, shoulder, side] = st.sprites as { c: AnyCanvas }[];
  const slice = (k: number, z: number, dark: number, turn: number) => {
    at(z);
    const sk = rel.scale[k];
    if (k > 0) ctx.transform(sk, 0, 0, sk, rel.cx[k] - sk * rel.cx[0], rel.cy[k] - sk * rel.cy[0]);
    ctx.drawImage((k === 0 ? fringed : side).c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
    if (turn > 0.02) {
      ctx.globalAlpha = Math.min(1, turn);
      ctx.drawImage(shoulder.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
    }
    if (dark > 0.01) {
      ctx.globalAlpha = dark;
      ctx.drawImage(black.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
    }
    ctx.globalAlpha = 1;
  };
  const near = rig.facing >= 0 ? 1 : -1;
  const backShade = Math.min(0.7, 0.55 * Math.min(1.6, mat.shadow / 0.35));
  /* the far half, deepest first, each slice a little further into shade */
  for (let k = K - 1; k >= 1; k--) slice(k, -near * rel.z[k], backShade * (1 - Math.exp(-2.4 * (k / K))), 0);
  slice(0, 0, 0, 0);
  /* the near half: its shoulder tips toward the front as the profile
     narrows, so its light turns toward the front's */
  const r0 = 50;
  for (let k = 1; k < K; k++) {
    const k0 = Math.max(1, k - 1), k1 = Math.min(K - 1, k + 1);
    const ds = (rel.scale[k1] - rel.scale[k0]) * r0, dz = rel.z[k1] - rel.z[k0] || 1;
    const slope = -ds / dz;
    const nz = slope / Math.sqrt(1 + slope * slope);
    slice(k, near * rel.z[k], 0, (nz - 0.15) / 0.55);
  }

  ctx.setTransform(ca, cb, cc, cd, ce, cf);

  /* the lit front, once, at the equator plane: turned, the front's
     projection runs from the equator on the side turning away to the
     shoulder's silhouette on the side turning toward the viewer, so the
     texture is stretched along the turn to span exactly that (no stretch
     head-on) */
  const dxs = sy / cy, dys = -sp / (cy * cp);
  const dl1 = Math.hypot(dxs, dys);
  let lead = 50;
  for (let k = 1; k < K; k++) lead = Math.max(lead, 50 * rel.scale[k] + rel.z[k] * dl1);
  const ex = dl1 > 1e-6 ? (near * dxs) / dl1 : 1, ey = dl1 > 1e-6 ? (near * dys) / dl1 : 0;
  const stretch = (lead + 50) / 100, shift = (lead - 50) / 2;
  const A = 1 + (stretch - 1) * ex * ex, B = (stretch - 1) * ex * ey, D = 1 + (stretch - 1) * ey * ey;
  const capM = mulAffine(mulAffine(rig.ctm, [cy, m1, 0, cp, 0, 0]), [A, B, B, D, shift * ex - 50 * A - 50 * B, shift * ey - 50 * B - 50 * D]);
  /* The front fades out over its outer band into the slices under it; the
     silhouette is the slices' (and fabric's fringe is the equator slice's).
     Turned far round, the front is seen so obliquely that a flat picture
     of it no longer fits the form: it gives way to the slices' own smooth
     light, so a side view is one rounded surface without a seam. */
  const face = Math.abs(rig.facing);
  const frontA = face >= 0.72 ? 1 : face <= 0.34 ? 0 : ((face - 0.34) / 0.38) ** 1.5;
  if (frontA > 0.01) {
    ctx.save();
    ctx.setTransform(capM[0], capM[1], capM[2], capM[3], capM[4], capM[5]);
    ctx.globalAlpha = frontA;
    ctx.drawImage(capSrc as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
    ctx.restore();
  }

  /* 3. large avatars: the texture is upscaled 2–3×, so a crisp hairline of
     the environment along the lit side of the silhouette */
  if (!fur && rig.dev >= 256 && mat.rim > 0 && mat.highlight > 0) {
    ctx.save();
    if (union) ctx.clip(union);
    else ctx.globalCompositeOperation = 'source-atop';
    ctx.setTransform(capM[0], capM[1], capM[2], capM[3], capM[4], capM[5]);
    const al = Math.min(0.5, 0.3 * mat.rim * Math.min(1.4, mat.highlight));
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
