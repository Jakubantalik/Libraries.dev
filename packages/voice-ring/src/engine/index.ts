// The `voice-orbs/engine` entry point: pure geometry, zero React, zero DOM.
// Import it to drive your own renderer — a Skia canvas in React Native, an
// offscreen canvas in a worker.
//
//   import { TYPE_FRAMES, SILENCE } from 'voice-orbs/engine';
//
//   const { dots, strokes } = TYPE_FRAMES.signal(200, seconds, voice ?? SILENCE, {});
//
// What comes back is final: strokes to draw first (polylines with opacity
// per point), then dots in z-sorted order. Ink convention as thinking-orbs:
// `white` is the paper-theme ink in [0,1]; on a dark substrate a renderer
// mirrors it (`1 - white`) so near marks read bright.

export { TYPE_FRAMES, VOICE_ORB_TYPES, type VoiceOrbType } from './registry';
export { SILENCE, type TypeFrame, type TypeOpts, type VoiceInput } from './types';
export type { Dot, OrbFrame, Stroke } from './types';
export type { FrameLight } from './core';
export { finalizeFrame, makeProj, radiusScale } from './core';
export { paintDots, paintFrame, paintStrokes, type OrbGlow, type OrbTint } from './paint';
export { colorRamp, type OrbColors } from './colors';
export { leanFrame, leanReach, LEAN_DEFAULTS, type LeanAmounts } from './lean';
