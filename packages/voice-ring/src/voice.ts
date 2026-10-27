// The voice follower: turns raw readings — an AnalyserNode on a stream, or
// a plain 0–1 level — into the shaped, smoothed VoiceInput every orb type
// draws from. One per orb; it keeps its own clock, so a paused or
// offscreen orb resumes in phase rather than jumping.
//
// The shaping is voice-glow's: gain, noise gate, soft saturation, then a
// one-pole attack/release envelope. On top of it sit what an orb needs and
// a glow does not: a 16-slot log spectrum (with an adaptive noise floor, so
// a humming fan does not read as a voice), the slow soft envelopes, the
// processing blend and the voice clock that motion speeds up on.

import type { VoiceInput } from './engine/types';

export const SPECTRUM_N = 16;

// Processing's turn, radians per orb second, and the fastest it settles home.
// 2.1 is the pace the aura's spin used to reach once processing had fully
// set in (about a turn every two seconds at its tuned speed) — now reached
// by winding up to it rather than by jumping.
const SPIN = 2.1;
const SETTLE_MAX = 0.3;
// The lean toward a voice eases in and out on a critically damped spring:
// its stiffness to follow a side (settled in about two seconds, slow enough
// to read as a deliberate turn) and to drift home (about three).
const PAN_IN = 2.5;
const PAN_OUT = 1.6;

// Gain before `sensitivity`: a laptop microphone at conversational distance
// gives an RMS of roughly 0.03–0.2, which this lifts into the 0.15–1 range
// the shaping curve expects.
const BASE_GAIN = 5;
const BAND_GAIN = 2.2;
// Voice bands in Hz: fundamentals and chest, vowels and presence, sibilance.
const BANDS: ReadonlyArray<readonly [number, number]> = [
  [80, 300],
  [300, 2000],
  [2000, 6000]
];
const SPEC_LO = 90;
const SPEC_HI = 7000;
const TAU = Math.PI * 2;
const SOFT_ATTACK = 0.35;
const SOFT_RELEASE = 0.9;

export interface FollowerConfig {
  sensitivity: number;
  threshold: number;
  attack: number;
  release: number;
  idle: number;
  /** The voice clock runs at 1 + driveGain × level. */
  driveGain: number;
  /** Waiting pace: with no voice and no work the clocks run at this share of the tuned speed. */
  calm: number;
  /** Orb seconds per real second: the type's tuned speed × the `speed` prop. */
  rate: number;
  /** Working on what was heard: sources are ignored and the processing motion eases in. */
  processing: boolean;
  /** Where the source says the voice is, −1 left … 1 right (0 when unknown). */
  direction: number;
}

/** One frame of unshaped readings, written in place. */
interface Raw {
  level: number;
  bands: [number, number, number];
  spectrum: Float32Array;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Noise gate then soft saturation, so a shout rounds off instead of clipping. */
function shape(raw: number, threshold: number): number {
  if (raw <= threshold) return 0;
  const t = (raw - threshold) / Math.max(0.001, 1 - threshold);
  return clamp01((1 - Math.exp(-3 * t)) / (1 - Math.exp(-3)));
}

/** One-pole follower: fast up (attack), slow down (release). */
function follow(prev: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > prev ? attack : release;
  return prev + (target - prev) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
}

export class VoiceFollower {
  /** Real seconds this orb has run: onsets and breathing keep time on it. */
  clock = 0;
  /** The ambient clock (spin, sway) in orb seconds. */
  t = 0;
  /** The voice clock, in orb seconds. */
  drive = 0;
  private level = 0;
  private bands: [number, number, number] = [0, 0, 0];
  private spectrum = new Float32Array(SPECTRUM_N);
  private floor = new Float32Array(SPECTRUM_N + 3).fill(1);
  /** The voice alone on the soft envelope — what wakes the clocks. */
  private heard = 0;
  private proc = 0;
  private spin = 0;
  private pan = 0;
  private panVel = 0;
  private raw: Raw = { level: 0, bands: [0, 0, 0], spectrum: new Float32Array(SPECTRUM_N) };
  private timeBuf: Float32Array<ArrayBuffer> | null = null;
  private freqBuf: Uint8Array<ArrayBuffer> | null = null;
  private out: VoiceInput = {
    level: 0,
    bands: [0, 0, 0],
    soft: 0,
    softBands: [0, 0, 0],
    spectrum: this.spectrum,
    drive: 0,
    processing: 0,
    spin: 0,
    pan: 0
  };

