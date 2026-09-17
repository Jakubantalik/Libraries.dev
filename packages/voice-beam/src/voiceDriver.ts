import { acquireAnalyser } from './audio';
import { voiceLobes, LOBE_SPAN } from './styles';

/**
 * Shared driver for the voice reaction.
 *
 * Every registered instance is stepped from a SINGLE requestAnimationFrame
 * loop (capped at ~60 fps so 120 Hz displays do not double the paint work).
 * Each frame the driver reads the instance's source — an AnalyserNode on a
 * MediaStream, or a plain level getter — shapes the raw level (gain, noise
 * gate, soft saturation), follows it with an attack/release envelope,
 * advances the flow (the lobes sliding sideways at a speed set by the
 * level, so the spectrum travels while a voice is heard and rests when it
 * stops), carries the gathered beam across the range while processing,
 * folds in the idle breathing and the slow hue drift, and writes
 * the result as
 * CSS custom properties on the element. The generated stylesheet multiplies
 * every lobe size and position by those, so the paint work is the
 * browser's and this loop stays a few arithmetic ops per instance.
 */

export interface VoiceDriverConfig {
  id: string;
  sensitivity: number;
  threshold: number;
  attack: number;
  release: number;
  idle: number;
  breatheDuration: number;
  reach: number;
  spread: number;
  bands: boolean;
  /** Flow speed in px/s at full level; negative flows right-to-left. */
  flow: number;
  /** Multiplies the resting distance between lobes (and so the flow ring). */
  lobeSpacing: number;
  /** Bend: px of extra height the glow's top gains at the centre at full level. */
  bend: number;
  /** The band: opacity, thickness, height as a fraction of the ceiling,
   *  bell exponent, bell width, skew, chromatic split. */
  bandStrength: number;
  bandWidth: number;
  bandPosition: number;
  bandCurve: number;
  bandSpread: number;
  bandSkew: number;
  /** Vertical shift of the whole band line, px (negative lowers it). */
  bandOffset: number;
  /** Rise of the band's ends toward the corners, as a fraction of the peak. */
  bandTail: number;
  /** Where the rise starts, as a share of the centre-to-edge distance. */
  bandTailPosition: number;
  /** Exponent of the rise. */
  bandTailCurve: number;
  /** Px the band runs past each side of the element. */
  bandTailOverflow: number;
  bandAberration: number;
  /** The ceiling's tuned size multipliers, so the band can sit on it. */
  rangeWidth: number;
  rangeHeight: number;
  theme: 'dark' | 'light';
  /** Band colours as `r, g, b` triples: the core and its fringes. */
  bandColors: { core: string; above: string; mid: string; below: string };
  /** Horizontal distortion of the glow under the band, 0–1. */
  distortion: number;
  /** The epicentre wash's opacity; above 0 the band-line clips are written even without distortion. */
  coreLight: number;
  /** The effect's overall scale, for the few px values not carried by the geometry props. */
  scale: number;
  /** The element's corner radius, px — the travelling beam follows its arc while processing. */
  radius: number;
  /** Processing state: the beam gathers and travels the range, ping-pong. */
  processing: boolean;
  /** Seconds for one pass of the beam (left to right, or back). */
  processingDuration: number;
  /** Seconds the morph between the voice glow and the travelling beam takes. */
  processingEase: number;
  /** How far the beam travels to each side, × half the lobe ring (1 = the resting spread). */
  processingTravel: number;
  /** How the sweep eases into each turn: 1 constant speed, 2 smooth, higher dwells at the ends. */
  processingCurve: number;
  /** How much the coloured glow rides the corner arcs, 0–1 (the band line always does). */
  cornerFollow: number;
  /** How lit the glow is held while processing, 0–1. */
  processingLevel: number;
  hueRange: number;
  hueDuration: number;
  staticColors: boolean;
  reducedMotion: boolean;
  /** Hold the frame: the clock stops and the source is not read, but a changed config still repaints. */
  paused: boolean;
}

export interface VoiceSource {
  /** Audio to analyse; wins over `getLevel`. */
  stream?: MediaStream | null;
  /** Manual 0–1 level, sampled every frame. */
  getLevel?: () => number;
}

/**
 * The envelope state, kept per element across re-registrations so a prop
 * change (which rebuilds the config and re-registers) does not reset the
 * glow to zero mid-sentence.
 */
interface VoiceState {
  level: number;
  bands: [number, number, number];
  /** Flow phase in px, 0 ≤ phase < LOBE_SPAN. */
  phase: number;
  /** Processing blend, 0–1, following `processing`. */
  scanA: number;
  /** Processing clock in seconds, running while processing. */
  scanT: number;
  /** The instance's own clock in seconds — advances only while running, so a pause holds every drift and resumes without a jump. */
  t: number;
  lastTs: number;
  /** The distortion's share, 0–1: 1 while listening, settling to 0 for processing. */
  warp: number;
}

