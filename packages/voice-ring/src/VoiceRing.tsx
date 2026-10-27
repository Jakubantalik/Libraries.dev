// VoiceRing — the aura type of the voice orbs, on its own: signal's rings
// drawn in light, a blooming spectrum with chromatic fringes that bends with
// the voice and leans toward where it comes from.
//
// The shipped port is SwiftUI (ports/ios/VoiceRingKit). This web component
// renders the same engine for the site's preview and the Studio; the React
// package itself is not published yet.

import type { VoiceOrbProps } from './types';
import { VoiceOrb } from './VoiceOrb';

export type VoiceRingProps = Omit<VoiceOrbProps, 'type' | 'frame'>;

/** A voice-reactive ring of light: VoiceOrb with `type="aura"` fixed. */
export function VoiceRing(props: VoiceRingProps) {
  return <VoiceOrb {...props} type="aura" />;
}
