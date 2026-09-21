/**
 * Presets, the sheet mapping, and a CPU port of the material for point
 * sampling (glow luminance hunt, halo tint). Same numbers as the web's
 * `src/engine/presets.ts`; the sampler mirrors the SkSL in `shader.ts`.
 *
 * Every function here is a worklet so the glow can run on the UI thread.
 */
export type MetalPreset = 'chromatic' | 'silver' | 'gold';
export type MetalTheme = 'dark' | 'light';

export interface MetalMaterial {
  /** RGBA 0..1, composited under the material. */
  colorBack: [number, number, number, number];
  /** RGBA 0..1 colour-burn tint; alpha is the amount. */
  colorTint: [number, number, number, number];
  speed: number;
  repetition: number;
  softness: number;
  shiftRed: number;
  shiftBlue: number;
  distortion: number;
  contour: number;
  angle: number;
  shaderOpacity: number;
}

export function rgba(hex: string): [number, number, number, number] {
  let s = hex.startsWith('#') ? hex.slice(1) : hex;
  if (s.length === 6) s += 'ff';
  const v = parseInt(s, 16);
  return [((v >>> 24) & 0xff) / 255, ((v >>> 16) & 0xff) / 255, ((v >>> 8) & 0xff) / 255, (v & 0xff) / 255];
}

const BASE: MetalMaterial = {
  colorBack: [0, 0, 0, 0],
  colorTint: [1, 1, 1, 0],
  speed: 1,
  repetition: 1.5,
  softness: 0.05,
  shiftRed: 0.3,
  shiftBlue: 0.3,
  distortion: 0.1,
  contour: 0.4,
  angle: 90,
  shaderOpacity: 1,
};

export function presetMaterial(preset: MetalPreset, theme: MetalTheme): MetalMaterial {
  switch (preset) {
    case 'chromatic':
      return theme === 'dark'
        ? { ...BASE, colorTint: rgba('#88ccff2e'), shiftRed: 0.75, shiftBlue: 0.75, repetition: 2, softness: 0.09 }
        : { ...BASE, colorTint: rgba('#66b0ff99'), shiftRed: 0.6, shiftBlue: 0.6 };
    case 'silver':
      return theme === 'dark'
        ? { ...BASE, colorTint: rgba('#ffffff66'), shaderOpacity: 0.88 }
        : { ...BASE, colorTint: rgba('#ffffff40') };
    case 'gold':
      return theme === 'dark'
        ? { ...BASE, colorTint: rgba('#ffcc55cc'), speed: 0.85, shaderOpacity: 0.92 }
        : { ...BASE, colorTint: rgba('#f7d488aa') };
  }
}

/** uv = origin + pos * scale — the web's per-instance crop of the sheet. */
export interface SheetMapping {
  ox: number;
  oy: number;
  sx: number;
  sy: number;
}

export const CANONICAL_W = 140;
export const CANONICAL_H = 40;

export function sheetMapping(width: number, height: number, shaderScale: number): SheetMapping {
  'worklet';
  const w = Math.max(1, width), h = Math.max(1, height);
  const fx = Math.min(1, w / (CANONICAL_W * shaderScale));
  const fy = Math.min(1, h / (CANONICAL_H * shaderScale));
  return { ox: 0.5 - 0.5 * fx, oy: 0.5 - 0.5 * fy, sx: fx / w, sy: fy / h };
}

/** The same window drawn into another box, optionally mirrored. */
export function stretchedMapping(m: SheetMapping, fromW: number, fromH: number, toW: number, toH: number, flipX: boolean, flipY: boolean): SheetMapping {
  'worklet';
  const kx = fromW / Math.max(1, toW), ky = fromH / Math.max(1, toH);
  let ox = m.ox, oy = m.oy, sx = m.sx * kx, sy = m.sy * ky;
  if (flipX) { ox += m.sx * fromW; sx = -sx; }
  if (flipY) { oy += m.sy * fromH; sy = -sy; }
  return { ox, oy, sx, sy };
}

/** Uniforms for `LIQUID_METAL_SKSL`. */
export function materialUniforms(m: MetalMaterial, map: SheetMapping, time: number, opacityMul: number, ditherScale: number) {
  'worklet';
  return {
    uvOrigin: [map.ox, map.oy],
    uvScale: [map.sx, map.sy],
    time: time * m.speed,
    colorBack: m.colorBack,
    colorTint: m.colorTint,
    repetition: m.repetition,
    softness: m.softness,
    shiftRed: m.shiftRed,
    shiftBlue: m.shiftBlue,
    distortion: m.distortion,
    contour: m.contour,
    angle: m.angle,
    opacityMul,
    ditherScale,
  };
}

// ─── CPU sampler ──────────────────────────────────────────────────────────

function ss(e0: number, e1: number, x: number): number {
  'worklet';
  const e = Math.max(e1, e0 + 1e-6);
  const t = Math.min(1, Math.max(0, (x - e0) / (e - e0)));
  return t * t * (3 - 2 * t);
}
function mix(a: number, b: number, t: number): number { 'worklet'; return a + (b - a) * t; }
function fract(x: number): number { 'worklet'; return x - Math.floor(x); }
function gmod(x: number, y: number): number { 'worklet'; return x - y * Math.floor(x / y); }

