import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { describePatch, streamAgentTurn, type ChatTurn } from "./agent";
import type { CoreWiring } from "./core";
import { useScrollFade } from "../examples/useScrollFade";
import { ThinkingOrb } from "thinking-orbs";

/* App-level theme plumbing: the Studio shell provides it, and every
   ControlsPanel renders the dark/light toggle in its own top-right corner.
   Null (detail pages, tests) simply renders no toggle. */
export const StudioThemeContext = createContext<{
  theme: "dark" | "light";
  toggle: () => void;
} | null>(null);

function PanelThemeToggle() {
  const ctx = useContext(StudioThemeContext);
  if (!ctx) return null;
  const dark = ctx.theme === "dark";
  return (
    <button
      type="button"
      className="icon-btn st-theme-btn st-theme-btn--panel"
      onClick={ctx.toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={!dark}
      title={dark ? "Light theme" : "Dark theme"}
    >
      {dark ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M6.1 6.1 4.6 4.6M19.4 19.4l-1.5-1.5M17.9 6.1l1.5-1.5M4.6 19.4l1.5-1.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z" />
        </svg>
      )}
    </button>
  );
}

/* Studio — shared control components. Same pg-* conventions the detail-page
   playgrounds use (playground.css), plus Studio-only pieces: section titles,
   separators and color swatches. */

export function CopyIcon() {
  return (
    <svg className="icon-copy" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg className="icon-check" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.46889L6.26923 11.58L12.5 4.58" /></svg>
  );
}

export function CodeCopy({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const swapRef = useRef<HTMLSpanElement | null>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /* The detail pages' copy tooltip (site.js .card-copy wiring): the label
     tail cross-blurs "y code" -> "ied" and the pill tweens between the two
     measured widths. Hidden libraries measure 0, so re-measure when the
     button becomes visible and never write a 0. */
  useLayoutEffect(() => {
    const swap = swapRef.current;
    if (!swap) return;
    const a = swap.querySelector<HTMLElement>(".tt-a");
    const b = swap.querySelector<HTMLElement>(".tt-b");
    if (!a || !b) return;
    const measure = () => {
      const wa = a.getBoundingClientRect().width;
      if (!wa) return;
      const prevPos = b.style.position;
      b.style.position = "static";
      a.style.display = "none";
      const wb = b.getBoundingClientRect().width;
      a.style.display = "";
      b.style.position = prevPos;
      swap.style.setProperty("--tt-w-a", `${wa}px`);
      swap.style.setProperty("--tt-w-b", `${wb}px`);
    };
    const raf = requestAnimationFrame(measure);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(swap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const handleClick = useCallback(() => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [text]);

  return (
    <button
      type="button"
      className="code-copy"
      onClick={handleClick}
      data-copied={copied ? "true" : undefined}
      aria-label={copied ? "Copied" : label}
    >
      <CopyIcon />
      <CheckIcon />
      <span className="code-copy-tooltip" aria-hidden="true">
        <span className="tt-text">
          Cop
          <span className="tt-swap" ref={swapRef} data-state={copied ? "copied" : undefined}>
            <span className="tt-label tt-a">y code</span>
            <span className="tt-label tt-b">ied</span>
          </span>
        </span>
      </span>
    </button>
  );
}

/** One code surface: the scrolling <pre>, its fades, and the copy button. */
export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  label: string;
  className?: string;
}) {
  const preRef = useScrollFade(code);
  return (
    <div className={className ? `code-block ${className}` : "code-block"}>
      <pre ref={preRef}>{code}</pre>
      <CodeCopy text={code} label={label} />
    </div>
  );
}

/** Live-updating snippet block, full playground width. */
export function Snippet({ code }: { code: string }) {
  return <CodeBlock code={code} label="Copy Studio code" className="pg-snippet" />;
}

/** Uppercase section title inside the controls column. */
export function PanelTitle({ children }: { children: string }) {
  return <div className="pg-controls-title">{children}</div>;
}

export function PanelSep() {
  return <div className="pg-controls-sep" aria-hidden="true" />;
}

/** Titled group: gives a section its own label (and so the hairline above
    it) when the controls inside carry their own inline labels — e.g. a lone
    slider that would otherwise sit under the previous section's title. */
export function PgGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="pg-field pg-group" role="group" aria-label={label}>
      <span className="pg-label">{label}</span>
      {children}
    </div>
  );
}

export function PgTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="pg-field" role="radiogroup" aria-label={label}>
      <span className="pg-label">{label}</span>
      <div className="pg-tabs">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="pg-tab"
            role="radio"
            aria-checked={value === o.value}
            data-active={value === o.value ? "true" : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Value slider + input (Figma 1418:38136): the fill grows inside a 32px
    block, the label rides the fill, the value sits at the right. The
    invisible native range stays on top for pointer + keyboard + readers.
    Values re-round after parse so float dust never reaches the label. */
export function PgSlider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  const handleChange = useCallback(
    (raw: number) => {
      const snapped = Math.round(raw / step) * step;
      onChange(Math.min(max, Math.max(min, Math.round(snapped * 1000) / 1000)));
    },
    [max, min, onChange, step]
  );
  return (
    <div className="pg-field">
      <div className="pg-vslider">
        <div className="pg-vslider-fill" style={{ width: `${pct}%` }} />
        <span className="pg-vslider-label">{label}</span>
        <span className="pg-vslider-value">{display ?? value}</span>
        <input
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => handleChange(parseFloat(e.target.value))}
          aria-label={label}
        />
      </div>
    </div>
  );
}

