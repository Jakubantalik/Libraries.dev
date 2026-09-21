/* The renderer. The body is a stack of copies of its outline, spaced along
   a depth axis with a pillow profile (smaller at the caps); each copy is
   projected with the head's yaw and pitch, so the stack reads as a rounded
   extruded solid that turns, flips and shows its side. Nearest copies are
   lit with a directional gradient, the far side sits in shade. The face
   lives on the front cap and follows it. */

import type { Pose } from './engine';
import type { BotAvatarFace, BotAvatarShading } from './types';
import { shade } from './color';
import { drawPlasticCap, mulAffine } from './plastic';

export interface DrawConfig {
  path: Path2D;
  face: BotAvatarFace;
  faceX: number;
  faceY: number;
  faceScale: number;
  color: string;
  ink: string;
  shading: BotAvatarShading;
  /** intensities and geometry of the lighting; omitted means the stock look */
  shadow?: number;
  highlight?: number;
  depth?: number;
  /** degrees clockwise from the top, where the light comes from */
  light?: number;
  rim?: number;
  spread?: number;
  /** identifies the outline for the material caches (the type name) */
  typeKey?: string;
  /** no animation loop follows this draw (reduced motion, paused): build
   * materials now instead of on idle time */
  still?: boolean;
  /** thin parts (antennae) drawn behind the body with `partsDepth` of its depth */
  parts?: Path2D;
  partsDepth?: number;
  /** the resolved surface: the whirl is white on dark, black on light */
  theme?: 'dark' | 'light';
  /** the device pixel ratio the context is scaled by: with it given the
      context's transform is taken as that scale and never read back */
  dpr?: number;
  /** plastic's side slices: filled as vectors, or blitted from sprites of
      the outline. `auto` (the default) blits on WebKit, where a
      conic-gradient fill costs thirty times a flat one. */
  sides?: 'auto' | 'vector' | 'sprite';
  /** the whirl's knobs; 1 everywhere is the stock look */
  whirl?: { strength: number; size: number; width: number; length: number; tilt: number };
}

/* The canvas is drawn larger than the avatar's layout box, so a hop or a
   flip can leave the box without being clipped. */
export const OVERSCAN = 1.4;

/* Copies through the depth, and the stock half-depth in body units. */
const SLICES = 17;
const HALF_DEPTH = 15;
/* Cap scale at the ends of the pillow, at the stock rim width. */
const CAP = 0.9;
const profile = (z: number, cap: number) => cap + (1 - cap) * Math.sqrt(Math.max(0, 1 - z * z));

/* Big, plain dark eyes: they carry the face at 24px. */
const EYE_GAP = 25;
const EYE_RX = 6.3;
const EYE_Y = { eyes: 1, mouth: -3.5 } as const;

interface Palette {
  base: string;
  far: string;
  near: string;
  light: string;
  dark: string;
  capTop: string;
  capBottom: string;
  /** the slice colours by draw order (far → near), crisp and smooth */
  crispMix: string[];
  smoothMix: string[];
  /** crisp: the lit side and cap gradients, for a light direction */
  grad: { lx: number; ly: number; lit: CanvasGradient; cap: CanvasGradient } | null;
}
const paletteCache = new Map<string, Palette>();
function palette(color: string, shadow: number, highlight: number): Palette {
  const key = `${color}|${shadow}|${highlight}`;
  let p = paletteCache.get(key);
  if (!p) {
    const far = shade(color, -0.3 * shadow, 0.05 * shadow);
    const near = shade(color, -0.12 * shadow, 0.03 * shadow);
    const crispMix: string[] = [], smoothMix: string[] = [];
    for (let j = 0; j < SLICES; j++) {
      const t = j / (SLICES - 1);
      crispMix.push(t > 0.6 ? '' : mixCss(far, near, t / 0.6));
      smoothMix.push(t >= 0.5 ? color : mixCss(far, color, t / 0.5));
    }
    p = {
      base: color,
      far,
      near,
      light: shade(color, 0.04 * highlight),
      dark: shade(color, -0.3 * shadow, 0.05 * shadow),
      capTop: shade(color, 0.035 * highlight),
      capBottom: shade(color, -0.035 * shadow),
      crispMix,
      smoothMix,
      grad: null,
    };
    if (paletteCache.size > 200) paletteCache.clear();
    paletteCache.set(key, p);
  }
  return p;
}

