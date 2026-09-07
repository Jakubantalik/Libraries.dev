/**
 * Canonical constants and types for proximity reflections.
 *
 * Verbatim from `Image loader/index.html` L5851-5915. Shared across
 * the observer, geometry, and paint modules.
 */
import type { MetalFxInstance } from '../renderer/core';

export const RANGE_PX = 12;
export const ATTACH_RANGE_PX = 32;
export const OVERLAP_MIN_PX = 1;
export const BASE_ALPHA = 0.55;
export const BOOST_ALPHA = 1.0;
export const GRAD_NEAR = 1.0;
export const GRAD_MID = 0.85;
export const GRAD_FAR = 0.0;
export const INTENSITY_MULT = 1.3;
export const MAX_ALPHA_STACK = 3.6;
export const GLOBAL_ATTENUATION = 0.7;
export const STROKE_CSS_PX = 1;
export const STROKE_EXTRA_ALPHA = 0.52;
export const BORDER_HILITE_PX = 1.0;
export const BORDER_HILITE_ALPHA = 0.044;
export const REF_DRAW_CSS_W = 235;
export const FILL_EXTRA_ALPHA = 2.535;
export const FILL_OPACITY_MUL = 0.7;
export const FILL_CIRCLE_ATTENUATION = 0.5;

export const REFLECTION_BLOCKED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);

export interface ReflectionTarget {
  el: HTMLElement;
  anchor: MetalFxInstance;
  anchorEl: HTMLElement;
  /** Per-target alpha multiplier from the public API. 1 = canonical. */
  strength: number;
  wrap: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  strokeCanvas: HTMLCanvasElement;
  strokeCtx: CanvasRenderingContext2D;
  cornerRadius: number;
  hairlineWidth: number;
  hairlineOuterCssPx: number;
  appliedPositionRelative: boolean;
  appliedIsolation: boolean;
  resizeObserver: ResizeObserver | null;
  mutationObserver: MutationObserver | null;
  /** Glyph-target canvas styling applied (see paint). */
  glyphStyled?: boolean;
}
