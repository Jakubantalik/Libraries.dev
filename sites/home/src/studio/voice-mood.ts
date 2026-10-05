/* Emotion preview for the Studio — the colours the SwiftUI port's mood
   takes (VoiceGlowKit `VoiceMoodPalette.standard`, blended the same way),
   shown on the web glow through its `colors` / `bandColors`. Emotion
   detection itself is SwiftUI only (VoiceGlow Pro); nothing here reaches
   the web snippet. Keep in sync with
   packages/voice-glow/ports/ios/VoiceGlowKit/Sources/VoiceGlowKit/VoiceMoodPalette.swift. */

type RGB = [number, number, number];
type Corners = { happy: RGB[]; angry: RGB[]; sad: RGB[]; calm: RGB[] };

const PALETTE: { dark: Corners; light: Corners } = {
  dark: {
    happy: [[70, 230, 120], [150, 235, 70], [40, 215, 165], [190, 240, 80], [60, 220, 100], [30, 195, 140], [120, 230, 90]],
    angry: [[255, 50, 55], [255, 85, 60], [235, 30, 80], [255, 65, 45], [240, 40, 100], [255, 100, 75], [215, 30, 50]],
    sad: [[200, 30, 60], [225, 45, 75], [180, 25, 70], [210, 40, 55], [190, 30, 90], [230, 60, 80], [170, 20, 50]],
    calm: [[60, 210, 200], [90, 200, 255], [80, 230, 170], [40, 180, 215], [120, 220, 235], [50, 200, 160], [100, 190, 240]],
  },
  light: {
    happy: [[30, 175, 75], [100, 185, 25], [20, 160, 120], [140, 190, 30], [25, 165, 60], [15, 145, 100], [80, 175, 45]],
    angry: [[220, 30, 40], [230, 60, 35], [205, 20, 65], [225, 45, 30], [210, 25, 85], [230, 75, 50], [185, 20, 40]],
    sad: [[180, 25, 50], [200, 40, 60], [160, 20, 60], [190, 35, 45], [170, 25, 75], [205, 50, 65], [145, 15, 40]],
    calm: [[20, 165, 160], [40, 150, 220], [30, 175, 130], [20, 135, 175], [60, 165, 200], [25, 155, 125], [50, 145, 205]],
  },
};

/* The four corners of the mood plane, as the SwiftUI presets place them. */
export const MOOD_PRESETS = {
  happy: { valence: 0.8, arousal: 0.75 },
  calm: { valence: 0.6, arousal: 0.15 },
  angry: { valence: -0.75, arousal: 0.85 },
  sad: { valence: -0.7, arousal: 0.15 },
} as const;
export type MoodPreset = keyof typeof MOOD_PRESETS;
export type MoodPoint = { valence: number; arousal: number };

/* ── OKLab ─────────────────────────────────────────────────────────── */
type Lab = [number, number, number];

function toLab([r, g, b]: RGB): Lab {
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  const R = lin(r), G = lin(g), B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function toRgb([L, A, B]: Lab): RGB {
  const l = L + 0.3963377774 * A + 0.2158037573 * B;
  const m = L - 0.1055613458 * A - 0.0638541728 * B;
  const s = L - 0.0894841775 * A - 1.291485548 * B;
  const l3 = l * l * l, m3 = m * m * m, s3 = s * s * s;
  const srgb = (x: number) => {
    const v = Math.max(0, Math.min(1, x));
    return Math.round((v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055) * 255);
  };
  return [
    srgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    srgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    srgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ];
}

const mix = (a: Lab, b: Lab, t: number): Lab => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const hex = ([r, g, b]: RGB) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const parse = (c: string): RGB | null => {
  const m = c.trim().match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
};

/* The mood palette at a point: below −0.35 valence fully the negative
   (red) side, above +0.35 fully the positive side, a smooth crossover in
   between; arousal blends the calm row into the excited one. */
export function moodColors(p: MoodPoint, dark: boolean): string[] {
  const c = dark ? PALETTE.dark : PALETTE.light;
  const t = Math.max(0, Math.min(1, (p.valence + 0.35) / 0.7));
  const u = t * t * (3 - 2 * t);
  const a = Math.max(0, Math.min(1, p.arousal));
  return c.happy.map((_, i) => {
    const top = mix(toLab(c.angry[i]), toLab(c.happy[i]), u);
    const bottom = mix(toLab(c.sad[i]), toLab(c.calm[i]), u);
    return hex(toRgb(mix(bottom, top, a)));
  });
}

/* The band's fringes take the mood too (75% of the way, as on SwiftUI);
   its core stays. */
export function moodBand<T extends { core: string; above: string; mid: string; below: string }>(band: T, colors: string[]): T {
  const tint = (c: string, m: string) => {
    const a = parse(c), b = parse(m);
    return a && b ? hex(toRgb(mix(toLab(a), toLab(b), 0.75))) : c;
  };
  return { ...band, above: tint(band.above, colors[1]), mid: tint(band.mid, colors[0]), below: tint(band.below, colors[2]) };
}