interface VoiceInstance {
  el: HTMLElement;
  config: VoiceDriverConfig;
  source: VoiceSource;
  onLevel?: (level: number) => void;
  /** The band canvas and its context, when the element carries one. */
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  /** The halo's own canvas where the context cannot blur (WebKit); the CSS blur differs per canvas. */
  haloCanvas: HTMLCanvasElement | null;
  haloCtx: CanvasRenderingContext2D | null;
  /** The distortion filter's displacement and noise-offset primitives. */
  displace: SVGFEDisplacementMapElement | null;
  noiseShift: SVGFEOffsetElement | null;
  /** The distortion filter itself, whose region the driver keeps to the glow under the band line. */
  filter: SVGFilterElement | null;
  /** The filter region's top last written, as a fraction of the host's height (-1 before the first). */
  filterTop: number;
  // Analyser (when a stream is attached) and its scratch buffers.
  analyser: AnalyserNode | null;
  releaseAnalyser: (() => void) | null;
  time: Float32Array<ArrayBuffer> | null;
  freq: Uint8Array<ArrayBuffer> | null;
  s: VoiceState;
  /** The config last painted, so a paused instance repaints only when it changes. */
  paintedConfig: VoiceDriverConfig | null;
  /** The CSS blur last written for the band canvas (WebKit fallback). */
  cssBlur: string | null;
  /** Whether the wrapper is marked `data-voice-warp="off"`: the distortion dropped for processing. */
  warpOff: boolean;
}

const stateByElement = new WeakMap<HTMLElement, VoiceState>();

function stateFor(el: HTMLElement): VoiceState {
  let s = stateByElement.get(el);
  if (!s) {
    s = { level: 0, bands: [0, 0, 0], phase: 0, scanA: 0, scanT: 0, t: 0, lastTs: 0, warp: 1 };
    stateByElement.set(el, s);
  }
  return s;
}

const instances = new Set<VoiceInstance>();
let rafId: number | null = null;
let lastFrame = 0;

// ~60 fps. Subtract a small slack so a frame that lands a hair early still runs.
const FRAME_INTERVAL = 1000 / 60 - 2;

// Adaptive pacing. A phone that cannot hold 60 with every layer repainting
// each frame stutters between 20 and 40; the glow's own dynamics (a 325 ms
// attack, a 5 s breath, a 1 s sweep) are far slower than 30 Hz, so a
// steady half rate reads better than a ragged full one. When the frame
// gap stays above PACE_SLOW_GAP for PACE_SLOW_FOR, the driver runs every
// other frame; every PACE_PROBE_EVERY it tries full rate again and stays
// there if the gaps have closed. Capable devices never leave full rate.
const PACE_SLOW_GAP = 22;
const PACE_SLOW_FOR = 500;
const PACE_PROBE_EVERY = 4000;
let lastRaf = 0;
let paceHalf = false;
let paceSkip = false;
let slowSince = 0;
let probeAt = 0;
const TWO_PI = Math.PI * 2;

// Gain applied before the user's `sensitivity`: a laptop microphone at
// conversational distance gives an RMS of roughly 0.03–0.2, which this lifts
// into the 0.15–1 range the shaping curve expects.
const BASE_GAIN = 5;
const BAND_GAIN = 1.7;

// Voice bands in Hz: fundamentals and chest, vowels and presence, sibilance.
const BANDS: ReadonlyArray<readonly [number, number]> = [
  [80, 300],
  [300, 2000],
  [2000, 6000],
];

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Wrap a lobe offset into [-span/2, span/2). */
function wrapX(x: number, span: number): number {
  const half = span / 2;
  return ((((x + half) % span) + span) % span) - half;
}

/** How much of a lobe shows at offset x: full at centre, gone at the wrap
 *  edge so a lobe never pops from one side to the other. */
function edgeEnvelope(x: number, span: number): number {
  const t = x / (span / 2 + 4);
  return Math.max(0, 1 - t * t);
}

/** Noise gate then soft saturation, so a shout rounds off instead of clipping. */
function shape(raw: number, threshold: number): number {
  if (raw <= threshold) return 0;
  const t = (raw - threshold) / Math.max(0.001, 1 - threshold);
  return clamp01((1 - Math.exp(-3 * t)) / (1 - Math.exp(-3)));
}

/** One-pole follower: fast up (attack), slow down (release). */
function follow(prev: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > prev ? attack : release;
  const a = 1 - Math.exp(-dt / Math.max(0.001, tau));
  return prev + (target - prev) * a;
}

