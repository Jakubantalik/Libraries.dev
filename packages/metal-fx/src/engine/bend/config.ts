/**
 * Live config for the cursor "bend" effect — a local liquid dent.
 *
 * The cursor carries a blob of displacement that rides the ring: moving
 * toward the button's centre dents the edge inward, moving away drags it
 * outward, and on release the bulge springs back. Implemented as an SVG
 * `feDisplacementMap` over the whole MetalFx root (button, ring, glow), with
 * the vector field regenerated each frame into a small canvas.
 *
 * Mutable singleton, read every frame by `useBend`.
 */
export interface BendConfig {
  enabled: boolean;
  /** What deforms. `ring` = the metal canvas only; button content and glow
   *  stay rigid. `all` = the whole MetalFx root. */
  applyTo: 'ring' | 'all';
  /** Global amplitude multiplier on the whole displacement field. */
  strength: number;
  /** Time for the effect to ease in after the cursor arrives, ms. Without
   *  this the directional spring lands the dent in 2–3 frames — a pop. */
  fadeInMs: number;
  /** Time for the effect to ease out after the cursor leaves, ms. */
  fadeOutMs: number;
  /** Low-pass on the field's *target* before the spring sees it, ms. A fast
   *  sweep across the ring flips press→pull and swings the direction vector
   *  within a frame; this keeps the dent from snapping to each new target. */
  smoothMs: number;
  /** How far beyond the element's edge the cursor is still felt, CSS px. */
  reach: number;
  /** Area of the directional bend (gaussian σ), CSS px. */
  blob: number;
  /** Area of the liquid push (gaussian σ), CSS px. Independent of `blob`. */
  liquidBlob: number;
  /** Displacement cap, CSS px. Also sets the filter's `scale`. */
  maxDisp: number;
  /** Displacement px produced per 100 px/s of cursor speed — a transient
   *  kick on fast moves. 0 disables. */
  gain: number;
  /** Position-based press: dent px per px the cursor sits inside the ring's
   *  edge, pushing toward the centre. Holds while the cursor stays. */
  pressGain: number;
  /** Position-based pull: bulge px per px the cursor sits outside the edge
   *  (within `reach`), dragging the ring toward the cursor — the sticky part. */
  pullGain: number;
  /** Extra inward dent (toward element centre) while pressed, px. */
  press: number;
  /** Radial push away from the contact point, px at full pressure. This is
   *  the divergent part of the field — it *stretches* material rather than
   *  sliding it, so the stroke thins under the cursor and bulges around it.
   *  Pressure is 1 with the cursor on the ring, fading to 0 at `reach`. */
  liquid: number;
  /** Distance from the ring (either side) over which liquid pressure fades
   *  to zero, px. Keep this small — a large value lets a cursor sitting
   *  inside the button push the whole ring outward, which reads as a scale. */
  liquidReach: number;
  /** Spring constant for the liquid push. Lower = slower swell. */
  liquidStiffness: number;
  /** Damping for the liquid push. Below 2·√k it overshoots on release. */
  liquidDamping: number;
  /** Spring on the displacement vector — snap back speed. */
  stiffness: number;
  /** Below 2·√(k·m) the surface wobbles after release. */
  damping: number;
  mass: number;
  /** Blob-centre tracking, as a per-frame lerp at 60 Hz (0..1); applied
   *  time-based so 120 Hz pointers don't track twice as hard. Lower = the
   *  blob lags and stretches behind the cursor — stickier. */
  follow: number;
  /** Map resolution multiplier. 1 = one texel per CSS px, 2 = device parity
   *  on a 2× display. Steps in the field are visible below device parity. */
  mapRes: number;
  /** Post-displacement blur, CSS px. `feDisplacementMap` samples the source
   *  nearest-neighbour, which shows as stepping where material is stretched;
   *  a quarter-pixel blur hides it. 0 disables. */
  smooth: number;
}

export const BEND_DEFAULTS: Readonly<BendConfig> = Object.freeze({
  enabled: true,
  applyTo: 'ring',
  strength: 0.74,
  fadeInMs: 200,
  fadeOutMs: 350,
  smoothMs: 140,
  reach: 36,
  blob: 13,
  liquidBlob: 10,
  maxDisp: 9,
  gain: 0.6,
  pressGain: 0.55,
  pullGain: 0.49,
  press: 5,
  liquid: 7.5,
  liquidReach: 8,
  liquidStiffness: 53,
  liquidDamping: 9,
  stiffness: 260,
  damping: 13,
  mass: 1,
  follow: 0.32,
  mapRes: 2,
  smooth: 0.25,
});

export const BEND: BendConfig = { ...BEND_DEFAULTS };

export function setBendConfig(patch: Partial<BendConfig>): void {
  Object.assign(BEND, patch);
}

export function resetBendConfig(): void {
  Object.assign(BEND, BEND_DEFAULTS);
}
