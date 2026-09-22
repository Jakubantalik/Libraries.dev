import { voiceLobes } from './styles';
import type { VoiceDriverConfig } from './voiceDriver';

/**
 * The dot field — `look="dots"`.
 *
 * The same light the glow paints, sampled on a hex halftone screen and
 * drawn as dots whose size and ink follow it: the dotted language of
 * thinking-orbs. Plain 2D canvas fills only — no filters — so every engine
 * draws the same picture.
 *
 * The driver hands over each frame's geometry (where the beam sits, its
 * height and spread, every lobe's centre, amplitude and corner lift, the
 * band line) and this rebuilds the stylesheet's layers as one luminance
 * field: the inner light and the bloom, each a set of lobe ellipses masked
 * to the ceiling ellipse. On top of that sit three dotted curves tracing
 * the band line (the ridge and its two fringes), and a row of dots along
 * the element's edge where the glow's 1px stroke would be. A slow ripple
 * the flow carries through the screen, and broad soft clusters of light
 * rising like heat, make it read as an organic texture rather than a print.
 */

/** Lattice spacing at scale 1, px. */
const GAP = 4.6;
/** Radius of the faintest dot, px at scale 1, and of a fully lit one as a share of the spacing. */
const R_MIN = 0.26;
const R_PEAK = 0.36;
/** The field's texture cell, px at scale 1 — broad, soft clusters rather than speckle. */
const TEXTURE_CELL = 34;
/** The ripple's cell, px at scale 1: neighbouring dots move together. */
const RIPPLE_CELL = 26;
/** A dot whose tone is below this is not drawn. */
const S_MIN = 0.07;
/** Ink buckets: dots are batched into one path per shade. */
const BUCKETS = 20;
/** Above this many lattice points the spacing opens up, so a full-screen host stays cheap. */
const MAX_DOTS = 7000;
const DPR_MAX = 2;
const TWO_PI = Math.PI * 2;

// ── Noise ─────────────────────────────────────────────────────────────
// A tileable value-noise table, built once and sampled with a smoothstep
// bilinear — a handful of lookups per sample instead of a hash per corner.

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

/** Two octaves, roughly 0–1 around a mean of 0.5. */
function fbm(x: number, y: number): number {
  return 0.64 * vnoise(x, y) + 0.36 * vnoise(x * 2.07 + 17.3, y * 2.07 + 5.1);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// ── The glow's masks, as the stylesheet draws them ───────────────────
// edgeMask(w, h, mid, tail): white at the centre, 0.5 at `mid`, `tail` at
// 85% (when there is one), transparent at the edge.

function innerMask(t: number): number {
  if (t < 0.45) return 1 - (0.5 * t) / 0.45;
  if (t < 0.85) return 0.5 - (0.2 * (t - 0.45)) / 0.4;
  if (t < 1) return 0.3 * (1 - (t - 0.85) / 0.15);
  return 0;
}

function strokeMask(t: number): number {
  if (t < 0.45) return 1 - (0.5 * t) / 0.45;
  if (t < 1) return 0.5 * (1 - (t - 0.45) / 0.55);
  return 0;
}

function bloomMask(t: number): number {
  if (t < 0.35) return 1 - (0.5 * t) / 0.35;
  if (t < 1) return 0.5 * (1 - (t - 0.35) / 0.65);
  return 0;
}

/** The white hot spot on the edge: 0.45 at the centre, 0.14 at 30%, gone at 65%. */
function highlight(t: number): number {
  if (t < 0.3) return 0.45 - (0.31 * t) / 0.3;
  if (t < 0.65) return 0.14 * (1 - (t - 0.3) / 0.35);
  return 0;
}

// ── State ─────────────────────────────────────────────────────────────

export interface DotsState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** What the lattice was built for; a change rebuilds it. */
  key: string;
  /** Lattice points, bottom row first: base position and a per-dot seed. */
  n: number;
  px: Float32Array;
  py: Float32Array;
  seed: Float32Array;
  /** Points along the element's outline, where the stroke would be. */
  rimN: number;
  rimX: Float32Array;
  rimY: Float32Array;
  rimSeed: Float32Array;
  /** Per-frame output: position, radius and ink bucket of every drawn dot. */
  outX: Float32Array;
  outY: Float32Array;
  outR: Float32Array;
  outB: Uint8Array;
}

