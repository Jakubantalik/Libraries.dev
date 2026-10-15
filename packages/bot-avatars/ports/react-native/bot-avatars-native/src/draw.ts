/* The renderer, as a worklet: the web's draw.ts and the plastic cap of
   plastic.ts on a Skia canvas. The body is a stack of copies of its
   outline, spaced along a depth axis with a pillow profile, each copy
   projected with the head's yaw and pitch — the same affines, applied
   relative to the previous slice's with one concat each. In `plastic`
   the side copies are filled with sweep gradients sampled from the
   material (rebuilt only once the light or the view has moved a bin),
   and the front cap is the outline filled with the cap shader: the
   baked form lit per pixel. The face lives on a sphere behind the cap.

   Everything here runs on the UI thread from a shared frame array; the
   only per-frame Skia objects are the picture and the cap's shader
   (its uniforms change every frame). */

import { BlendMode, ClipOp, FilterMode, MipmapMode, PaintStyle, Skia, StrokeCap, StrokeJoin, TileMode, type SkCanvas, type SkImage, type SkPaint, type SkPath, type SkPathBuilder, type SkShader, type SkSurface } from '@shopify/react-native-skia';
import { CAP_UNIFORMS, capUniforms, lightRing, type LightFrame, type V3 } from './light';
import { SLICES, type DrawConfig, type RGB } from './palette';
import type { Resources } from './forms';
import { OVERSCAN, PK, RISE } from './packet';

const CONIC_STOPS = 24;
const PAD = 3;
const SPAN = 106;
const profile = (z: number, cap: number) => {
  'worklet';
  return cap + (1 - cap) * Math.sqrt(Math.max(0, 1 - z * z));
};

/* Big, plain dark eyes: they carry the face at 24px. */
const EYE_GAP = 25;
const EYE_RX = 6.3;
const EYE_Y_EYES = 1;
const EYE_Y_MOUTH = -3.5;
const EYE_STEPS = 8;
/* Radius of the sphere the face is drawn on, in body units. */
const FACE_R = 30;
const MOUTH_SIN = Math.sin(0.684), MOUTH_COS = Math.cos(0.684);

const WHIRL_SEGMENTS = 34;
const WHIRL_SPAN = Math.PI * 1.55;
const WHIRL_RX = 57;
const WHIRL_RATIO = 0.4;
const WHIRL_TILT = -0.28;

/* the matcap is rebuilt once a direction has moved a bin (1/48) from the
   one it was built for */
const BIN = 1 / 48;
/** each side gradient: the matcap tilt it samples and its darkening */
const SIDE_NZ = [0.55, 0, 0];

/* ── per-instance state, on the runtime that draws ─────────────────── */

interface Inst {
  v: number;
  rect: { x: number; y: number; width: number; height: number };
  mat: number[];
  solid: SkPaint;
  crispLit: SkPaint;
  crispCap: SkPaint;
  side: SkPaint[];
  sideCols: Float32Array[][];
  sideL: V3;
  sideV: V3;
  sideLxy: [number, number];
  sideValid: boolean;
  cap: SkPaint;
  uni: number[];
  formImg: SkImage | null;
  formShader: SkShader | null;
  partsImg: SkImage | null;
  partsShader: SkShader | null;
  ink: SkPaint;
  inkFill: SkPaint;
  smoothShadow: SkPaint;
  smoothLight: SkPaint;
  hair: SkPaint;
  whirl: SkPaint[];
  whirlPath: SkPathBuilder;
  /** plastic: the outline filled with each side gradient, blitted per
      slice instead of filled — a path fill is CPU work in Ganesh, an
      image draw is a quad; one set for the body, one for the parts */
  sprites: Sprites[];
  sprVersion: number;
  sprOk: boolean;
  sprSrc: { x: number; y: number; width: number; height: number };
  sprDst: { x: number; y: number; width: number; height: number };
  blit: SkPaint;
  colors: { base: Float32Array; near: Float32Array; capTop: Float32Array; crisp: (Float32Array | null)[]; smooth: Float32Array[] };
  out: V3;
  frame: LightFrame;
}
interface Sprites {
  version: number;
  px: number;
  surfaces: (SkSurface | null)[];
  images: (SkImage | null)[];
}
interface Store {
  inst: Record<string, Inst>;
  eyes: Map<number, SkPath>;
  mouths: Map<string, SkPath>;
  stats: { frames: number; ms: number; rebuilds: number };
  pos: number[];
  clear: Float32Array;
}

