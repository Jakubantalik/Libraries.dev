import { useCallback, useRef } from "react";
import type { VoiceBeamMotion, VoiceBeamType } from "voice-glow";

/* The Voice processing state — Libraries Pro. Once the voice is captured
   and something is working on it (transcribing, thinking), the glow's
   lobes gather into one compact beam that travels its range left to right
   and back, eased at each end and looped — border-beam's traveling line,
   confined to the voice glow. It morphs in and out smoothly, so listening →
   processing → idle needs no choreography. It drives the free package's
   `motion` prop:

     const processing = useVoiceProcessing(thinking, { type: "mobile" });
     <VoiceBeam type="mobile" stream={mic.stream} motion={processing}>…

   The same code ships to Pro users through the Pro skill (libraries-pro
   content/libraries/voice-glow), and the SwiftUI port has it as
   VoiceGlowProcessing. */

export interface ProcessingTuning {
  /* Seconds per pass (left to right, or back). */
  duration: number;
  /* How lit the glow is held while processing, 0–1. */
  level: number;
  /* How far the beam travels to each side, × half the lobe ring. */
  travel: number;
  /* How it eases into each turn: 1 constant speed, 2 smooth, higher dwells. */
  curve: number;
  /* How much the beam rides the element's corner arcs, 0–1. */
  cornerFollow: number;
  /* Seconds the morph in and out takes. */
  ease: number;
}

/* The tuning per host type (what voice-glow 0.2 shipped as props). */
export const PROCESSING_DEFAULTS: Record<VoiceBeamType, ProcessingTuning> = {
  default: { duration: 1.1, level: 0.55, travel: 1.55, curve: 2.1, cornerFollow: 0.45, ease: 0.6 },
  pill: { duration: 1.1, level: 0.55, travel: 2, curve: 2.1, cornerFollow: 0, ease: 0.6 },
  mobile: { duration: 1.05, level: 0.35, travel: 1, curve: 2.1, cornerFollow: 0.4, ease: 0.6 },
};

function follow(prev: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > prev ? attack : release;
  return prev + (target - prev) * (1 - Math.exp(-dt / Math.max(0.001, tau)));
}

/* A processing driver outside React: call the returned function every
   frame (the `motion` getter does) with whether processing is on. */
export function createVoiceProcessing() {
  let blend = 0;
  let clock = 0;
  let last: number | null = null;
  return (active: boolean, tuning: ProcessingTuning, reducedMotion = false, now = performance.now()): VoiceBeamMotion => {
    const dt = last === null ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const duration = Math.max(0.05, tuning.duration);
    // A fresh start begins the pass at the centre, heading right, so the
    // beam grows out of the voice glow instead of jumping to one end.
    if (active && blend < 0.001 && clock === 0) clock = duration / 2;
    const ease = Math.max(0.05, tuning.ease);
    blend = follow(blend, active ? 1 : 0, dt, ease * 0.9, ease * 0.8);
    if (active) clock += dt;
    else if (blend < 0.001) clock = 0;

    // The morph runs on an eased copy of the blend — slow to start, slow to
    // settle — so the gather, the narrowing and the travel read as one.
    const morph = blend * blend * (3 - 2 * blend);
    const passes = clock / duration;
    const index = Math.floor(passes);
    const u = passes - index;
    const k = Math.max(1, tuning.curve);
    const eased = u < 0.5 ? 0.5 * Math.pow(2 * u, k) : 1 - 0.5 * Math.pow(2 - 2 * u, k);
    const pass = reducedMotion ? 0 : index % 2 === 0 ? 2 * eased - 1 : 1 - 2 * eased;
    return {
      gather: morph,
      offset: morph * tuning.travel * pass,
      // A little wider mid-pass than at the turns.
      stretch: 1 - pass * pass,
      heldLevel: tuning.level,
      cornerFollow: tuning.cornerFollow,
    };
  };
}

/* The hook: a stable `motion` getter for <VoiceBeam>, sampled every frame,
   so turning processing on or off never re-renders the beam. */
export function useVoiceProcessing(
  active: boolean,
  tuning: Partial<ProcessingTuning> & { type?: VoiceBeamType; reducedMotion?: boolean } = {}
): () => VoiceBeamMotion {
  const driver = useRef(createVoiceProcessing());
  const activeRef = useRef(active);
  activeRef.current = active;
  const { type = "default", reducedMotion = false, ...overrides } = tuning;
  const tuningRef = useRef<ProcessingTuning>(PROCESSING_DEFAULTS[type]);
  tuningRef.current = { ...PROCESSING_DEFAULTS[type], ...overrides };
  const reducedRef = useRef(reducedMotion);
  reducedRef.current = reducedMotion;
  return useCallback(() => driver.current(activeRef.current, tuningRef.current, reducedRef.current), []);
}
