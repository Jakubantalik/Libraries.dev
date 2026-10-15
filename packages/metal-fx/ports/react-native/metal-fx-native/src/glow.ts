/**
 * The wandering halo — the web's glow state machine (luminance hunt, dwell,
 * fade-out / fade-in relocation, wander, tint hold) as a UI-thread worklet,
 * plus the baked halo / catch-light sprites (Skia offscreen surfaces).
 */
import { BlendMode, Skia, PaintStyle, StrokeCap, StrokeJoin, TileMode, type SkImage } from '@shopify/react-native-skia';
import { rrPerim, sampleAtArc, shapePerim, tangentAngleAtArc, type Pt, type ShapeKind } from './geometry';

export interface GlowConfig {
  haloOpMul: number;
  extraIntensity: number;
  peakOp: number;
  baseOp: number;
  inset: number;
  extraOutward: number;
  wanderRange: number;
  wanderLerp: number;
  fadeRate: number;
  lumLo: number;
  lumHi: number;
  minDwellMs: number;
  relocFadeMs: number;
  relocFadeOutMs: number;
  pointGain: number;
  haloHalfLen: number;
  extraHalfLen: number;
  haloStrokeXl: number; haloStrokeLg: number; haloStrokeMd: number; haloStrokeSm: number;
  haloBlurXl: number; haloBlurLg: number; haloBlurMd: number; haloBlurSm: number;
  haloOpXl: number; haloOpLg: number; haloOpMd: number; haloOpSm: number;
  extraStrokeOuter: number; extraStrokeCore: number;
  extraBlurOuter: number; extraBlurCore: number;
  extraFadeR: number;
  extraOpOuter: number;
}

export const GLOW_DEFAULTS: GlowConfig = {
  haloOpMul: 2.0,
  extraIntensity: 3.51,
  peakOp: 0.85,
  baseOp: 0.34,
  inset: 1.5,
  extraOutward: 1.0,
  wanderRange: 15,
  wanderLerp: 0.0075,
  fadeRate: 0.00875,
  lumLo: 0.08,
  lumHi: 0.32,
  minDwellMs: 1500,
  relocFadeMs: 300,
  relocFadeOutMs: 450,
  pointGain: 2.5,
  haloHalfLen: 7.8,
  extraHalfLen: 9.13952 / 3,
  haloStrokeXl: 26.4, haloStrokeLg: 15.6, haloStrokeMd: 7.2, haloStrokeSm: 3.0,
  haloBlurXl: 8.4, haloBlurLg: 4.8, haloBlurMd: 2.1, haloBlurSm: 0.9,
  haloOpXl: 0.385, haloOpLg: 0.595, haloOpMd: 0.70, haloOpSm: 0.70,
  extraStrokeOuter: 4.0 / 3, extraStrokeCore: 2.0 / 3,
  extraBlurOuter: 2.0 / 3, extraBlurCore: 1.35 / 3,
  extraFadeR: 13.0 / 3,
  extraOpOuter: 0.85,
};

export interface GlowFrame {
  x: number; y: number;
  ex: number; ey: number;
  tangent: number;
  haloOp: number;
  extraOp: number;
  env: number;
  tint: [number, number, number];
}

export interface GlowPerim { x: number; y: number; arc: number }

/** Mutable glow state, kept in a shared value and stepped by `glowTick`. */
export interface GlowState {
  perim: GlowPerim[];
  pointMode: boolean;
  w: number; h: number; r: number; kind: ShapeKind;
  currentIdx: number;
  glowOpacity: number;
  appearedAt: number;
  relocNextIdx: number;
  tween: { from: number; to: number; dur: number; start: number; done: boolean; val: number } | null;
  relocMul: number;
  envClock: number;
  lastTickMs: number;
  lastHuntMs: number;
  lum: number[];
  wanderS: number; wanderTargetS: number; wanderMs: number;
  tintFrom: [number, number, number]; tintTarget: [number, number, number];
  tintTween: { from: number; to: number; dur: number; start: number; done: boolean; val: number } | null;
  tintHoldUntil: number;
}

export function initialGlowState(): GlowState {
  return {
    perim: [], pointMode: false, w: 0, h: 0, r: 0, kind: 'pill',
    currentIdx: 0, glowOpacity: 0, appearedAt: 0, relocNextIdx: 0, tween: null, relocMul: 0,
    envClock: 0, lastTickMs: 0, lastHuntMs: 0, lum: [],
    wanderS: 0, wanderTargetS: 0, wanderMs: 0,
    tintFrom: [1, 1, 1], tintTarget: [1, 1, 1], tintTween: null, tintHoldUntil: 0,
  };
}