// Processing drops the distortion. Its share settles out on its own clock,
// well ahead of the morph: a 60 ms time constant has it gone in about a
// quarter second — inside the effect's own voice dynamics (the attack is
// 325 ms), so it reads as the shimmer coming to rest rather than a cut —
// and it eases back over roughly a second once processing ends. Below this
// share (3% of the full displacement, about a pixel) the warp layers are
// taken out of the paint altogether, so the swap is invisible.
const BAND_DPR_MAX = 2;
const WARP_OUT_TAU = 0.06;
const WARP_IN_TAU = 0.35;
const WARP_OFF_BELOW = 0.03;
// The distortion filter only has to cover the glow under the band line:
// the warp layers are clipped to it, and the host crops at its own box.
// Its region is kept to that strip — from a little above the line's
// highest point, in steps so the attribute rarely changes, to a little
// below the host — with a small side margin. The margins are the smallest
// that leave the picture identical (a tighter bottom or side changes the
// last rows in Chromium); the strip is typically 3–5× fewer pixels than
// the full box with its 20% margins, and the filter's cost is per pixel
// wherever it runs in software (Firefox, WebKit, and a phone).
// WebKit anchors feTurbulence to the filter region rather than user space,
// so a region that starts below the box top shifts the noise — and past
// the top edge the map falls apart into a dark dome under the band line.
// WebKit keeps the full region until the noise is a bitmap (a feImage,
// which the region test shows WebKit handles), and pays the full cost.
// (Every iOS browser is WebKit, whatever its name; only desktop Blink
// carries "Chrome/".)
const FILTER_REGION_OK = !(
  typeof navigator !== 'undefined' &&
  /AppleWebKit/.test(navigator.userAgent) &&
  !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(navigator.userAgent)
);
const FILTER_TOP_STEP = 0.05;
const FILTER_TOP_MARGIN = 6;
const FILTER_BOTTOM_MARGIN = 12;
const FILTER_BOTTOM_FRACTION = 0.1;
const FILTER_SIDE = 0.1;

// Ceiling geometry the stylesheet uses (px at multiplier 1) — the band is
// drawn to sit on the same hump the glow is masked to.
const CEILING_HALF_WIDTH = 170;
const CEILING_HEIGHT = 64;
const BAND_SAMPLES = 56;

/**
 * The band's bell, normalised so it is 1 at the centre and exactly 0 at
 * the ends: exp(-(|t| / σ)^p) with the tail value subtracted out. `p`
 * below 2 gives the exponential, cusp-like rise of a bent surface; above
 * 2 a flatter top. `skew` widens one side and narrows the other.
 */
function bell(t: number, p: number, sigma: number, skew: number): number {
  const side = t < 0 ? 1 - skew : 1 + skew;
  const s = Math.max(0.05, sigma * side);
  const v = Math.exp(-Math.pow(Math.abs(t) / s, p));
  const tail = Math.exp(-Math.pow(1 / s, p));
  return Math.max(0, (v - tail) / (1 - tail));
}

/**
 * The band's tail lift: from `position` of the way from the beam's centre
 * to the element's edge, the line rises again to the full `lift` exactly
 * at the corner, with `curve` as the exponent (1 a ramp, higher a hook
 * that stays low and whips up at the end) — so the band opens upward in
 * the corners instead of dying flat on the edge.
 */
function tailLift(dist: number, edge: number, lift: number, position: number, curve: number): number {
  if (lift <= 0 || edge <= 0) return 0;
  const start = edge * Math.max(0, Math.min(0.98, position));
  if (dist <= start) return 0;
  const u = Math.min(1, (dist - start) / Math.max(1, edge - start));
  return lift * Math.pow(u, Math.max(0.5, curve));
}

interface BandFrame {
  cx: number;
  w: number;
  h: number;
  mw: number;
  lift: number;
  strength: number;
  level: number;
  /** How much the beam follows the corner arcs, 0–1 (the processing blend). */
  corner: number;
}

/**
 * The corner radius the element actually paints: CSS clamps a radius that
 * would overlap to half the box, so a pill's `border-radius: 106px` on a
 * 150×44 element is really 22px. Using the raw value lifted the beam by
 * more than the element's height.
 */
function paintedRadius(radius: number, cw: number, ch: number): number {
  return Math.max(0, Math.min(radius, cw / 2, ch / 2));
}

/**
 * How far above the bottom edge the element's outline sits at `x`: 0 along
 * the straight run, rising along the corner's circle inside the last
 * `radius` px on either side (and the full radius beyond the sides).
 */
function cornerLift(x: number, cw: number, radius: number, influence = 0): number {
  if (radius <= 0) return 0;
  // `influence` is how far the thing at `x` spreads sideways: a lobe whose
  // edge reaches the corner should already be lifting.
  const d = Math.min(x, cw - x) - influence;
  if (d >= radius) return 0;
  if (d <= 0) return radius;
  const dx = radius - d;
  return radius - Math.sqrt(Math.max(0, radius * radius - dx * dx));
}

