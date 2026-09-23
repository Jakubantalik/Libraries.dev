/** Parse #rgb / #rrggbb / rgb() / hsl() into 0–255 channels; null for anything else. */
export function parseColor(input: string): [number, number, number] | null {
  const s = input.trim();
  const hsl = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i);
  if (hsl) return hslToRgb([Number(hsl[1]) / 360, Number(hsl[2]) / 100, Number(hsl[3]) / 100]);
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

/** Relative luminance (WCAG), 0–1. Unparseable colours count as mid-grey. */
export function luminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0.5;
  const lin = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

export const DARK_INK = '#1E1A33';
export const LIGHT_INK = '#F7F5F2';

/** Face ink for a body colour: dark ink, or light ink on a dark body. */
export function autoInk(color: string): string {
  return luminance(color) < 0.13 ? LIGHT_INK : DARK_INK;
}

/* ── HSL, for the body's shades ─────────────────────────────────────── */

function rgbToHsl([r, g, b]: [number, number, number]): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): [number, number, number] {
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}

function hslToCss([h, s, l]: [number, number, number]): string {
  return `hsl(${(h * 360).toFixed(1)} ${(s * 100).toFixed(1)}% ${(l * 100).toFixed(1)}%)`;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * A shade of a colour: `dl` moves the lightness (−1..1), `ds` the
 * saturation. Darker shades get a touch more saturation so they stay
 * rich instead of going grey, the way a painted surface falls into shadow.
 */
export function shade(color: string, dl: number, ds = 0): string {
  const c = parseColor(color);
  if (!c) return color;
  const [h, s, l] = rgbToHsl(c);
  return hslToCss([h, clamp01(s + ds + (dl < 0 ? -dl * 0.25 : 0)), clamp01(l + dl)]);
}
