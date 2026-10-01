import { voiceLobes } from './styles';
import type { VoiceDriverConfig } from './voiceDriver';

/**
 * The surface looks — `look="dots"` and `look="lines"`.
 *
 * A sheet seen in perspective along the bottom of the element, gently
 * domed, drawn as a field of dots (the dotted language of thinking-orbs) or
 * as lines running across it: depth carried by size and ink alone, plain 2D
 * canvas paths, no filters, so every engine draws the same picture.
 *
 * The voice raises hills out of the sheet — one per lobe, so the spectrum
 * reads as a landscape, drifting sideways with the flow and gathering into
 * one travelling mound while processing. Every point of the sheet carries
 * its own height and velocity: it is lifted toward the voice on a fast
 * spring, keeps its momentum when the voice stops, and then falls under
 * gravity, landing on the sheet with a small bounce. Lifted parts catch the
 * light.
 *
 * The sheet's own shape is the surface props': how tall it stands, how far
 * it arcs, and its tails — the ends rising into the corners or dropping
 * away, and dissolving into the sides. Lines are solid unless `seeThrough`:
 * a raised ridge hides the lines behind it, as a sheet would.
 */

/** Dot spacing at scale 1, px, measured on the nearest row. */
const GAP = 4.6;
/** Line spacing at scale 1, px on the nearest row: between the rows, and between the columns. */
const LINE_ROW_GAP = 5.6;
const LINE_COL_GAP = 10;
/** Points along a line, px apart on the nearest row — fine enough that a hill stays round. */
const LINE_STEP = 3;
/** Camera pitch: how steeply the sheet is seen from above. */
const TILT = 0.4;
/** Perspective: the far edge renders at this share of the near edge's size. */
const K_FAR = 0.5;
/** A point whose tone is below this is not drawn. */
const S_MIN = 0.03;
/** Ink buckets: dots are batched into one path per shade, and a line's gradient takes its stops from the same inks. */
const BUCKETS = 20;
/** Above this many points the grid opens up, so a large host stays cheap. */
const MAX_DOTS = 6000;
const MAX_LINE_POINTS = 9000;
const MAX_LINE_ROWS = 120;
/** Most colour stops along one line. */
const LINE_STOPS = 40;
const DPR_MAX = 2;
/** How high a full tail lifts the ends, × the sheet's height. */
const TAIL_LIFT = 0.6;
/** A line's tension, per second: how fast each point is pulled toward its
 *  neighbours along the row, so a falling line stays a curve. */
const LINE_TENSION = 22;
/** A square dot's half-side for the ink of a round one of the same radius (equal area). */
const SQUARE = Math.sqrt(Math.PI) / 2;
const TWO_PI = Math.PI * 2;

// ── Noise ─────────────────────────────────────────────────────────────
// A tileable value-noise table, built once and sampled with a smoothstep
// bilinear — a handful of lookups per sample.

const NOISE_N = 64;
const NOISE_MASK = NOISE_N - 1;
const NOISE = (() => {
  const table = new Float32Array(NOISE_N * NOISE_N);
  let s = 0x2545f491;
  for (let i = 0; i < table.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    table[i] = (s >>> 0) / 4294967296;
  }
  return table;
})();

