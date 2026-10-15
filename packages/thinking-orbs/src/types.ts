import type { CSSProperties, CanvasHTMLAttributes } from 'react';
import type { ModeOpts } from './engine/profiles';
import type { ModeFrame } from './engine/types';
import type { GravityOptions } from './gravity';

/**
 * The nine shipped states — each a hand-tuned animation:
 * - `working`    — particles on tilted orbits
 * - `searching`  — a scan meridian sweeps a dotted globe
 * - `solving`    — bands scramble in quarter turns, then click back
 * - `listening`  — a waveform rolls through latitude rings
 * - `connecting` — a constellation wires itself, packets running the edges
 * - `weaving`    — three strands plait around the sphere
 * - `composing`  — an undulating multi-band sash
 * - `breathing`  — a face-on ring slowly morphing
 * - `shaping`    — a dotted outline morphs circle → triangle → square
 */
export type OrbState =
  | 'working'
  | 'searching'
  | 'solving'
  | 'listening'
  | 'connecting'
  | 'weaving'
  | 'composing'
  | 'breathing'
  | 'shaping';

/**
 * Rendered size in CSS pixels. 64 (chat-avatar scale) and 20 (inline-text
 * scale) are hand-tuned designs, not a scale factor — each carries its own
 * dot count, dot size and speed. 32 (compact avatar scale) sits between
 * them and is interpolated from the two, in log space because those knobs
 * are ratios; it reads correctly but has not had a tuning pass of its own.
 */
export type OrbSize = 64 | 32 | 20;

/**
 * Theme mode.
 *
 * - `auto` (default) resolves in three layers, live-updating on change:
 *   1. a `data-theme="dark|light"` attribute or `dark`/`light` class on
 *      any ancestor (the Tailwind / shadcn convention), watched via
 *      `MutationObserver`;
 *   2. otherwise `matchMedia('(prefers-color-scheme: dark)')`,
 *      subscribed for live OS/browser theme switches;
 *   3. during SSR (no DOM) the first client render resolves the theme
 *      before anything is painted — the canvas is client-only.
 * - `dark` / `light` pin the palette regardless of context.
 *
 * Dark renders light ink on the transparent canvas (for dark
 * backgrounds); light renders dark ink (for light backgrounds).
 */
export type OrbTheme = 'auto' | 'dark' | 'light';

/** Props for the ThinkingOrb React component. */
export interface ThinkingOrbProps extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, 'style'> {
  /** Which animation to show. @default 'working' */
  state?: OrbState;

  /** Tuned size preset — 64 or 20 CSS px. @default 64 */
  size?: OrbSize;

  /** Theme mode; `auto` detects from the host project. @default 'auto' */
  theme?: OrbTheme;

  /**
   * Animation speed multiplier on top of the preset's baked speed.
   * @default 1
   */
  speed?: number;

  /** Freeze the animation on the current frame. @default false */
  paused?: boolean;

  /**
   * Optional ink tint — any `#rgb`, `#rrggbb` or `rgb()` color. The orb's
   * depth-shading ramp is preserved on the tint (fading toward black on
   * dark substrates, toward white on light ones), so colored orbs read
   * with the same 3D language as the grayscale default. Omit for the
   * stock grayscale ink.
   */
  color?: string;

  /**
   * Density multiplier for the mode's dot/strand/node counts, applied with
   * the same paired-count scaler the size presets use so the mode keeps
   * its balance. `1` (default) is the tuned look; `0.5` halves density,
   * `2` doubles it. Clamped to a 0.1 floor.
   */
  dots?: number;

  /**
   * Radius multiplier for every dot, applied with the same scaler the size
   * presets use so near/far falloff keeps its proportion. `1` (default) is
   * the tuned mark; `0.7` reads finer, `1.5` bolder.
   */
  dotSize?: number;

  /**
   * Advanced: raw draw options merged over the resolved preset, last. These
   * are the engine's own knobs, so they reach past the tuned surface — the
   * orbit paths' `ghostA` and `particles` (working), the globe's `scanMul`
   * and `dimBase` (searching), the constellation's `thr`, `signals`, `lineW`
   * and `spread` (connecting), the plait's `turns` (weaving), the sash's
   * `wobMul`, `bandMul` and `spin` (composing, breathing), and the outline's
   * `spread` and `shape` (shaping — `shape` 0 / 1 / 2 holds the circle,
   * triangle or square instead of cycling). Unknown keys are ignored; a key
   * the current state does not read does nothing.
   */
  opts?: ModeOpts;

  /**
   * Escape hatch below `opts`: replace the state's geometry outright. The
   * function gets `(size, t, opts)` and returns the frame to paint — the
   * same contract every built-in mode implements (see `MODE_FRAMES` and the
   * helpers exported alongside it). The painter, theme, tint, pause and
   * offscreen handling all stay the library's.
   */
  frame?: ModeFrame;

  /**
   * Gravity: the orb pulls at the pointer. As the pointer nears, a raster
   * of the platform's cursor is drawn in its place with its body warped
   * toward the orb — the tip stays put, nothing rotates or scales. Needs the
   * platform's real pointer raster (`gravity.sprite`, or
   * `setGravitySprite`) or it stays off; off automatically under reduced
   * motion, forced colours, coarse pointers, zoom, and over anything but
   * the plain arrow. `true` takes the defaults. See gravity.ts.
   */
  gravity?: boolean | GravityOptions;

  style?: CSSProperties;
}