/** The band line's points in element px, left to right. */
function bandPoints(config: VoiceDriverConfig, f: BandFrame, cw: number, ch: number): Array<[number, number]> {
  const centre = cw / 2 + f.cx * f.w;
  const half = CEILING_HALF_WIDTH * config.rangeWidth * f.w * f.mw;
  // Sit on the ceiling, but never leave the element: the ceiling can be
  // taller than the element at a high reach, and a band cut off by the
  // top edge reads as a bug rather than a peak. Below scale 1 the clamp
  // shrinks with the scale, so a scaled-down beam keeps the proportions
  // it had at 1 instead of keeping its height while losing its width.
  const apexCap = ch * 0.82 * Math.min(1, config.scale);
  const apex = Math.min(apexCap, (CEILING_HEIGHT * config.rangeHeight * f.h + f.lift) * config.bandPosition);
  const base = ch - config.bandOffset;
  // With a tail, the line runs the element's full width — and `overflow`
  // px past each side, so the hook peaks outside and the component crops
  // it; otherwise it spans the bell's range.
  // The tail hook is the resting look; the travelling beam has none. The
  // blend is finite and eased — gone by the time the morph reaches 25%,
  // before the held level starts lighting the beam — so the hooks never
  // flash, and the distortion clipped under them goes with them.
  const tailT = Math.min(1, f.corner * 4);
  const tail = config.bandTail * (1 - tailT * tailT * (3 - 2 * tailT));
  const withTail = tail > 0.001;
  const over = withTail ? config.bandTailOverflow : 0;
  const x0 = withTail ? -over : centre - half;
  const x1 = withTail ? cw + over : centre + half;
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= BAND_SAMPLES; i++) {
    const x = x0 + ((x1 - x0) * i) / BAND_SAMPLES;
    const t = Math.max(-1, Math.min(1, (x - centre) / Math.max(1, half)));
    const edge = (x < centre ? centre : cw - centre) + over;
    const y =
      bell(t, config.bandCurve, config.bandSpread, config.bandSkew) +
      tailLift(Math.abs(x - centre), edge, tail, config.bandTailPosition, config.bandTailCurve);
    // While processing, the line rides the corner arcs instead of running
    // straight into the radius and being clipped.
    // The band line always rides the corner arc; `cornerFollow` only
    // governs whether the coloured glow rides it too.
    const arc = f.corner > 0 ? cornerLift(x, cw, paintedRadius(config.radius, cw, ch)) * f.corner : 0;
    pts.push([x, base - apex * y - arc]);
  }
  return pts;
}

/** The regions above and below the band line as clip-path polygons, so
 *  the distortion can be confined to the glow under the line. */
function writeClips(el: HTMLElement, id: string, pts: Array<[number, number]>, cw: number, ch: number): void {
  // Full scale for the layers that raster at the host's size, and half
  // scale for the layers that raster at half size and are scaled back
  // (see the stylesheet's resolution block).
  for (const [suffix, k] of [['', 1], ['-z', 0.5]] as const) {
    const px = (v: number) => (v * k).toFixed(1) + 'px';
    const line = pts.map(([x, y]) => `${px(x)} ${px(y)}`);
    const below = `polygon(0 ${px(ch)}, ${line.join(', ')}, ${px(cw)} ${px(ch)})`;
    const above = `polygon(0 0, ${px(cw)} 0, ${px(cw)} ${px(ch)}, ${line.slice().reverse().join(', ')}, 0 ${px(ch)})`;
    el.style.setProperty(`--vb-clip-below${suffix}-${id}`, below);
    el.style.setProperty(`--vb-clip-above${suffix}-${id}`, above);
  }
}

/** Keep the distortion filter's region to the strip under the band line
 *  (see FILTER_TOP_STEP). Fractions of the layer's box, so the half-size
 *  warp layers get the same strip. */
function fitFilterRegion(inst: VoiceInstance, pts: Array<[number, number]>, ch: number): void {
  let minY = ch;
  for (let i = 0; i < pts.length; i++) if (pts[i][1] < minY) minY = pts[i][1];
  const top = Math.max(0, Math.min(0.9, Math.floor((minY - FILTER_TOP_MARGIN) / ch / FILTER_TOP_STEP) * FILTER_TOP_STEP));
  if (top === inst.filterTop) return;
  inst.filterTop = top;
  const bottom = 1 + Math.max(FILTER_BOTTOM_FRACTION, FILTER_BOTTOM_MARGIN / ch);
  const f = inst.filter as SVGFilterElement;
  f.setAttribute('x', `${-FILTER_SIDE * 100}%`);
  f.setAttribute('width', `${(1 + 2 * FILTER_SIDE) * 100}%`);
  f.setAttribute('y', `${(top * 100).toFixed(0)}%`);
  f.setAttribute('height', `${((bottom - top) * 100).toFixed(1)}%`);
}

/** Draw the band: an organic bell traced by a core light with a red fringe
 *  above and a blue one below, split further and thickened by the voice. */
