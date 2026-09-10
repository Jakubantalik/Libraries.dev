/**
 * Live-tunable glow parameters.
 *
 * Every number the halo + catch-light overlay used to hard-code lives here as
 * a mutable singleton so a tuning surface can drive it at runtime. Two classes:
 *
 *   • runtime — read every frame inside `updateGlow`. Changing one takes
 *     effect on the next frame with no DOM work.
 *   • markup — baked into the SVG (`buildSvgMarkup`) at inject time: stroke
 *     widths, blur radii, per-layer opacities, blob lengths. Changing one
 *     requires the SVG to be rebuilt, which `setGlowConfig` signals through
 *     `subscribeGlowConfig` so MetalFx can re-inject.
 *
 * `GLOW_DEFAULTS` are the values that shipped before this file existed, so
 * `resetGlowConfig()` is an exact restore.
 */

export interface GlowConfig {
  // ── runtime ───────────────────────────────────────────────────────────
  /** Overall halo group opacity multiplier. */
  haloOpMul: number;
  /** Catch-light group intensity multiplier (clamped to 1 after multiply). */
  extraIntensity: number;
  /** Glow opacity at a fully-lit perimeter point. */
  peakOp: number;
  /** Glow opacity at a dark perimeter point. */
  baseOp: number;
  /** Perpendicular inset of the halo from the ring, SVG units at 1×. */
  inset: number;
  /** Extra outward offset for the catch-light, SVG units at 1×. */
  extraOutward: number;
  /** Random wander amplitude along the perimeter, at the 140×40 reference. */
  wanderRange: number;
  /** Per-frame lerp toward the wander target. */
  wanderLerp: number;
  /** Per-frame lerp of opacity toward its luminance-driven target. */
  fadeRate: number;
  /** Luminance below which the glow sits at `baseOp`. */
  lumLo: number;
  /** Luminance above which the glow reaches `peakOp`. */
  lumHi: number;
  /** Minimum time at a hotspot before a brighter rival can steal it. */
  minDwellMs: number;
  /** Appear duration, ms. A relocation is a full fade-out at the old spot
   *  then a full fade-in at the new one — the glow never slides. */
  relocFadeMs: number;
  /** Disappear duration, ms. Slower than the appear so a hotspot lingers. */
  relocFadeOutMs: number;
  /** Point-mode (masked text/glyph) intensity multiplier. The mask discards
   *  most of the halo's blur, so what survives inside the strokes needs a
   *  boost to read at all. */
  pointGain: number;

  // ── markup (re-inject on change) ──────────────────────────────────────
  /** Half-length of the halo stroke path, at the reference pill. */
  haloHalfLen: number;
  /** Half-length of the catch-light stroke path, at the reference pill. */
  extraHalfLen: number;
  haloStrokeXl: number;
  haloStrokeLg: number;
  haloStrokeMd: number;
  haloStrokeSm: number;
  haloBlurXl: number;
  haloBlurLg: number;
  haloBlurMd: number;
  haloBlurSm: number;
  haloOpXl: number;
  haloOpLg: number;
  haloOpMd: number;
  haloOpSm: number;
  extraStrokeOuter: number;
  extraStrokeCore: number;
  extraBlurOuter: number;
  extraBlurCore: number;
  /** Radius of the radial mask that fades the catch-light's ends. */
  extraFadeR: number;
  extraOpOuter: number;
}

export const GLOW_MARKUP_KEYS: ReadonlySet<keyof GlowConfig> = new Set<keyof GlowConfig>([
  'haloHalfLen', 'extraHalfLen',
  'haloStrokeXl', 'haloStrokeLg', 'haloStrokeMd', 'haloStrokeSm',
  'haloBlurXl', 'haloBlurLg', 'haloBlurMd', 'haloBlurSm',
  'haloOpXl', 'haloOpLg', 'haloOpMd', 'haloOpSm',
  'extraStrokeOuter', 'extraStrokeCore', 'extraBlurOuter', 'extraBlurCore',
  'extraFadeR', 'extraOpOuter',
]);

// The `/ 3` values were `EXTRA_SCALE = 1 / 3` applied to the original
// constants (4.0, 2.0, 2.0, 1.35, 13.0, 9.13952). Stored pre-multiplied so a
// slider moves the number the SVG actually receives.
export const GLOW_DEFAULTS: Readonly<GlowConfig> = Object.freeze({
  haloOpMul: 2.0,
  extraIntensity: 3.51,
  peakOp: 0.85,
  baseOp: 0.34,
  inset: 1.5,
  extraOutward: 1.0,
  wanderRange: 15,
  wanderLerp: 0.0075,
  fadeRate: 0.00875,
  lumLo: 0.08,
  lumHi: 0.32,
  minDwellMs: 1500,
  relocFadeMs: 300,
  relocFadeOutMs: 450,
  pointGain: 2.5,

  haloHalfLen: 7.8,
  extraHalfLen: 9.13952 / 3,
  haloStrokeXl: 26.4,
  haloStrokeLg: 15.6,
  haloStrokeMd: 7.2,
  haloStrokeSm: 3.0,
  haloBlurXl: 8.4,
  haloBlurLg: 4.8,
  haloBlurMd: 2.1,
  haloBlurSm: 0.9,
  haloOpXl: 0.385,
  haloOpLg: 0.595,
  haloOpMd: 0.70,
  haloOpSm: 0.70,
  extraStrokeOuter: 4.0 / 3,
  extraStrokeCore: 2.0 / 3,
  extraBlurOuter: 2.0 / 3,
  extraBlurCore: 1.35 / 3,
  extraFadeR: 13.0 / 3,
  extraOpOuter: 0.85,
});

/** Live values. Read directly by the glow engine; write via `setGlowConfig`. */
export const GLOW: GlowConfig = { ...GLOW_DEFAULTS };

type Listener = (markupChanged: boolean) => void;
const listeners = new Set<Listener>();

/**
 * Merge a partial config. Notifies subscribers, flagging whether any markup
 * key changed so they can decide between "next frame picks it up" and
 * "rebuild the SVG".
 */
export function setGlowConfig(patch: Partial<GlowConfig>): void {
  let markupChanged = false;
  for (const k of Object.keys(patch) as Array<keyof GlowConfig>) {
    const v = patch[k];
    if (v === undefined || GLOW[k] === v) continue;
    GLOW[k] = v;
    if (GLOW_MARKUP_KEYS.has(k)) markupChanged = true;
  }
  for (const fn of listeners) fn(markupChanged);
}

export function resetGlowConfig(): void {
  setGlowConfig({ ...GLOW_DEFAULTS });
}

export function subscribeGlowConfig(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
