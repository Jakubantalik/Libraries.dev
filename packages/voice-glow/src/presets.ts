import type { VoiceBeamLook, VoiceBeamType } from './types';

/**
 * The geometry and response knobs a `type` preset may retune. Everything
 * here is a prop on the component; the preset only supplies the default,
 * so an explicit prop always wins.
 */
export interface VoiceGeometry {
  /** Size of the whole effect (see the `scale` prop). */
  scale: number;
  /** Bloom blur multiplier (see the `glowSize` prop). */
  glowSize: number;
  /** Per-layer opacity multipliers on the theme preset. */
  strokeOpacity: number;
  innerOpacity: number;
  bloomOpacity: number;
  idle: number;
  reach: number;
  spread: number;
  flow: number;
  bend: number;
  bandStrength: number;
  bandWidth: number;
  bandPosition: number;
  bandCurve: number;
  bandSpread: number;
  bandSkew: number;
  bandOffset: number;
  /** How far the band's ends rise again toward the corners, as a fraction of its peak. */
  bandTail: number;
  /** Where the tail's rise starts, as a share of the centre-to-edge distance; it always reaches full lift at the corner. */
  bandTailPosition: number;
  /** Exponent of the rise: 1 a straight ramp, higher a hook that stays low then whips up at the corner. */
  bandTailCurve: number;
  /** Px the band runs past each side of the element, so the hook is cropped by the component. */
  bandTailOverflow: number;
  bandAberration: number;
  distortion: number;
  distortionDetail: number;
  glowWidth: number;
  glowHeight: number;
  lobeSpacing: number;
  rangeWidth: number;
  rangeHeight: number;
  softness: number;
  coreSize: number;
  /** The epicentre: a white wash under the band line at the centre of the edge, 0–1 (light theme only by default). */
  coreLight: number;
  coreLightWidth: number;
  coreLightHeight: number;
  strokeScale: number;
  innerScale: number;
  innerHeight: number;
  bloomScale: number;
  bloomHeight: number;
  /** Cell size of the mosaic and the dither, as a multiplier (see the `pixelSize` prop). */
  pixelSize: number;
}

/**
 * The tuned defaults — the `default` type, a ~350px chat input.
 */
export const voiceDefaults: VoiceGeometry = {
  scale: 1,
  glowSize: 1,
  strokeOpacity: 1,
  innerOpacity: 1,
  bloomOpacity: 1,
  idle: 0.18,
  reach: 1.2,
  spread: 1.05,
  flow: 48,
  bend: 60,
  bandStrength: 1.55,
  bandWidth: 2.15,
  bandPosition: 0.35,
  bandCurve: 1.75,
  bandSpread: 0.87,
  bandSkew: 0.12,
  bandOffset: -27,
  bandTail: 0.59,
  bandTailPosition: 0.67,
  bandTailCurve: 2.4,
  bandTailOverflow: 15,
  bandAberration: 0.89,
  distortion: 0.62,
  distortionDetail: 2.3,
  glowWidth: 0.65,
  glowHeight: 1.25,
  lobeSpacing: 0.85,
  rangeWidth: 0.75,
  rangeHeight: 1,
  softness: 1.07,
  coreSize: 1,
  coreLight: 0,
  coreLightWidth: 1,
  coreLightHeight: 1,
  strokeScale: 1,
  innerScale: 1,
  innerHeight: 1,
  bloomScale: 1,
  bloomHeight: 1,
  pixelSize: 1,
};

/**
 * Per-type overrides on the defaults. The glow is authored in px for the
 * default host, so a smaller or larger host needs its lobes, range and
 * band rescaled to read the same.
 *
 * - `pill`: a ~150×44 recording pill — everything pulled in, a lower
 *   reach, a shallower bend, a thinner band.
 * - `mobile`: the bottom of a phone screen (~400px wide, tall) — a wider
 *   range and lobe ring, a taller rise, a broader band.
 */