/** Row of toggle pills (multi-select options). */
export function PgToggles({
  label,
  options,
}: {
  label: string;
  options: ReadonlyArray<{ label: string; active: boolean; onToggle: () => void }>;
}) {
  return (
    <div className="pg-field">
      <span className="pg-label">{label}</span>
      <div className="pg-tabs">
        {options.map((o) => (
          <button
            key={o.label}
            type="button"
            className="pg-toggle"
            aria-pressed={o.active}
            data-active={o.active ? "true" : undefined}
            onClick={o.onToggle}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Round color swatch picker. `swatch` overrides the painted color when the
    option's value is a sentinel rather than a CSS color. */
/* ── Custom color picker ───────────────────────────────────────
   Ported from jakubantalik.com's text-color picker (spectrum canvas +
   hue strip + hex field), restyled onto the Studio panel tokens. */

function cpHsvToRgb(h: number, sat: number, v: number): [number, number, number] {
  const i = Math.floor(h / 60) % 6;
  const f = h / 60 - Math.floor(h / 60);
  const pC = v * (1 - sat);
  const q = v * (1 - f * sat);
  const t = v * (1 - (1 - f) * sat);
  const pick: Array<[number, number, number]> = [
    [v, t, pC], [q, v, pC], [pC, v, t], [pC, q, v], [t, pC, v], [v, pC, q],
  ];
  const [r, g, b] = pick[i];
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function cpRgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const sat = max === 0 ? 0 : d / max;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return { h, s: sat, v: max };
}

function cpHex(h: number, sat: number, v: number): string {
  const [r, g, b] = cpHsvToRgb(h, sat, v);
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function cpParseHex(raw: string): { h: number; s: number; v: number } | null {
  const m = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(m)) return null;
  const n = parseInt(m, 16);
  return cpRgbToHsv((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

function ColorPickerPanel({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (hex: string) => void;
  onClose: () => void;
}) {
  const init = cpParseHex(value) ?? { h: 0, s: 1, v: 1 };
  const hsvRef = useRef(init);
  const [, force] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const specRef = useRef<HTMLCanvasElement | null>(null);
  const hueRef = useRef<HTMLCanvasElement | null>(null);
  const [hexText, setHexText] = useState(value.replace("#", "").toUpperCase());

  const drawSpectrum = useCallback(() => {
    const c = specRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const { width: w, height: hh } = c;
    ctx.fillStyle = `hsl(${hsvRef.current.h}, 100%, 50%)`;
    ctx.fillRect(0, 0, w, hh);
    const white = ctx.createLinearGradient(0, 0, w, 0);
    white.addColorStop(0, "rgba(255,255,255,1)");
    white.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = white;
    ctx.fillRect(0, 0, w, hh);
    const black = ctx.createLinearGradient(0, 0, 0, hh);
    black.addColorStop(0, "rgba(0,0,0,0)");
    black.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = black;
    ctx.fillRect(0, 0, w, hh);
  }, []);

  useLayoutEffect(() => {
    drawSpectrum();
    const c = hueRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const grad = ctx.createLinearGradient(0, 0, c.width, 0);
    for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60}, 100%, 50%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, c.width, c.height);
  }, [drawSpectrum]);

  /* Outside click + Esc close, same contract as the site's panel. */
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const apply = useCallback(() => {
    const hex = cpHex(hsvRef.current.h, hsvRef.current.s, hsvRef.current.v);
    setHexText(hex.replace("#", "").toUpperCase());
    onChange(hex);
    force((n) => n + 1);
  }, [onChange]);

  const dragTrack = (
    pick: (e: PointerEvent | ReactPointerEvent) => void
  ) => (e: ReactPointerEvent) => {
    e.preventDefault();
    pick(e);
    const move = (ev: PointerEvent) => pick(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const pickSpectrum = (e: PointerEvent | ReactPointerEvent) => {
    const wrap = specRef.current?.parentElement;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    hsvRef.current.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    hsvRef.current.v = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height));
    apply();
  };

  const pickHue = (e: PointerEvent | ReactPointerEvent) => {
    const wrap = hueRef.current?.parentElement;
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    hsvRef.current.h = Math.max(0, Math.min(359.9, ((e.clientX - r.left) / r.width) * 360));
    drawSpectrum();
    apply();
  };

  const commitHex = () => {
    const parsed = cpParseHex(hexText);
    if (!parsed) return;
    hsvRef.current = parsed;
    drawSpectrum();
    apply();
  };

  const { h, s: sat, v } = hsvRef.current;
  return (
    <div className="cp-panel" ref={rootRef}>
      <div className="cp-spectrum-wrap" onPointerDown={dragTrack(pickSpectrum)}>
        <canvas ref={specRef} className="cp-spectrum" width={196} height={140} />
        <div className="cp-cursor" style={{ left: `${sat * 100}%`, top: `${(1 - v) * 100}%` }} />
      </div>
      <div className="cp-hue-wrap" onPointerDown={dragTrack(pickHue)}>
        <canvas ref={hueRef} className="cp-hue" width={196} height={14} />
        <div className="cp-hue-cursor" style={{ left: `${(h / 360) * 100}%` }} />
      </div>
      <div className="cp-hex-row">
        <span className="cp-hex-label" aria-hidden="true">#</span>
        <input
          className="cp-hex-input"
          value={hexText}
          maxLength={6}
          spellCheck={false}
          aria-label="Hex color"
          onChange={(e) => setHexText(e.target.value)}
          onBlur={commitHex}
          onKeyDown={(e) => {
            if (e.key === "Enter") { commitHex(); onClose(); }
          }}
        />
      </div>
    </div>
  );
}

export function PgSwatches({
  label,
  options,
  value,
  onChange,
  allowCustom,
  hideLabel,
}: {
  label: string;
  options: ReadonlyArray<{ value: string; label: string; swatch?: string }>;
  value: string;
  onChange: (v: string) => void;
  /** Append a rainbow swatch that opens the picker, so any value outside
      the presets can be chosen; it shows (and stays selected on) the
      current custom color. */
  allowCustom?: boolean;
  /** Drop the visible label — for a row inside a titled PgGroup, where the
      group's title already names it. The aria-label stays either way. */
  hideLabel?: boolean;
}) {
  const isCustom = allowCustom && !options.some((o) => o.value === value);
  const [pickerOpen, setPickerOpen] = useState(false);
  return (
    <div className="pg-field" role="radiogroup" aria-label={label} style={{ position: "relative" }}>
      {!hideLabel && <span className="pg-label">{label}</span>}
      <div className="pg-swatches">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="pg-swatch"
            role="radio"
            aria-checked={value === o.value}
            aria-label={o.label}
            data-active={value === o.value ? "true" : undefined}
            style={{ background: o.swatch ?? o.value }}
            onClick={() => onChange(o.value)}
          />
        ))}
        {allowCustom && (
          <button
            type="button"
            className="pg-swatch pg-swatch--custom"
            data-active={isCustom ? "true" : undefined}
            style={isCustom ? { background: value } : undefined}
            title="Custom color"
            aria-label="Custom color"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((o) => !o)}
          />
        )}
      </div>
      {allowCustom && pickerOpen && (
        <ColorPickerPanel
          value={isCustom ? value : "#ededed"}
          onChange={onChange}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}

/** Formats a number for a JSX snippet: trims trailing zeros. */
export function num(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

/* ── Controls panel: Manual control / Agent ────────────────────────
 * Every library's knob column sits behind two tabs. "Manual control"
 * is the knob stack itself; "Agent" is a chat where the same tuning is
 * described in words instead of dragged. The pill indicator measures
 * the selected tab so the two labels' different widths stay correct. */

type PanelTab = "manual" | "agent";

interface ChatMessage {
  /* Stable identity, because deltas stream into a bubble that already
     exists. Updating by index would break the moment an applied-change
     line lands between two halves of the same sentence. */
  id: number;
  role: "user" | "agent" | "applied" | "error";
  text: string;
}

/** What a library must hand over for its Agent tab to actually tune. */
export interface AgentWiring {
  /** Key the Worker's spec table is keyed by — "beam", not "Beam". */
  libraryId: string;
  /** Live values, sent every turn so the model reasons from real state. */
  params: Record<string, unknown>;
  /** Param key -> the knob's own label, for the applied-change line. */
  labels: Record<string, string>;
  onApply: (patch: Record<string, unknown>) => void;
  /** Present when the agent may rewrite this library's core (`params.core`). */
  core?: CoreWiring;
}

/* Anonymous prompt analytics opt-out. The switch lives on the account page
   (account.html, "Studio agent analytics"); this only reads what it wrote,
   at send time rather than on mount, so a change made in another tab is
   picked up by the next message. "off" is the only value that means
   anything; absent or anything else is on. */
const ANALYTICS_KEY = "ldev:studio:agent-analytics";
function readAnalyticsPref(): boolean {
  try {
    return localStorage.getItem(ANALYTICS_KEY) !== "off";
  } catch {
    return true;
  }
}

/* A library whose controls aren't wired to the agent yet says so plainly
   rather than faking a reply that looks like tuning happened, and keeps
   the transcript so the phrasing someone tried is not lost. */
const AGENT_UNAVAILABLE =
  "The agent doesn't reach this library's controls yet. " +
  "Your message is kept here. Switch to Manual control to tune by hand, or use " +
  "Copy prompt on the library page to hand the whole library to your own coding agent.";

/* What the agent is doing while a turn is pending: the 20px "Working" orb
   beside one status line that shimmers while it holds, then swaps to the
   next line with the text-swap motion — transitions.dev prototype 28
   ("Thinking states"), ported to React. The sizer keeps the box at the
   widest line so the row never reflows; the live line sits over it and
   the one leaving is lifted out of flow to exit up while the next enters
   from below. Reduced motion holds the first line, orb frozen by the
   library's own reduced-motion handling. */
const THINKING_LINES = [
  "Reading the current settings",
  "Weighing the change you asked for",
  "Picking the knobs to move",
  "Checking the result",
];
const THINK_HOLD = 2000;
const THINK_SWAP = 150;
const THINK_GAP = 50;

export function ThinkingStatus() {
  const theme = useContext(StudioThemeContext)?.theme ?? "dark";
  const [idx, setIdx] = useState(0);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [entering, setEntering] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let i = 0;
    const later = (fn: () => void, ms: number) => {
      timers.current.push(window.setTimeout(fn, ms));
    };
    const cycle = () => {
      later(() => {
        const from = THINKING_LINES[i];
        i = (i + 1) % THINKING_LINES.length;
        /* Outgoing line floats over the box and exits; the incoming one
           mounts in its start pose, then releases a frame later so the
           transition runs from below. */
        setLeaving(from);
        setIdx(i);
        setEntering(true);
        later(() => setEntering(false), THINK_GAP);
        later(() => {
          setLeaving(null);
          cycle();
        }, THINK_SWAP + THINK_GAP);
      }, THINK_HOLD);
    };
    cycle();
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
  }, []);

  const widest = THINKING_LINES.reduce((a, b) => (b.length > a.length ? b : a), "");
  const text = THINKING_LINES[idx];
  return (
    <div className="st-chat-thinking" role="status" aria-live="polite">
      <span className="st-think-orb" aria-hidden="true">
        <ThinkingOrb state="working" size={20} theme={theme} />
      </span>
      <span className="st-think-swap">
        <span className="st-think-sizer" aria-hidden="true">{widest}</span>
        {leaving !== null && (
          <span className="st-think-text is-exit" data-text={leaving} aria-hidden="true">{leaving}</span>
        )}
        <span
          className={`st-think-text${entering ? " is-enter-start" : ""}`}
          data-text={text}
          key={idx}
        >
          {text}
        </span>
      </span>
    </div>
  );
}

function AgentChat({ library, wiring }: { library: string; wiring?: AgentWiring }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  /* The field takes the height of its text, to the CSS max (seven lines),
     then scrolls inside. Measured again when the tab is shown: a hidden
     field measures zero, which would leave it collapsed once visible. */
  const autosizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    if (!el.scrollHeight) return;
    const max = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }, []);
  useLayoutEffect(autosizeInput, [draft, autosizeInput]);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    const ro = new ResizeObserver(autosizeInput);
    ro.observe(el);
    return () => ro.disconnect();
  }, [autosizeInput]);
  /* A soft edge where the log scrolls out under the composer, sized to
     zero when nothing is past it, so a short log has no fade at all. The
     top clips at the head's rule, as the manual tab's knob list does. */
  const updateLogFade = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight > 2 ? "36px" : "0px";
    el.style.setProperty("--fade-bottom", bottom);
  }, []);
  useEffect(() => {
    updateLogFade();
    const el = logRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateLogFade);
    ro.observe(el);
    return () => ro.disconnect();
  });
  /* Distinct from `busy`: the thinking dots stand in only until the first
     token lands, after which the streaming text is its own progress. */
  const [streaming, setStreaming] = useState(false);
  const logRef = useRef<HTMLDivElement | null>(null);
  const seq = useRef(0);
  const nextId = () => ++seq.current;

  /* The send closure outlives the render it was made in — a turn takes
     seconds and the panel re-renders on every applied patch — so both the
     transcript and the live params are read through refs. */
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const wiringRef = useRef(wiring);
  wiringRef.current = wiring;

  // Pin to the newest message as the reply streams in.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  /* Abort an in-flight turn if the panel goes away mid-stream. */
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  /* Why the last rebuilt core was refused by the browser's check. Sent with
     the next turn so the model fixes it instead of guessing. */
  const coreErrorRef = useRef<string | undefined>(undefined);

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");

    const userMsg: ChatMessage = { id: nextId(), role: "user", text };
    setMessages((prev) => [...prev, userMsg]);

    const active = wiringRef.current;
    if (!active) {
      const reply: ChatMessage = { id: nextId(), role: "agent", text: AGENT_UNAVAILABLE };
      setMessages((prev) => [...prev, reply]);
      return;
    }

    /* Only the prose turns go to the model. Applied-change lines are a UI
       affordance, and the parameter state they describe is sent separately
       and authoritatively as `params`. */
    const turns: ChatTurn[] = [
      ...messagesRef.current
        .filter((m): m is ChatMessage & { role: "user" | "agent" } =>
          m.role === "user" || m.role === "agent"
        )
        .map((m) => ({ role: m.role, text: m.text })),
      { role: "user", text },
    ];

    /* Snapshot of the values this turn started from, advanced as patches
       land so a second change in the same turn reads "3.2 → 4", not
       "1.96 → 4". */
    const before = { ...active.params };

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setStreaming(false);

    /* Prose arrives as deltas but is written back as the whole accumulated
       string, so a double-invoked updater (StrictMode) is a no-op rather
       than a doubled sentence. */
    let bubbleId: number | null = null;
    let bubbleText = "";

    const coreError = coreErrorRef.current;
    coreErrorRef.current = undefined;

    streamAgentTurn(
      {
        library: active.libraryId,
        params: before,
        messages: turns,
        coreSource: active.core?.source(),
        coreError,
        analytics: readAnalyticsPref(),
        signal: controller.signal,
      },
      {
        onText: (delta) => {
          setStreaming(true);
          if (bubbleId === null) {
            const opened: ChatMessage = { id: nextId(), role: "agent", text: "" };
            bubbleId = opened.id;
            bubbleText = "";
            setMessages((prev) =>
              prev.some((m) => m.id === opened.id) ? prev : [...prev, opened]
            );
          }
          bubbleText += delta;
          const id = bubbleId;
          const snapshot = bubbleText;
          setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: snapshot } : m)));
        },
        onParams: (incoming) => {
          let patch = incoming;
          /* A rebuilt core is compiled here before it reaches the preview.
             A failure is shown, remembered for the next turn, and dropped
             from the patch — the knobs in the same patch still land. */
          const coreWiring = wiringRef.current?.core;
          if (coreWiring && typeof patch.core === "string" && patch.core) {
            const problem = coreWiring.check(patch.core);
            if (problem) {
              coreErrorRef.current = problem;
              const { core: _dropped, ...rest } = patch;
              patch = rest;
              const line: ChatMessage = {
                id: nextId(),
                role: "error",
                text: `The rebuilt core didn't apply — ${problem}. Ask again and the agent will fix it.`,
              };
              setMessages((prev) => (prev.some((m) => m.id === line.id) ? prev : [...prev, line]));
              bubbleId = null;
              if (!Object.keys(patch).length) return;
            }
          }
          wiringRef.current?.onApply(patch);
          const line: ChatMessage = {
            id: nextId(),
            role: "applied",
            text: describePatch(patch, before, wiringRef.current?.labels ?? {}),
          };
          Object.assign(before, patch);
          setMessages((prev) => (prev.some((m) => m.id === line.id) ? prev : [...prev, line]));
          // Any prose after a change starts a fresh bubble below that line.
          bubbleId = null;
        },
      }
    )
      .then((result) => {
        /* A turn that produced neither prose nor a change leaves the log
           looking ignored; say so instead. */
        if (bubbleId === null && !Object.keys(result.patch).length) {
          const line: ChatMessage = {
            id: nextId(),
            role: "agent",
            text: "The agent didn't return a change that time. Try again, or ask for a smaller step.",
          };
          setMessages((prev) => (prev.some((m) => m.id === line.id) ? prev : [...prev, line]));
        }
      })
      .catch((err: unknown) => {
        if ((err as Error)?.name === "AbortError") return;
        const line: ChatMessage = {
          id: nextId(),
          role: "error",
          text: err instanceof Error ? err.message : "The agent hit an error.",
        };
        setMessages((prev) => (prev.some((m) => m.id === line.id) ? prev : [...prev, line]));
      })
      .finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
        setBusy(false);
        setStreaming(false);
      });
  }, [draft, busy]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter keeps the newline, as in every chat composer.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="st-chat">
      <div className="st-chat-log" ref={logRef} role="log" aria-label="Agent conversation" onScroll={updateLogFade}>
        {messages.length === 0 ? (
          <p className="st-chat-empty">
            Describe the look you want and the agent tunes {library} for you: “make the
            glow slower and cooler”, “tighter corners”, “calmer motion”.
          </p>
        ) : (
          messages.map((m) => (
            <div className="st-chat-msg" data-role={m.role} key={m.id}>
              {m.text}
            </div>
          ))
        )}
        {busy && !streaming && <ThinkingStatus />}
      </div>

      <div className="st-chat-composer" data-filled={draft.trim() ? "" : undefined} data-busy={busy ? "" : undefined}>
        <textarea
          ref={inputRef}
          className="st-chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={`Ask for a change to ${library}…`}
          aria-label={`Ask the agent to change ${library}`}
        />
        <button
          type="button"
          className="st-chat-send"
          onClick={send}
          disabled={!draft.trim() || busy}
          aria-label="Send message"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7.99967 12.6667V3.33337M12.6663 8.00004L7.99967 3.33337L3.33301 8.00004" /></svg>
        </button>
      </div>
    </div>
  );
}

