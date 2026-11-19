import { voiceLobes } from './styles';
import type { VoiceDriverConfig } from './voiceDriver';
import type { VoicePixelKit } from './look';

/**
 * The pixel engine — `look="dither"`, and the pixel looks that plug in
 * (`VoicePixelLook`, see look.ts).
 *
 * The glow itself, sampled on a grid instead of painted as gradients: the
 * same lobes in the same places, moving with the same voice, flow and
 * gathered beam, in the same palette with the same hue drift. Each frame the
 * driver hands over what it writes as custom properties for the glow; this
 * evaluates the stylesheet's lobe gradients and its range mask at each cell.
 *
 * - dither: small square pixels, each on or off by a 4×4 ordered dither of
 *   the glow's brightness, in its blended colour cut to a few levels; the
 *   pixels left off still show, faintly, as a grid.
 * - a plugged-in look paints its own cells through a `VoicePixelKit`: the
 *   same sampling, colour, magnet, dust and flying pixels.
 *
 * Both glow: every frame the picture is copied at a quarter of its size onto
 * a second canvas beneath it, which the stylesheet blurs into a halo of its
 * own colours (a CSS blur, so WebKit, which has no canvas filter, gets it too).
 */

const DPR_MAX = 2;
/** Cell pitch at scale 1, px. */
const DITHER_CELL = 3.2;
/** Colour levels per channel (the ordered dither spreads the steps between them). */
const DITHER_LEVELS = 6;

/** A fixed 0–1 value per cell, so a cell's choices hold from frame to frame. */
function hash(c: number, r: number): number {
  let h = Math.imul(c, 0x27d4eb2d) ^ Math.imul(r, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** 4×4 Bayer matrix, as thresholds in (0, 1). */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);

/** The halo canvas's size against the picture's. */
const GLOW_DOWNSCALE = 4;
/** The faint grid of pixels left off, as a share of a lit pixel's opacity. */
const GHOST_ALPHA = 0.16;

export interface PixelState {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** The halo: a small copy of the picture, blurred by the stylesheet. */
  glowCanvas: HTMLCanvasElement | null;
  glowCtx: CanvasRenderingContext2D | null;
  /** The dither's magnet: each cell's offset from its place and its
   *  velocity, px — a spring per pixel, rebuilt when the grid changes. */
  magnetKey: string;
  mx: Float32Array;
  my: Float32Array;
  mvx: Float32Array;
  mvy: Float32Array;
  /** The lit cells of the last frame — where, how big, how bright, what
   *  colour (0xRRGGBB) — for the pixels that fly off when the effect closes. */
  litX: Float32Array;
  litY: Float32Array;
  litS: Float32Array;
  litV: Float32Array;
  litC: Int32Array;
  /** Each lit pixel's cell in the grid (row × cols + column). */
  litM: Int32Array;
  litN: number;
  /** Processing's dust: per cell, what the travelling beam left there
   *  (0–1, fading) and its colour; `dustAny` while anything is left. */
  dust: Float32Array;
  dustC: Int32Array;
  dustCols: number;
  dustAny: boolean;
  /** Processing's beam: its centre last frame and its smoothed speed, px/s. */
  travelX: number;
  travelV: number;
}

/** Cells whose pixels have flown off, per surface canvas: the picture
 *  leaves them out until the flight is over, so the pixel that flies is the
 *  one that was there, not a copy over it. Keyed by the canvas because the
 *  close re-registers the instance (a fresh state) mid-flight. */
const liftedCells = new WeakMap<HTMLCanvasElement, Map<number, number>>();

/** The cells still out of the picture this frame, or null. Each cell has
 *  its own time: a pixel flying in lands back into its cell on arrival. */
function lifted(st: PixelState): Set<number> | null {
  const l = liftedCells.get(st.canvas);
  if (!l) return null;
  const now = performance.now();
  const out = new Set<number>();
  l.forEach((until, cell) => {
    if (now > until) l.delete(cell);
    else out.add(cell);
  });
  if (!l.size) liftedCells.delete(st.canvas);
  return out.size ? out : null;
}

function lift(st: PixelState, cell: number, until: number): void {
  let l = liftedCells.get(st.canvas);
  if (!l) liftedCells.set(st.canvas, (l = new Map()));
  l.set(cell, Math.max(l.get(cell) ?? 0, until));
}

function pushLit(st: PixelState, x: number, y: number, s: number, v: number, rgb: number, m = -1): void {
  if (st.litN >= st.litX.length) {
    const n = Math.max(1024, st.litX.length * 2);
    const grow = <T extends Float32Array | Int32Array>(a: T, make: (n: number) => T): T => {
      const b = make(n);
      b.set(a);
      return b;
    };
    st.litX = grow(st.litX, (k) => new Float32Array(k));
    st.litY = grow(st.litY, (k) => new Float32Array(k));
    st.litS = grow(st.litS, (k) => new Float32Array(k));
    st.litV = grow(st.litV, (k) => new Float32Array(k));
    st.litC = grow(st.litC, (k) => new Int32Array(k));
    st.litM = grow(st.litM, (k) => new Int32Array(k));
  }
  const i = st.litN++;
  st.litX[i] = x;
  st.litY[i] = y;
  st.litS[i] = s;
  st.litV[i] = v;
  st.litC[i] = rgb;
  st.litM[i] = m;
}

// ── Magnet ──────────────────────────────────────────────────────────────
// The field stays put; only the few lit pixels nearest the pointer leave
// their places and fly toward it, the nearest furthest, each a small mass on
// a spring. As the pointer moves on, a new few are caught and the old ones
// spring home with a little overshoot. A pixel's mass varies a hair, so no
// two travel alike.

/** How far from the pointer a pixel can be caught at full strength, at scale 1, px. */
const MAGNET_REACH = 140;
/** At most this many pixels fly at once (at full `pixelMagnet`). */
const MAGNET_COUNT = 16;
/** Share of the way to the pointer the nearest caught pixel travels. */
const MAGNET_PULL = 0.95;
/** Spring stiffness (per unit mass) and damping — a little under critical, so it settles with a wobble. */
const MAGNET_K = 170;
const MAGNET_DAMP = 13;

export function createPixelState(canvas: HTMLCanvasElement, glowCanvas: HTMLCanvasElement | null): PixelState | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const glowCtx = glowCanvas?.getContext('2d') ?? null;
  const none = new Float32Array(0);
  return {
    canvas, ctx, glowCanvas: glowCtx ? glowCanvas : null, glowCtx,
    magnetKey: '', mx: none, my: none, mvx: none, mvy: none,
    litX: none, litY: none, litS: none, litV: none, litC: new Int32Array(0), litM: new Int32Array(0), litN: 0,
    dust: none, dustC: new Int32Array(0), dustCols: 0, dustAny: false,
    travelX: NaN, travelV: 0,
  };
}