function vnoise(x: number, y: number): number {
  const xf = Math.floor(x);
  const yf = Math.floor(y);
  let fx = x - xf;
  let fy = y - yf;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  const x0 = xf & NOISE_MASK;
  const y0 = yf & NOISE_MASK;
  const x1 = (x0 + 1) & NOISE_MASK;
  const y1 = (y0 + 1) & NOISE_MASK;
  const a = NOISE[y0 * NOISE_N + x0];
  const b = NOISE[y0 * NOISE_N + x1];
  const c = NOISE[y1 * NOISE_N + x0];
  const d = NOISE[y1 * NOISE_N + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Deterministic 0–1 sequence for the per-dot seeds. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// ── State ─────────────────────────────────────────────────────────────

export interface SurfaceState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** What the grid was built for; a change rebuilds it (and resets the physics). */
  key: string;
  /** The sheet's frame: depth, the depth the hills stand at, and the perspective. */
  depth: number;
  hillZ: number;
  persp: number;
  /** Grid points, far rows first: world position, the row, a per-point seed. */
  n: number;
  gx: Float32Array;
  gz: Float32Array;
  row: Uint16Array;
  seed: Float32Array;
  rows: number;
  rowZ: Float32Array;
  /** Where each row's points start, in draw order (far first); for lines also
   *  the lattice index of its first point — the columns run through every
   *  `colEvery`th index, the same in every row. */
  rowStart: Int32Array;
  rowFirst: Int32Array;
  colEvery: number;
  /** Physics: each point's height above the sheet and its vertical velocity. */
  h: Float32Array;
  v: Float32Array;
  /** Per frame: every point's position, its tone (−1 when it is not drawn) and, for dots, its radius. */
  px: Float32Array;
  py: Float32Array;
  ps: Float32Array;
  pr: Float32Array;
  /** Dots: each drawn point's ink bucket, and the drawn points sorted by it. */
  pb: Uint8Array;
  order: Int32Array;
}

export function createSurfaceState(canvas: HTMLCanvasElement): SurfaceState | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const f = new Float32Array(0);
  const i = new Int32Array(0);
  return {
    canvas,
    ctx,
    key: '',
    depth: 1,
    hillZ: 0,
    persp: 0,
    n: 0,
    gx: f,
    gz: f,
    row: new Uint16Array(0),
    seed: f,
    rows: 0,
    rowZ: f,
    rowStart: i,
    rowFirst: i,
    colEvery: 1,
    h: f,
    v: f,
    px: f,
    py: f,
    ps: f,
    pr: f,
    pb: new Uint8Array(0),
    order: i,
  };
}

/** The sheet's frame for a footprint: its depth and perspective. */
function frameFor(footprint: number): { depth: number; persp: number } {
  const depth = footprint / (Math.sin(TILT) * K_FAR);
  return { depth, persp: (1 / K_FAR - 1) / depth };
}

function commit(
  st: SurfaceState,
  pts: { x: number[]; z: number[]; r: number[]; seed: number[] },
  rows: number,
  rowZ: Float32Array,
  rowStart: Int32Array,
  rowFirst: Int32Array,
  colEvery: number,
  depth: number,
  persp: number
): void {
  st.n = pts.x.length;
  st.gx = Float32Array.from(pts.x);
  st.gz = Float32Array.from(pts.z);
  st.row = Uint16Array.from(pts.r);
  st.seed = Float32Array.from(pts.seed);
  st.rows = rows;
  st.rowZ = rowZ;
  st.rowStart = rowStart;
  st.rowFirst = rowFirst;
  st.colEvery = colEvery;
  st.depth = depth;
  st.hillZ = depth * 0.42;
  st.persp = persp;
  st.h = new Float32Array(st.n);
  st.v = new Float32Array(st.n);
  st.px = new Float32Array(st.n);
  st.py = new Float32Array(st.n);
  st.ps = new Float32Array(st.n);
  st.pr = new Float32Array(st.n);
  st.pb = new Uint8Array(st.n);
  st.order = new Int32Array(st.n);
}

/**
 * The dot sheet: rows running into the depth, each row's dots spaced evenly
 * in the world so perspective packs the far rows finer — which is what makes
 * it read as a surface rather than a screen. Each row only spans the width
 * it is seen at, so no dot is simulated off to the side.
 */
function buildDots(st: SurfaceState, cw: number, gap: number, footprint: number): void {
  const { depth, persp } = frameFor(footprint);
  const dz = (gap * 0.82) / Math.sin(TILT);
  const rows = Math.max(2, Math.ceil(depth / dz) + 1);
  const rowZ = new Float32Array(rows);
  const rowStart = new Int32Array(rows + 1);
  const pts = { x: [] as number[], z: [] as number[], r: [] as number[], seed: [] as number[] };
  const rand = rng(0x9e3779b9);
  // Far rows first, so the draw order runs back to front.
  for (let r = rows - 1, d = 0; r >= 0; r--, d++) {
    const z = Math.min(depth, r * dz);
    rowZ[r] = z;
    rowStart[d] = pts.x.length;
    const k = 1 / (1 + persp * z);
    const half = (cw / 2 + gap * 2) / k;
    const cols = Math.ceil((2 * half) / gap);
    // Alternate rows sit half a step over: a hex weave, not a checkerboard.
    const off = r & 1 ? gap / 2 : 0;
    for (let c = 0; c <= cols; c++) {
      pts.x.push(-half + off + c * gap);
      pts.z.push(z);
      pts.r.push(r);
      pts.seed.push(rand());
    }
  }
  rowStart[rows] = pts.x.length;
  commit(st, pts, rows, rowZ, rowStart, new Int32Array(rows), 1, depth, persp);
}

