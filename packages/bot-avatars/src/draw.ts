/* The renderer. The body is a stack of copies of its outline, spaced along
   a depth axis with a pillow profile (smaller at the caps); each copy is
   projected with the head's yaw and pitch, so the stack reads as a rounded
   extruded solid that turns, flips and shows its side. Nearest copies are
   lit with a directional gradient, the far side sits in shade. The face
   lives on the front cap and follows it. */

import type { Pose } from './engine';
import type { BotAvatarFace, BotAvatarShading } from './types';
import { shade } from './color';
import { drawPlasticCap } from './plastic';

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
}
const paletteCache = new Map<string, Palette>();
function palette(color: string, shadow: number, highlight: number): Palette {
  const key = `${color}|${shadow}|${highlight}`;
  let p = paletteCache.get(key);
  if (!p) {
    p = {
      base: color,
      far: shade(color, -0.3 * shadow, 0.05 * shadow),
      near: shade(color, -0.12 * shadow, 0.03 * shadow),
      light: shade(color, 0.04 * highlight),
      dark: shade(color, -0.3 * shadow, 0.05 * shadow),
      capTop: shade(color, 0.035 * highlight),
      capBottom: shade(color, -0.035 * shadow),
    };
    if (paletteCache.size > 200) paletteCache.clear();
    paletteCache.set(key, p);
  }
  return p;
}

function mixCss(a: string, b: string, t: number): string {
  /* both are hsl() strings from shade(); interpolate their numbers */
  const pa = a.match(/[\d.]+/g)!.map(Number);
  const pb = b.match(/[\d.]+/g)!.map(Number);
  const m = pa.map((v, i) => v + (pb[i] - v) * t);
  return `hsl(${m[0].toFixed(1)} ${m[1].toFixed(1)}% ${m[2].toFixed(1)}%)`;
}

/* The whirl: the cartoon motion round a spinning body — one tapered
   trail on a tilted ring, drawn as a lit tube: a soft halo, a body, a
   bright ridge along its top and a darker underside. The ring lies in
   the body's equatorial plane seen a little from above, with a touch of
   perspective: the near half (sin > 0) is larger, thicker and brighter
   and is drawn over the body and face, casting a soft shadow on them;
   the far half is smaller and dimmer and goes behind. Neutral white on a
   dark surface, black on a light one. */
