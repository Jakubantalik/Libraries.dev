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
export function warmPlastic(key: string, path: Path2D, devicePx = 192, depth = 0.65, fabric = false, style: FurStyle = FUR_STOCK, light = 295) {
  const form = formFor(key, path, tierFor(devicePx), 15 * depth, true);
  if (fabric && form) {
    /* toward the light on screen. The pile is queued as idle steps rather
       than baked here in one long task. */
    const a = (light * Math.PI) / 180;
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
  /** the body plus a fringe of hairs past its edge, as alpha */
  mask: AnyCanvas | null;
  /** the pile as a film over the wider square FILM_SPAN across, in two
      parts: black where it deepens the colour (laid over it, black at
      alpha a multiplies by 1 − a — the gaps between locks and strands,
      as occlusion does) and white where it lightens it (screens: the
      tips). Laid over the whole turned body at once, source-atop, it is
      one continuous pile. */
  dark: AnyCanvas | null;
  light: AnyCanvas | null;
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

/* the pile's neutral grey: below it the film darkens the colour, above it
   lightens it, as a hard-light blend of the grey would */
const FUR_MID = 128;
/* how far past the body's square the pile's film reaches, and its span */
const FILM_M = 12;
const FILM_SPAN = SPAN + 2 * FILM_M;

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
  /* a large pile takes a while on idle time: with nothing of this shape
     to stand in meanwhile, the smallest one is baked first — in a small
     fraction of the time — and drawn until the full one lands */
  const prefix = `${key}|${Math.round(halfDepth)}|`;
  if (R > 192 && !furPending.has(id)) {
    let any = false;
    for (const k of furs.keys()) if (k.startsWith(prefix)) any = true;
    for (const k of furPending) if (k.startsWith(prefix)) any = true;
    if (!any) furReady(form, key, halfDepth, 1, false, lx, ly, style);
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
    const job = furJob(form, id, R, lx, ly, style);
    if (job) for (const step of job.steps) idle(() => (dropped.has(id) ? undefined : step()));
  }
  /* while it bakes, the same shape's pile at another tier or light will
     do — close enough for the few frames until this one lands */
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
 * locks, each a low mound lit on the side toward the light, its tip over
 * the root of the next and shading it, with a few longer guard hairs over
 * them. The strands are a sparse bright noise drawn out along the flow
 * (a line-integral blur), the locks a coarse noise drawn out the same way.
 * It is kept as a film in two parts, black where it deepens the colour and
 * white where it lightens it, over a square wider than the body's, so one
 * film covers the whole turned body. The silhouette breaks into tufts —
 * the locks standing past it — with a haze of fine hairs.
 */
export function furFor(form: Form, key = 'custom', halfDepth = 9.75, capPx = 320, lx = -1, ly = 0, style: FurStyle = FUR_STOCK): Fur {
  const R = furTier(capPx);
  const id = furKey(key, halfDepth, R, lightBin(lx, ly), style);
  const hit = furs.get(id);
  if (hit) return hit;
  const job = furJob(form, id, R, lx, ly, style);
  if (job) for (const step of job.steps) step();
  return furs.get(id) ?? { R: 0, mask: null, dark: null, light: null };
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
  /* the pile's grey is made over a wider square than the body's, FILM_M
     units past it all round, so the film laid over a turned body still
     covers the back half showing past the front's outline */
  const O = PAD + FILM_M, Rb = Math.round((R * FILM_SPAN) / SPAN);
  const fur: Fur = { R, mask: null, dark: null, light: null };
  const dc = makeCanvas(Rb), lc = makeCanvas(Rb), mc = makeCanvas(R);
  const dg = dc && ctx2d(dc, false), lg = lc && ctx2d(lc, false), mg = mc && ctx2d(mc, false);
  if (!dc || !lc || !mc || !dg || !lg || !mg) {
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
        flowX[i] = fx / fl;
        flowY[i] = fy / fl;
        tiltG[i] = tiltS;
      }
    }
  });
  const gridAt = (f: Float32Array, X: number, Y: number) => bilerp(f, G, (X + O) / gu - 0.5, (Y + O) / gu - 0.5);
  /* the flow's unit direction at a design point */
  const dirAt = (X: number, Y: number): [number, number] => {
    const ux = gridAt(flowX, X, Y), uy = gridAt(flowY, X, Y);
    const ul = Math.hypot(ux, uy);
    return ul > 1e-4 ? [ux / ul, uy / ul] : [0, 1];
  };

  /* 2. the locks: a plush's fibres gather into small locks lying along the
     flow, each a low mound lit on the side toward the light, its tip lying
     over the root of the next one down and shading it. Blobs of a coarse
     noise drawn out along the flow, at half the pile's resolution. */
  const Rl = Rb >> 1, pl = Rl / FILM_SPAN;
  const lock = new Float32Array(Rl * Rl), lockLit = new Float32Array(Rl * Rl);
  const lockAt = (f: Float32Array, X: number, Y: number) => bilerp(f, Rl, (X + O) * pl - 0.5, (Y + O) * pl - 0.5);
  /* the silhouette is not a clean curve: the locks along it stand a little
     past it and the gaps between them fall a little short, so the edge
     breaks into soft tufts — the locks' own pattern and a rounder bump of
     their size, as far out as the pile is long */
  const bump = valueNoise(0.7 + 0.35 * kLen, 61);
  const tuftK = (0.2 + 0.5 * fuzz) * Math.min(1.8, kLen) * 0.55;
  const tuftAt = (X: number, Y: number) => {
    const v = 0.45 * Math.max(-1.6, Math.min(1.6, lockAt(lock, X, Y))) / 1.6 + 0.55 * (bump(X, Y) - 0.5) * 2.4;
    return tuftK * Math.max(-1, Math.min(1, v));
  };
  const lockW = 0.8 + 0.45 * kLen;
  const n1 = valueNoise(lockW, 41), n2 = valueNoise(lockW * 0.45, 43);
  const base = new Float32Array(Rl * Rl), lux = new Float32Array(Rl * Rl), luy = new Float32Array(Rl * Rl);
  rows(Rl, 64, (y0, y1) => {
    for (let y = y0, i = y0 * Rl; y < y1; y++) {
      const Y = (y + 0.5) / pl - O;
      for (let x = 0; x < Rl; x++, i++) {
        const X = (x + 0.5) / pl - O;
        const t = (n1(X, Y) * 0.72 + n2(X, Y) * 0.28 - 0.4) / 0.32;
        base[i] = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
        const [dx, dy] = dirAt(X, Y);
        lux[i] = dx;
        luy[i] = dy;
      }
    }
  });
  const half = Math.max(1, Math.round((0.6 + 0.9 * kLen) * pl));
  let sum = 0, sum2 = 0;
  rows(Rl, 48, (y0, y1) => {
    for (let y = y0, i = y0 * Rl; y < y1; y++) {
      for (let x = 0; x < Rl; x++, i++) {
        const dx = lux[i], dy = luy[i];
        let acc = 0, ws = 0;
        for (let t = -half; t <= half; t++) {
          const sx = Math.round(x + dx * t), sy = Math.round(y + dy * t);
          if (sx < 0 || sy < 0 || sx >= Rl || sy >= Rl) continue;
          const w = 1 - Math.abs(t) / (half + 1);
          acc += base[sy * Rl + sx] * w;
          ws += w;
        }
        const v = ws ? acc / ws : 0;
        lock[i] = v;
        sum += v;
        sum2 += v * v;
      }
    }
  });
  steps.push(() => {
    const n = Rl * Rl, mean = sum / n, sdv = Math.sqrt(Math.max(1e-6, sum2 / n - mean * mean));
    for (let i = 0; i < n; i++) lock[i] = Math.max(-2.5, Math.min(2.5, (lock[i] - mean) / sdv));
  });
  /* lit where the mound faces the light (its slope falls toward it), in
     shade just past a lock's tip, where the one above lies over it */
  const scaleG = lockW * pl * 0.5, back = Math.max(1, Math.round(0.8 * pl));
  rows(Rl, 96, (y0, y1) => {
    for (let y = y0, i = y0 * Rl; y < y1; y++) {
      for (let x = 0; x < Rl; x++, i++) {
        const l = x > 0 ? lock[i - 1] : lock[i], r = x < Rl - 1 ? lock[i + 1] : lock[i];
        const u = y > 0 ? lock[i - Rl] : lock[i], d = y < Rl - 1 ? lock[i + Rl] : lock[i];
        const lit = -((r - l) * Lx + (d - u) * Ly) * 0.5 * scaleG;
        const sx = Math.round(x - lux[i] * back), sy = Math.round(y - luy[i] * back);
        const up = sx >= 0 && sy >= 0 && sx < Rl && sy < Rl ? lock[sy * Rl + sx] : lock[i];
        const shade = Math.max(0, up - lock[i]);
        lockLit[i] = Math.max(-2, Math.min(2, 0.6 * lit - 0.9 * shade));
      }
    }
  });

  /* 3. the fleece: every pixel's fibres — a sparse bright noise drawn out
     along the flow, so it reads as fine strands lying in the direction the
     pile is combed, longer where the surface turns away and they are seen
     side-on — over the locks and a slow drift in the pile's tone. Grey
     about FUR_MID, kept as the film's two parts: below mid black (the gaps
     between locks and strands deepen the colour whatever its lightness,
     as occlusion does), above it white. */
  const darkImg = new ImageData(Rb, Rb), lightImg = new ImageData(Rb, Rb);
  const white = new Float32Array(Rb * Rb);
  steps.push(() => {
    for (let y = 0, i = 0; y < Rb; y++) for (let x = 0; x < Rb; x++, i++) {
      const h = hash2(x + 911, y + 37);
      white[i] = h * h * h;
    }
  });
  /* a triangle kernel of half-width n: its weights' sum and the spread its
     average of the noise keeps, to bring every length to one contrast */
  const W_MEAN = 0.25, W_SD = Math.sqrt(1 / 7 - 1 / 16);
  const strandHalf = Math.max(1, Math.round((0.35 + 0.4 * kLen) * px));
  const kSd = new Float32Array(strandHalf + 1);
  for (let n = 0; n <= strandHalf; n++) {
    const s1 = n + 1, s2 = 1 + (n * (2 * n + 1)) / (3 * (n + 1));
    kSd[n] = (W_SD * Math.sqrt(s2)) / s1;
  }
  const lockA = 5 * (0.4 + clumps), litA = 9 * (0.45 + clumps), strandA = 7 * Math.min(1.4, 0.55 + 0.35 * kDen);
  {
    rows(Rb, 32, (y0, y1) => {
      const dd = darkImg.data, ld = lightImg.data;
      for (let y = y0; y < y1; y++) {
        const Y = (y + 0.5) / px - O;
        for (let x = 0; x < Rb; x++) {
          const X = (x + 0.5) / px - O;
          const i = y * Rb + x;
          const [ux, uy] = dirAt(X, Y);
          const tilt = gridAt(tiltG, X, Y);
          const n = Math.max(1, Math.round(strandHalf * (0.5 + 0.5 * tilt)));
          let acc = 0;
          for (let t = -n; t <= n; t++) {
            const sx = Math.round(x + ux * t), sy = Math.round(y + uy * t);
            const w = 1 - Math.abs(t) / (n + 1);
            acc += (sx < 0 || sy < 0 || sx >= Rb || sy >= Rb ? W_MEAN : white[sy * Rb + sx]) * w;
          }
          const strand = (acc / (n + 1) - W_MEAN) / kSd[n];
          const lk = lockAt(lock, X, Y), ll = lockAt(lockLit, X, Y);
          let v =
            FUR_MID + 6 +
            (tone(X, Y) - 0.5) * 10 +
            lk * lockA +
            ll * litA +
            strand * strandA * (0.75 + 0.1 * lk);
          v = v < 0 ? 0 : v > 255 ? 255 : v;
          const k = i * 4;
          /* below mid-grey the film darkens, above it lightens */
          if (v < FUR_MID) dd[k + 3] = Math.round(255 * (1 - v / FUR_MID));
          else {
            ld[k] = ld[k + 1] = ld[k + 2] = 255;
            ld[k + 3] = Math.round((255 * (v - FUR_MID)) / (255 - FUR_MID));
          }
        }
      }
    });
  }
  /* the two parts of the film into their canvases; the strokes after them
     are drawn in the body's square, inside the wider one */
  steps.push(() => {
    dg.putImageData(darkImg, 0, 0);
    lg.putImageData(lightImg, 0, 0);
    for (const g of [dg, lg]) {
      g.setTransform(1, 0, 0, 1, FILM_M * px, FILM_M * px);
      g.lineCap = 'round';
      g.lineJoin = 'round';
    }
  });

  /* 2. the pile over it: short fibres combed with the flow but messily,
     root in shade and tip in the light, and a sparse few longer ones that
     glint — strokes bucketed by shade, so a layer is a few dozen stroke
     calls however many fibres it draws */
  const SHADES = 16;
  const area = SPAN * SPAN;
  const layers = [
    { count: 0.12, len: [1.2, 1.0], width: 0.09, spread: 30, alpha: 0.4, split: true, lift: 0.25 },
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
      /* with the flow: where the surface faces the viewer the fibres stand
         end-on and look short, where it turns away they lie side-on */
      const [fx, fy] = dirAt(X, Y);
      const tiltS = gridAt(tiltG, X, Y);
      const ang = (rand() - 0.5) * (0.6 + 0.8 * curl) * (1 - 0.5 * tiltS);
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const ux = fx * ca - fy * sa, uy = fx * sa + fy * ca;
      /* mostly the layer's length, now and then a stray half as long again */
      const stray = rand() < 0.1 ? 1.35 + 0.6 * rand() : 1;
      const len = (L.len[0] + L.len[1] * rand()) * px * kLen * stray * (0.35 + 0.95 * tiltS);
      /* the fibre's own shade: its tuft's light and height, and whether it
         is one catching the light or one in a gap */
      const r0 = rand();
      let v = 0.22 * lockAt(lock, X, Y) + 0.3 * lockAt(lockLit, X, Y);
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
    /* a grey stroke as the film's black or white at the matching alpha */
    for (let i = 0; i < SHADES; i++) {
      const v = FUR_MID + ((i / (SHADES - 1)) * 2 - 1) * L.spread;
      const g = v < FUR_MID ? dg : lg;
      g.lineWidth = Math.max(0.45, L.width * px);
      g.globalAlpha = L.alpha * (v < FUR_MID ? 1 - v / FUR_MID : (v - FUR_MID) / (255 - FUR_MID));
      g.strokeStyle = v < FUR_MID ? '#000' : '#fff';
      g.stroke(buckets[i]);
    }
    dg.globalAlpha = lg.globalAlpha = 1;
    });
  }

  /* 3. the fuzz: fibres rooted just inside the edge, standing out past it —
     many, very fine, of mixed length (mostly short, a few long), leaning
     with the flow, so the edge is a soft haze rather than a comb */
  const fringe = new Path2D();
  steps.push(() => {
  /* tried only in the form's cells along the outline, where a hair can
     root: as many tries per unit of that band as over the whole square */
  const cells: number[] = [];
  const cu = SPAN / N;
  for (let i = 0; i < N * N; i++) if (form.sd[i] > -1.6 && form.sd[i] < 2.2) cells.push(i);
  /* fewer on a small pile, whose hairs are finer than its pixels */
  const edgeTries = Math.round(cells.length * cu * cu * 18 * (0.3 + 1.4 * fuzz) * Math.sqrt(kDen) * (0.5 + 0.5 * Math.min(1, R / 512)));
  for (let n = 0; n < edgeTries; n++) {
    const c = cells[(rand() * cells.length) | 0];
    const X = ((c % N) + rand()) * cu - PAD, Y = (((c / N) | 0) + rand()) * cu - PAD;
    const d0 = sdAt(X, Y);
    if (d0 < -1.2 || d0 > 1.8) continue;
    const d = d0 + tuftAt(X, Y);
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
  lg.lineWidth = Math.max(0.35, 0.08 * px);
  lg.globalAlpha = 0.5 * ((140 - FUR_MID) / (255 - FUR_MID));
  lg.strokeStyle = '#fff';
  lg.stroke(fringe);
  lg.globalAlpha = 1;
  });
  steps.push(() => {

  /* 4. the coverage: the outline with a soft feather — a smooth curve, as
     plush is — and the fuzz standing past it */
  /* the feather spans a unit and a half: half the resolution, scaled up,
     draws it the same */
  const Rh = R >> 1, ph = Rh / SPAN;
  const hc = makeCanvas(Rh), hg = hc && ctx2d(hc, false);
  const mi = new ImageData(Rh, Rh);
  for (let y = 0; y < Rh; y++) {
    for (let x = 0; x < Rh; x++) {
      const X = (x + 0.5) / ph - PAD, Y = (y + 0.5) / ph - PAD;
      const d = sdAt(X, Y) + tuftAt(X, Y);
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
  mg.strokeStyle = 'rgba(255,255,255,0.3)';
  mg.stroke(fringe);

  fur.dark = dc;
  fur.light = lc;
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
  /* a pile scatters light through itself: its shade side is lit by the
     room and by light passing between the fibres, so it falls off far more
     gently than a clear coat's */
  const amb = Math.max(0.06, 0.2 - 0.1 * p.shadow);
  const wrap = Math.min(0.9, 0.26 + 0.16 * p.spread);
  const kd = 1.3;
  const fillK = 0.17, floorK = 0.28 * Math.min(1.5, p.shadow / 0.35);
  /* the fill: from the other side of the screen, a little low, mostly from
     the front */
  const Fl = norm3([-0.55 * U[0] + 0.85 * V[0] + 0.15 * D[0], -0.55 * U[1] + 0.85 * V[1] + 0.15 * D[1], -0.55 * U[2] + 0.85 * V[2] + 0.15 * D[2]]);
  const sheenK = 0.2 * p.highlight, rimK = 0.12 * p.rim;
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
      sprites: [null, null, null, null], sliceG: [], sliceKey: '', body: [null, null], bodyIdx: 0, spriteVersion: -1, spritePx: 0, spriteFur: null,
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
   darkened by `dark`, as a conic ramp round the centre (a linear one along
   the light where conic fills are slow) */
function sliceGradient(ctx: CanvasRenderingContext2D, rays: Rays, inset: number, dark: number, c0: [number, number], lxy: [number, number], linear: boolean): CanvasGradient {
  const k = 1 - dark;
  const at = (s: number): string => {
    const d = rays.d[s], c = rays.c[s];
    /* the samples run from the centre out, their distance to the outline
       falling: the last one at least `inset` in */
    let j = 0;
    for (let i = 0; i < d.length; i++) if (d[i] >= inset) j = i;
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
  /* the slices' sprites — the side's light at the equator with fabric's
     fringe, black for the far half's shade, and the side's light again
     without the fringe — at the avatar's device size */
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
      g.setTransform(k, 0, 0, k, PAD * k, PAD * k);
      /* the side's light at the equator (with the fringe, and again
         without), and a black silhouette laid over the far half's deeper
         slices */
      g.fillStyle = i === 1 ? '#000' : sliceGradient(g, raysOf(st.img!, form, [rel.cx[0], rel.cy[0]]), rel.inset[0], 0, [rel.cx[0], rel.cy[0]], lxy, WEBKIT);
      if (fur && fur.mask) {
        /* the square in the side's light, the pile multiplied in, then cut
           to the body and its fringe */
        g.fillRect(-PAD, -PAD, SPAN, SPAN);
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        /* no pile here: the film laid over all the slices at once brings it
           (the fringe's hairs too) */
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
    for (let k = 0; k < K; k++) st.sliceG.push(sliceGradient(ctx, rays, rel.inset[k], 0, c0, lxy, WEBKIT));
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
    /* the equator: fabric's ends in its soft edge, and seen face-on carries
       the fringe — turned side-on that edge runs across the middle of the
       view, where a line of hairs has no business */
    if (fur) g.drawImage(side.c as HTMLCanvasElement, -PAD, -PAD, SPAN, SPAN);
    else {
      g.fillStyle = st.sliceG[0];
      g.fill(cfg.path);
    }
    if (fur && fringeA > 0.01) {
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
  const backShade = Math.min(0.7, 0.55 * Math.min(1.6, mat.shadow / 0.35));
  /* the far half, deepest first, each slice a little further into shade */
  for (let k = K - 1; k >= 1; k--) slice(k, -near * rel.z[k], backShade * (1 - Math.exp(-2.4 * (k / K))));
  slice(0, 0, 0);
  /* the near half */
  for (let k = 1; k < K; k++) slice(k, near * rel.z[k], 0);

  /* The front fades out over its outer band into the slices under it; the
     silhouette is the slices' (and fabric's fringe is the equator slice's).
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

  if (g !== ctx && film) {
    /* the pile over the whole body at once, only where it is: its dark
       part in full, its light part less on a dark colour, whose tips are a
       lighter shade of it rather than white */
    g.globalCompositeOperation = 'source-atop';
    /* the film is drawn at about its own resolution: plain bilinear
       filtering looks the same, where the high-quality filter costs
       milliseconds on a large avatar */
    g.imageSmoothingQuality = 'low';
    g.setTransform(capM[0], capM[1], capM[2], capM[3], capM[4] - ox, capM[5] - oy);
    g.drawImage(film.dark as HTMLCanvasElement, -PAD - FILM_M, -PAD - FILM_M, FILM_SPAN, FILM_SPAN);
    const lin = linearColor(pal.base);
    const lum = Math.pow(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2], 1 / 2.2);
    g.globalAlpha = 0.25 + 0.75 * lum;
    g.drawImage(film.light as HTMLCanvasElement, -PAD - FILM_M, -PAD - FILM_M, FILM_SPAN, FILM_SPAN);
    g.globalAlpha = 1;
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
