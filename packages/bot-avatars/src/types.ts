import type { CanvasHTMLAttributes, CSSProperties } from 'react';

/** The eighteen body shapes. */
export type BotAvatarType =
  | 'clover'
  | 'flower'
  | 'triangle'
  | 'square'
  | 'blob'
  | 'ghost'
  | 'circle'
  | 'drop'
  | 'star'
  | 'droid'
  | 'mech'
  | 'alien'
  | 'hexagon'
  | 'cat'
  | 'cloud'
  | 'pill'
  | 'pebble'
  | 'puddle';

/**
 * What the face is made of. The eyes alone by default; `mouth` adds a
 * small mouth that changes with the state.
 */
export type BotAvatarFace = 'eyes' | 'mouth';

/** What the bot is doing. Each state is a pose plus its own motion. */
export type BotAvatarState = 'default' | 'working' | 'sleeping';

/**
 * How the body is lit. `plastic` (default): a real glossy material shaded
 * per pixel — a baked pillow form, a hot spot and a sheen, a Fresnel rim,
 * a window reflection, saturated shadows. `crisp`: a lit rim with a clean
 * edge round the front, vector-style. `smooth`: no edge, a soft shadow
 * and highlight across the whole form. `flat`: the depth alone, no lighting.
 */
export type BotAvatarShading = 'crisp' | 'smooth' | 'plastic' | 'flat';

export interface BotAvatarPreset {
  /** Display name, for labels and the default `aria-label`. */
  label: string;
  /** The type's own body colour. */
  color: string;
  /** The face the type ships with. */
  face: BotAvatarFace;
  /** Where the face sits, in the 100×100 body box. */
  faceX: number;
  faceY: number;
  /** Face scale: shapes with a small middle wear a smaller face. */
  faceScale: number;
}

export interface BotAvatarProps
  extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, 'color' | 'ref'> {
  /** Body shape. Default `clover`. */
  type?: BotAvatarType;
  /** Face kind. Defaults to the type's own. */
  face?: BotAvatarFace;
  /** What the bot is doing: `default` (idle), `working` (hopping, spinning) or `sleeping`. */
  state?: BotAvatarState;
  /** Rendered size in px, or any CSS length. Default `64`. */
  size?: number | string;
  /** Body colour. Defaults to the type's palette colour. */
  color?: string;
  /** Face ink. Defaults to dark, or light on a dark body. */
  ink?: string;
  /**
   * Lightness of the body colour: 1 as the palette has it, below 1 darker,
   * above 1 lighter (0.5–1.5 is the useful range). Default `1`.
   */
  brightness?: number;
  /**
   * Saturation of the body colour: 1 as the palette has it, below 1
   * duller, above 1 more vivid (0.5–1.5 is the useful range). Default `1`.
   */
  saturation?: number;
  /** Multiplier on every animation's speed. Default `1`. */
  speed?: number;
  /** Freeze every animation on its current frame. */
  paused?: boolean;
  /**
   * 0–1. Offsets the blink and glance timing so a row of avatars does not
   * blink in unison. Defaults to a value derived from the instance id.
   */
  seed?: number;
  /** How the body is lit: `plastic` (default), `crisp`, `smooth` or
   * `flat`. `true` and `false` mean crisp and flat. */
  shading?: BotAvatarShading | boolean;
  /** Strength of the shadow side, 0–2. Default `0.35`. */
  shadow?: number;
  /** Strength of the lit side, 0–2. Default `1.3`. */
  highlight?: number;
  /** Thickness of the body, 0.2–2: what shows when it turns or flips. Default `0.65`. */
  depth?: number;
  /** Where the light comes from, in degrees clockwise from the top. Default `265` (from the left). */
  light?: number;
  /** Width of the lit rim in `crisp` shading, strength of the Fresnel rim in `plastic`, 0–2. Default `0.5`. */
  rim?: number;
  /** Reach of the soft shading in `smooth`, width of the highlight in `plastic`, 0.4–2.5. Default `1.55`. */
  spread?: number;
  /**
   * Pointer play: the eyes and head follow a pointer that comes near, and
   * a click makes the avatar hop and turn right round. Default `true`.
   */
  interactive?: boolean;
  /**
   * The surface the avatar sits on, for the neutral touches that have to
   * read against it (the whirl round a spin is white on dark, black on
   * light). `auto` (default) reads an ancestor `data-theme` attribute or
   * `dark` / `light` class, then `prefers-color-scheme`.
   */
  theme?: 'auto' | 'dark' | 'light';
  className?: string;
  style?: CSSProperties;
}
