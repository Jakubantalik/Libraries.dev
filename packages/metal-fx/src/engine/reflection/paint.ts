/** Proximity reflection — public API and per-frame paint loop. */
import type { MetalFxInstance } from '../renderer/core';
import {
  ATTACH_RANGE_PX,
  BASE_ALPHA,
  BOOST_ALPHA,
  BORDER_HILITE_ALPHA,
  BORDER_HILITE_PX,
  FILL_CIRCLE_ATTENUATION,
  FILL_EXTRA_ALPHA,
  FILL_OPACITY_MUL,
  GLOBAL_ATTENUATION,
  GRAD_FAR,
  GRAD_MID,
  GRAD_NEAR,
  OVERLAP_MIN_PX,
  INTENSITY_MULT,
  MAX_ALPHA_STACK,
  RANGE_PX,
  REF_DRAW_CSS_W,
  REFLECTION_BLOCKED_TAGS,
  STROKE_CSS_PX,
  STROKE_EXTRA_ALPHA,
  type ReflectionTarget,
} from './constants';
import {
  type BoxRect,
  type DrawDst,
  drawBorderHighlight,
  isHorizontalNeighbour,
  isVerticalNeighbour,
  maskedFillPasses,
  maskedStrokePasses,
  shortestRectDistance,
} from './geometry';
import { attachObservers, detachObservers, readCornerRadius, readHairlineSpec } from './observers';

export type { ReflectionTarget } from './constants';

const targets: Set<ReflectionTarget> = new Set();

// ─── Cursor occluder ──────────────────────────────────────────────────────
// The reflection is light leaving the anchor and landing on the target. A
// pointer sitting in the gap between them blocks some of that light, so we
// cut a soft shadow band out of the painted reflection at the pointer's
// position across the layout axis. The band widens with distance from the
// target (penumbra from an extended source) and is only applied while the
// pointer is actually inside the gap.

export interface ReflectionOccluderConfig {
  enabled: boolean;
  /** Occluder radius, CSS px — how "big" the cursor is as a light blocker. */
  radius: number;
  /** Peak shadow depth (0..1) with the pointer right at the target's edge. */
  strength: number;
  /** Penumbra growth: band half-height multiplier at the anchor's edge. */
  penumbra: number;
  /** How much depth is lost as the pointer moves from target edge (0) to
   *  anchor edge (1). 0 = same shadow everywhere in the gap. */
  falloff: number;
  /** Fade-in distance at the gap's ends, as a multiple of `radius`. */
  edgeFade: number;
  /** Band profile. 1 = smooth triangle, 0 = hard-edged plateau. */
  softness: number;
  /** Repaint throttle while the pointer moves, ms. */
  repaintMs: number;
}

export const REFLECTION_OCCLUDER_DEFAULTS: Readonly<ReflectionOccluderConfig> = Object.freeze({
  enabled: true,
  radius: 20,
  strength: 1,
  penumbra: 0.55,
  falloff: 0.21,
  edgeFade: 0.7,
  softness: 0.24,
  repaintMs: 36,
});

export const REFLECTION_OCCLUDER: ReflectionOccluderConfig = { ...REFLECTION_OCCLUDER_DEFAULTS };

export function setReflectionOccluderConfig(patch: Partial<ReflectionOccluderConfig>): void {
  Object.assign(REFLECTION_OCCLUDER, patch);
  scheduleOccluderRepaint();
}

export function resetReflectionOccluderConfig(): void {
  setReflectionOccluderConfig({ ...REFLECTION_OCCLUDER_DEFAULTS });
}

let occluder: { x: number; y: number } | null = null;
let occluderRaf = 0;
let occluderLastMs = 0;
let pointerTracked = false;

