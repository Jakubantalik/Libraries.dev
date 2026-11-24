import { useEffect, useRef, useState } from "react";

/* The parts of the models' live readouts (Voice position, Adaptive UI):
   text that decodes into place, a confidence meter of fine dots and a
   running clock. Their styles are the .vp-* readout rules in
   voice-position.css. */

const GLYPHS = "01·:+×#<>/";

/** Text that decodes into place: each character cycles a few glyphs, then settles. */
export function Decode({ text, pending, className }: { text: string; pending: boolean; className?: string }) {
  const [shown, setShown] = useState(text);
  const [settled, setSettled] = useState(text.length);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text);
      setSettled(text.length);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      const done = Math.min(text.length, Math.floor(Math.max(0, t - 60) / 42));
      let out = text.slice(0, done);
      for (let i = done; i < text.length; i++) out += text[i] === " " ? " " : GLYPHS[Math.floor((t / 50 + i * 7) % GLYPHS.length)];
      setShown(out);
      setSettled(done);
      if (done < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  return (
    <span className={className} data-pending={pending}>
      {[...shown].map((ch, i) => (
        <span key={i} className={i < settled ? "on" : "scramble"}>
          {ch}
        </span>
      ))}
    </span>
  );
}

const DOTS = 18;

/** Confidence as a row of fine dots, filling one after another. */
export function DotMeter({ value }: { value: number }) {
  const lit = Math.round(value * DOTS);
  return (
    <div className="vp-meter" aria-hidden="true">
      {Array.from({ length: DOTS }, (_, i) => (
        <i key={i} data-on={i < lit} style={{ transitionDelay: `${i * 22}ms` }} />
      ))}
      <span className="vp-pct">{value ? `${Math.round(value * 100)}%` : "··%"}</span>
    </div>
  );
}

const stamp = (s: number) => `T+${s.toFixed(1).padStart(5, "0")}s`;

/** Seconds the demo has run, counting live and holding while paused. */
export function Clock({ clock, paused }: { clock: { elapsed: number }; paused: boolean }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (paused) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      clock.elapsed += (now - last) / 1000;
      last = now;
      if (el.current) el.current.textContent = stamp(clock.elapsed);
    }, 100);
    return () => clearInterval(id);
  }, [clock, paused]);
  return (
    <span className="vp-clock" ref={el}>
      {stamp(clock.elapsed)}
    </span>
  );
}