/**
 * The line sheet: the same rows, but every row's points on one lattice
 * across the width, so the columns line up through the depth and converge
 * with the perspective. The points are finer than the lines they draw, and
 * their seeds vary smoothly along a row, so a falling line stays a curve.
 */
function buildLines(st: SurfaceState, cw: number, rowGap: number, step: number, colEvery: number, footprint: number): void {
  const { depth, persp } = frameFor(footprint);
  const dz = rowGap / Math.sin(TILT);
  const rows = Math.max(2, Math.floor(depth / dz) + 1);
  const rowZ = new Float32Array(rows);
  const rowStart = new Int32Array(rows + 1);
  const rowFirst = new Int32Array(rows);
  const pts = { x: [] as number[], z: [] as number[], r: [] as number[], seed: [] as number[] };
  for (let r = rows - 1, d = 0; r >= 0; r--, d++) {
    const z = r * dz;
    rowZ[r] = z;
    rowStart[d] = pts.x.length;
    const k = 1 / (1 + persp * z);
    const reach = Math.ceil((cw / 2 + step * 2) / k / step);
    rowFirst[d] = -reach;
    for (let i = -reach; i <= reach; i++) {
      const x = i * step;
      pts.x.push(x);
      pts.z.push(z);
      pts.r.push(r);
      pts.seed.push(vnoise(x * 0.045 + 7.3, r * 0.61 + 1.7));
    }
  }
  rowStart[rows] = pts.x.length;
  commit(st, pts, rows, rowZ, rowStart, rowFirst, colEvery, depth, persp);
}

/** One frame of the voice, as the driver has it. */
export interface SurfaceFrame {
  cw: number;
  ch: number;
  /** Each lobe's centre along the edge (element px), and its amplitude from the band it follows. */
  lobeX: Float32Array;
  lobeL: Float32Array;
  /** The spread multiplier (0.85 at rest, wider with the voice). */
  w: number;
  /** How high the hills stand, 0–1: the voice on a fast envelope, or the held level while processing. */
  lift: number;
  /** Overall presence, 0.15–1. */
  glow: number;
  t: number;
  dt: number;
  /** Unwrapped flow travel, px — the ripple rides it. */
  drift: number;
}

// Per-frame scratch, shared: frames are painted one at a time.
const LOBES = voiceLobes.length;
const hillX = new Float32Array(LOBES);
const hillA = new Float32Array(LOBES);
const hillIw = new Float32Array(LOBES);
let rowDepth = new Float32Array(0);
const bucketCount = new Int32Array(BUCKETS);
const bucketAt = new Int32Array(BUCKETS);
const bucketStyle: string[] = new Array(BUCKETS);
let clearStyle = '';
let bucketStyleKey = '';
const bucketScale = BUCKETS / (1 - S_MIN);

/** Grey and alpha for a tone: faint a translucent grey, lit solid white — near-black ink on the light theme. */
function ink(s: number, alpha: number, dark: boolean): string {
  const g = dark ? Math.round(185 + 70 * s) : Math.round(120 - 105 * s);
  return `rgba(${g},${g},${g},${alpha.toFixed(3)})`;
}

function inkStyles(dark: boolean): void {
  const key = dark ? 'd' : 'l';
  if (bucketStyleKey === key) return;
  for (let b = 0; b < BUCKETS; b++) {
    const s = S_MIN + ((b + 0.5) / BUCKETS) * (1 - S_MIN);
    bucketStyle[b] = ink(s, 0.08 + 0.92 * Math.pow(s, 1.05), dark);
  }
  // A line fades out through its own grey, not through black.
  clearStyle = ink(S_MIN, 0, dark);
  bucketStyleKey = key;
}

