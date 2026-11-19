import * as React from "react";
import { useEffect, useSyncExternalStore } from "react";
import * as VoiceGlow from "voice-glow";
import type { VoiceLook } from "voice-glow";
import { apiBase } from "./agent";

/* Libraries Pro code, loaded at runtime.

   The Pro parts of the Voice library (voice-glow's mosaic, dots and lines
   looks, and the emotion model with its hook) are not in this repository or
   in the site's bundle. The Studio fetches them from the API, which checks
   the visitor's Pro entitlement on every request (GET /runtime/<name>, the
   session cookie), and imports the module from a blob URL. On a dev server
   they come from a local libraries-pro checkout (vite.config.ts,
   /__pro/<name>.js).

   The module brings no React or voice-glow of its own: it uses the page's,
   handed over on globalThis.__librariesProDeps before the import. */

/* The shapes the module exports — the contract, not the code. */
export type MoodLabel = "positive" | "negative" | "calm";
export interface VoiceEmotionMood {
  valence: number;
  arousal: number;
  amount: number;
}
export interface VoiceEmotionOptions {
  enabled?: boolean;
  recentWords?: number;
  smoothing?: number;
  release?: number;
  strength?: number;
  colors?: string[];
  theme?: "dark" | "light";
}
export interface VoiceEmotionResult {
  mood: VoiceEmotionMood;
  estimate: { valence: number; arousal: number; confidence: number; emotion: string } | null;
  colors: string[] | undefined;
  tint: string | undefined;
  label: MoodLabel | null;
  ready: boolean;
}
export interface VoiceGlowPro {
  mosaic: VoiceLook;
  dots: VoiceLook;
  lines: VoiceLook;
  useVoiceEmotion: (transcript: string | null | undefined, options?: VoiceEmotionOptions) => VoiceEmotionResult;
}

export const NO_EMOTION: VoiceEmotionResult = {
  mood: { valence: 0, arousal: 0.3, amount: 0 },
  estimate: null,
  colors: undefined,
  tint: undefined,
  label: null,
  ready: false,
};

export type ProLoadState = "idle" | "loading" | "ready" | "denied" | "error";

/* What a failed load means, for the line under the control that asked. */
export const PRO_LOAD_NOTE: Record<ProLoadState, string> = {
  idle: "",
  loading: "Loading from your Pro account…",
  ready: "",
  denied: "These load with a Libraries Pro account. Sign in again to use them.",
  error: "These did not load. Check your connection and pick it again.",
};

declare global {
  // eslint-disable-next-line no-var
  var __librariesProDeps: Record<string, unknown> | undefined;
}

let loaded: VoiceGlowPro | null = null;
let state: ProLoadState = "idle";
let pending: Promise<VoiceGlowPro> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function runtimeUrl(name: string): string {
  return import.meta.env.DEV ? `/__pro/${name}.js` : `${apiBase()}/runtime/${name}`;
}

/* Fetches and imports voice-glow's Pro module once per page; a failed load
   is forgotten, so the next ask tries again. */
export function loadVoiceGlowPro(): Promise<VoiceGlowPro> {
  if (loaded) return Promise.resolve(loaded);
  if (pending) return pending;
  state = "loading";
  emit();
  pending = (async () => {
    globalThis.__librariesProDeps = { react: React, "voice-glow": VoiceGlow };
    const res = await fetch(runtimeUrl("voice-glow"), { credentials: "include", cache: "no-store" });
    if (!res.ok) throw Object.assign(new Error(`Pro module: HTTP ${res.status}`), { status: res.status });
    const code = await res.text();
    const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
    try {
      return (await import(/* @vite-ignore */ url)) as VoiceGlowPro;
    } finally {
      URL.revokeObjectURL(url);
    }
  })().then(
    (mod) => {
      loaded = mod;
      state = "ready";
      emit();
      return mod;
    },
    (err: { status?: number }) => {
      pending = null;
      state = err && (err.status === 401 || err.status === 403) ? "denied" : "error";
      emit();
      console.warn("Libraries Pro: voice-glow's Pro module did not load", err);
      throw err;
    }
  );
  return pending;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/* The Pro module once it has loaded (null before), and how loading went. */
export function useVoiceGlowPro(): { pro: VoiceGlowPro | null; state: ProLoadState } {
  const pro = useSyncExternalStore(subscribe, () => loaded);
  const s = useSyncExternalStore(subscribe, () => state);
  return { pro, state: s };
}

/* Runs the Pro hook in a component of its own, so the bench calls the same
   hooks whether or not the module has loaded. It reports every change of
   the result to `onChange`, and clears it when it unmounts. */
export function VoiceEmotionProbe({
  pro,
  transcript,
  options,
  onChange,
}: {
  pro: VoiceGlowPro;
  transcript: string;
  options: VoiceEmotionOptions;
  onChange: (r: VoiceEmotionResult) => void;
}) {
  const r = pro.useVoiceEmotion(transcript, options);
  useEffect(() => {
    onChange(r);
    // The hook keeps each part's identity until it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.mood, r.estimate, r.colors, r.tint, r.label, r.ready]);
  useEffect(() => () => onChange(NO_EMOTION), [onChange]);
  return null;
}
