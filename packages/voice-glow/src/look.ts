import type { VoiceDriverConfig } from './voiceDriver';
import type { VoiceGeometry } from './presets';
import type { VoiceBeamType } from './types';

/**
 * Looks that plug in from outside the package.
 *
 * `look="glow"` and `look="dither"` are built in. Any other look is an
 * object passed as the `look` prop, and it is drawn by one of two engines:
 *
 * - a pixel look paints the glow onto the pixel canvas, as the dither does,
 *   and gets the dither's machinery with it: the glow sampled at any point,
 *   its blended colours, the halo, the magnet, processing's dust and the
 *   pixels that fly into and out of `pixelExitTarget`;
 * - a surface look owns its canvas and paints the voice its own way from
 *   the lobes, the level and the clock.
 *
 * Libraries Pro adds mosaic (a pixel look), and dots and lines (surface
 * looks) this way. Pass the same object on every render (define it once at
 * module level); a new object rebuilds the effect.
 */

/** Everything a look is drawn with: every prop, resolved, clamped and scaled. */
export type VoiceLookConfig = VoiceDriverConfig;

/** One frame of a pixel look. Read the glow with `light()`, then its colour
 *  with `blend()`; lay a grid out with `grid()`, and for each cell take the
 *  magnet's offset with `pull()` and report what was drawn with `lit()`. */
export interface VoicePixelKit {
  ctx: CanvasRenderingContext2D;
  config: VoiceLookConfig;
  /** The canvas, CSS px (the context is already scaled for the device). */
  cw: number;
  ch: number;
  /** Nothing is lit above this y, so a bottom-up row loop can stop there. */
  top: number;
  /** The glow's light at a point, 0–1: its lobes inside its range, and its
   *  band. Sets `lobes` and what `blend()` reads, for that point. */
  light(x: number, y: number): number;
  /** Each lobe's pull on the colour at the last point read (7 lobes). */
  lobes: Float32Array;
  /** The glow's blended colour at the last point read, 0–1 per channel into
   *  `rgb`; false where no lobe reaches. */
  blend(): boolean;
  rgb: Float32Array;
  /** A fixed 0–1 value per cell, so a cell's choices hold frame to frame. */
  hash(c: number, r: number): number;
  /** The cell's 4×4 ordered-dither threshold, in (0, 1). */
  bayer(c: number, r: number): number;
  /** Starts the frame's grid: `cols` × `rows` cells `cell` px apart from
   *  (x0, y0). Call once per frame before the cells. */
  grid(cols: number, rows: number, cell: number, x0: number, y0: number): void;
  /** The magnet's offset for cell `m` (row × cols + column) at (x, y), px. */
  pull(m: number, c: number, r: number, x: number, y: number): [number, number];
  /** Whether the cell's pixel is in flight (into or out of the button):
   *  report it with `lit()`, but leave it out of the picture. */
  away(m: number): boolean;
  /** Reports a drawn cell — where, how big, how bright (0–1), its colour as
   *  0xRRGGBB — for the magnet and the flying pixels; it leaves processing's
   *  dust there too. */
  lit(x: number, y: number, size: number, v: number, rgb: number, m: number): void;
  /** Draws the cell's speck of processing's dust, if it has one; true if drawn. */
  dust(m: number, c: number, r: number, x: number, y: number, size: number): boolean;
}

/** A look painted on the pixel canvas, as the dither is. */
export interface VoicePixelLook {
  kind: 'pixel';
  /** Its name: set on the host as `data-voice-look`. */
  name: string;
  /** Paints one frame. */
  paint(kit: VoicePixelKit): void;
  /** How many times its picture feeds the halo (the dither's: 1). */
  halo?: number;
  /** The magnet's default strength (the dither's: 0.7). */
  magnet?: number;
  /** Tuning by host over the pixel looks' shared defaults; props still win. */
  types?: Partial<Record<VoiceBeamType, Partial<VoiceGeometry>>>;
}

/** One frame of the voice for a surface look. */
export interface VoiceSurfaceFrame {
  /** The canvas, CSS px. */
  cw: number;
  ch: number;
  /** Each lobe's centre along the edge (element px), and its amplitude from the band it follows. */
  lobeX: Float32Array;
  lobeL: Float32Array;
  /** The spread multiplier (0.85 at rest, wider with the voice). */
  w: number;
  /** How high the voice stands, 0–1: the level on a fast envelope, or the held level while processing. */
  lift: number;
  /** Overall presence, 0.15–1. */
  glow: number;
  /** Seconds: the clock, and since the last frame (0 while paused). */
  t: number;
  dt: number;
  /** Unwrapped flow travel, px. */
  drift: number;
  /** Processing's gather, 0–1. */
  gather?: number;
}

/** A look that owns its canvas: `create` once per canvas, `draw` every frame. */
export interface VoiceSurfaceLook<S = unknown> {
  kind: 'surface';
  /** Its name: set on the host as `data-voice-look`. */
  name: string;
  create(canvas: HTMLCanvasElement): S | null;
  draw(state: S, config: VoiceLookConfig, frame: VoiceSurfaceFrame): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VoiceLook = VoicePixelLook | VoiceSurfaceLook<any>;
