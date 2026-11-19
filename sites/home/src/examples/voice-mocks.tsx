import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { GooLayer, VoiceStartIcon, useGooMerge } from "./beam-mocks";

/* The Voice library's mock hosts, shared by the Studio's Voice bench and
   the Voice detail page: the recording pill and the phone screen (the
   chat input lives in beam-mocks.tsx, shared with the Border beam bench),
   plus the synthetic voice that drives them where there is no microphone.
   Presentational and class-driven; the styling lives in
   assets/examples.css. */

/* Recording pill (Figma 1561:44248): mic, a live mm:ss counter that runs
   while the beam is listening, and the stop button. */
export function RecordingPill({
  running,
  paused,
  resetKey,
  closed = false,
  onClose,
  closeRef,
}: {
  running: boolean;
  paused: boolean;
  resetKey: number;
  /** Recording is off: the stop button becomes the start button. */
  closed?: boolean;
  onClose?: () => void;
  closeRef?: (el: HTMLButtonElement | null) => void;
}) {
  const [seconds, setSeconds] = useState(0);
  const elapsed = useRef(0);
  useEffect(() => {
    elapsed.current = 0;
    setSeconds(0);
  }, [running, resetKey]);
  /* The counter holds while paused and picks up where it left off. */
  useEffect(() => {
    if (!running || paused) return;
    const base = elapsed.current;
    const t0 = performance.now();
    const id = window.setInterval(() => {
      elapsed.current = base + (performance.now() - t0) / 1000;
      setSeconds(Math.floor(elapsed.current));
    }, 250);
    return () => window.clearInterval(id);
  }, [running, paused, resetKey]);
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return (
    <div className="mock-pill" role="img" aria-label="Recording pill UI example with voice beam effect">
      <span className="mock-pill-mic mk-ico mk-ico-mic" />
      <span className="mock-pill-time">{mm}:{ss}</span>
      <button
        type="button"
        className="mock-pill-stop"
        data-closed={closed ? "" : undefined}
        aria-label={closed ? "Start voice" : "Stop"}
        onClick={onClose}
        ref={closeRef}
      >
        {closed && <VoiceStartIcon size={14} />}
      </button>
    </div>
  );
}

/* Words that arrive one by one — each from 3px of blur to crisp. With
   `stagger`, every word waits its turn (the prompt's entrance); without
   it, each word animates the moment it mounts (the live transcript). */
export function BlurWords({ words, stagger, className }: { words: string[]; stagger: boolean; className: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  /* Where each word sat after the previous render, so a word that the
     centring or a line break pushes when a new one lands can slide
     there instead of jumping (FLIP: measure, invert, play). */
  const lastRects = useRef<Map<number, DOMRect>>(new Map());
  useLayoutEffect(() => {
    const p = ref.current;
    if (!p) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const spans = Array.from(p.children) as HTMLElement[];
    const next = new Map<number, DOMRect>();
    spans.forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      next.set(i, rect);
      const prev = lastRects.current.get(i);
      if (!prev || reduce) return;
      /* The phone is scaled by its wrapper, so client deltas are scaled too. */
      const k = el.offsetWidth ? rect.width / el.offsetWidth : 1;
      const dx = (prev.left - rect.left) / k;
      const dy = (prev.top - rect.top) / k;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
      el.style.transition = "none";
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      void el.offsetWidth;
      el.style.transition = "transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "";
    });
    lastRects.current = next;
  }, [words]);
  return (
    <p ref={ref} className={className}>
      {/* The space sits OUTSIDE the word so a word's width never changes
          when the next one lands (a trailing space inside the box would
          flip the wrap and bounce the word between lines). */}
      {words.map((word, i) => (
        <span key={i} className="mock-word" style={stagger ? ({ "--i": i } as CSSProperties) : undefined}>
          {word}
        </span>
      )).flatMap((el, i) => (i < words.length - 1 ? [el, " "] : [el]))}
    </p>
  );
}

/* What the demo "says" — revealed a word at a time while the voice is
   heard, at the prompt's position. */
export const DEMO_TRANSCRIPT = "Set a timer for ten minutes and remind me to water the plants".split(" ");

/* Phone screen (Figma 1561:44294): the prompt above the bottom row of
   Agent (auto), mic and close. Rendered at 402×874 and scaled to fit the
   stage by the wrapper around the beam — the scale sits OUTSIDE the beam
   so the glow layers measure the real screen. */
