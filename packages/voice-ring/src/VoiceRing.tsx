// VoiceRing — the aura types of the voice orbs, on their own. `ring`: signal's
// rings drawn in light, a blooming spectrum with chromatic fringes that bends
// with the voice and leans toward where it comes from. `mono`: the same rings
// as two loops of grey tube, which a voice opens into a turning globe.
//
// The React package (npm `voice-ring`). The SwiftUI port, VoiceRingKit,
// draws the same engine (ports/ios/VoiceRingKit).

import type { VoiceOrbProps } from './types';
import { VoiceOrb } from './VoiceOrb';

export type VoiceRingType = 'ring' | 'mono';

export type VoiceRingProps = Omit<VoiceOrbProps, 'type' | 'frame'> & {
  /**
   * How the ring is drawn: `ring`, a glassy ribbon with a spectrum running
   * round it, or `mono`, two loops of grey tube that a voice opens into a
   * turning globe, an emotion colouring the tube. @default 'ring'
   */
  type?: VoiceRingType;
};

const ORB_TYPE = { ring: 'aura', mono: 'aura-mono' } as const;

/** A voice-reactive ring: VoiceOrb with its type fixed to one of the two aura types. */
export function VoiceRing({ type = 'ring', ...props }: VoiceRingProps) {
  return <VoiceOrb {...props} type={ORB_TYPE[type]} />;
}
