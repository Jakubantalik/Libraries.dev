// Colourful mode for the ink types: a two-colour gradient laid across the
// orb — the plain monochrome ink on one side, one accent colour on the
// other. Every mark keeps its depth ramp (near marks bright, far ones
// fading) and takes the accent by how far along the gradient it sits;
// `saturation` scales the whole effect from none (0) to full (1), and
// `vivid` takes the accent itself purer and deeper beyond that. Hue,
// brightness and where the colour starts and how wide it runs shape it
// further. The gradient is sampled into steps, so strokes still batch.

import type { OrbTint } from './paint';

/** The colourful-mode settings, resolved for one orb. */
export interface OrbColors {
  /** 0 = monochrome ink, 1 = full accent at the gradient's far side. */
  saturation: number;
  /** 0–1: the accent purer and deeper than itself — saturation past 1. */
  vivid?: number;
  /** Multiplier on the accent's lightness. Default 1. */
  brightness?: number;
  /** Degrees to turn the accent's hue. Default 0. */
  hue?: number;
  /** Where along the gradient (0–1) the colour begins to come in. Default 0.1. */
  start?: number;
  /** How far along the gradient (0–1) it takes to arrive in full. Default 0.6. */
  width?: number;
  /** The accent colour the gradient runs into. */
  accent: OrbTint;
  /** Degrees: which way it runs — 0 left → right, 90 top → bottom. */
  angle: number;
  /**
   * How neutral the gradient's start is, 0–1: at 1 it begins in the plain
   * monochrome ink and gathers the accent toward its far side; at 0 the
   * accent covers the orb end to end.
   */
  neutral: number;
  /** The orb's CSS size, so the gradient spans it. */
  size: number;
}

/** Steps along the gradient: fine enough to read smooth, coarse enough to batch. */
export const COLOR_STEPS = 32;

export interface ColorRamp {
  /** The accent, as an RGB triple. */
  rgb: [number, number, number];
  /** How much of the accent each step takes over the ink, 0–1. */
  mix: number[];
  /** The step a point (CSS px) falls on. */
  at: (x: number, y: number) => number;
  saturation: number;
}

/**
 * The accent, turned and shaded: its hue turned by `hue` degrees, its
 * lightness scaled by `brightness`, and `vivid` (0–1) taking it purer —
 * more saturated, its lightness drawn toward the full-colour middle.
 */
export function adjustAccent(c: OrbTint, hue = 0, vivid = 0, brightness = 1): [number, number, number] {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let l = (max + min) / 2;
  let s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max !== min) {
    const d = max - min;
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  h = (((h + hue) % 360) + 360) % 360;
  s = Math.min(1, s * (1 + vivid));
  l = 0.5 + (l - 0.5) * (1 - 0.6 * vivid);
  l = Math.max(0, Math.min(1, l * brightness));
  // back to RGB
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Build the gradient steps and the point → step lookup. */
export function colorRamp(c: OrbColors): ColorRamp {
  const sat = Math.max(0, Math.min(1, c.saturation));
  const neutral = Math.max(0, Math.min(1, c.neutral));
  const start = c.start ?? 0.1;
  const width = Math.max(0.05, c.width ?? 0.6);
  const mix: number[] = [];
  for (let i = 0; i < COLOR_STEPS; i++) {
    const t = i / (COLOR_STEPS - 1);
    // from the neutral ink at the start to the full accent on the far side,
    // eased in over the near-middle of the orb so the colour arrives softly
    // yet still owns a good half of it
    const u = Math.max(0, Math.min(1, (t - start) / width));
    const rise = u * u * (3 - 2 * u);
    mix.push(sat * (1 - neutral * (1 - rise)));
  }
  const rad = (c.angle * Math.PI) / 180;
  const ca = Math.cos(rad);
  const sa = Math.sin(rad);
  const half = c.size / 2;
  // the orb spans about 80% of its canvas: run the gradient across that
  const span = c.size * 0.8;
  return {
    rgb: adjustAccent(c.accent, c.hue, Math.max(0, Math.min(1, c.vivid ?? 0)), c.brightness),
    mix,
    saturation: sat,
    at: (x, y) => {
      const t = ((x - half) * ca + (y - half) * sa) / span + 0.5;
      return Math.max(0, Math.min(COLOR_STEPS - 1, Math.round(t * (COLOR_STEPS - 1))));
    }
  };
}
