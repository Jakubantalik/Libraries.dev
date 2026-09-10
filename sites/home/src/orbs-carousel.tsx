import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ThinkingOrb, getGravityStatus, type OrbState } from "thinking-orbs";
import { MAC_ARROW, isMacPointer } from "./examples/macCursor";
import { GravityDevPanel } from "./examples/GravityDevPanel";
import { DevCopy } from "./examples/DevCopy";

/* Internal demo: the orb states as the detail page's large pills, stacked
   on an oblique, shown as two slides of four. Every seven seconds the slide
   leaves to the left and the other arrives from the right — transitions.dev's
   page slide, forward-only. Cursor gravity is on for every pill of the
   slide in view. */

const ITEMS: Array<{ state: OrbState; label: string }> = [
  { state: "searching", label: "Searching" },
  { state: "breathing", label: "Thinking" },
  { state: "solving", label: "Solving" },
  { state: "listening", label: "Listening" },
  { state: "connecting", label: "Connecting" },
  { state: "weaving", label: "Planning" },
  { state: "composing", label: "Composing" },
  { state: "working", label: "Working" },
];

const PER_SLIDE = 4;
const SLIDES = Array.from({ length: Math.ceil(ITEMS.length / PER_SLIDE) }, (_, s) =>
  ITEMS.slice(s * PER_SLIDE, (s + 1) * PER_SLIDE).map((item, j) => ({ ...item, index: s * PER_SLIDE + j }))
);

/* Pill widths: one random draw per pill in 220–280px, made once at load
   so a pill keeps its width across slides and a reload deals a new set.
   The label stays left, by the orb; the extra is empty pill. */
const WIDTHS = ITEMS.map(() => Math.round(220 + Math.random() * 60));

/* Gravity needs the platform's own pointer raster; the bundled one is the
   macOS arrow, so elsewhere the orbs simply run without it. */
const GRAVITY_AVAILABLE = isMacPointer();
const GRAVITY = GRAVITY_AVAILABLE ? { sprite: MAC_ARROW } : false;

/* The stack's geometry and the slide's motion, as the dev panel tunes
   them. Defaults match the CSS on the page. */
const RAIL_DEFAULTS = { arc: 1, dx: 60, dy: 94, dist: 360, blur: 3, stagger: 70, dur: 1100, hold: 7000 };
type RailKey = keyof typeof RAIL_DEFAULTS;
const RAIL_ROWS: Array<[RailKey, string, number, number, number, string, string]> = [
  ["arc", "Curve", -48, 48, 1, "px", "px per slot², the bow of the stack — positive bends toward the rise, negative away, 0 is a straight line"],
  ["dx", "Step", 0, 200, 2, "px", "px sideways per slot"],
  ["dy", "Rise", 74, 200, 2, "px", "px per slot; 74 is touching pills, 94 leaves 20px of air"],
  ["dist", "Slide", 0, 400, 4, "px", "px a pill travels leaving to the left and arriving from the right"],
  ["blur", "Blur", 0, 12, 0.5, "px", "px of blur on a pill while it is out"],
  ["stagger", "Stagger", 0, 200, 10, "ms", "ms between the four pills of a slide, bottom first; 0 moves them as one"],
  ["dur", "Duration", 100, 2000, 50, "ms", "ms a pill takes to leave or arrive"],
  ["hold", "Hold", 1000, 15000, 250, "ms", "ms a slide stays before the next comes in"],
];
const CSS_VAR: Record<RailKey, string> = {
  arc: "--arc", dx: "--dx", dy: "--dy", dist: "--page-slide-distance", blur: "--page-blur", stagger: "--page-stagger", dur: "--page-slide-dur", hold: "--oc-hold",
};
const MS_KEYS: RailKey[] = ["stagger", "dur", "hold"];
/* The slide's easing: transitions.dev's tokens to pick from, or any
   cubic-bezier typed in. The default is the smooth ease-out. */
