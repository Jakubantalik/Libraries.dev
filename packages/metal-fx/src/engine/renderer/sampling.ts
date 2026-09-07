/**
 * Pixel readback and luminance/colour sampling from the shared GL canvas.
 *
 * All glow luminance/color sampling reads from a shared pixel buffer
 * (SHARED.glowPixels). The buffer is refreshed via gl.readPixels at most
 * every GLOW_READBACK_INTERVAL_MS to avoid the expensive GPU→CPU pipeline
 * flush on every frame. The plasma shader evolves slowly so 200ms-stale
 * data is visually indistinguishable.
 */
import { GLOW_READBACK_INTERVAL_MS } from '../perfConfig';
import { SHARED, CANONICAL_PILL_W, CANONICAL_PILL_H, type MetalFxInstance, type ShaderRGB } from './core';
let _lastReadbackMs = 0;

export function ensureGlowPixels(): void {
  if (!SHARED) return;
  const now = performance.now();
  if (now - _lastReadbackMs < GLOW_READBACK_INTERVAL_MS) return;
  _lastReadbackMs = now;
  const { gl, glCanvas } = SHARED;
  const cw = glCanvas.width, ch = glCanvas.height;
  if (SHARED.glowPixelsW !== cw || SHARED.glowPixelsH !== ch) {
    SHARED.glowPixelsW = cw;
    SHARED.glowPixelsH = ch;
    SHARED.glowPixels = new Uint8Array(cw * ch * 4);
  }
  gl.readPixels(0, 0, cw, ch, gl.RGBA, gl.UNSIGNED_BYTE, SHARED.glowPixels);
}

/**
 * Map per-instance CSS-px glow coordinates to the shared GL pixel buffer.
 *
 * The GL canvas is shared across all instances. Each instance "sees" a
 * different crop of it (computed identically to copyShaderToInstance).
 * This function reverses that mapping: given a CSS-px coordinate on the
 * instance, it returns the (bx, by) index into SHARED.glowPixels.
 *
 * readPixels stores rows bottom-up (GL convention) so Y is flipped.
 */
const _map = { bx: 0, by: 0 };

function mapToGlowBuf(inst: MetalFxInstance, cssPxX: number, cssPxY: number): typeof _map {
  if (!SHARED) { _map.bx = 0; _map.by = 0; return _map; }
  const { glCanvas } = SHARED;
  const cw = glCanvas.width, ch = glCanvas.height;
  const dpr = inst.dpr;
  const dw = inst.cssWidth * dpr, dh = inst.cssHeight * dpr;
  const bdW = CANONICAL_PILL_W * dpr, bdH = CANONICAL_PILL_H * dpr;
  let srcW = (dw * (cw / bdW)) / inst.shaderScale;
  let srcH = (dh * (ch / bdH)) / inst.shaderScale;
  if (srcW > cw) srcW = cw;
  if (srcH > ch) srcH = ch;
  const sx = (cw - srcW) / 2;
  const sy = (ch - srcH) / 2;
  const glX = sx + (cssPxX / inst.cssWidth) * srcW;
  const glY = sy + (cssPxY / inst.cssHeight) * srcH;
  _map.bx = Math.round(glX);
  _map.by = Math.round(ch - 1 - glY);
  return _map;
}

const _sr = { r: 0, g: 0, b: 0, lum: 0, count: 0 };