  /** Read an analyser: RMS loudness, three voice bands and the spectrum. */
  readAnalyser(analyser: AnalyserNode, sensitivity: number, dt: number): void {
    if (!this.timeBuf || this.timeBuf.length !== analyser.fftSize) this.timeBuf = new Float32Array(analyser.fftSize);
    if (!this.freqBuf || this.freqBuf.length !== analyser.frequencyBinCount) {
      this.freqBuf = new Uint8Array(analyser.frequencyBinCount);
    }
    const time = this.timeBuf;
    const freq = this.freqBuf;
    analyser.getFloatTimeDomainData(time);
    let sum = 0;
    for (let i = 0; i < time.length; i++) sum += time[i] * time[i];
    this.raw.level = Math.sqrt(sum / time.length) * BASE_GAIN * sensitivity;

    analyser.getByteFrequencyData(freq);
    const binHz = analyser.context.sampleRate / analyser.fftSize;
    const avg = (lo: number, hi: number) => {
      const from = Math.max(0, Math.floor(lo / binHz));
      const to = Math.max(from, Math.min(freq.length - 1, Math.ceil(hi / binHz)));
      let acc = 0;
      for (let i = from; i <= to; i++) acc += freq[i];
      return acc / (to - from + 1) / 255;
    };
    // Every reading sits on an adaptive floor: it drops to the quietest
    // value at once and creeps up over ~8 s, so steady room noise is
    // subtracted while a voice — which comes and goes — is not.
    const floored = (slot: number, v: number) => {
      const f = this.floor[slot];
      this.floor[slot] = v < f ? v : f + (v - f) * (1 - Math.exp(-dt / 8));
      return Math.max(0, v - this.floor[slot]) / Math.max(0.05, 1 - this.floor[slot]);
    };
    for (let b = 0; b < 3; b++) {
      this.raw.bands[b] = floored(b, avg(BANDS[b][0], BANDS[b][1])) * BAND_GAIN * sensitivity;
    }
    const ratio = SPEC_HI / SPEC_LO;
    for (let k = 0; k < SPECTRUM_N; k++) {
      const lo = SPEC_LO * ratio ** (k / SPECTRUM_N);
      const hi = SPEC_LO * ratio ** ((k + 1) / SPECTRUM_N);
      this.raw.spectrum[k] = floored(3 + k, avg(lo, hi)) * BAND_GAIN * sensitivity;
    }
  }

  /**
   * Read a plain level. There is no spectrum behind it, so the bands and
   * slots are given a little independent life — slow, out-of-phase drifts
   * scaled by the level, with two formant-like humps wandering the
   * spectrum — so a level-driven orb still moves like a voice.
   */
  readLevel(level: number, sensitivity: number): void {
    const raw = clamp01(level) * sensitivity;
    const t = this.clock;
    this.raw.level = raw;
    this.raw.bands[0] = raw;
    this.raw.bands[1] = raw * (0.72 + 0.28 * Math.sin(t * 2.3));
    this.raw.bands[2] = raw * (0.6 + 0.4 * Math.sin(t * 3.7 + 2));
    const c1 = 0.28 + 0.1 * Math.sin(t * 2.3) + 0.05 * Math.sin(t * 5.1);
    const c2 = 0.64 + 0.1 * Math.sin(t * 1.7 + 1);
    for (let k = 0; k < SPECTRUM_N; k++) {
      const f = k / (SPECTRUM_N - 1);
      const hump = Math.exp(-((f - c1) ** 2) / 0.012) + 0.6 * Math.exp(-((f - c2) ** 2) / 0.008);
      this.raw.spectrum[k] = raw * (0.25 + 0.75 * hump) * (1 - 0.4 * f);
    }
  }