function scheduleOccluderRepaint(): void {
  if (occluderRaf !== 0 || typeof requestAnimationFrame === 'undefined') return;
  occluderRaf = requestAnimationFrame((now) => {
    occluderRaf = 0;
    // 30 fps is plenty for a shadow that follows a hand.
    if (now - occluderLastMs < REFLECTION_OCCLUDER.repaintMs) { scheduleOccluderRepaint(); return; }
    occluderLastMs = now;
    paintReflections();
  });
}

// Repaint only while the pointer can actually cast a shadow — inside the
// region spanning some anchor and its target (expanded by the occluder
// radius) — plus one more repaint on the way out to clear it. Without this
// every mouse move anywhere on the page re-rasterised every reflection.
let occluderWasNear = false;
function pointerNearAnyGap(x: number, y: number): boolean {
  const r = REFLECTION_OCCLUDER.radius;
  for (const t of targets) {
    const a = t.anchorEl.getBoundingClientRect();
    const b = t.el.getBoundingClientRect();
    const l = Math.min(a.left, b.left) - r, rt = Math.max(a.right, b.right) + r;
    const tp = Math.min(a.top, b.top) - r, bt = Math.max(a.bottom, b.bottom) + r;
    if (x >= l && x <= rt && y >= tp && y <= bt) return true;
  }
  return false;
}
function onOccluderMove(e: PointerEvent): void {
  occluder = { x: e.clientX, y: e.clientY };
  if (!REFLECTION_OCCLUDER.enabled) return;
  const near = pointerNearAnyGap(e.clientX, e.clientY);
  if (near || occluderWasNear) scheduleOccluderRepaint();
  occluderWasNear = near;
}
function onOccluderLeave(): void {
  occluder = null;
  if (occluderWasNear) scheduleOccluderRepaint();
  occluderWasNear = false;
}

function ensurePointerTracking(on: boolean): void {
  if (typeof document === 'undefined' || on === pointerTracked) return;
  pointerTracked = on;
  if (on) {
    document.addEventListener('pointermove', onOccluderMove, { passive: true });
    document.addEventListener('pointerleave', onOccluderLeave);
    window.addEventListener('blur', onOccluderLeave);
  } else {
    document.removeEventListener('pointermove', onOccluderMove);
    document.removeEventListener('pointerleave', onOccluderLeave);
    window.removeEventListener('blur', onOccluderLeave);
    occluder = null;
  }
}

/**
 * Cut the pointer's shadow out of a freshly painted reflection.
 * `horiz` — layout axis; light travels along x when true.
 */