export function createDotsState(canvas: HTMLCanvasElement): DotsState | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const empty = new Float32Array(0);
  return {
    canvas,
    ctx,
    key: '',
    n: 0,
    px: empty,
    py: empty,
    seed: empty,
    rimN: 0,
    rimX: empty,
    rimY: empty,
    rimSeed: empty,
    outX: empty,
    outY: empty,
    outR: empty,
    outB: new Uint8Array(0),
  };
}

/** Deterministic 0–1 sequence for the lattice jitter and seeds. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * A hex lattice — the halftone's screen. Order is what makes a dot field
 * read as designed rather than as noise (thinking-orbs draws on rings and
 * spirals for the same reason), so the jitter is only a hair, enough to keep
 * moiré out of the diagonals. The organic life comes from the ripple and the
 * texture, which move neighbours together. Rows run bottom-up, so the frame
 * can stop at the first row above the light.
 */
function buildLattice(st: DotsState, cw: number, ch: number, gap: number, radius: number, rimInset: number): void {
  const rowH = gap * 0.8660254;
  const cols = Math.ceil(cw / gap) + 2;
  const rows = Math.ceil(ch / rowH) + 2;
  const cap = cols * rows;
  const px = new Float32Array(cap);
  const py = new Float32Array(cap);
  const seed = new Float32Array(cap);
  const rand = rng(0x9e3779b9);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    const y0 = ch - gap * 0.55 - r * rowH;
    const off = r & 1 ? gap * 0.5 : 0;
    for (let c = 0; c < cols; c++) {
      const x = -gap * 0.5 + off + c * gap + (rand() - 0.5) * 0.08 * gap;
      const y = y0 + (rand() - 0.5) * 0.08 * gap;
      const sd = rand();
      if (x < -gap * 0.5 || x > cw + gap * 0.5 || y < -gap) continue;
      px[n] = x;
      py[n] = y;
      seed[n] = sd;
      n++;
    }
  }
  st.n = n;
  st.px = px;
  st.py = py;
  st.seed = seed;

  // The outline, inset so the dots sit just inside the element's edge.
  const R = Math.max(0, Math.min(radius, cw / 2, ch / 2) - rimInset);
  const left = rimInset;
  const right = cw - rimInset;
  const top = rimInset;
  const bottom = ch - rimInset;
  const step = gap * 0.72;
  const rimXs: number[] = [];
  const rimYs: number[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const k = Math.max(1, Math.round(len / step));
    for (let i = 0; i < k; i++) {
      rimXs.push(x0 + ((x1 - x0) * i) / k);
      rimYs.push(y0 + ((y1 - y0) * i) / k);
    }
  };
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    const k = Math.max(1, Math.round((R * Math.abs(a1 - a0)) / step));
    for (let i = 0; i < k; i++) {
      const a = a0 + ((a1 - a0) * i) / k;
      rimXs.push(cx + R * Math.cos(a));
      rimYs.push(cy + R * Math.sin(a));
    }
  };
  // Clockwise from the bottom-left corner's end.
  line(left + R, bottom, right - R, bottom);
  if (R > 0) arc(right - R, bottom - R, Math.PI / 2, 0);
  line(right, bottom - R, right, top + R);
  if (R > 0) arc(right - R, top + R, 0, -Math.PI / 2);
  line(right - R, top, left + R, top);
  if (R > 0) arc(left + R, top + R, -Math.PI / 2, -Math.PI);
  line(left, top + R, left, bottom - R);
  if (R > 0) arc(left + R, bottom - R, Math.PI, Math.PI / 2);
  st.rimN = rimXs.length;
  st.rimX = Float32Array.from(rimXs);
  st.rimY = Float32Array.from(rimYs);
  st.rimSeed = new Float32Array(st.rimN).map(() => rand());

  // The band's three dotted curves run at most the element's width plus
  // its overflow, at a spacing no finer than half the lattice's.
  const total = n + st.rimN + 3 * (Math.ceil((cw + 4 * gap) / (gap * 0.5)) + 8);
  st.outX = new Float32Array(total);
  st.outY = new Float32Array(total);
  st.outR = new Float32Array(total);
  st.outB = new Uint8Array(total);
}