/** One frame of the glow, as the driver writes it for the stylesheet. */
export interface PixelFrame {
  cw: number;
  ch: number;
  /** Each lobe's centre (element px), its corner lift and its amplitude (`--vb-lN`). */
  lobeX: Float32Array;
  lobeY: Float32Array;
  lobeL: Float32Array;
  /** `--vb-w`, `--vb-h`, `--vb-mw`, `--vb-bh`, `--vb-cy`, `--vb-glow`. */
  w: number;
  h: number;
  maskWidth: number;
  lift: number;
  cy: number;
  glow: number;
  /** The beam's centre, element px. */
  beamX: number;
  /** The hue rotation in degrees: the theme's base, the host's `--voice-hue-base` and the drift. */
  hue: number;
  /** The band line (element px, left to right) and how lit it is, 0–1;
   *  its fringes' offset, px; the voice level, which thickens it. */
  band: Array<[number, number]> | null;
  bandAlpha: number;
  bandSplit: number;
  level: number;
  /** Seconds since the last frame (0 while paused). */
  dt: number;
  /** The pointer over the host, element px, or null when it is away. */
  pointer: { x: number; y: number } | null;
  /** Processing's gather, 0–1: the beam travelling leaves dust. */
  gather?: number;
}

// Per-frame scratch.
const LOBES = voiceLobes.length;
const lobeRgb = new Float32Array(LOBES * 3);
const lobeIrx = new Float32Array(LOBES);
const lobeIry = new Float32Array(LOBES);
const weights = new Float32Array(LOBES);
/** Each lobe's pull on the colour: a wide, soft falloff, as the glow's blur
 *  runs its colours together far past where each one is bright. */
const hues = new Float32Array(LOBES);
/** How wide the colour pull reaches, in each lobe's own ellipse radii. */
const HUE_REACH = 0.62;
/** Saturation given back after the blend, which greys colours that mix. */
const HUE_VIVID = 1.35;

// The band, as the cells see it: its line, resampled per frame, its colours
// (core, the fringe above, the one below) through the glow's filter, and
// the light it gives the last sampled point.
const bandRgb = new Float32Array(9);
let bandX0 = 0;
let bandStep = 1;
let bandYs = new Float32Array(0);
let bandLen = 0;
let bandAlpha = 0;
let bandSigma = 1;
let bandDy = 0;
let bandEnds = 0.18;
/** The band's light at the last sampled point, 0–1, and its colour's pull on each of its three strands. */
let bandV = 0;
const bandPull = new Float32Array(3);
/** The dither's band pixels, by colour, kept for the halo, so the band
 *  line glows stronger than the field around it. */
const ditherBand = new Map<number, Path2D>();
let ditherStyle: (key: number) => string = () => '';
/** Below this band light a dither pixel is not part of the band's glow. */
const BAND_GLOW_MIN = 0.12;
/** Extra passes of the band into the dither's halo. */
const BAND_GLOW_PASSES = 2;
/** How much a dither pixel on the band line grows with its light. */
const BAND_GROW = 0.6;
/** How far the band's colour wins over the lobes' where it is lit. */
const BAND_PULL = 2.5;

// ── Colour: the stylesheet's filter chain (hue-rotate, brightness, saturate) ──

function hueMatrix(deg: number): number[] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
    0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283,
    0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
  ];
}

function saturateMatrix(s: number): number[] {
  return [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ];
}

function apply(m: number[], r: number, g: number, b: number, out: Float32Array, at: number): void {
  out[at] = Math.min(1, Math.max(0, m[0] * r + m[1] * g + m[2] * b));
  out[at + 1] = Math.min(1, Math.max(0, m[3] * r + m[4] * g + m[5] * b));
  out[at + 2] = Math.min(1, Math.max(0, m[6] * r + m[7] * g + m[8] * b));
}

/** The band for this frame: its line resampled evenly across, its width
 *  and fringes as the band canvas draws them, its colours filtered. */
function prepareBand(config: VoiceDriverConfig, f: PixelFrame): void {
  bandAlpha = 0;
  const pts = f.band;
  if (!pts || pts.length < 2 || config.bandWidth <= 0) return;
  bandAlpha = Math.min(1, 0.6 * config.bandStrength * f.bandAlpha) * 0.85;
  if (bandAlpha <= 0.004) return;
  if (bandYs.length < pts.length) bandYs = new Float32Array(pts.length);
  bandLen = pts.length;
  bandX0 = pts[0][0];
  bandStep = (pts[pts.length - 1][0] - bandX0) / (pts.length - 1) || 1;
  for (let i = 0; i < pts.length; i++) bandYs[i] = pts[i][1];
  // The ridge's soft width, from the band canvas's stacked strokes and blur.
  bandSigma = Math.max(0.9, 1.5 * config.bandWidth * (1 + 0.35 * f.level));
  // The fringes sit closer than the band canvas's, which a blur merges back.
  bandDy = f.bandSplit * 0.55;
  bandEnds = config.bandTail > 0 ? 0.015 : 0.18;
  const h = hueMatrix(f.hue);
  const sat = saturateMatrix(config.saturation);
  const b = config.layers.brightness;
  const tmp = new Float32Array(3);
  const strands = [config.bandColors.core, config.bandColors.above, config.bandColors.below];
  for (let j = 0; j < 3; j++) {
    const [r, g, bl] = strands[j].split(',').map((v) => Number(v) / 255);
    apply(h, r, g, bl, tmp, 0);
    apply(sat, Math.min(1, tmp[0] * b), Math.min(1, tmp[1] * b), Math.min(1, tmp[2] * b), bandRgb, j * 3);
  }
}

function lobeColours(config: VoiceDriverConfig, hue: number): void {
  const h = hueMatrix(hue);
  const sat = saturateMatrix(config.saturation);
  const b = config.layers.brightness;
  const tmp = new Float32Array(3);
  for (let i = 0; i < LOBES; i++) {
    const [r, g, bl] = config.palette[i % config.palette.length];
    apply(h, r / 255, g / 255, bl / 255, tmp, 0);
    apply(sat, Math.min(1, tmp[0] * b), Math.min(1, tmp[1] * b), Math.min(1, tmp[2] * b), lobeRgb, i * 3);
  }
}

/**
 * The glow at one point: each lobe's gradient (colour at its centre, gone
 * at `fade` of its ellipse), joined as light joins, inside the range mask.
 * Writes each lobe's share into `weights`; returns the brightness, 0–1.
 */
