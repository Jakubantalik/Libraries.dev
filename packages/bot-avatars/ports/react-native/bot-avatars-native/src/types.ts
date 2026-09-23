import type { StyleProp, ViewStyle } from 'react-native';
import type { BotAvatarFace, BotAvatarShading, BotAvatarState, BotAvatarType } from 'bot-avatars';

export type { BotAvatarFace, BotAvatarShading, BotAvatarState, BotAvatarType, BotAvatarPreset, BotAvatarPose, BotAvatarJumpConfig } from 'bot-avatars';
export type BotAvatarSquashEase = 'sharp' | 'pulse' | 'soft' | 'bouncy';

/** Every prop of the web component, with the same names and defaults. */
export interface BotAvatarProps {
  /** Body shape. Default `clover`. */
  type?: BotAvatarType;
  /** Face kind. Defaults to the type's own. */
  face?: BotAvatarFace;
  /** What the bot is doing: `default` (idle), `working` (hopping, spinning) or `sleeping`. */
  state?: BotAvatarState;
  /** Rendered size in points. Default `64`. */
  size?: number;
  /** Body colour (#rgb, #rrggbb, rgb() or hsl()). Defaults to the type's palette colour. */
  color?: string;
  /** Face ink. Defaults to dark, or light on a dark body. */
  ink?: string;
  /** Lightness of the body colour: 1 as the palette has it, below 1 darker, above 1 lighter. Default `1`. */
  brightness?: number;
  /** Saturation of the body colour: 1 as the palette has it. Default `1.5`. */
  saturation?: number;
  /** Multiplier on every animation's speed. Default `1`. */
  speed?: number;
  /** Freeze every animation on its current frame. */
  paused?: boolean;
  /** 0–1. Offsets the blink and glance timing. Defaults to a value derived from the instance id. */
  seed?: number;
  /** How the body is lit: `plastic` (default), `crisp`, `smooth` or `flat`. `true` and `false` mean crisp and flat. */
  shading?: BotAvatarShading | boolean;
  /** Strength of the shadow side, 0–2. Default `0.35`. */
  shadow?: number;
  /** Strength of the lit side, 0–2. Default `1.3`. */
  highlight?: number;
  /** Thickness of the body, 0.2–2. Default `0.65`. */
  depth?: number;
  /** Where the light comes from, in degrees clockwise from the top. Default `265`. */
  light?: number;
  /** Width of the lit rim in `crisp`, strength of the Fresnel rim in `plastic`, 0–2. Default `0.5`. */
  rim?: number;
  /** Reach of the soft shading in `smooth`, width of the highlight in `plastic`, 0.4–2.5. Default `1.55`. */
  spread?: number;
  /**
   * Touch play: a tap makes the avatar hop and turn right round, and while
   * a finger rests on it the eyes and head follow the finger (a drag stands
   * in for the web's pointer). Default `true`.
   */
  interactive?: boolean;
  /** The surface the avatar sits on. `auto` (default) follows the system appearance. Kept for parity; nothing drawn depends on it today. */
  theme?: 'auto' | 'dark' | 'light';
  /** The whirl round a spin: its strength, 0–2. Off by default (`0`); `1` turns it on. */
  whirl?: number;
  /** Size of the whirl's ring, 0.6–1.6. Default `1`. */
  whirlSize?: number;
  /** Thickness of the whirl's trail, 0.4–2. Default `1`. */
  whirlWidth?: number;
  /** Length of the trail round the ring, 0.4–1.6. Default `1`. */
  whirlLength?: number;
  /** How flat the ring is seen, 0.5–1.8. Default `1`. */
  whirlTilt?: number;
  /** The jump: how high, in body units — the body is 100 tall. Default `26`. */
  jumpHeight?: number;
  /** Seconds the jump spends in the air. Default `0.68`. */
  jumpTime?: number;
  /** How much the body stretches in the air, 0–2. Default `1`. */
  jumpStretch?: number;
  /** How much the body squashes on the ground, 0–2. Default `1.15`. */
  jumpSquash?: number;
  /** Seconds the landing squash takes. Default `0.37`. */
  jumpSquashTime?: number;
  /** How the landing squash plays out: `sharp`, `pulse` (default), `soft` or `bouncy`. */
  jumpSquashEase?: BotAvatarSquashEase;
  /** Seconds a tap's jump takes for its landing squash. Default `0.24`. */
  jumpClickSquashTime?: number;
  /** Whole turns made in the air, 0–2. Default `1`. */
  jumpSpin?: number;
  /** Degrees of lean into a jump. Default `6`. */
  jumpLean?: number;
  /** Seconds between idle jumps, give or take 40 %; 0 for none. Default `8`. */
  jumpEvery?: number;
  /** When the landing squash begins: seconds before (negative) or after touch-down. Default `0`. */
  jumpLand?: number;
  /**
   * How `plastic` draws its sixteen side slices: `sprite` (the default,
   * what `auto` picks) blits them from three sprites of the outline
   * redrawn when the lighting moves, `vector` fills them as paths every
   * frame. Sprites cost a pixel of anti-aliasing along the side stack's
   * silhouette and save sixteen path rasterisations per avatar per frame;
   * the web does the same on WebKit.
   */
  sides?: 'auto' | 'vector' | 'sprite';
  /** Runs after a tap's hop (`interactive` on) or on any tap (`interactive` off). */
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  /** Accessibility label; defaults to "<Type> bot, <state>". */
  accessibilityLabel?: string;
  testID?: string;
}

/** What a ref to a `BotAvatar` gives you. */
export interface BotAvatarHandle {
  /** A hop and a full turn, right now, whatever the state. */
  poke(): void;
  /**
   * Where a pointer is, relative to the head (−1 … 1 across a head width
   * each way), and how strongly to follow it (0 lets go).
   */
  setPointer(x: number, y: number, strength: number): void;
  /**
   * Look toward a point in window coordinates — the eyes and head follow
   * it when it is within about three head widths — or let go with `null`.
   */
  lookAt(x: number, y: number): void;
  lookAt(point: null): void;
}