/* ── Presets, reset, copy prompt ───────────────────────────────────
 * The agent wiring already carries exactly what these need: the full
 * live parameter record and a callback that applies a patch. A preset
 * is a saved copy of the former fed back through the latter; reset is
 * the mount-time snapshot fed through it.
 *
 * Presets live in localStorage for now — the account backend
 * (api.libraries.dev) does not exist yet, the same gap GATE_ENABLED
 * papers over. The stored shape {name, params, savedAt} is what an
 * account sync would upload verbatim, so when that Worker exists this
 * becomes a fetch and nothing here changes shape. */

/* One preset carries a value set per theme: the same tuning rarely reads
   the same on both surfaces, so the Studio saves whichever it is in and
   applies the matching side back. Signed in, presets live on the account
   (the Worker's /presets); signed out they fall back to localStorage. */
type PresetTheme = "dark" | "light";
type PresetValues = Record<PresetTheme, Record<string, unknown>>;
interface StoredPreset {
  name: string;
  values: PresetValues;
  savedAt: number;
}

function presetKey(libraryId: string): string {
  return `ldev:studio:presets:${libraryId}`;
}

function readPresets(libraryId: string): StoredPreset[] {
  try {
    const raw = localStorage.getItem(presetKey(libraryId));
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) return [];
    /* Presets saved before values were split per theme carried a single
       `params` map — read them as the same values on both sides. */
    return list.map((x: { name: string; savedAt?: number; values?: PresetValues; params?: Record<string, unknown> }) =>
      x.values ? (x as StoredPreset) : { name: x.name, savedAt: x.savedAt ?? 0, values: { dark: x.params ?? {}, light: x.params ?? {} } }
    );
  } catch {
    return [];
  }
}

