import { useEffect, useId, useState } from "react";
import type { WaveStyle, WaveStyleInput } from "distortion-waves";

/* The wave components page's tuning panel: the wave's speed, the front's
   easing and how its colour, rim and hairline fade, for one component at a
   time. Changes apply at once, and to the next run of a wave that is out. */

export type Which = "send" | "credits" | "toast" | "doc";

const NAMES: [Which, string][] = [
  ["send", "Send money"],
  ["credits", "Add credits"],
  ["toast", "Toast"],
  ["doc", "Document"],
];

type Key =
  | "anticipation"
  | "travel"
  | "easeX1"
  | "easeY1"
  | "easeX2"
  | "easeY2"
  | "strength"
  | "rimStrength"
  | "hairlineOpacity"
  | "linger"
  | "rimFade"
  | "hairlineLinger"
  | "hairlineFade";

/** What the panel has changed for one component; `speed` divides every time. */
export type Tweak = { speed: number } & Partial<Record<Key, number>>;

export const NO_TWEAK: Tweak = { speed: 1 };

/** The times a speed change scales. */
const TIMES = ["anticipation", "travel", "launchGap", "linger", "rimFade", "hairlineLinger", "hairlineFade", "particleLife"] as const;

const DEFAULT_CURVE = [0.22, 1, 0.36, 1];

/** A component's style with the panel's changes: the `waveStyle` to pass, and
    the whole style, to time the component's own steps by. */
export function tuned(base: WaveStyle, tweak: Tweak): { input: WaveStyleInput; style: WaveStyle } {
  const style = { ...base };
  const into = style as unknown as Record<string, number>;
  for (const key in tweak) {
    const v = tweak[key as Key];
    if (key !== "speed" && typeof v === "number") into[key] = v;
  }
  if (tweak.speed !== 1) for (const key of TIMES) into[key] = into[key] / tweak.speed;
  const input: Record<string, number> = {};
  for (const key in style) {
    const v = into[key];
    if (key !== "type" && key !== "palette" && key !== "cornerRadius" && typeof v === "number") input[key] = v;
  }
  return { input: input as WaveStyleInput, style };
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows: the panel still works, it just forgets.
  }
};

type Row = { key: Key; label: string; min: number; max: number; step: number; unit?: string };

const SPEED_ROWS: Row[] = [
  { key: "anticipation", label: "Anticipation", min: 0, max: 1.5, step: 0.01, unit: "s" },
  { key: "travel", label: "Travel", min: 0.3, max: 6, step: 0.01, unit: "s" },
];

const OPACITY_ROWS: Row[] = [
  { key: "strength", label: "Front colour", min: 0, max: 1.5, step: 0.01 },
  { key: "rimStrength", label: "Edge colour", min: 0, max: 1.5, step: 0.01 },
  { key: "hairlineOpacity", label: "Edge line", min: 0, max: 1, step: 0.01 },
  { key: "linger", label: "Edge holds", min: -1, max: 2, step: 0.01, unit: "s" },
  { key: "rimFade", label: "Edge fades", min: 0, max: 6, step: 0.01, unit: "s" },
  { key: "hairlineLinger", label: "Line holds", min: 0, max: 3, step: 0.01, unit: "s" },
  { key: "hairlineFade", label: "Line fades", min: 0, max: 6, step: 0.01, unit: "s" },
];

const CURVE_ROWS: Row[] = [
  { key: "easeX1", label: "x1", min: 0, max: 1, step: 0.01 },
  { key: "easeY1", label: "y1", min: -1, max: 2.5, step: 0.01 },
  { key: "easeX2", label: "x2", min: 0, max: 1, step: 0.01 },
  { key: "easeY2", label: "y2", min: -1, max: 2.5, step: 0.01 },
];

const PRESETS: [string, number[]][] = [
  ["Default", DEFAULT_CURVE],
  ["Out cubic", [0.33, 1, 0.68, 1]],
  ["In-out", [0.65, 0, 0.35, 1]],
  ["Linear", [0, 0, 1, 1]],
  ["Overshoot", [0.34, 1.35, 0.64, 1]],
];

const CURVE_KEYS: Key[] = ["easeX1", "easeY1", "easeX2", "easeY2"];