const RELOCATE_DELTA = 0.05;
const WANDER_RETARGET_MS = 120 * (1000 / 15);
const RATE_TICK_MS = 1000 / 15;
const HUNT_MS = 66;
const TINT_HOLD_MS = 2000, TINT_FADE_MS = 400;
const ENV_MAX_STEP_MS = 34;

function ss(e0: number, e1: number, x: number): number {
  'worklet';
  const t = Math.min(1, Math.max(0, (x - e0) / Math.max(1e-9, e1 - e0)));
  return t * t * (3 - 2 * t);
}

function tweenTick(tw: { from: number; to: number; dur: number; start: number; done: boolean; val: number }, clock: number): number {
  'worklet';
  const t = Math.min(1, Math.max(0, (clock - tw.start) / Math.max(1, tw.dur)));
  const e = t * t * (3 - 2 * t);
  tw.val = t >= 1 ? tw.to : tw.from + (tw.to - tw.from) * e;
  tw.done = t >= 1;
  return tw.val;
}

/** Rebuild the perimeter table when the box (or the glyph mask) changes. */
export function configureGlow(s: GlowState, w: number, h: number, r: number, kind: ShapeKind, cfg: GlowConfig, samplePoints?: Pt[] | null): void {
  'worklet';
  const pm = !!samplePoints;
  if (s.w === w && s.h === h && s.r === r && s.kind === kind && s.pointMode === pm && s.perim.length > 0) return;
  s.w = w; s.h = h; s.r = r; s.kind = kind;
  if (samplePoints) {
    s.pointMode = true;
    s.perim = samplePoints.map((p) => ({ x: p.x, y: p.y, arc: 0 }));
  } else {
    s.pointMode = false;
    const n = 16;
    const total = shapePerim(w, h, r, kind);
    const out: GlowPerim[] = [];
    for (let i = 0; i < n; i++) {
      const arc = (total * i) / n;
      const p = sampleAtArc(arc, w, h, r, cfg.inset, 0, kind);
      out.push({ x: p.x, y: p.y, arc });
    }
    s.perim = out;
  }
  s.lum = new Array(s.perim.length).fill(0);
  if (s.currentIdx >= s.perim.length) s.currentIdx = 0;
}

