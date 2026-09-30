/* mesh.ts — a small surface renderer for the things the bots wear.

   A worn object is a handful of parametric surfaces (a dome, a band, a
   cone, a tube along a curve, a revolved profile), each sampled into a
   grid in its own space once and kept; every frame the grid is projected
   through the head's rotation and lit from the body's light with a
   material: felt, knit, paper, gold, silver, velvet, satin, soft plastic,
   leather, pearl, a cut gem.

   It is painted a strip at a time: the visible stretch of each row of the
   grid is one shape, filled with a gradient that carries the light along
   the row from the corners' own normals, so a dome is a dozen fills rather
   than hundreds of quads and its light runs smoothly round it; the rows
   step it the other way, finely enough not to show. Strips go back to
   front across all the surfaces of an object. Cut facets are painted a
   cell at a time, flat. Small spheres — pearls, beads, rivets — are
   single radial fills. Canvas 2D only. */

export type V3 = [number, number, number];
export type P2 = [number, number];
export type RGB = [number, number, number];

/** How the worn object is seen: a linear map from the object's space
    (about the origin `o`) to view space — rows for screen x (right), screen
    y (down) and depth (toward the viewer) — the light, and the scale. */
export interface View {
  m: number[];
  o: V3;
  toScreen(p: V3): P2;
  depth(p: V3): number;
  /** a direction in the object's space, turned into view space, unit length */
  dir(v: V3): V3;
  /** toward the light, and the half vector with the view, in view space */
  L: V3;
  H: V3;
  /** device pixels per unit of this space */
  px: number;
}

export function makeView(m: number[], o: V3, L: V3, H: V3, px: number): View {
  return {
    m,
    o,
    L,
    H,
    px,
    toScreen: (p) => {
      const x = p[0] - o[0], y = p[1] - o[1], z = p[2] - o[2];
      return [m[0] * x + m[1] * y + m[2] * z, m[3] * x + m[4] * y + m[5] * z];
    },
    depth: (p) => m[6] * (p[0] - o[0]) + m[7] * (p[1] - o[1]) + m[8] * (p[2] - o[2]),
    dir: (v) => norm([m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]),
  };
}

/** A material: a normal (view space) to a colour. */
export type Shade = (n: V3) => RGB;

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (v: V3): V3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const TAU = Math.PI * 2;

/** How many segments to cut a length into for this view: about one per
    `quad` device pixels, within `lo … hi`. */
export function segs(view: View, len: number, lo: number, hi: number, quad = 11): number {
  return Math.max(lo, Math.min(hi, Math.round((len * view.px) / quad)));
}

/** A surface sampled on a grid, in its object's space: positions, the
    cells' normals and (for smooth shading) the corners'. Built once and
    kept; each frame only projects it. */
export interface Mesh {
  nu: number;
  nv: number;
  /** closed round u: its first and last columns are one */
  closed: boolean;
  pos: Float64Array;
  fn: Float64Array;
  vn: Float64Array | null;
}

/**
 * Sample `surf(u, v)` (u, v ∈ [0, 1]) on an `nu × nv` grid. `inside` is a
 * point inside the object, or for a tube the point on its centre line:
 * each normal is turned to face away from it, so a surface needs no care
 * over its winding. With `smooth`, every corner gets the mean of its
 * cells' normals — a surface closed round u, or pinched to a pole, is
 * joined up — for the gradient fill; without, the cells stay faceted.
 */