function store(): Store {
  'worklet';
  const g = globalThis as unknown as { __botAvatarsNative?: Store };
  if (!g.__botAvatarsNative) {
    const pos: number[] = [];
    for (let i = 0; i <= CONIC_STOPS; i++) pos.push(i / CONIC_STOPS);
    g.__botAvatarsNative = { inst: {}, eyes: new Map(), mouths: new Map(), stats: { frames: 0, ms: 0, rebuilds: 0 }, pos, clear: Skia.Color([0, 0, 0, 0]) };
  }
  return g.__botAvatarsNative;
}

/** UI-thread cost of recording: frames recorded and milliseconds spent since the last read. */
export function readBotAvatarUiStats(): { frames: number; ms: number; rebuilds: number } {
  'worklet';
  const s = store().stats;
  const r = { frames: s.frames, ms: s.ms, rebuilds: s.rebuilds };
  s.frames = 0;
  s.ms = 0;
  s.rebuilds = 0;
  return r;
}
/** Drop an instance's paints (on unmount). */
export function releaseBotAvatarInstance(key: string) {
  'worklet';
  delete store().inst[key];
}

const now = (): number => {
  'worklet';
  const g = globalThis as unknown as { performance?: { now(): number }; _getAnimationTimestamp?: () => number };
  return g.performance ? g.performance.now() : g._getAnimationTimestamp ? g._getAnimationTimestamp() : 0;
};

const col = (c: RGB, a = 1): Float32Array => {
  'worklet';
  return Skia.Color([c[0], c[1], c[2], a]);
};

function fillPaint(): SkPaint {
  'worklet';
  const p = Skia.Paint();
  p.setAntiAlias(true);
  return p;
}
function strokePaint(cap: StrokeCap): SkPaint {
  'worklet';
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeCap(cap);
  p.setStrokeJoin(StrokeJoin.Round);
  return p;
}
function v3(): V3 {
  'worklet';
  return [0, 0, 0];
}

function makeInst(full: number): Inst {
  'worklet';
  const sideCols: Float32Array[][] = [];
  for (let k = 0; k < 3; k++) {
    const cs: Float32Array[] = [];
    for (let s = 0; s <= CONIC_STOPS; s++) cs.push(new Float32Array([0, 0, 0, 1]));
    sideCols.push(cs);
  }
  const whirl: SkPaint[] = [];
  for (let i = 0; i < 6; i++) whirl.push(strokePaint(StrokeCap.Butt));
  const uni: number[] = [];
  for (let i = 0; i < CAP_UNIFORMS; i++) uni.push(0);
  const hair = strokePaint(StrokeCap.Butt);
  hair.setStrokeWidth(1.3);
  hair.setBlendMode(BlendMode.SrcATop);
  return {
    v: -1,
    rect: { x: 0, y: 0, width: full, height: full },
    mat: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    solid: fillPaint(),
    crispLit: fillPaint(),
    crispCap: fillPaint(),
    side: [fillPaint(), fillPaint(), fillPaint()],
    sideCols,
    sideL: v3(),
    sideV: v3(),
    sideLxy: [0, -1],
    sideValid: false,
    cap: fillPaint(),
    uni,
    formImg: null,
    formShader: null,
    partsImg: null,
    partsShader: null,
    ink: strokePaint(StrokeCap.Round),
    inkFill: fillPaint(),
    smoothShadow: fillPaint(),
    smoothLight: fillPaint(),
    hair,
    whirl,
    whirlPath: Skia.PathBuilder.Make(),
    sprites: [
      { version: -1, px: 0, surfaces: [null, null, null], images: [null, null, null] },
      { version: -1, px: 0, surfaces: [null, null, null], images: [null, null, null] },
    ],
    sprVersion: 0,
    sprOk: true,
    sprSrc: { x: 0, y: 0, width: 1, height: 1 },
    sprDst: { x: -PAD, y: -PAD, width: SPAN, height: SPAN },
    blit: fillPaint(),
    colors: { base: new Float32Array(4), near: new Float32Array(4), capTop: new Float32Array(4), crisp: [], smooth: [] },
    out: v3(),
    frame: { L: v3(), V: v3(), H: v3(), U: v3(), W: v3(), A: v3(), B: v3() },
  };
}

