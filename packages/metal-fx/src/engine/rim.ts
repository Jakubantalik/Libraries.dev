/**
 * Inner-shadow rim on the metal ring — the same treatment the "Pro" text
 * carries (Figma: white 90 %, offset 0/1, blur 0.5): a hairline of light
 * along the top inside edge of the band.
 *
 * Computed, not CSS: band alpha minus the same alpha shifted down by the
 * offset leaves exactly the top rim (outer edge on the ring's upper half,
 * inner edge on its lower half — what a light from above does to a torus).
 * Blurred, tinted, drawn to a small overlay canvas above the metal. Redrawn
 * only when the outline changes (deform), so it's free at rest.
 */
import type { DeformFn } from './renderer/core';
import { gaussBlur } from './glow/bake';
import { type OutlineBuf, createOutlineBuf, roundRectOutline } from './renderer/outline';

export interface RimOptions {
  /** Shadow offset, CSS px (positive = light from above). */
  offsetY: number;
  /** Blur, CSS px. */
  blur: number;
  /** Peak opacity of the rim (0..1). */
  alpha: number;
  /** Rim colour, `#rrggbb`. */
  color: string;
}

export const RIM_DEFAULTS: Readonly<RimOptions> = Object.freeze({ offsetY: 1, blur: 0.5, alpha: 0.9, color: '#ffffff' });

export interface RimHandles {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  scratch: HTMLCanvasElement;
  sctx: CanvasRenderingContext2D;
  width: number; height: number; cornerRadius: number; kind: 'pill' | 'circle'; ring: number;
  margin: number; dpr: number;
  opts: RimOptions;
  mO: OutlineBuf; mI: OutlineBuf;
  /** Checksum of the outline last drawn; unchanged composites are skipped. */
  sum: number;
}

export function injectRim(
  container: HTMLElement,
  dims: { width: number; height: number; cornerRadius: number; kind: 'pill' | 'circle'; ring: number },
  opts: RimOptions
): RimHandles | null {
  const dpr = Math.min(3, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const margin = Math.ceil(3 * opts.blur + Math.abs(opts.offsetY) + 1);
  const cw = dims.width + 2 * margin, ch = dims.height + 2 * margin;
  const canvas = document.createElement('canvas');
  canvas.className = 'metal-fx-rim-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.width = Math.ceil(cw * dpr); canvas.height = Math.ceil(ch * dpr);
  canvas.style.cssText = `position:absolute;left:${-margin}px;top:${-margin}px;width:${cw}px;height:${ch}px;pointer-events:none`;
  const ctx = canvas.getContext('2d');
  const scratch = document.createElement('canvas');
  scratch.width = canvas.width; scratch.height = canvas.height;
  const sctx = scratch.getContext('2d', { willReadFrequently: true });
  if (!ctx || !sctx) return null;
  container.appendChild(canvas);
  const h: RimHandles = {
    canvas, ctx, scratch, sctx,
    width: dims.width, height: dims.height, cornerRadius: dims.cornerRadius, kind: dims.kind, ring: dims.ring,
    margin, dpr, opts, mO: createOutlineBuf(), mI: createOutlineBuf(), sum: Number.NaN,
  };
  updateRim(h, null, true);
  return h;
}

function trace(g: CanvasRenderingContext2D, buf: OutlineBuf, off: number): void {
  const xy = buf.xy;
  for (let i = 0; i < buf.n; i++) {
    const x = xy[i * 2] + off, y = xy[i * 2 + 1] + off;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

/** Redraw if the (deformed) outline changed. Cheap when it hasn't. */
export function updateRim(h: RimHandles, deform: DeformFn | null, force = false): void {
  const { width: W, height: H, cornerRadius: R, ring, margin: m, dpr } = h;
  roundRectOutline(0, 0, W, H, R, deform, h.mO);
  roundRectOutline(ring, ring, W - 2 * ring, H - 2 * ring, Math.max(0, R - ring), deform, h.mI);
  let sum = 0;
  const xy = h.mO.xy;
  for (let i = 0; i < h.mO.n; i += 4) sum += xy[i * 2] * 1.37 + xy[i * 2 + 1];
  if (!force && sum === h.sum) return;
  h.sum = sum;

  const { sctx: g, scratch: sc, ctx, canvas: cv, opts } = h;
  const w = sc.width, hh = sc.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, w, hh);
  g.scale(dpr, dpr);
  g.fillStyle = '#fff';
  g.beginPath();
  trace(g, h.mO, m);
  trace(g, h.mI, m);
  g.fill('evenodd');

  const d = g.getImageData(0, 0, w, hh).data;
  const n = w * hh;
  const a = new Float32Array(n);
  for (let i = 0, j = 3; i < n; i++, j += 4) a[i] = d[j] / 255;
  const shift = Math.round(opts.offsetY * dpr) * w;
  const rim = new Float32Array(n);
  if (shift >= 0) {
    for (let i = 0; i < n; i++) rim[i] = a[i] * (1 - (i >= shift ? a[i - shift] : 0));
  } else {
    for (let i = 0; i < n; i++) rim[i] = a[i] * (1 - (i - shift < n ? a[i - shift] : 0));
  }
  const blurred = gaussBlur(rim, w, hh, opts.blur * dpr);

  const cr = parseInt(opts.color.slice(1, 3), 16), cg = parseInt(opts.color.slice(3, 5), 16), cb = parseInt(opts.color.slice(5, 7), 16);
  const img = ctx.createImageData(w, hh);
  const o = img.data;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    o[j] = cr; o[j + 1] = cg; o[j + 2] = cb;
    o[j + 3] = Math.round(Math.min(1, blurred[i] * opts.alpha) * 255);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.putImageData(img, 0, 0);
  void cv;
}

export function removeRim(h: RimHandles | null): void {
  if (h) h.canvas.remove();
}