/** Advance the state; returns the frame to draw or null. */
export function glowTick(
  s: GlowState, nowMs: number,
  lumAt: (x: number, y: number) => number,
  rgbAt: (x: number, y: number) => [number, number, number],
  strength: number, light: boolean,
  deform: ((x: number, y: number) => Pt) | null,
  cfg: GlowConfig
): GlowFrame | null {
  'worklet';
  if (s.perim.length === 0) return null;
  const dtMs = s.lastTickMs > 0 ? Math.min(200, Math.max(0.5, nowMs - s.lastTickMs)) : RATE_TICK_MS;
  s.lastTickMs = nowMs;
  s.envClock += Math.min(dtMs, ENV_MAX_STEP_MS);
  const rate = (perTick: number) => 1 - Math.pow(1 - perTick, dtMs / RATE_TICK_MS);

  if (nowMs - s.lastHuntMs >= HUNT_MS || s.lastHuntMs === 0) {
    s.lastHuntMs = nowMs;
    for (let i = 0; i < s.perim.length; i++) s.lum[i] = lumAt(s.perim[i].x, s.perim[i].y);
  }
  let maxLum = -1, maxIdx = s.currentIdx;
  for (let i = 0; i < s.perim.length; i++) if (s.lum[i] > maxLum) { maxLum = s.lum[i]; maxIdx = i; }
  const curLum = s.lum[s.currentIdx];

  const dwellActive = s.appearedAt > 0 && nowMs - s.appearedAt < cfg.minDwellMs;
  const targetOp = cfg.baseOp + (cfg.peakOp - cfg.baseOp) * ss(cfg.lumLo, cfg.lumHi, curLum);
  const rivalDominates = !dwellActive && maxLum - curLum > RELOCATE_DELTA;
  const fadeMs = Math.max(1, cfg.relocFadeMs), fadeOutMs = Math.max(1, cfg.relocFadeOutMs);
  const fadeIn = () => {
    s.appearedAt = nowMs; s.wanderS = 0; s.wanderTargetS = 0; s.wanderMs = 0;
    s.tween = { from: 0, to: 1, dur: fadeMs, start: s.envClock, done: false, val: 0 };
  };
  const fadeOut = (next: number) => {
    s.relocNextIdx = next;
    s.tween = { from: 1, to: 0, dur: fadeOutMs, start: s.envClock, done: false, val: 1 };
  };
  if (s.tween && s.tween.done && s.tween.to === 0) {
    s.currentIdx = s.relocNextIdx;
    s.glowOpacity = cfg.baseOp + (cfg.peakOp - cfg.baseOp) * ss(cfg.lumLo, cfg.lumHi, s.lum[s.currentIdx]);
    fadeIn();
  }
  if (!s.tween || s.tween.done) {
    if (s.appearedAt === 0) { s.currentIdx = maxIdx; s.glowOpacity = targetOp; fadeIn(); }
    else if (rivalDominates) fadeOut(maxIdx);
  }
  s.glowOpacity += (targetOp - s.glowOpacity) * rate(cfg.fadeRate);
  s.glowOpacity = Math.min(1, Math.max(0, s.glowOpacity));
  s.relocMul = s.tween ? tweenTick(s.tween, s.envClock) : 1;

  const ratio = shapePerim(s.w, s.h, s.r, s.kind) / rrPerim(140, 40, 20);
  s.wanderMs += dtMs;
  if (s.wanderMs >= WANDER_RETARGET_MS) { s.wanderTargetS = (Math.random() * 2 - 1) * cfg.wanderRange * ratio; s.wanderMs = 0; }
  s.wanderS += (s.wanderTargetS - s.wanderS) * rate(cfg.wanderLerp);

  let bx: number, by: number, tangent: number, ex: number, ey: number;
  if (s.pointMode) {
    const p = s.perim[s.currentIdx];
    bx = p.x + s.wanderS; by = p.y; tangent = 0; ex = bx; ey = by;
  } else {
    const arc = s.perim[s.currentIdx].arc + s.wanderS;
    const b = sampleAtArc(arc, s.w, s.h, s.r, cfg.inset, 0, s.kind);
    bx = b.x; by = b.y;
    tangent = tangentAngleAtArc(arc, s.w, s.h, s.r, cfg.inset, s.kind);
    const e = sampleAtArc(arc, s.w, s.h, s.r, cfg.inset, cfg.extraOutward * ratio, s.kind);
    ex = e.x; ey = e.y;
  }
  if (deform) { const d = deform(bx, by); bx = d.x; by = d.y; const e = deform(ex, ey); ex = e.x; ey = e.y; }

  const samp = rgbAt(bx, by);
  if (!s.tintTween) {
    s.tintFrom = samp; s.tintTarget = samp;
    s.tintTween = { from: 0, to: 1, dur: TINT_FADE_MS, start: nowMs, done: false, val: 0 };
    s.tintHoldUntil = light ? 0 : nowMs + TINT_HOLD_MS;
  } else if (s.tintTween.done) {
    if (light) {
      const v = s.tintTween.val;
      s.tintFrom = [s.tintFrom[0] + (s.tintTarget[0] - s.tintFrom[0]) * v, s.tintFrom[1] + (s.tintTarget[1] - s.tintFrom[1]) * v, s.tintFrom[2] + (s.tintTarget[2] - s.tintFrom[2]) * v];
      s.tintTarget = samp;
      s.tintTween = { from: 0, to: 1, dur: TINT_FADE_MS, start: nowMs, done: false, val: 0 };
    } else if (nowMs >= s.tintHoldUntil) {
      s.tintFrom = s.tintTarget; s.tintTarget = samp;
      s.tintTween = { from: 0, to: 1, dur: TINT_FADE_MS, start: nowMs, done: false, val: 0 };
      s.tintHoldUntil = nowMs + TINT_HOLD_MS;
    }
  }
  const ft = tweenTick(s.tintTween, nowMs);
  let tint: [number, number, number] = [
    s.tintFrom[0] + (s.tintTarget[0] - s.tintFrom[0]) * ft,
    s.tintFrom[1] + (s.tintTarget[1] - s.tintFrom[1]) * ft,
    s.tintFrom[2] + (s.tintTarget[2] - s.tintFrom[2]) * ft,
  ];
  if (!light) {
    const peak = Math.max(tint[0], tint[1], tint[2]);
    if (peak > 0) tint = [tint[0] / peak, tint[1] / peak, tint[2] / peak];
  }
  const m = Math.min(1, Math.max(0, strength)) * (s.pointMode ? cfg.pointGain : 1);
  return {
    x: bx, y: by, ex, ey, tangent,
    haloOp: Math.min(1, s.glowOpacity * cfg.haloOpMul * m),
    extraOp: Math.min(1, s.glowOpacity * cfg.extraIntensity * m),
    env: s.relocMul, tint,
  };
}

