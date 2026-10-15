/** Live config for the Pro badge example. Tiny external store so the dev
 *  panel and the component share state without prop-drilling through App. */
export interface BadgeConfig {
  /** Per-instance shader sampling scale — zoom of the metal inside the glyphs. */
  shaderScale: number;
  /** Shader opacity for the badge (0..1) — MetalFx `strength`, multiplied
   *  with the page-level strength slider. */
  opacity: number;
  /** "New" badge (metal fill, dark text): its own metal opacity. */
  newOpacity: number;
  /** "New" badge: its own shader sampling scale. */
  newShaderScale: number;
  /** "New" badge: clean white core under the label (transitions.dev
   *  get-pro-button mechanism, inverted — white in the middle, metal at the
   *  rim). `core` = radius of the solid centre (% of the 46% ellipse),
   *  `coreBlur` = width of the ramp to transparent, `coreStrength` = opacity. */
  newCore: number;
  newCoreBlur: number;
  newCoreStrength: number;
  /** Ellipse radius as % of the badge box (100 = edge to edge). */
  newCoreSize: number;
  /** Top→bottom white gradient strength (0..1). Figma: 0.6. */
  newGradient: number;
  /** Inner white glow strength (0..1) — scales the two 8.33px inset glows. */
  newGlow: number;
  /** Bare metal text ("Plan Pro"): glow gain on top of strength × opacity. */
  textGlow: number;
}
export const BADGE_DEFAULTS: Readonly<BadgeConfig> = Object.freeze({
  shaderScale: 2.8, opacity: 0.62,
  newOpacity: 0.8, newShaderScale: 1.6,
  // White core under the label, metal at the rim.
  newCore: 46, newCoreBlur: 100, newCoreStrength: 0.94, newCoreSize: 49,
  newGradient: 0, newGlow: 0.41,
  textGlow: 2.5,
});
export const BADGE: BadgeConfig = { ...BADGE_DEFAULTS };

type Listener = () => void;
const listeners = new Set<Listener>();
export function setBadgeConfig(patch: Partial<BadgeConfig>): void {
  Object.assign(BADGE, patch);
  for (const fn of listeners) fn();
}
export function subscribeBadge(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
