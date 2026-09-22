/* The draw configuration: everything the renderer needs that does not
   change per frame, as plain numbers so it can cross to the UI thread in
   a shared value. The colours are the web's palette (draw.ts) resolved
   through `shade` / `parseColor` from the web package. */

import { parseColor, shade, botAvatarPresets, type BotAvatarFace, type BotAvatarShading, type BotAvatarType } from 'bot-avatars';
import { lightConstants, type LightConstants, type V3 } from './light';

/** an sRGB colour, 0–1 per channel */
export type RGB = [number, number, number];

export const SLICES = 17;
/** the stock half-depth in body units, and the cap scale at the stock rim width */
export const HALF_DEPTH = 15;
export const CAP = 0.9;

export const MODE = { plastic: 0, crisp: 1, smooth: 2, flat: 3 } as const;

export interface WhirlKnobs {
  strength: number;
  size: number;
  width: number;
  length: number;
  tilt: number;
}

export interface DrawConfig {
  /** bumped on every build, so the renderer knows to rebuild its paints */
  v: number;
  mode: number;
  /** 0 eyes, 1 mouth */
  face: number;
  faceX: number;
  faceY: number;
  faceScale: number;
  base: RGB;
  near: RGB;
  light: RGB;
  dark: RGB;
  capTop: RGB;
  capBottom: RGB;
  /** the slice colours by draw order (far → near); crisp leaves the lit ones null */
  crispMix: (RGB | null)[];
  smoothMix: RGB[];
  ink: RGB;
  shadow: number;
  highlight: number;
  halfDepth: number;
  cap: number;
  spread: number;
  rim: number;
  /** unit vector toward the light on screen */
  lx: number;
  ly: number;
  partsDepth: number;
  /** plastic: the material for the body colour, and the occlusion strength */
  lightK: LightConstants;
  aoK: number;
  whirl: WhirlKnobs;
  whirlInk: { base: RGB; light: RGB; dark: RGB; halo: RGB };
  /** the avatar box in device pixels (points × pixel ratio) */
  dev: number;
  /** plastic's side slices: 0 blitted from sprites of the outline, 1 filled as vectors */
  sides: number;
}

export interface DrawOptions {
  type: BotAvatarType;
  face: BotAvatarFace;
  color: string;
  ink: string;
  shading: BotAvatarShading;
  shadow: number;
  highlight: number;
  depth: number;
  light: number;
  rim: number;
  spread: number;
  whirl: WhirlKnobs;
  dev: number;
  sides: 'auto' | 'vector' | 'sprite';
}

const rgb = (c: string): RGB => {
  const p = parseColor(c);
  if (!p) return [0.5, 0.5, 0.5];
  return [p[0] / 255, p[1] / 255, p[2] / 255];
};

/* the numbers of an hsl() string; any other colour is normalised through shade() first */
const hslNums = (c: string) => (c.startsWith('hsl(') ? c : shade(c, 0)).match(/[\d.]+/g)!.map(Number);
function mixCss(a: string, b: string, t: number): string {
  const pa = hslNums(a);
  const pb = hslNums(b);
  const m = pa.map((v, i) => v + (pb[i] - v) * t);
  return `hsl(${m[0].toFixed(1)} ${m[1].toFixed(1)}% ${m[2].toFixed(1)}%)`;
}

const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

let version = 0;

/** Build the renderer's configuration for a set of resolved props. */
export function buildDrawConfig(o: DrawOptions): DrawConfig {
  const preset = botAvatarPresets[o.type] ?? botAvatarPresets.clover;
  const { color, shadow, highlight } = o;
  const far = shade(color, -0.3 * shadow, 0.05 * shadow);
  const near = shade(color, -0.12 * shadow, 0.03 * shadow);
  const crispMix: (RGB | null)[] = [], smoothMix: RGB[] = [];
  for (let j = 0; j < SLICES; j++) {
    const t = j / (SLICES - 1);
    crispMix.push(t > 0.6 ? null : rgb(mixCss(far, near, t / 0.6)));
    smoothMix.push(t >= 0.5 ? rgb(color) : rgb(mixCss(far, color, t / 0.5)));
  }
  const la = (o.light * Math.PI) / 180;
  const base = rgb(color);
  const lin: V3 = [toLin(base[0]), toLin(base[1]), toLin(base[2])];
  return {
    v: ++version,
    mode: MODE[o.shading] ?? 0,
    face: o.face === 'mouth' ? 1 : 0,
    faceX: preset.faceX,
    faceY: preset.faceY,
    faceScale: preset.faceScale,
    base,
    near: rgb(near),
    light: rgb(shade(color, 0.04 * highlight)),
    dark: rgb(shade(color, -0.3 * shadow, 0.05 * shadow)),
    capTop: rgb(shade(color, 0.035 * highlight)),
    capBottom: rgb(shade(color, -0.035 * shadow)),
    crispMix,
    smoothMix,
    ink: rgb(o.ink),
    shadow,
    highlight,
    halfDepth: HALF_DEPTH * o.depth,
    cap: 1 - (1 - CAP) * o.rim,
    spread: o.spread,
    rim: o.rim,
    lx: Math.sin(la),
    ly: -Math.cos(la),
    partsDepth: 0.4,
    lightK: lightConstants(lin, { shadow, highlight, spread: o.spread, rim: o.rim }),
    aoK: Math.min(1.3, 1.2 * shadow),
    whirl: o.whirl,
    whirlInk: {
      base: rgb(shade(color, 0.1, 0.02)),
      light: rgb(shade(color, 0.3, 0.04)),
      dark: rgb(shade(color, -0.22, 0.08)),
      halo: rgb(shade(color, 0.2)),
    },
    dev: o.dev,
    sides: o.sides === 'vector' ? 1 : 0,
  };
}