/* the numbers of an hsl() string; any other colour is normalised through shade() first */
const hslNums = (c: string) => (c.startsWith('hsl(') ? c : shade(c, 0)).match(/[\d.]+/g)!.map(Number);
function mixCss(a: string, b: string, t: number): string {
  /* interpolate the hsl numbers */
  const pa = hslNums(a);
  const pb = hslNums(b);
  const m = pa.map((v, i) => v + (pb[i] - v) * t);
  return `hsl(${m[0].toFixed(1)} ${m[1].toFixed(1)}% ${m[2].toFixed(1)}%)`;
}

/* The whirl: the cartoon motion round a spinning body — one tapered
   trail on a tilted ring, made of the body's own material: a translucent
   plastic tube in the body colour, lit from the same light — a lighter
   flank toward it, a darker underside, a white specular ridge along the
   top — with a soft halo so it reads as a puff of plastic cloud. The
   ring lies in the body's equatorial plane seen a little from above,
   with a touch of perspective: the near half (sin > 0) is larger,
   thicker and stronger and is drawn over the body and face, casting a
   soft shadow on them; the far half is smaller and fainter and goes
   behind. */
const WHIRL_SEGMENTS = 34;
const WHIRL_SPAN = Math.PI * 1.55;
const WHIRL_RX = 57;
const WHIRL_RATIO = 0.4;
const WHIRL_TILT = -0.28;
interface WhirlInk {
  base: string;
  light: string;
  dark: string;
  halo: string;
}
const whirlInkCache = new Map<string, WhirlInk>();
function whirlInk(color: string): WhirlInk {
  let w = whirlInkCache.get(color);
  if (!w) {
    w = { base: shade(color, 0.1, 0.02), light: shade(color, 0.3, 0.04), dark: shade(color, -0.22, 0.08), halo: shade(color, 0.2) };
    if (whirlInkCache.size > 200) whirlInkCache.clear();
    whirlInkCache.set(color, w);
  }
  return w;
}
/* an hsl() from shade() with an alpha */
const withAlpha = (hsl: string, a: number) => hsl.replace(')', ` / ${Math.max(0, Math.min(1, a)).toFixed(3)})`);

function drawWhirl(ctx: CanvasRenderingContext2D, pose: Pose, color: string, lx: number, ly: number, near: boolean, knobs?: DrawConfig['whirl']) {
  const strength = knobs?.strength ?? 0;
  const k = Math.min(1, pose.whirl * strength);
  if (k <= 0.01) return;
  const sizeK = knobs?.size ?? 1, widthK = knobs?.width ?? 1, lengthK = knobs?.length ?? 1, tiltK = knobs?.tilt ?? 1;
  const span = WHIRL_SPAN * lengthK;
  const ink = whirlInk(color);
  /* the ring runs the way the body's near face moves: to the right */
  const head = -pose.whirlAngle;
  const rx = WHIRL_RX * sizeK;
  const ry = rx * WHIRL_RATIO * tiltK * (near ? 1.14 : 0.86);
  /* where round the ring the light falls, in the ring's own frame */
  const lightA = Math.atan2(ly, lx) - WHIRL_TILT;
  ctx.save();
  ctx.rotate(WHIRL_TILT);
  ctx.translate(0, 5);
  ctx.lineCap = 'butt';
  const seg = (a0: number, a1: number, width: number, style: string, dy: number) => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.ellipse(0, dy, rx, ry, 0, a0, a1, false);
    ctx.stroke();
  };
  /* the near half casts a soft shadow on the body it crosses */
  if (near) {
    for (let i = 0; i < WHIRL_SEGMENTS; i++) {
      const f = i / WHIRL_SEGMENTS;
      const a1 = head + f * span, a0 = a1 + span / WHIRL_SEGMENTS + 0.012;
      if (Math.sin((a0 + a1) / 2) <= 0) continue;
      const fade = Math.pow(1 - f, 1.3);
      seg(a1, a0, (2 + 8 * fade) * 1.5 * widthK, `rgba(0,0,0,${(0.2 * k * fade).toFixed(3)})`, 3.5);
    }
  }
  for (let i = 0; i < WHIRL_SEGMENTS; i++) {
    const f = i / WHIRL_SEGMENTS;
    /* the trail lies at the angles the head has already passed */
    const a1 = head + f * span, a0 = a1 + span / WHIRL_SEGMENTS + 0.012;
    const mid = (a0 + a1) / 2;
    if ((Math.sin(mid) > 0) !== near) continue;
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
    seg(a1, a0, width * 2.6, withAlpha(ink.halo, a * 0.2), 0);
    seg(a1, a0, width * 0.8, withAlpha(ink.dark, a * 0.45), width * 0.32);
    seg(a1, a0, width, withAlpha(ink.base, a * 0.72), 0);
    seg(a1, a0, width * 0.62, withAlpha(ink.light, a * 0.78 * (0.4 + 0.6 * facing)), -width * 0.16);
    seg(a1, a0, width * 0.24, `rgba(255,255,255,${(a * 0.9 * (0.15 + 0.85 * facing * facing)).toFixed(3)})`, -width * 0.3);
  }
  ctx.restore();
}