export function PhoneScreen({
  promptKey,
  transcript,
  closed = false,
  onClose,
  closeRef,
}: {
  promptKey: number;
  transcript: string[];
  /** Voice mode is off: the close button becomes the start button. */
  closed?: boolean;
  onClose?: () => void;
  closeRef?: (el: HTMLButtonElement | null) => void;
}) {
  const speaking = transcript.length > 0;
  const goo = useGooMerge(closed);
  const setClose = useCallback((el: HTMLButtonElement | null) => {
    (goo.close as React.MutableRefObject<HTMLButtonElement | null>).current = el;
    closeRef?.(el);
  }, [closeRef]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mock-phone" role="img" aria-label="Phone voice screen UI example with voice beam effect">
      {/* Two layers at the same spot, cross-blurring: the prompt while
          idle, the transcript while the voice is heard. */}
      <div className="mock-phone-text" data-hidden={speaking ? "" : undefined}>
        <BlurWords key={promptKey} className="mock-phone-prompt" words={["How", "can", "I", "help", "you?"]} stagger />
      </div>
      <div className="mock-phone-text" data-hidden={speaking ? undefined : ""}>
        <BlurWords className="mock-phone-prompt mock-phone-prompt--live" words={transcript} stagger={false} />
      </div>
      <div className="mock-phone-row">
        <div className="mock-phone-agent">
          Agent (auto)
          {/* Masked so the chevron takes a theme colour the flat SVG can't. */}
          <span className="mock-phone-chevron" />
        </div>
        <div className="mock-phone-actions mock-goo-host" ref={goo.host} data-closed={closed ? "" : undefined}>
          <GooLayer id={goo.filterId} blobsRef={goo.blobs} filterRef={goo.filter} frostRef={goo.frost} />
          <div className="mock-phone-btn" data-goo-part="mic" ref={goo.mic as React.RefObject<HTMLDivElement>}>
            <img src="/assets/icons/voice-mic-20.svg" alt="" width={20} height={20} draggable={false} />
          </div>
          <button type="button" className="mock-phone-btn" data-goo-part="close" aria-label={closed ? "Start voice" : "Close"} onClick={onClose} ref={setClose}>
            {/* The Figma export of the plus glyph collapsed to a 1px path,
                so the × is two CSS bars at the design's 2px / #EFEFEF. */}
            <span className="mock-swap-icon" data-icon="x"><span className="mock-phone-close" /></span>
            <span className="mock-swap-icon" data-icon="start"><VoiceStartIcon size={20} /></span>
          </button>
        </div>
      </div>
    </div>
  );
}

/* A speech-like envelope: syllables (~3 Hz) under words (~0.55 Hz), a
   little roughness on top, and a pause at the end of each 9 s phrase. It
   is a pure function of time so every Demo instance agrees. */
export function demoLevel(t: number): number {
  const phrase = t % 9;
  if (phrase > 6.6) return 0;
  const syllable = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 3.1);
  const word = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 * 0.55 + 1);
  const rough = 0.86 + 0.14 * Math.sin(t * 23.7);
  const v = Math.pow(syllable, 1.6) * (0.5 + 0.5 * word) * rough;
  return Math.min(1, v * 1.05);
}

export const demoGetter = () => demoLevel(performance.now() / 1000);

/** The demo voice from a start: quiet for the first half second — a low
    murmur, so only a little of the effect shows at the bottom while it
    opens — then easing into the voice from the top of a phrase. */
export const DEMO_QUIET_S = 0.5;
export function demoGetterFrom(startMs: number): () => number {
  return () => {
    const t = (performance.now() - startMs) / 1000;
    if (t < DEMO_QUIET_S) return 0.04 + 0.02 * Math.sin(t * 9);
    const u = Math.min(1, (t - DEMO_QUIET_S) / 0.4);
    const ease = u * u * (3 - 2 * u);
    return 0.04 * (1 - ease) + demoLevel(t - DEMO_QUIET_S) * ease;
  };
}

export const MIC_STATUS: Record<string, string> = {
  idle: "",
  requesting: "Waiting for permission…",
  live: "Listening.",
  denied: "Microphone blocked — allow it in the browser's site settings.",
  unsupported: "This browser can't capture audio.",
  error: "Couldn't open the microphone.",
};