export function makeMesh(
  surf: (u: number, v: number) => V3,
  nu: number,
  nv: number,
  inside: V3 | ((u: number, v: number) => V3),
  smooth = true
): Mesh {
  const W = nu + 1, N = W * (nv + 1);
  const pos = new Float64Array(N * 3);
  let ext = 0;
  for (let j = 0, k = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++, k++) {
      const p = surf(i / nu, j / nv);
      pos[k * 3] = p[0];
      pos[k * 3 + 1] = p[1];
      pos[k * 3 + 2] = p[2];
      ext = Math.max(ext, Math.abs(p[0] - pos[0]) + Math.abs(p[1] - pos[1]) + Math.abs(p[2] - pos[2]));
    }
  }
  const P = (k: number): V3 => [pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]];
  const fn = new Float64Array(nu * nv * 3);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * W + i;
      const A = P(a), B = P(a + 1), C = P(a + W + 1), D = P(a + W);
      /* the diagonals' cross product survives a quad that pinches to a
         point at a pole */
      let n = cross(sub(C, A), sub(D, B));
      const mid: V3 = [(A[0] + B[0] + C[0] + D[0]) / 4, (A[1] + B[1] + C[1] + D[1]) / 4, (A[2] + B[2] + C[2] + D[2]) / 4];
      const ins = typeof inside === 'function' ? inside((i + 0.5) / nu, (j + 0.5) / nv) : inside;
      if (dot(n, sub(mid, ins)) < 0) n = [-n[0], -n[1], -n[2]];
      n = norm(n);
      const f = (j * nu + i) * 3;
      fn[f] = n[0];
      fn[f + 1] = n[1];
      fn[f + 2] = n[2];
    }
  }
  const eps = 1e-6 + ext * 1e-5;
  const same = (p: number, q: number) =>
    Math.abs(pos[p * 3] - pos[q * 3]) + Math.abs(pos[p * 3 + 1] - pos[q * 3 + 1]) + Math.abs(pos[p * 3 + 2] - pos[q * 3 + 2]) < eps;
  let closed = true;
  for (let j = 0; j <= nv && closed; j++) closed = same(j * W, j * W + nu);
  let vn: Float64Array | null = null;
  if (smooth) {
    const acc = new Float64Array(N * 3);
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const f = (j * nu + i) * 3;
        const a = j * W + i;
        for (const k of [a, a + 1, a + W + 1, a + W]) {
          acc[k * 3] += fn[f];
          acc[k * 3 + 1] += fn[f + 1];
          acc[k * 3 + 2] += fn[f + 2];
        }
      }
    }
    const join = (ks: number[]) => {
      let x = 0, y = 0, z = 0;
      for (const k of ks) {
        x += acc[k * 3];
        y += acc[k * 3 + 1];
        z += acc[k * 3 + 2];
      }
      for (const k of ks) {
        acc[k * 3] = x;
        acc[k * 3 + 1] = y;
        acc[k * 3 + 2] = z;
      }
    };
    if (closed) for (let j = 0; j <= nv; j++) join([j * W, j * W + nu]);
    for (const j of [0, nv]) {
      let pole = true;
      for (let i = 1; i <= nu && pole; i++) pole = same(j * W, j * W + i);
      if (pole) join(Array.from({ length: W }, (_, i) => j * W + i));
    }
    for (let k = 0; k < N; k++) {
      const x = acc[k * 3], y = acc[k * 3 + 1], z = acc[k * 3 + 2];
      const l = Math.hypot(x, y, z) || 1;
      acc[k * 3] = x / l;
      acc[k * 3 + 1] = y / l;
      acc[k * 3 + 2] = z / l;
    }
    vn = acc;
  }
  return { nu, nv, closed, pos, fn, vn };
}

/**
 * A tube along a curve: `path(u)` its centre line, `up` the direction its
 * cross-section is squared to (a band's depth axis, a rim's face normal),
 * `prof(u, φ)` the cross-section's offset at angle φ — along the up
 * direction and across it. Rows of the grid run along the tube.
 */
export function makeTube(
  path: (u: number) => V3,
  up: V3,
  prof: (u: number, ph: number) => [number, number],
  nu: number,
  nv: number,
  closed = false
): Mesh {
  const e = 1e-3;
  const at = (u: number) => path(closed ? ((u % 1) + 1) % 1 : Math.max(0, Math.min(1, u)));
  return makeMesh(
    (u, v) => {
      const c = path(u);
      const T = norm(sub(at(u + e), at(u - e)));
      const k = dot(up, T);
      const Nn = norm([up[0] - T[0] * k, up[1] - T[1] * k, up[2] - T[2] * k]);
      const Bn = cross(T, Nn);
      const [a, b] = prof(u, v * TAU);
      return [c[0] + Nn[0] * a + Bn[0] * b, c[1] + Nn[1] * a + Bn[1] * b, c[2] + Nn[2] * a + Bn[2] * b];
    },
    nu,
    nv,
    (u) => path(u)
  );
}

/** A cross-section: an ellipse (`p` = 1) squared toward a rounded box as
    `p` falls, `a` along the up direction and `b` across it. */