function permute(x: number): number { 'worklet'; return gmod(((x * 34) + 1) * x, 289); }

export function snoise(vx: number, vy: number): number {
  'worklet';
  const Cx = 0.211324865405187, Cy = 0.366025403784439, Cz = -0.577350269189626, Cw = 0.024390243902439;
  const s = (vx + vy) * Cy;
  let ix = Math.floor(vx + s), iy = Math.floor(vy + s);
  const tt = (ix + iy) * Cx;
  const x0x = vx - ix + tt, x0y = vy - iy + tt;
  const i1x = x0x > x0y ? 1 : 0, i1y = x0x > x0y ? 0 : 1;
  const x1x = x0x + Cx - i1x, x1y = x0y + Cx - i1y;
  const x2x = x0x + Cz, x2y = x0y + Cz;
  ix = gmod(ix, 289); iy = gmod(iy, 289);
  const p0 = permute(permute(iy) + ix);
  const p1 = permute(permute(iy + i1y) + ix + i1x);
  const p2 = permute(permute(iy + 1) + ix + 1);
  let m0 = Math.max(0.5 - (x0x * x0x + x0y * x0y), 0);
  let m1 = Math.max(0.5 - (x1x * x1x + x1y * x1y), 0);
  let m2 = Math.max(0.5 - (x2x * x2x + x2y * x2y), 0);
  m0 *= m0; m0 *= m0; m1 *= m1; m1 *= m1; m2 *= m2; m2 *= m2;
  const xx0 = 2 * fract(p0 * Cw) - 1, xx1 = 2 * fract(p1 * Cw) - 1, xx2 = 2 * fract(p2 * Cw) - 1;
  const h0 = Math.abs(xx0) - 0.5, h1 = Math.abs(xx1) - 0.5, h2 = Math.abs(xx2) - 0.5;
  const a0 = xx0 - Math.floor(xx0 + 0.5), a1 = xx1 - Math.floor(xx1 + 0.5), a2 = xx2 - Math.floor(xx2 + 0.5);
  m0 *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h0 * h0);
  m1 *= 1.79284291400159 - 0.85373472095314 * (a1 * a1 + h1 * h1);
  m2 *= 1.79284291400159 - 0.85373472095314 * (a2 * a2 + h2 * h2);
  const g0 = a0 * x0x + h0 * x0y, g1 = a1 * x1x + h1 * x1y, g2 = a2 * x2x + h2 * x2y;
  return 130 * (m0 * g0 + m1 * g1 + m2 * g2);
}

/** direction, bump, edge, diagBL, diagTL — see `fieldA` in the SkSL. */
function field(ux: number, uy: number, t: number, noise: number, cw: number, contour: number, distortion: number, angle: number): [number, number, number, number, number] {
  'worklet';
  const cx = Math.min(1, Math.max(0, ux)), cy = Math.min(1, Math.max(0, uy));
  const mx = Math.min(cx, 1 - cx), my = Math.min(cy, 1 - cy);
  const maskX = Math.pow(ss(0, 0.5, mx), 0.25), maskY = Math.pow(ss(0, 0.5, my), 0.25);
  let edge = Math.min(1, Math.max(0, 1 - maskX * maskY));
  const fwE = 0.002;
  edge = mix(ss(0.9 - 2 * fwE, 0.9, edge), edge, ss(0, 0.4, contour));
  edge = 1.2 * edge;
  const a = (-angle + 70) * Math.PI / 180;
  const ca = Math.cos(a), sa = Math.sin(a);
  const rx = ux - 0.5, ry = uy - 0.5;
  const rotx = rx * ca - ry * sa + 0.5, roty = rx * sa + ry * ca + 0.5;
  const diagBL = rotx - roty, diagTL = rotx + roty;
  const gx = ux - 0.5, gy = uy - 0.5;
  const dist = Math.hypot(gx, gy + 0.2 * diagBL);
  const th = (0.25 - 0.2 * diagBL) * Math.PI;
  let direction = Math.cos(th) * gx - Math.sin(th) * gy;
  const uyc = Math.max(cy, 0);
  let bump = 1 - Math.pow(1.8 * dist, 1.2);
  bump *= Math.pow(uyc, 0.3);
  edge += (1 - edge) * distortion * noise;
  direction += diagBL;
  const sE = ss(0, 1, edge);
  direction -= 2 * noise * diagBL * (sE * (1 - sE));
  const c51 = ss(0.5, 1, contour);
  direction *= mix(1, 1 - edge, c51);
  direction -= 1.7 * edge * c51;
  direction += 0.2 * Math.pow(contour, 4) * (1 - sE);
  bump *= Math.min(1, Math.max(0.3, Math.pow(uyc, 0.1)));
  direction *= (0.1 + (1.1 - edge) * bump);
  direction *= (0.4 + 0.6 * (1 - ss(0.5, 1, edge)));
  direction += 0.18 * (ss(0.1, 0.2, uy) * (1 - ss(0.2, 0.4, uy)));
  direction += 0.03 * (ss(0.1, 0.2, 1 - uy) * (1 - ss(0.2, 0.4, 1 - uy)));
  direction *= (0.5 + 0.5 * uy * uy);
  direction *= cw;
  direction -= t;
  return [direction, bump, edge, diagBL, diagTL];
}