function applyOccluderShadow(
  ctx: CanvasRenderingContext2D,
  strokeCtx: CanvasRenderingContext2D,
  aRect: DOMRect,
  tRect: DOMRect,
  horiz: boolean,
  tw: number,
  th: number,
  overscanCssPx: number,
  dpr: number
): void {
  if (!occluder) return;
  const cfg = REFLECTION_OCCLUDER;
  if (!cfg.enabled || cfg.strength <= 0) return;
  const r = cfg.radius;

  // Gap along the layout axis between the two facing edges, and the overlap
  // band across it. Pointer must be inside (expanded by r) for any effect.
  let gapStart: number, gapEnd: number, along: number, across: number, bandLo: number, bandHi: number;
  if (horiz) {
    const anchorRight = aRect.left >= tRect.right;
    gapStart = anchorRight ? tRect.right : aRect.right;   // target-side edge
    gapEnd = anchorRight ? aRect.left : tRect.left;       // anchor-side edge
    along = occluder.x; across = occluder.y;
    bandLo = Math.max(aRect.top, tRect.top); bandHi = Math.min(aRect.bottom, tRect.bottom);
  } else {
    const anchorBelow = aRect.top >= tRect.bottom;
    gapStart = anchorBelow ? tRect.bottom : aRect.bottom;
    gapEnd = anchorBelow ? aRect.top : tRect.top;
    along = occluder.y; across = occluder.x;
    bandLo = Math.max(aRect.left, tRect.left); bandHi = Math.min(aRect.right, tRect.right);
  }
  const lo = Math.min(gapStart, gapEnd), hi = Math.max(gapStart, gapEnd);
  const gapW = Math.max(1, hi - lo);
  if (along < lo - r || along > hi + r) return;
  if (across < bandLo - r || across > bandHi + r) return;

  // 0 at the target's edge, 1 at the anchor's edge.
  const t = Math.max(0, Math.min(1, Math.abs(along - gapStart) / gapW));
  // Fade at the region's edges on both axes so entering/leaving from any
  // side eases in instead of popping — coming at the gap from above or
  // below used to land the full band in one frame.
  const fadePx = Math.max(0.5, r * cfg.edgeFade);
  const endFade = Math.min(1, Math.min(along - (lo - r), (hi + r) - along) / fadePx);
  const sideFade = Math.min(1, Math.min(across - (bandLo - r), (bandHi + r) - across) / fadePx);
  const depth = cfg.strength * (1 - cfg.falloff * t) * endFade * sideFade;
  if (depth <= 0.001) return;

  const halfBand = r * dpr * (1 + cfg.penumbra * t);
  // Position across the target, in the target canvas' device space.
  const c = horiz
    ? (across - tRect.top + overscanCssPx) * dpr
    : (across - tRect.left + overscanCssPx) * dpr;
  // softness 1 → triangle; 0 → flat plateau across the whole band.
  const core = Math.max(0, Math.min(0.5, (1 - cfg.softness) * 0.5));
  const ramp = Math.max(1e-3, 0.5 - core);

  // Cut the band out in pixel data. Not `destination-out`: WebKit
  // intermittently misapplies composite ops on accelerated canvases and
  // paints the band's rectangle instead — a flash at the band's edges.
  const span = horiz ? th : tw;
  const p0 = Math.max(0, Math.floor(c - halfBand)), p1 = Math.min(span, Math.ceil(c + halfBand));
  if (p1 <= p0) return;
  const factor = new Float32Array(p1 - p0);
  for (let i = p0; i < p1; i++) {
    const p = (i + 0.5 - (c - halfBand)) / (2 * halfBand);
    const a = p < ramp ? p / ramp : p > 1 - ramp ? (1 - p) / ramp : 1;
    factor[i - p0] = 1 - depth * Math.max(0, Math.min(1, a));
  }
  for (const c2d of [ctx, strokeCtx]) {
    const x = horiz ? 0 : p0, y = horiz ? p0 : 0;
    const w = horiz ? tw : p1 - p0, h = horiz ? p1 - p0 : th;
    const img = c2d.getImageData(x, y, w, h);
    const d = img.data;
    if (horiz) {
      for (let row = 0; row < h; row++) {
        const f = factor[row];
        if (f >= 0.999) continue;
        for (let j = row * w * 4 + 3, e = (row + 1) * w * 4; j < e; j += 4) d[j] = d[j] * f;
      }
    } else {
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const f = factor[col];
          if (f >= 0.999) continue;
          const j = (row * w + col) * 4 + 3;
          d[j] = d[j] * f;
        }
      }
    }
    c2d.putImageData(img, x, y);
  }
}

// Scratch pair for multi-edge (contained) targets. Each masked pass ends with
// a `destination-in` gradient over the whole ring clip, which would erase the
// previous edge's ink — so every edge after the first paints here and is
// composited back with `lighter`.
let scratchFill: HTMLCanvasElement | null = null;
let scratchStroke: HTMLCanvasElement | null = null;
let scratchFillCtx: CanvasRenderingContext2D | null = null;
let scratchStrokeCtx: CanvasRenderingContext2D | null = null;
function ensureScratch(w: number, h: number): boolean {
  if (!scratchFill) {
    scratchFill = document.createElement('canvas');
    scratchStroke = document.createElement('canvas');
    scratchFillCtx = scratchFill.getContext('2d', { alpha: true });
    scratchStrokeCtx = scratchStroke.getContext('2d', { alpha: true });
  }
  if (!scratchFillCtx || !scratchStrokeCtx || !scratchFill || !scratchStroke) return false;
  if (scratchFill.width !== w) { scratchFill.width = w; scratchStroke.width = w; }
  if (scratchFill.height !== h) { scratchFill.height = h; scratchStroke.height = h; }
  scratchFillCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchStrokeCtx.setTransform(1, 0, 0, 1, 0, 0);
  scratchFillCtx.globalCompositeOperation = 'source-over';
  scratchStrokeCtx.globalCompositeOperation = 'source-over';
  scratchFillCtx.clearRect(0, 0, w, h);
  scratchStrokeCtx.clearRect(0, 0, w, h);
  return true;
}

