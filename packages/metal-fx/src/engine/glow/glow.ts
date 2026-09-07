/**
 * Glow overlay — a luminance-driven halo that tracks the brightest point on
 * the shader's perimeter, plus a tight catch-light.
 *
 * How it works:
 *   1. Samples luminance at N points around the component's perimeter.
 *   2. A state machine tracks which perimeter point is brightest, with dwell
 *      timers and fade-out / fade-in when relocating to a new hotspot.
 *   3. Pre-baked sprites (see `bake.ts`) are drawn onto a small per-instance
 *      canvas at the hotspot, tinted to the shader's colour there, and
 *      clipped to the ring band (or the glyph mask in point mode).
 *
 * The canvas replaces the earlier SVG: four `feGaussianBlur` strokes over a
 * 540×440 filter region re-rasterised on every move — the single biggest
 * idle cost of the effect. Now a move is a few `drawImage` calls inside
 * `clip()` paths, and nothing is drawn at all when the hotspot hasn't moved
 * more than a quarter pixel.
 *
 * Deliberately no `destination-in` / `source-in` compositing on the hot
 * path: WebKit intermittently applies those wrong on accelerated canvases
 * (one frame of the halo unclipped and untinted — a white flash). Tinting is
 * pixel data, clipping is paths; the glyph mask (point mode) multiplies
 * alpha in pixel data too.
 */
import type { MetalFxInstance, ShaderRGB } from '../renderer/core';
import { sampleShaderLumAt, sampleShaderRGBAt, sampleShaderRGBChromatic } from '../renderer/sampling';
import { type Tween, ease, tween, tweenStart, tweenTick } from '../tween';
import { hsvToRgb, rgbToHsv } from '../color';
import { GLOW } from './config';
import { CURSOR_LIGHT } from '../cursor/light';
import type { DeformFn } from '../renderer/core';
import { type OutlineBuf, createOutlineBuf, roundRectOutline } from '../renderer/outline';
import { type Sprite, type Tinted, bakeExtra, bakeHalo, gaussBlur, tintSprite } from './bake';
import {
  type GlowOptions,
  type PerimSample,
  type Pt,
  arcAtPoint,
  buildPerimTable,
  rrPerim,
  sampleAtArc,
  shapePerim,
  smoothstep,
  tangentAngleAtArc,
} from './geometry';

// ─── Constants ────────────────────────────────────────────────────────────

const RELOCATE_DELTA = 0.05;
/** Wander retarget period. Was 120 ticks at the 15 fps shader rate. */
const WANDER_RETARGET_MS = 120 * (1000 / 15);
/** Per-tick rates in GLOW are defined at the 15 fps shader rate; ticks now
 *  come at display rate mid-fade, so they're rescaled by elapsed time. */
const RATE_TICK_MS = 1000 / 15;
const TINT_HOLD_MS = 2000, TINT_FADE_MS = 400;
const LT_SAT_BOOST = 2.625, LT_VAL_MULT = 1.008, LT_MIN_VAL = 0.31;
const REF_W = 140, REF_H = 40, REF_R = 20;
/** Longest a single tick may advance the fade envelope, ms (~2 frames). */
const ENV_MAX_STEP_MS = 34;
/** Redraw thresholds — below these a frame is skipped entirely. */
const POS_EPS = 0.25, ANG_EPS = 0.01, OP_EPS = 0.004;
/** Point mode: the glyph clip keeps a soft skirt around the letters, like the
 *  ring band's 50 % surround — otherwise on small type the halo's blur is
 *  thrown away and only a hairline glint survives inside the strokes. */
const GLYPH_SKIRT = 0.5, GLYPH_SKIRT_SIGMA = 3.5;

// ─── Types ────────────────────────────────────────────────────────────────

export type { GlowOptions } from './geometry';

