// Engine-level contracts shared by every orb type.

import type { OrbFrame } from './core';

export type { Dot, Stroke, OrbFrame } from './core';

/**
 * What the voice is doing at one instant, already gated, saturated and
 * smoothed — every value can go straight into geometry. The follower in
 * `voice.ts` builds it from a microphone, any AnalyserNode or a plain
 * level; a custom renderer can just as well build it by hand.
 */
export interface VoiceInput {
  /** Loudness envelope, 0–1, with the idle breathing folded in. */
  level: number;
  /** Low / mid / high envelopes, 0–1: chest, vowels, sibilance. */
  bands: [number, number, number];
  /** `level` on a slow envelope (~0.35 s up, ~0.9 s down): for shape and
   *  amplitude, which read as mechanical if they pump with every syllable. */
  soft: number;
  /** `bands` on the same slow envelope. */
  softBands: [number, number, number];
  /** Log-spaced spectrum envelope, low → high, 0–1 per slot. */
  spectrum: ArrayLike<number>;
  /**
   * The voice clock, in seconds: it runs at 1 + gain × level, so motion
   * driven by it speeds up while someone speaks and settles after — with
   * no jump, since it is integrated rather than multiplied.
   */
  drive: number;
  /**
   * How far into the processing state, 0–1, eased: the orb is working on
   * what it heard. Sources are ignored meanwhile; each type answers with
   * its own working motion (a contraction, a sweep, a beat).
   */
  processing: number;
  /**
   * Processing's turn, in radians, for motion that goes round while the orb
   * works (a spinning spectrum, a sweeping highlight). It is integrated, so
   * it speeds up and slows down with the eased blend instead of jumping,
   * and once processing ends it settles back to the nearest whole turn.
   */
  spin: number;
  /**
   * Where the voice comes from, −1 left … 1 right, smoothed: it follows the
   * source while a voice is heard and drifts back to centre in silence.
   */
  pan: number;
}

/** Type knobs. Numbers only, so a preset survives JSON and native ports. */
export interface TypeOpts {
  [key: string]: number | undefined;
}

/**
 * Geometry for one instant: pure math over (size, t, voice, opts), no
 * rendering surface and no theme. `t` is the ambient clock (spin, sway);
 * `voice.drive` is the clock a voice speeds up.
 */
export type TypeFrame = (size: number, t: number, voice: VoiceInput, opts: TypeOpts) => OrbFrame;

/** A voice at rest — what a frame sees before any input arrives. */
export const SILENCE: VoiceInput = {
  level: 0,
  bands: [0, 0, 0],
  soft: 0,
  softBands: [0, 0, 0],
  spectrum: new Float32Array(16),
  drive: 0,
  processing: 0,
  spin: 0,
  pan: 0
};