  /** Nothing to read: let every envelope settle. */
  readSilence(): void {
    this.raw.level = 0;
    this.raw.bands.fill(0);
    this.raw.spectrum.fill(0);
  }

  /** Advance by `dt` real seconds. `still` (reduced motion) holds the clocks. */
  step(dt: number, cfg: FollowerConfig, still: boolean): VoiceInput {
    const { threshold, attack, release, rate } = cfg;
    // processing eases in over ~1 s and out a little slower
    const p = (this.proc = follow(this.proc, cfg.processing ? 1 : 0, dt, 0.35, 0.5));
    // How awake the orb is: a voice or work brings the clocks up to speed;
    // waiting, they idle at `calm`. Read off the soft envelope, so the pace
    // eases between the two instead of stepping.
    const pace = cfg.calm + (1 - cfg.calm) * Math.min(1, Math.max(this.heard * 2.5, p));
    if (!still) {
      this.clock += dt;
      this.t += dt * rate * pace * (1 + 0.5 * p);
    }
    const target = shape(this.raw.level, threshold);
    this.level = follow(this.level, target, dt, attack, release);
    this.heard = follow(this.heard, this.level, dt, SOFT_ATTACK, SOFT_RELEASE);
    for (let b = 0; b < 3; b++) {
      this.bands[b] = follow(this.bands[b], shape(this.raw.bands[b], threshold * 0.6), dt, attack, release * 1.15);
    }
    for (let k = 0; k < SPECTRUM_N; k++) {
      this.spectrum[k] = follow(this.spectrum[k], shape(this.raw.spectrum[k], threshold * 0.6), dt, attack, release);
    }

    const now = this.clock;

    // Idle breathing folded under the voice, so silence never looks dead —
    // slow, and gone while processing, which has its own motion.
    const breathe = still ? 0.5 : 0.5 + 0.5 * Math.sin((TAU * now) / 6);
    const lift = cfg.idle * breathe * (1 - p);
    const out = this.out;
    out.level = this.level + (1 - this.level) * lift;
    for (let b = 0; b < 3; b++) out.bands[b] = this.bands[b] + (1 - this.bands[b]) * lift * 0.6;
    // The soft envelopes: the same voice through a slow, symmetric-ish
    // follower — for shape and amplitude, which look mechanical if they
    // pump with every syllable. Fast values stay for what should flicker.
    out.soft = follow(out.soft, out.level, dt, SOFT_ATTACK, SOFT_RELEASE);
    for (let b = 0; b < 3; b++) out.softBands[b] = follow(out.softBands[b], out.bands[b], dt, SOFT_ATTACK, SOFT_RELEASE);
    if (!still) this.drive += dt * rate * (pace + cfg.driveGain * this.level + 1.3 * p);
    out.drive = this.drive;
    out.processing = p;
    if (!still) {
      // Processing turns at SPIN radians per orb second, scaled by the eased
      // blend, so a spin winds up and runs down instead of jumping. Out of
      // processing, it coasts on — forward only, gently, capped — to the
      // next whole turn, so a spectrum comes to rest where it started
      // without ever winding back.
      const home = Math.ceil(this.spin / TAU - 1e-6) * TAU;
      const settle = Math.min(SETTLE_MAX, (home - this.spin) * 0.6);
      this.spin += dt * (SPIN * rate * p + settle * (1 - p));
    }
    out.spin = this.spin;
    // The orb leans toward the voice only while it hears one: the pan
    // follows the source as a voice rises and drifts home slowly after, so
    // a pause mid-sentence does not snap it back to centre. A critically
    // damped spring carries it, so it eases in and out — sets off gently,
    // speeds up, settles without overshooting.
    const raw = Math.max(-1, Math.min(1, cfg.direction || 0));
    const goal = this.heard > 0.06 && !cfg.processing ? raw : 0;
    const w = Math.abs(goal) > Math.abs(this.pan) ? PAN_IN : PAN_OUT;
    this.panVel += (w * w * (goal - this.pan) - 2 * w * this.panVel) * dt;
    this.pan += this.panVel * dt;
    out.pan = this.pan;
    return out;
  }
}