export interface GlowHandles {
  /** Carries the `.metal-fx-glow-svg` class (theme opacity / blend / filter
   *  from the stylesheet). Inside it `env` carries the appear/disappear
   *  opacity, and the canvas sits in that, overscanned by `margin`. The
   *  envelope lives on a plain div, not the canvas: Safari can show stale or
   *  empty canvas content when the canvas itself is the element whose
   *  opacity is animated in its own compositing layer. */
  wrap: HTMLDivElement;
  env: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** Ring mode clips: everything outside the ring (drawn at 50 %) and the
   *  band itself (100 %), as evenodd paths in canvas CSS px. Rebuilt only
   *  when the outline changes (deform). */
  surroundPath: Path2D | null;
  bandPath: Path2D | null;
  /** Point mode: glyph alpha per device pixel of `canvas`, from the mask image. */
  maskAlpha: Uint8ClampedArray | null;
  maskReady: boolean;
  /** CSS-px margin the canvas extends beyond the host box on every side. */
  margin: number;
  dpr: number;
  halo: Sprite;
  extra: Sprite;
  haloTint: Tinted;
  extraTint: Tinted;
  /** Outline buffers for the band mask; `maskSum` is a cheap checksum of the
   *  last rendered outline so unchanged composites don't repaint it. */
  mO: OutlineBuf; mI: OutlineBuf; maskSum: number; maskDeformed: boolean;
  /** Current deform, mirrored from the instance so the hotspot rides the dent. */
  deform: DeformFn | null;
  width: number; height: number; cornerRadius: number; kind: 'pill' | 'circle';
  /** Master scale used at bake time so per-frame position math
   *  (GLOW.inset / GLOW.extraOutward) stays consistent with the sprites. */
  scale: number;
  perim: PerimSample[];
  /** True when perim is a point set (custom mask) rather than a ring arc. */
  pointMode: boolean;
  currentIdx: number; appearedAt: number; glowOpacity: number;
  /** Appear/disappear envelope, 0..1. The tween runs on `envClock`, a clock
   *  that advances by at most `ENV_MAX_STEP_MS` per tick: a dropped frame
   *  stretches the fade instead of skipping most of it (which read as a pop). */
  relocTween: Tween | null; relocNextIdx: number; relocMul: number; envClock: number;
  // wanderFrames accumulates elapsed ms (name kept for the handle shape).
  /** Cursor mode: the hotspot faces `inst.cursorLight` instead of hunting
   *  luminance. `cursorArc` is the smoothed hotspot arc position. */
  cursorMode: boolean; cursorArc: number; cursorTargetArc: number; lastTickMs: number;
  wanderS: number; wanderTargetS: number; wanderFrames: number;
  tintFrom: ShaderRGB; tintTarget: ShaderRGB; tintTween: Tween | null; tintHoldUntil: number;
  /** Last drawn state, for the skip test. */
  dX: number; dY: number; dAng: number; dEX: number; dEY: number; dHOp: number; dEOp: number;
  dHaloTint: string; dExtraTint: string; dirty: boolean;
  /** Last envelope written to `canvas.style.opacity`. The appear/disappear
   *  fade is a compositor-only opacity change — no canvas redraw. */
  dEnv: number;
}

const _pt: Pt = { x: 0, y: 0 };

// ─── Public API ───────────────────────────────────────────────────────────

