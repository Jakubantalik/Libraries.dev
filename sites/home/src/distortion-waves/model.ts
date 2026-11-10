/* Distortion waves — the timeline, ported line for line from DistortionWavesKit
   (packages/distortion-waves/ports/ios/DistortionWavesKit: WaveFront.swift,
   WaveParticles.swift, WaveRim.swift, DistortionWaveStyle.swift). Everything on
   screen is a pure function of one progress number, so the web preview and the
   SwiftUI library move alike. Lengths are in points, times in seconds. */

export type WaveType = "vertical" | "horizontal" | "center";
export type RGB = [number, number, number];

export interface Palette {
  colors: RGB[];
  /** The fringe riding ahead of the front. */
  ahead: RGB;
  /** The fringe trailing behind it. */
  behind: RGB;
}

export type PaletteName = "colorful" | "green" | "ocean" | "sunset" | "mono";

export const PALETTES: Record<PaletteName, Palette> = {
  colorful: {
    colors: [[255, 201, 21], [126, 196, 255], [180, 40, 230], [235, 100, 160], [255, 176, 122], [154, 160, 255], [127, 217, 238]],
    ahead: [255, 122, 182],
    behind: [90, 190, 255],
  },
  green: {
    colors: [[53, 186, 0], [140, 235, 90], [0, 196, 110], [190, 250, 130], [40, 160, 60], [110, 225, 160], [90, 210, 40]],
    ahead: [196, 255, 120],
    behind: [0, 150, 70],
  },
  ocean: {
    colors: [[40, 120, 255], [90, 200, 255], [20, 80, 200], [120, 230, 240], [60, 150, 255], [150, 180, 255], [0, 180, 220]],
    ahead: [150, 230, 255],
    behind: [30, 70, 220],
  },
  sunset: {
    colors: [[255, 140, 60], [255, 90, 120], [255, 200, 80], [240, 70, 90], [255, 170, 120], [220, 90, 200], [255, 120, 80]],
    ahead: [255, 220, 120],
    behind: [200, 60, 160],
  },
  mono: {
    colors: [[240, 240, 245], [200, 205, 215], [255, 255, 255], [170, 175, 190], [225, 228, 235], [190, 195, 205], [245, 245, 250]],
    ahead: [255, 255, 255],
    behind: [160, 165, 180],
  },
};

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** One colour, lighter ahead of the front and deeper behind it (DistortionWavePalette.single). */
export function singlePalette(c: RGB): Palette {
  return {
    colors: [c, mix(c, [255, 255, 255], 0.25), c, mix(c, [0, 0, 0], 0.15)],
    ahead: mix(c, [255, 255, 255], 0.45),
    behind: mix(c, [0, 0, 0], 0.3),
  };
}

export function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex(c: RGB): string {
  return "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export interface WaveStyle {
  type: WaveType;
  // Timing
  anticipation: number;
  travel: number;
  launchGap: number;
  linger: number;
  rimFade: number;
  returnSpeed: number;
  // Gravity
  pull: number;
  inhale: number;
  gatherGlow: number;
  gatherDots: number;
  // Swell
  amplitude: number;
  lensWidth: number;
  aberration: number;
  swell: number;
  // Progressive blur
  blur: number;
  blurAhead: number;
  blurBehind: number;
  // Colour on the front
  lead: number;
  tail: number;
  strength: number;
  // Colour on the edges
  rimWidth: number;
  rimUnevenness: number;
  rimStrength: number;
  rimSoftness: number;
  cornerRadius: number;
  rimPulse: number;
  hairlineWidth: number;
  hairlineOpacity: number;
  hairlineWhite: number;
  hairlineLinger: number;
  hairlineFade: number;
  // Touch
  orientation: number;
  // Particles
  particleCount: number;
  particleSize: number;
  particleReach: number;
  particleFlight: number;
  particleGap: number;
  particleLife: number;
  particleSpread: number;
  // Colour
  palette: Palette;
}

