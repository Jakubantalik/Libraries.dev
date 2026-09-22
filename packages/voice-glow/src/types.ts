import type { CSSProperties, ReactNode, HTMLAttributes } from 'react';

/**
 * Host preset — retunes the glow's geometry for the element it wraps
 * - 'default': a chat input or card, ~350px wide
 * - 'pill': a small recording pill, ~150×44 — glow pulled in, shallower bend
 * - 'mobile': the bottom of a phone screen — wider range, taller rise
 *
 * A preset only supplies defaults; every geometry prop still overrides it.
 */
export type VoiceBeamType = 'default' | 'pill' | 'mobile';

/**
 * Theme mode for adapting beam colors to the background
 */
export type VoiceBeamTheme = 'dark' | 'light' | 'auto';

/**
 * How the voice is drawn
 * - 'glow': coloured light — soft gradients, a band of light along the
 *   glow's ceiling and a blurred bloom (default)
 * - 'dots': a gently domed sheet of dots seen in perspective, in the
 *   dotted language of thinking-orbs. The voice raises hills out of it —
 *   the spectrum as a landscape, drifting with the flow — and when the
 *   voice drops the dots fall back under gravity, landing with a small
 *   bounce. White on the dark theme, near-black ink on the light one; the
 *   colour props do not apply.
 */
export type VoiceBeamLook = 'glow' | 'dots';

/**
 * Color variant for the beam — the same eight palettes as border-beam
 * - 'colorful': Full spectrum, Siri-like (default)
 * - 'mono': Monochromatic grayscale
 * - 'ocean': Blue and purple tones
 * - 'sunset': Warm orange, yellow, and red tones
 * - 'forest': Green and teal tones
 * - 'candy': Pink and magenta tones
 * - 'ice': Cyan and pale blue tones
 * - 'gold': Amber and yellow tones
 */
export type VoiceBeamColorVariant =
  | 'colorful'
  | 'mono'
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'candy'
  | 'ice'
  | 'gold';

/**
 * A level source: a plain number, or a getter the driver samples every
 * frame. Pass a getter for anything that changes many times a second so
 * the component does not re-render per frame.
 */
export type VoiceBeamLevel = number | (() => number);

/**
 * Theme color configuration
 */
export interface VoiceThemeColors {
  strokeOpacity: number;
  innerOpacity: number;
  bloomOpacity: number;
  innerShadow: string;
  saturation: number;
  brightness: number;
  /** Optional per-theme hue drift defaults; fall back to 24° / 12 s / 0°. */
  hueRange?: number;
  hueDuration?: number;
  hueBase?: number;
  /** Optional per-theme overall strength (falls back to 1). */
  strength?: number;
  /** Optional per-theme band strength for types that do not set their own. */
  bandStrength?: number;
}

/**
 * Props for the VoiceBeam component
 */
