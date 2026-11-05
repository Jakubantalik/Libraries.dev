// The shipped tunings: seven types, each designed at 200px. Count knobs scale
// with size — a 48px orb carries fewer, relatively bolder marks — and with
// the `dots` prop; `speed` multiplies both clocks; `driveGain` sets how far
// a voice speeds the voice clock. Resolved once per mount.

import type { TypeFrame, TypeOpts } from './engine/types';
import { TYPE_FRAMES, type VoiceOrbType } from './engine/registry';
import type { LeanAmounts } from './engine/lean';

export interface Preset {
  /** Orb seconds per real second, on both clocks. */
  speed: number;
  /** The voice clock runs at 1 + driveGain × level. */
  driveGain: number;
  /** Input gain tuned for the type, under the `sensitivity` prop. Default 1. */
  gain?: number;
  /** The type's rise time, when the `attack` prop is not set. Default 0.06 s. */
  attack?: number;
  /** The type's mark size, when the `dotSize` prop is not set. Default 1. */
  dotSize?: number;
  /** How much a voice speeds the type up, when the `voiceSpeed` prop is not set. Default 1. */
  voiceSpeed?: number;
  /** The type's own lean, where the `direction…` props are not set. Default LEAN_DEFAULTS. */
  lean?: Partial<LeanAmounts>;
  /** CSS px the lean stops short of the screen's edge, when `directionMargin` is not set. Default 32. */
  margin?: number;
  /** Knobs at the 200px design. */
  opts: TypeOpts;
  /** Count knobs → the exponent each takes of the size × density scale. */
  counts: Record<string, number>;
}

export const PRESETS: Record<VoiceOrbType, Preset> = {
  orbit: {
    speed: 1.05,
    driveGain: 0.12,
    opts: { orbitN: 12, particles: 6 },
    counts: {}
  },
  sash: {
    speed: 1.5,
    driveGain: 0.8,
    gain: 1.1,
    opts: { lanes: 10, segs: 56, ghostN: 60 },
    counts: { segs: 0.45, ghostN: 0.8 }
  },
  signal: {
    speed: 1.6,
    driveGain: 2,
    opts: { circles: 8, segs: 96 },
    counts: { circles: 0.5, segs: 0.5 }
  },
  swell: {
    speed: 1.4,
    driveGain: 2.4,
    opts: { dotN: 900 },
    counts: { dotN: 1 }
  },
  pixel: {
    speed: 1.2,
    driveGain: 1.6,
    attack: 0.16,
    dotSize: 0.55,
    opts: { cells: 17 },
    counts: { cells: 0.5 }
  },
  'aura-mono': {
    speed: 1.2,
    // a voice spins it up a long way: waiting it drifts, speaking it turns
    // and morphs quickly
    driveGain: 4,
    // leans like the aura, the near side drawn out, but drifts further and
    // meets the edge with no lens
    lean: { move: 0.55, pull: 0.36, deform: 0.28, squash: 0, bounce: 0.92, lens: 0, stretch: 0, split: 0, blur: 1.24 },
    opts: { segs: 180 },
    counts: { segs: 0.5 }
  },
  aura: {
    speed: 1.6,
    driveGain: 2,
    voiceSpeed: 0.9,
    // barely drifts toward the voice: it leans, its near side drawn out and
    // bulging a touch; light meets the edge through a soft lens rather than
    // squashing on it
    lean: { move: 0.21, pull: 0.36, deform: 0.28, squash: 0, bounce: 0.92, lens: 0.49, stretch: 1.04, split: 1.01, blur: 1.24 },
    opts: { rings: 6, segs: 140 },
    counts: { segs: 0.5 }
  }
};

export interface Resolved {
  frame: TypeFrame;
  speed: number;
  driveGain: number;
  gain: number;
  opts: TypeOpts;
}

/** Resolve a type at a size, with the density and dot-size multipliers. */
export function resolvePreset(type: VoiceOrbType, size: number, dots = 1, dotSize = 1): Resolved {
  const key = type in PRESETS ? type : 'orbit';
  const preset = PRESETS[key];
  const scale = Math.min(1.4, Math.max(0.2, size / 200)) * Math.max(0.1, dots);
  const opts: TypeOpts = { ...preset.opts };
  for (const [knob, exp] of Object.entries(preset.counts)) {
    const v = opts[knob];
    if (v != null) opts[knob] = Math.max(1, Math.round(v * scale ** exp));
  }
  if (dotSize !== 1) opts.rMul = Math.max(0.1, dotSize);
  return { frame: TYPE_FRAMES[key], speed: preset.speed, driveGain: preset.driveGain, gain: preset.gain ?? 1, opts };
}