/** Processing's lean: the travelling beam is a comet, its light pushed to
 *  the side it is heading — brighter ahead of its centre, fading behind
 *  (where the dust takes over). `leanDir` is -1 (left) … 1 (right), 0 at a
 *  turn or when not processing. */
let leanCx = 0;
let leanDir = 0;
/** The beam's half-width (where its core light halves), and the length
 *  of the softening behind the front, px. */
let leanW = 0;
let leanTail = 1;
/** How strongly the beam turns into a comet at full speed, 0–1. */
const LEAN = 0.5;

/** The lobes' light at a point (no mask): fills `weights` and `hues`. */
/** The dome: the field's height falls off from the centre of the host
 *  toward its sides (1 + domeK · u², u the distance from centre, -1…1), so
 *  the pixels always stand highest in the middle. */
let domeK = 0;
let domeCx = 0;
let domeIhw = 0;

function domeAt(x: number): number {
  if (domeK <= 0) return 1;
  const u = (x - domeCx) * domeIhw;
  return 1 + domeK * u * u;
}

function lobeField(x: number, y: number, f: PixelFrame, fade: number): number {
  let dark = 1;
  const dome = domeAt(x);
  for (let i = 0; i < LOBES; i++) {
    const dx = (x - f.lobeX[i]) * lobeIrx[i];
    const dy = (y - (f.ch + f.lobeY[i])) * lobeIry[i] * dome;
    const d2 = dx * dx + dy * dy;
    const d = Math.sqrt(d2) / fade;
    const v = d < 1 ? 1 - d : 0;
    weights[i] = v;
    hues[i] = f.lobeL[i] > 0.01 ? Math.exp(-d2 / (HUE_REACH * HUE_REACH)) * Math.min(1, f.lobeL[i]) : 0;
    dark *= 1 - v * 0.92;
  }
  return 1 - dark;
}

function sample(x: number, y: number, f: PixelFrame, fade: number, mrx: number, mry: number): number {
  // Processing's comet. The heaviest light sits at the leading edge and
  // softens steadily behind it: ahead of the front the glow drops off fast
  // (its own falloff, squeezed); from the front back, every column reads
  // the beam's full core and fades with the distance — so the bright end
  // is the end it is heading to, and the rest trails off into the dust.
  let xs = x;
  let taper = 1;
  if (leanDir !== 0) {
    const a = Math.abs(leanDir) * LEAN;
    const front = leanCx + leanDir * leanW * 0.85;
    const u = (x - front) * leanDir; // > 0 ahead of the front
    let cx: number;
    let ct: number;
    if (u > 0) {
      cx = leanCx + leanDir * u * 4;
      ct = 1;
    } else {
      cx = leanCx;
      ct = Math.pow(Math.max(0, 1 + u / leanTail), 1.35);
    }
    xs = x + (cx - x) * a;
    taper = 1 + (ct - 1) * a;
  }
  // The band: not masked, its tails reach the corners. Read through the
  // comet's warp as well, so its swell rides the front, not the middle.
  sampleBand(xs, y);
  if (taper < 1) {
    bandV *= taper;
    bandPull[0] *= taper;
    bandPull[1] *= taper;
    bandPull[2] *= taper;
  }
  // The range the glow is masked to: solid at the centre, half at 45%, gone
  // at the rim. Read through the comet's warp too, or the mask, centred on
  // the lobes, would dim the very front the comet makes heaviest.
  const mx = (xs - f.beamX) / mrx;
  const my = ((y - (f.ch + f.cy)) / mry) * domeAt(xs);
  const md = Math.sqrt(mx * mx + my * my);
  if (md >= 1) return 0;
  const mask = md < 0.45 ? 1 - (0.5 * md) / 0.45 : 0.5 * (1 - (md - 0.45) / 0.55);
  return lobeField(xs, y, f, fade) * mask * taper;
}

/** The band's light at a point: a soft ridge on its line, its fringes split
 *  above and below, fading in at its ends as the glow's band does. */
function sampleBand(x: number, y: number): void {
  bandV = 0;
  bandPull[0] = bandPull[1] = bandPull[2] = 0;
  if (bandAlpha <= 0.004 || bandLen < 2) return;
  const u = (x - bandX0) / bandStep;
  if (u < 0 || u > bandLen - 1) return;
  const k = Math.min(bandLen - 2, Math.floor(u));
  const ly = bandYs[k] + (bandYs[k + 1] - bandYs[k]) * (u - k);
  const t = u / (bandLen - 1);
  const ends = Math.min(1, Math.min(t, 1 - t) / bandEnds);
  const a = bandAlpha * ends;
  if (a <= 0.004) return;
  const s2 = 1 / (bandSigma * bandSigma);
  const dc = y - ly;
  const da = y - (ly - bandDy);
  const db = y - (ly + bandDy);
  const core = Math.exp(-dc * dc * s2);
  const above = Math.exp(-da * da * s2) * 0.6;
  const below = Math.exp(-db * db * s2) * 0.6;
  bandPull[0] = core * a;
  bandPull[1] = above * a;
  bandPull[2] = below * a;
  bandV = Math.min(1, Math.max(core, above, below) * a);
}

/** The colours at the last sampled point, blended by each lobe's light —
 *  linear, so one hue runs into the next as in the glow. 0–1 into `mix`;
 *  false where no lobe reaches. */
const mix = new Float32Array(3);
function blend(): boolean {
  let sw = 0, r = 0, g = 0, b = 0;
  for (let i = 0; i < LOBES; i++) {
    const k = hues[i];
    sw += k;
    r += lobeRgb[i * 3] * k;
    g += lobeRgb[i * 3 + 1] * k;
    b += lobeRgb[i * 3 + 2] * k;
  }
  // The band's strands, which win where the band is lit.
  for (let j = 0; j < 3; j++) {
    const k = bandPull[j] * BAND_PULL;
    if (k <= 0) continue;
    sw += k;
    r += bandRgb[j * 3] * k;
    g += bandRgb[j * 3 + 1] * k;
    b += bandRgb[j * 3 + 2] * k;
  }
  if (sw <= 1e-6) return false;
  r /= sw;
  g /= sw;
  b /= sw;
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  mix[0] = Math.min(1, Math.max(0, l + (r - l) * HUE_VIVID));
  mix[1] = Math.min(1, Math.max(0, l + (g - l) * HUE_VIVID));
  mix[2] = Math.min(1, Math.max(0, l + (b - l) * HUE_VIVID));
  return true;
}