function accountPresets() {
  const LP = window.LibrariesPro;
  return LP && LP.state?.authenticated && LP.presets ? LP.presets : null;
}

function writePresets(libraryId: string, presets: StoredPreset[]) {
  try {
    localStorage.setItem(presetKey(libraryId), JSON.stringify(presets));
  } catch {
    /* Storage full or blocked — the Save button simply won't persist. */
  }
}

/** The coding-agent prompt, same shape as the detail pages' hidden
    #agent-prompt block, but the Usage section is the live tuned snippet. */
/** One extra platform for the Install & Usage tab (React is always first). */
export interface PlatformSnippet {
  id: string;
  label: string;
  installTitle: string;
  install: string;
  /** A caveat under the install block — e.g. a port not yet on npm. */
  note?: string;
  usage: string;
}

export interface PromptMeta {
  /** npm package name, e.g. "border-beam". */
  pkg: string;
  /** Docs path on libraries.dev, e.g. "/beam.html". */
  docsPath: string;
  /** The live snippet string the studio already renders. */
  snippet: string;
  /** Ports of the same library — each with its own install line and a
      usage snippet built from the same live knobs. */
  platforms?: PlatformSnippet[];
}

function buildAgentPrompt(library: string, meta: PromptMeta): string {
  return [
    `Add the ${library} effect from Libraries.dev to my React app.`,
    "",
    "Install:",
    `npm install ${meta.pkg}`,
    "",
    "Use exactly this configuration — it was tuned by hand in the Libraries.dev Studio:",
    "",
    meta.snippet,
    "",
    "Keep the prop values exactly as given; adapt only the child content to my app.",
    `Needs React 18 or newer. Docs: https://libraries.dev${meta.docsPath}`,
  ].join("\n");
}

