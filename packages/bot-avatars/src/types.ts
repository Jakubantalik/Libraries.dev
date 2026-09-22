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
/** How the landing squash of a jump plays out. */
export type BotAvatarSquashEase = 'sharp' | 'pulse' | 'soft' | 'bouncy';

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
   * duller, above 1 more vivid (0.5–1.5 is the useful range). Default `1.5`.
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
   * The surface the avatar sits on, for touches that have to read against
   * it. `auto` (default) reads an ancestor `data-theme` attribute or
   * `dark` / `light` class, then `prefers-color-scheme`.
   */
  theme?: 'auto' | 'dark' | 'light';
  /**
   * How far the head turns from side to side while idle, 0–2: `1` as the
   * library has it, `0` keeps it facing forward. Default `1`.
   */
  turn?: number;
  /** The whirl round a spin: its strength, 0–2. Off by default (`0`); `1` turns it on. */
  whirl?: number;
  /** Size of the whirl's ring, 0.6–1.6. Default `1`. */
  whirlSize?: number;
  /** Thickness of the whirl's trail, 0.4–2. Default `1`. */
  whirlWidth?: number;
  /** Length of the trail round the ring, 0.4–1.6. Default `1`. */
  whirlLength?: number;
  /** How flat the ring is seen, 0.5–1.8 (higher is more open). Default `1`. */
  whirlTilt?: number;
  /** The jump (an idle flip, a click): how high, in body units — the body is 100 tall. Default `26`. */
  jumpHeight?: number;
  /** Seconds the jump spends in the air. Default `0.68`. */
  jumpTime?: number;
  /** How much the body stretches in the air, 0–2. Default `1`. */
  jumpStretch?: number;
  /** How much the body squashes on the ground, before take-off and on landing, 0–2. Default `1.15`. */
  jumpSquash?: number;
  /** Seconds the landing squash takes, from contact to recovered. Default `0.37`. */
  jumpSquashTime?: number;
  /**
   * How the landing squash plays out: `sharp` (all at once, then eases
   * off), `pulse` (a quick press that recovers without a wobble, the
   * default), `soft` (eases in and out), `bouncy` (overshoots into a
   * stretch and settles).
   */
  jumpSquashEase?: BotAvatarSquashEase;
  /** Seconds a jump holds its deepest squash on the ground before recovering. Default `0.11`. */
  jumpGroundTime?: number;
  /**
   * How the weight settles through that hold, in the same shapes as
   * `jumpSquashEase`: the body presses a little deeper and comes back to
   * the held depth, `sharp` at once, `pulse` quickly, `soft` in the
   * middle, `bouncy` with a wobble. Default `pulse`.
   */
  jumpGroundEase?: BotAvatarSquashEase;
  /** Seconds the body takes to rise from its deepest squash back to its own shape. Default `0.33`. */
  jumpRiseTime?: number;
  /**
   * How it rises: `sharp` lets go at once and eases in to rest, `pulse`
   * leaves quickly with a long settle, `soft` eases out of the squash and
   * into rest, `bouncy` passes rest into a slight stretch and settles
   * back. Default `pulse`.
   */
  jumpRiseEase?: BotAvatarSquashEase;
  /** Seconds a click's jump takes for its landing squash (an idle jump's uses `jumpSquashTime`). Default `0.24`. */
  jumpClickSquashTime?: number;
  /** Whole turns made in the air, 0–2. Default `1`. */
  jumpSpin?: number;
  /** Degrees of lean into a jump. Default `6`. */
  jumpLean?: number;
  /** Seconds between idle jumps, give or take 40 %; 0 for none. Default `8`. */
  jumpEvery?: number;
  /** When the landing squash begins: seconds before touch-down (negative, bracing for the ground) or after it. Default `0`, the moment of contact. */
  jumpLand?: number;
  className?: string;
  style?: CSSProperties;
}