function drawBand(inst: VoiceInstance, f: BandFrame, pts: Array<[number, number]>): void {
  const { canvas, ctx, el, config } = inst;
  if (!canvas || !ctx) return;
  const cw = el.clientWidth;
  const ch = el.clientHeight;
  if (!cw || !ch) return;

  // The band is blurred, so its backing store never needs more than 2x:
  // a 3x phone draws 2.25x fewer pixels and looks the same.
  const dpr = Math.min(BAND_DPR_MAX, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const pw = Math.round(cw * dpr);
  const ph = Math.round(ch * dpr);
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw;
    canvas.height = ph;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const haloCanvas = inst.haloCanvas;
  const haloCtx = inst.haloCtx;
  if (haloCanvas && haloCtx) {
    if (haloCanvas.width !== pw || haloCanvas.height !== ph) {
      haloCanvas.width = pw;
      haloCanvas.height = ph;
    }
    haloCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    haloCtx.clearRect(0, 0, cw, ch);
  }

  const alpha = Math.min(1, 0.6 * config.bandStrength * f.strength);
  if (alpha < 0.005 || config.bandWidth <= 0) return;

  const isDark = config.theme === 'dark';
  const bw = config.bandWidth * (1 + 0.35 * f.level);
  const split = config.bandAberration * (0.35 + 0.65 * f.level);
  const dy = (4 + 12 * split) * config.scale;
  const dx = 4 * split * config.scale;

  const trace = (ox: number, oy: number) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0] + ox, pts[0][1] + oy);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] + ox, pts[i][1] + oy);
  };

  // The band as the gradient rim used to paint it: a thin ridge with a
  // linear ramp across its thickness (stacked strokes of shrinking width,
  // no blur), the red fringe riding above and the blue below, a faint
  // green between, and a wide soft halo under all of it — subtle, so it
  // reads as a luminous ridge in the glow rather than a line drawn on it.
  const colours = { r: config.bandColors.above, g: config.bandColors.mid, c: config.bandColors.core, b: config.bandColors.below };
  const base = (isDark ? 0.42 : 0.4) * alpha;
  const thickness = 14 * bw;
  // The old rim was a gradient in a blurred layer: soften every pass with
  // a canvas blur where the browser has one. WebKit's 2D context has no
  // filter, and stacking hard strokes under shadow blur reads as bands
  // of solid colour — so there the strokes are drawn crisp and blurred by
  // CSS instead, at the same two radii: the ridge on this canvas
  // (\`--vb-band-blur\`), the halo on its own canvas beneath
  // (\`--vb-band-halo-blur\`, 3× wider), read by the layers' rules.
  // The blur is canonical in CSS px — the look of the reference (a 2x
  // display, where Chromium's device-px canvas blur of 3.5 * bandWidth
  // came out at half that in CSS px) — so every DPR and both engines
  // draw the same band. Chromium applies the canvas blur in device pixels,
  // ignoring the DPR transform, so it is scaled by the backing DPR; the
  // CSS stand-in (WebKit) takes the CSS px directly.
  const blurCss = (3.5 * config.bandWidth) / 2;
  const blurPx = blurCss * dpr;
  const canBlur: boolean = typeof (ctx as { filter?: unknown }).filter === 'string';
  const cssBlur = canBlur ? '0px' : `${blurCss.toFixed(2)}px`;
  if (inst.cssBlur !== cssBlur) {
    el.style.setProperty(`--vb-band-blur-${config.id}`, cssBlur);
    el.style.setProperty(`--vb-band-halo-blur-${config.id}`, canBlur ? '0px' : `${(blurCss * 3).toFixed(2)}px`);
    inst.cssBlur = cssBlur;
  }
  const ramp: ReadonlyArray<readonly [number, number]> = [
    [1, 0.16],
    [0.72, 0.2],
    [0.46, 0.26],
    [0.22, 0.34],
  ];
  type Ridge = { rgb: string; a: number; ox: number; oy: number };
  const ridges: Ridge[] = [
    { rgb: colours.r, a: 1, ox: dx, oy: -dy },
    { rgb: colours.g, a: 0.55, ox: dx * 0.35, oy: -dy * 0.35 },
    { rgb: colours.b, a: 1, ox: -dx, oy: dy },
    { rgb: colours.c, a: 0.9, ox: 0, oy: 0 },
  ];

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = 'source-over';
  const x0 = pts[0][0];
  const x1 = pts[pts.length - 1][0];
  const endsFaded = (rgb: string, a: number) => {
    // Fade the ends into the edge so the band never terminates in a stub.
    const grad = ctx.createLinearGradient(x0, 0, x1, 0);
    // A short fade when the line reaches the corners (the tail should be
    // seen there), the old long one when it ends inside the element.
    const fade = config.bandTail > 0 ? 0.015 : 0.18;
    grad.addColorStop(0, `rgba(${rgb}, 0)`);
    grad.addColorStop(fade, `rgba(${rgb}, ${a.toFixed(3)})`);
    grad.addColorStop(1 - fade, `rgba(${rgb}, ${a.toFixed(3)})`);
    grad.addColorStop(1, `rgba(${rgb}, 0)`);
    return grad;
  };

  // Halo: what the bloom's blurred copy of the rim gave — wide and hazy.
  // On its own canvas where the context cannot blur, so the CSS blur can
  // be the wider one; here otherwise.
  const hc = !canBlur && haloCtx ? haloCtx : ctx;
  if (canBlur) ctx.filter = `blur(${(blurPx * 3).toFixed(1)}px)`;
  hc.lineCap = 'round';
  hc.lineJoin = 'round';
  hc.strokeStyle = endsFaded(colours.c, base * 0.3);
  hc.lineWidth = thickness * 2.2;
  hc.beginPath();
  hc.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) hc.lineTo(pts[i][0], pts[i][1]);
  hc.stroke();

  if (canBlur) ctx.filter = `blur(${blurPx.toFixed(1)}px)`;
  for (const ridge of ridges) {
    for (const [widthMul, alphaMul] of ramp) {
      ctx.strokeStyle = endsFaded(ridge.rgb, base * ridge.a * alphaMul);
      ctx.lineWidth = Math.max(0.6, thickness * widthMul);
      trace(ridge.ox, ridge.oy);
      ctx.stroke();
    }
  }
  if (canBlur) ctx.filter = 'none';
  ctx.globalCompositeOperation = 'source-over';
}