function colorChanges(c1: number, c2: number, p: number, w0: number, w1: number, w2: number, blurIn: number, bump: number, tint: number, tintA: number): number {
  'worklet';
  const blur = Math.max(blurIn, 1e-5);
  let ch = mix(c2, c1, ss(0, 2 * blur, p));
  let border = w0;
  ch = mix(ch, c2, ss(border, border + 2 * blur, p));
  border = w0 + 0.4 * (1 - bump) * w1;
  ch = mix(ch, c1, ss(border, border + 2 * blur, p));
  border = w0 + 0.5 * (1 - bump) * w1;
  ch = mix(ch, c2, ss(border, border + 2 * blur, p));
  border = w0 + w1;
  ch = mix(ch, c1, ss(border, border + 2 * blur, p));
  const gt = (p - w0 - w1) / w2;
  const gradient = mix(c1, c2, ss(0, 1, gt));
  ch = mix(ch, gradient, ss(border, border + 0.5 * blur, p));
  ch = mix(ch, 1 - Math.min(1, (1 - ch) / Math.max(tint, 0.0001)), tintA);
  return ch;
}

/** The material at sheet uv, RGB 0..1 (straight, before opacityMul). */
export function sampleMaterial(m: MetalMaterial, ux: number, uy: number, time: number): [number, number, number] {
  'worklet';
  const t = 0.3 * (time * m.speed + 2.8);
  const cw = m.repetition * 2;
  const noise = snoise(ux - t, uy - t);
  const f = field(ux, uy, t, noise, cw, m.contour, m.distortion, m.angle);
  const fx = field(ux + 1 / 192, uy, t, noise, cw, m.contour, m.distortion, m.angle);
  const fy = field(ux, uy + 1 / 192, t, noise, cw, m.contour, m.distortion, m.angle);
  const fw = Math.abs(fx[0] - f[0]) + Math.abs(fy[0] - f[0]);
  const direction = f[0], bump = f[1], edge = f[2], diagBL = f[3], diagTL = f[4];
  const cx = Math.min(1, Math.max(0, ux)), cy = Math.min(1, Math.max(0, uy));
  const mx = Math.min(cx, 1 - cx), my = Math.min(cy, 1 - cy);
  const rawEdge = Math.min(1, Math.max(0, 1 - Math.pow(ss(0, 0.5, mx), 0.25) * Math.pow(ss(0, 0.5, my), 0.25)));
  let opacity = 1 - ss(0.9 - 0.004, 0.9, rawEdge);
  const c2b = 0.1 + 0.1 * ss(0.7, 1.3, diagTL);
  const thin1 = 0.12 / cw * (1 - 0.4 * bump);
  const thin2 = 0.07 / cw * (1 + 0.4 * bump);
  const w0 = cw * thin1, w2 = 1 - thin1 - thin2;
  let w1 = cw * thin2;
  const cd = Math.min(1, Math.max(0, 1 - bump));
  let dR = cd + 0.03 * bump * noise;
  dR += 5 * (ss(-0.1, 0.2, uy) * (1 - ss(0.1, 0.5, uy))) * (ss(0.4, 0.6, bump) * (1 - ss(0.4, 1.0, bump)));
  dR -= diagBL;
  let dB = cd * 1.3;
  dB += (ss(0, 0.4, uy) * (1 - ss(0.1, 0.8, uy))) * (ss(0.4, 0.6, bump) * (1 - ss(0.4, 0.8, bump)));
  dB -= 0.2 * edge;
  dR *= m.shiftRed / 20;
  dB *= m.shiftBlue / 20;
  const blur = m.softness / 15;
  w1 -= 0.02 * ss(0, 1, edge + bump);
  const r = colorChanges(0.98, 0.1, fract(direction + dR), w0, w1, w2, blur + fw, bump, m.colorTint[0], m.colorTint[3]);
  const g = colorChanges(0.98, 0.1, fract(direction), w0, w1, w2, blur + fw, bump, m.colorTint[1], m.colorTint[3]);
  const b = colorChanges(1.0, c2b, fract(direction - dB), w0, w1, w2, blur + fw, bump, m.colorTint[2], m.colorTint[3]);
  const bgA = m.colorBack[3];
  const out: [number, number, number] = [
    r * opacity + m.colorBack[0] * bgA * (1 - opacity),
    g * opacity + m.colorBack[1] * bgA * (1 - opacity),
    b * opacity + m.colorBack[2] * bgA * (1 - opacity),
  ];
  opacity = opacity + bgA * (1 - opacity);
  return out;
}

export function sampleLuminance(m: MetalMaterial, ux: number, uy: number, time: number): number {
  'worklet';
  const c = sampleMaterial(m, ux, uy, time);
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
