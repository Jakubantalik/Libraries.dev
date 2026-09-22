import { voiceLobes } from './styles';
import type { VoiceDriverConfig } from './voiceDriver';

/**
 * The dot surface — `look="dots"`.
 *
 * A sheet of dots seen in perspective along the bottom of the element,
 * gently domed, in the dotted language of thinking-orbs: depth carried by
 * dot size and ink alone, plain 2D canvas fills, no filters, so every engine
 * draws the same picture.
 *
 * The voice raises hills out of the sheet — one per lobe, so the spectrum
 * reads as a landscape, drifting sideways with the flow and gathering into
 * one travelling mound while processing. Every dot carries its own height
 * and velocity: it is lifted toward the voice on a fast spring, keeps its
 * momentum when the voice stops, and then falls under gravity, landing on
 * the sheet with a small bounce. Lifted dots catch the light.
 */

/** Grid spacing at scale 1, px, measured on the nearest row. */
const GAP = 4.6;
/** Camera pitch: how steeply the sheet is seen from above. */
const TILT = 0.4;
/** Perspective: the far edge renders at this share of the near edge's size. */
const K_FAR = 0.5;
/** A dot whose tone is below this is not drawn. */
const S_MIN = 0.03;
/** Ink buckets: dots are batched into one path per shade. */
const BUCKETS = 20;
/** Above this many grid points the spacing opens up, so a large host stays cheap. */
const MAX_DOTS = 6000;
const DPR_MAX = 2;
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

export interface DotsState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** What the grid was built for; a change rebuilds it (and resets the physics). */
  key: string;
  /** The sheet's frame: depth, the depth the hills stand at, and the perspective. */
  depth: number;
  hillZ: number;
  persp: number;
  /** Grid points, far rows first: world position, the row, a per-dot seed. */
  n: number;
  gx: Float32Array;
  gz: Float32Array;
  row: Uint16Array;
  seed: Float32Array;
  rows: number;
  rowZ: Float32Array;
  /** Physics: each dot's height above the sheet and its vertical velocity. */
  h: Float32Array;
  v: Float32Array;
  /** Per-frame output: position, radius and ink bucket of every drawn dot. */
  outX: Float32Array;
  outY: Float32Array;
  outR: Float32Array;
  outB: Uint8Array;
}

export function createDotsState(canvas: HTMLCanvasElement): DotsState | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const f = new Float32Array(0);
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
    h: f,
    v: f,
    outX: f,
    outY: f,
    outR: f,
    outB: new Uint8Array(0),
  };
}

/**
 * The sheet: rows running into the depth, each row's dots spaced evenly in
 * the world so perspective packs the far rows finer — which is what makes it
 * read as a surface rather than a screen. Each row only spans the width it
 * is seen at, so no dot is simulated off to the side.
 */
function buildGrid(st: DotsState, cw: number, gap: number, footprint: number): void {
  const sinT = Math.sin(TILT);
  const depth = footprint / (sinT * K_FAR);
  const persp = (1 / K_FAR - 1) / depth;
  const dz = (gap * 0.82) / sinT;
  const rows = Math.max(2, Math.ceil(depth / dz) + 1);
  const rowZ = new Float32Array(rows);
  const xs: number[] = [];
  const zs: number[] = [];
  const rs: number[] = [];
  const rand = rng(0x9e3779b9);
  const seeds: number[] = [];
  // Far rows first, so the draw order runs back to front.
  for (let r = rows - 1; r >= 0; r--) {
    const z = Math.min(depth, r * dz);
    rowZ[r] = z;
    const k = 1 / (1 + persp * z);
    const half = (cw / 2 + gap * 2) / k;
    const cols = Math.ceil((2 * half) / gap);
    // Alternate rows sit half a step over: a hex weave, not a checkerboard.
    const off = r & 1 ? gap / 2 : 0;
    for (let c = 0; c <= cols; c++) {
      xs.push(-half + off + c * gap);
      zs.push(z);
      rs.push(r);
      seeds.push(rand());
    }
  }
  st.n = xs.length;
  st.gx = Float32Array.from(xs);
  st.gz = Float32Array.from(zs);
  st.row = Uint16Array.from(rs);
  st.seed = Float32Array.from(seeds);
  st.rows = rows;
  st.rowZ = rowZ;
  st.depth = depth;
  st.hillZ = depth * 0.42;
  st.persp = persp;
  st.h = new Float32Array(st.n);
  st.v = new Float32Array(st.n);
  st.outX = new Float32Array(st.n);
  st.outY = new Float32Array(st.n);
  st.outR = new Float32Array(st.n);
  st.outB = new Uint8Array(st.n);
}