/** One frame of the glow's geometry, in element px. */
export interface DotsFrame {
  cw: number;
  ch: number;
  /** The beam's centre along the edge, and the y of the ceiling ellipse's centre. */
  bx: number;
  by: number;
  w: number;
  h: number;
  mw: number;
  lift: number;
  glow: number;
  eff: number;
  level: number;
  bendA: number;
  /** Each lobe's centre x, amplitude and corner lift (negative = up). */
  lobeX: Float32Array;
  lobeL: Float32Array;
  lobeY: Float32Array;
  /** The band line, left to right, when there is one to trace. */
  pts: Array<[number, number]> | null;
  /** Unwrapped flow travel, px — the texture rides it. */
  drift: number;
  t: number;
  /** The distortion's share, 0–1 (processing settles it out). */
  warp: number;
}

// Per-frame lobe scratch, shared: frames are painted one at a time.
const LOBES = voiceLobes.length;
const inCx = new Float32Array(LOBES);
const inCy = new Float32Array(LOBES);
const inIx = new Float32Array(LOBES);
const inIy = new Float32Array(LOBES);
const blIx = new Float32Array(LOBES);
const blIy = new Float32Array(LOBES);
const stCy = new Float32Array(LOBES);
const stIx = new Float32Array(LOBES);
const stIy = new Float32Array(LOBES);
const bucketStyle: string[] = new Array(BUCKETS);
let bucketStyleKey = '';

/**
 * Ink for a tone bucket: faint dots a translucent grey, lit ones solid
 * white — near-black ink on the light theme. Size and ink both carry the
 * light, as depth does on the orbs.
 */
function inkFor(bucket: number, dark: boolean): string {
  const s = S_MIN + ((bucket + 0.5) / BUCKETS) * (1 - S_MIN);
  const alpha = 0.1 + 0.9 * Math.pow(s, 1.1);
  const g = dark ? Math.round(190 + 65 * s) : Math.round(110 - 95 * s);
  return `rgba(${g},${g},${g},${alpha.toFixed(3)})`;
}

/** Light to tone: a soft knee, so the core glows without the field saturating into a solid. */
function tone(lum: number): number {
  return lum <= 0 ? 0 : 1 - Math.exp(-1.5 * lum);
}

