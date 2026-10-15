/**
 * Pre-rendered glow sprites.
 *
 * The halo used to be four blurred SVG strokes re-rasterised through
 * `feGaussianBlur` on every move. Here the same strokes are rendered once,
 * in white, into small alpha bitmaps; the per-frame work is then a couple of
 * `drawImage` calls. Blur is a 3-pass box blur on the alpha channel (a close
 * gaussian approximation) so it doesn't depend on `ctx.filter` support.
 *
 * Sprites are cached by everything that shapes them — half-length, scale,
 * device pixel ratio and the GLOW markup values — and shared by every
 * instance with the same key.
 */
import { GLOW } from './config';

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Alpha per device pixel, row-major — the source for tinting. */
  alpha: Uint8ClampedArray;
  /** CSS-px size to draw it at. */
  w: number;
  h: number;
  /** CSS-px offset from the sprite's top-left to its anchor (stroke centre). */
  ax: number;
  ay: number;
}

const cache = new Map<string, Sprite>();

// ─── Blur ─────────────────────────────────────────────────────────────────

/** Box sizes for `n` passes approximating a gaussian of `sigma` (Kutskir). */
function boxesForGauss(sigma: number, n: number): number[] {
  const wIdeal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(wIdeal);
  if (wl % 2 === 0) wl--;
  const wu = wl + 2;
  const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
  const m = Math.round(mIdeal);
  const sizes: number[] = [];
  for (let i = 0; i < n; i++) sizes.push(i < m ? wl : wu);
  return sizes;
}

function boxBlurH(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const iarr = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      dst[row + x] = acc * iarr;
      const out = row + Math.max(0, x - r), inn = row + Math.min(w - 1, x + r + 1);
      acc += src[inn] - src[out];
    }
  }
}

function boxBlurV(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const iarr = 1 / (r + r + 1);
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = acc * iarr;
      const out = Math.max(0, y - r) * w + x, inn = Math.min(h - 1, y + r + 1) * w + x;
      acc += src[inn] - src[out];
    }
  }
}

export function gaussBlur(a: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0.05) return a;
  const tmp = new Float32Array(a.length);
  let cur = a;
  for (const box of boxesForGauss(sigma, 3)) {
    const r = (box - 1) / 2;
    boxBlurH(cur, tmp, w, h, r);
    boxBlurV(tmp, cur, w, h, r);
  }
  return cur;
}

// ─── Rasterising ──────────────────────────────────────────────────────────

interface Layer { stroke: number; blur: number; opacity: number }

/** Alpha of a horizontal round-capped line of `halfLen` at the given width,
 *  rendered through the 2D canvas so the AA matches what SVG produced. */
function strokeAlpha(halfLen: number, strokeW: number, w: number, h: number, dpr: number, ax: number, ay: number): Float32Array {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  const out = new Float32Array(w * h);
  if (!g) return out;
  g.scale(dpr, dpr);
  g.strokeStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = strokeW;
  g.beginPath();
  g.moveTo(ax - halfLen, ay);
  g.lineTo(ax + halfLen, ay);
  g.stroke();
  const d = g.getImageData(0, 0, w, h).data;
  for (let i = 0, j = 3; i < out.length; i++, j += 4) out[i] = d[j] / 255;
  return out;
}

function compose(layers: Layer[], halfLen: number, s: number, dpr: number, fade: number): Sprite {
  let padMax = 0;
  for (const l of layers) padMax = Math.max(padMax, (l.stroke / 2 + 3 * l.blur) * s);
  const pad = Math.ceil(padMax) + 1;
  const cw = 2 * halfLen + 2 * pad, ch = 2 * pad;
  const w = Math.ceil(cw * dpr), h = Math.ceil(ch * dpr);
  const acc = new Float32Array(w * h);
  for (const l of layers) {
    let a = strokeAlpha(halfLen, l.stroke * s, w, h, dpr, pad, pad);
    a = gaussBlur(a, w, h, l.blur * s * dpr);
    const op = l.opacity;
    // White over white: only alpha composes.
    for (let i = 0; i < acc.length; i++) { const la = a[i] * op; acc[i] = acc[i] + la * (1 - acc[i]); }
  }
  if (fade > 0) {
    // SVG luminance mask: white to 0.30, #404040 (0.25) at 0.65, black at 1.
    const cx = pad * dpr, cy = pad * dpr, R = fade * s * dpr;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / R;
      let m: number;
      if (t <= 0.3) m = 1;
      else if (t <= 0.65) m = 1 - ((t - 0.3) / 0.35) * 0.75;
      else if (t < 1) m = 0.25 * (1 - (t - 0.65) / 0.35);
      else m = 0;
      acc[y * w + x] *= m;
    }
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const alpha = new Uint8ClampedArray(w * h);
  for (let i = 0; i < acc.length; i++) alpha[i] = Math.round(Math.min(1, acc[i]) * 255);
  if (g) {
    const img = g.createImageData(w, h);
    const d = img.data;
    for (let i = 0, j = 0; i < acc.length; i++, j += 4) {
      d[j] = 255; d[j + 1] = 255; d[j + 2] = 255; d[j + 3] = alpha[i];
    }
    g.putImageData(img, 0, 0);
  }
  return { canvas: c, alpha, w: cw, h: ch, ax: pad, ay: pad };
}