export const section = (a: number, b: number, p = 1) => (_u: number, ph: number): [number, number] => {
  const c = Math.cos(ph), s = Math.sin(ph);
  return [a * Math.sign(c) * Math.pow(Math.abs(c), p), b * Math.sign(s) * Math.pow(Math.abs(s), p)];
};

/** A mesh as this frame sees it: every corner on screen with its depth
    and its normal in view space, and every cell's normal and depth. */
export interface Proj {
  nu: number;
  nv: number;
  closed: boolean;
  x: Float64Array;
  y: Float64Array;
  d: Float64Array;
  /** the corners' normals, 3 a corner; null for a faceted mesh */
  n: Float64Array | null;
  /** the cells' normals, 3 a cell, and their mean depths */
  f: Float64Array;
  cd: Float64Array;
}

export function projectMesh(view: View, mesh: Mesh): Proj {
  const { nu, nv, pos, fn, vn } = mesh;
  const W = nu + 1, N = W * (nv + 1), C = nu * nv;
  const [m0, m1, m2, m3, m4, m5, m6, m7, m8] = view.m;
  const [ox, oy, oz] = view.o;
  const x = new Float64Array(N), y = new Float64Array(N), d = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const X = pos[k * 3] - ox, Y = pos[k * 3 + 1] - oy, Z = pos[k * 3 + 2] - oz;
    x[k] = m0 * X + m1 * Y + m2 * Z;
    y[k] = m3 * X + m4 * Y + m5 * Z;
    d[k] = m6 * X + m7 * Y + m8 * Z;
  }
  const turn = (src: Float64Array, dst: Float64Array, count: number) => {
    for (let k = 0; k < count; k++) {
      const a = src[k * 3], b = src[k * 3 + 1], c = src[k * 3 + 2];
      const X = m0 * a + m1 * b + m2 * c, Y = m3 * a + m4 * b + m5 * c, Z = m6 * a + m7 * b + m8 * c;
      const l = Math.hypot(X, Y, Z) || 1;
      dst[k * 3] = X / l;
      dst[k * 3 + 1] = Y / l;
      dst[k * 3 + 2] = Z / l;
    }
  };
  let n: Float64Array | null = null;
  if (vn) turn(vn, (n = new Float64Array(N * 3)), N);
  const f = new Float64Array(C * 3), cd = new Float64Array(C);
  turn(fn, f, C);
  for (let j = 0, c = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++, c++) {
      const a = j * W + i;
      cd[c] = (d[a] + d[a + 1] + d[a + W] + d[a + W + 1]) / 4;
    }
  }
  return { nu, nv, closed: mesh.closed, x, y, d, n, f, cd };
}