export function drawPixels(st: PixelState, config: VoiceDriverConfig, f: PixelFrame): void {
  latestState.set(st.canvas, st);
  const { cw, ch } = f;
  const dpr = Math.min(DPR_MAX, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const pw = Math.round(cw * dpr);
  const ph = Math.round(ch * dpr);
  const { canvas, ctx } = st;
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);

  lobeColours(config, f.hue);
  prepareBand(config, f);
  const L = config.layers;
  // The bloom's lobe geometry — the widest layer, where the colours run
  // into each other — so the cells see the glow as it reads, not its rim.
  const sw = L.glowWidth * 1.15 * L.bloomScale;
  const sh = L.glowHeight * 1.5 * L.bloomScale * L.bloomHeight;
  for (let i = 0; i < LOBES; i++) {
    const lobe = voiceLobes[i];
    lobeIrx[i] = 1 / Math.max(1, Math.round(lobe.w * sw) * f.w);
    lobeIry[i] = 1 / Math.max(1, Math.round(lobe.h * sh) * f.h * Math.max(0.02, f.lobeL[i]));
  }
  const fade = Math.max(40, Math.min(95, 70 * L.softness)) / 100;
  const mrx = Math.max(1, 170 * config.rangeWidth * f.w * f.maskWidth);
  const mry = Math.max(1, 64 * config.rangeHeight * f.h + f.lift);
  const presence = Math.min(1, f.glow * 1.15);
  domeK = Math.max(0, config.pixelDome) * 2.2;
  domeCx = cw / 2;
  domeIhw = 2 / Math.max(1, cw);
  // The beam's centre (its lobes, by light) and how fast it is going: the
  // light leans toward where it is heading, fully at speed, not at a turn.
  let sumL = 0;
  let sumX = 0;
  for (let i = 0; i < LOBES; i++) {
    sumL += f.lobeL[i];
    sumX += f.lobeX[i] * f.lobeL[i];
  }
  const cx = sumL > 1e-4 ? sumX / sumL : cw / 2;
  const dt = Math.max(0, f.dt);
  if (st.travelX === st.travelX && dt > 0) {
    const vNow = (cx - st.travelX) / dt;
    st.travelV += (vNow - st.travelV) * (1 - Math.exp(-dt / 0.08));
  }
  st.travelX = cx;
  const gather = f.gather ?? 0;
  leanCx = cx;
  // Full lean from about a third of the host's width per second.
  leanDir = gather > 0.02 && !config.reducedMotion ? Math.max(-1, Math.min(1, st.travelV / (cw * 0.33))) * gather : 0;
  if (leanDir !== 0) {
    // Measure the beam where it is: walk out from its centre, at its
    // height, until its light halves.
    let sumY = 0;
    for (let i = 0; i < LOBES; i++) sumY += f.lobeY[i] * f.lobeL[i];
    const yc = f.ch + (sumL > 1e-4 ? sumY / sumL : 0);
    const peak = lobeField(cx, yc, f, fade);
    let half = 8;
    if (peak > 0.01) {
      for (let d = 4; d < cw / 2; d += 4) {
        if (lobeField(cx + d, yc, f, fade) + lobeField(cx - d, yc, f, fade) < peak) break;
        half = d;
      }
    }
    leanW = half;
    leanTail = Math.max(24, half * 3.2);
  }
  let top = Math.max(0, f.ch + f.cy - mry);
  // The band can stand above the range, and its tails rise into the corners.
  if (bandAlpha > 0.004) for (let i = 0; i < bandLen; i++) top = Math.min(top, bandYs[i] - 3 * bandSigma - bandDy);
  top = Math.max(0, top);

  const plugin = config.lookPlugin?.kind === 'pixel' ? config.lookPlugin : null;
  if (plugin) plugin.paint(kitFor(st, ctx, config, f, fade, mrx, mry, presence, top));
  else drawDither(st, ctx, config, f, fade, mrx, mry, presence, top);

  // The halo: the picture, small, for the stylesheet to blur.
  const { glowCanvas, glowCtx } = st;
  if (glowCanvas && glowCtx) {
    const gw = Math.max(1, Math.ceil(cw / GLOW_DOWNSCALE));
    const gh = Math.max(1, Math.ceil(ch / GLOW_DOWNSCALE));
    if (glowCanvas.width !== gw || glowCanvas.height !== gh) {
      glowCanvas.width = gw;
      glowCanvas.height = gh;
    }
    glowCtx.clearRect(0, 0, gw, gh);
    if (config.pixelGlow > 0) {
      glowCtx.imageSmoothingEnabled = true;
      glowCtx.imageSmoothingQuality = 'high';
      glowCtx.drawImage(canvas, 0, 0, gw, gh);
      // A plugged-in look can feed its halo more than once (sparse cells
      // read a weaker halo than the dither's dense pixels).
      if (plugin) {
        const passes = Math.max(1, Math.min(4, Math.round(plugin.halo ?? 1)));
        if (passes > 1) {
          glowCtx.globalCompositeOperation = 'lighter';
          for (let pass = 1; pass < passes; pass++) glowCtx.drawImage(canvas, 0, 0, gw, gh);
          glowCtx.globalCompositeOperation = 'source-over';
        }
      } else if (ditherBand.size) {
        // The dither's band, added again on its own, so its line blooms
        // without lifting the rest of the field.
        glowCtx.save();
        glowCtx.setTransform(gw / cw, 0, 0, gh / ch, 0, 0);
        glowCtx.globalCompositeOperation = 'lighter';
        for (let pass = 0; pass < BAND_GLOW_PASSES; pass++) {
          ditherBand.forEach((p, key) => {
            glowCtx.fillStyle = ditherStyle(key);
            glowCtx.fill(p);
          });
        }
        glowCtx.restore();
      }
    }
  }
}

// ── Processing's dust ───────────────────────────────────────────────────
// While processing, the travelling beam leaves a trail behind it, like the
// trail of an aeroplane: the cells it lit keep a charge that fades, and a
// cell shows as a speck while its charge is above its own fixed threshold —
// so the trail thins out pixel by pixel as it fades, densest just behind
// the beam, a few last specks furthest back.

/** How bright a cell must be lit to leave dust. */
const DUST_MIN_V = 0.3;

/** `tau`: seconds for the charge to fall to a third (`pixelDust`), the
 *  tail's length. */
function dustBegin(st: PixelState, cols: number, rows: number, dt: number, tau: number): void {
  const n = cols * rows;
  if (st.dust.length !== n || st.dustCols !== cols) {
    st.dust = new Float32Array(n);
    st.dustC = new Int32Array(n);
    st.dustCols = cols;
    st.dustAny = false;
    return;
  }
  if (!st.dustAny || dt <= 0) return;
  const k = tau > 0 ? Math.exp(-dt / tau) : 0;
  const d = st.dust;
  let any = false;
  for (let i = 0; i < n; i++) {
    if (d[i] <= 0) continue;
    d[i] *= k;
    if (d[i] < 0.02) d[i] = 0;
    else any = true;
  }
  st.dustAny = any;
}