// ─── Sprites ──────────────────────────────────────────────────────────────

export interface GlowSprite { image: SkImage; w: number; h: number; scale: number }

interface Layer { stroke: number; blur: number; opacity: number }
const cache = new Map<string, GlowSprite>();

/** White, alpha-only, symmetric: the segment's midpoint is the image centre. */
function compose(layers: Layer[], halfLen: number, s: number, scale: number, fade: number): GlowSprite {
  let padMax = 0;
  for (const l of layers) padMax = Math.max(padMax, (l.stroke / 2 + 3 * l.blur) * s);
  const pad = Math.ceil(padMax) + 1;
  const cw = 2 * halfLen + 2 * pad, ch = 2 * pad;
  const w = Math.ceil(cw * scale), h = Math.ceil(ch * scale);
  // A raster surface: it carries alpha. The GPU offscreen surface came back
  // opaque, which turned the sprite into a black rectangle with a line on it.
  const surface = Skia.Surface.Make(w, h);
  if (!surface) throw new Error('metal-fx-native: could not create a glow surface');
  const canvas = surface.getCanvas();
  canvas.clear(Skia.Color('transparent'));
  canvas.scale(scale, scale);
  for (const l of layers) {
    const paint = Skia.Paint();
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeCap(StrokeCap.Round);
    paint.setStrokeJoin(StrokeJoin.Round);
    paint.setStrokeWidth(l.stroke * s);
    paint.setColor(Skia.Color(`rgba(255,255,255,${l.opacity})`));
    if (l.blur > 0) paint.setImageFilter(Skia.ImageFilter.MakeBlur(l.blur * s, l.blur * s, TileMode.Decal, null));
    const path = Skia.Path.Make();
    path.moveTo(pad, pad);
    path.lineTo(pad + 2 * halfLen, pad);
    canvas.drawPath(path, paint);
  }
  if (fade > 0) {
    // Radial end fade: opaque to 30 %, 25 % at 65 %, gone at the radius.
    const R = fade * s;
    const mask = Skia.Paint();
    mask.setBlendMode(BlendMode.DstIn);
    mask.setShader(Skia.Shader.MakeRadialGradient(
      { x: pad + halfLen, y: pad }, R + halfLen,
      [Skia.Color('white'), Skia.Color('white'), Skia.Color('rgba(255,255,255,0.25)'), Skia.Color('rgba(255,255,255,0)')],
      [0, 0.3, 0.65, 1], TileMode.Clamp
    ));
    canvas.drawRect({ x: 0, y: 0, width: cw, height: ch }, mask);
  }
  surface.flush();
  return { image: surface.makeImageSnapshot(), w: cw, h: ch, scale };
}

export function haloSprite(halfLen: number, s: number, scale: number, cfg: GlowConfig): GlowSprite {
  const key = `h|${halfLen.toFixed(2)}|${s}|${scale}|${cfg.haloStrokeXl},${cfg.haloBlurXl},${cfg.haloOpXl}`;
  let sp = cache.get(key);
  if (!sp) {
    sp = compose([
      { stroke: cfg.haloStrokeXl, blur: cfg.haloBlurXl, opacity: cfg.haloOpXl },
      { stroke: cfg.haloStrokeLg, blur: cfg.haloBlurLg, opacity: cfg.haloOpLg },
      { stroke: cfg.haloStrokeMd, blur: cfg.haloBlurMd, opacity: cfg.haloOpMd },
      { stroke: cfg.haloStrokeSm, blur: cfg.haloBlurSm, opacity: cfg.haloOpSm },
    ], halfLen, s, scale, 0);
    cache.set(key, sp);
  }
  return sp;
}

export function extraSprite(halfLen: number, s: number, scale: number, cfg: GlowConfig): GlowSprite {
  const key = `e|${halfLen.toFixed(2)}|${s}|${scale}|${cfg.extraStrokeOuter},${cfg.extraFadeR}`;
  let sp = cache.get(key);
  if (!sp) {
    sp = compose([
      { stroke: cfg.extraStrokeOuter, blur: cfg.extraBlurOuter, opacity: cfg.extraOpOuter },
      { stroke: cfg.extraStrokeCore, blur: cfg.extraBlurCore, opacity: 1 },
    ], halfLen, s, scale, cfg.extraFadeR);
    cache.set(key, sp);
  }
  return sp;
}
