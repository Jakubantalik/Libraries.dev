// Type key → geometry builder: the portable surface. A native port draws
// exactly what these return, so its output matches the web's by
// construction rather than by re-implementation.

import type { TypeFrame } from './types';
import { frameAura } from './aura';
import { framePixel } from './pixel';
import { frameOrbit } from './orbit';
import { frameSash } from './sash';
import { frameSignal } from './signal';
import { frameSwell } from './swell';

/**
 * The six orb types:
 * - `orbit`   — particles on tilted orbits in perspective; a voice zooms it toward you
 * - `sash`    — an undulating band of dotted lanes; a voice deepens the wave
 * - `signal`  — a wireframe of great circles; a voice deforms it like a skin
 * - `swell`   — a halftone sphere of drifting clouds; a voice bulges its surface
 * - `pixel`   — a ball of square pixels, halftone shaded; a voice bulges it and lights it in rings
 * - `aura`    — signal's rings drawn in light: a blooming spectrum; a voice bends and brightens it
 */
export type VoiceOrbType = 'orbit' | 'sash' | 'signal' | 'swell' | 'pixel' | 'aura';

export const VOICE_ORB_TYPES: readonly VoiceOrbType[] = ['orbit', 'sash', 'signal', 'swell', 'pixel', 'aura'];

export const TYPE_FRAMES: Record<VoiceOrbType, TypeFrame> = {
  orbit: frameOrbit,
  sash: frameSash,
  signal: frameSignal,
  swell: frameSwell,
  pixel: framePixel,
  aura: frameAura
};
