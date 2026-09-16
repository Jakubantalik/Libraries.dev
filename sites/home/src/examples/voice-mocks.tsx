import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/* The Voice library's mock hosts, shared by the Studio's Voice bench and
   the Voice detail page: the recording pill and the phone screen (the
   chat input lives in beam-mocks.tsx, shared with the Border beam bench),
   plus the synthetic voice that drives them where there is no microphone.
   Presentational and class-driven; the styling lives in
   assets/examples.css. */

/* Recording pill (Figma 1561:44248): mic, a live mm:ss counter that runs
   while the beam is listening, and the stop button. */
export function RecordingPill({ running, paused, resetKey }: { running: boolean; paused: boolean; resetKey: number }) {
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
      <span className="mock-pill-mic vb-ico vb-ico-mic" />
      <span className="mock-pill-time">{mm}:{ss}</span>
      <span className="mock-pill-stop" />
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
export function PhoneScreen({ promptKey, transcript }: { promptKey: number; transcript: string[] }) {
  const speaking = transcript.length > 0;
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
        <div className="mock-phone-actions">
          <div className="mock-phone-btn">
            <img src="/assets/icons/voice-mic-20.svg" alt="" width={20} height={20} draggable={false} />
          </div>
          <div className="mock-phone-btn">
            {/* The Figma export of the plus glyph collapsed to a 1px path,
                so the × is two CSS bars at the design's 2px / #EFEFEF. */}
            <span className="mock-phone-close" />
          </div>
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

export const MIC_STATUS: Record<string, string> = {
  idle: "Microphone off — press Listen.",
  requesting: "Waiting for permission…",
  live: "Listening.",
  denied: "Microphone blocked — allow it in the browser's site settings.",
  unsupported: "This browser can't capture audio.",
  error: "Couldn't open the microphone.",
};