export interface VoiceBeamProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Content to wrap with the voice beam effect */
  children: ReactNode;

  /**
   * Host preset: 'default' (chat input), 'pill' (recording pill) or
   * 'mobile' (bottom of a phone screen). Sets the defaults of the
   * geometry props below for that host; any prop you pass still wins.
   * @default 'default'
   */
  type?: VoiceBeamType;

  /**
   * How the voice is drawn: coloured light, or a dotted surface the voice
   * raises and gravity brings down.
   * @default 'glow'
   */
  look?: VoiceBeamLook;

  /**
   * Dot radius, as a multiplier on the tuned size. `look="dots"` only.
   * @default 1
   */
  dotSize?: number;

  /**
   * Spacing between dots, as a multiplier — below 1 is a denser, finer
   * surface, above 1 a sparser, coarser one. `look="dots"` only.
   * @default 1
   */
  dotGap?: number;

  /**
   * Organic texture, 0–1: a slow ripple the flow carries across the
   * surface. 0 is a still sheet that only the voice moves. `look="dots"` only.
   * @default 0.6
   */
  texture?: number;

  /**
   * How hard the dots fall when the voice drops, as a multiplier on the
   * surface's gravity. Lower floats down, higher drops like sand.
   * `look="dots"` only.
   * @default 1
   */
  gravity?: number;

  /**
   * Size of the whole effect. Multiplies every pixel dimension at once —
   * lobes, their spacing, the visible range, the bend, the band, the core,
   * the bloom blur, the flow speed — so the glow grows or shrinks as one
   * thing, on top of the type preset and the individual geometry props.
   * @default 1 (0.45 for `type="pill"`)
   */
  scale?: number;

  /**
   * Audio to react to. When set, the beam analyses this stream (level plus
   * low / mid / high bands) and ignores `level`. Get one from the
   * `useMicrophone` hook or any `getUserMedia` / WebRTC source.
   */
  stream?: MediaStream | null;

  /**
   * Manual drive, 0–1, used when no `stream` is given. A number re-renders
   * on change; a getter is sampled once per frame without re-rendering.
   * @default 0
   */
  level?: VoiceBeamLevel;

  /**
   * Input gain on the analysed audio. The default suits a laptop microphone
   * at conversational distance; raise it for quiet sources, lower it for a
   * close or hot one.
   * @default 3.1
   */
  sensitivity?: number;

  /**
   * Noise gate, 0–1. Levels below it read as silence, so room hum and
   * fan noise do not keep the beam twitching.
   * @default 0.015
   */
  threshold?: number;

  /**
   * Seconds the glow takes to rise toward a louder level.
   * @default 0.325
   */
  attack?: number;

  /**
   * Seconds the glow takes to settle after the sound drops.
   * @default 0.86
   */
  release?: number;

  /**
   * Resting presence, 0–1 — how much the beam breathes while silent so it
   * never looks dead. 0 hides it completely between sounds.
   * @default 0.23
   */
  idle?: number;

  /**
   * Period of the idle breathing in seconds.
   * @default 5.2
   */
  breatheDuration?: number;

  /**
   * How tall the glow grows at full level, as a multiple of its resting
   * height. The rise is centered on the bottom edge.
   * @default 1.2 (1.8 on the light theme; 1.35 for `pill`, 3 for `mobile`)
   */
  reach?: number;

  /**
   * How far the glow widens at full level, as a fraction of its resting
   * width. Side lobes drift outward as well, so a loud sound spreads.
   * @default 1.05 (0.8 on the light theme; 1.1 for `pill`, 0.45 for `mobile`)
   */
  spread?: number;

  /**
   * Let the low / mid / high bands move the colored lobes independently
   * (center follows the lows, the sides the mids and highs). With a
   * manual `level` the bands are synthesised from the level, so the lobes
   * still dance. Off, every lobe follows the one level.
   * @default true
   */
  bands?: boolean;

  /**
   * How fast the spectrum travels sideways, in px per second at full
   * level — the lobes slide left to right while a voice is heard and rest
   * when it stops, so every colour takes a turn at the centre. Negative
   * flows right to left; 0 holds the lobes in place.
   * @default 48
   */
  flow?: number;

  /**
   * Processing state — turn it on once the voice has been captured and
   * something is working on it. The lobes gather into one compact beam
   * that travels the glow's range left to right and back, eased at each
   * end and looped — border-beam's `line` type, confined to the voice
   * glow — and the glow is held lit at `processingLevel` so the beam has
   * colour. Both blend in and out smoothly. The distortion settles out in
   * about a quarter second and stays off while processing.
   * @default false
   */
  processing?: boolean;

  /**
   * Seconds for one pass of the processing beam (left to right, or back
   * again).
   * @default 1.1 (1.05 for `type="mobile"`)
   */
  processingDuration?: number;

  /**
   * How lit the glow is held while processing, 0–1, as if a voice were
   * speaking at that level.
   * @default 0.55 (0.35 for `type="mobile"`)
   */
  processingLevel?: number;

  /**
   * Seconds the morph between the voice glow and the travelling beam
   * takes, in either direction — the gather, the narrowing and the travel
   * ease in and out over it.
   * @default 0.6
   */
  processingEase?: number;

  /**
   * How far the processing beam travels to each side, as a multiple of
   * half the lobe ring: 1 sweeps the glow's resting spread, lower keeps
   * it near the centre, higher runs it out to the corners.
   * @default 1.55 (2 for `pill`, 1 for `mobile`)
   */
  processingTravel?: number;

  /**
   * How the processing beam eases into each turn of its sweep: 1 runs at
   * a constant speed and turns sharply, 2 slows smoothly into the ends,
   * higher dwells there longer before heading back.
   * @default 2.1
   */
  processingCurve?: number;

  /**
   * How much the coloured glow rides the element's corner arcs while
   * processing, 0–1: 0 keeps it flat along the bottom edge, 1 lifts it
   * along the rounded corner as it passes through. The band line follows
   * the corner either way.
   * @default 0.45 (0 for `type="pill"`, 0.4 for `type="mobile"`)
   */
  cornerFollow?: number;

  /**
   * Color variant for the beam
   * @default 'colorful'
   */
  colorVariant?: VoiceBeamColorVariant;

  /**
   * Your own lobe colours, centre first then the pairs outward — up to
   * seven, any CSS hex or rgb. Slots you leave out (or that fail to
   * parse) keep the variant's colour for the theme.
   */
  colors?: string[];

  /**
   * The band's colours: the core ridge and its chromatic fringes above,
   * between and below. Any CSS hex or rgb; unset ones keep the theme's
   * defaults (white core with red / green / blue fringes on dark, a pink
   * core with rose / lavender / sky on light).
   */
  bandColors?: { core?: string; above?: string; mid?: string; below?: string };

  /**
   * Theme mode — adapts beam colors for dark or light backgrounds;
   * 'auto' follows prefers-color-scheme
   * @default 'dark'
   */
  theme?: VoiceBeamTheme;

  /**
   * Disable the slow hue drift for static colors
   * @default false
   */
  staticColors?: boolean;

  /**
   * Hue drift range in degrees (the palette wanders ± this far)
   * @default 24 (dark) / 40 (light)
   */
  hueRange?: number;

  /**
   * Period of the hue drift in seconds
   * @default 12 (dark) / 8.5 (light)
   */
  hueDuration?: number;

  /**
   * Whether the effect is on. Off fades the beam out and stops the audio
   * analysis.
   * @default true
   */
  active?: boolean;

  /**
   * Freezes the effect where it is — the glow, the band and the audio
   * analysis all hold their last frame — without fading it out. Other
   * props still shape the held frame, and the clocks resume where they
   * stopped.
   * @default false
   */
  paused?: boolean;

  /**
   * Custom border radius in pixels. When omitted, the component
   * auto-detects the border-radius of the first child element.
   */
  borderRadius?: number;

  /**
   * Brightness multiplier for the glow
   * @default 1.15 (dark chat input) / 0.95 (light); the dark theme itself is 1.1, `pill` runs 1.35, `mobile` 1.2 on dark
   */
  brightness?: number;

  /**
   * Saturation multiplier for the glow
   * @default 1.2 (dark) / 1.6 (light); `pill` and `mobile` run 1.5 on dark
   */
  saturation?: number;

  /**
   * Multiplies the bloom blur radius, so the halo reads tighter (< 1) or
   * wider and softer (> 1).
   * @default 1
   */
  glowSize?: number;

  /**
   * Per-layer opacity multipliers on the theme's own: the crisp edge
   * stroke, the soft inner light and the blurred bloom. The same knobs
   * as the `--voice-stroke-opacity` / `--voice-inner-opacity` /
   * `--voice-bloom-opacity` CSS hooks.
   * @default 1
   */
  strokeOpacity?: number;
  innerOpacity?: number;
  bloomOpacity?: number;

  /* ── Shape ──────────────────────────────────────────────────────────
   * Each multiplier below defaults to the tuned geometry. They scale
   * the resting sizes; the voice still drives the motion on top. */

  /**
   * Bend — how much, in px, the glow's top contour humps up at the centre
   * at full level. The ceiling the glow is masked to gains that height in
   * the middle and none at the ends, and a faint rim traces the curve, so
   * the glow's outline bows upward with the voice like space bending
   * around it. 0 keeps the contour at its plain ellipse.
   * @default 60
   */
  bend?: number;
  /* ── Band ──────────────────────────────────────────────────────────
   * The light along the bend's contour — an organic bell drawn on its own
   * layer, exp(-(|x| / spread)^curve), flattening onto the edge at both
   * ends. It fades in with the bend, and reacts to the voice on its own:
   * the fringes split further and the band thickens as the level rises,
   * and it turns with the hue drift. */

  /** Opacity of the band, 0 hides it. @default 1.55 (1.8 for `mobile`; on light 1.7, or 2 for `pill`) */
  bandStrength?: number;
  /** Thickness of the band. @default 2.15 */
  bandWidth?: number;
  /** Height of the band's peak as a fraction of the glow's ceiling, 0.1–1.3. @default 0.35 */
  bandPosition?: number;
  /** Bell exponent: below 2 an exponential, cusp-like rise; 2 a gaussian; above, a flatter top. @default 1.75 */
  bandCurve?: number;
  /** Bell width as a fraction of the glow's half-range: small is a narrow spike with long tails, large a broad dome. @default 0.87 */
  bandSpread?: number;
  /** Asymmetry, −0.6–0.6: positive widens the right side and steepens the left. @default 0.12 */
  bandSkew?: number;
  /** Vertical shift of the whole band line in px; negative sinks it toward the edge. @default -27 */
  bandOffset?: number;
  /** How far the band's ends rise again toward the corners, as a fraction of its peak, 0–1 — the line opens upward at the edges instead of dying flat. @default 0.59 (0 for `pill`) */
  bandTail?: number;
  /** Where the tail's rise starts, as a share of the distance from the beam's centre to the element's edge (0.85 = only the last 15%); it always reaches the full lift exactly at the corner. @default 0.67 */
  bandTailPosition?: number;
  /** Exponent of the rise: 1 a straight ramp, 2 a parabola, higher a hook that stays low and whips up at the corner. @default 2.4 */
  bandTailCurve?: number;
  /** Px the band runs past each side of the element, so the hook peaks outside and is cropped by the component's edge. Scales with `scale`. @default 15 */
  bandTailOverflow?: number;
  /** Chromatic aberration — how far the red and blue fringes split from the core, 0–1. @default 0.89 */
  bandAberration?: number;

  /**
   * Distortion — how much the glow under the band warps sideways, 0–1.
   * A slowly drifting noise field displaces the inner light and the bloom
   * horizontally, stronger as the voice rises, so the colours shimmer and
   * stretch like light through bent space. Only the glow UNDER the band
   * line warps — the layers are split at the line — and it is independent
   * of `bandStrength`, so the line can be invisible and the warp strong.
   * The edge stroke stays crisp. 0 turns the filter off entirely.
   * @default 0.62
   */
  distortion?: number;
  /** Grain of the distortion's noise: below 1 broad slow waves, above 1 finer ripples. @default 2.3 */
  distortionDetail?: number;

  /** Width of every colour lobe, all layers. @default 0.65 */
  glowWidth?: number;
  /** Height of every colour lobe, all layers. @default 1.25 */
  glowHeight?: number;
  /** Distance between the lobes (and the ring the flow travels). @default 0.85 */
  lobeSpacing?: number;
  /** Width of the visible ellipse the glow is masked to. @default 0.75 */
  rangeWidth?: number;
  /** Height of the visible ellipse the glow is masked to. @default 1 */
  rangeHeight?: number;
  /** Where each lobe fades out — below 1 crisper, above 1 softer. @default 1.07 */
  softness?: number;
  /** The white hot spot at the centre of the edge. @default 1 */
  coreSize?: number;
  /**
   * The epicentre: a soft white wash under the band line at the centre of
   * the edge, so the source reads lighter than the band. 0–3: up to 1 the
   * wash's opacity, past 1 its solid white core widens and the whole wash
   * grows, washing out more of the colour beneath.
   * @default 0 (1.8 on the light theme)
   */
  coreLight?: number;
  /** Width of the epicentre wash. @default 1 */
  coreLightWidth?: number;
  /** Height of the epicentre wash. @default 1 */
  coreLightHeight?: number;
  /** Size of the colours painted into the 1px edge stroke. @default 1 */
  strokeScale?: number;
  /** Size of the soft light inside the element. @default 1 */
  innerScale?: number;
  /** Extra height of the inner light — how far it reaches into the element. @default 1 */
  innerHeight?: number;
  /** Size of the blurred halo. @default 1 */
  bloomScale?: number;
  /** Extra height of the halo — how far the soft light climbs. @default 1 */
  bloomHeight?: number;

  /**
   * Overall strength/opacity of the effect (0–1).
   * Only affects the beam layers — not the children.
   * @default 1 (dark) / 0.8 (light); 1 on both for `type="mobile"`
   */
  strength?: number;

  /**
   * Additional class name for the container
   */
  className?: string;

  /**
   * Additional inline styles for the container
   */
  style?: CSSProperties;

  /**
   * Extra CSS appended after the beam's own generated stylesheet. Write
   * `{id}` wherever the instance id belongs — the root is
   * `[data-voice-beam="{id}"]`, its layers the `::before` / `::after`
   * pseudo-elements and `[data-voice-beam-bloom]`, and keyframes are named
   * `*-{id}` — and it is substituted per instance.
   */
  css?: string;

  /**
   * Called every frame with the smoothed level (0–1) the beam is showing.
   * Handy for a meter or a "listening" label; avoid setting React state
   * from it on every call.
   */
  onLevel?: (level: number) => void;

  /**
   * Callback when the fade-in completes
   */
  onActivate?: () => void;

  /**
   * Callback when the fade-out completes
   */
  onDeactivate?: () => void;
}
