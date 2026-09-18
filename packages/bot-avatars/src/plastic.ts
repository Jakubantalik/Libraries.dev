/* plastic.ts — the 'plastic' shading: a glossy toy-plastic material for
   the front cap, lit per texel.

   Once per outline (× texture size × depth) the outline is rasterised into
   a small grid and turned into a FORM: a signed distance, a pillow height
   field (the torsion function of the outline, so lobes are domes, rays
   are tubes and there is no crease), its normals, and baked ambient
   occlusion. Per frame the light and the view are rotated into the cap's
   own frame; a small MATCAP (a lit sphere: one colour per normal) is
   evaluated with the full material — only when the light or the view has
   moved — and the cap's texels are a bilinear lookup into it, composited
   through the cap's affine under a vector clip. The side copies take
   conic gradients sampled from the same matcap, so sides and cap agree.

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
const MM = M * M;
/** Stops on the conic side gradients. */
const CONIC_STOPS = 24;
const INF = 1e12;
/** Light elevation off the screen plane. */
const EL = (48 * Math.PI) / 180;
const E_XY = Math.cos(EL), E_Z = Math.sin(EL);
const SLICES = 13;
const profile = (z: number, cap: number) => cap + (1 - cap) * Math.sqrt(Math.max(0, 1 - z * z));

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
  const hMax = Math.min(0.9 * halfDepth + 0.12 * rIn, 1.2 * rIn);
  const kh = phiMax > 0 ? hMax / Math.sqrt(phiMax) : 0;
  const h = new Float32Array(NN);
  for (let i = 0; i < NN; i++) h[i] = phi[i] > 0 ? kh * Math.sqrt(phi[i]) : 0;
  blur5(h, N, tmp);

  /* normals, silhouette fix, horizon AO, matcap cells */
  const form: Form = { N, i00: new Uint16Array(NN), wx: new Uint8Array(NN), wy: new Uint8Array(NN), ao: new Uint8Array(NN) };
  const { i00, wx, wy, ao } = form;
  const STEPS = N <= 64 ? [1, 2, 3, 5, 8] : N <= 96 ? [1, 2, 4, 7, 11] : [1, 2, 4, 7, 11, 15];
  const halo = 9; // outside texels within 3 texels borrow their nearest inside texel
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
const scratch = new Map<number, { c: AnyCanvas; g: CanvasRenderingContext2D; owner: unknown; key: string }>();
function scratchFor(N: number) {
  let s = scratch.get(N);
  if (!s) {
    const c = makeCanvas(N);
    const g = c && ctx2d(c, false);
    if (!c || !g) return null;
    s = { c, g, owner: null, key: '' };
    scratch.set(N, s);
  }
  return s;
}

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
function idle(fn: () => void) {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 120 });
  else setTimeout(fn, 0);
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
export function warmPlastic(key: string, path: Path2D, devicePx = 192, depth = 0.65) {
  formFor(key, path, tierFor(devicePx), 15 * depth, true);
}
/** Texture size for an avatar `devicePx` wide (CSS px × device pixel ratio). */
export function tierFor(devicePx: number): number {
  return devicePx <= 100 ? 64 : devicePx <= 224 ? 96 : 128;
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

/** Per frame: matcap lookup × baked AO into the texture's pixels. */
export function shadeTexels(form: Form, mc: Float32Array, px: Uint8ClampedArray, aoMul: Float32Array) {
  const { N, i00, wx, wy, ao } = form;
  const R = M * 3;
  for (let i = 0, k = 0; i < N * N; i++, k += 4) {
    const a = ao[i];
    if (a === 0) {
      px[k + 3] = 0;
      continue;
    }
    const m = aoMul[a];
    const b = i00[i] * 3, x = wx[i] * (1 / 255), y = wy[i] * (1 / 255);
    const w00 = (1 - x) * (1 - y) * m, w10 = x * (1 - y) * m, w01 = (1 - x) * y * m, w11 = x * y * m;
    px[k] = mc[b] * w00 + mc[b + 3] * w10 + mc[b + R] * w01 + mc[b + R + 3] * w11;
    px[k + 1] = mc[b + 1] * w00 + mc[b + 4] * w10 + mc[b + R + 1] * w01 + mc[b + R + 4] * w11;
    px[k + 2] = mc[b + 2] * w00 + mc[b + 5] * w10 + mc[b + R + 2] * w01 + mc[b + R + 5] * w11;
    px[k + 3] = 255;
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
  /** no animation loop will follow: build the form now rather than on idle time */
  still?: boolean;
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
  return { L, V, H, U, W, A, B };
}

/* ── per-instance state, hung on the canvas ────────────────────────── */

interface State {
  N: number;
  img: ImageData | null;
  mc: Float32Array;
  mcKey: string;
  imgKey: string;
  aoK: number;
  aoMul: Float32Array;
  /** side gradients sampled from the matcap: the near shoulder, the rim, the far shoulder */
  near: CanvasGradient | null;
  rimG: CanvasGradient | null;
  far: CanvasGradient | null;
}
const states = new WeakMap<object, State>();
function stateFor(ctx: CanvasRenderingContext2D): State {
  const key = (ctx.canvas as object) ?? ctx;
  let s = states.get(key);
  if (!s) {
    s = { N: 0, img: null, mc: new Float32Array(MM * 3), mcKey: '', imgKey: '', aoK: -1, aoMul: new Float32Array(256), near: null, rimG: null, far: null };
    states.set(key, s);
  }
  return s;
}

/* a gradient round the outline from the matcap's ring at height nz,
   darkened by `dark` (the far shoulder faces away) */
function sideGradient(ctx: CanvasRenderingContext2D, mc: Float32Array, nz: number, dark: number, lxy: [number, number]): CanvasGradient {
  const rr = Math.sqrt(1 - nz * nz), c: V3 = [0, 0, 0], k = 1 - dark;
  if (typeof ctx.createConicGradient === 'function') {
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

/**
 * Draw the plastic body: the side copies (far → near) with gradients from
 * the matcap, then the front cap as a lit texture under a vector clip.
 * Call inside the body transform (translate / roll / squash applied),
 * instead of the slice loop. Returns false when the form is not built
 * yet (it is being built on idle time): draw the stock slices that frame.
 */
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
  const sc = scratchFor(N);
  if (!sc) return false;
  const st = stateFor(ctx);
  const f = capFrame(rig);
  const q = (v: V3) => `${Math.round(48 * v[0])},${Math.round(48 * v[1])},${Math.round(48 * v[2])}`;
  const mcKey = `${q(f.L)}|${q(f.V)}|${rig.lx.toFixed(3)},${rig.ly.toFixed(3)}|${pal.base}|${mat.shadow}|${mat.highlight}|${mat.spread}|${mat.rim}`;
  const lxy: [number, number] = (() => {
    const l = Math.hypot(f.L[0], f.L[1]);
    return l < 0.05 ? [0, -1] : [f.L[0] / l, f.L[1] / l];
  })();
  if (mcKey !== st.mcKey) {
    buildMatcap(st.mc, linearColor(pal.base), f, mat);
    st.mcKey = mcKey;
    st.near = sideGradient(ctx, st.mc, 0.55, 0, lxy);
    st.rimG = sideGradient(ctx, st.mc, 0, 0, lxy);
    st.far = sideGradient(ctx, st.mc, 0, Math.min(0.6, 0.25 * mat.shadow), lxy);
  }
  /* the occlusion strength follows `shadow` */
  const aoK = Math.min(1.3, 1.2 * mat.shadow);
  if (aoK !== st.aoK) {
    for (let a = 0; a < 256; a++) st.aoMul[a] = Math.max(0, 1 - aoK * (1 - a / 255));
    st.aoK = aoK;
  }
  const imgKey = `${mcKey}|${N}|${aoK}|${Math.round(rig.halfDepth)}`;
  if (!st.img || st.N !== N) {
    st.img = new ImageData(N, N);
    st.N = N;
    st.imgKey = '';
  }
  if (imgKey !== st.imgKey) {
    shadeTexels(form, st.mc, st.img.data, st.aoMul);
    st.imgKey = imgKey;
  }

  /* 1. the side copies, far → near, without the nearest (the texture is
     the whole front); the shoulder nearest the cap reads the matcap at a
     57° tilt, the equator its rim, the far half its rim in shade */
  const { cy, sy, cp, sp, halfDepth, cap } = rig;
  const order = rig.facing >= 0 ? 1 : -1;
  for (let j = 0; j < SLICES - 1; j++) {
    const k = order > 0 ? j : SLICES - 1 - j;
    const z = -1 + (2 * k) / (SLICES - 1);
    const s = profile(z, cap);
    const zn = z * order; // toward the viewer
    ctx.save();
    ctx.transform(cy * s, sy * sp * s, 0, cp * s, z * sy * halfDepth, -z * cy * sp * halfDepth);
    ctx.translate(-50, -50);
    ctx.fillStyle = (zn > 0.4 ? st.near : zn >= 0 ? st.rimG : st.far) as CanvasGradient;
    ctx.fill(cfg.path);
    ctx.restore();
  }

  /* 2. the cap. The texture is the front surface seen head-on: its outer
     units are the rounded shoulder. Turned, the front's projection runs
     from the equator on the trailing side to the shoulder's silhouette on
     the leading side, so the texture is stretched along the turn to span
     exactly that (no stretch head-on). */
  const inv = 1 / (cy * cp);
  const dx = sy * halfDepth / cy, dy = -sp * halfDepth * inv; // the depth axis, in the equator's own units
  const dl = Math.hypot(dx, dy);
  const ex = dl > 1e-6 ? (order * dx) / dl : 1, ey = dl > 1e-6 ? (order * dy) / dl : 0;
  const lead = 50 * cap + Math.hypot(50 * (1 - cap), dl);
  const stretch = (lead + 50) / 100, shift = (lead - 50) / 2;
  const a = 1 + (stretch - 1) * ex * ex, b = (stretch - 1) * ex * ey, d = 1 + (stretch - 1) * ey * ey;
  ctx.save();
  ctx.transform(cy, sy * sp, 0, cp, 0, 0);
  ctx.transform(a, b, b, d, shift * ex, shift * ey);
  ctx.translate(-50, -50);
  ctx.clip(cfg.path);
  if (sc.owner !== st || sc.key !== imgKey) {
    sc.g.putImageData(st.img, 0, 0);
    sc.owner = st;
    sc.key = imgKey;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sc.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
  ctx.restore();

  /* 3. large avatars: the texture is upscaled 2–3×, so a crisp hairline of
     the environment along the lit side of the silhouette */
  if (rig.dev >= 256 && mat.rim > 0 && mat.highlight > 0) {
    ctx.save();
    if (union) ctx.clip(union);
    else ctx.globalCompositeOperation = 'source-atop';
    ctx.transform(cy, sy * sp, 0, cp, 0, 0);
    ctx.transform(a, b, b, d, shift * ex, shift * ey);
    ctx.translate(-50, -50);
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