/* everything that follows the configuration, not the frame */
function configure(inst: Inst, cfg: DrawConfig) {
  'worklet';
  inst.v = cfg.v;
  inst.sideValid = false;
  const { lx, ly } = cfg;
  inst.colors.base = col(cfg.base);
  inst.colors.near = col(cfg.near);
  inst.colors.capTop = col(cfg.capTop);
  inst.colors.crisp = cfg.crispMix.map((c) => (c ? col(c) : null));
  inst.colors.smooth = cfg.smoothMix.map((c) => col(c));
  /* crisp: the lit side and cap gradients, in the slice's own space, as the web has them */
  inst.crispLit.setShader(Skia.Shader.MakeLinearGradient({ x: lx * 56, y: ly * 56 }, { x: -lx * 56, y: -ly * 56 }, [col(cfg.light), col(cfg.near), col(cfg.dark)], [0, 0.45, 1], TileMode.Clamp));
  inst.crispCap.setShader(Skia.Shader.MakeLinearGradient({ x: lx * 46, y: ly * 46 }, { x: -lx * 46, y: -ly * 46 }, [col(cfg.capTop), col(cfg.capBottom)], [0, 1], TileMode.Clamp));
  /* smooth: a soft shadow from the lower right and a light from the upper left */
  const sa = Math.min(1, 0.34 * cfg.shadow), spread = cfg.spread;
  inst.smoothShadow.setShader(Skia.Shader.MakeTwoPointConicalGradient({ x: -lx * 45, y: -ly * 45 }, 4 * spread, { x: -lx * 45, y: -ly * 45 }, 84 * spread, [Skia.Color([0, 0, 0, sa]), Skia.Color([0, 0, 0, sa * 0.35]), Skia.Color([0, 0, 0, 0])], [0, 0.5, 1], TileMode.Clamp));
  inst.smoothShadow.setBlendMode(BlendMode.Multiply);
  const ha = Math.min(1, 0.22 * cfg.highlight);
  inst.smoothLight.setShader(Skia.Shader.MakeRadialGradient({ x: lx * 37, y: ly * 37 }, 62 * spread, [Skia.Color([1, 1, 1, ha]), Skia.Color([1, 1, 1, ha * 0.23]), Skia.Color([1, 1, 1, 0])], [0, 0.6, 1], TileMode.Clamp));
  inst.ink.setColor(col(cfg.ink));
  inst.inkFill.setColor(col(cfg.ink));
  const w = cfg.whirlInk;
  inst.whirl[0].setColor(col(w.halo));
  inst.whirl[1].setColor(col(w.dark));
  inst.whirl[2].setColor(col(w.base));
  inst.whirl[3].setColor(col(w.light));
  inst.whirl[4].setColor(Skia.Color([1, 1, 1, 1]));
  inst.whirl[5].setColor(Skia.Color([0, 0, 0, 1]));
}

const moved = (a: V3, b: V3) => {
  'worklet';
  return Math.abs(a[0] - b[0]) >= BIN || Math.abs(a[1] - b[1]) >= BIN || Math.abs(a[2] - b[2]) >= BIN;
};

/* the side gradients: the near shoulder, the rim, the far shoulder in
   shade — CONIC_STOPS stops round the outline's centre, each the material
   evaluated for the normal at that angle, with the canvas's integer
   colour channels */
function sideGradients(st: Store, inst: Inst, cfg: DrawConfig, f: LightFrame) {
  'worklet';
  st.stats.rebuilds++;
  const l = Math.hypot(f.L[0], f.L[1]);
  const lxy = inst.sideLxy;
  if (l < 0.05) {
    lxy[0] = 0;
    lxy[1] = -1;
  } else {
    lxy[0] = f.L[0] / l;
    lxy[1] = f.L[1] / l;
  }
  const out = inst.out;
  const pos = st.pos;
  for (let k = 0; k < 3; k++) {
    const dark = k === 2 ? Math.min(0.6, 0.25 * cfg.shadow) : 0;
    const cs = inst.sideCols[k];
    for (let s = 0; s <= CONIC_STOPS; s++) {
      lightRing((s / CONIC_STOPS) * Math.PI * 2, SIDE_NZ[k], f, cfg.lightK, out);
      const c = cs[s];
      c[0] = ((out[0] * (1 - dark)) | 0) / 255;
      c[1] = ((out[1] * (1 - dark)) | 0) / 255;
      c[2] = ((out[2] * (1 - dark)) | 0) / 255;
    }
    inst.side[k].setShader(Skia.Shader.MakeSweepGradient(50, 50, cs, pos, TileMode.Clamp));
  }
  /* large avatars: a crisp hairline of the environment along the lit side */
  const al = Math.min(0.5, 0.3 * cfg.rim * Math.min(1.4, cfg.highlight));
  if (cfg.dev >= 256) inst.hair.setShader(Skia.Shader.MakeLinearGradient({ x: 50 + lxy[0] * 50, y: 50 + lxy[1] * 50 }, { x: 50 - lxy[0] * 50, y: 50 - lxy[1] * 50 }, [Skia.Color([235 / 255, 244 / 255, 1, al]), Skia.Color([235 / 255, 244 / 255, 1, 0.35 * al]), Skia.Color([235 / 255, 244 / 255, 1, 0])], [0, 0.45, 0.75], TileMode.Clamp));
  inst.sideL[0] = f.L[0]; inst.sideL[1] = f.L[1]; inst.sideL[2] = f.L[2];
  inst.sideV[0] = f.V[0]; inst.sideV[1] = f.V[1]; inst.sideV[2] = f.V[2];
  inst.sideValid = true;
  inst.sprVersion++;
}