/** Cosine ease-in-out in [0, 1]: 0 at phase 0/1, 1 at phase 0.5. */
function pingPong(phase: number): number {
  return (1 - Math.cos(TWO_PI * phase)) / 2;
}

function readAnalyser(inst: VoiceInstance, out: { level: number; bands: [number, number, number] }): void {
  const analyser = inst.analyser!;
  const time = inst.time!;
  const freq = inst.freq!;

  analyser.getFloatTimeDomainData(time);
  let sum = 0;
  for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
  out.level = Math.sqrt(sum / time.length) * BASE_GAIN * inst.config.sensitivity;

  analyser.getByteFrequencyData(freq);
  const binHz = analyser.context.sampleRate / analyser.fftSize;
  for (let b = 0; b < 3; b++) {
    const [lo, hi] = BANDS[b];
    const from = Math.max(0, Math.floor(lo / binHz));
    const to = Math.min(freq.length - 1, Math.ceil(hi / binHz));
    let acc = 0;
    for (let i = from; i <= to; i++) acc += freq[i];
    const avg = to >= from ? acc / (to - from + 1) / 255 : 0;
    out.bands[b] = avg * BAND_GAIN * inst.config.sensitivity;
  }
}

const scratch = { level: 0, bands: [0, 0, 0] as [number, number, number] };