const WHIRL_SEGMENTS = 34;
const WHIRL_SPAN = Math.PI * 1.55;
const WHIRL_RX = 57;
const WHIRL_RATIO = 0.4;
const WHIRL_TILT = -0.28;
function drawWhirl(ctx: CanvasRenderingContext2D, pose: Pose, light: boolean, near: boolean, knobs?: DrawConfig['whirl']) {
  const strength = knobs?.strength ?? 1;
  const k = Math.min(1, pose.whirl * strength);
  if (k <= 0.01) return;
  const sizeK = knobs?.size ?? 1, widthK = knobs?.width ?? 1, lengthK = knobs?.length ?? 1, tiltK = knobs?.tilt ?? 1;
  const span = WHIRL_SPAN * lengthK;
  /* white on dark, near-black on light */
  const c = light ? '30,28,44' : '255,255,255';
  const paint = (a: number) => `rgba(${c},${a.toFixed(3)})`;
  const shadowPaint = (a: number) => `rgba(0,0,0,${a.toFixed(3)})`;
  /* the ring runs the way the body's near face moves: to the right */
  const head = -pose.whirlAngle;
  const rx = WHIRL_RX * sizeK;
  const ry = rx * WHIRL_RATIO * tiltK * (near ? 1.14 : 0.86);
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
      seg(a1, a0, (2 + 8 * fade) * 1.5 * widthK, shadowPaint(0.24 * k * fade), 3.5);
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
    const width = (2 + 8 * fade) * depth * widthK;
    const alpha = k * (0.3 + 0.7 * fade) * depth;
    /* halo, underside, body, ridge: a tube lit from above */
    seg(a1, a0, width * 2.6, paint(alpha * 0.16), 0);
    seg(a1, a0, width * 0.9, paint(alpha * 0.45), width * 0.28);
    seg(a1, a0, width, paint(alpha * 0.8), 0);
    seg(a1, a0, width * 0.34, paint(Math.min(1, alpha * 1.15)), -width * 0.26);
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

  ctx.save();
  ctx.translate(full / 2 + pose.x * S, full / 2 + pose.y * S);
  ctx.rotate(pose.roll);
  ctx.scale(pose.sx * S, pose.sy * S);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const mode = cfg.shading;
  /* one solid: the slice stack (or the plastic material) for an outline
     at a depth; the thin parts come first with a fraction of the depth,
     then the body over them */
  const drawSolid = (path: Path2D, key: string, halfDepth: number): boolean => {
    /* the lit gradient, in the body's own space: light from the upper left */
    let lit: CanvasGradient | string = pal.near;
    if (mode === 'crisp') {
      const g = ctx.createLinearGradient(lx * 56, ly * 56, -lx * 56, -ly * 56);
      g.addColorStop(0, pal.light);
      g.addColorStop(0.45, pal.near);
      g.addColorStop(1, pal.dark);
      lit = g;
    }
    let capFill: CanvasGradient | string = pal.base;
    if (mode === 'crisp') {
      const g = ctx.createLinearGradient(lx * 46, ly * 46, -lx * 46, -ly * 46);
      g.addColorStop(0, pal.capTop);
      g.addColorStop(1, pal.capBottom);
      capFill = g;
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
        { cy, sy, cp, sp, facing, roll: pose.roll, halfDepth, cap, lx, ly, dev: box * (ctx.getTransform ? ctx.getTransform().a || 1 : 1), still: cfg.still },
        pal,
        null,
        { shadow, highlight, spread, rim: cfg.rim ?? 0.5 }
      );
    }
    const mode2: BotAvatarShading = mode === 'plastic' && !plasticDone ? 'smooth' : mode;
    const soft = mode2 === 'smooth';
    const union = soft && typeof DOMMatrix === 'function' ? new Path2D() : null;
    /* slices, far to near */
    const order = facing >= 0 ? 1 : -1;
    for (let j = 0; j < SLICES && !plasticDone; j++) {
      const k = order > 0 ? j : SLICES - 1 - j;
      const z = -1 + (2 * k) / (SLICES - 1);
      const s = profile(z, cap);
      const near = j / (SLICES - 1);
      const m = [cy * s, sy * sp * s, 0, cp * s, z * sy * halfDepth, -z * cy * sp * halfDepth] as const;
      ctx.save();
      /* yaw about Y then pitch about X, orthographic: an affine per slice */
      ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      ctx.translate(-50, -50);
      if (soft) {
        /* one colour ramp through the depth to the front, no edge at the cap */
        ctx.fillStyle = near >= 0.5 ? pal.base : mixCss(pal.far, pal.base, near / 0.5);
      } else if (j === SLICES - 1) ctx.fillStyle = capFill;
      else if (near > 0.6) ctx.fillStyle = lit;
      else ctx.fillStyle = mixCss(pal.far, pal.near, near / 0.6);
      ctx.fill(path);
      ctx.restore();
      if (union) union.addPath(path, new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]).translate(-50, -50));
    }

    /* smooth: a soft shadow from the lower right and a light from the upper
       left, laid over the whole form so nothing has an edge */
    if (union && mode2 === 'smooth') {
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
  const lightSurface = cfg.theme === 'light';
  drawWhirl(ctx, pose, lightSurface, false, cfg.whirl);

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
  drawWhirl(ctx, pose, lightSurface, true, cfg.whirl);
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
      ctx.beginPath();
      ctx.moveTo(-x0, y0);
      ctx.quadraticCurveTo(0, cy, x0, y0);
      ctx.stroke();
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