/* the three side sprites of one outline at the avatar's device size:
   the outline filled with the near-shoulder, rim and far gradients */
function renderSprites(st: Store, inst: Inst, sp: Sprites, path: SkPath, px: number): boolean {
  'worklet';
  if (sp.px !== px) {
    sp.surfaces = [null, null, null];
    sp.images = [null, null, null];
    sp.px = px;
  }
  const k = px / SPAN;
  inst.sprSrc.width = px;
  inst.sprSrc.height = px;
  for (let i = 0; i < 3; i++) {
    let sf = sp.surfaces[i];
    if (!sf) {
      sf = Skia.Surface.MakeOffscreen(px, px);
      if (!sf) return false;
      sp.surfaces[i] = sf;
    }
    const c = sf.getCanvas();
    c.clear(st.clear);
    c.save();
    c.scale(k, k);
    c.translate(PAD, PAD);
    c.drawPath(path, inst.side[i]);
    c.restore();
    sp.images[i] = sf.makeImageSnapshot();
  }
  sp.version = inst.sprVersion;
  return true;
}

/* An eye's curve as a short polyline with round joins, cached by its numbers. */
function eyePath(st: Store, x0: number, y0: number, cy: number): SkPath {
  'worklet';
  const qx = Math.round(x0 * 50), qy = Math.round(y0 * 50), qc = Math.round(cy * 50);
  const key = qx + 2000 * qy + 4e6 * qc;
  let p = st.eyes.get(key);
  if (!p) {
    const ax = qx / 50, ay = qy / 50, ac = qc / 50;
    const b = Skia.PathBuilder.Make();
    b.moveTo(-ax, ay);
    for (let i = 1; i <= EYE_STEPS; i++) {
      const t = i / EYE_STEPS, mt = 1 - t;
      b.lineTo(mt * mt * -ax + t * t * ax, (mt * mt + t * t) * ay + 2 * mt * t * ac);
    }
    p = b.detach();
    if (st.eyes.size > 256) st.eyes.clear();
    st.eyes.set(key, p);
  }
  return p;
}

/* The mouth's outline as a path, cached by its numbers: corners at ±hw on
   y = 0, a top edge with its controls a·hw in from the corners at depth
   yt, a bottom edge back at depth yb with controls ab·hw in, and round
   caps of radius t0 round each corner, set square to the smile's end slope. */
function mouthPath(st: Store, hw0: number, t00: number, a0: number, yt0: number, ab0: number, yb0: number): SkPath {
  'worklet';
  const q = (v: number) => Math.round(v * 50) / 50;
  const hw = q(hw0), t0 = q(t00), a = q(a0), yt = q(yt0), ab = q(ab0), yb = q(yb0);
  const key = hw + ',' + t0 + ',' + a + ',' + yt + ',' + ab + ',' + yb;
  let p = st.mouths.get(key);
  if (p) return p;
  const nx = t0 * MOUTH_SIN, ny = t0 * MOUTH_COS;
  const ltx = -hw + nx, lty = -ny, rtx = hw - nx, rty = -ny;
  const lbx = -hw - nx, lby = ny, rbx = hw + nx, rby = ny;
  const cx = (4 / 3) * t0 * MOUTH_COS, cy = (4 / 3) * t0 * MOUTH_SIN;
  const b = Skia.PathBuilder.Make();
  b.moveTo(ltx, lty);
  b.cubicTo(-hw + a * hw, yt - t0, hw - a * hw, yt - t0, rtx, rty);
  b.cubicTo(rtx + cx, rty - cy, rbx + cx, rby - cy, rbx, rby);
  b.cubicTo(hw - ab * hw, yb + t0, -hw + ab * hw, yb + t0, lbx, lby);
  b.cubicTo(lbx - cx, lby - cy, ltx - cx, lty - cy, ltx, lty);
  b.close();
  p = b.detach();
  if (st.mouths.size > 256) st.mouths.clear();
  st.mouths.set(key, p);
  return p;
}

/* (the helpers sit above the frame worklet: a worklet captures what its
   closure holds when the module evaluates, so they must exist first) */