function markupKey(): string {
  return [
    GLOW.haloStrokeXl, GLOW.haloStrokeLg, GLOW.haloStrokeMd, GLOW.haloStrokeSm,
    GLOW.haloBlurXl, GLOW.haloBlurLg, GLOW.haloBlurMd, GLOW.haloBlurSm,
    GLOW.haloOpXl, GLOW.haloOpLg, GLOW.haloOpMd, GLOW.haloOpSm,
    GLOW.extraStrokeOuter, GLOW.extraStrokeCore, GLOW.extraBlurOuter, GLOW.extraBlurCore,
    GLOW.extraFadeR, GLOW.extraOpOuter,
  ].join(',');
}

/** The wide halo: four blurred strokes stacked, at `halfLen` half-length. */
export function bakeHalo(halfLen: number, s: number, dpr: number): Sprite {
  const key = `h|${halfLen.toFixed(2)}|${s}|${dpr}|${markupKey()}`;
  let sp = cache.get(key);
  if (!sp) {
    sp = compose([
      { stroke: GLOW.haloStrokeXl, blur: GLOW.haloBlurXl, opacity: GLOW.haloOpXl },
      { stroke: GLOW.haloStrokeLg, blur: GLOW.haloBlurLg, opacity: GLOW.haloOpLg },
      { stroke: GLOW.haloStrokeMd, blur: GLOW.haloBlurMd, opacity: GLOW.haloOpMd },
      { stroke: GLOW.haloStrokeSm, blur: GLOW.haloBlurSm, opacity: GLOW.haloOpSm },
    ], halfLen, s, dpr, 0);
    cache.set(key, sp);
  }
  return sp;
}

/** The catch-light: two tight strokes with a radial fade at the ends. */
export function bakeExtra(halfLen: number, s: number, dpr: number): Sprite {
  const key = `e|${halfLen.toFixed(2)}|${s}|${dpr}|${markupKey()}`;
  let sp = cache.get(key);
  if (!sp) {
    sp = compose([
      { stroke: GLOW.extraStrokeOuter, blur: GLOW.extraBlurOuter, opacity: GLOW.extraOpOuter },
      { stroke: GLOW.extraStrokeCore, blur: GLOW.extraBlurCore, opacity: 1 },
    ], halfLen, s, dpr, GLOW.extraFadeR);
    cache.set(key, sp);
  }
  return sp;
}

/** A tinted copy of a white sprite. `holder` caches by tint so the re-tint
 *  only happens when the colour actually changes. Pixel-data based on
 *  purpose: no `source-in` compositing, which WebKit intermittently gets
 *  wrong on accelerated canvases (a solid rectangle instead of the shape). */
export interface Tinted { canvas: HTMLCanvasElement | null; img: ImageData | null; tint: number; src: Sprite | null }

export function tintSprite(src: Sprite, r: number, g: number, b: number, holder: Tinted): HTMLCanvasElement {
  const key = (r << 16) | (g << 8) | b;
  if (holder.canvas && holder.tint === key && holder.src === src) return holder.canvas;
  let c = holder.canvas;
  let img = holder.img;
  if (!c || !img || holder.src !== src) {
    c = document.createElement('canvas');
    c.width = src.canvas.width; c.height = src.canvas.height;
    img = c.getContext('2d')?.createImageData(c.width, c.height) ?? null;
  }
  const ctx = c.getContext('2d');
  if (ctx && img) {
    const d = img.data, a = src.alpha;
    for (let i = 0, j = 0; i < a.length; i++, j += 4) { d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = a[i]; }
    ctx.putImageData(img, 0, 0);
  }
  holder.canvas = c; holder.img = img; holder.tint = key; holder.src = src;
  return c;
}