export function drawDots(st: DotsState, config: VoiceDriverConfig, f: DotsFrame): void {
  const { cw, ch } = f;
  const L = config.layers;
  const dark = config.theme === 'dark';
  const sc = Math.sqrt(Math.max(0.05, config.scale));
  const texture = Math.max(0, Math.min(1, config.texture));
  const motion = config.reducedMotion ? 0 : 1;
  const t = f.t * motion;

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

  // ── Lattice ──────────────────────────────────────────────────────────
  let gap = GAP * sc * Math.max(0.3, config.dotGap);
  gap = Math.max(gap, Math.sqrt((cw * ch) / MAX_DOTS));
  // Dot radii: the faintest is a fixed pin, the brightest a share of the
  // spacing, so a denser screen keeps its dots from merging.
  const sizeMul = Math.max(0.1, config.dotSize);
  const rMin = R_MIN * sc * sizeMul;
  const rPeak = R_PEAK * gap * sizeMul;
  const rimInset = Math.max(1, 1.4 * sc * sizeMul);
  const key = `${cw}|${ch}|${gap.toFixed(3)}|${config.radius}|${rimInset.toFixed(2)}`;
  if (st.key !== key) {
    buildLattice(st, cw, ch, gap, config.radius, rimInset);
    st.key = key;
  }

  // ── This frame's shapes ─────────────────────────────────────────────
  const { w, h, mw, lift, glow } = f;
  const bx = f.bx;
  const by = f.by;
  // The ceiling ellipses every layer is masked to.
  const imx = 170 * config.rangeWidth * w * mw;
  const imy = 64 * config.rangeHeight * h + lift;
  const bmx = 200 * config.rangeWidth * w * mw;
  const bmy = 130 * config.rangeHeight * h + lift;
  const iMx = 1 / Math.max(1, imx);
  const iMy = 1 / Math.max(1, imy);
  const bMx = 1 / Math.max(1, bmx);
  const bMy = 1 / Math.max(1, bmy);
  const fade = Math.max(40, Math.min(95, 70 * L.softness)) / 100;
  const bFade = Math.min(95, fade * 100 + 2) / 100;
  const fade2 = fade * fade;
  const bFade2 = bFade * bFade;
  const bloomAlpha = dark ? 0.9 : 0.7;
  const gw = L.glowWidth;
  const gh = L.glowHeight;
  for (let i = 0; i < LOBES; i++) {
    const lobe = voiceLobes[i];
    const amp = Math.max(0.001, f.lobeL[i]);
    inCx[i] = f.lobeX[i];
    inCy[i] = f.ch + f.lobeY[i];
    inIx[i] = 1 / Math.max(0.5, lobe.w * gw * 0.9 * L.innerScale * w);
    inIy[i] = 1 / Math.max(0.5, lobe.h * gh * 0.9 * L.innerScale * L.innerHeight * h * amp);
    blIx[i] = 1 / Math.max(0.5, lobe.w * gw * 1.15 * L.bloomScale * w);
    blIy[i] = 1 / Math.max(0.5, lobe.h * gh * 1.5 * L.bloomScale * L.bloomHeight * h * amp);
    stCy[i] = f.ch + 2 * config.scale + f.lobeY[i];
    stIx[i] = 1 / Math.max(0.5, lobe.w * gw * L.strokeScale * w);
    stIy[i] = 1 / Math.max(0.5, lobe.h * gh * L.strokeScale * h * amp);
  }
  // The hot spot on the edge, under the stroke.
  const hlIx = 1 / Math.max(0.5, 30 * L.coreSize * w);
  const hlIy = 1 / Math.max(0.5, 30 * L.coreSize * h);
  const hlY = by + 2 * config.scale;

  // The layer weights, balanced so the core reads bright while most of the
  // field stays fine — a halftone of the light, not a pile of it.
  const gain = glow * L.brightness;
  const innerW = 1.0 * L.innerOpacity;
  const bloomW = 0.42 * L.bloomOpacity;
  const strokeW = 0.85 * L.strokeOpacity;

  // The band line. The field swells softly around it; the line itself is
  // drawn as its own dotted curves below.
  const pts = f.pts;
  let bandA = 0;
  let bx0 = 0;
  let bx1 = 0;
  let bStep = 1;
  let haloS = 1;
  let split = 0;
  let endFade = 0.18;
  let bw = 1;
  if (pts && pts.length > 1) {
    bandA = Math.min(1, 0.6 * config.bandStrength * f.bendA);
    bx0 = pts[0][0];
    bx1 = pts[pts.length - 1][0];
    bStep = (bx1 - bx0) / (pts.length - 1) || 1;
    bw = config.bandWidth * (1 + 0.35 * f.level);
    haloS = 1 / Math.max(2, 7 * bw);
    split = (4 + 12 * config.bandAberration * (0.35 + 0.65 * f.level)) * config.scale;
    endFade = config.bandTail > 0 ? 0.015 : 0.18;
  }
  const bandY = (x: number): number => {
    const u = (x - bx0) / bStep;
    const i = Math.max(0, Math.min(pts!.length - 2, Math.floor(u)));
    const k = Math.max(0, Math.min(1, u - i));
    return pts![i][1] + (pts![i + 1][1] - pts![i][1]) * k;
  };
  const warpAmt =
    config.distortion > 0 && pts ? config.distortion * 9 * config.scale * (0.15 + 0.85 * f.eff) * f.warp * motion : 0;

  // The texture: soft streaks of light stretched along the flow — the
  // lobes' sideways travel, drawn as grain — carried by it and rising
  // slowly, like heat.
  const iCellX = 0.55 / (TEXTURE_CELL * sc);
  const iCellY = 1.5 / (TEXTURE_CELL * sc);
  const drift = f.drift * motion;
  const rise = t * 4 * sc;
  const texAmp = 1.1 * texture;
  // The ripple: a slow displacement field the flow carries through the
  // screen. Neighbours move together, so it reads as fabric, not jitter.
  const iRipple = 1 / (RIPPLE_CELL * sc);
  const ripple = 0.34 * gap * texture * motion;

  // Rows above the tallest mask carry no light.
  const top = Math.min(by - bmy, by - imy) - gap;

  let out = 0;
  const outX = st.outX;
  const outY = st.outY;
  const outR = st.outR;
  const outB = st.outB;
  const cap = outX.length;
  const bucketScale = BUCKETS / (1 - S_MIN);

  const emit = (x: number, y: number, s: number, r: number): void => {
    if (s < S_MIN || out >= cap) return;
    let b = Math.floor((Math.min(s, 0.99999) - S_MIN) * bucketScale);
    if (b < 0) b = 0;
    outX[out] = x;
    outY[out] = y;
    outR[out] = r;
    outB[out] = b;
    out++;
  };
  const radius = (s: number, peak: number): number => rMin + (peak - rMin) * Math.pow(s, 0.75);

  // ── The field ────────────────────────────────────────────────────────
  const n = st.n;
  const PX = st.px;
  const PY = st.py;
  for (let i = 0; i < n; i++) {
    const baseY = PY[i];
    if (baseY < top) break;
    const baseX = PX[i];
    let x = baseX;
    let y = baseY;
    if (ripple > 0) {
      const rx = (baseX - drift) * iRipple;
      const ry = baseY * iRipple;
      x += (vnoise(rx + t * 0.21, ry + 3.7) - 0.5) * 2 * ripple;
      y += (vnoise(rx + 9.1, ry - t * 0.17) - 0.5) * 2 * ripple;
    }

    // The ceiling ellipses: outside both, nothing is lit.
    let dx = (x - bx) * iMx;
    let dy = (y - by) * iMy;
    const ti = Math.sqrt(dx * dx + dy * dy);
    dx = (x - bx) * bMx;
    dy = (y - by) * bMy;
    const tb = Math.sqrt(dx * dx + dy * dy);
    if (ti >= 1 && tb >= 1) continue;

    // Below the band line the glow warps sideways, as the distortion does.
    const onLine = pts !== null && x >= bx0 && x <= bx1;
    let lineY = 0;
    if (onLine) {
      lineY = bandY(x);
      if (warpAmt > 0 && y > lineY) x += (vnoise(y * 0.09 + 3.1, t * 0.7 + 1.3) - 0.5) * 2 * warpAmt;
    }

    let inner = 1;
    let bloom = 1;
    for (let k = 0; k < LOBES; k++) {
      const ex = x - inCx[k];
      const ey = y - inCy[k];
      let qx = ex * inIx[k];
      let qy = ey * inIy[k];
      let q = qx * qx + qy * qy;
      if (q < fade2) inner *= 1 - 0.46 * (1 - Math.sqrt(q) / fade);
      qx = ex * blIx[k];
      qy = ey * blIy[k];
      q = qx * qx + qy * qy;
      if (q < bFade2) bloom *= 1 - bloomAlpha * (1 - Math.sqrt(q) / bFade);
    }
    let lum = gain * (innerW * (1 - inner) * innerMask(ti) + bloomW * (1 - bloom) * bloomMask(tb));
    if (texAmp > 0) {
      const nz = fbm((x - drift) * iCellX, (y + rise) * iCellY);
      lum *= Math.max(0.1, 1 + texAmp * (nz - 0.5) * 2);
    }
    if (bandA > 0 && onLine) {
      const u = (x - bx0) / (bx1 - bx0);
      const d = (y - lineY) * haloS;
      lum += 0.32 * bandA * smoothstep(0, endFade, u) * smoothstep(0, endFade, 1 - u) * Math.exp(-d * d);
    }
    const s = tone(lum);
    emit(x, y, s, radius(s, rPeak));
  }

  // ── The edge: dots along the outline where the stroke would be ──────
  if (strokeW > 0) {
    const rn = st.rimN;
    const RX = st.rimX;
    const RY = st.rimY;
    for (let i = 0; i < rn; i++) {
      const x = RX[i];
      const y = RY[i];
      if (y < top) continue;
      let dx = (x - bx) * iMx;
      let dy = (y - by) * iMy;
      const tm = Math.sqrt(dx * dx + dy * dy);
      if (tm >= 1) continue;
      let stroke = 1;
      for (let k = 0; k < LOBES; k++) {
        const qx = (x - inCx[k]) * stIx[k];
        const qy = (y - stCy[k]) * stIy[k];
        const q = qx * qx + qy * qy;
        if (q < fade2) stroke *= 1 - (1 - Math.sqrt(q) / fade);
      }
      dx = (x - bx) * hlIx;
      dy = (y - hlY) * hlIy;
      const hl = highlight(Math.sqrt(dx * dx + dy * dy));
      const s = tone(gain * strokeW * Math.min(1, 1 - stroke + hl) * strokeMask(tm));
      emit(x, y, s, radius(s, rPeak * 0.72));
    }
  }

  // ── The band: three dotted curves, the ridge and its two fringes ─────
  // Resampled along the line's length, so the dots sit evenly on the curve
  // the way the orbs' rings do. The fringes stand where the glow's
  // chromatic split puts its red and blue edges.
  if (bandA > 0.01 && pts) {
    const dxSplit = 0.25 * split;
    const curves: ReadonlyArray<readonly [number, number, number, number]> = [
      // [offset x, offset y, weight, spacing as a share of the gap]
      [0, 0, 1, 0.85],
      [dxSplit, -split, 0.5, 1.1],
      [-dxSplit, split, 0.5, 1.1],
    ];
    for (const [ox, oy, weight, spacing] of curves) {
      const step = gap * spacing;
      // Never wider than a third of the spacing: the curve stays a row of
      // dots rather than closing into a stroke.
      const ridgePeak = Math.min(0.34 * step, rPeak * Math.min(1.3, 0.85 + 0.2 * bw)) * (weight < 1 ? 0.85 : 1);
      let carry = 0;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1];
        const [cx2, cy2] = pts[i];
        const seg = Math.hypot(cx2 - ax, cy2 - ay);
        let d = carry;
        while (d < seg) {
          const k = d / seg;
          const x = ax + (cx2 - ax) * k + ox;
          const y = ay + (cy2 - ay) * k + oy;
          const u = (x - ox - bx0) / (bx1 - bx0);
          const ends = smoothstep(0, endFade, u) * smoothstep(0, endFade, 1 - u);
          if (ends > 0 && x > -gap && x < cw + gap) {
            const s = tone(1.6 * bandA * weight * ends * (0.7 + 0.3 * glow));
            emit(x, y, s, radius(s, ridgePeak));
          }
          d += step;
        }
        carry = d - seg;
      }
    }
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