function drawFace(canvas: SkCanvas, st: Store, inst: Inst, cfg: DrawConfig, pk: Float32Array, off: number) {
  'worklet';
  const wd = pk[off + PK.w0], ww = pk[off + PK.w1], ws = pk[off + PK.w2];
  const ey = cfg.face === 1 ? EYE_Y_MOUTH : EYE_Y_EYES;
  const half = EYE_GAP / 2;
  const lx = pk[off + PK.lookX], ly = pk[off + PK.lookY];
  const yaw = pk[off + PK.yaw], pitch = pk[off + PK.pitch];
  const py = pk[off + PK.y], breath = pk[off + PK.breath], laughP = pk[off + PK.laugh], eyeOpen = pk[off + PK.eyeOpen];
  const mat = inst.mat;

  /* place a feature on the sphere: longitude and latitude from its design
     position, turned by the head; skip it once it has gone round the side.
     (The web sets a clear-coat alpha of 0.93 first, then each feature sets
     its own alpha in place of it, so features draw at their own alpha.) */
  const at = (x: number, y: number, alpha: number): number => {
    const lon = Math.asin(Math.max(-1, Math.min(1, x / FACE_R))) + yaw;
    const lat = Math.asin(Math.max(-1, Math.min(1, -y / FACE_R))) + pitch;
    const cl = Math.cos(lat);
    const z = Math.cos(lon) * cl;
    if (z <= 0.02 || alpha <= 0.01) return -1;
    canvas.save();
    mat[0] = Math.max(0.02, Math.cos(lon)); mat[1] = 0; mat[2] = FACE_R * Math.sin(lon) * cl;
    mat[3] = 0; mat[4] = Math.max(0.02, cl); mat[5] = -FACE_R * Math.sin(lat);
    canvas.concat(mat);
    return alpha * Math.min(1, z * 5);
  };

  /* Each eye is one stroked curve — endpoints at ±x0,y0, a control point
     at 0,cy, width w, round caps — so every look is the same shape with
     different numbers, and a blend of the numbers is a real morph */
  const open = wd + ww * (1 - laughP);
  const laugh = ww * laughP;
  const lift = Math.max(0, -py) / 26;
  const sag = 0.5 + 0.5 * breath;
  for (let side = -1; side <= 1; side += 2) {
    const lid = side < 0 ? pk[off + PK.blinkL] : pk[off + PK.blinkR];
    const e = Math.max(0, Math.min(1, eyeOpen * (1 - lid)));
    const kOpen = open * e, kShut = open * (1 - e), kLaugh = laugh, kSleep = ws;
    const x0 = kOpen * 0.01 + kShut * 5.4 + kLaugh * 6.2 + kSleep * 6;
    const y0 = kOpen * 1.1 + kShut * 0.6 + kLaugh * (2.2 - lift * 1.5) + kSleep * (-1.4 + sag);
    const cy = kOpen * -3.3 + kShut * 0.6 + kLaugh * (-11.4 - 4 * lift) + kSleep * (5.4 + 2 * sag);
    const w = kOpen * EYE_RX * 2 + kShut * 2.8 + kLaugh * 4.4 + kSleep * 4;
    /* the eyes drift toward the look when open, less so when shut */
    const dx = lx * (kOpen + 0.5 * (kShut + kLaugh)), dy = ly * (kOpen + 0.5 * kShut);
    const a = at(side * half + dx, ey + dy, 1);
    if (a >= 0) {
      inst.ink.setStrokeWidth(w);
      inst.ink.setAlphaf(a);
      canvas.drawPath(eyePath(st, x0, y0, cy), inst.ink);
      canvas.restore();
    }
  }

  if (cfg.face === 1) {
    const mx = lx * 0.35;
    /* One mouth for every state, so a switch morphs it rather than fading
       one shape into another; the smile widens on the in-breath, the open
       mouth at the top of a hop, the "o" swells with each breath. */
    const kd = (0.6 + 0.4 * wd) * (1 + 0.06 * breath);
    const kw = (0.6 + 0.4 * ww) * (1 + (0.25 * Math.max(0, -py)) / 26);
    const r = 2.7 * ws * (1 + 0.25 * breath);
    const b = (d: number, w: number, s: number) => wd * d + ww * w + ws * s;
    const a = at(mx, b(12.5, 11.6, 15.5), 1);
    if (a >= 0) {
      inst.inkFill.setAlphaf(a);
      canvas.drawPath(mouthPath(st, b(6.5 * kd, 9.5 * kw, r), b(1.9, 0, 0), b(2 / 3, 2 / 3, 0), b(3.53 * kd, 1.6 * kw, (-4 * r) / 3), b(2 / 3, 0, 0), b(3.53 * kd, 17.3 * kw, (4 * r) / 3)), inst.inkFill);
      canvas.restore();
    }
  }
}

/* The whirl: the cartoon motion round a spinning body — one tapered
   trail on a tilted ring, made of the body's own material as a
   translucent plastic tube, lit from the same light, with a soft halo.
   The near half (sin > 0) is larger, thicker and stronger and is drawn
   over the body and face, casting a soft shadow on them; the far half is
   smaller and fainter and goes behind. */
