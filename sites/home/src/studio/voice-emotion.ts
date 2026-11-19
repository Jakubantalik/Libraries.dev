import { useEffect, useMemo, useRef, useState } from "react";
import { voicePalettes, parseRgb } from "voice-glow";
import { blendColors, moodColors } from "./voice-mood";
import { EMOTIONS, loadTextMood, scoreText, moodFrom, type TextMoodFile, type TextMoodModel, type VoiceEmotion } from "./voice-text-mood";

/* Voice emotion from the words — Libraries Pro. What is said colours the
   glow: "I love this" turns it green, "this keeps breaking" red, plain
   requests leave its own palette. The web counterpart of SwiftUI Pro's
   TextMoodEstimator, with a tiny word model instead of RoBERTa, so there
   is no download worth noticing (~50 KB, loaded the first time emotion is
   on) and no model runtime.

     const heard = useSpeechTranscript(listening);           // browser speech-to-text
     const emotion = useVoiceEmotion(heard.transcript);      // mood, eased
     <VoiceBeam stream={mic.stream} colors={emotion.colors}>…

   `colors` is undefined while there is no mood, so the glow keeps its own
   palette; pass your palette as `colors` in the options when it is custom.
   Any transcript works — your own speech-to-text, or typed text. */

export type { VoiceEmotion };
export type VoiceEmotionMood = {
  /* −1 negative … +1 positive. */
  valence: number;
  /* 0 calm … 1 excited. */
  arousal: number;
  /* How far the glow has moved into the mood palette, 0–1 (eased). */
  amount: number;
};

export interface VoiceEmotionOptions {
  /* Off: nothing loads, no mood. */
  enabled?: boolean;
  /* Only the latest words are scored, so the newest sentence sets the mood. */
  recentWords?: number;
  /* Seconds to ease into a mood, and back out to the palette. */
  smoothing?: number;
  release?: number;
  /* How strongly a mood takes the glow, 0–1. */
  strength?: number;
  /* The glow's palette (7 lobe colours, hex) the mood blends from;
     default: the colorful palette for `theme`. */
  colors?: string[];
  theme?: "dark" | "light";
}

let modelPromise: Promise<TextMoodModel> | null = null;
/* The model, fetched once per page (a separate chunk of the bundle). */
export function loadVoiceEmotionModel(): Promise<TextMoodModel> {
  modelPromise ??= import("./voice-text-mood.json").then((m) => loadTextMood(m.default as TextMoodFile));
  return modelPromise;
}

