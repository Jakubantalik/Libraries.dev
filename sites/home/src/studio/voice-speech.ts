import { useEffect, useState } from "react";

/* Speech to text, the browser's own: the live words for the Voice bench's
   Emotion › On (Libraries Pro's model reads their mood, pro-runtime.tsx). */

/* What the Studio shows under Emotion › On while it waits for words. */
export const SPEECH_STATUS: Record<string, string> = {
  off: "Speech recognition starts when the microphone is live.",
  listening: "Listening for words…",
  unsupported: "This browser has no speech recognition (try Chrome, Edge or Safari). Type instead with another source.",
  denied: "Speech recognition was refused. Allow the microphone for this page and pick Microphone again.",
  error: "Speech recognition stopped (offline, or the language is not supported).",
};

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