/** The screen bounds of some projected meshes. */
export function boundsOf(ps: Proj[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps) {
    for (let k = 0; k < p.x.length; k++) {
      if (p.x[k] < x0) x0 = p.x[k];
      if (p.x[k] > x1) x1 = p.x[k];
      if (p.y[k] < y0) y0 = p.y[k];
      if (p.y[k] > y1) y1 = p.y[k];
    }
  }
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

/* ── painting ──────────────────────────────────────────────────────── */

export interface Layer {
  parts: Proj[];
  shade: Shade;
  /** keep the cells facing away (thin plates seen from behind) */
  cull?: boolean;
  /** a cell at a time, one colour each: cut facets */
  flat?: boolean;
  /** a nudge toward the viewer in the depth sort: a part set into another
      (a ring round a plate) wins where they meet */
  bias?: number;
  /** keep only the cells whose depth passes: one side of a split */
  keep?: (d: number) => boolean;
}

interface Piece {
  d: number;
  l: Layer;
  p: Proj;
  j: number;
  /** the strip's columns (corner indices along its row) and its cells; one
      cell alone for a flat piece */
  cols: number[];
  cells: number[];
}

/* is the run of column midpoints s … e one way along its chord */
function monotone(mx: number[], my: number[], s: number, e: number): boolean {
  const ax = mx[e] - mx[s], ay = my[e] - my[s];
  let prev = -Infinity;
  for (let k = s; k <= e; k++) {
    const t = (mx[k] - mx[s]) * ax + (my[k] - my[s]) * ay;
    if (t < prev - 1e-9) return false;
    prev = t;
  }
  return true;
}

const clampByte = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
export const css = (c: RGB) => `rgb(${clampByte(c[0])},${clampByte(c[1])},${clampByte(c[2])})`;

/** Paint several surfaces as one, back to front, the parts facing away
    dropped. `px` is the view's scale. Returns the corners painted, for an
    outline. */
export function paintLayers(ctx: CanvasRenderingContext2D, layers: Layer[], px: number): P2[] {
  const pieces: Piece[] = [];
  const corners: P2[] = [];
  for (const l of layers) {
    const bias = l.bias ?? 0, keep = l.keep, cull = l.cull !== false;
    for (const P of l.parts) {
      const { nu, nv, f, cd, x, y } = P, W = nu + 1;
      const vis = (c: number) => (!cull || f[c * 3 + 2] > -0.04) && (!keep || keep(cd[c]));
      for (let j = 0; j < nv; j++) {
        if (l.flat) {
          for (let i = 0; i < nu; i++) {
            const c = j * nu + i;
            if (!vis(c)) continue;
            pieces.push({ d: cd[c] + bias, l, p: P, j, cols: [i, i + 1], cells: [c] });
            corners.push([x[j * W + i], y[j * W + i]], [x[(j + 1) * W + i + 1], y[(j + 1) * W + i + 1]]);
          }
          continue;
        }
        /* the row's visible runs, joined across the seam of a closed grid */
        const runs: number[][] = [];
        let cur: number[] | null = null;
        for (let i = 0; i < nu; i++) {
          if (vis(j * nu + i)) {
            if (!cur) runs.push((cur = []));
            cur.push(i);
          } else cur = null;
        }
        if (P.closed && runs.length > 1 && runs[0][0] === 0 && runs[runs.length - 1][runs[runs.length - 1].length - 1] === nu - 1) {
          runs[0] = runs.pop()!.concat(runs[0]);
        }
        for (const run of runs) {
          const cols = run.concat(run[run.length - 1] + 1);
          const mx: number[] = [], my: number[] = [];
          for (let k = 0; k < cols.length; k++) {
            const t = j * W + cols[k], b = t + W;
            mx.push((x[t] + x[b]) / 2);
            my.push((y[t] + y[b]) / 2);
            /* the outline needs only the silhouette: a run's ends, and the
               grid's first and last rows */
            if (k === 0 || k === cols.length - 1) corners.push([x[t], y[t]], [x[b], y[b]]);
            else if (j === 0) corners.push([x[t], y[t]]);
            else if (j === nv - 1) corners.push([x[b], y[b]]);
          }
          /* split where the row turns back on itself on screen, so each
             strip can take one linear gradient */
          let s = 0;
          while (s < cols.length - 1) {
            let e = s + 1;
            while (e + 1 < cols.length && monotone(mx, my, s, e + 1)) e++;
            let dd = 0;
            for (let k = s; k < e; k++) dd += cd[j * nu + run[k]];
            pieces.push({ d: dd / (e - s) + bias, l, p: P, j, cols: cols.slice(s, e + 1), cells: run.slice(s, e) });
            s = e;
          }
        }
      }
    }
  }
  pieces.sort((a, b) => a.d - b.d);
  const grow = 0.5 / px;
  for (const pc of pieces) {
    const { p: P, l, j, cols, cells } = pc;
    const { x, y, n, f } = P, W = P.nu + 1;
    const nc = cols.length;
    /* the strip's outline, pushed out a little all round so neighbours
       overlap and no seam of background shows */
    const tx: number[] = [], ty: number[] = [], bx: number[] = [], by: number[] = [];
    const t0 = j * W + cols[0], tn = j * W + cols[nc - 1];
    let ax = (x[tn] + x[tn + W]) / 2 - (x[t0] + x[t0 + W]) / 2, ay = (y[tn] + y[tn + W]) / 2 - (y[t0] + y[t0 + W]) / 2;
    const al = Math.hypot(ax, ay);
    const ux = al > 1e-9 ? ax / al : 0, uy = al > 1e-9 ? ay / al : 0;
    for (let k = 0; k < nc; k++) {
      const t = j * W + cols[k], b = t + W;
      let dx = x[t] - x[b], dy = y[t] - y[b];
      const dl = Math.hypot(dx, dy);
      if (dl > 1e-9) (dx /= dl), (dy /= dl);
      else dx = dy = 0;
      const e = k === 0 ? -grow : k === nc - 1 ? grow : 0;
      tx.push(x[t] + dx * grow + ux * e);
      ty.push(y[t] + dy * grow + uy * e);
      bx.push(x[b] - dx * grow + ux * e);
      by.push(y[b] - dy * grow + uy * e);
    }
    /* the colour at each column: from the corners' normals, or the cells'
       beside it on a faceted mesh; stops only where the colour has moved */
    const colour = (k: number): RGB => {
      if (n && !l.flat) {
        const t = (j * W + cols[k]) * 3, b = t + W * 3;
        return l.shade(norm([n[t] + n[b], n[t + 1] + n[b + 1], n[t + 2] + n[b + 2]]));
      }
      const c0 = cells[Math.max(0, Math.min(cells.length - 1, k - 1))] * 3, c1 = cells[Math.min(cells.length - 1, k)] * 3;
      return l.shade(l.flat ? [f[c1], f[c1 + 1], f[c1 + 2]] : norm([f[c0] + f[c1], f[c0 + 1] + f[c1 + 1], f[c0 + 2] + f[c1 + 2]]));
    };
    let style: string | CanvasGradient;
    if (l.flat || al < 1e-6) style = css(colour(0));
    else {
      const g = ctx.createLinearGradient((x[t0] + x[t0 + W]) / 2, (y[t0] + y[t0 + W]) / 2, (x[tn] + x[tn + W]) / 2, (y[tn] + y[tn + W]) / 2);
      let last: RGB | null = null;
      const m0x = (x[t0] + x[t0 + W]) / 2, m0y = (y[t0] + y[t0 + W]) / 2;
      for (let k = 0; k < nc; k++) {
        const c = colour(k);
        if (last && k < nc - 1 && Math.abs(c[0] - last[0]) + Math.abs(c[1] - last[1]) + Math.abs(c[2] - last[2]) < 5) continue;
        const t = j * W + cols[k];
        const off = (((x[t] + x[t + W]) / 2 - m0x) * ax + ((y[t] + y[t + W]) / 2 - m0y) * ay) / (al * al);
        g.addColorStop(off < 0 ? 0 : off > 1 ? 1 : off, css(c));
        last = c;
      }
      style = g;
    }
    ctx.fillStyle = style;
    ctx.beginPath();
    ctx.moveTo(tx[0], ty[0]);
    for (let k = 1; k < nc; k++) ctx.lineTo(tx[k], ty[k]);
    for (let k = nc - 1; k >= 0; k--) ctx.lineTo(bx[k], by[k]);
    ctx.closePath();
    ctx.fill();
  }
  return corners;
}

export function hull(pts: P2[]): P2[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P2[] = [], up: P2[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  lo.pop();
  up.pop();
  return lo.concat(up);
}

/* ── materials: a view and a base colour to a shade ────────────────── */

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
const WHITE: RGB = [255, 255, 255];

/** Felt and knit: matte, the light wrapping softly round, a faint sheen
    where the fibres lie side-on; a dark felt keeps a floor of light so it
    reads charcoal on its lit side. `k` darkens it (a fold, an underside). */
export function felt(view: View, base: RGB, k = 1): Shade {
  const L = view.L;
  return (n) => {
    const nl = dot(n, L);
    const dif = Math.pow(clamp01((nl + 0.4) / 1.4), 1.35);
    const graze = Math.pow(1 - clamp01(n[2]), 2);
    const lit = (0.22 + 0.95 * dif + 0.22 * graze * clamp01(nl + 0.6)) * k;
    const floor = 26 * dif * k;
    return [base[0] * lit + floor, base[1] * lit + floor, base[2] * lit + floor * 1.05];
  };
}

/** Velvet: deep in its folds, its colour lifting toward the silhouette. */
export function velvet(view: View, base: RGB): Shade {
  const L = view.L, sheen = mix(base, WHITE, 0.3);
  return (n) => {
    const nl = dot(n, L);
    const dif = clamp01((nl + 0.3) / 1.3);
    const graze = Math.pow(1 - clamp01(n[2]), 1.6);
    return mix(scale(base, 0.2 + 0.7 * dif), sheen, 0.6 * graze * (0.4 + 0.6 * dif));
  };
}

/** Paper: Lambert with a soft wide sheen. */
export function paper(view: View, base: RGB): Shade {
  const L = view.L, H = view.H;
  return (n) => {
    const dif = clamp01((dot(n, L) + 0.2) / 1.2);
    const spec = Math.pow(clamp01(dot(n, H)), 22) * 0.3;
    return mix(scale(base, 0.36 + 0.7 * dif), WHITE, spec);
  };
}

/** Soft plastic and leather: diffuse, a broad sheen and a tighter hot
    spot, a thin rim of light at the silhouette. */
export function plastic(view: View, base: RGB, gloss = 1): Shade {
  const L = view.L, H = view.H;
  return (n) => {
    const dif = clamp01((dot(n, L) + 0.25) / 1.25);
    const nh = clamp01(dot(n, H));
    const spec = (Math.pow(nh, 16) * 0.2 + Math.pow(nh, 80) * 0.6) * gloss;
    const rim = Math.pow(1 - clamp01(n[2]), 3) * 0.14 * gloss;
    return mix(scale(base, 0.28 + 0.78 * dif), WHITE, clamp01(spec + rim));
  };
}

/** Satin: a silk ribbon's light — a wide soft sheen that runs along the
    folds and a deep, saturated shade between them. */
export function satin(view: View, base: RGB): Shade {
  const L = view.L, H = view.H, deep = scale(base, 0.42), sheen = mix(base, WHITE, 0.55);
  return (n) => {
    const dif = clamp01((dot(n, L) + 0.35) / 1.35);
    const nh = clamp01(dot(n, H));
    const s = Math.pow(nh, 6) * 0.5 + Math.pow(nh, 40) * 0.35;
    return mix(mix(deep, base, dif), sheen, clamp01(s));
  };
}

/** Metal: the colour of what it reflects — a bright sky above, a dark
    floor below, a bright horizon between — tinted, with a hot glint. */
export function metal(view: View, tint: RGB, dark: RGB, glint: RGB): Shade {
  const H = view.H, L = view.L;
  return (n) => {
    /* the reflection of the view about the normal; up is −y */
    const rz = 2 * n[2] * n[2] - 1, ry = 2 * n[2] * n[1];
    const up = -ry;
    const sky = clamp01(0.45 + up * 0.85 + rz * 0.1);
    const horizon = Math.exp(-Math.pow((up + 0.12) / 0.16, 2)) * 0.55;
    const nl = clamp01(dot(n, L));
    const c = mix(dark, tint, clamp01(0.1 + sky * 0.72 + nl * 0.3));
    const spec = Math.pow(clamp01(dot(n, H)), 70) + horizon * 0.4;
    return mix(c, glint, clamp01(spec));
  };
}
export const gold = (view: View) => metal(view, [255, 200, 88], [86, 50, 8], [255, 247, 220]);
export const silver = (view: View) => metal(view, [232, 236, 242], [58, 62, 72], [255, 255, 255]);

/** A pearl: soft white with a pink-blue play and a small bright glint. */
export function pearl(view: View): Shade {
  const L = view.L, H = view.H;
  return (n) => {
    const dif = clamp01((dot(n, L) + 0.4) / 1.4);
    const base = mix([238, 228, 228], [212, 222, 242], 1 - clamp01(n[2]));
    return mix(scale(base, 0.62 + 0.42 * dif), WHITE, Math.pow(clamp01(dot(n, H)), 40) * 0.8);
  };
}

/** A cut gem's facet: its colour deepening toward the edges, the facets
    turned to the light bright, a white fire on the one that catches it. */
export function gem(view: View, base: RGB): Shade {
  const L = view.L, H = view.H, deep = scale(base, 0.22), clear = mix(base, WHITE, 0.3);
  return (n) => {
    const c = mix(deep, clear, clamp01(clamp01(n[2]) * 0.75 + dot(n, L) * 0.4));
    return mix(c, WHITE, Math.pow(clamp01(dot(n, H)), 24) * 0.95);
  };
}

/* ── single fills: spheres and cut stones ──────────────────────────── */

export type SpriteKind = 'gold' | 'silver' | 'pearl';
const SPRITE: Record<SpriteKind, [number, string][]> = {
  gold: [[0, '#fffbe8'], [0.08, '#ffe7a0'], [0.3, '#eeb546'], [0.62, '#ad7214'], [0.87, '#5a3806'], [1, '#8c5c18']],
  silver: [[0, '#ffffff'], [0.08, '#f3f5f9'], [0.32, '#c6ccd6'], [0.64, '#7a808c'], [0.88, '#3d4149'], [1, '#6b717c']],
  pearl: [[0, '#ffffff'], [0.1, '#fdf9f7'], [0.45, '#ebe4e6'], [0.8, '#c6bccb'], [1, '#a89db5']],
};

/** A small sphere as one radial fill: its hot spot where the normal meets
    the half vector, falling to a dark edge with a little reflected light. */
export function sphereSprite(ctx: CanvasRenderingContext2D, view: View, c: V3, rad: number, kind: SpriteKind | RGB) {
  const s = view.toScreen(c);
  const H = view.H;
  const g = ctx.createRadialGradient(s[0] + H[0] * rad * 0.85, s[1] + H[1] * rad * 0.85, 0, s[0], s[1], rad);
  if (typeof kind === 'string') for (const [t, col] of SPRITE[kind]) g.addColorStop(t, col);
  else {
    g.addColorStop(0, css(mix(kind, WHITE, 0.8)));
    g.addColorStop(0.1, css(mix(kind, WHITE, 0.3)));
    g.addColorStop(0.35, css(kind));
    g.addColorStop(0.85, css(scale(kind, 0.5)));
    g.addColorStop(1, css(scale(kind, 0.62)));
  }
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(s[0], s[1], rad, 0, TAU);
  ctx.fill();
}

/**
 * A cut stone set in a surface: `c` its centre, `N` the surface's outward
 * normal, `T` a tangent (object space, unit). An eight-sided girdle, a
 * table on top and the crown facets between, each lit by its own normal.
 */
export function cutGem(ctx: CanvasRenderingContext2D, view: View, c: V3, N: V3, T: V3, rad: number, col: RGB) {
  const B = cross(N, T);
  const at = (r: number, a: number, h: number): V3 => {
    const x = r * Math.cos(a), y = r * Math.sin(a);
    return [c[0] + x * T[0] + y * B[0] + h * N[0], c[1] + x * T[1] + y * B[1] + h * N[1], c[2] + x * T[2] + y * B[2] + h * N[2]];
  };
  const K = 8, tr = 0.55, th = 0.36 * rad;
  const girdle: V3[] = [], table: V3[] = [];
  for (let k = 0; k < K; k++) {
    const a = ((k + 0.5) / K) * TAU;
    girdle.push(at(rad, a, 0));
    table.push(at(rad * tr, a, th));
  }
  const shade = gem(view, col);
  const poly = (pts: V3[], n: V3) => {
    const nv = view.dir(n);
    if (nv[2] <= 0.02) return;
    ctx.fillStyle = css(shade(nv));
    ctx.beginPath();
    pts.forEach((p, i) => {
      const s = view.toScreen(p);
      if (i) ctx.lineTo(s[0], s[1]);
      else ctx.moveTo(s[0], s[1]);
    });
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.stroke();
  };
  ctx.lineWidth = Math.min(0.3, 1 / view.px);
  ctx.lineJoin = 'round';
  for (let k = 0; k < K; k++) {
    const g0 = girdle[k], g1 = girdle[(k + 1) % K], t1 = table[(k + 1) % K], t0 = table[k];
    let n = cross(sub(t1, g0), sub(t0, g1));
    if (dot(n, N) < 0) n = [-n[0], -n[1], -n[2]];
    poly([g0, g1, t1, t0], norm(n));
  }
  poly(table, N);
  /* the table's inner light: a lighter kite toward the light */
  const nv = view.dir(N);
  if (nv[2] > 0.1) {
    const s0 = view.toScreen(at(0, 0, th));
    const L = view.L;
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.beginPath();
    const s1 = view.toScreen(at(rad * tr * 0.8, Math.atan2(-L[1], -L[0]) + 2.2, th));
    const s2 = view.toScreen(at(rad * tr * 0.9, Math.atan2(-L[1], -L[0]) + Math.PI, th));
    const s3 = view.toScreen(at(rad * tr * 0.8, Math.atan2(-L[1], -L[0]) + Math.PI + 0.94, th));
    ctx.moveTo(s0[0], s0[1]);
    ctx.lineTo(s1[0], s1[1]);
    ctx.lineTo(s2[0], s2[1]);
    ctx.lineTo(s3[0], s3[1]);
    ctx.closePath();
    ctx.fill();
  }
}