function dustDeposit(st: PixelState, m: number, v: number, gather: number, rgb: number): void {
  if (gather <= 0.05 || v < DUST_MIN_V) return;
  const d = Math.min(1, v * gather);
  if (d > st.dust[m]) {
    st.dust[m] = d;
    st.dustC[m] = rgb;
    st.dustAny = true;
  }
}

/** Draws the cell's speck if its charge is over its threshold; true if drawn. */
function dustDraw(ctx: CanvasRenderingContext2D, st: PixelState, m: number, c: number, r: number, x: number, y: number, size: number): boolean {
  const d = st.dust[m];
  if (!(d > 0)) return false;
  // Thresholds spread over the cells: as the charge falls, fewer pass.
  const th = 0.22 + 0.78 * hash(c + 17, r + 31);
  if (d < th) return false;
  const a = Math.min(1, (d - th) * 5) * 0.9;
  const rgb = st.dustC[m];
  ctx.fillStyle = `rgba(${(rgb >> 16) & 255},${(rgb >> 8) & 255},${rgb & 255},${a.toFixed(3)})`;
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
  return true;
}

// ── Magnet, shared by every pixel look ──────────────────────────────────

interface MagnetFrame {
  px: number;
  py: number;
  steps: number;
  h: number;
}

/** Before a frame: size the springs to the grid, pick the caught few from
 *  last frame's lit pixels (their homes nearest the pointer, within reach),
 *  and split the frame's time into fixed small steps. */
function magnetBegin(st: PixelState, config: VoiceDriverConfig, f: PixelFrame, cols: number, rows: number, cell: number, x0: number, y0: number): MagnetFrame {
  const magnet = config.reducedMotion ? 0 : Math.max(0, Math.min(1, config.pixelMagnet));
  const key0 = `${cols}x${rows}@${cell.toFixed(2)}`;
  if (st.magnetKey !== key0) {
    st.magnetKey = key0;
    st.mx = new Float32Array(cols * rows);
    st.my = new Float32Array(cols * rows);
    st.mvx = new Float32Array(cols * rows);
    st.mvy = new Float32Array(cols * rows);
  }
  const sc = Math.sqrt(Math.max(0.05, config.scale));
  // Stronger reaches further, as well as catching more.
  const reach = MAGNET_REACH * sc * (0.55 + 0.45 * magnet);
  const px = f.pointer && magnet > 0 ? f.pointer.x : NaN;
  const py = f.pointer && magnet > 0 ? f.pointer.y : NaN;
  caught.clear();
  if (px === px) {
    const want = Math.max(1, Math.round(MAGNET_COUNT * magnet));
    const near: Array<[number, number]> = [];
    for (let i = 0; i < st.litN; i++) {
      const m = st.litM[i];
      if (m < 0 || m >= cols * rows) continue;
      const hx = x0 + ((m % cols) + 0.5) * cell;
      const hy = y0 + (Math.floor(m / cols) + 0.5) * cell;
      const d = Math.hypot(px - hx, py - hy);
      if (d > reach) continue;
      if (near.length < want) {
        near.push([d, m]);
        near.sort((a, b) => a[0] - b[0]);
      } else if (d < near[want - 1][0]) {
        near[want - 1] = [d, m];
        near.sort((a, b) => a[0] - b[0]);
      }
    }
    for (let k = 0; k < near.length; k++) {
      const [d, m] = near[k];
      // Nearer and higher-ranked go further; only near the edge of reach
      // does the pull fade (a square, so most of the reach pulls hard).
      const edge = d / reach;
      caught.set(m, (1 - edge * edge) * (1 - (0.35 * k) / Math.max(1, near.length)));
    }
  }
  // Fixed small steps, so the springs behave the same at any frame rate.
  const dt = Math.min(0.05, f.dt);
  const steps = dt > 0 ? Math.max(1, Math.ceil(dt / (1 / 120))) : 0;
  return { px, py, steps, h: steps ? dt / steps : 0 };
}

/** One cell's spring for this frame: its offset from home (x, y), px.
 *  Every cell's spring runs, drawn or not, so a pixel that lights up
 *  mid-pull is already where its neighbours are. */
function magnetCell(st: PixelState, mf: MagnetFrame, m: number, c: number, r: number, x: number, y: number): [number, number] {
  const { mx, my, mvx, mvy } = st;
  let ox = mx[m];
  let oy = my[m];
  const pull = caught.get(m) ?? 0;
  const tx = pull > 0 ? (mf.px - x) * MAGNET_PULL * pull : 0;
  const ty = pull > 0 ? (mf.py - y) * MAGNET_PULL * pull : 0;
  if (mf.steps && (pull > 0.001 || ox !== 0 || oy !== 0 || mvx[m] !== 0 || mvy[m] !== 0)) {
    const mass = 0.8 + 0.4 * hash(c, r);
    const k = MAGNET_K / mass;
    const damp = MAGNET_DAMP / mass;
    let vx = mvx[m];
    let vy = mvy[m];
    const h = mf.h;
    for (let i = 0; i < mf.steps; i++) {
      vx += ((tx - ox) * k - vx * damp) * h;
      vy += ((ty - oy) * k - vy * damp) * h;
      ox += vx * h;
      oy += vy * h;
    }
    // At rest again: snap to zero so the cell stops costing anything.
    if (pull <= 0.001 && Math.abs(ox) + Math.abs(oy) < 0.02 && Math.abs(vx) + Math.abs(vy) < 0.05) {
      ox = oy = vx = vy = 0;
    }
    mx[m] = ox;
    my[m] = oy;
    mvx[m] = vx;
    mvy[m] = vy;
  }
  return [ox, oy];
}

// ── Dither ──────────────────────────────────────────────────────────────