export function WaveControls({
  which,
  onWhich,
  bases,
  tweaks,
  onTweak,
}: {
  which: Which;
  onWhich: (w: Which) => void;
  bases: Record<Which, WaveStyle>;
  tweaks: Record<Which, Tweak>;
  onTweak: (w: Which, t: Tweak) => void;
}) {
  const [open, setOpen] = useState(() => read("wc:controls-open", true));
  const [copied, setCopied] = useState(false);
  const id = useId();
  useEffect(() => write("wc:controls-open", open), [open]);

  const base = bases[which];
  const tweak = tweaks[which];
  const value = (key: Key): number => tweak[key] ?? (base as unknown as Record<string, number | undefined>)[key] ?? DEFAULT_CURVE[CURVE_KEYS.indexOf(key)];
  const set = (key: Key | "speed", v: number) => onTweak(which, { ...tweak, [key]: v });
  const curve = CURVE_KEYS.map(value);
  const changed = Object.keys(tweak).length > 1 || tweak.speed !== 1;

  const copy = () => {
    const out: Record<string, number> = {};
    const { style } = tuned(base, tweak);
    // Every time the speed scales, too, so pasted values give the same wave.
    for (const key of new Set<string>([...[...SPEED_ROWS, ...CURVE_ROWS, ...OPACITY_ROWS].map((r) => r.key), ...TIMES])) {
      const v = (style as unknown as Record<string, number | undefined>)[key];
      if (typeof v === "number") out[key] = +v.toFixed(3);
    }
    void navigator.clipboard?.writeText(JSON.stringify(out, null, 2)).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  const slider = (r: Row) => {
    const v = value(r.key);
    return (
      <label key={r.key} className="wcc-row">
        <span className="wcc-label">{r.label}</span>
        <input type="range" min={r.min} max={r.max} step={r.step} value={v} onChange={(e) => set(r.key, +e.target.value)} />
        <span className="wcc-value">
          {v.toFixed(2)}
          {r.unit ?? ""}
        </span>
      </label>
    );
  };

  return (
    <aside className={`wcc${open ? " is-open" : ""}`} aria-label="Wave controls">
      <button type="button" className="wcc-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        Wave controls
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div id={id} className="wcc-body">
          <div className="wcc-tabs" role="tablist">
            {NAMES.map(([w, name]) => (
              <button key={w} type="button" role="tab" aria-selected={w === which} className="wcc-tab" onClick={() => onWhich(w)}>
                {name}
              </button>
            ))}
          </div>

          <section className="wcc-section">
            <h3>Speed</h3>
            <label className="wcc-row">
              <span className="wcc-label">Speed</span>
              <input type="range" min={0.25} max={3} step={0.05} value={tweak.speed} onChange={(e) => set("speed", +e.target.value)} />
              <span className="wcc-value">{tweak.speed.toFixed(2)}×</span>
            </label>
            {SPEED_ROWS.map(slider)}
          </section>

          <section className="wcc-section">
            <h3>Easing</h3>
            <div className="wcc-curve">
              <Curve points={curve} />
              <div className="wcc-presets">
                {PRESETS.map(([name, p]) => (
                  <button
                    key={name}
                    type="button"
                    className="wcc-preset"
                    aria-pressed={p.every((n, i) => n === curve[i])}
                    onClick={() => onTweak(which, { ...tweak, easeX1: p[0], easeY1: p[1], easeX2: p[2], easeY2: p[3] })}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
            {CURVE_ROWS.map(slider)}
          </section>

          <section className="wcc-section">
            <h3>Opacity over time</h3>
            {OPACITY_ROWS.map(slider)}
          </section>

          <div className="wcc-actions">
            <button type="button" className="wcc-action" disabled={!changed} onClick={() => onTweak(which, NO_TWEAK)}>
              Reset
            </button>
            <button type="button" className="wcc-action" onClick={copy}>
              {copied ? "Copied" : "Copy values"}
            </button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}

/** The front's travel curve, with room above and below for overshoot. */
function Curve({ points: [x1, y1, x2, y2] }: { points: number[] }) {
  const W = 120;
  const H = 84;
  const lo = -0.5;
  const hi = 1.6;
  const X = (x: number) => 8 + x * (W - 16);
  const Y = (y: number) => H - 6 - ((y - lo) / (hi - lo)) * (H - 12);
  return (
    <svg className="wcc-graph" width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(0)} className="wcc-axis" />
      <line x1={X(0)} y1={Y(1)} x2={X(1)} y2={Y(1)} className="wcc-axis" />
      <line x1={X(0)} y1={Y(0)} x2={X(x1)} y2={Y(y1)} className="wcc-handle" />
      <line x1={X(1)} y1={Y(1)} x2={X(x2)} y2={Y(y2)} className="wcc-handle" />
      <path d={`M${X(0)} ${Y(0)} C${X(x1)} ${Y(y1)} ${X(x2)} ${Y(y2)} ${X(1)} ${Y(1)}`} className="wcc-path" />
      <circle cx={X(x1)} cy={Y(y1)} r={2.5} className="wcc-dot" />
      <circle cx={X(x2)} cy={Y(y2)} r={2.5} className="wcc-dot" />
    </svg>
  );
}
