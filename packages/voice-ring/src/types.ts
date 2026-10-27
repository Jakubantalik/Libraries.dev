import type { CSSProperties, CanvasHTMLAttributes } from 'react';
import type { VoiceOrbType } from './engine/registry';
import type { VoiceOrbAccent, VoiceOrbEmotion } from './emotion';
import type { OrbTint } from './engine/paint';
import type { TypeFrame, TypeOpts } from './engine/types';

/**
 * Theme mode, resolved exactly as thinking-orbs does: `auto` (default)
 * reads an ancestor `data-theme` / `.dark` / `.light`, then
 * `prefers-color-scheme`, live. `dark` draws light ink, `light` dark ink.
 */
export type OrbTheme = 'auto' | 'dark' | 'light';

/**
 * The conversation state:
 * - `idle`       — waiting for someone to talk: sources ignored, a calm, very slow drift
 * - `listening`  — the user's turn: follows the source (usually the microphone)
 * - `speaking`   — the assistant's turn: follows the source (usually its playback)
 * - `processing` — working on what was heard: sources ignored, each type's working motion
 *
 * Listening and speaking draw the same way; the source is what differs.
 * Without a voice, either one settles into the same calm pace as `idle`.
 */
export type VoiceOrbState = 'idle' | 'listening' | 'speaking' | 'processing';

/** Props for the VoiceOrb React component. */
export interface VoiceOrbProps extends Omit<CanvasHTMLAttributes<HTMLCanvasElement>, 'style'> {
  /** Which orb. @default 'orbit' */
  type?: VoiceOrbType;

  /** Conversation state; changes ease, never cut. @default 'listening' */
  state?: VoiceOrbState;

  /** Rendered size in CSS px; any size, designed at 200. @default 160 */
  size?: number;

  /**
   * A live audio stream — usually `useMicrophone().stream`. The orb opens
   * its own analyser on it (shared with any other orb on the same stream)
   * and wins over `analyser` and `level`.
   */
  stream?: MediaStream | null;

  /**
   * Any AnalyserNode you already have: the assistant's voice playing
   * through an `<audio>` element or a WebRTC track, say. Wins over `level`.
   */
  analyser?: AnalyserNode | null;

  /**
   * Drive it yourself, 0–1. A number for occasional changes, or a getter
   * sampled every frame without re-rendering your tree.
   */
  level?: number | (() => number);

  /** Input gain — raise for quiet sources. @default 1 */
  sensitivity?: number;

  /** Noise gate: below this the orb hears silence. @default 0.04 */
  threshold?: number;

  /** Seconds to rise. @default 0.06 (0.16 for `pixel`) */
  attack?: number;

  /** Seconds to settle. @default 0.32 */
  release?: number;

  /** Breathing kept under the voice, so silence never looks dead; 0 for none. @default 0.1 */
  idle?: number;

  /**
   * Waiting pace: with no voice and nothing processing, the clocks run at
   * this share of the tuned speed — low for a calm, slow orb. @default 0.4
   */
  calm?: number;

  /** How much a voice speeds the motion up, as a multiplier on the type's tuning. @default 1 (0.9 for `aura`) */
  voiceSpeed?: number;

  /**
   * An emotion detected in the voice — `positive` (green), `negative`
   * (red) or `calm` (blue). Its colour drifts through the orb in soft
   * patches, near marks taking it most; it eases in, crossfades between
   * emotions and fades out on `null`. Detection is yours to supply.
   * @default null
   */
  emotion?: VoiceOrbEmotion | null;

  /** Override any emotion's colour as an RGB triple (0–255). */
  emotionColors?: Partial<Record<VoiceOrbEmotion, OrbTint>>;

  /**
   * Colourful mode, for the ink types (orbit, sash, signal, swell, pixel): a
   * two-colour gradient across the orb, from the neutral ink into one
   * colour, every mark keeping its depth shading. The colour is the
   * `emotion`'s when one is set, else `accent`; with neither the orb stays
   * neutral. `saturation` is how strong the colour gets: 0 never, 1 the
   * colour itself, up to 2 purer and deeper still. Aura keeps its own spectrum.
   * @default 2
   */
  saturation?: number;

  /** Colourful mode: a fixed colour for the gradient, shown even without an emotion. @default null */
  accent?: VoiceOrbAccent | null;