function frame(ts: number): void {
  rafId = requestAnimationFrame(frame);

  // ── Pacing ───────────────────────────────────────────────────────
  const gap = lastRaf ? ts - lastRaf : 0;
  lastRaf = ts;
  if (paceHalf) {
    paceSkip = !paceSkip;
    if (paceSkip) return;
    if (ts >= probeAt) {
      paceHalf = false;
      slowSince = 0;
    }
  } else if (gap > PACE_SLOW_GAP) {
    if (!slowSince) slowSince = ts;
    else if (ts - slowSince > PACE_SLOW_FOR) {
      paceHalf = true;
      paceSkip = false;
      probeAt = ts + PACE_PROBE_EVERY;
    }
  } else {
    slowSince = 0;
  }

  if (ts - lastFrame < FRAME_INTERVAL) return;
  lastFrame = ts;

  instances.forEach((inst) => {
    const { el, config, source, s } = inst;
    // Paused: the frame holds. It is repainted once per config change so
    // the controls still shape the frozen frame; nothing advances.
    const paused = config.paused;
    if (paused && inst.paintedConfig === config) return;
    const dt = paused ? 0 : s.lastTs ? Math.min(0.05, (ts - s.lastTs) / 1000) : 1 / 60;
    s.lastTs = ts;
    s.t += dt;
    const tSec = s.t;

    // ── Raw level and bands from the source ─────────────────────────
    if (paused) {
      // Hold the last level; nothing to read.
    } else if (inst.analyser) {
      readAnalyser(inst, scratch);
    } else {
      const raw = source.getLevel ? clamp01(source.getLevel()) : 0;
      scratch.level = raw;
      // No spectrum to read, so give the bands a little independent life —
      // slow, out-of-phase wobbles scaled by the level — so the lobes still
      // ripple rather than pumping in lockstep.
      scratch.bands[0] = raw;
      scratch.bands[1] = raw * (0.72 + 0.28 * Math.sin(tSec * 9.1));
      scratch.bands[2] = raw * (0.6 + 0.4 * Math.sin(tSec * 13.7 + 2));
    }

    // ── Shape and follow ─────────────────────────────────────────────
    const target = shape(scratch.level, config.threshold);
    s.level = follow(s.level, target, dt, config.attack, config.release);
    for (let b = 0; b < 3; b++) {
      const bt = shape(scratch.bands[b], config.threshold * 0.6);
      s.bands[b] = follow(s.bands[b], bt, dt, config.attack, config.release * 1.15);
    }

    // ── Processing travel ────────────────────────────────────────────
    // Like border-beam's line type: the lobes gather into one compact beam
    // that travels the glow's range, left to right and back, eased at each
    // end and looped. `scanA` blends the whole thing in over ~0.25 s when
    // `processing` turns on and out when it stops; the glow is held at
    // `processingLevel` meanwhile so the beam has colour.
    const span = LOBE_SPAN * config.lobeSpacing;
    // A fresh start begins the pass at the centre, heading right, so the
    // beam grows out of the voice glow instead of jumping to one end.
    const fresh = config.processing && s.scanA < 0.001 && s.scanT === 0;
    if (fresh) s.scanT = Math.max(0.05, config.processingDuration) / 2;
    const ease = Math.max(0.05, config.processingEase);
    s.scanA = follow(s.scanA, config.processing ? 1 : 0, dt, ease * 0.9, ease * 0.8);
    if (config.processing) s.scanT += dt;
    else if (s.scanA < 0.001) s.scanT = 0;
    // The morph itself runs on an eased copy of the blend — slow to start,
    // slow to settle — so the gather, the narrowing and the travel read as
    // one movement rather than a snap that then coasts.
    const morph = s.scanA * s.scanA * (3 - 2 * s.scanA);
    const cw = el.clientWidth;
    const ch = el.clientHeight;
    const travel = (span / 2) * config.processingTravel;
    // -1 … 1 along the pass, ping-pong. Each pass eases symmetrically on
    // a power curve: exponent 1 is a constant-speed triangle with sharp
    // turns, 2 slows smoothly into the ends, higher dwells there longer.
    const passes = s.scanT / Math.max(0.05, config.processingDuration);
    const passIndex = Math.floor(passes);
    const u = passes - passIndex;
    const k = Math.max(1, config.processingCurve);
    const eased = u < 0.5 ? 0.5 * Math.pow(2 * u, k) : 1 - 0.5 * Math.pow(2 - 2 * u, k);
    const pass = config.reducedMotion ? 0 : passIndex % 2 === 0 ? 2 * eased - 1 : 1 - 2 * eased;
    const cx = morph * travel * pass;
    // The cluster: lobes pulled to 40% of their resting spread, the
    // visible range narrowed to match, and — as the line type does — the
    // beam a little wider mid-pass than at the turns.
    const gather = 1 - morph * 0.6;
    const maskWidth = 1 - morph * 0.45;
    const passWidth = 1 + morph * 0.3 * (1 - pass * pass);

    // ── Idle breathing folded under the voice ────────────────────────
    const breathe = config.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin((TWO_PI * tSec) / config.breatheDuration);
    const voiced = s.level + (1 - s.level) * config.idle * breathe;
    // The held level waits for the first quarter of the morph — the time
    // the tail hooks take to collapse — so they never light up with it.
    const heldT = Math.max(0, Math.min(1, (morph - 0.25) / 0.75));
    const held = heldT * heldT * (3 - 2 * heldT);
    const eff = Math.max(voiced, config.processingLevel * held);

    const glow = 0.15 + 0.85 * eff;
    const h = 0.5 + config.reach * eff;
    const w = (0.85 + config.spread * eff) * passWidth;

    // ── Flow: the spectrum slides sideways as the voice comes in ─────
    if (config.flow !== 0 && !config.reducedMotion) {
      s.phase = (((s.phase + config.flow * eff * dt) % span) + span) % span;
    }

    el.style.setProperty(`--vb-level-${config.id}`, s.level.toFixed(3));
    el.style.setProperty(`--vb-cx-${config.id}`, `${cx.toFixed(1)}px`);
    el.style.setProperty(`--vb-mw-${config.id}`, maskWidth.toFixed(3));

    // ── Bend: the glow's ceiling humps up at the centre ──────────────
    // Extra height for the ellipse the glow is masked to, scaled by the
    // level, and the 0–1 strength the rim along that contour fades with.
    // Flat at silence.
    const lift = config.bend * eff;
    el.style.setProperty(`--vb-bh-${config.id}`, `${Math.max(0, lift).toFixed(1)}px`);
    const bendA = config.bend > 0 ? Math.min(1, lift / config.bend) : 0;
    el.style.setProperty(`--vb-bendA-${config.id}`, bendA.toFixed(3));
    // The band sits on that ceiling, fading in with the bend and reacting
    // to the voice on its own (thickness and chromatic split).
    // The band line is computed even when the band is invisible: the
    // distortion is confined to the glow under it either way.
    const frame: BandFrame = { cx, w, h, mw: maskWidth, lift, strength: bendA, level: s.level, corner: morph };
    // The beam's centre and every lobe lift along the corner arcs as they
    // pass through them while processing, so the cluster wraps the corner
    // the way the line type does instead of being cut off by it.
    const beamAbsX = cw / 2 + cx * w;
    const lobeReach = 30 * config.scale * w;
    const arcRadius = paintedRadius(config.radius, cw, ch);
    const cornerBlend = morph * config.cornerFollow;
    el.style.setProperty(`--vb-cy-${config.id}`, `${(-cornerLift(beamAbsX, cw, arcRadius, lobeReach * 1.4) * cornerBlend).toFixed(1)}px`);
    // ── Distortion: the glow under the band warps sideways ───────────
    // A displacement map on the inner light and the bloom, its strength
    // following the voice and its noise drifting slowly, so the colours
    // shimmer and stretch horizontally like light through bent space.
    // Processing drops it: the warp settles out fast (see WARP_OUT_TAU),
    // and once it is gone the wrapper is marked so its two layers leave the
    // paint and the base layers give up their split at the band line — the
    // reference filter is the costliest thing here where SVG filters run in
    // software, and the travelling beam is the one fast motion in the
    // effect. It eases back the same way as processing ends.
    s.warp = follow(s.warp, config.processing ? 0 : 1, dt, WARP_IN_TAU, WARP_OUT_TAU);
    const warp = s.warp;
    const warpOff = inst.displace != null && warp < WARP_OFF_BELOW;
    if (warpOff !== inst.warpOff) {
      inst.warpOff = warpOff;
      if (warpOff) el.setAttribute('data-voice-warp', 'off');
      else el.removeAttribute('data-voice-warp');
    }
    if (cw && ch && (inst.ctx || inst.displace)) {
      const pts = bandPoints(config, frame, cw, ch);
      if ((inst.displace && !warpOff) || config.coreLight > 0) writeClips(el, config.id, pts, cw, ch);
      if (inst.filter && !warpOff && FILTER_REGION_OK) fitFilterRegion(inst, pts, ch);
      if (inst.ctx) drawBand(inst, frame, pts);
    }
    if (inst.displace && !warpOff) {
      const amount = config.reducedMotion ? 0 : config.distortion * 120 * config.scale * (0.15 + 0.85 * eff) * warp;
      inst.displace.scale.baseVal = amount;
      if (inst.noiseShift) {
        inst.noiseShift.dx.baseVal = 8 * config.scale * Math.sin(tSec * 0.9);
        inst.noiseShift.dy.baseVal = 4 * config.scale * Math.sin(tSec * 0.6 + 1.3);
      }
    }
    el.style.setProperty(`--vb-glow-${config.id}`, glow.toFixed(3));
    el.style.setProperty(`--vb-h-${config.id}`, h.toFixed(3));
    el.style.setProperty(`--vb-w-${config.id}`, w.toFixed(3));

    // Each lobe: its offset along the flow, and its amplitude — the band it
    // follows lifts it between 0.6× and 1.3× of the shared height, and the
    // edge envelope fades it out toward the wrap.
    for (let i = 0; i < voiceLobes.length; i++) {
      const lobe = voiceLobes[i];
      const x = wrapX(lobe.x * config.lobeSpacing + s.phase, span);
      const bandLift = config.bands ? 0.6 + 0.7 * s.bands[lobe.band] : 1;
      el.style.setProperty(`--vb-x${i}-${config.id}`, `${(x * gather).toFixed(1)}px`);
      el.style.setProperty(`--vb-l${i}-${config.id}`, (bandLift * edgeEnvelope(x, span)).toFixed(3));
      const lobeAbsX = cw / 2 + (cx + x * gather) * w;
      el.style.setProperty(`--vb-y${i}-${config.id}`, `${(-cornerLift(lobeAbsX, cw, arcRadius, lobeReach) * cornerBlend).toFixed(1)}px`);
    }

    // ── Hue drift ────────────────────────────────────────────────────
    const hue =
      config.staticColors || config.reducedMotion || config.hueRange === 0
        ? 0
        : -config.hueRange + 2 * config.hueRange * pingPong(tSec / config.hueDuration);
    el.style.setProperty(`--vb-hue-${config.id}`, `${hue.toFixed(2)}deg`);

    inst.onLevel?.(s.level);
    inst.paintedConfig = config;
  });
}

