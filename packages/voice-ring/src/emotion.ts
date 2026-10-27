// Emotion: a colour that washes through the orb when the voice carries a
// feeling — green for positive, red for negative, blue for calm. Detecting
// it is the host's job (a sentiment or prosody model); the orb only shows
// it, easing the colour in, crossfading between feelings and letting it
// fade out, so it never snaps.

import type { OrbGlow, OrbTint } from './engine/paint';

export type VoiceOrbEmotion = 'positive' | 'negative' | 'calm';

/** Soft, slightly desaturated hues that sit well beside gray ink. */
export const EMOTION_COLORS: Record<VoiceOrbEmotion, OrbTint> = {
  positive: { r: 92, g: 224, b: 150 },
  negative: { r: 255, g: 104, b: 104 },
  calm: { r: 104, g: 162, b: 255 }
};

/** Colourful mode's accents: the same three hues, by colour. */
export type VoiceOrbAccent = 'green' | 'red' | 'blue';

export const ACCENT_COLORS: Record<VoiceOrbAccent, OrbTint> = {
  green: EMOTION_COLORS.positive,
  red: EMOTION_COLORS.negative,
  blue: EMOTION_COLORS.calm
};

const IN = 0.7;
const OUT = 1.1;
const SHIFT = 0.6;

/** One orb's eased glow: how present it is, and which colour it has reached. */
export class GlowFollower {
  private glow: OrbGlow = { r: 0, g: 0, b: 0, amount: 0, t: 0, size: 0 };

  /** Advance toward `target` (null: fade out). `still` jumps straight there. */
  step(dt: number, target: OrbTint | null, t: number, size: number, still: boolean): OrbGlow {
    const g = this.glow;
    const ease = (tau: number) => (still ? 1 : 1 - Math.exp(-dt / tau));
    const goal = target ? 1 : 0;
    g.amount += (goal - g.amount) * ease(goal > g.amount ? IN : OUT);
    if (target) {
      // from nothing the new colour simply appears; otherwise it crossfades
      const k = g.amount < 0.03 ? 1 : ease(SHIFT);
      g.r += (target.r - g.r) * k;
      g.g += (target.g - g.g) * k;
      g.b += (target.b - g.b) * k;
    }
    g.t = t;
    g.size = size;
    return g;
  }
}