export function useVoiceEmotion(transcript: string | null | undefined, options: VoiceEmotionOptions = {}) {
  const { enabled = true, recentWords = 16, smoothing = 0.3, release = 0.8, strength = 1, colors, theme = "dark" } = options;
  const [model, setModel] = useState<TextMoodModel | null>(null);
  useEffect(() => {
    if (!enabled || model) return;
    let live = true;
    loadVoiceEmotionModel().then(
      (m) => live && setModel(m),
      (e) => console.warn("voice emotion: the model did not load", e),
    );
    return () => {
      live = false;
    };
  }, [enabled, model]);

  /* The read of the current words (null: nothing said). */
  const estimate = useMemo(() => {
    if (!enabled || !model || !transcript) return null;
    const words = transcript.split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    const probs = scoreText(model, words.slice(-recentWords).join(" "));
    const mood = moodFrom(probs);
    let top = 0;
    for (let k = 1; k < EMOTIONS.length; k++) if (probs[k] > probs[top]) top = k;
    return mood && { ...mood, emotion: EMOTIONS[top] as VoiceEmotion };
  }, [enabled, model, transcript, recentWords]);

  /* Ease toward it the way the SwiftUI glow does (VoiceGlowEngine): the hue
     follows once the estimate means it (15% confidence), the amount goes
     into a mood fast and back to the palette a little slower. The rAF loop
     runs only while something still moves, publishing ~30 times a second. */
  const [mood, setMood] = useState<VoiceEmotionMood>({ valence: 0, arousal: 0.3, amount: 0 });
  const live = useRef({ valence: 0, arousal: 0.3, amount: 0 });
  const target = useRef(estimate);
  target.current = estimate;
  const tune = useRef({ smoothing, release, strength });
  tune.current = { smoothing, release, strength };
  useEffect(() => {
    let raf = 0, last = performance.now(), published = 0;
    const step = (now: number) => {
      // Real time, whatever the frame rate (throttled pages run rAF at a
      // few fps); the exponential ease stays stable for any step.
      const dt = Math.min(1, Math.max(0, now - last) / 1000);
      last = now;
      const m = live.current, e = target.current, o = tune.current;
      const a = 1 - Math.exp(-dt / Math.max(0.02, o.smoothing));
      if (e && e.confidence > 0) {
        const pull = a * Math.min(1, e.confidence / 0.15);
        m.valence += (e.valence - m.valence) * pull;
        m.arousal += (e.arousal - m.arousal) * pull;
      }
      const goal = Math.max(0, ((e?.confidence ?? 0) - 0.15) / 0.85) * Math.max(0, Math.min(1, o.strength));
      const tau = Math.max(0.02, goal > m.amount ? o.smoothing : o.release);
      m.amount += (goal - m.amount) * (1 - Math.exp(-dt / tau));
      // Done once the amount has arrived (the last 1% of a fade-out is
      // invisible) and the hue too — unless the glow is back on its palette,
      // where the hue no longer shows.
      const hueSettled = goal === 0 || !e || e.confidence <= 0 || (Math.abs(e.valence - m.valence) < 0.002 && Math.abs(e.arousal - m.arousal) < 0.002);
      const settled = Math.abs(goal - m.amount) < (goal === 0 ? 0.01 : 0.002) && hueSettled;
      if (settled) m.amount = goal;
      if (settled || now - published > 33) {
        published = now;
        setMood({ valence: m.valence, arousal: m.arousal, amount: m.amount });
      }
      raf = settled ? 0 : requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [estimate]);

  const colorsKey = colors?.join("|") ?? "";
  const tinted = useMemo(() => {
    if (mood.amount < 0.001) return { colors: undefined, tint: undefined };
    const palette = moodColors(mood, theme !== "light");
    const base = colors?.length ? colors : voicePalettes.colorful[theme].map(toHex);
    return { colors: blendColors(base, palette, mood.amount), tint: palette[0] };
  }, [mood, colorsKey, theme]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    /* The mood the glow shows (eased). */
    mood,
    /* The read of the current words: valence, arousal, confidence and the
       most likely emotion; null when nothing is said. */
    estimate,
    /* Lobe colours for VoiceBeam's `colors`; undefined = keep the palette. */
    colors: tinted.colors,
    /* The dots and lines looks: the mood's colour for `tint`, with
       `mood.amount` as `tintAmount`. */
    tint: tinted.tint,
    ready: model !== null,
  };
}

function toHex(color: string): string {
  const t = parseRgb(color);
  return t ? "#" + t.map((v) => v.toString(16).padStart(2, "0")).join("") : color;
}

/* ── Speech to text (the browser's own) ─────────────────────────────── */

export type SpeechState = "off" | "listening" | "unsupported" | "denied" | "error";

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

/* The live transcript of the current utterance from the browser's speech
   recognition (Chrome, Edge, Safari; Chrome and Edge recognise on their
   servers). It clears after `clearAfter` seconds without new words, so a
   new sentence starts fresh — and the mood eases back with it. */
export function useSpeechTranscript(active: boolean, { lang = "en-US", clearAfter = 2.5 } = {}) {
  const [transcript, setTranscript] = useState("");
  const [state, setState] = useState<SpeechState>("off");
  useEffect(() => {
    if (!active) {
      setTranscript("");
      setState("off");
      return;
    }
    const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) {
      setState("unsupported");
      return;
    }
    let stopped = false, rec: Recognition | null = null, from = 0, seen = 0;
    let clearTimer: ReturnType<typeof setTimeout> | undefined, restartTimer: ReturnType<typeof setTimeout> | undefined;
    const start = () => {
      const r = new Ctor();
      rec = r;
      r.continuous = true;
      r.interimResults = true;
      r.lang = lang;
      from = seen = 0;
      r.onresult = (e) => {
        seen = e.results.length;
        let text = "";
        for (let i = from; i < e.results.length; i++) text += e.results[i][0].transcript + " ";
        setTranscript(text.trim().replace(/\s+/g, " "));
        clearTimeout(clearTimer);
        clearTimer = setTimeout(() => {
          from = seen; // the next words start a new utterance
          setTranscript("");
        }, clearAfter * 1000);
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed" || e.error === "audio-capture") {
          stopped = true;
          setState("denied");
        } else if (e.error === "network" || e.error === "language-not-supported") {
          stopped = true;
          setState("error");
        }
      };
      // Browsers end recognition on their own after a while; keep it going.
      r.onend = () => {
        if (!stopped) restartTimer = setTimeout(start, 250);
      };
      try {
        r.start();
        setState("listening");
      } catch {
        stopped = true;
        setState("error");
      }
    };
    start();
    return () => {
      stopped = true;
      clearTimeout(clearTimer);
      clearTimeout(restartTimer);
      rec?.abort();
    };
  }, [active, lang, clearAfter]);
  return { transcript, state };
}