export function injectGlow(container: HTMLElement, opts: GlowOptions): GlowHandles {
  const { width: W, height: H } = opts;
  const s = opts.scale ?? 1;
  const dpr = Math.min(3, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  const ratio = shapePerim(W, H, opts.cornerRadius, opts.kind) / rrPerim(REF_W, REF_H, REF_R);
  const haloHL = Math.max(1, GLOW.haloHalfLen * ratio);
  const extraHL = Math.max(0.6, GLOW.extraHalfLen * ratio);
  const halo = bakeHalo(haloHL, s, dpr);
  const extra = bakeExtra(extraHL, s, dpr);

  // Enough room for the halo's full blur skirt plus the outward catch-light.
  const margin = Math.ceil(Math.max(halo.ay, extra.ay) + GLOW.extraOutward * ratio * s + 2);

  const wrap = document.createElement('div');
  wrap.className = 'metal-fx-glow-svg';
  wrap.setAttribute('aria-hidden', 'true');
  const env = document.createElement('div');
  env.className = 'metal-fx-glow-env';
  env.style.cssText = 'position:absolute;inset:0;pointer-events:none;opacity:0';
  const canvas = document.createElement('canvas');
  canvas.className = 'metal-fx-glow-canvas';
  const cw = W + 2 * margin, ch = H + 2 * margin;
  canvas.width = Math.ceil(cw * dpr); canvas.height = Math.ceil(ch * dpr);
  canvas.style.cssText = `position:absolute;left:${-margin}px;top:${-margin}px;width:${cw}px;height:${ch}px;pointer-events:none`;
  env.appendChild(canvas);
  wrap.appendChild(env);
  container.appendChild(wrap);
  const ctx = canvas.getContext('2d', { willReadFrequently: !!opts.maskDataUrl });
  if (!ctx) throw new Error('metal-fx: glow canvas 2D context unavailable');

  const h: GlowHandles = {
    wrap, env, canvas, ctx, surroundPath: null, bandPath: null, maskAlpha: null, maskReady: false, margin, dpr,
    halo, extra,
    haloTint: { canvas: null, img: null, tint: -1, src: null }, extraTint: { canvas: null, img: null, tint: -1, src: null },
    mO: createOutlineBuf(), mI: createOutlineBuf(), maskSum: Number.NaN, maskDeformed: false, deform: null,
    width: W, height: H, cornerRadius: opts.cornerRadius, kind: opts.kind,
    scale: s,
    perim: buildPerimTable(opts),
    pointMode: !!(opts.samplePoints && opts.samplePoints.length > 0),
    currentIdx: 0, appearedAt: 0, glowOpacity: 0,
    relocTween: null, relocNextIdx: -1, relocMul: 0, envClock: 0,
    cursorMode: false, cursorArc: 0, cursorTargetArc: 0, lastTickMs: 0,
    wanderS: 0, wanderTargetS: 0, wanderFrames: 0,
    tintFrom: { r: 255, g: 255, b: 255 }, tintTarget: { r: 255, g: 255, b: 255 }, tintTween: null, tintHoldUntil: 0,
    dX: Number.NaN, dY: Number.NaN, dAng: Number.NaN, dEX: Number.NaN, dEY: Number.NaN, dHOp: Number.NaN, dEOp: Number.NaN,
    dHaloTint: '', dExtraTint: '', dirty: true,
    dEnv: -1,
  };

  if (opts.maskDataUrl) {
    const img = new Image();
    img.onload = () => {
      // Rasterise the glyph mask once at canvas resolution and keep its alpha.
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      if (!g) return;
      g.scale(dpr, dpr);
      g.drawImage(img, margin, margin, W, H);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const n = c.width * c.height;
      const glyph = new Float32Array(n);
      for (let i = 0, j = 3; i < n; i++, j += 4) glyph[i] = d[j] / 255;
      const skirt = gaussBlur(Float32Array.from(glyph), c.width, c.height, GLYPH_SKIRT_SIGMA * dpr);
      let peak = 0;
      for (let i = 0; i < n; i++) if (skirt[i] > peak) peak = skirt[i];
      const k = peak > 0 ? GLYPH_SKIRT / peak : 0;
      const a = new Uint8ClampedArray(n);
      for (let i = 0; i < n; i++) a[i] = Math.round(Math.max(glyph[i], skirt[i] * k) * 255);
      h.maskAlpha = a; h.maskReady = true; h.dirty = true;
    };
    img.src = opts.maskDataUrl;
  } else {
    renderMask(h, null);
  }
  return h;
}

// ─── Mask ─────────────────────────────────────────────────────────────────

/**
 * The band clip, as two evenodd paths. Matches the old SVG mask: 50 % outside
 * the ring, 100 % inside the band, 0 in the hole — the halo's blur skirt
 * still spills softly onto the page.
 */
function renderMask(h: GlowHandles, deform: DeformFn | null): void {
  if (h.pointMode) return;
  const { margin: m, width: W, height: H, cornerRadius: R } = h;
  const ringInset = h.kind === 'circle' ? 2 : 1;
  roundRectOutline(0, 0, W, H, R, deform, h.mO);
  roundRectOutline(ringInset, ringInset, W - 2 * ringInset, H - 2 * ringInset, Math.max(0, R - ringInset), deform, h.mI);
  const outer = new Path2D();
  tracePath(outer, h.mO, m);
  const band = new Path2D();
  tracePath(band, h.mO, m);
  tracePath(band, h.mI, m);
  const surround = new Path2D();
  surround.rect(0, 0, W + 2 * m, H + 2 * m);
  surround.addPath(outer);
  h.surroundPath = surround;
  h.bandPath = band;
  h.maskReady = true;
}

function tracePath(p: Path2D, buf: OutlineBuf, off: number): void {
  const xy = buf.xy;
  for (let i = 0; i < buf.n; i++) {
    const x = xy[i * 2] + off, y = xy[i * 2 + 1] + off;
    if (i === 0) p.moveTo(x, y); else p.lineTo(x, y);
  }
  p.closePath();
}

function outlineSum(deform: DeformFn | null, h: GlowHandles): number {
  if (!deform) return 0;
  // Cheap checksum of the deformed outline: every 4th point.
  roundRectOutline(0, 0, h.width, h.height, h.cornerRadius, deform, h.mO);
  let sum = 0;
  const xy = h.mO.xy;
  for (let i = 0; i < h.mO.n; i += 4) sum += xy[i * 2] * 1.37 + xy[i * 2 + 1];
  return sum;
}

/**
 * Keep the glow's band mask (and hotspot) on the deformed outline. Call after
 * every composite while `deform` is set; pass null once to restore the rigid
 * mask. Cheap: a checksum of ~40 points, and a small path fill when changed.
 */
export function updateGlowMask(h: GlowHandles, deform: DeformFn | null): void {
  h.deform = deform;
  if (h.pointMode) return;
  if (deform) {
    const sum = outlineSum(deform, h);
    if (sum !== h.maskSum) { h.maskSum = sum; renderMask(h, deform); h.maskDeformed = true; h.dirty = true; }
  } else if (h.maskDeformed) {
    h.maskSum = Number.NaN;
    renderMask(h, null);
    h.maskDeformed = false;
    h.dirty = true;
  }
}

// ─── Per-frame update ─────────────────────────────────────────────────────

/**
 * One glow tick. Returns true while an envelope is animating (relocation
 * fade, tint crossfade, cursor tracking) — the loop then calls again every
 * animation frame so the fade is smooth instead of stepping at 15 fps.
 */
export function updateGlow(h: GlowHandles, inst: MetalFxInstance, nowMs: number, strengthMul: number, theme: 'dark' | 'light' = 'dark'): boolean {
  const { width: W, height: H, cornerRadius: R, perim } = h;
  if (perim.length === 0) return false;

  const halfWin = 2;

  let maxLum = -1, maxIdx = h.currentIdx, curLum = 0;
  for (let i = 0; i < perim.length; i++) {
    const pt = perim[i];
    const lum = sampleShaderLumAt(inst, pt.x, pt.y, halfWin);
    if (lum > maxLum) { maxLum = lum; maxIdx = i; }
    if (i === h.currentIdx) curLum = lum;
  }

  const dwellActive = h.appearedAt > 0 && nowMs - h.appearedAt < GLOW.minDwellMs;
  const targetOp = GLOW.baseOp + (GLOW.peakOp - GLOW.baseOp) * smoothstep(GLOW.lumLo, GLOW.lumHi, curLum);
  const rivalDominates = !dwellActive && maxLum - curLum > RELOCATE_DELTA;

  // Cursor as light source: while the pointer is within reach the hotspot
  // faces it (nearest outline point) and its brightness follows proximity.
  // Ring mode only — glyph masks have no continuous outline to slide along.
  const cl = inst.cursorLight;
  const cursorOn = CURSOR_LIGHT.enabled && CURSOR_LIGHT.catchLight && !h.pointMode && !!cl && cl.w > 0.02;
  const perimLen = shapePerim(W, H, R, h.kind);
  if (cursorOn) h.cursorTargetArc = arcAtPoint(cl!.x, cl!.y, W, H, R, h.kind);
  const cursorOp = cursorOn ? Math.min(1, GLOW.peakOp * CURSOR_LIGHT.catchGain * cl!.w) : 0;
  const dtMs = h.lastTickMs > 0 ? Math.min(200, Math.max(0.5, nowMs - h.lastTickMs)) : RATE_TICK_MS;
  h.lastTickMs = nowMs;
  h.envClock += Math.min(dtMs, ENV_MAX_STEP_MS);
  const rate = (perTick: number) => 1 - Math.pow(1 - perTick, dtMs / RATE_TICK_MS);

  // Relocation rules: a hotspot holds for at least `minDwellMs`; moving is
  // always disappear-in-place (relocFadeOutMs) then appear at the new point
  // (relocFadeMs). The halo never slides along the ring — except in cursor
  // mode, where the light source itself is moving.
  const fadeMs = Math.max(1, GLOW.relocFadeMs);
  const fadeOutMs = Math.max(1, GLOW.relocFadeOutMs);
  const CURSOR_ENTER = -2, CURSOR_EXIT = -3;
  const fadeIn = () => {
    h.appearedAt = nowMs;
    h.wanderS = 0; h.wanderTargetS = 0; h.wanderFrames = 0;
    h.relocTween = tween(0, 1, fadeMs, ease.smoothstep);
    tweenStart(h.relocTween, h.envClock);
  };
  const fadeOut = (next: number) => {
    h.relocNextIdx = next;
    h.relocTween = tween(1, 0, fadeOutMs, ease.smoothstep);
    tweenStart(h.relocTween, h.envClock);
  };
  if (h.relocTween?.done && h.relocTween.to === 0) {
    // Faded out at the old spot: switch, then fade in at the new one.
    let next = h.relocNextIdx;
    if (next === CURSOR_ENTER && !cursorOn) next = CURSOR_EXIT;
    if (next === CURSOR_EXIT) {
      // Back to the luminance hunt — re-appears below as a first appearance.
      h.cursorMode = false; h.appearedAt = 0; h.relocTween = null;
    } else if (next === CURSOR_ENTER) {
      h.cursorMode = true; h.cursorArc = h.cursorTargetArc; h.glowOpacity = cursorOp;
      fadeIn();
    } else {
      h.currentIdx = next;
      const np = perim[h.currentIdx];
      const nl = sampleShaderLumAt(inst, np.x, np.y, halfWin);
      h.glowOpacity = GLOW.baseOp + (GLOW.peakOp - GLOW.baseOp) * smoothstep(GLOW.lumLo, GLOW.lumHi, nl);
      fadeIn();
    }
  }
  if (!h.relocTween || h.relocTween.done) {
    if (h.appearedAt === 0) {
      // First appearance: face the cursor if it's there, else the brightest point.
      if (cursorOn) { h.cursorMode = true; h.cursorArc = h.cursorTargetArc; h.glowOpacity = cursorOp; }
      else { h.cursorMode = false; h.currentIdx = maxIdx; h.glowOpacity = targetOp; }
      fadeIn();
    } else if (cursorOn !== h.cursorMode) {
      fadeOut(cursorOn ? CURSOR_ENTER : CURSOR_EXIT);
    } else if (!h.cursorMode && rivalDominates) {
      fadeOut(maxIdx);
    }
  }
  if (h.cursorMode) {
    // Proximity-weighted, no lag; holds the last value while fading out.
    if (cursorOn) h.glowOpacity = cursorOp;
    const follow = Math.max(0.01, Math.min(1, CURSOR_LIGHT.catchFollow));
    const fa = 1 - Math.pow(1 - follow, dtMs / (1000 / 60));
    let diff = h.cursorTargetArc - h.cursorArc;
    diff = ((((diff % perimLen) + perimLen * 1.5) % perimLen) - perimLen / 2);
    h.cursorArc += diff * fa;
  } else {
    // Luminance tracking runs continuously; the envelope handles appear/disappear.
    h.glowOpacity += (targetOp - h.glowOpacity) * rate(GLOW.fadeRate);
  }
  h.glowOpacity = Math.max(0, Math.min(1, h.glowOpacity));
  h.relocMul = h.relocTween ? tweenTick(h.relocTween, h.envClock) : 1;

  const ratio = shapePerim(W, H, R, h.kind) / rrPerim(REF_W, REF_H, REF_R);
  const wanderRange = GLOW.wanderRange * ratio;
  h.wanderFrames += dtMs;
  if (h.wanderFrames >= WANDER_RETARGET_MS) { h.wanderTargetS = (Math.random() * 2 - 1) * wanderRange; h.wanderFrames = 0; }
  h.wanderS += (h.wanderTargetS - h.wanderS) * rate(GLOW.wanderLerp);

  let blobX: number, blobY: number, tangent: number, exX: number, exY: number;
  if (h.pointMode) {
    // Custom-mask instance: hotspot sits on a sampled glyph point, halo runs
    // horizontally (reads as a glint across the letterforms), wander slides
    // it along x only.
    const p = perim[h.currentIdx];
    blobX = p.x + h.wanderS; blobY = p.y; tangent = 0;
    exX = blobX; exY = blobY;
  } else {
    const blobArc = h.cursorMode ? h.cursorArc : perim[h.currentIdx].arc + h.wanderS;
    // GLOW.inset / GLOW.extraOutward are absolute units; multiply by the
    // master scale so the catch-light sits at the right perpendicular
    // distance when the host element is rendered at non-1× layout.
    const insetS = GLOW.inset * h.scale;
    sampleAtArc(blobArc, W, H, R, insetS, 0, h.kind, _pt);
    blobX = _pt.x; blobY = _pt.y;
    tangent = tangentAngleAtArc(blobArc, W, H, R, insetS, h.kind);
    const extraOut = GLOW.extraOutward * ratio * h.scale;
    sampleAtArc(blobArc, W, H, R, insetS, extraOut, h.kind, _pt);
    exX = _pt.x; exY = _pt.y;
  }
  if (h.deform) {
    h.deform(blobX, blobY, _pt); blobX = _pt.x; blobY = _pt.y;
    h.deform(exX, exY, _pt); exX = _pt.x; exY = _pt.y;
  }

  const light = theme === 'light';
  const samp = light
    ? sampleShaderRGBChromatic(inst, blobX, blobY, halfWin)
    : sampleShaderRGBAt(inst, blobX, blobY, halfWin);

  if (!h.tintTween) {
    h.tintFrom = { ...samp }; h.tintTarget = { ...samp };
    h.tintTween = tween(0, 1, TINT_FADE_MS);
    tweenStart(h.tintTween, nowMs);
    h.tintHoldUntil = light ? 0 : nowMs + TINT_HOLD_MS;
  } else if (h.tintTween.done) {
    if (light) {
      h.tintFrom = {
        r: h.tintFrom.r + (h.tintTarget.r - h.tintFrom.r) * h.tintTween.val,
        g: h.tintFrom.g + (h.tintTarget.g - h.tintFrom.g) * h.tintTween.val,
        b: h.tintFrom.b + (h.tintTarget.b - h.tintFrom.b) * h.tintTween.val,
      };
      h.tintTarget = { ...samp };
      h.tintTween = tween(0, 1, TINT_FADE_MS);
      tweenStart(h.tintTween, nowMs);
    } else if (nowMs >= h.tintHoldUntil) {
      h.tintFrom = { ...h.tintTarget };
      h.tintTarget = { ...samp };
      h.tintTween = tween(0, 1, TINT_FADE_MS);
      tweenStart(h.tintTween, nowMs);
      h.tintHoldUntil = nowMs + TINT_HOLD_MS;
    }
  }
  tweenTick(h.tintTween!, nowMs);
  const ft = h.tintTween!.val;

  let tR: number, tG: number, tB: number;
  if (light) {
    tR = Math.round(h.tintFrom.r + (h.tintTarget.r - h.tintFrom.r) * ft);
    tG = Math.round(h.tintFrom.g + (h.tintTarget.g - h.tintFrom.g) * ft);
    tB = Math.round(h.tintFrom.b + (h.tintTarget.b - h.tintFrom.b) * ft);
  } else {
    const hR = h.tintFrom.r + (h.tintTarget.r - h.tintFrom.r) * ft;
    const hG = h.tintFrom.g + (h.tintTarget.g - h.tintFrom.g) * ft;
    const hB = h.tintFrom.b + (h.tintTarget.b - h.tintFrom.b) * ft;
    const peak = Math.max(hR, hG, hB) || 1;
    tR = Math.round(255 * (hR / peak)); tG = Math.round(255 * (hG / peak)); tB = Math.round(255 * (hB / peak));
  }
  const haloTint = `rgb(${tR},${tG},${tB})`;
  let extraTint = '#ffffff';
  if (light) {
    const hsv = rgbToHsv(tR, tG, tB);
    const [er, eg, eb] = hsvToRgb(hsv[0], Math.min(1, hsv[1] * LT_SAT_BOOST), Math.max(LT_MIN_VAL, hsv[2] * LT_VAL_MULT));
    extraTint = `rgb(${er},${eg},${eb})`;
  }

  const m = Math.max(0, Math.min(1, strengthMul)) * (h.pointMode ? GLOW.pointGain : 1);
  const haloOp = Math.min(1, h.glowOpacity * GLOW.haloOpMul * m);
  const extraOp = Math.min(1, h.glowOpacity * GLOW.extraIntensity * m);

  // The appear/disappear envelope is element opacity: a compositor-only
  // change, so it can run every animation frame for free. Only movement,
  // tint and luminance changes redraw the canvas.
  if (Math.abs(h.relocMul - h.dEnv) > 0.002) {
    const arrived = h.relocMul >= 0.998 && h.dEnv < 0.998;
    h.dEnv = h.relocMul;
    h.env.style.opacity = h.relocMul.toFixed(3);
    // Fresh content once fully visible — a nudge for engines that only
    // re-upload a canvas when something in it changes.
    if (arrived) h.dirty = true;
  }

  const animating = !!(h.relocTween && !h.relocTween.done) || h.cursorMode;

  // Skip the draw when nothing visible changed.
  const moved = !(Math.abs(blobX - h.dX) < POS_EPS && Math.abs(blobY - h.dY) < POS_EPS &&
                  Math.abs(tangent - h.dAng) < ANG_EPS &&
                  Math.abs(exX - h.dEX) < POS_EPS && Math.abs(exY - h.dEY) < POS_EPS);
  const faded = !(Math.abs(haloOp - h.dHOp) < OP_EPS && Math.abs(extraOp - h.dEOp) < OP_EPS);
  const tinted = haloTint !== h.dHaloTint || extraTint !== h.dExtraTint;
  if (!(h.dirty || moved || faded || tinted)) return animating;
  h.dX = blobX; h.dY = blobY; h.dAng = tangent; h.dEX = exX; h.dEY = exY;
  h.dHOp = haloOp; h.dEOp = extraOp; h.dHaloTint = haloTint; h.dExtraTint = extraTint;
  h.dirty = false;
  draw(h, blobX, blobY, tangent, exX, exY, haloOp, extraOp, haloTint, extraTint);
  return animating;
}

// ─── Drawing ──────────────────────────────────────────────────────────────

function draw(
  h: GlowHandles,
  bx: number, by: number, ang: number, ex: number, ey: number,
  haloOp: number, extraOp: number, haloTint: string, extraTint: string
): void {
  const { ctx: g, canvas: c, dpr, margin: m } = h;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over';
  g.globalAlpha = 1;
  g.clearRect(0, 0, c.width, c.height);
  if ((haloOp <= 0.002 && extraOp <= 0.002) || !h.maskReady) return;

  const haloImg = haloOp > 0.002 ? tintSprite(h.halo, ...parseRgb(haloTint), h.haloTint) : null;
  const extraImg = extraOp > 0.002
    ? (extraTint === '#ffffff' ? h.extra.canvas : tintSprite(h.extra, ...parseRgb(extraTint), h.extraTint))
    : null;

  const sprites = (mul: number) => {
    if (haloImg) {
      g.save();
      g.translate(bx + m, by + m);
      g.rotate(ang);
      g.globalAlpha = haloOp * mul;
      g.drawImage(haloImg, -h.halo.ax, -h.halo.ay, h.halo.w, h.halo.h);
      g.restore();
    }
    if (extraImg) {
      g.save();
      g.translate(ex + m, ey + m);
      g.rotate(ang);
      g.globalAlpha = extraOp * mul;
      g.drawImage(extraImg, -h.extra.ax, -h.extra.ay, h.extra.w, h.extra.h);
      g.restore();
    }
  };

  if (!h.pointMode && h.surroundPath && h.bandPath) {
    // Two disjoint clip regions: outside the ring at half strength, the band
    // at full. Plain source-over inside each, so nothing for WebKit to get
    // wrong.
    g.save(); g.scale(dpr, dpr); g.clip(h.surroundPath, 'evenodd'); sprites(0.5); g.restore();
    g.save(); g.scale(dpr, dpr); g.clip(h.bandPath, 'evenodd'); sprites(1); g.restore();
    return;
  }

  // Point mode: draw, then multiply alpha by the glyph mask in pixel data.
  g.save(); g.scale(dpr, dpr); sprites(1); g.restore();
  const a = h.maskAlpha;
  if (!a) return;
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  for (let i = 0, j = 3; i < a.length; i++, j += 4) {
    const ma = a[i];
    if (ma === 255) continue;
    if (ma === 0) { d[j] = 0; continue; }
    d[j] = (d[j] * ma + 127) / 255;
  }
  g.putImageData(img, 0, 0);
}

const _rgb: [number, number, number] = [255, 255, 255];
function parseRgb(css: string): [number, number, number] {
  if (css[0] === '#') {
    _rgb[0] = parseInt(css.slice(1, 3), 16); _rgb[1] = parseInt(css.slice(3, 5), 16); _rgb[2] = parseInt(css.slice(5, 7), 16);
    return _rgb;
  }
  // "rgb(r,g,b)"
  let i = 4, n = 0, k = 0;
  while (i < css.length && k < 3) {
    const ch = css.charCodeAt(i++);
    if (ch >= 48 && ch <= 57) n = n * 10 + (ch - 48);
    else if (ch === 44 || ch === 41) { _rgb[k++] = n; n = 0; }
  }
  return _rgb;
}

/**
 * Carry the visible state of a glow across a rebuild (a real resize), so the
 * halo keeps its hotspot, brightness and fade instead of restarting from
 * invisible. Only state — never geometry, sprites or masks.
 */
export function carryGlowState(prev: GlowHandles, next: GlowHandles): void {
  if (prev.pointMode !== next.pointMode) return;
  next.currentIdx = Math.min(prev.currentIdx, Math.max(0, next.perim.length - 1));
  next.appearedAt = prev.appearedAt;
  next.glowOpacity = prev.glowOpacity;
  next.relocTween = prev.relocTween;
  next.relocNextIdx = prev.relocNextIdx;
  next.relocMul = prev.relocMul;
  next.envClock = prev.envClock;
  next.cursorMode = prev.cursorMode;
  next.cursorArc = prev.cursorArc;
  next.cursorTargetArc = prev.cursorTargetArc;
  next.lastTickMs = prev.lastTickMs;
  next.wanderS = prev.wanderS; next.wanderTargetS = prev.wanderTargetS; next.wanderFrames = prev.wanderFrames;
  next.tintFrom = prev.tintFrom; next.tintTarget = prev.tintTarget;
  next.tintTween = prev.tintTween; next.tintHoldUntil = prev.tintHoldUntil;
  next.dEnv = prev.relocMul;
  next.env.style.opacity = prev.relocMul.toFixed(3);
}

export function resizeGlow(handles: GlowHandles, container: HTMLElement, opts: GlowOptions): GlowHandles {
  for (const el of Array.from(container.querySelectorAll('.metal-fx-glow-svg'))) {
    if (el.parentNode === container) container.removeChild(el);
  }
  void handles;
  return injectGlow(container, opts);
}