const EASE_DEFAULT = "cubic-bezier(0.22, 1, 0.36, 1)";
const EASES: Array<[string, string]> = [
  ["Smooth out", EASE_DEFAULT],
  ["Ease in-out", "ease-in-out"],
  ["Ease out", "ease-out"],
  ["Bounce", "cubic-bezier(0.34, 1.36, 0.64, 1)"],
  ["Strong bounce", "cubic-bezier(0.34, 3.85, 0.64, 1)"],
  ["Linear", "linear"],
];
const SHOW_DEV =
  typeof location !== "undefined" &&
  (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || new URLSearchParams(location.search).has("dev"));

function RailDevPanel({
  rail,
  onChange,
  ease,
  onEase,
  onReset,
  paused,
  onPause,
}: {
  rail: typeof RAIL_DEFAULTS;
  onChange: (k: RailKey, v: number) => void;
  ease: string;
  onEase: (v: string) => void;
  onReset: () => void;
  paused: boolean;
  onPause: (v: boolean) => void;
}) {
  const code = useMemo(() => {
    const parts = (Object.keys(RAIL_DEFAULTS) as RailKey[])
      .filter((k) => rail[k] !== RAIL_DEFAULTS[k])
      .map((k) => `${CSS_VAR[k]}: ${rail[k]}${MS_KEYS.includes(k) ? "ms" : "px"}`);
    if (ease.trim() !== EASE_DEFAULT) parts.push(`--page-slide-ease: ${ease.trim()}`);
    return parts.length ? `.oc-stage { ${parts.join("; ")}; }` : ".oc-stage { /* defaults */ }";
  }, [rail, ease]);
  const preset = EASES.find(([, v]) => v === ease.trim())?.[1] ?? "custom";
  return (
    <aside className="ocdev" aria-label="Slides tuning (dev only)">
      <div className="ocdev-head">
        <span>Carousel slides · dev</span>
        <span className="ocdev-actions">
          <button type="button" className="ocdev-btn" aria-pressed={paused} data-on={paused ? "true" : undefined} onClick={() => onPause(!paused)}>
            {paused ? "Play" : "Pause"}
          </button>
          <button type="button" className="ocdev-btn" onClick={onReset}>Reset</button>
        </span>
      </div>
      {RAIL_ROWS.map(([k, name, min, max, step, unit, hint]) => (
        <label key={k} className="ocdev-row">
          <span className="ocdev-row-head"><span>{name}</span><span className="ocdev-val">{rail[k]}{unit}</span></span>
          <input type="range" min={min} max={max} step={step} value={rail[k]} onChange={(e) => onChange(k, Number(e.target.value))} />
          <span className="ocdev-hint">{hint}</span>
        </label>
      ))}
      <label className="ocdev-row">
        <span className="ocdev-row-head"><span>Easing</span></span>
        <select className="ocdev-select" value={preset} onChange={(e) => e.target.value !== "custom" && onEase(e.target.value)}>
          {EASES.map(([name, v]) => <option key={v} value={v}>{name}</option>)}
          <option value="custom">Custom</option>
        </select>
        <input
          className="ocdev-text"
          type="text"
          spellCheck={false}
          value={ease}
          onChange={(e) => onEase(e.target.value)}
          placeholder="cubic-bezier(x1, y1, x2, y2)"
        />
        <span className="ocdev-hint">timing function for a pill leaving and arriving — pick a transitions.dev token or type any cubic-bezier</span>
      </label>
      <div className="ocdev-code-row">
        <code className="ocdev-code">{code}</code>
        <DevCopy text={code} className="ocdev-btn" />
      </div>
    </aside>
  );
}

/** Where a slide is: in view, gone out to the left, or waiting on the
 *  right. A slide only ever travels left; once it is out and settled it is
 *  put back on the right without a transition, ready to arrive again. */
type Phase = "active" | "left" | "right";