/** The tuned defaults for a type, as DistortionWaveStyle(type:). */
export function defaultStyle(type: WaveType): WaveStyle {
  const base: WaveStyle = {
    type,
    anticipation: 0.5,
    travel: 2.28,
    launchGap: 0,
    linger: -0.35,
    rimFade: 3.03,
    returnSpeed: 1.45,
    pull: 24,
    inhale: 56,
    gatherGlow: 0.33,
    gatherDots: 1,
    amplitude: 34,
    lensWidth: 150,
    aberration: 0.78,
    swell: 22,
    blur: 18,
    blurAhead: 90,
    blurBehind: 240,
    lead: 130,
    tail: 300,
    strength: 0.92,
    rimWidth: 14,
    rimUnevenness: 1,
    rimStrength: 0.82,
    rimSoftness: 343,
    cornerRadius: 62,
    rimPulse: 0.6,
    hairlineWidth: 1.5,
    hairlineOpacity: 0.9,
    hairlineWhite: 0.95,
    hairlineLinger: 0.47,
    hairlineFade: 3,
    orientation: 0.91,
    particleCount: 64,
    particleSize: 1.8,
    particleReach: 150,
    particleFlight: 30,
    particleGap: 24,
    particleLife: 2.19,
    particleSpread: 1,
    palette: PALETTES.colorful,
  };
  if (type !== "center") return base;
  return {
    ...base,
    anticipation: 0.25,
    travel: 3.43,
    rimFade: 2.51,
    hairlineLinger: 0.96,
    strength: 0.6,
    rimStrength: 0.6,
    aberration: 0,
    gatherGlow: 0,
    gatherDots: 0,
    particleCount: 89,
    particleLife: 3.93,
    particleSpread: 0.64,
    palette: PALETTES.green,
    cornerRadius: 48,
    pull: 14.4,
    inhale: 33.6,
    amplitude: 20.4,
    lensWidth: 90,
    swell: 13.2,
    blur: 10.8,
    blurAhead: 54,
    blurBehind: 144,
    lead: 78,
    tail: 180,
    rimSoftness: 205.8,
    particleReach: 90,
    particleFlight: 18,
    particleGap: 11,
  };
}

/** Seconds for the whole of it, by when the swell has settled, the edges have
    cleared and the last dot has faded. */
export function duration(s: WaveStyle): number {
  return s.anticipation + Math.max(s.travel * 0.6, s.linger + s.rimFade, s.linger + s.hairlineLinger + s.hairlineFade, s.particleLife);
}

/** CSS cubic-bezier(), solved by halving as the Swift easing does. */
export function bezierEase(x1: number, y1: number, x2: number, y2: number) {
  const b = (s: number, a: number, c: number) => {
    const r = 1 - s;
    return 3 * r * r * s * a + 3 * r * s * s * c + s * s * s;
  };
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const s = (lo + hi) / 2;
      if (b(s, x1, x2) < x) lo = s;
      else hi = s;
    }
    return b((lo + hi) / 2, y1, y2);
  };
}

const EASING = bezierEase(0.22, 1, 0.36, 1);
const RIM_EASING = bezierEase(0.42, 0, 0.58, 1);

export const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}

export interface Front {
  ox: number;
  oy: number;
  tilt: number;
  spine: number;
  radius: number;
  moved: number;
  squash: number;
  time: number;
  energy: number;
  swell: number;
  width: number;
  height: number;
  gravity: number;
  glow: number;
  clearRadius: number;
  hairClearRadius: number;
  rim: number;
  sparkle: number;
  flying: number;
  launched: boolean;
  hasCleared: boolean;
  ring: boolean;
  sideways: boolean;
  hold: number;
}