type StageView = "preview" | "code";

/** Bar above the stage: the detail pages' Preview / Install / Usage tabs
    (same .detail-tabs / .proto-modal-tabs pill bar) on the left, and their
    .detail-prompt Copy-prompt pill on the right. Install and Usage swap the
    stage + live snippet for the matching code block, exactly like the
    detail pages' data-detail-panel switch. */
export function StageBar({
  library,
  prompt,
  agent,
}: {
  library: string;
  prompt?: PromptMeta;
  /** Preset save/apply and reset need the live params; optional so a
      library without agent wiring still gets the bar. */
  agent?: AgentWiring;
}) {
  const [view, setView] = useState<StageView>("preview");
  /* Platform under Install & Usage: "react" is the web package itself. */
  const [platform, setPlatform] = useState("react");
  const barRef2 = useRef<HTMLDivElement | null>(null);
  const indRef = useRef<HTMLSpanElement | null>(null);
  const viewRef = useRef<StageView>("preview");

  /* Indicator measured off the selected button, same as site.js's
     detail-tabs wiring and the panel-tabs pill above. */
  const moveInd = useCallback((animate: boolean) => {
    const bar = barRef2.current;
    const ind = indRef.current;
    if (!bar || !ind) return;
    const btn = bar.querySelector<HTMLElement>(`[data-detail-tab="${viewRef.current}"]`);
    if (!btn || !btn.offsetWidth) return;
    if (!animate) {
      const prev = ind.style.transition;
      ind.style.transition = "none";
      ind.style.width = `${btn.offsetWidth}px`;
      ind.style.transform = `translateX(${btn.offsetLeft}px)`;
      void ind.offsetWidth;
      ind.style.transition = prev;
      return;
    }
    ind.style.width = `${btn.offsetWidth}px`;
    ind.style.transform = `translateX(${btn.offsetLeft}px)`;
  }, []);

  const selectView = useCallback(
    (next: StageView) => {
      setView(next);
      viewRef.current = next;
      moveInd(true);
    },
    [moveInd]
  );

  useLayoutEffect(() => {
    const snap = () => moveInd(false);
    snap();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(snap);
    window.addEventListener("resize", snap);
    const ro = new ResizeObserver(snap);
    if (barRef2.current) ro.observe(barRef2.current);
    return () => {
      window.removeEventListener("resize", snap);
      ro.disconnect();
    };
  }, [moveInd]);

  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  /* ── Presets + reset ─────────────────────────────────────────────
     The values the studio mounted with ARE its defaults (every knob's
     useState starts there), so "adjusted" is simply params !== defaults. */
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const defaultsRef = useRef<Record<string, unknown> | null>(agent ? { ...agent.params } : null);
  const libraryId = agent?.libraryId ?? "";
  const theme: PresetTheme = useContext(StudioThemeContext)?.theme ?? "dark";
  const [presets, setPresets] = useState<StoredPreset[]>(() => (libraryId ? readPresets(libraryId) : []));

  /* Account presets replace the local list once the session is known —
     and again whenever it changes (sign-in / sign-out fire "pro:me").
     A failed call keeps whatever is stored locally rather than blanking
     the menu: the session can look live from the optimistic auth cache
     while the API is unreachable. */
  useEffect(() => {
    if (!libraryId) return;
    let live = true;
    const load = () => {
      const api = accountPresets();
      if (!api) {
        setPresets(readPresets(libraryId));
        return;
      }
      api.list(libraryId).then((r) => {
        if (!live) return;
        if (!r || !Array.isArray(r.presets)) {
          setPresets(readPresets(libraryId));
          return;
        }
        setPresets(r.presets.map((x) => ({ name: x.name, values: x.values as PresetValues, savedAt: x.updated_at })));
      }).catch(() => {
        if (live) setPresets(readPresets(libraryId));
      });
    };
    load();
    document.addEventListener("pro:me", load);
    return () => {
      live = false;
      document.removeEventListener("pro:me", load);
    };
  }, [libraryId]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuClosing, setMenuClosing] = useState(false);
  const [draftName, setDraftName] = useState("");
  const menuAnchor = useRef<HTMLDivElement | null>(null);
  const menuTimer = useRef<number | undefined>(undefined);
  const dirty = !!agent && !!defaultsRef.current && JSON.stringify(agent.params) !== JSON.stringify(defaultsRef.current);
  const nextName = `New preset ${presets.length + 1}`;

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    setMenuClosing(true);
    window.clearTimeout(menuTimer.current);
    menuTimer.current = window.setTimeout(() => setMenuClosing(false), 150);
  }, []);
  const openMenu = useCallback(() => {
    setDraftName(nextName);
    setMenuOpen(true);
  }, [nextName]);
  useEffect(() => () => window.clearTimeout(menuTimer.current), []);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuAnchor.current && !menuAnchor.current.contains(e.target as Node)) closeMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeMenu();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen, closeMenu]);

  const savePreset = useCallback(() => {
    const a = agentRef.current;
    if (!a) return;
    const name = draftName.trim() || nextName;
    /* The side being tuned takes the live values; the other side keeps
       what the preset already had, or starts from the same values so the
       preset is never half-empty. */
    const prev = presets.find((x) => x.name === name);
    const other: PresetTheme = theme === "dark" ? "light" : "dark";
    const values: PresetValues = {
      dark: { ...a.params },
      light: { ...a.params },
    };
    values[other] = { ...(prev?.values[other] ?? a.params) };
    values[theme] = { ...a.params };
    const entry: StoredPreset = { name, values, savedAt: Date.now() };
    const next = [...presets.filter((x) => x.name !== name), entry];
    setPresets(next);
    /* Whatever the agent moved is already in `a.params` — the chat applies
       its patch through the same setters the knobs use — so an agent-tuned
       look saves exactly like a hand-tuned one. If the account write does
       not land, keep the preset locally rather than losing it. */
    const api = accountPresets();
    if (api) {
      api.save(a.libraryId, name, values)
        .then((r) => {
          if (!r || !r.ok) writePresets(a.libraryId, next);
        })
        .catch(() => writePresets(a.libraryId, next));
    } else {
      writePresets(a.libraryId, next);
    }
    closeMenu();
  }, [draftName, nextName, presets, theme, closeMenu]);
  const applyPreset = useCallback(
    (x: StoredPreset) => {
      const side = x.values[theme] ?? x.values[theme === "dark" ? "light" : "dark"];
      agentRef.current?.onApply({ ...side });
      closeMenu();
    },
    [theme, closeMenu]
  );
  const removePreset = useCallback(
    (name: string) => {
      const a = agentRef.current;
      if (!a) return;
      const next = presets.filter((x) => x.name !== name);
      setPresets(next);
      const api = accountPresets();
      if (api) {
        api.remove(a.libraryId, name)
          .then((r) => {
            if (!r || !r.ok) writePresets(a.libraryId, next);
          })
          .catch(() => writePresets(a.libraryId, next));
      } else {
        writePresets(a.libraryId, next);
      }
      /* Mirror the deletion locally too, so a fallback copy cannot resurrect. */
      writePresets(a.libraryId, next);
    },
    [presets]
  );
  const resetAll = useCallback(() => {
    if (defaultsRef.current) agentRef.current?.onApply({ ...defaultsRef.current });
  }, []);

  const copy = useCallback(() => {
    if (!prompt) return;
    const text = buildAgentPrompt(library, prompt);
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  }, [library, prompt]);

  return (
    <>
    <div className="st-stage-bar" data-view={view}>
      <div className="detail-tabs proto-modal-tabs" ref={barRef2} role="tablist" aria-label="View">
        <span className="proto-modal-tabs-indicator" ref={indRef} aria-hidden="true" />
        {(["preview", "code"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="proto-modal-tab"
            role="tab"
            data-detail-tab={v}
            aria-selected={view === v}
            onClick={() => selectView(v)}
          >
            {v === "preview" ? "Preview" : "Install & Usage"}
          </button>
        ))}
      </div>
      <div className="st-stage-actions">
      {agent && (
        <div className="pm-anchor" ref={menuAnchor}>
          <button
            type="button"
            className="detail-prompt st-preset-btn"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              e.stopPropagation();
              menuOpen ? closeMenu() : openMenu();
            }}
          >
            <span className="detail-prompt-label">Presets</span>
            {/* Icon/Chevron small down, exported from the same Figma frame. */}
            <svg className="st-preset-chev" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M4.46967 6.46967C4.76256 6.17678 5.23744 6.17678 5.53033 6.46967L8 8.93934L10.4697 6.46967C10.7626 6.17678 11.2374 6.17678 11.5303 6.46967C11.8232 6.76256 11.8232 7.23744 11.5303 7.53033L8.53033 10.5303C8.23744 10.8232 7.76256 10.8232 7.46967 10.5303L4.46967 7.53033C4.17678 7.23744 4.17678 6.76256 4.46967 6.46967Z"
                fill="currentColor"
              />
            </svg>
          </button>
          <div
            className={`tl-menu t-dropdown st-preset-menu${menuOpen ? " is-open" : ""}${menuClosing ? " is-closing" : ""}`}
            data-origin="top-right"
            role="menu"
            aria-label="Presets"
          >
            {presets.length === 0 && !dirty && (
              /* Empty state, Figma 1432:39119: the headline plus a line
                 saying where presets come from. */
              <div className="st-preset-empty">
                <p className="st-preset-empty-title">No saved presets</p>
                <p className="st-preset-empty-sub">Once customized, you’ll be able to save presets here.</p>
              </div>
            )}
            {presets.map((x) => (
              <div className="tl-menu-item st-preset-row" role="menuitem" tabIndex={0} key={x.name}
                onClick={() => applyPreset(x)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") applyPreset(x); }}
              >
                <span className="tl-menu-item-label">{x.name}</span>
                <button
                  type="button"
                  className="st-preset-remove"
                  aria-label={`Delete preset ${x.name}`}
                  onClick={(e) => { e.stopPropagation(); removePreset(x.name); }}
                >
                  ×
                </button>
              </div>
            ))}
            {dirty && (
              <>
                {presets.length > 0 && <div className="tl-menu-divider" />}
                {/* Something was tuned: offer to keep it. */}
                <div className="st-preset-form">
                  <input
                    className="st-preset-input"
                    value={draftName}
                    aria-label="Preset name"
                    onFocus={(e) => e.currentTarget.select()}
                    onChange={(e) => setDraftName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && draftName.trim()) savePreset(); }}
                  />
                  <button
                    type="button"
                    className="st-preset-save"
                    onClick={savePreset}
                    disabled={!draftName.trim()}
                  >
                    Save preset
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {agent && (
        <button
          type="button"
          className="icon-btn st-reset-btn"
          onClick={resetAll}
          aria-label="Reset to default"
        >
          {/* refresh-ccw-01, exported from the same Figma frame. */}
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M1.33301 6.66667C1.33301 6.66667 2.66966 4.84548 3.75556 3.75883C4.84147 2.67218 6.34207 2 7.99967 2C11.3134 2 13.9997 4.68629 13.9997 8C13.9997 11.3137 11.3134 14 7.99967 14C5.26428 14 2.95642 12.1695 2.23419 9.66667M5.33301 6.66667H1.33301V2.66667"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="card-copy-tooltip" aria-hidden="true"><span className="tt-text">Reset to default</span></span>
        </button>
      )}
      {prompt && (
        <button
          type="button"
          className="detail-prompt"
          onClick={copy}
          data-copied={copied ? "true" : undefined}
          aria-label="Copy agent prompt"
        >
          <span className="detail-prompt-ico" aria-hidden="true">
            {/* copy-03, exported from Figma 1419:38547. */}
            <svg className="icon-copy" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5.6 5.6V3.92C5.6 3.24794 5.6 2.91191 5.73079 2.65521C5.84584 2.42942 6.02942 2.24584 6.25521 2.13079C6.51191 2 6.84794 2 7.52 2H12.08C12.7521 2 13.0881 2 13.3448 2.13079C13.5706 2.24584 13.7542 2.42942 13.8692 2.65521C14 2.91191 14 3.24794 14 3.92V8.48C14 9.15206 14 9.4881 13.8692 9.74479C13.7542 9.97058 13.5706 10.1542 13.3448 10.2692C13.0881 10.4 12.7521 10.4 12.08 10.4H10.4M3.92 14H8.48C9.15206 14 9.48809 14 9.74479 13.8692C9.97058 13.7542 10.1542 13.5706 10.2692 13.3448C10.4 13.0881 10.4 12.7521 10.4 12.08V7.52C10.4 6.84794 10.4 6.51191 10.2692 6.25521C10.1542 6.02942 9.97058 5.84584 9.74479 5.73079C9.48809 5.6 9.15206 5.6 8.48 5.6H3.92C3.24794 5.6 2.91191 5.6 2.65521 5.73079C2.42942 5.84584 2.24584 6.02942 2.13079 6.25521C2 6.51191 2 6.84794 2 7.52V12.08C2 12.7521 2 13.0881 2.13079 13.3448C2.24584 13.5706 2.42942 13.7542 2.65521 13.8692C2.91191 14 3.24794 14 3.92 14Z" />
            </svg>
            <svg className="icon-check" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.46889L6.26923 11.58L12.5 4.58" /></svg>
          </span>
          <span className="detail-prompt-label">Copy prompt</span>
        </button>
      )}
      </div>
    </div>
    {/* One tab, both blocks: the install line and the usage snippet are
        read together, each under its own subtitle and copy button. The
        usage subtitle says the snippet is the live tuning, because it is —
        it carries whatever the knobs currently read. */}
    {prompt && view === "code" && (() => {
      const ports = prompt.platforms ?? [];
      const active = ports.find((x) => x.id === platform);
      const install = active ? active.install : `npm install ${prompt.pkg}`;
      const usage = active ? active.usage : prompt.snippet;
      /* Figma 1433:39150 titles the blocks plainly, so what a port needs —
         its version floor, its extra packages — moves to the note under the
         install block rather than being lost with the old heading. */
      const note = active
        ? [active.installTitle.replace(/[.\s]*$/, "."), active.note].filter(Boolean).join(" ")
        : "";
      return (
        <div className="st-stage-panel">
          {ports.length > 0 && (
            <div className="st-platform-tabs" role="tablist" aria-label="Platform">
              {[{ id: "react", label: "React" }, ...ports].map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className="st-platform-tab"
                  role="tab"
                  aria-selected={platform === x.id}
                  data-active={platform === x.id ? "true" : undefined}
                  onClick={() => setPlatform(x.id)}
                >
                  {x.label}
                </button>
              ))}
            </div>
          )}
          <div className="st-code-group">
            <span className="st-code-title">Installation</span>
            <CodeBlock code={install} label="Copy install command" />
            {note && <span className="st-code-note">{note}</span>}
          </div>
          <div className="st-code-group">
            <span className="st-code-title">Usage</span>
            <CodeBlock code={usage} label="Copy usage example" />
          </div>
        </div>
      );
    })()}
    </>
  );
}

