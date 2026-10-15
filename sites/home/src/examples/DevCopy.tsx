import { useEffect, useRef, useState } from "react";

/* A dev panel's copy button: copies the text, says "Copied" for a moment. */
export function DevCopy({ text, className = "gdev-btn" }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className={className}
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {});
        setDone(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}