function Carousel() {
  const [, setActive] = useState(0);
  const activeRef = useRef(0);
  const [phases, setPhases] = useState<Phase[]>(SLIDES.map((_, s) => (s === 0 ? "active" : "right")));
  const [gravityOn, setGravityOn] = useState(true);
  /* Dev: a manual pause. */
  const [paused, setPaused] = useState(false);
  const [rail, setRail] = useState({ ...RAIL_DEFAULTS });
  const [ease, setEase] = useState(EASE_DEFAULT);
  const railRef = useRef(rail);
  railRef.current = rail;

  /* Switching: the slide in view goes left, the next comes in from the
     right; once the outgoing one has settled it is moved to the right
     (no transition — see the CSS) so its next arrival is from the right
     again. Only two slides, so "next" is simply the other. */
  const settle = useRef<number | undefined>(undefined);
  const advance = () => {
    const a = activeRef.current;
    const next = (a + 1) % SLIDES.length;
    activeRef.current = next;
    setActive(next);
    setPhases((p) => p.map((ph, s) => (s === next ? "active" : s === a ? "left" : ph)));
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      setPhases((p) => p.map((ph) => (ph === "left" ? "right" : ph)));
    }, railRef.current.dur + (PER_SLIDE - 1) * railRef.current.stagger + 60);
  };

  /* One steady timer; the pause flag is read when it fires, so flipping
     it never restarts the countdown. */
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const timer = useRef<number | undefined>(undefined);
  const startTimer = () => {
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      if (pausedRef.current) return;
      advance();
    }, railRef.current.hold);
  };
  /* A new hold restarts the cadence at the new length. */
  useEffect(() => {
    startTimer();
    return () => window.clearInterval(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rail.hold]);
  useEffect(() => () => window.clearTimeout(settle.current), []);

  return (
    <div
      className="oc-stage"
      style={
        {
          "--dx": `${rail.dx}px`,
          "--dy": `${rail.dy}px`,
          "--arc": `${rail.arc}px`,
          "--page-slide-distance": `${rail.dist}px`,
          "--page-blur": `${rail.blur}px`,
          "--page-stagger": `${rail.stagger}ms`,
          "--page-slide-dur": `${rail.dur}ms`,
          "--page-fade-dur": `${rail.dur}ms`,
          "--page-slide-ease": ease.trim() || EASE_DEFAULT,
          "--page-fade-ease": ease.trim() || EASE_DEFAULT,
        } as React.CSSProperties
      }
    >
      {SLIDES.map((slide, s) => {
        const phase = phases[s];
        const inView = phase === "active";
        return (
          <div key={s} className="oc-slide" data-phase={phase} aria-hidden={inView ? undefined : true}>
            {slide.map((item, j) => {
              /* Slot k, centred: four pills sit at -1.5 … 1.5 so the stack's
                 middle is the stage's centre, bottom-left to top-right. */
              const k = j - (PER_SLIDE - 1) / 2;
              return (
                <div key={item.state} className="oc-item" style={{ "--k": k, "--j": j } as React.CSSProperties}>
                  <span className="ex-pill" style={{ width: WIDTHS[item.index] }}>
                    <ThinkingOrb
                      state={item.state}
                      size={64}
                      theme="dark"
                      paused={phase === "right"}
                      gravity={inView && gravityOn ? GRAVITY : false}
                      style={{ width: 56, height: 56 }}
                    />
                    <span className="t-shimmer" data-text={`${item.label}….`}>{item.label}….</span>
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
      {SHOW_DEV && (
        <>
          <RailDevPanel
            rail={rail}
            onChange={(k, v) => setRail((r) => ({ ...r, [k]: v }))}
            ease={ease}
            onEase={setEase}
            onReset={() => { setRail({ ...RAIL_DEFAULTS }); setEase(EASE_DEFAULT); }}
            paused={paused}
            onPause={setPaused}
          />
          <GravityDevPanel enabled={gravityOn} onToggle={setGravityOn} available={GRAVITY_AVAILABLE} />
        </>
      )}
    </div>
  );
}

/* Internal page: leave the gravity status readable from the console. */
(window as unknown as { __orbGravity: () => unknown }).__orbGravity = getGravityStatus;

const el = document.getElementById("carousel-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <Carousel />
    </StrictMode>
  );
}