/** The knob column, wrapped in the Manual control / Agent tab pair.
    `agent` is optional: a library that hasn't been wired up yet still gets
    the tab, and the chat says so instead of pretending. */
export function ControlsPanel({
  library,
  agent,
  children,
}: {
  library: string;
  agent?: AgentWiring;
  children: ReactNode;
}) {
  const [tab, setTab] = useState<PanelTab>("manual");
  const barRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLSpanElement | null>(null);
  /* move() reads the current tab from a ref so the measure effect does not
     have to re-subscribe its observer every time the tab changes. */
  const tabRef = useRef<PanelTab>("manual");

  /* Measure from the selected button rather than assuming equal widths —
     "Manual controls" is far wider than "Agent".

     Following the tabs-sliding recipe, the pill only tweens when a tab is
     clicked. First paint and resize write the same values with the
     transition suspended, so it snaps into place instead of animating out
     of nothing. */
  const move = useCallback((animate: boolean) => {
    const bar = barRef.current;
    const pill = pillRef.current;
    if (!bar || !pill) return;
    const btn = bar.querySelector<HTMLElement>(`[data-tab="${tabRef.current}"]`);
    if (!btn || !btn.offsetWidth) return;
    if (!animate) {
      const prev = pill.style.transition;
      pill.style.transition = "none";
      pill.style.transform = `translateX(${btn.offsetLeft}px)`;
      pill.style.width = `${btn.offsetWidth}px`;
      void pill.offsetWidth; // flush, so restoring the transition cannot tween
      pill.style.transition = prev;
      return;
    }
    pill.style.transform = `translateX(${btn.offsetLeft}px)`;
    pill.style.width = `${btn.offsetWidth}px`;
  }, []);

  const select = useCallback(
    (next: PanelTab) => {
      setTab(next);
      tabRef.current = next;
      move(true);
    },
    [move]
  );

  useLayoutEffect(() => {
    const snap = () => move(false);
    snap();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(snap);
    window.addEventListener("resize", snap);
    /* The Studio keeps every library's panel mounted and hides the ones it
       is not showing, and a hidden element measures 0 — so without this the
       indicator stays collapsed until the window happens to resize. The
       observer fires when the bar gets its width on becoming visible. */
    const ro = new ResizeObserver(snap);
    if (barRef.current) ro.observe(barRef.current);
    return () => {
      window.removeEventListener("resize", snap);
      ro.disconnect();
    };
  }, [move]);

  return (
    <div className="pg-controls">
      <div className="st-panel-head">
      <div className="st-panel-tabs" ref={barRef} role="tablist" aria-label="Control mode">
        <span className="st-panel-tabs-indicator" ref={pillRef} aria-hidden="true" />
        <button
          type="button"
          className="st-panel-tab"
          role="tab"
          data-tab="manual"
          aria-selected={tab === "manual"}
          onClick={() => select("manual")}
        >
          Manual controls
        </button>
        <button
          type="button"
          className="st-panel-tab"
          role="tab"
          data-tab="agent"
          aria-selected={tab === "agent"}
          onClick={() => select("agent")}
        >
          Agent
        </button>
      </div>
      <PanelThemeToggle />
      </div>

      {/* Both halves stay mounted whichever tab is open, so switching back
          resets neither what the user tuned nor the conversation that
          tuned it. */}
      <div className="st-panel-body" hidden={tab !== "manual"}>
        {/* A rebuilt core changes what the knobs below are tuning, so say
            so where the knobs are, with the way back. */}
        {agent && typeof agent.params.core === "string" && agent.params.core !== "" && (
          <div className="st-core-row" role="status">
            <span className="st-core-text">Core rebuilt by the agent</span>
            <button type="button" className="st-core-restore" onClick={() => agent.onApply({ core: "" })}>
              Restore stock
            </button>
          </div>
        )}
        {children}
      </div>
      <div className="st-panel-body st-panel-body--chat" hidden={tab !== "agent"}>
        <AgentChat library={library} wiring={agent} />
      </div>

    </div>
  );
}