function drawDither(
  st: PixelState,
  ctx: CanvasRenderingContext2D,
  config: VoiceDriverConfig,
  f: PixelFrame,
  fade: number,
  mrx: number,
  mry: number,
  presence: number,
  top: number
): void {
  const { cw, ch } = f;
  const cell = DITHER_CELL * Math.sqrt(Math.max(0.05, config.scale)) * Math.max(0.3, config.pixelSize);
  const size = Math.max(1, cell - Math.max(0.6, cell * 0.22));
  const cols = Math.ceil(cw / cell);
  const rows = Math.ceil(ch / cell);
  const y0 = ch - rows * cell;
  const x0 = (cw - cols * cell) / 2;
  const q = DITHER_LEVELS - 1;
  // One path per quantised colour, for the lit pixels and for the faint
  // grid of the ones left off.
  const paths = new Map<number, Path2D>();
  const ghosts = new Map<number, Path2D>();
  ditherBand.clear();
  const ghostSize = size * 0.42;

  // The magnet: springs per cell and the caught few, read from last
  // frame's lit pixels before this frame's start.
  const mf = magnetBegin(st, config, f, cols, rows, cell, x0, y0);
  dustBegin(st, cols, rows, f.dt, config.pixelDust);
  // No dust left at all when it is turned off.
  const gather = config.pixelDust > 0 ? f.gather ?? 0 : 0;
  const dustSize = size * 0.8;
  st.litN = 0;
  const hole = lifted(st);

  for (let r = rows - 1; r >= 0; r--) {
    const y = y0 + (r + 0.5) * cell;
    if (y + cell < top) break;
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * cell;
      const m = r * cols + c;
      const [ox, oy] = magnetCell(st, mf, m, c, r, x, y);
      // Where the pixel is drawn, and how it swells under the pull.
      const dxp = x + ox;
      const dyp = y + oy;

      const raw = 1 - (1 - sample(x, y, f, fade, mrx, mry) * presence) * (1 - bandV);
      if (raw <= 0.004) {
        dustDraw(ctx, st, m, c, r, x, y, dustSize);
        continue;
      }
      // Lifted, so the glow's soft edges still read as scattered pixels.
      const v = Math.min(1, Math.pow(raw, 0.65) * 1.15);
      const t = BAYER[(r & 3) * 4 + (c & 3)];
      const on = v >= t * 0.92 + 0.03;
      if (!on) {
        // Dust shows where the beam has passed, in place of the faint grid.
        if (dustDraw(ctx, st, m, c, r, x, y, dustSize)) continue;
        if (v < 0.06) continue;
      }
      // The colours blended by their light, as the glow runs them together,
      // then each channel cut to a few levels on the same threshold, so the
      // steps between hues dither instead of banding.
      if (!blend()) continue;
      // Brighter where the glow is strongest, as the glow's own core whitens.
      const lift = Math.max(0, v - 0.7) / 0.3;
      const ch3 = (u: number) => Math.min(q, Math.floor((u + (1 - u) * lift * 0.6) * q + t));
      const key = (ch3(mix[0]) * DITHER_LEVELS + ch3(mix[1])) * DITHER_LEVELS + ch3(mix[2]);
      // A cell whose pixel is in flight: still counted as lit (a flight
      // follows it), but its place in the picture stays empty.
      if (hole && hole.has(m)) {
        if (on) {
          const c8 = (u: number) => Math.round((ch3(u) / q) * 255);
          const s = size * (1 + BAND_GROW * bandV);
          pushLit(st, dxp, dyp, s, Math.max(v, bandV), (c8(mix[0]) << 16) | (c8(mix[1]) << 8) | c8(mix[2]), m);
        }
        continue;
      }
      const into = on ? paths : ghosts;
      let p = into.get(key);
      if (!p) {
        p = new Path2D();
        into.set(key, p);
      }
      // Pixels on the band line swell with its light, up to a little past
      // the cell, so the line reads solid.
      const s = on ? size * (1 + BAND_GROW * bandV) : ghostSize;
      p.rect(dxp - s / 2, dyp - s / 2, s, s);
      if (on && bandV > BAND_GLOW_MIN) {
        let bp = ditherBand.get(key);
        if (!bp) {
          bp = new Path2D();
          ditherBand.set(key, bp);
        }
        bp.rect(dxp - s / 2, dyp - s / 2, s, s);
      }
      if (on) {
        const c8 = (u: number) => Math.round((ch3(u) / q) * 255);
        const rgb = (c8(mix[0]) << 16) | (c8(mix[1]) << 8) | c8(mix[2]);
        pushLit(st, dxp, dyp, s, Math.max(v, bandV), rgb, m);
        dustDeposit(st, m, v, gather, rgb);
      }
    }
  }
  const style = (key: number) => {
    const b = key % DITHER_LEVELS;
    const g = Math.floor(key / DITHER_LEVELS) % DITHER_LEVELS;
    const r = Math.floor(key / (DITHER_LEVELS * DITHER_LEVELS));
    const c = (u: number) => Math.round((u / q) * 255);
    return `rgb(${c(r)},${c(g)},${c(b)})`;
  };
  ditherStyle = style;
  ctx.globalAlpha = GHOST_ALPHA;
  ghosts.forEach((p, key) => {
    ctx.fillStyle = style(key);
    ctx.fill(p);
  });
  ctx.globalAlpha = 1;
  paths.forEach((p, key) => {
    ctx.fillStyle = style(key);
    ctx.fill(p);
  });
}

// ── Plugged-in pixel looks ──────────────────────────────────────────────
// The engine's pieces as a `VoicePixelKit` (look.ts): one object, reused
// every frame, so a look costs nothing to call into.

let kitSt: PixelState | null = null;
let kitF: PixelFrame | null = null;
let kitFade = 1;
let kitMrx = 1;
let kitMry = 1;
let kitPresence = 1;
let kitGather = 0;
let kitMagnet: MagnetFrame = { px: NaN, py: NaN, steps: 0, h: 0 };
let kitHole: Set<number> | null = null;

const kit: VoicePixelKit = {
  ctx: null as unknown as CanvasRenderingContext2D,
  config: null as unknown as VoiceDriverConfig,
  cw: 0,
  ch: 0,
  top: 0,
  lobes: hues,
  rgb: mix,
  light(x, y) {
    return 1 - (1 - sample(x, y, kitF!, kitFade, kitMrx, kitMry) * kitPresence) * (1 - bandV);
  },
  blend,
  hash,
  bayer: (c, r) => BAYER[(r & 3) * 4 + (c & 3)],
  grid(cols, rows, cell, x0, y0) {
    const st = kitSt!;
    const f = kitF!;
    kitMagnet = magnetBegin(st, kit.config, f, cols, rows, cell, x0, y0);
    dustBegin(st, cols, rows, f.dt, kit.config.pixelDust);
    // No dust left at all when it is turned off.
    kitGather = kit.config.pixelDust > 0 ? f.gather ?? 0 : 0;
    st.litN = 0;
    kitHole = lifted(st);
  },
  pull: (m, c, r, x, y) => magnetCell(kitSt!, kitMagnet, m, c, r, x, y),
  away: (m) => kitHole !== null && kitHole.has(m),
  lit(x, y, size, v, rgb, m) {
    pushLit(kitSt!, x, y, size, v, rgb, m);
    if (!(kitHole && kitHole.has(m))) dustDeposit(kitSt!, m, v, kitGather, rgb);
  },
  dust: (m, c, r, x, y, size) => dustDraw(kit.ctx, kitSt!, m, c, r, x, y, size),
};