function bucketOf(s: number): number {
  const b = Math.floor((Math.min(s, 0.99999) - S_MIN) * bucketScale);
  return b < 0 ? 0 : b;
}

export function drawSurface(st: SurfaceState, config: VoiceDriverConfig, f: SurfaceFrame): void {
  const { cw, ch } = f;
  const lines = config.look === 'lines';
  const dark = config.theme === 'dark';
  const scale = Math.max(0.05, config.scale);
  const sc = Math.sqrt(scale);
  const texture = Math.max(0, Math.min(1, config.texture));
  const motion = config.reducedMotion ? 0 : 1;
  const t = f.t * motion;
  const dt = f.dt;

  // ── Canvas ───────────────────────────────────────────────────────────
  const dpr = Math.min(DPR_MAX, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const pw = Math.round(cw * dpr);
  const ph = Math.round(ch * dpr);
  const canvas = st.canvas;
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  const ctx = st.ctx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  // ── The sheet ────────────────────────────────────────────────────────
  // It lies along the bottom: about half a short host's height, capped for
  // a tall one, where the hills get the room above it instead — times the
  // host's own `surfaceHeight`.
  const footprint = Math.max(
    10,
    Math.min(ch * 0.95, Math.min(ch * 0.5, 64 * Math.pow(scale, 0.9)) * Math.max(0.1, config.surfaceHeight))
  );
  const sinT = Math.sin(TILT);
  const cosT = Math.cos(TILT);
  if (lines) {
    const lineGap = Math.max(0.3, config.lineGap);
    const rowGap = Math.max(LINE_ROW_GAP * sc * lineGap, footprint / (K_FAR * MAX_LINE_ROWS));
    const colGap = LINE_COL_GAP * sc * lineGap;
    let step = LINE_STEP * sc;
    // A rough count: the rows times the points of an average row.
    const estimate = (footprint / (K_FAR * rowGap) + 1) * 1.5 * (cw / step + 4);
    if (estimate > MAX_LINE_POINTS) step *= estimate / MAX_LINE_POINTS;
    let colEvery = Math.round(colGap / step);
    if (colEvery >= 1) step = colGap / colEvery;
    else colEvery = 1;
    const key = `l|${cw}|${ch}|${rowGap.toFixed(3)}|${step.toFixed(3)}|${colEvery}|${footprint.toFixed(2)}`;
    if (st.key !== key) {
      buildLines(st, cw, rowGap, step, colEvery, footprint);
      st.key = key;
    }
  } else {
    let gap = GAP * sc * Math.max(0.3, config.dotGap);
    // A rough count: the sheet's rows times the columns of an average row.
    const estimate = (footprint / (sinT * K_FAR) / ((gap * 0.82) / sinT)) * (cw / (gap * 0.7));
    if (estimate > MAX_DOTS) gap *= Math.sqrt(estimate / MAX_DOTS);
    const key = `d|${cw}|${ch}|${gap.toFixed(3)}|${footprint.toFixed(2)}`;
    if (st.key !== key) {
      buildDots(st, cw, gap, footprint);
      st.key = key;
    }
  }
  const { depth, hillZ, persp, rows, rowZ } = st;
  const y0 = ch - 1.5 * sc;

  // The arc: the sheet falls away toward the sides and the far edge, so its
  // rows bow like a horizon — `surfaceCurve` times; below 0 it cups instead.
  const curve = config.surfaceCurve;
  const kHill = 1 / (1 + persp * hillZ);
  const edgeX = cw / 2 / kHill;
  const domeX = (curve * 0.32 * footprint) / (edgeX * edgeX);
  const domeZ = (curve * 0.3 * footprint) / Math.max(1, (depth - hillZ) * (depth - hillZ));
  // The tails: from `surfaceTailPosition` of the way out to either side,
  // each row's ends rise (or, below 0, drop) by up to `surfaceTail` of the
  // sheet's height at the edge, on a `surfaceTailCurve` exponent.
  const tailA = config.surfaceTail * TAIL_LIFT * footprint;
  const tailStart = Math.max(0, Math.min(0.98, config.surfaceTailPosition));
  const tailSpan = 1 / (1 - tailStart);
  const tailCurve = Math.max(0.5, config.surfaceTailCurve);
  // How far in from the sides the sheet dissolves, as a share of its half-width.
  const sideFade = Math.max(0, Math.min(1, config.surfaceFade));

  // ── The hills ────────────────────────────────────────────────────────
  // One per lobe, narrow enough that the spectrum reads as separate peaks,
  // standing a little behind the middle of the sheet so the near rows stay
  // low and the landscape rises out of it.
  const L = config.layers;
  const hMax = 64 * config.rangeHeight * config.reach * 0.62;
  for (let i = 0; i < LOBES; i++) {
    const lobe = voiceLobes[i];
    hillX[i] = (f.lobeX[i] - cw / 2) / kHill;
    hillA[i] = hMax * f.lift * f.lobeL[i];
    hillIw[i] = kHill / Math.max(1, lobe.w * L.glowWidth * f.w * 0.42);
  }
  if (rowDepth.length < rows) rowDepth = new Float32Array(rows);
  const zSpread = depth * 0.24;
  for (let r = 0; r < rows; r++) {
    const dzr = (rowZ[r] - hillZ) / zSpread;
    rowDepth[r] = Math.exp(-dzr * dzr);
  }

  // ── Physics ──────────────────────────────────────────────────────────
  // Up: a fast spring toward the voice. Down: momentum, then gravity, then
  // a small bounce on the sheet. Each point's gravity and bounce vary a
  // hair, so a falling hill comes down as a shower rather than a slab.
  const gravity = 1250 * sc * Math.max(0.05, config.gravity);
  const riseK = dt > 0 ? 1 - Math.exp(-dt * 16) : 0;
  const vMax = 900 * sc;
  const bounceMin = 55 * sc;

  // The ripple: a slow undulation the flow carries across the sheet.
  const rippleAmp = texture * 2.8 * sc * (0.5 + 0.5 * f.glow);
  const iRx = 1 / (46 * sc);
  const iRz = 1 / (30 * sc);
  const drift = f.drift * motion;

  const H = st.h;
  const V = st.v;
  const GX = st.gx;
  const GZ = st.gz;
  const ROW = st.row;
  const SEED = st.seed;
  const PX = st.px;
  const PY = st.py;
  const PS = st.ps;
  const PR = st.pr;
  const n = st.n;
  const rBase = 1.02 * sc * Math.max(0.1, config.dotSize);
  const liftRef = 1 / Math.max(1, 0.45 * hMax);
  const presence = 0.55 + 0.45 * f.glow;
  const halfW = cw / 2 + 4;
  const iHalf = 2 / cw;

  if (dt > 0) {
    for (let i = 0; i < n; i++) {
      const X = GX[i];
      const depthW = rowDepth[ROW[i]];

      // Where the voice wants this point.
      let target = 0;
      if (depthW > 0.004) {
        for (let k = 0; k < LOBES; k++) {
          const d = (X - hillX[k]) * hillIw[k];
          const d2 = d * d;
          if (d2 < 9) target += hillA[k] * Math.exp(-d2);
        }
        target *= depthW;
      }

      // Get it there.
      let hh = H[i];
      let vv = V[i];
      if (target >= hh) {
        const next = hh + (target - hh) * riseK;
        vv = Math.min(vMax, (next - hh) / dt);
        hh = next;
      } else {
        const sd = SEED[i];
        vv -= gravity * (0.88 + 0.24 * sd) * dt;
        hh += vv * dt;
        if (hh < target) {
          hh = target;
          vv = vv < -bounceMin && motion ? -vv * (0.16 + 0.18 * sd) : 0;
        }
      }
      H[i] = hh;
      V[i] = vv;
    }
    // A line is a string: its points pull on their neighbours, so where one
    // part still coasts up while the next has turned to fall, or lands a
    // moment later, the line bends instead of splintering.
    if (lines) {
      const k = Math.min(0.45, dt * LINE_TENSION);
      const rowStart = st.rowStart;
      for (let d = 0; d < rows; d++) {
        const b = rowStart[d + 1] - 1;
        let hp = H[rowStart[d]];
        let vp = V[rowStart[d]];
        for (let i = rowStart[d] + 1; i < b; i++) {
          const hc = H[i];
          const vc = V[i];
          H[i] = hc + k * (hp + H[i + 1] - 2 * hc);
          V[i] = vc + k * (vp + V[i + 1] - 2 * vc);
          hp = hc;
          vp = vc;
        }
      }
    }
  }

  for (let i = 0; i < n; i++) {
    const X = GX[i];
    const Z = GZ[i];
    const hh = H[i];

    // Project. A dot off the sides is not drawn; a line keeps every point,
    // so it runs on unbroken to the edge.
    const kz = 1 / (1 + persp * Z);
    const sx = cw / 2 + X * kz;
    const edge = Math.abs(sx - cw / 2);
    if (!lines && edge > halfW) {
      PS[i] = -1;
      continue;
    }

    // The sheet's own shape — its arc and tails — and its ripple.
    const dzH = Z - hillZ;
    let Y = -(X * X * domeX) - dzH * dzH * domeZ + hh;
    if (tailA !== 0) {
      const u = edge * iHalf - tailStart;
      if (u > 0) {
        const q = Math.min(1, u * tailSpan);
        Y += tailA * Math.pow(q, tailCurve);
      }
    }
    if (rippleAmp > 0) {
      Y += (vnoise((X - drift) * iRx, Z * iRz + t * 0.33) - 0.5) * 2 * rippleAmp;
    }
    const sy = y0 - (Z * sinT + Y * cosT) * kz;
    if (!lines && (sy < -4 || sy > ch + 4)) {
      PS[i] = -1;
      continue;
    }

    // Near points larger and brighter; lifted ones catch the light; the
    // sheet dissolves toward the sides and the far edge.
    const near = (kz - K_FAR) / (1 - K_FAR);
    const lifted = Math.min(1, hh * liftRef);
    const side = 1 - edge / halfW;
    const fade = (sideFade > 0 ? smoothstep(0, sideFade, side) : side > 0 ? 1 : 0) * smoothstep(1, 0.7, Z / depth);
    PX[i] = sx;
    PY[i] = sy;
    PS[i] = Math.min(1, ((0.1 + 0.42 * near) * presence + 0.62 * lifted * (0.45 + 0.55 * near)) * fade);
    PR[i] = (0.28 + 0.92 * near + 0.32 * lifted) * rBase;
  }

  inkStyles(dark);
  if (lines) paintLines(st, config, sc);
  else paintDots(st, config.dotShape === 'square');
}

/** Dots: one path per shade, faint first, so the lit dots sit on top. */
function paintDots(st: SurfaceState, square: boolean): void {
  const { ctx, n, px, py, ps, pr, pb, order } = st;
  bucketCount.fill(0);
  for (let i = 0; i < n; i++) {
    const s = ps[i];
    if (s < S_MIN) continue;
    const b = bucketOf(s);
    pb[i] = b;
    bucketCount[b]++;
  }
  let at = 0;
  for (let b = 0; b < BUCKETS; b++) {
    bucketAt[b] = at;
    at += bucketCount[b];
  }
  for (let i = 0; i < n; i++) {
    if (ps[i] < S_MIN) continue;
    order[bucketAt[pb[i]]++] = i;
  }
  let from = 0;
  for (let b = 0; b < BUCKETS; b++) {
    const to = from + bucketCount[b];
    if (to === from) continue;
    ctx.beginPath();
    for (let k = from; k < to; k++) {
      const i = order[k];
      const x = px[i];
      const y = py[i];
      const r = pr[i];
      if (square) {
        const hs = r * SQUARE;
        ctx.rect(x - hs, y - hs, 2 * hs, 2 * hs);
      } else {
        ctx.moveTo(x + r, y);
        ctx.arc(x, y, r, 0, TWO_PI);
      }
    }
    ctx.fillStyle = bucketStyle[b];
    ctx.fill();
    from = to;
  }
}

/** A row's ink along its length: a horizontal gradient through its points' shades. */
function rowInk(ctx: CanvasRenderingContext2D, st: SurfaceState, a: number, b: number): CanvasGradient {
  const { px, ps } = st;
  const x0 = px[a];
  const span = px[b - 1] - x0 || 1;
  const g = ctx.createLinearGradient(x0, 0, x0 + span, 0);
  const stride = Math.max(1, Math.ceil((b - a) / LINE_STOPS));
  for (let i = a; ; i += stride) {
    if (i > b - 1) i = b - 1;
    const s = ps[i];
    g.addColorStop(Math.max(0, Math.min(1, (px[i] - x0) / span)), s < S_MIN ? clearStyle : bucketStyle[bucketOf(s)]);
    if (i === b - 1) break;
  }
  return g;
}

/**
 * Lines, back to front: each row across the sheet, the columns running into
 * the depth between it and the row behind, or both. Unless see-through,
 * each row first clears what was drawn below its line — the sheet from that
 * row forward covers it — so a raised ridge hides the lines behind it and
 * the landscape reads as solid. Every line takes its row's width (finer in
 * the distance) and a gradient through its points' shades.
 */
function paintLines(st: SurfaceState, config: VoiceDriverConfig, sc: number): void {
  const { ctx, rows, rowStart, rowFirst, colEvery, px, py, ps, gz, persp } = st;
  const drawRows = config.linePattern !== 'columns';
  const drawCols = config.linePattern !== 'rows';
  const solid = !config.seeThrough;
  const width = Math.max(0.05, config.lineWidth) * sc;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = '#000';
  // The lowest point drawn so far: nothing lies below it to hide.
  let low = -Infinity;
  for (let d = 0; d < rows; d++) {
    const a = rowStart[d];
    const b = rowStart[d + 1];
    if (b - a < 2) continue;
    const kz = 1 / (1 + persp * gz[a]);
    const lw = width * (0.45 + 0.75 * (kz - K_FAR) / (1 - K_FAR));
    let top = Infinity;
    let bottom = -Infinity;
    let lit = false;
    for (let i = a; i < b; i++) {
      const y = py[i];
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (ps[i] >= S_MIN) lit = true;
    }
    if (solid && top < low) {
      // The strip between this row's line and the lowest point drawn. Where
      // the line runs below that point the path folds back over empty
      // canvas, which clears nothing.
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.moveTo(px[a], py[a]);
      for (let i = a + 1; i < b; i++) ctx.lineTo(px[i], py[i]);
      ctx.lineTo(px[b - 1], low + 1);
      ctx.lineTo(px[a], low + 1);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }
    if (lit) {
      ctx.strokeStyle = rowInk(ctx, st, a, b);
      ctx.lineWidth = lw;
      if (drawCols && d > 0) {
        // Each column's step from the row behind to this one: the same
        // lattice index in both (the row behind is the wider one).
        const pa = rowStart[d - 1];
        const pFirst = rowFirst[d - 1];
        const pCount = a - pa;
        const first = rowFirst[d];
        const last = first + (b - a) - 1;
        let any = false;
        ctx.beginPath();
        for (let li = Math.ceil(first / colEvery) * colEvery; li <= last; li += colEvery) {
          const jo = li - pFirst;
          if (jo < 0 || jo >= pCount) continue;
          const i = a + (li - first);
          const j = pa + jo;
          if (ps[i] < S_MIN && ps[j] < S_MIN) continue;
          // A step that climbs toward the viewer is the back of a ridge.
          if (solid && py[j] > py[i] + 0.5) continue;
          ctx.moveTo(px[j], py[j]);
          ctx.lineTo(px[i], py[i]);
          any = true;
        }
        if (any) ctx.stroke();
      }
      if (drawRows) {
        ctx.beginPath();
        ctx.moveTo(px[a], py[a]);
        for (let i = a + 1; i < b; i++) ctx.lineTo(px[i], py[i]);
        ctx.stroke();
      }
    }
    if (bottom + lw > low) low = bottom + lw;
  }
}