function sampleRegion(
  buf: Uint8Array, W: number, H: number,
  bx: number, by: number, radius: number
): typeof _sr {
  const r = Math.max(1, radius | 0);
  const x0 = Math.max(0, bx - r), x1 = Math.min(W, bx + r + 1);
  const y0 = Math.max(0, by - r), y1 = Math.min(H, by + r + 1);
  _sr.r = 0; _sr.g = 0; _sr.b = 0; _sr.lum = 0; _sr.count = 0;
  for (let py = y0; py < y1; py++) {
    const row = py * W;
    for (let px = x0; px < x1; px++) {
      const i = (row + px) * 4;
      _sr.r += buf[i]; _sr.g += buf[i + 1]; _sr.b += buf[i + 2];
      _sr.lum += (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      _sr.count++;
    }
  }
  return _sr;
}

const _rgb: ShaderRGB = { r: 255, g: 255, b: 255 };

export function sampleShaderLumAt(inst: MetalFxInstance, cssPxX: number, cssPxY: number, radius: number): number {
  if (!SHARED) return 0;
  ensureGlowPixels();
  const m = mapToGlowBuf(inst, cssPxX, cssPxY);
  const s = sampleRegion(SHARED.glowPixels, SHARED.glowPixelsW, SHARED.glowPixelsH, m.bx, m.by, radius);
  return s.count > 0 ? s.lum / s.count : 0;
}

export function sampleShaderRGBAt(inst: MetalFxInstance, cssPxX: number, cssPxY: number, radius: number): ShaderRGB {
  if (!SHARED) { _rgb.r = 255; _rgb.g = 255; _rgb.b = 255; return _rgb; }
  ensureGlowPixels();
  const m = mapToGlowBuf(inst, cssPxX, cssPxY);
  const s = sampleRegion(SHARED.glowPixels, SHARED.glowPixelsW, SHARED.glowPixelsH, m.bx, m.by, radius);
  if (s.count === 0) { _rgb.r = 255; _rgb.g = 255; _rgb.b = 255; return _rgb; }
  _rgb.r = s.r / s.count; _rgb.g = s.g / s.count; _rgb.b = s.b / s.count;
  return _rgb;
}

export function sampleShaderRGBChromatic(inst: MetalFxInstance, cssPxX: number, cssPxY: number, radius: number): ShaderRGB {
  if (!SHARED) { _rgb.r = 255; _rgb.g = 255; _rgb.b = 255; return _rgb; }
  ensureGlowPixels();
  const m = mapToGlowBuf(inst, cssPxX, cssPxY);
  const { glowPixels: buf, glowPixelsW: W, glowPixelsH: H } = SHARED;
  const r = Math.max(1, radius | 0);
  const x0 = Math.max(0, m.bx - r), x1 = Math.min(W, m.bx + r + 1);
  const y0 = Math.max(0, m.by - r), y1 = Math.min(H, m.by + r + 1);
  let bestScore = -1;
  _rgb.r = 255; _rgb.g = 255; _rgb.b = 255;
  for (let py = y0; py < y1; py++) {
    const row = py * W;
    for (let px = x0; px < x1; px++) {
      const i = (row + px) * 4;
      const rr = buf[i], gg = buf[i + 1], bb = buf[i + 2];
      const maxC = Math.max(rr, gg, bb), minC = Math.min(rr, gg, bb);
      const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
      const score = sat * (0.35 + 0.65 * (maxC / 255));
      if (score > bestScore) { bestScore = score; _rgb.r = rr; _rgb.g = gg; _rgb.b = bb; }
    }
  }
  return _rgb;
}

const _pk = { r: 255, g: 255, b: 255, lum: 0 };

/** Brightest pixel in the window (not the mean) — for "is the ring shining
 *  here" questions, where a dark stripe next to a bright one should still
 *  read as lit. */
export function sampleShaderPeakAt(inst: MetalFxInstance, cssPxX: number, cssPxY: number, radius: number): typeof _pk {
  _pk.r = 255; _pk.g = 255; _pk.b = 255; _pk.lum = 0;
  if (!SHARED) return _pk;
  ensureGlowPixels();
  const m = mapToGlowBuf(inst, cssPxX, cssPxY);
  const { glowPixels: buf, glowPixelsW: W, glowPixelsH: H } = SHARED;
  const r = Math.max(1, radius | 0);
  const x0 = Math.max(0, m.bx - r), x1 = Math.min(W, m.bx + r + 1);
  const y0 = Math.max(0, m.by - r), y1 = Math.min(H, m.by + r + 1);
  for (let py = y0; py < y1; py++) {
    const row = py * W;
    for (let px = x0; px < x1; px++) {
      const i = (row + px) * 4;
      const lum = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
      if (lum > _pk.lum) { _pk.lum = lum; _pk.r = buf[i]; _pk.g = buf[i + 1]; _pk.b = buf[i + 2]; }
    }
  }
  return _pk;
}