export function addReflectionTarget(
  el: HTMLElement,
  anchor: MetalFxInstance,
  anchorEl: HTMLElement,
  strength = 1
): ReflectionTarget | null {
  if (typeof document === 'undefined') return null;
  if (REFLECTION_BLOCKED_TAGS.has(el.tagName)) return null;
  for (const existing of targets) {
    if (existing.el === el) { existing.strength = strength; return existing; }
  }

  const wrap = document.createElement('div');
  wrap.setAttribute('data-metal-fx-reflection', '');
  wrap.setAttribute('aria-hidden', 'true');

  const canvas = document.createElement('canvas');
  canvas.className = 'metal-fx-reflection-canvas';
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!ctx) return null;

  const strokeCanvas = document.createElement('canvas');
  strokeCanvas.className = 'metal-fx-reflection-stroke-canvas';
  const strokeCtx = strokeCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
  if (!strokeCtx) return null;

  wrap.appendChild(canvas);
  wrap.appendChild(strokeCanvas);

  const cs = getComputedStyle(el);
  let appliedPositionRelative = false;
  if (cs.position === 'static') {
    el.style.position = 'relative';
    appliedPositionRelative = true;
  }
  let appliedIsolation = false;
  if (cs.isolation !== 'isolate') {
    el.style.isolation = 'isolate';
    appliedIsolation = true;
  }
  el.setAttribute('data-metal-fx-reflect-host', '');
  el.insertBefore(wrap, el.firstChild);

  const initialSpec = readHairlineSpec(el);
  const target: ReflectionTarget = {
    el,
    anchor,
    anchorEl,
    strength,
    wrap,
    canvas,
    ctx,
    strokeCanvas,
    strokeCtx,
    cornerRadius: readCornerRadius(el),
    hairlineWidth: initialSpec.width,
    hairlineOuterCssPx: initialSpec.outerCssPx,
    appliedPositionRelative,
    appliedIsolation,
    resizeObserver: null,
    mutationObserver: null,
  };
  attachObservers(target);
  targets.add(target);
  ensurePointerTracking(true);
  return target;
}

export function removeReflectionTarget(el: HTMLElement): void {
  for (const target of targets) {
    if (target.el === el) {
      detachObservers(target);
      target.canvas.width = 0;
      target.canvas.height = 0;
      target.strokeCanvas.width = 0;
      target.strokeCanvas.height = 0;
      if (target.wrap.parentNode === target.el) {
        target.el.removeChild(target.wrap);
      }
      target.el.removeAttribute('data-metal-fx-reflect-host');
      if (target.appliedPositionRelative) target.el.style.position = '';
      if (target.appliedIsolation) target.el.style.isolation = '';
      targets.delete(target);
      if (targets.size === 0) ensurePointerTracking(false);
      return;
    }
  }
}

