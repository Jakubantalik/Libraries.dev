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

/* OKLab, for moving a colour along its own hue (Björn Ottosson's) */
const toLinear = (u: number) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
const toSrgb = (u: number) => (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055);
function oklab(r: number, g: number, b: number): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab(L: number, a: number, b: number): [number, number, number] {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const inGamut = (c: [number, number, number]) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** A more vivid version of a colour, `t` 0–1: its chroma raised along its
    own hue (in OKLab) by up to half again. Where the screen cannot show that
    at the same lightness, the colour deepens a little — by at most 15% of
    its lightness — toward the hue's most vivid shade (a sky blue toward a
    royal one), and the chroma stops at whatever the screen can show. */
export function richer(color: string, t: number): string {
  const c = parseColor(color);
  if (!c || !(t > 0)) return color;
  const [L, a, b] = oklab(toLinear(c[0] / 255), toLinear(c[1] / 255), toLinear(c[2] / 255));
  const C = Math.hypot(a, b);
  if (C < 1e-4) return color;
  const ua = a / C, ub = b / C;
  const want = C * (1 + 0.5 * t);
  let best: [number, number, number] | null = null, bestC = C;
  /* the lightness from the colour's own down to 15% deeper, in steps; at
     each, the most chroma the screen shows up to `want` */
  for (let k = 0; k <= 6; k++) {
    const Lk = L * (1 - (0.15 * t * k) / 6);
    let lo = 0, hi = want;
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2;
      if (inGamut(fromOklab(Lk, ua * mid, ub * mid))) lo = mid;
      else hi = mid;
    }
    /* deeper only for what it gains: each step must buy real chroma */
    if (lo > bestC + 0.004 * k) {
      bestC = lo;
      best = fromOklab(Lk, ua * lo, ub * lo);
    }
    if (lo >= want - 1e-4) break;
  }
  if (!best) return color;
  const out = best.map((v) => Math.round(255 * toSrgb(Math.min(1, Math.max(0, v)))));
  return `rgb(${out[0]} ${out[1]} ${out[2]})`;
}