export const COVER_ZONE = 60;
const ARC_SQUASH = 1.4;
const RELEASE = 0.22;
const GATHERED_GLOW = 0.5;
const OVERSHOOT = 100;
const MAX_TILT = 0.45;
const SETTLE_START = 0.2;
const SETTLE_END = 0.55;

/** Where the wave is at `progress`, 0–1 of its duration (WaveFront.init). */
export function waveFront(progress: number, source: Rect, width: number, height: number, style: WaveStyle, focus?: Point | null): Front {
  const dur = duration(style);
  const t = Math.min(Math.max(progress, 0), 1) * dur;
  const sinceLaunch = t - style.anticipation;
  const gathered = smooth(0, Math.max(style.anticipation, 0.001), t);
  const x = Math.min(Math.max(sinceLaunch / style.travel, 0), 1);
  const moved = EASING(x);

  const ring = style.type === "center";
  const sideways = style.type === "horizontal";
  const fullSquash = ring ? 1 : ARC_SQUASH;
  const midX = source.x + source.w / 2;
  const midY = source.y + source.h / 2;
  const startRadius = Math.min(source.w, source.h) / 2;
  const length = sideways ? source.h : source.w;
  const startSpine = ring ? 0 : Math.max(0, length / 2 - startRadius);
  const turned = sideways ? Math.PI / 2 : 0;
  const ax = Math.cos(turned);
  const ay = Math.sin(turned);

  let lean = 0;
  if (!ring && focus) {
    const off = sideways ? focus.y - midY : focus.x - midX;
    lean = Math.min(Math.max(off / Math.max(length / 2, 1), -1), 1);
  }
  const fullShift = (lean * length) / 2 * style.orientation;
  const fullLean = lean * style.orientation * MAX_TILT;
  const fullTilt = turned + fullLean;
  const opening = smooth(0, 0.45, moved);

  const cs = Math.cos(fullTilt);
  const sn = Math.sin(fullTilt);
  let reach = 0;
  for (const [cx, cy] of [[0, 0], [width, 0], [0, height], [width, height]]) {
    const dx = cx - midX - fullShift * ax;
    const dy = cy - midY - fullShift * ay;
    reach = Math.max(reach, Math.hypot((cs * dx + sn * dy) * fullSquash, -sn * dx + cs * dy));
  }
  const crossed = reach + (style.swell + COVER_ZONE) * fullSquash;
  const settling = 1 - smooth(SETTLE_START, SETTLE_END, x);
  const launchRadius = startRadius + Math.max(style.launchGap, 0);
  const radius = sinceLaunch < 0 ? launchRadius + style.inhale * (1 - gathered) : launchRadius + (crossed + OVERSHOOT - launchRadius) * moved;
  const gatheredGlow = Math.min(GATHERED_GLOW * Math.max(style.gatherGlow, 0), 1);
  const clearStart = startRadius - style.rimSoftness;
  const clearEnd = reach + (style.rimSoftness + style.swell) * fullSquash;
  return {
    ox: midX + fullShift * opening * ax,
    oy: midY + fullShift * opening * ay,
    tilt: turned + fullLean * opening,
    spine: startSpine * (1 - opening),
    radius,
    moved,
    squash: 1 + (fullSquash - 1) * smooth(0, 0.5, moved),
    time: t,
    energy: smooth(0, 0.05, x) * settling,
    swell: style.swell * smooth(0, 0.3, moved),
    width,
    height,
    gravity: style.pull * gathered * (1 - smooth(0, RELEASE, sinceLaunch)),
    glow: sinceLaunch < 0 ? gatheredGlow * gathered : (gatheredGlow + (1 - gatheredGlow) * smooth(0, 0.07, x)) * settling,
    clearRadius: clearStart + (clearEnd - clearStart) * RIM_EASING((sinceLaunch - style.linger) / Math.max(style.rimFade, 0.01)),
    hairClearRadius:
      clearStart + (clearEnd - clearStart) * RIM_EASING((sinceLaunch - style.linger - style.hairlineLinger) / Math.max(style.hairlineFade, 0.01)),
    rim: style.rimStrength * smooth(0, 0.1, x) * (1 - smooth(0.9, 1, t / dur)),
    sparkle: smooth(0, Math.max(style.anticipation, 0.001) * 0.35, t),
    flying: Math.max(sinceLaunch, 0),
    launched: sinceLaunch > 0,
    hasCleared: radius > crossed,
    ring,
    sideways,
    hold: ring ? startRadius : 0,
  };
}