/** Bounding box of pixels with alpha > 8 inside a sub-rect, device px. */
function alphaBBox(
  canvas: HTMLCanvasElement, x0: number, y0: number, w: number, h: number
): { x: number; y: number; w: number; h: number } | null {
  if (w < 1 || h < 1) return null;
  const g = canvas.getContext('2d');
  if (!g) return null;
  const d = g.getImageData(x0, y0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (d[(row + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: x0 + minX, y: y0 + minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function paintReflections(): void {
  if (targets.size === 0) return;
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  const anchorRects = new Map<HTMLElement, DOMRect>();

  for (const t of targets) {
    const tRect = t.el.getBoundingClientRect();
    let aRect = anchorRects.get(t.anchorEl);
    if (!aRect) {
      aRect = t.anchorEl.getBoundingClientRect();
      anchorRects.set(t.anchorEl, aRect);
    }
    if (tRect.width < 1 || tRect.height < 1) continue;
    if (aRect.width < 1 || aRect.height < 1) continue;
    // Glyph targets (text masked to its letterforms, see `data-metal-fx-text`)
    // are lit differently from a chip: no rim stroke or border highlight —
    // those are a white hairline along a box edge, which on text reads as a
    // flat light on the last letter — just the mirrored metal itself, at its
    // natural size so its banding stays legible, fading over a longer run so
    // more than one letter catches it.
    const glyph = t.el.hasAttribute('data-metal-fx-text');
    if (glyph && !t.glyphStyled) {
      // The chip blur (4 px) exists to melt the ring into a soft rim glow. On
      // letters it erases exactly the detail the mirror should show — the
      // stripes and dispersion fringes — so keep it to anti-aliasing width.
      t.canvas.style.filter = 'blur(0.4px) saturate(1.35) brightness(1.2)';
      t.glyphStyled = true;
    }

    if (
      !isHorizontalNeighbour(aRect, tRect, OVERLAP_MIN_PX, ATTACH_RANGE_PX) &&
      !isVerticalNeighbour(aRect, tRect, OVERLAP_MIN_PX, ATTACH_RANGE_PX)
    ) {
      if (t.canvas.width !== 1) { t.canvas.width = 1; t.canvas.height = 1; }
      if (t.strokeCanvas.width !== 1) { t.strokeCanvas.width = 1; t.strokeCanvas.height = 1; }
      continue;
    }

    // Glyph target on a masked anchor: mirror the metal *sheet*, not the
    // three thin letters cut from it. A mirror facing the "Pro" glyphs shows
    // the material's stripes across its whole face; the masked canvas would
    // give mostly transparency with a few slivers.
    const useRaw = glyph && !!t.anchor.mask;
    if (useRaw && !t.anchor.wantRaw) t.anchor.wantRaw = true;
    if (!t.anchor.wantRing) t.anchor.wantRing = true;
    // While bending, mirror the ring-only snapshot, not the canvas that also
    // carries the host's bent fill and rims.
    const bending = !!t.anchor.deform && !!t.anchor.ringCanvas;
    const anchorCanvas = (useRaw && t.anchor.rawCanvas) ? t.anchor.rawCanvas : bending ? t.anchor.ringCanvas! : t.anchor.canvas;
    // Sample only the anchor's CSS box. While a vector bend is active the
    // canvas carries an `overscan` margin on every side; reading it whole
    // would shrink the ring to the middle of the slice and miss the band.
    const ovs = Math.round(t.anchor.overscan * dpr);
    let ssx = ovs, ssy = ovs;
    let sw = (anchorCanvas.width | 0) - 2 * ovs;
    let sh = (anchorCanvas.height | 0) - 2 * ovs;
    // Custom-mask anchors (metal text): the metal is wherever the mask
    // painted, not at the box edge. Crop the source to its alpha bounding
    // box so the glyphs' edge — not the padding — lands on the target.
    if (t.anchor.mask && !useRaw) {
      const bb = alphaBBox(anchorCanvas, ssx, ssy, sw, sh);
      if (bb) { ssx = bb.x; ssy = bb.y; sw = bb.w; sh = bb.h; }
    }
    if (sw < 4 || sh < 4) continue;

    const acx = (aRect.left + aRect.right) * 0.5;
    const acy = (aRect.top + aRect.bottom) * 0.5;
    const tcx = (tRect.left + tRect.right) * 0.5;
    const tcy = (tRect.top + tRect.bottom) * 0.5;
    const dx = acx - tcx;
    const dy = acy - tcy;

    const edgeGapH = Math.max(aRect.left - tRect.right, tRect.left - aRect.right, 0);
    const edgeGapV = Math.max(aRect.top - tRect.bottom, tRect.top - aRect.bottom, 0);
    const isHorizontalLayout = edgeGapH >= edgeGapV;

    const dist = shortestRectDistance(aRect, tRect);
    let proximity = 1 - Math.min(1, dist / RANGE_PX);
    proximity = proximity * proximity * (3 - 2 * proximity);
    const intensity = BASE_ALPHA + (BOOST_ALPHA - BASE_ALPHA) * proximity;

    const reflectionAlpha = Math.min(
      MAX_ALPHA_STACK,
      intensity * INTENSITY_MULT * GLOBAL_ATTENUATION
    ) * t.strength;

    // A target that contains the anchor (the card the button lives in) has no
    // single "facing" edge — the button sits near a corner, so the echo lands
    // on both the closest vertical and closest horizontal inner edge.
    const contained =
      aRect.left >= tRect.left && aRect.right <= tRect.right &&
      aRect.top >= tRect.top && aRect.bottom <= tRect.bottom;
    const layouts: boolean[] = contained ? [true, false] : [isHorizontalLayout];

    // Effective scale of the host element. Anything drawn on the reflection
    // canvas (strokes, border-highlight) is in DEVICE pixels, so it doesn't
    // automatically grow when the host is rendered at non-1× layout (CSS
    // zoom: 2, etc.). Multiply absolute-pixel constants by the anchor's
    // scale so the reflection scales together with the metal effect itself.
    const sScale = t.anchor.scale ?? 1;
    const hairlineCssPx = Math.max(STROKE_CSS_PX * sScale, t.hairlineWidth);
    const strokeBandPx = Math.max(1, Math.round(hairlineCssPx * dpr));
    const borderHighlightPx = Math.max(
      1,
      Math.round(Math.max(BORDER_HILITE_PX * sScale, t.hairlineWidth) * dpr)
    );

    const overscanCssPx = t.hairlineOuterCssPx;
    t.wrap.style.inset = `${-overscanCssPx}px`;
    t.wrap.style.borderRadius = `${Math.max(0, t.cornerRadius)}px`;

    const tw = Math.max(1, Math.round((tRect.width + overscanCssPx * 2) * dpr));
    const th = Math.max(1, Math.round((tRect.height + overscanCssPx * 2) * dpr));
    if (t.canvas.width !== tw) t.canvas.width = tw;
    if (t.canvas.height !== th) t.canvas.height = th;
    if (t.strokeCanvas.width !== tw) t.strokeCanvas.width = tw;
    if (t.strokeCanvas.height !== th) t.strokeCanvas.height = th;

    const ctx = t.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, tw, th);
    const strokeCtx = t.strokeCtx;
    strokeCtx.setTransform(1, 0, 0, 1, 0, 0);
    strokeCtx.clearRect(0, 0, tw, th);

    for (const [li, horiz] of layouts.entries()) {
      // First edge paints straight into the target; later edges go via scratch.
      const viaScratch = li > 0 && ensureScratch(tw, th);
      const fCtx = viaScratch ? (scratchFillCtx as CanvasRenderingContext2D) : ctx;
      const sCtx = viaScratch ? (scratchStrokeCtx as CanvasRenderingContext2D) : strokeCtx;
      const bandDevPx = Math.min((glyph ? RANGE_PX * 1.5 : RANGE_PX) * dpr, Math.max(tw, th));
      let g0x: number, g0y: number, g1x: number, g1y: number;
      if (horiz) {
        g0x = dx > 0 ? tw : 0; g1x = dx > 0 ? tw - bandDevPx : bandDevPx;
        g0y = th * 0.5; g1y = th * 0.5;
      } else {
        g0y = dy > 0 ? th : 0; g1y = dy > 0 ? th - bandDevPx : bandDevPx;
        g0x = tw * 0.5; g1x = tw * 0.5;
      }
      const grad = ctx.createLinearGradient(g0x, g0y, g1x, g1y);
      grad.addColorStop(0, `rgba(0,0,0,${GRAD_NEAR})`);
      grad.addColorStop(0.5, `rgba(0,0,0,${GRAD_MID})`);
      grad.addColorStop(1, `rgba(0,0,0,${GRAD_FAR})`);

      const anchorCssW = sw / dpr;
      const refWdpr = glyph
        ? Math.max(1, Math.min(horiz ? tw : th, Math.round(horiz ? sw : sh)))
        : Math.max(1, Math.round(REF_DRAW_CSS_W * Math.max(0.1, anchorCssW / 140) * dpr));

      let drawX: number, drawY: number, drawW: number, drawH: number;
      let flipX = false, flipY = false;
      if (horiz) {
        const overlapTop = Math.max(aRect.top, tRect.top);
        const overlapBot = Math.min(aRect.bottom, tRect.bottom);
        flipX = true;
        drawX = dx > 0 ? tw - refWdpr : 0;
        drawY = Math.round((overlapTop - tRect.top + overscanCssPx) * dpr);
        drawW = refWdpr;
        drawH = Math.max(1, Math.round((overlapBot - overlapTop) * dpr));
      } else {
        const overlapLeft = Math.max(aRect.left, tRect.left);
        const overlapRight = Math.min(aRect.right, tRect.right);
        flipY = true;
        drawX = Math.round((overlapLeft - tRect.left + overscanCssPx) * dpr);
        drawY = dy > 0 ? th - refWdpr : 0;
        drawW = Math.max(1, Math.round((overlapRight - overlapLeft) * dpr));
        drawH = refWdpr;
      }
      const drawDst: DrawDst = { x: drawX, y: drawY, w: drawW, h: drawH, flipX, flipY, sx: ssx, sy: ssy };

      const strokeBox: BoxRect = { x: 0, y: 0, w: tw, h: th, r: Math.max(0, t.cornerRadius * dpr) };

      // Glyphs: one pass, never over 1 — stacking `lighter` passes clips the
      // metal's highlights to white and the colour is gone.
      const fillReflectionAlpha = glyph
        ? Math.min(1, reflectionAlpha * FILL_OPACITY_MUL)
        : Math.min(MAX_ALPHA_STACK, reflectionAlpha * FILL_EXTRA_ALPHA * FILL_OPACITY_MUL * FILL_CIRCLE_ATTENUATION);
      maskedFillPasses(fCtx, anchorCanvas, sw, sh, tw, th, fillReflectionAlpha, grad, drawDst, strokeBox, dpr, glyph ? Math.max(tw, th) : undefined);

      if (!glyph) {
        maskedStrokePasses(
          sCtx, anchorCanvas, sw, sh, tw, th,
          strokeBox, reflectionAlpha, strokeBandPx, grad, STROKE_EXTRA_ALPHA, drawDst
        );

        drawBorderHighlight(
          sCtx, strokeBox, borderHighlightPx,
          g0x, g0y, g1x, g1y,
          Math.min(0.85, BORDER_HILITE_ALPHA * reflectionAlpha)
        );
      }

      if (viaScratch) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(scratchFill as HTMLCanvasElement, 0, 0);
        strokeCtx.globalCompositeOperation = 'lighter';
        strokeCtx.drawImage(scratchStroke as HTMLCanvasElement, 0, 0);
      }
    }

    for (const horiz of layouts) {
      applyOccluderShadow(ctx, strokeCtx, aRect, tRect, horiz, tw, th, overscanCssPx, dpr);
    }

    ctx.globalCompositeOperation = 'source-over';
    strokeCtx.globalCompositeOperation = 'source-over';
  }
}