/** One frame of the voice, as the driver has it. */
export interface DotsFrame {
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
const bucketStyle: string[] = new Array(BUCKETS);
let bucketStyleKey = '';

/**
 * Ink for a tone bucket: faint dots a translucent grey, lit ones solid
 * white — near-black ink on the light theme.
 */
function inkFor(bucket: number, dark: boolean): string {
  const s = S_MIN + ((bucket + 0.5) / BUCKETS) * (1 - S_MIN);
  const alpha = 0.08 + 0.92 * Math.pow(s, 1.05);
  const g = dark ? Math.round(185 + 70 * s) : Math.round(120 - 105 * s);
  return `rgba(${g},${g},${g},${alpha.toFixed(3)})`;
}

export function drawDots(st: DotsState, config: VoiceDriverConfig, f: DotsFrame): void {
  const { cw, ch } = f;
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
  // a tall one, where the hills get the room above it instead.
  const footprint = Math.max(10, Math.min(ch * 0.5, 64 * Math.pow(scale, 0.9)));
  let gap = GAP * sc * Math.max(0.3, config.dotGap);
  // A rough count: the sheet's rows times the columns of an average row.
  const estimate = (footprint / (Math.sin(TILT) * K_FAR) / ((gap * 0.82) / Math.sin(TILT))) * (cw / (gap * 0.7));
  if (estimate > MAX_DOTS) gap *= Math.sqrt(estimate / MAX_DOTS);
  const key = `${cw}|${ch}|${gap.toFixed(3)}|${footprint.toFixed(2)}`;
  if (st.key !== key) {
    buildGrid(st, cw, gap, footprint);
    st.key = key;
  }
  const { depth, hillZ, persp, rows, rowZ } = st;
  const sinT = Math.sin(TILT);
  const cosT = Math.cos(TILT);
  const y0 = ch - 1.5 * sc;

  // The dome: the sheet falls away toward the sides and the far edge, so
  // its rows arc like a horizon.
  const kHill = 1 / (1 + persp * hillZ);
  const edgeX = cw / 2 / kHill;
  const domeX = (0.32 * footprint) / (edgeX * edgeX);
  const domeZ = (0.3 * footprint) / Math.max(1, (depth - hillZ) * (depth - hillZ));

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
  // a small bounce on the sheet. Each dot's gravity and bounce vary a hair,
  // so a falling hill comes down as a shower rather than a slab.
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
  const n = st.n;
  const outX = st.outX;
  const outY = st.outY;
  const outR = st.outR;
  const outB = st.outB;
  let out = 0;
  const bucketScale = BUCKETS / (1 - S_MIN);
  const rBase = 1.02 * sc * Math.max(0.1, config.dotSize);
  const liftRef = 1 / Math.max(1, 0.45 * hMax);
  const presence = 0.55 + 0.45 * f.glow;
  const halfW = cw / 2 + 4;

  for (let i = 0; i < n; i++) {
    const X = GX[i];
    const Z = GZ[i];
    const depthW = rowDepth[ROW[i]];

    // Where the voice wants this dot.
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
    if (dt > 0) {
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

    // The sheet's own shape, and its ripple.
    const dzH = Z - hillZ;
    let Y = -(X * X * domeX) - dzH * dzH * domeZ + hh;
    if (rippleAmp > 0) {
      Y += (vnoise((X - drift) * iRx, Z * iRz + t * 0.33) - 0.5) * 2 * rippleAmp;
    }

    // Project.
    const kz = 1 / (1 + persp * Z);
    const sx = cw / 2 + X * kz;
    const edge = Math.abs(sx - cw / 2);
    if (edge > halfW) continue;
    const sy = y0 - (Z * sinT + Y * cosT) * kz;
    if (sy < -4 || sy > ch + 4) continue;

    // Near dots larger and brighter; lifted dots catch the light; the
    // sheet dissolves toward the sides and the far edge.
    const near = (kz - K_FAR) / (1 - K_FAR);
    const lifted = Math.min(1, hh * liftRef);
    const fade = smoothstep(0, 0.2, 1 - edge / halfW) * smoothstep(1, 0.7, Z / depth);
    const s = Math.min(1, ((0.1 + 0.42 * near) * presence + 0.62 * lifted * (0.45 + 0.55 * near)) * fade);
    if (s < S_MIN) continue;
    let b = Math.floor((Math.min(s, 0.99999) - S_MIN) * bucketScale);
    if (b < 0) b = 0;
    outX[out] = sx;
    outY[out] = sy;
    outR[out] = (0.28 + 0.92 * near + 0.32 * lifted) * rBase;
    outB[out] = b;
    out++;
  }

  // ── Paint: one path per shade ───────────────────────────────────────
  const styleKey = dark ? 'd' : 'l';
  if (bucketStyleKey !== styleKey) {
    for (let b = 0; b < BUCKETS; b++) bucketStyle[b] = inkFor(b, dark);
    bucketStyleKey = styleKey;
  }
  for (let b = 0; b < BUCKETS; b++) {
    let any = false;
    for (let i = 0; i < out; i++) {
      if (outB[i] !== b) continue;
      if (!any) {
        ctx.beginPath();
        any = true;
      }
      const x = outX[i];
      const y = outY[i];
      const r = outR[i];
      ctx.moveTo(x + r, y);
      ctx.arc(x, y, r, 0, TWO_PI);
    }
    if (any) {
      ctx.fillStyle = bucketStyle[b];
      ctx.fill();
    }
  }
}