/** The lumps on the edges (WaveRim.lumps): centre, length and depth of each,
    flattened, worked out once a frame. */
export const LUMPS = 7;
const LUMP_BUFFER = new Float32Array(LUMPS * 3);
/** Fills and returns a shared buffer: read it before the next call. */
export function rimLumps(time: number, width: number, height: number, cornerRadius: number, pulse: number): Float32Array {
  const ex = Math.max(width / 2 - cornerRadius, 0);
  const ey = Math.max(height / 2 - cornerRadius, 0);
  const perimeter = 4 * (ex + ey + 0.5 * Math.PI * cornerRadius);
  const hash = (i: number, a: number, b: number) => {
    const v = Math.sin(i * a + b) * 43758.5453;
    return v - Math.floor(v);
  };
  const out = LUMP_BUFFER;
  for (let i = 0; i < LUMPS; i++) {
    const a = hash(i, 12.9898, 1.3);
    const b = hash(i, 78.233, 4.1);
    const c = hash(i, 39.425, 2.7);
    const centre = (perimeter * (i + 0.35 * a)) / LUMPS + time * (-22 + 44 * b) * (1 + 2 * pulse);
    const length = (perimeter / LUMPS) * (0.2 + 0.25 * c);
    const breath = (0.25 + 0.3 * pulse) * Math.sin(time * (1.1 + 1.2 * a) * (1 + pulse) + i * 2.4);
    out[i * 3] = centre;
    out[i * 3 + 1] = length;
    out[i * 3 + 2] = (0.2 + 2.6 * b) * (1 + breath);
  }
  return out;
}

/* ── Particles (WaveParticle) ─────────────────────────────────── */

const FAN = 0.22;
const BOW = 0.3;
const pHash = (i: number, n: number, salt: number) => {
  const v = Math.sin(i * 12.9898 + n * 78.233 + salt * 37.719) * 43758.5453;
  return v - Math.floor(v);
};

export interface Particle {
  index: number;
  column: number;
  heading: number;
  pace: number;
  drift: number;
  sway: number;
  swayRate: number;
  twinkleRate: number;
  phase: number;
  life: number;
  size: number;
  brightness: number;
  hop: number;
  hopOffset: number;
}

export function makeParticles(style: WaveStyle): Particle[] {
  const out: Particle[] = [];
  for (let k = 0; k < Math.round(style.particleCount); k++) {
    const i = k + 1;
    const scatter = (step: number) => (i * step) % 1;
    const small = scatter(0.5497004779);
    out.push({
      index: i,
      column: (scatter(0.7548776662) * 2 - 1) * 0.92,
      heading: scatter(0.7548776662) * 2 * Math.PI,
      pace: 0.35 + 0.72 * Math.sqrt(scatter(0.8191725134)),
      drift: 15 + 50 * scatter(0.6710436067),
      sway: 3 + 11 * scatter(0.4142135624),
      swayRate: 2.5 + 3.5 * scatter(0.7320508076),
      twinkleRate: 8 + 12 * scatter(0.2360679775),
      phase: scatter(0.6180339887) * 2 * Math.PI,
      life: style.particleLife * (0.4 + 0.6 * scatter(0.6457513111)),
      size: style.particleSize * (0.55 + 0.45 * small * small),
      brightness: 0.3 + 0.7 * scatter(0.6055512755),
      hop: 0.16 + 0.14 * scatter(0.1231056256),
      hopOffset: scatter(0.472135955),
    });
  }
  return out;
}