function drawWhirl(canvas: SkCanvas, inst: Inst, cfg: DrawConfig, pk: Float32Array, off: number, near: boolean) {
  'worklet';
  const knobs = cfg.whirl;
  const k = Math.min(1, pk[off + PK.whirl] * knobs.strength);
  if (k <= 0.01) return;
  const span = WHIRL_SPAN * knobs.length;
  const widthK = knobs.width;
  /* the ring runs the way the body's near face moves: to the right */
  const head = -pk[off + PK.whirlAngle];
  const rx = WHIRL_RX * knobs.size;
  const ry = rx * WHIRL_RATIO * knobs.tilt * (near ? 1.14 : 0.86);
  /* where round the ring the light falls, in the ring's own frame */
  const lightA = Math.atan2(cfg.ly, cfg.lx) - WHIRL_TILT;
  const DEG = 180 / Math.PI;
  const path = inst.whirlPath;
  const paints = inst.whirl;
  canvas.save();
  canvas.rotate(WHIRL_TILT * DEG, 0, 0);
  canvas.translate(0, 5);
  const seg = (a0: number, a1: number, width: number, paint: SkPaint, alpha: number, dy: number) => {
    paint.setStrokeWidth(width);
    paint.setAlphaf(Math.max(0, Math.min(1, alpha)));
    path.reset();
    path.addArc({ x: -rx, y: dy - ry, width: 2 * rx, height: 2 * ry }, a0 * DEG, (a1 - a0) * DEG);
    canvas.drawPath(path.build(), paint);
  };
  /* the near half casts a soft shadow on the body it crosses */
  if (near) {
    for (let i = 0; i < WHIRL_SEGMENTS; i++) {
      const f = i / WHIRL_SEGMENTS;
      const a1 = head + f * span, a0 = a1 + span / WHIRL_SEGMENTS + 0.012;
      if (Math.sin((a0 + a1) / 2) <= 0) continue;
      const fade = Math.pow(1 - f, 1.3);
      seg(a1, a0, (2 + 8 * fade) * 1.5 * widthK, paints[5], 0.2 * k * fade, 3.5);
    }
  }
  for (let i = 0; i < WHIRL_SEGMENTS; i++) {
    const f = i / WHIRL_SEGMENTS;
    /* the trail lies at the angles the head has already passed */
    const a1 = head + f * span, a0 = a1 + span / WHIRL_SEGMENTS + 0.012;
    const mid = (a0 + a1) / 2;
    if (Math.sin(mid) > 0 !== near) continue;
    /* perspective and depth: the nearest point of the ring is fullest */
    const depth = 0.6 + 0.4 * Math.sin(mid);
    const fade = Math.pow(1 - f, 1.3);
    /* a gentle puff along the trail */
    const puff = 1 + 0.18 * Math.sin(f * 9 + 1.2);
    const width = (2 + 8 * fade) * depth * widthK * puff;
    const a = k * (0.3 + 0.7 * fade) * depth;
    /* how much this stretch of the ring faces the light */
    const facing = 0.5 + 0.5 * Math.cos(mid - lightA);
    /* halo, underside, body, lit flank, specular ridge: a plastic tube */
    seg(a1, a0, width * 2.6, paints[0], a * 0.2, 0);
    seg(a1, a0, width * 0.8, paints[1], a * 0.45, width * 0.32);
    seg(a1, a0, width, paints[2], a * 0.72, 0);
    seg(a1, a0, width * 0.62, paints[3], a * 0.78 * (0.4 + 0.6 * facing), -width * 0.16);
    seg(a1, a0, width * 0.24, paints[4], a * 0.9 * (0.15 + 0.85 * facing * facing), -width * 0.3);
  }
  canvas.restore();
}

/**
 * Record one frame of an avatar onto `canvas`, `box` points square with
 * the overscan, from its packet at `pk[off]`.
 */