function startLoop(): void {
  if (rafId == null) {
    lastFrame = 0;
    lastRaf = 0;
    slowSince = 0;
    rafId = requestAnimationFrame(frame);
  }
}

function stopLoopIfIdle(): void {
  if (instances.size === 0 && rafId != null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/**
 * Register an element to be driven by the shared voice loop.
 *
 * @returns a cleanup function that unregisters the instance, releases its
 *          analyser, and stops the shared loop once no instances remain.
 */
export function registerVoiceInstance(
  el: HTMLElement,
  config: VoiceDriverConfig,
  source: VoiceSource,
  onLevel?: (level: number) => void
): () => void {
  const inst: VoiceInstance = {
    el,
    config,
    source,
    onLevel,
    analyser: null,
    releaseAnalyser: null,
    time: null,
    freq: null,
    canvas: null,
    ctx: null,
    haloCanvas: null,
    haloCtx: null,
    displace: null,
    noiseShift: null,
    filter: null,
    filterTop: -1,
    s: stateFor(el),
    paintedConfig: null,
    cssBlur: null,
    // Match the mark a previous registration may have left on the element.
    warpOff: el.hasAttribute('data-voice-warp'),
  };
  if (config.distortion > 0) {
    inst.displace = el.querySelector<SVGFEDisplacementMapElement>(':scope > svg feDisplacementMap');
    inst.noiseShift = el.querySelector<SVGFEOffsetElement>(':scope > svg feOffset');
    inst.filter = el.querySelector<SVGFilterElement>(':scope > svg filter');
  }
  const canvas = el.querySelector<HTMLCanvasElement>(':scope > [data-voice-beam-band]');
  if (canvas) {
    inst.canvas = canvas;
    inst.ctx = canvas.getContext('2d');
    const halo = el.querySelector<HTMLCanvasElement>(':scope > [data-voice-beam-band-halo]');
    if (halo) {
      inst.haloCanvas = halo;
      inst.haloCtx = halo.getContext('2d');
    }
  }
  // A fresh registration after a pause must not integrate the gap.
  inst.s.lastTs = 0;

  if (source.stream) {
    const lease = acquireAnalyser(source.stream);
    if (lease) {
      inst.analyser = lease.analyser;
      inst.releaseAnalyser = lease.release;
      inst.time = new Float32Array(lease.analyser.fftSize);
      inst.freq = new Uint8Array(lease.analyser.frequencyBinCount);
    }
  }

  instances.add(inst);
  startLoop();

  return () => {
    instances.delete(inst);
    inst.releaseAnalyser?.();
    stopLoopIfIdle();
  };
}