/** A particle's place and opacity at this point of the wave. */
export function particleAt(p: Particle, front: Front, source: Rect, style: WaveStyle): { x: number; y: number; a: number } {
  const twinkle = 0.5 + 0.5 * Math.sin(front.time * p.twinkleRate + p.phase);
  const glint = p.brightness * (0.7 + 0.3 * twinkle);
  const spread = Math.min(Math.max(style.particleSpread, 0), 1);
  const midX = source.x + source.w / 2;
  const midY = source.y + source.h / 2;
  if (!front.launched) {
    const hops = front.time / p.hop + p.hopOffset;
    const count = Math.floor(hops);
    const along = hops - count;
    const hopping = smooth(0, 0.25, along) * (1 - smooth(0.55, 1, along));
    const ending = 1 - smooth(style.anticipation * 0.75, style.anticipation, front.time);
    const a = front.sparkle * hopping * ending * glint * style.gatherDots;
    if (front.ring) {
      const angle = pHash(p.index, count, 1) * 2 * Math.PI;
      const nearest = Math.min(source.w, source.h) / 2 + style.particleGap + style.particleFlight;
      const away = nearest + Math.max(style.particleReach - nearest, 0) * pHash(p.index, count, 2);
      const d = away - style.particleFlight * along * along;
      return { x: midX + Math.cos(angle) * d, y: midY + Math.sin(angle) * d, a };
    }
    const half = (front.sideways ? source.h : source.w) / 2;
    const face = (front.sideways ? source.w : source.h) / 2;
    const on = (al: number, out: number) => (front.sideways ? { x: midX + out, y: midY + al } : { x: midX + al, y: midY - out });
    const x = (pHash(p.index, count, 1) * 2 - 1) * (half + 24);
    const nearest = style.particleGap + style.particleFlight;
    const away = nearest + Math.max(style.particleReach - nearest, 0) * pHash(p.index, count, 2);
    const start = on(x, face + away);
    const corner = Math.min(source.w, source.h) / 2;
    const target = on(Math.min(Math.max(x, -half + corner), half - corner), face);
    const dx = target.x - start.x;
    const dy = target.y - start.y;
    const len = Math.max(Math.hypot(dx, dy), 1);
    const travelled = style.particleFlight * along * along;
    return { x: start.x + (dx / len) * travelled, y: start.y + (dy / len) * travelled, a };
  }
  const burning = 1 - smooth(p.life * 0.55, p.life, front.flying);
  const a = burning * glint;
  const swaying = p.sway * Math.sin(p.swayRate * front.flying + p.phase) * Math.min(front.flying / 0.25, 1);
  if (front.ring) {
    const edge = Math.min(source.w, source.h) / 2;
    const d = edge + ((front.radius - edge) * p.pace + p.drift * front.flying) * spread;
    const dx = Math.cos(p.heading);
    const dy = Math.sin(p.heading);
    return { x: front.ox + dx * d - dy * swaying, y: front.oy + dy * d + dx * swaying, a };
  }
  const start = Math.min(source.w, source.h) / 2;
  const widening = 1 + FAN * front.moved * p.pace * spread;
  const xx = ((p.column * (front.sideways ? source.h : source.w)) / 2) * widening + swaying;
  const h = (start + (front.radius - start) * p.pace * spread) * (1 - BOW * p.column * p.column) + p.drift * front.flying * spread;
  const cs = Math.cos(front.tilt);
  const sn = Math.sin(front.tilt);
  return { x: front.ox + cs * xx + sn * h, y: front.oy + sn * xx - cs * h, a };
}

/* ── Colour ───────────────────────────────────────────────────── */

export function oklab(c: RGB): [number, number, number] {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const [r, g, b] = [lin(c[0]), lin(c[1]), lin(c[2])];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