/**
 * Draw one frame. `box` is the avatar's layout size in CSS px; the canvas
 * is `box * OVERSCAN` square and the context already scaled for the
 * device pixel ratio.
 */
export function draw(ctx: CanvasRenderingContext2D, box: number, pose: Pose, cfg: DrawConfig) {
  const full = box * OVERSCAN;
  ctx.clearRect(0, 0, full, full);
  const S = box / 100;
  /* the context's transform as given (the device scale) is the base of
     every transform set here; known from `dpr`, else read once */
  let dpr: number, base: readonly number[];
  if (cfg.dpr !== undefined) {
    dpr = cfg.dpr;
    base = [dpr, 0, 0, dpr, 0, 0];
  } else if (ctx.getTransform) {
    const t = ctx.getTransform();
    base = [t.a, t.b, t.c, t.d, t.e, t.f];
    dpr = t.a || 1;
  } else {
    dpr = 1;
    base = [1, 0, 0, 1, 0, 0];
  }
  const shadow = cfg.shadow ?? 0.35, highlight = cfg.highlight ?? 1.3;
  const halfDepth = HALF_DEPTH * (cfg.depth ?? 0.65);
  const cap = 1 - (1 - CAP) * (cfg.rim ?? 0.5);
  const spread = cfg.spread ?? 1.55;
  /* the light's direction on screen: a unit vector toward the source */
  const la = ((cfg.light ?? 265) * Math.PI) / 180;
  const lx = Math.sin(la), ly = -Math.cos(la);
  const pal = palette(cfg.color, shadow, highlight);

  const cy0 = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
  const cp0 = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
  /* which cap faces the viewer: the front while this is positive */
  const facing = cy0 * cp0;
  /* edge-on, every slice would thin to a line and the stack would show
     gaps; a floor on the foreshortening keeps it a solid */
  const floor = (v: number) => (Math.abs(v) < 0.22 ? (v < 0 ? -0.22 : 0.22) : v);
  const cy = floor(cy0), cp = floor(cp0);

  /* body space: the box centre plus the pose's offset, its roll and squash */
  const cr = Math.cos(pose.roll), sr = Math.sin(pose.roll), kx = pose.sx * S, ky = pose.sy * S;
  const body = mulAffine(base, [cr * kx, sr * kx, -sr * ky, cr * ky, full / 2 + pose.x * S, full / 2 + pose.y * S]);
  ctx.save();
  ctx.setTransform(body[0], body[1], body[2], body[3], body[4], body[5]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const mode = cfg.shading;
  /* one solid: the slice stack (or the plastic material) for an outline
     at a depth; the thin parts come first with a fraction of the depth,
     then the body over them */
  const drawSolid = (path: Path2D, key: string, halfDepth: number): boolean => {
    /* the lit gradient, in the body's own space: light from the upper left */
    let lit: CanvasGradient | string = pal.near;
    let capFill: CanvasGradient | string = pal.base;
    if (mode === 'crisp') {
      if (!pal.grad || pal.grad.lx !== lx || pal.grad.ly !== ly) {
        const g = ctx.createLinearGradient(lx * 56, ly * 56, -lx * 56, -ly * 56);
        g.addColorStop(0, pal.light);
        g.addColorStop(0.45, pal.near);
        g.addColorStop(1, pal.dark);
        const c = ctx.createLinearGradient(lx * 46, ly * 46, -lx * 46, -ly * 46);
        c.addColorStop(0, pal.capTop);
        c.addColorStop(1, pal.capBottom);
        pal.grad = { lx, ly, lit: g, cap: c };
      }
      lit = pal.grad.lit;
      capFill = pal.grad.cap;
    }

    /* plastic: the material module draws the whole body — side copies from
       its matcap and the front cap as a lit texture. While a form is still
       baking on idle time it declines, and the stock slices with the smooth
       overlay stand in for that frame. */
    let plasticDone = false;
    if (mode === 'plastic') {
      plasticDone = drawPlasticCap(
        ctx,
        { ...cfg, path, typeKey: key },
        { cy, sy, cp, sp, facing, roll: pose.roll, halfDepth, cap, lx, ly, dev: box * dpr, ctm: body, still: cfg.still },
        pal,
        null,
        { shadow, highlight, spread, rim: cfg.rim ?? 0.5 }
      );
    }
    const mode2: BotAvatarShading = mode === 'plastic' && !plasticDone ? 'smooth' : mode;
    const soft = mode2 === 'smooth';
    const union = soft && typeof Path2D === 'function' ? new Path2D() : null;
    /* slices, far to near; each sets its transform outright from the
       body's, no save/restore */
    const order = facing >= 0 ? 1 : -1;
    const [ca, cb, cc, cd, ce, cf] = body;
    let fill: CanvasGradient | string | null = null;
    /* each slice's affine is applied relative to the previous slice's: one
       transform() per slice, no save/restore */
    let pa = 1, pb = 0, pc = 0, pd = 1, pe = 0, pf = 0;
    for (let j = 0; j < SLICES && !plasticDone; j++) {
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
      ctx.transform(ia * m0 + ic * m1, ib * m0 + id * m1, ic * m3, id * m3, ia * e + ic * fo + ie, ib * e + id * fo + jf);
      pa = m0; pb = m1; pc = 0; pd = m3; pe = e; pf = fo;
      let style: CanvasGradient | string;
      /* smooth: one colour ramp through the depth to the front, no edge at the cap */
      if (soft) style = pal.smoothMix[j];
      else if (j === SLICES - 1) style = capFill;
      else if (near > 0.6) style = lit;
      else style = pal.crispMix[j];
      if (style !== fill) ctx.fillStyle = fill = style;
      ctx.fill(path);
      if (union) union.addPath(path, { a: m0, b: m1, c: 0, d: m3, e, f: fo });
    }
    if (!plasticDone) ctx.setTransform(ca, cb, cc, cd, ce, cf);

    /* smooth: a soft shadow from the lower right and a light from the upper
       left, laid over the whole form so nothing has an edge */
    if (union && mode2 === 'smooth') {
      /* the two gradients are made per frame on purpose: a kept one is
         slower to use in Safari than a fresh one */
      ctx.save();
      ctx.clip(union);
      const sa = Math.min(1, 0.34 * shadow);
      const sg = ctx.createRadialGradient(-lx * 45, -ly * 45, 4 * spread, -lx * 45, -ly * 45, 84 * spread);
      sg.addColorStop(0, `rgba(0,0,0,${sa})`);
      sg.addColorStop(0.5, `rgba(0,0,0,${sa * 0.35})`);
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = sg;
      ctx.fillRect(-120, -120, 240, 240);
      ctx.globalCompositeOperation = 'source-over';
      const ha = Math.min(1, 0.22 * highlight);
      const hg = ctx.createRadialGradient(lx * 37, ly * 37, 0, lx * 37, ly * 37, 62 * spread);
      hg.addColorStop(0, `rgba(255,255,255,${ha})`);
      hg.addColorStop(0.6, `rgba(255,255,255,${ha * 0.23})`);
      hg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(-120, -120, 240, 240);
      ctx.restore();
    }

    return plasticDone;
  };

  /* the far half of the whirl sits behind everything */
  drawWhirl(ctx, pose, cfg.color, lx, ly, false, cfg.whirl);

  if (cfg.parts) drawSolid(cfg.parts, `${cfg.typeKey ?? 'custom'}:parts`, halfDepth * (cfg.partsDepth ?? 0.4));
  const plasticDone = drawSolid(cfg.path, cfg.typeKey ?? 'custom', halfDepth);

  /* the face: each feature sits on a sphere behind the front cap, so a
     turn slides it round the head — the eye moving toward the edge
     narrows, the other comes to the front, and past the side they go */
  if (facing > -0.2) {
    ctx.save();
    ctx.translate(cfg.faceX - 50, cfg.faceY - 50);
    ctx.scale(cfg.faceScale, cfg.faceScale);
    /* under a clear coat the print shows the gloss faintly through it */
    if (plasticDone) ctx.globalAlpha = 0.93;
    drawFace(ctx, pose, cfg);
    ctx.restore();
  }
  /* the near half of the whirl passes in front of the face */
  drawWhirl(ctx, pose, cfg.color, lx, ly, true, cfg.whirl);
  ctx.restore();
}

/* Radius of the sphere the face is drawn on, in body units. */
const FACE_R = 30;

/* A feature's place on the sphere: longitude and latitude from its
   design position, turned by the head. Returns its screen offset, its
   foreshortening, and how much it faces the viewer. */
function onSphere(x: number, y: number, yaw: number, pitch: number) {
  const lon = Math.asin(Math.max(-1, Math.min(1, x / FACE_R))) + yaw;
  const lat = Math.asin(Math.max(-1, Math.min(1, -y / FACE_R))) + pitch;
  const cl = Math.cos(lat);
  return {
    x: FACE_R * Math.sin(lon) * cl,
    y: -FACE_R * Math.sin(lat),
    sx: Math.cos(lon),
    sy: cl,
    z: Math.cos(lon) * cl,
  };
}

/* An eye's curve as a short polyline with round joins, cached by its
   numbers. Stroking the open eye's hairpin curve directly gives a pill in
   Chrome but a teardrop in Safari, whose stroker does not round a cusp;
   both stroke a polyline the same way. */
const EYE_STEPS = 8;
const eyePaths = new Map<number, Path2D>();
function eyePath(x0: number, y0: number, cy: number): Path2D {
  const qx = Math.round(x0 * 50), qy = Math.round(y0 * 50), qc = Math.round(cy * 50);
  const key = qx + 2000 * qy + 4e6 * qc;
  let p = eyePaths.get(key);
  if (!p) {
    const ax = qx / 50, ay = qy / 50, ac = qc / 50;
    let d = `M${-ax} ${ay}`;
    for (let i = 1; i <= EYE_STEPS; i++) {
      const t = i / EYE_STEPS, mt = 1 - t;
      d += ` L${(mt * mt * -ax + t * t * ax).toFixed(3)} ${((mt * mt + t * t) * ay + 2 * mt * t * ac).toFixed(3)}`;
    }
    p = new Path2D(d);
    if (eyePaths.size > 256) eyePaths.clear();
    eyePaths.set(key, p);
  }
  return p;
}

function drawFace(ctx: CanvasRenderingContext2D, pose: Pose, cfg: DrawConfig) {
  const [wd, ww, ws] = pose.w;
  const ink = cfg.ink;
  const ey = EYE_Y[cfg.face];
  const half = EYE_GAP / 2;
  const lx = pose.lookX, ly = pose.lookY;
  const { yaw, pitch } = pose;

  /* place a feature: skip it once it has gone round the side */
  const at = (x: number, y: number, fn: () => void, alpha = 1) => {
    const q = onSphere(x, y, yaw, pitch);
    if (q.z <= 0.02 || alpha <= 0.01) return;
    ctx.save();
    ctx.globalAlpha = alpha * Math.min(1, q.z * 5);
    ctx.translate(q.x, q.y);
    ctx.scale(Math.max(0.02, q.sx), Math.max(0.02, q.sy));
    fn();
    ctx.restore();
  };

  /* Each eye is one stroked curve — endpoints at ±x0,y0, a control point
     at 0,cy, width w, round caps — so every look is the same shape with
     different numbers, and a blend of the numbers is a real morph: the
     upright pill of an open eye squashes into a shut line, swings up into
     a laughing arc, or droops into a sleeping lid. */
  const open = wd + ww * (1 - pose.laugh);
  const laugh = ww * pose.laugh;
  const lift = Math.max(0, -pose.y) / 26;
  const sag = 0.5 + 0.5 * pose.breath;
  for (const side of [-1, 1] as const) {
    const lid = side < 0 ? pose.blinkL : pose.blinkR;
    const e = Math.max(0, Math.min(1, pose.eyeOpen * (1 - lid)));
    const kOpen = open * e, kShut = open * (1 - e), kLaugh = laugh, kSleep = ws;
    const x0 = kOpen * 0.01 + kShut * 5.4 + kLaugh * 6.2 + kSleep * 6;
    const y0 = kOpen * 1.1 + kShut * 0.6 + kLaugh * (2.2 - lift * 1.5) + kSleep * (-1.4 + sag);
    const cy = kOpen * -3.3 + kShut * 0.6 + kLaugh * (-11.4 - 4 * lift) + kSleep * (5.4 + 2 * sag);
    const w = kOpen * EYE_RX * 2 + kShut * 2.8 + kLaugh * 4.4 + kSleep * 4;
    /* the eyes drift toward the look when open, less so when shut */
    const dx = lx * (kOpen + 0.5 * (kShut + kLaugh)), dy = ly * (kOpen + 0.5 * kShut);
    at(side * half + dx, ey + dy, () => {
      ctx.strokeStyle = ink;
      ctx.lineWidth = w;
      ctx.stroke(eyePath(x0, y0, cy));
    });
  }

  if (cfg.face === 'mouth') {
    const mx = lx * 0.35;
    /* smile: a little wider on the in-breath */
    if (wd > 0.01) {
      const k = (0.6 + 0.4 * wd) * (1 + 0.06 * pose.breath);
      at(mx, 14, () => {
        ctx.strokeStyle = ink;
        ctx.lineWidth = 3.8;
        ctx.beginPath();
        ctx.moveTo(-6.5 * k, -1.5);
        ctx.quadraticCurveTo(0, -1.5 + 5.3 * k, 6.5 * k, -1.5);
        ctx.stroke();
      }, wd);
    }
    /* working: wide open, wider still at the top of a hop */
    if (ww > 0.01) {
      const k = (0.6 + 0.4 * ww) * (1 + 0.25 * Math.max(0, -pose.y) / 26);
      at(mx, 18, () => {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.moveTo(-9.5 * k, -6.4);
        ctx.quadraticCurveTo(0, -6.4 + 2.4 * k, 9.5 * k, -6.4);
        ctx.bezierCurveTo(9.5 * k, -6.4 + 7.8 * k, 5.3 * k, -6.4 + 13 * k, 0, -6.4 + 13 * k);
        ctx.bezierCurveTo(-5.3 * k, -6.4 + 13 * k, -9.5 * k, -6.4 + 7.8 * k, -9.5 * k, -6.4);
        ctx.closePath();
        ctx.fill();
      }, ww);
    }
    /* asleep: a little "o" that swells with each breath */
    if (ws > 0.01) {
      const r = 2.7 * ws * (1 + 0.25 * pose.breath);
      at(mx, 15.5, () => {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r, 0, 0, Math.PI * 2);
        ctx.fill();
      }, ws);
    }
  }
}