function kitFor(
  st: PixelState,
  ctx: CanvasRenderingContext2D,
  config: VoiceDriverConfig,
  f: PixelFrame,
  fade: number,
  mrx: number,
  mry: number,
  presence: number,
  top: number
): VoicePixelKit {
  kitSt = st;
  kitF = f;
  kitFade = fade;
  kitMrx = mrx;
  kitMry = mry;
  kitPresence = presence;
  kit.ctx = ctx;
  kit.config = config;
  kit.cw = f.cw;
  kit.ch = f.ch;
  kit.top = top;
  // Until the look lays out its grid, nothing is lit or in flight.
  st.litN = 0;
  kitHole = null;
  return kit;
}

// ── Closing: a few pixels fly into the button that closed it ────────────

/** The dither's caught cells this frame and their pull, 0–1. */
const caught = new Map<number, number>();

/** How many pixels fly off when the effect closes; the rest fade with it. */
const FLY_COUNT = 26;

interface Flyer {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
  s: number;
  rgb: string;
  delay: number;
  dur: number;
  /** When it was launched, ms (performance.now). */
  t0: number;
  /** Flying out of the button into the wave (opening), not into it. */
  arrive: boolean;
  /** Arriving: the cell it lands in, and the surface it belongs to. */
  cell: number;
  surface: HTMLCanvasElement | null;
  /** Arriving: landed, it stays drawn as its cell's live pixel until the
   *  wave has faded in fully (ms), so it never dims on landing. */
  hold: number;
  /** Arriving: when its cell went dark after landing (ms), or 0. */
  gone: number;
  /** Its own wander off the curve: amplitude (px), waves along the way,
   *  and phase — zero at both ends, so it still leaves and lands exactly. */
  wa: number;
  wf: number;
  wp: number;
}

/** The latest picture state per surface canvas: the close re-registers the
 *  instance, so a flight looks its cells up here rather than holding one. */
const latestState = new WeakMap<HTMLCanvasElement, PixelState>();

/** Where each of `cells` is lit in its surface's latest frame. */
function liveCells(surface: HTMLCanvasElement, cells: Set<number>): Map<number, number> {
  const out = new Map<number, number>();
  const st = latestState.get(surface);
  if (!st || !cells.size) return out;
  for (let i = 0; i < st.litN; i++) if (cells.has(st.litM[i])) out.set(st.litM[i], i);
  return out;
}

/** One board per flyer canvas: closing and opening flights share it, so a
 *  quick close-then-open never has two loops clearing each other. */
const boards = new WeakMap<HTMLCanvasElement, { flyers: Flyer[]; running: boolean }>();

