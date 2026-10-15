/**
 * Canvas 2D drawing primitives for proximity reflections.
 *
 * All the low-level compositing passes — rounded-rect paths, ring clips,
 * fill/stroke multi-pass alpha stacking, mirror-flip drawImage, and the
 * border-highlight gradient stroke.
 */
import { RANGE_PX } from './constants';

// ─── Layout helpers ───────────────────────────────────────────────────────

export function shortestRectDistance(a: DOMRect, b: DOMRect): number {
  const dx = Math.max(a.left - b.right, b.left - a.right, 0);
  const dy = Math.max(a.top - b.bottom, b.top - a.bottom, 0);
  return Math.sqrt(dx * dx + dy * dy);
}

export function isHorizontalNeighbour(anchorRect: DOMRect, targetRect: DOMRect, overlapMin: number, attachRange: number): boolean {
  const verticalOverlap =
    Math.min(anchorRect.bottom, targetRect.bottom) -
    Math.max(anchorRect.top, targetRect.top);
  if (verticalOverlap < overlapMin) return false;
  const horizontalGap = Math.max(
    anchorRect.left - targetRect.right,
    targetRect.left - anchorRect.right,
    0
  );
  if (horizontalGap > attachRange) return false;
  return true;
}

export function isVerticalNeighbour(anchorRect: DOMRect, targetRect: DOMRect, overlapMin: number, attachRange: number): boolean {
  const horizontalOverlap =
    Math.min(anchorRect.right, targetRect.right) -
    Math.max(anchorRect.left, targetRect.left);
  if (horizontalOverlap < overlapMin) return false;
  const verticalGap = Math.max(
    anchorRect.top - targetRect.bottom,
    targetRect.top - anchorRect.bottom,
    0
  );
  return verticalGap <= attachRange;
}

// ─── Path helpers ─────────────────────────────────────────────────────────

export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const native = (ctx as any).roundRect;
  if (typeof native === 'function') {
    native.call(ctx, x, y, w, h, rr);
    return;
  }
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
}

// ─── Draw source (mirror flip) ───────────────────────────────────────────

export interface DrawDst {
  x: number;
  y: number;
  w: number;
  h: number;
  flipX: boolean;
  flipY: boolean;
  /** Source-rect origin in the anchor canvas, device px. Non-zero while the
   *  anchor is overscanned (vector bend) so only its CSS box is sampled. */
  sx?: number;
  sy?: number;
}

export function drawSource(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  dst: DrawDst
): void {
  if (!dst.flipX && !dst.flipY) {
    ctx.drawImage(src, dst.sx ?? 0, dst.sy ?? 0, sw, sh, dst.x, dst.y, dst.w, dst.h);
    return;
  }
  ctx.save();
  if (dst.flipX) {
    ctx.translate(dst.x + dst.w, 0);
    ctx.scale(-1, 1);
  }
  if (dst.flipY) {
    ctx.translate(0, dst.y + dst.h);
    ctx.scale(1, -1);
  }
  ctx.drawImage(
    src,
    dst.sx ?? 0,
    dst.sy ?? 0,
    sw,
    sh,
    dst.flipX ? 0 : dst.x,
    dst.flipY ? 0 : dst.y,
    dst.w,
    dst.h
  );
  ctx.restore();
}

// ─── Clip + compositing passes ────────────────────────────────────────────

export interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

const FILL_BLUR_CSS_PX = 4;

function fillRingClip(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radiusDevPx: number, bandDevPx: number
): void {
  if (w <= 2 * bandDevPx || h <= 2 * bandDevPx) {
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, radiusDevPx);
    ctx.clip();
    return;
  }
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, radiusDevPx);
  roundRectPath(ctx, x + bandDevPx, y + bandDevPx, w - 2 * bandDevPx, h - 2 * bandDevPx, Math.max(0, radiusDevPx - bandDevPx));
  ctx.clip('evenodd');
}

export function maskedFillPasses(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number, sh: number,
  tw: number, th: number,
  totalAlpha: number,
  grad: CanvasGradient,
  dst: DrawDst,
  fillBox: BoxRect,
  dpr: number,
  /** Override for the edge band the fill is clipped to, device px. Glyph
   *  targets pass the whole box — letters have no "rim" to hug. */
  bandDevPxOverride?: number
): void {
  const fillBandDevPx = bandDevPxOverride ?? Math.max(1, Math.round((RANGE_PX + FILL_BLUR_CSS_PX * 3) * dpr));
  let remaining = Math.max(0, totalAlpha);
  let firstChunk = true;
  for (let i = 0; i < 3 && remaining > 1e-4; i++) {
    const a = Math.min(1, remaining);
    ctx.save();
    fillRingClip(ctx, fillBox.x, fillBox.y, fillBox.w, fillBox.h, fillBox.r, fillBandDevPx);
    ctx.globalCompositeOperation = firstChunk ? 'source-over' : 'lighter';
    firstChunk = false;
    ctx.globalAlpha = a;
    drawSource(ctx, src, sw, sh, dst);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tw, th);
    ctx.restore();
    remaining -= a;
  }
}

function insideStrokeEvenOddClip(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  radiusDevPx: number, strokeDevPx: number
): void {
  const r = strokeDevPx | 0;
  if (r < 1 || w <= 2 * r || h <= 2 * r) {
    ctx.beginPath();
    roundRectPath(ctx, x, y, w, h, radiusDevPx);
    ctx.clip();
    return;
  }
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, radiusDevPx);
  roundRectPath(ctx, x + r, y + r, w - 2 * r, h - 2 * r, Math.max(0, radiusDevPx - r));
  ctx.clip('evenodd');
}

export function maskedStrokePasses(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number, sh: number,
  tw: number, th: number,
  strokeBox: BoxRect,
  intensity: number,
  strokeBandPx: number,
  grad: CanvasGradient,
  strokeExtraAlpha: number,
  dst: DrawDst
): void {
  let remaining = intensity * strokeExtraAlpha;
  let firstChunk = true;
  for (let i = 0; i < 3 && remaining > 1e-4; i++) {
    const a = Math.min(1, remaining);
    ctx.save();
    insideStrokeEvenOddClip(ctx, strokeBox.x, strokeBox.y, strokeBox.w, strokeBox.h, strokeBox.r, strokeBandPx);
    ctx.globalCompositeOperation = firstChunk ? 'source-over' : 'lighter';
    firstChunk = false;
    ctx.globalAlpha = a;
    drawSource(ctx, src, sw, sh, dst);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, tw, th);
    ctx.restore();
    remaining -= a;
  }
}

export function drawBorderHighlight(
  ctx: CanvasRenderingContext2D,
  strokeBox: BoxRect,
  strokeDevPx: number,
  g0x: number, g0y: number,
  g1x: number, g1y: number,
  alpha: number
): void {
  const grad = ctx.createLinearGradient(g0x, g0y, g1x, g1y);
  grad.addColorStop(0, `rgba(255,255,255,${alpha.toFixed(3)})`);
  grad.addColorStop(0.5, `rgba(255,255,255,${(alpha * 0.45).toFixed(3)})`);
  grad.addColorStop(1, 'rgba(255,255,255,0)');

  ctx.save();
  insideStrokeEvenOddClip(ctx, strokeBox.x, strokeBox.y, strokeBox.w, strokeBox.h, strokeBox.r, strokeDevPx);
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineWidth = strokeDevPx * 2;
  ctx.strokeStyle = grad;
  ctx.beginPath();
  roundRectPath(ctx, strokeBox.x, strokeBox.y, strokeBox.w, strokeBox.h, strokeBox.r);
  ctx.stroke();
  ctx.restore();
}
