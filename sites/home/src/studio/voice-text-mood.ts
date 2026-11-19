/* Tiny text-mood scorer for the Voice glow's emotion (Libraries Pro).

   Scores a transcript with a word + word-pair model (voice-text-mood.json,
   ~50 KB gzipped, trained on GoEmotions; source and training in
   libraries-pro content/libraries/voice-glow/text-mood) and turns the eight
   voice-emotion probabilities into a mood with the same rule as SwiftUI
   Pro's `VoiceEmotion.mood(from:)`. No model runtime: one pass over the
   words. The tokenizer must match the training code exactly (its
   test-parity.ts checks it). */

export const EMOTIONS = ["angry", "disgusted", "fearful", "happy", "neutral", "other", "sad", "surprised"] as const;
export type VoiceEmotion = (typeof EMOTIONS)[number];
export type Mood = { valence: number; arousal: number; confidence: number };

/* build/text-mood.json */
export type TextMoodFile = {
  format: 1;
  labels: string[];
  negators: string[];
  negationSpan: number;
  pairs: boolean;
  scale: number;
  bias: number[];
  features: string;
  weights: string;
};

export type TextMoodModel = {
  index: Map<string, number>;
  weights: Int8Array;
  bias: Float64Array;
  scale: number;
  negators: Set<string>;
  negationSpan: number;
  pairs: boolean;
};

/* Where each emotion sits on the mood plane (valence −1…1, arousal 0…1). */
const PLANE: Record<VoiceEmotion, [number, number]> = {
  angry: [-0.75, 0.85],
  disgusted: [-0.65, 0.5],
  fearful: [-0.6, 0.75],
  happy: [0.8, 0.75],
  neutral: [0, 0.3],
  other: [0, 0.4],
  sad: [-0.7, 0.15],
  surprised: [0.35, 0.85],
};

export function loadTextMood(file: TextMoodFile): TextMoodModel {
  if (file.format !== 1 || file.labels.join() !== EMOTIONS.join()) throw new Error("text-mood: unknown model format");
  const names = file.features.split("\n");
  const bytes = Uint8Array.from(atob(file.weights), (c) => c.charCodeAt(0));
  const weights = new Int8Array(bytes.buffer);
  if (weights.length !== names.length * EMOTIONS.length) throw new Error("text-mood: weights do not match features");
  return {
    index: new Map(names.map((f, i) => [f, i])),
    weights,
    bias: Float64Array.from(file.bias),
    scale: file.scale,
    negators: new Set(file.negators),
    negationSpan: file.negationSpan,
    pairs: file.pairs,
  };
}

/* Lowercase, drop apostrophes ("don't" → "dont"), keep runs of a–z / 0–9. */
export function words(text: string): string[] {
  return text.toLowerCase().replace(/['‘’ʼ]/g, "").match(/[a-z0-9]+/g) ?? [];
}

/* Words (the few after a negator marked "!": "not good" → "!good") plus
   word pairs from the unmarked words. */
export function features(ws: string[], model: Pick<TextMoodModel, "negators" | "negationSpan" | "pairs">): string[] {
  const out: string[] = [];
  let left = 0;
  for (const w of ws) {
    if (model.negators.has(w)) {
      out.push(w);
      left = model.negationSpan;
    } else if (left > 0) {
      out.push("!" + w);
      left--;
    } else {
      out.push(w);
    }
  }
  if (model.pairs) for (let i = 1; i < ws.length; i++) out.push(ws[i - 1] + " " + ws[i]);
  return out;
}

/* Probabilities over EMOTIONS. */
export function scoreText(model: TextMoodModel, text: string): Float64Array {
  const n = EMOTIONS.length;
  const sum = new Int32Array(n);
  for (const f of new Set(features(words(text), model))) {
    const i = model.index.get(f);
    if (i === undefined) continue;
    for (let k = 0; k < n; k++) sum[k] += model.weights[i * n + k];
  }
  const z = new Float64Array(n);
  let max = -Infinity;
  for (let k = 0; k < n; k++) {
    z[k] = model.bias[k] + sum[k] * model.scale;
    if (z[k] > max) max = z[k];
  }
  let total = 0;
  for (let k = 0; k < n; k++) total += z[k] = Math.exp(z[k] - max);
  for (let k = 0; k < n; k++) z[k] /= total;
  return z;
}

/* Probabilities → mood, as VoiceEmotion.mood(from:) in VoiceGlow Pro. */
export function moodFrom(probs: ArrayLike<number>, neutralWeight = 1): Mood | null {
  let total = 0;
  for (let k = 0; k < EMOTIONS.length; k++) total += probs[k];
  if (!(total > 0)) return null;
  let valence = 0, arousal = 0, neutral = 0, emotional = 0, top = -1, best = -1, bestK = 0;
  for (let k = 0; k < EMOTIONS.length; k++) {
    const e = EMOTIONS[k], p = probs[k];
    valence += (p / total) * PLANE[e][0];
    arousal += (p / total) * PLANE[e][1];
    if (p > best) (best = p), (bestK = k);
    if (e === "neutral" || e === "other") neutral += p;
    else {
      emotional += p;
      if (p > top) top = p;
    }
  }
  neutral /= total;
  const topShare = top / total / Math.max(1e-6, 1 - neutral);
  const mostLikely = EMOTIONS[bestK];
  const isNeutral = mostLikely === "neutral" || mostLikely === "other";
  const confidence = isNeutral ? 0 : Math.max(0, Math.min(1, (1 - neutral * neutralWeight) * 1.6 - 0.3)) * (0.5 + 0.5 * topShare);
  if (top / total > 0.05) {
    valence = arousal = 0;
    for (let k = 0; k < EMOTIONS.length; k++) {
      const e = EMOTIONS[k];
      if (e === "neutral" || e === "other") continue;
      valence += (probs[k] / emotional) * PLANE[e][0];
      arousal += (probs[k] / emotional) * PLANE[e][1];
    }
  }
  return { valence, arousal, confidence };
}

/* The mood of what was said, from the latest `recentWords` words (as
   TextMoodEstimator does, so the newest sentence sets the mood). */
export function textMood(model: TextMoodModel, transcript: string, recentWords = 16): Mood | null {
  const ws = transcript.split(/\s+/).filter(Boolean);
  if (!ws.length) return null;
  return moodFrom(scoreText(model, ws.slice(-recentWords).join(" ")));
}
