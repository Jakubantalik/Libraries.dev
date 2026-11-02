// VoiceRing — the aura type of the voice orbs, on its own: signal's rings
// drawn in light, a blooming spectrum with chromatic fringes that bends with
// the voice and leans toward where it comes from.
//
// The React package (npm `voice-ring`). The SwiftUI port, VoiceRingKit,
// draws the same engine (ports/ios/VoiceRingKit).

import type { VoiceOrbProps } from './types';
import { VoiceOrb } from './VoiceOrb';

export type VoiceRingProps = Omit<VoiceOrbProps, 'type' | 'frame'>;

/** A voice-reactive ring of light: VoiceOrb with `type="aura"` fixed. */
export function VoiceRing(props: VoiceRingProps) {
  return <VoiceOrb {...props} type="aura" />;
}