export const voiceTypePresets: Record<VoiceBeamType, Partial<VoiceGeometry>> = {
  default: {},
  pill: {
    scale: 0.45,
    glowSize: 0.95,
    strokeOpacity: 1.2,
    innerOpacity: 0.85,
    reach: 1.35,
    spread: 1.1,
    flow: 0,
    bend: 23,
    bandStrength: 1.55,
    bandWidth: 1.85,
    bandCurve: 1.95,
    bandSpread: 0.38,
    bandOffset: -16,
    bandTail: 0,
    distortion: 0.45,
    distortionDetail: 3,
    glowWidth: 0.65,
    glowHeight: 0.95,
    lobeSpacing: 0.45,
    rangeWidth: 0.8,
    rangeHeight: 0.7,
    softness: 0.88,
    coreSize: 0.25,
    strokeScale: 1.25,
    innerScale: 0.95,
    bloomScale: 1.05,
    bloomHeight: 2.25,
  },
  mobile: {
    scale: 1.25,
    spread: 0.45,
    reach: 3,
    flow: 60,
    bend: 70,
    bandWidth: 2.4,
    bandCurve: 1.55,
    bandSpread: 0.9,
    bandOffset: -50,
    bandTail: 0.62,
    bandTailPosition: 0.42,
    bandTailCurve: 2.7,
    bandTailOverflow: 22,
    bandStrength: 1.8,
    distortionDetail: 2,
    glowWidth: 1.15,
    glowHeight: 2.1,
    lobeSpacing: 1.35,
    rangeWidth: 1.25,
    rangeHeight: 1.2,
    softness: 1.1,
  },
};

/**
 * Colour tuning a type may carry on top of the theme preset (brightness
 * and saturation default per theme, so these are optional overrides).
 */
export type VoiceTypeStyle = { brightness?: number; saturation?: number; strength?: number };

export const voiceTypeStyle: Record<VoiceBeamType, VoiceTypeStyle> = {
  // The chat input sits on a dark card, so it runs a touch brighter than
  // the theme's 1.1 (light keeps the theme's own, see below).
  default: { brightness: 1.15 },
  pill: { brightness: 1.35, saturation: 1.5 },
  // The phone screen is large and the glow sits far from the content, so
  // it carries full strength on either theme (light otherwise dims to 0.8)
  // and, on dark, a brighter and richer glow than the theme's 1.1 / 1.2.
  mobile: { strength: 1, brightness: 1.2, saturation: 1.5 },
};

/**
 * What a type changes about the style on the light theme. The pill's lift
 * exists to carry the glow on a dark chip; on light it would read hotter
 * than the chat input, so the pill drops it and takes the theme's own.
 */
const voiceTypeStyleLight: Partial<Record<VoiceBeamType, VoiceTypeStyle>> = {
  default: {},
  pill: {},
  mobile: { strength: 1 },
};

/** The colour tuning for a type on a theme. */
export function resolveVoiceStyle(
  type: VoiceBeamType = 'default',
  theme: 'dark' | 'light' = 'dark'
): VoiceTypeStyle {
  const light = theme === 'light' ? voiceTypeStyleLight[type] : undefined;
  return light ?? voiceTypeStyle[type];
}

/**
 * The full geometry for a type: the defaults with the type's overrides —
 * and, for what the type leaves alone, the theme's own (the light chat
 * input carries a band strength, reach and spread of its own).
 */
/** What the light theme changes per type, on top of the type's preset. */
const lightTypeOverrides: Partial<Record<VoiceBeamType, Partial<VoiceGeometry>>> = {
  // The band on white, whatever the dark strengths: 1.7 for the chat
  // input and the phone, 2 for the pill.
  default: { bandStrength: 1.7 },
  pill: { bandStrength: 2 },
  mobile: { bandStrength: 1.7 },
};

/**
 * Mosaic and dither tuning, set by hand on the phone (`type="mobile"`, dark)
 * in the Studio: a smaller, softer-topped glow with a stronger, higher band,
 * so the cells read as a mound under a bright line rather than a wall.
 */
const PIXEL_LOOK_MOBILE: Partial<VoiceGeometry> = {
  scale: 1.05,
  spread: 0.6,
  bandStrength: 3,
  bandPosition: 0.44,
  glowWidth: 1.2,
  rangeHeight: 0.85,
  softness: 1.09,
  innerHeight: 1.2,
  bloomHeight: 0.35,
};

/** The dither's own on top of that, also set on the phone: a gentler band —
 *  weaker, a touch wider, unskewed — and a slightly lower bend, since its
 *  pixels already carry the light the mosaic's glyphs leave to the band. */
const DITHER_LOOK_MOBILE: Partial<VoiceGeometry> = {
  bend: 68,
  bandStrength: 1.3,
  bandWidth: 2.45,
  bandSkew: 0,
};

