import type { CSSProperties, ReactNode, HTMLAttributes, RefObject } from 'react';
import type { MaskFn } from './engine/renderer/core';

/**
 * Variant for the metal effect.
 * - 'button' (default): pill-shaped 134×40 baseline with shaderScale 1.6
 * - 'circle': compact 32×32 circle baseline with shaderScale 1.3
 *
 * In practice the wrapped child's measured dimensions drive the visible size —
 * the variant only controls the shader sampling scale and ring thickness.
 */
export type MetalFxVariant = 'button' | 'circle';

/**
 * Theme mode for the metal effect.
 *
 * - `auto` (default): follows the user's `prefers-color-scheme` and updates
 *   live when the OS / browser theme changes (also gracefully falls back to
 *   `dark` during SSR or when `matchMedia` is unavailable).
 * - `dark`: pin to the dark-mode tunings regardless of system preference.
 * - `light`: pin to the light-mode tunings regardless of system preference.
 *
 * Drive this from your app's theme state if you have a manual toggle that
 * doesn't follow the OS — otherwise `auto` is the right default.
 */
export type MetalFxTheme = 'dark' | 'light' | 'auto';

/**
 * Bundled preset names. Each preset ships both a dark and light mode block.
 */
export type MetalFxPreset = 'chromatic' | 'silver' | 'gold';

/**
 * A reflection target: either a bare ref, or a ref plus a per-target
 * `strength` multiplier (0..1+). Use the object form when a surface should
 * only catch a faint echo of the metal — a container the button sits inside,
 * for example — without turning down every other target.
 */
export type MetalFxReflectionTarget =
  | RefObject<HTMLElement | null>
  | { ref: RefObject<HTMLElement | null>; strength?: number };

/**
 * Props for the MetalFx React component.
 */
export interface MetalFxProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * The single host element to wrap with the metal effect. Must be a single
   * React node (button, anchor, div, ...). MetalFx measures this element each
   * frame via `ResizeObserver` and paints its canvas + glow on top.
   */
  children: ReactNode;

  /**
   * Variant — controls the shader sampling scale + ring width.
   * - `button` (default): pill-style ring at 1 px wide, scale 1.6
   * - `circle`: compact circle with a 2 px ring, scale 1.3
   */
  variant?: MetalFxVariant;

  /**
   * Color preset. All three presets ship both dark and light mode tunings —
   * `theme` picks the right side at runtime.
   * @default 'chromatic'
   */
  preset?: MetalFxPreset;

  /**
   * Theme mode. `'auto'` (default) resolves via
   * `matchMedia('(prefers-color-scheme: dark)')` and switches live when the
   * OS theme changes. Pass `'dark'` or `'light'` to pin a specific mode.
   * @default 'auto'
   */
  theme?: MetalFxTheme;

  /**
   * Effect strength (0..1). Multiplies the shader bitmap opacity and the glow
   * SVG alpha. The shader continues to animate at full intensity at any value;
   * only the rendered alpha onto the host is scaled. Lighter values let the
   * underlying child surface show through more strongly.
   * @default 1
   */
  strength?: number;

  /**
   * Multiplier on the glow only (halo + catch-light), on top of `strength`.
   * Use it when the shader runs at low `strength` but the glow should still
   * read — e.g. metal text. Clamped to 0..1 after multiplying.
   * @default 1
   */
  glowGain?: number;

  /**
   * Pause the shader animation. The visible canvas keeps the last painted
   * frame so the metal silhouette stays on screen.
   * @default false
   */
  paused?: boolean;

  /**
   * Optional explicit border radius (CSS px). When omitted, MetalFx reads the
   * computed border-radius of the wrapped child each resize.
   */
  borderRadius?: number;

  /**
   * When true, MetalFx normalizes the host element's outer chrome (border /
   * outline / box-shadow) so user-provided component styles don't clash with
   * the metal ring. Inner fills, typography, and content remain untouched.
   * @default true
   */
  normalizeHostStyles?: boolean;

  /**
   * Neighbour elements that should receive a soft proximity reflection of the
   * metal effect. Reflections only render when the resolved theme is `dark` —
   * pass-through in light mode (no DOM scan, no per-frame work).
   *
   * Pass refs to the sibling DOM elements you want to receive the reflection
   * (chips next to a send button, search field next to an Upgrade pill, ...).
   *
   * A target that *contains* the wrapped element (its parent card, say)
   * receives the reflection on both the nearest vertical and horizontal
   * inner edges. Pair with `{ ref, strength }` to keep that subtle.
   */
  reflectionTargets?: ReadonlyArray<MetalFxReflectionTarget>;

  /**
   * Disable the wandering halo overlay. The shader ring still renders.
   * @default false
   */
  disableGlow?: boolean;

  /**
   * Light rim along the top inside edge of the ring — an inner shadow from
   * above, like the one on metal text. `true` uses the design defaults
   * (white 90 %, offset 1 px, blur 0.5 px); pass an object to tune.
   * @default undefined (off)
   */
  innerShadow?: boolean | { offsetY?: number; blur?: number; alpha?: number; color?: string };

  /**
   * Override the shader sampling scale. Larger values zoom into the shared
   * shader (visibly bigger pattern features); smaller values zoom out.
   * Defaults to the variant's baseline (1.6 for `'button'`, 1.3 for
   * `'circle'`) multiplied by `scale`.
   */
  shaderScale?: number;

  /**
   * Override the ring thickness in CSS pixels. Defaults to the variant's
   * baseline (1 for `'button'`, 2 for `'circle'`) multiplied by `scale`.
   */
  ringCssPx?: number;

  /**
   * Master scale multiplier for every absolute-pixel constant the engine
   * uses internally. Set this when you render the wrapped element at a
   * non-1× size (e.g. inside a CSS `zoom: 2` container, or when you've
   * doubled all your Tailwind sizes by hand). It scales:
   *   - shader sampling (so pattern features grow proportionally)
   *   - ring thickness on the canvas
   *   - glow SVG stroke widths, blur radii, fade-circle radius, and the
   *     small inset/outward offsets that position the catch-light
   *   - reflection canvas stroke band, border-highlight thickness, and the
   *     reference draw width baseline
   * @default 1
   */
  scale?: number;

  /**
   * Custom alpha mask painter. When set, the shader is kept only where the
   * mask paints (device px, origin at the wrapper's top-left) and the ring
   * punch is skipped — for metal-filled text or glyphs. Pair with
   * `disableGlow`; the glow assumes a ring perimeter.
   */
  mask?: MaskFn;

  /**
   * How the glow is placed when `mask` is set. `'mask'` (default) samples
   * points inside the mask and clips the halo to it — right for metal text.
   * `'ring'` keeps the rounded-rect perimeter behaviour — a halo along the
   * element's edge — for a full-fill mask like a badge.
   */
  glowMode?: 'mask' | 'ring';

  /**
   * Forwarded class name for the wrapper element.
   */
  className?: string;

  /**
   * Forwarded inline styles for the wrapper element.
   */
  style?: CSSProperties;
}