function launch(canvas: HTMLCanvasElement, list: Flyer[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || !list.length) return;
  let board = boards.get(canvas);
  if (!board) boards.set(canvas, (board = { flyers: [], running: false }));
  board.flyers.push(...list);
  if (board.running) return;
  board.running = true;
  const b = board;
  const step = (now: number) => {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const dpr = Math.min(DPR_MAX, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const W = Math.round(cw * dpr);
    const H = Math.round(ch * dpr);
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // Arriving flyers follow their cells' live pixels: where, how big,
    // what colour, and whether lit at all.
    const surface = b.flyers.find((f) => f.surface)?.surface ?? null;
    const st = surface ? latestState.get(surface) : undefined;
    const live = surface ? liveCells(surface, new Set(b.flyers.filter((f) => f.arrive).map((f) => f.cell))) : new Map<number, number>();
    b.flyers = b.flyers.filter((f) => {
      const u = ((now - f.t0) / 1000 - f.delay) / f.dur;
      const li = f.arrive ? live.get(f.cell) : undefined;
      if (f.arrive && st && li !== undefined) {
        f.x1 = st.litX[li];
        f.y1 = st.litY[li];
        f.s = Math.max(1.5, st.litS[li]);
        f.rgb = rgbOf(st.litC[li]);
      }
      if (u >= 1) {
        if (!f.arrive || now >= f.hold) return false;
        // Landed: it is the cell's pixel now, drawn at full strength over
        // the still-fading wave; if the wave lets the cell go dark, it
        // goes out with it.
        if (li === undefined) {
          if (!f.gone) f.gone = now;
          const a = 1 - (now - f.gone) / 150;
          if (a <= 0) return false;
          ctx.fillStyle = `rgba(${f.rgb},${a.toFixed(3)})`;
        } else {
          f.gone = 0;
          ctx.fillStyle = `rgb(${f.rgb})`;
        }
        ctx.fillRect(f.x1 - f.s / 2, f.y1 - f.s / 2, f.s, f.s);
        return true;
      }
      if (u <= 0) {
        // Leaving: it waits in its own place. Arriving: still in the button.
        if (!f.arrive) {
          ctx.fillStyle = `rgb(${f.rgb})`;
          ctx.fillRect(f.x0 - f.s / 2, f.y0 - f.s / 2, f.s, f.s);
        }
        return true;
      }
      // Into the button: slow to leave, fast at the end, as if pulled.
      // Out of it: the same curve run backwards — shot out, then settling.
      const pull = (k: number) => k * k * (2.2 - 1.2 * k);
      const e = f.arrive ? 1 - pull(1 - u) : pull(u);
      const pos = (k: number) => {
        const a = 1 - k;
        const bx = a * a * f.x0 + 2 * a * k * f.cx + k * k * f.x1;
        const by = a * a * f.y0 + 2 * a * k * f.cy + k * k * f.y1;
        if (!f.wa) return [bx, by];
        // Sideways to the curve, by its tangent: a few loose waves.
        const tx = 2 * a * (f.cx - f.x0) + 2 * k * (f.x1 - f.cx);
        const ty = 2 * a * (f.cy - f.y0) + 2 * k * (f.y1 - f.cy);
        const tl = Math.hypot(tx, ty) || 1;
        const off = f.wa * Math.sin(Math.PI * k) * Math.sin(2 * Math.PI * f.wf * k + f.wp);
        return [bx - (ty / tl) * off, by + (tx / tl) * off];
      };
      const [x, y] = pos(e);
      const [px, py] = pos(Math.max(0, e - 0.07));
      // Small at the button, full size in the wave.
      const size = f.s * (f.arrive ? 0.35 + 0.65 * e : 1 - 0.65 * e);
      const alpha = f.arrive ? Math.min(1, u / 0.15) : u > 0.85 ? (1 - u) / 0.15 : 1;
      // The trail: where it just was, fainter.
      ctx.strokeStyle = `rgba(${f.rgb},${(0.35 * alpha).toFixed(3)})`;
      ctx.lineWidth = size * 0.7;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = `rgba(${f.rgb},${alpha.toFixed(3)})`;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      return true;
    });
    if (b.flyers.length) requestAnimationFrame(step);
    else {
      ctx.clearRect(0, 0, cw, ch);
      b.running = false;
    }
  };
  requestAnimationFrame(step);
}

/** A brightness-weighted draw without replacement from the last frame's
 *  lit pixels, from a fixed seed so a close looks the same each time for
 *  the same frame. */
function pickLit(st: PixelState, want: number, rand: () => number): number[] {
  const n = st.litN;
  const picked = new Set<number>();
  let total = 0;
  for (let i = 0; i < n; i++) total += 0.15 + st.litV[i] * st.litV[i];
  const count = Math.min(want, n);
  for (let tries = 0; picked.size < count && tries < count * 12; tries++) {
    let pick = rand() * total;
    let i = 0;
    for (; i < n - 1; i++) {
      pick -= 0.15 + st.litV[i] * st.litV[i];
      if (pick <= 0) break;
    }
    picked.add(i);
  }
  return [...picked];
}

/** A small generator, seeded fresh for each flight so no two closes or
 *  opens fly the same pixels on the same paths. */
function seeded(): () => number {
  let seed = ((Math.random() * 0xffffffff) >>> 0) || 0x9e3779b9;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

/** A button the pixels fly into or out of: its centre and size, px. */
export interface PixelPort {
  x: number;
  y: number;
  w?: number;
  h?: number;
}

/** The end of a flight in the button: just inside its bottom edge. */
function portEnd(port: PixelPort): { x: number; y: number } {
  return { x: port.x, y: port.y + (port.h ?? 0) * 0.3 };
}

/** The curve between a pixel at (px, py) and the button: it rises from the
 *  pixel straight toward the button and turns up into its bottom edge, the
 *  bend sitting under the button between the two — never lower than the
 *  pixel, so nothing dips first. The same curve both ways. */
function bend(px: number, py: number, port: PixelPort, rand: () => number) {
  const end = portEnd(port);
  // Each lands somewhere across the button's lower half, not on one point.
  const bw = port.w ?? port.h ?? 0;
  end.x += (rand() - 0.5) * bw * 0.5;
  end.y += (rand() - 0.5) * (port.h ?? 0) * 0.25;
  const bottom = port.y + (port.h ?? 0) / 2;
  const dx = end.x - px;
  const dy = end.y - py;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  return {
    dist,
    ex: end.x,
    ey: end.y,
    // The bend anywhere from close under the button to well out toward the
    // pixel, and pushed a little to either side: loose, varied arcs.
    cx: end.x - dx * (0.02 + 0.4 * rand()) + (rand() - 0.5) * dist * 0.22,
    cy: Math.max(bottom + 4, Math.min(py, bottom + (py - bottom) * (0.25 + 0.55 * rand()))),
    // A few px of wander for most, none for some.
    wa: rand() < 0.25 ? 0 : (rand() - 0.5) * Math.min(18, 4 + dist * 0.05) * 2,
    wf: 0.6 + rand() * 1.4,
    wp: rand() * Math.PI * 2,
  };
}

const rgbOf = (c: number) => `${(c >> 16) & 255},${(c >> 8) & 255},${c & 255}`;

/**
 * When the effect closes toward a target (a point in the host, px), a few
 * of the last frame's lit pixels — the brightest more likely, spread over
 * the field — leave the picture and fly into it on curved paths, drawn in
 * faster as they near it. They are the wave's own pixels: their cells stay
 * empty until the flight is over.
 */
export function flyPixels(st: PixelState, canvas: HTMLCanvasElement, target: PixelPort, reducedMotion: boolean): void {
  if (reducedMotion || st.litN === 0) return;
  const rand = seeded();
  const t0 = performance.now();
  const picked = pickLit(st, FLY_COUNT, rand);
  const flyers: Flyer[] = picked.map((i) => {
    const x0 = st.litX[i];
    const y0 = st.litY[i];
    const { dist, cx, cy, ex, ey, wa, wf, wp } = bend(x0, y0, target, rand);
    return {
      x0, y0, cx, cy, x1: ex, y1: ey, wa, wf, wp,
      s: Math.max(1.5, st.litS[i]),
      rgb: rgbOf(st.litC[i]),
      // The nearer leave first; each takes longer the further it has to go.
      delay: Math.min(0.22, dist / 2400) + rand() * 0.14,
      dur: 0.38 + Math.min(0.4, dist / 900) + rand() * 0.26,
      t0,
      arrive: false,
      cell: -1,
      surface: null,
      hold: 0,
      gone: 0,
    };
  });
  if (!flyers.length) return;
  // Out of the picture from now until the flight is over; the rest of the
  // wave fades without them.
  const until = t0 + (Math.max(...flyers.map((f) => f.delay + f.dur)) + 0.05) * 1000 + 600;
  for (const i of picked) lift(st, st.litM[i], until);
  launch(canvas, flyers);
}

/**
 * When the effect opens from a button (a point in the host, px), a few of
 * the first frame's lit pixels start out in the button instead and fly out
 * to their places — shot out, then settling, the brightest more likely —
 * each landing back into the picture as it arrives.
 */
export function arrivePixels(st: PixelState, canvas: HTMLCanvasElement, origin: PixelPort, reducedMotion: boolean, waveFullAt: number): void {
  if (reducedMotion || st.litN === 0) return;
  const rand = seeded();
  const t0 = performance.now();
  const flyers: Flyer[] = [];
  for (const i of pickLit(st, FLY_COUNT, rand)) {
    const x1 = st.litX[i];
    const y1 = st.litY[i];
    const { dist, cx, cy, ex, ey, wa, wf, wp } = bend(x1, y1, origin, rand);
    // All leave at once, near enough: the flight leads the wave's fade-in.
    const delay = Math.min(0.08, dist / 4000) + rand() * 0.1;
    const dur = 0.38 + Math.min(0.4, dist / 900) + rand() * 0.26;
    flyers.push({
      x0: ex, y0: ey, cx, cy, x1, y1, wa, wf, wp,
      s: Math.max(1.5, st.litS[i]),
      rgb: rgbOf(st.litC[i]),
      delay,
      dur,
      t0,
      arrive: true,
      cell: st.litM[i],
      surface: st.canvas,
      hold: Math.max(waveFullAt, t0 + (delay + dur) * 1000),
      gone: 0,
    });
    // Its cell stays empty until it lands.
    lift(st, st.litM[i], t0 + (delay + dur) * 1000);
  }
  launch(canvas, flyers);
}