  /** Colourful mode: which way the gradient runs, in degrees — 0 left → right, 90 top → bottom. @default 99 */
  gradientAngle?: number;

  /** Colourful mode: how fast the gradient turns, degrees per second; 0 holds it still. @default 12 */
  gradientSpin?: number;

  /**
   * Where the voice comes from, −1 left … 1 right — a number, or a getter
   * sampled every frame. While a voice is heard the orb leans that way (it
   * drifts, is pulled out and bulges on the near side) and settles back to
   * centre in silence. Supply it from a stereo estimate (the SwiftUI port
   * reads the iPhone's stereo mics) or drive it yourself.
   */
  direction?: number | (() => number);

  /**
   * Lean: how far the orb drifts toward the voice, as a share of its radius.
   * Every `direction…` amount left unset takes the type's own; `aura` is
   * pulled and bulges further, never squashes, and stretches far into the
   * edge lens. @default 2
   */
  directionMove?: number;

  /** Lean: how far its near side is pulled out beyond the far side. @default 0.7 (aura 1.26) */
  directionPull?: number;

  /** Lean: how much the near flank bulges. @default 0.1 (aura 0.38) */
  directionDeform?: number;

  /** Lean: pressing on at the screen's edge, how much the orb squashes against it, 0–1. @default 0.5 (aura 0) */
  directionSquash?: number;

  /**
   * Lean: pressing on at the screen's edge, how strongly the orb is refracted
   * into it, as through glass — it rests short of the edge and its near side
   * is drawn out across the gap, its colours parted and blurred toward the
   * edge. 0 none … 1 … 2 most. @default 1 (aura 0.79)
   */
  directionLens?: number;

  /** Lean: how far the edge lens draws the orb out toward the edge (distortion), 0–2. @default 1 (aura 1.99) */
  directionStretch?: number;

  /** Lean: how far the edge lens parts red from blue (chromatic aberration), 0–2. @default 1 (aura 1.17) */
  directionSplit?: number;

  /** Lean: how much the edge lens blurs, more the nearer the edge, 0–2. @default 1 (aura 1.25) */
  directionBlur?: number;

  /** Lean: how much the orb bounces as it meets the edge, 0–2. @default 1 (aura 0.82) */
  directionBounce?: number;

  /** Lean: CSS px the orb stops short of the screen's edge. @default 32 (aura 0) */
  directionMargin?: number;

  /**
   * Lean: an element whose left and right edges the orb leans up to instead
   * of the screen's — a card or a panel it lives in (a ref). Clip that
   * element (`overflow: hidden`) so the glow past the margin is cut there.
   */
  directionBounds?: { readonly current: Element | null };

  /**
   * Colourful mode: how neutral the gradient's start is — 1 begins in the
   * plain monochrome ink and gathers the accent toward the far side, 0
   * covers the orb in the accent end to end. @default 1
   */
  neutral?: number;

  /** Colourful mode: the colour's brightness, a multiplier on its lightness. @default 1.02 */
  colorBrightness?: number;

  /** Colourful mode: degrees to turn the colour's hue. @default 0 */
  colorHue?: number;

  /** Colourful mode: where across the orb (0–1) the colour begins to come in. @default 0.1 */
  gradientStart?: number;

  /** Colourful mode: how far across the orb (0–1) the colour takes to arrive in full. @default 0.6 */
  gradientWidth?: number;

  /** Theme mode; `auto` detects from the host project. @default 'auto' */
  theme?: OrbTheme;

  /** Speed multiplier on the type's tuned clocks. @default 1 */
  speed?: number;

  /** Freeze on the current frame. @default false */
  paused?: boolean;

  /** Optional ink tint — `#rgb`, `#rrggbb` or `rgb()`; depth shading is kept on it. */
  color?: string;

  /** Density multiplier on the type's dot / line counts. @default 1 */
  dots?: number;

  /** Multiplier on every dot radius. @default 1 (0.55 for `pixel`) */
  dotSize?: number;

  /** Advanced: raw type knobs merged over the resolved preset, last. */
  opts?: TypeOpts;

  /** Escape hatch: replace the type's geometry, same contract as `TYPE_FRAMES`. */
  frame?: TypeFrame;

  /** Called every frame with the shaped level, 0–1 — for a meter or a label. */
  onLevel?: (level: number) => void;

  style?: CSSProperties;
}