export function drawBotAvatarFrame(canvas: SkCanvas, box: number, pk: Float32Array, off: number, cfg: DrawConfig, res: Resources, key: string): void {
  'worklet';
  const t0 = now();
  const st = store();
  const full = box * OVERSCAN;
  let inst = st.inst[key];
  if (!inst) inst = st.inst[key] = makeInst(full);
  if (inst.v !== cfg.v) configure(inst, cfg);
  inst.rect.width = full;
  inst.rect.height = full;
  const S = box / 100;
  const yaw = pk[off + PK.yaw], pitch = pk[off + PK.pitch], roll = pk[off + PK.roll];
  const px = pk[off + PK.x], py = pk[off + PK.y], psx = pk[off + PK.sx], psy = pk[off + PK.sy];
  const mat = inst.mat;
  const mode = cfg.mode;

  const cy0 = Math.cos(yaw), sy = Math.sin(yaw);
  const cp0 = Math.cos(pitch), sp = Math.sin(pitch);
  const facing = cy0 * cp0;
  const cy = Math.abs(cy0) < 0.22 ? (cy0 < 0 ? -0.22 : 0.22) : cy0;
  const cp = Math.abs(cp0) < 0.22 ? (cp0 < 0 ? -0.22 : 0.22) : cp0;
  const halfDepthBody = cfg.halfDepth, cap = cfg.cap;

  /* body space: the box centre plus the pose's offset, its roll and
     squash; squash and stretch scale about the body's base (y = 50) */
  const cr = Math.cos(roll), sr = Math.sin(roll), kx = psx * S, ky = psy * S;
  const lift = 50 * (1 - psy) * S;
  canvas.save();
  mat[0] = cr * kx; mat[1] = -sr * ky; mat[2] = full / 2 + px * S - sr * lift;
  mat[3] = sr * kx; mat[4] = cr * ky; mat[5] = full / 2 + RISE * box + py * S + cr * lift;
  canvas.concat(mat);

  /* plastic: the cap's lighting frame from the packet; the side gradients
     follow it a bin at a time */
  const f = inst.frame;
  if (mode === 0) {
    let i = off + PK.frame;
    const vs = [f.L, f.V, f.H, f.U, f.W, f.A, f.B];
    for (let k = 0; k < 7; k++) {
      const v = vs[k];
      v[0] = pk[i++]; v[1] = pk[i++]; v[2] = pk[i++];
    }
    if (!inst.sideValid || moved(f.L, inst.sideL) || moved(f.V, inst.sideV)) sideGradients(st, inst, cfg, f);
  }

  const order = facing >= 0 ? 1 : -1;

  /* one solid: the slice stack (or the plastic material) for an outline
     at a depth. Returns whether the plastic material drew it. */
  const drawSolid = (path: SkPath, form: SkImage | null, parts: boolean, halfDepth: number): boolean => {
    const plastic = mode === 0 && form !== null && res.effect !== null;
    /* while a form is still baking the smooth look stands in */
    const mode2 = mode === 0 && !plastic ? 2 : mode;
    const soft = mode2 === 2;
    const union = soft ? Skia.PathBuilder.Make() : null;
    /* plastic: the side sprites, redrawn with the lighting */
    let spr: Sprites | null = null;
    if (plastic && inst.sprOk && cfg.sides !== 1) {
      spr = inst.sprites[parts ? 1 : 0];
      const px = Math.ceil((SPAN * cfg.dev) / 100);
      if (spr.version !== inst.sprVersion || spr.px !== px) {
        if (!renderSprites(st, inst, spr, path, px)) {
          inst.sprOk = false;
          spr = null;
        }
      }
    }
    canvas.save();
    /* slices, far to near; each slice's affine is applied relative to the
       previous slice's: one concat per slice */
    let pa = 1, pb = 0, pc = 0, pd = 1, pe = 0, pf = 0;
    const count = plastic ? SLICES - 1 : SLICES;
    for (let j = 0; j < count; j++) {
      const k = order > 0 ? j : SLICES - 1 - j;
      const z = -1 + (2 * k) / (SLICES - 1);
      const s = profile(z, cap);
      const near = j / (SLICES - 1);
      /* yaw about Y then pitch about X, orthographic: an affine per slice,
         then the path's own origin at its centre */
      const m0 = cy * s, m1 = sy * sp * s, m3 = cp * s;
      const e = z * sy * halfDepth - 50 * m0, fo = -z * cy * sp * halfDepth - 50 * m1 - 50 * m3;
      const det = pa * pd - pb * pc;
      const ia = pd / det, ib = -pb / det, ic = -pc / det, id = pa / det, ie = (pc * pf - pd * pe) / det, jf = (pb * pe - pa * pf) / det;
      mat[0] = ia * m0 + ic * m1; mat[1] = ic * m3; mat[2] = ia * e + ic * fo + ie;
      mat[3] = ib * m0 + id * m1; mat[4] = id * m3; mat[5] = ib * e + id * fo + jf;
      canvas.concat(mat);
      pa = m0; pb = m1; pc = 0; pd = m3; pe = e; pf = fo;
      let paint: SkPaint;
      if (plastic) {
        /* the shoulder nearest the cap reads the matcap at a 57° tilt,
           the equator its rim, the far half its rim in shade */
        const zn = z * order;
        const kind = zn > 0.4 ? 0 : zn >= 0 ? 1 : 2;
        if (spr) {
          canvas.drawImageRectOptions(spr.images[kind] as SkImage, inst.sprSrc, inst.sprDst, FilterMode.Linear, MipmapMode.None, inst.blit);
          continue;
        }
        paint = inst.side[kind];
      } else if (soft) {
        paint = inst.solid;
        paint.setColor(inst.colors.smooth[j]);
      } else if (j === SLICES - 1) {
        if (mode2 === 1) paint = inst.crispCap;
        else {
          paint = inst.solid;
          paint.setColor(inst.colors.base);
        }
      } else if (near > 0.6) {
        if (mode2 === 1) paint = inst.crispLit;
        else {
          paint = inst.solid;
          paint.setColor(inst.colors.near);
        }
      } else {
        paint = inst.solid;
        paint.setColor(inst.colors.crisp[j] as Float32Array);
      }
      canvas.drawPath(path, paint);
      if (union) union.addPath(path, Skia.Matrix([m0, 0, e, m1, m3, fo, 0, 0, 1]));
    }
    canvas.restore();

    if (union) {
      canvas.save();
      canvas.clipPath(union.detach(), ClipOp.Intersect, true);
      canvas.drawRect({ x: -120, y: -120, width: 240, height: 240 }, inst.smoothShadow);
      canvas.drawRect({ x: -120, y: -120, width: 240, height: 240 }, inst.smoothLight);
      canvas.restore();
      return false;
    }
    if (!plastic) return false;

    /* the cap: the form lit per pixel, drawn through the equator affine
       stretched along the turn so the texture spans from the equator on
       the trailing side to the shoulder's silhouette on the leading side */
    const img = form as SkImage;
    let shader: SkShader;
    if (parts) {
      if (inst.partsImg !== img) {
        inst.partsImg = img;
        inst.partsShader = img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
      }
      shader = inst.partsShader as SkShader;
    } else {
      if (inst.formImg !== img) {
        inst.formImg = img;
        inst.formShader = img.makeShaderOptions(TileMode.Clamp, TileMode.Clamp, FilterMode.Linear, MipmapMode.None);
      }
      shader = inst.formShader as SkShader;
    }
    capUniforms(inst.uni, f, cfg.lightK, cfg.aoK, res.N / SPAN, PAD, 1);
    inst.cap.setShader((res.effect as NonNullable<Resources['effect']>).makeShaderWithChildren(inst.uni, [shader]));
    const inv = 1 / (cy * cp);
    const dx = (sy * halfDepth) / cy, dy = -sp * halfDepth * inv;
    const dl = Math.hypot(dx, dy);
    const ex = dl > 1e-6 ? (order * dx) / dl : 1, ey = dl > 1e-6 ? (order * dy) / dl : 0;
    const lead = 50 * cap + Math.hypot(50 * (1 - cap), dl);
    const stretch = (lead + 50) / 100, shift = (lead - 50) / 2;
    const a = 1 + (stretch - 1) * ex * ex, b = (stretch - 1) * ex * ey, d = 1 + (stretch - 1) * ey * ey;
    canvas.save();
    mat[0] = cy; mat[1] = 0; mat[2] = 0;
    mat[3] = sy * sp; mat[4] = cp; mat[5] = 0;
    canvas.concat(mat);
    mat[0] = a; mat[1] = b; mat[2] = shift * ex - 50 * a - 50 * b;
    mat[3] = b; mat[4] = d; mat[5] = shift * ey - 50 * b - 50 * d;
    canvas.concat(mat);
    canvas.drawPath(path, inst.cap);
    /* large avatars: the texture is upscaled 2–3×, so a crisp hairline of
       the environment along the lit side of the silhouette */
    if (cfg.dev >= 256 && cfg.rim > 0 && cfg.highlight > 0) canvas.drawPath(path, inst.hair);
    canvas.restore();
    return true;
  };

  /* the far half of the whirl sits behind everything */
  drawWhirl(canvas, inst, cfg, pk, off, false);

  if (res.parts) drawSolid(res.parts, res.partsForm, true, halfDepthBody * cfg.partsDepth);
  drawSolid(res.path, res.form, false, halfDepthBody);

  /* the face: each feature sits on a sphere behind the front cap, so a
     turn slides it round the head */
  if (facing > -0.2) {
    canvas.save();
    canvas.translate(cfg.faceX - 50, cfg.faceY - 50);
    canvas.scale(cfg.faceScale, cfg.faceScale);
    drawFace(canvas, st, inst, cfg, pk, off);
    canvas.restore();
  }
  /* the near half of the whirl passes in front of the face */
  drawWhirl(canvas, inst, cfg, pk, off, true);
  canvas.restore();
  st.stats.ms += now() - t0;
  st.stats.frames++;
}