/** Values set by hand for one look on one host, over everything above. */
const PIXEL_LOOK_TYPE: Record<'mosaic' | 'dither', Partial<Record<VoiceBeamType, Partial<VoiceGeometry>>>> = {
  mosaic: { default: { pixelSize: 0.75 } },
  // The ratio left the pill's dither too small to read; tuned in the Studio.
  // The phone's own dither, tuned in the Studio as a whole: only the phone
  // takes it (the other hosts keep their ratios on the shared tuning).
  dither: {
    pill: { scale: 0.5 },
    default: { pixelSize: 0.85 },
    mobile: {
      scale: 1,
      spread: 0.9,
      flow: 56,
      bend: 19,
      bandStrength: 1.05,
      bandWidth: 3,
      bandPosition: 0.5,
      bandTailPosition: 0.21,
      glowWidth: 1.6,
      glowHeight: 3,
      lobeSpacing: 1.2,
      softness: 0.84,
      coreSize: 0.85,
      innerHeight: 1.6,
      bloomHeight: 0.3,
    },
  },
};

/** The pixel looks' halo (`pixelGlow`) by look and host, where tuned by
 *  hand; 0.6 everywhere else. */
const PIXEL_GLOW: Partial<Record<'mosaic' | 'dither', Partial<Record<VoiceBeamType, number>>>> = {
  dither: { default: 0.38 },
};

export function pixelGlowDefault(type: VoiceBeamType, look?: string): number {
  return (look === 'mosaic' || look === 'dither' ? PIXEL_GLOW[look]?.[type] : undefined) ?? 0.6;
}

/** How long processing's dust lingers (`pixelDust`), s, by host where
 *  tuned by hand; 1.1 everywhere else. The phone's tall screen carries a
 *  longer trail. */
const PIXEL_DUST: Partial<Record<VoiceBeamType, number>> = { mobile: 1.5 };

export function pixelDustDefault(type: VoiceBeamType): number {
  return PIXEL_DUST[type] ?? 1.1;
}

/** The pixel looks' dome (`pixelDome`) by host: the phone's field stands
 *  tallest in the middle and lower toward its sides; the wide hosts stay
 *  level. */
const PIXEL_DOME: Partial<Record<VoiceBeamType, number>> = { mobile: 0.6 };

export function pixelDomeDefault(type: VoiceBeamType): number {
  return PIXEL_DOME[type] ?? 0;
}

/** The pixel looks' defaults for a type: the phone's tuning exactly on the
 *  phone, and the same changes as ratios on every other host's preset (an
 *  absolute where the phone's own value is 0, as the skew's is not). */
function pixelLookDefaults(g: VoiceGeometry, type: VoiceBeamType, theme: 'dark' | 'light', look: 'mosaic' | 'dither'): VoiceGeometry {
  const tuning = look === 'dither' ? { ...PIXEL_LOOK_MOBILE, ...DITHER_LOOK_MOBILE } : PIXEL_LOOK_MOBILE;
  const own = PIXEL_LOOK_TYPE[look][type];
  if (type === 'mobile' && theme === 'dark') return { ...g, ...tuning, ...own };
  const phone = resolveVoiceDefaults('mobile', 'dark');
  const out = { ...g };
  for (const key of Object.keys(tuning) as Array<keyof VoiceGeometry>) {
    const want = tuning[key] as number;
    out[key] = phone[key] ? Math.round(g[key] * (want / phone[key]) * 1000) / 1000 : want;
  }
  return { ...out, ...own };
}

export function resolveVoiceDefaults(
  type: VoiceBeamType = 'default',
  theme: 'dark' | 'light' = 'dark',
  look: VoiceBeamLook = 'glow'
): VoiceGeometry {
  const g = resolveTypeDefaults(type, theme);
  return look === 'mosaic' || look === 'dither' ? pixelLookDefaults(g, type, theme, look) : g;
}

function resolveTypeDefaults(type: VoiceBeamType, theme: 'dark' | 'light'): VoiceGeometry {
  const typePreset = voiceTypePresets[type];
  const themeOverrides: Partial<VoiceGeometry> = {};
  if (theme === 'light') {
    // The light card was tuned taller and narrower than the dark one.
    if (typePreset.reach === undefined) themeOverrides.reach = 1.8;
    if (typePreset.spread === undefined) themeOverrides.spread = 0.8;
    // On white the epicentre reads lighter than the band; dark keeps it off.
    if (typePreset.coreLight === undefined) themeOverrides.coreLight = 1.8;
  }
  return { ...voiceDefaults, ...themeOverrides, ...typePreset, ...(theme === 'light' ? lightTypeOverrides[type] : undefined) };
}
