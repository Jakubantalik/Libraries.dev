import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser } from "./examples/StudioTeaser";
import { ThinkingOrb, type OrbSize, type OrbState } from "thinking-orbs";
import { MAC_ARROW, isMacPointer } from "./examples/macCursor";
import { GravityDevPanel } from "./examples/GravityDevPanel";

/* The tuning panel is a dev tool: localhost, or ?dev anywhere. */
const SHOW_GRAVITY_DEV =
  typeof location !== "undefined" &&
  (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || new URLSearchParams(location.search).has("dev"));

/* Orb detail page — playground island (stage + controls + live snippet).
   Mirrors the live playground at sites/orbs/components/Playground.tsx:
   nine state tabs, 64/20 size tabs, starts paused. */

/* Examples data, mirroring sites/orbs/components/Examples.tsx. */
const HERO_PILLS: Array<{ state: OrbState; label: string }> = [
  { state: "solving", label: "Solving…." },
  { state: "composing", label: "Thinking…." },
];

/* Order matters: with row-major auto-placement over 151px rows, this
   sequence of 1- and 2-row spans tiles five rows with no leftover gaps. */
const CHIP_STATES: OrbState[] = [
  "listening",
  "working",
  "searching",
  "connecting",
  "weaving",
  "breathing",
  "shaping",
];

/* Chip states that render as full large pills (the rest stay compact). */
const LARGE_CHIPS = new Set<OrbState>(["working", "searching", "connecting"]);

/* Small-chip copy that reads better than the literal state name. */
const LABEL_OVERRIDES: Partial<Record<OrbState, string>> = {
  weaving: "planning",
  breathing: "thinking",
  connecting: "solving",
};

const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

/* Weaving and shaping live in the Studio, not here. */
const STATES: OrbState[] = [
  "working",
  "searching",
  "solving",
  "listening",
  "connecting",
  "composing",
  "breathing",
];
/* Two sizes here; 32px and the speed knob live in the Studio. */
const SIZES: OrbSize[] = [64, 20];


function buildSnippet(state: OrbState, size: OrbSize, gravity: boolean): string {
  const props = [`state="${state}"`, `size={${size}}`];
  if (gravity) props.push("gravity={{ sprite: macArrow }}");
  const head = gravity
    ? "import { ThinkingOrb } from 'thinking-orbs';\n// A raster of the platform's own pointer — see the Gravity docs.\nimport { macArrow } from './cursors';\n\n"
    : "import { ThinkingOrb } from 'thinking-orbs';\n\n";
  return `${head}<ThinkingOrb ${props.join(" ")} />`;
}

/* Gravity needs the platform's own pointer raster; the one bundled here
   is the macOS arrow, so the toggle only does anything on a Mac. */
const gravityAvailable = isMacPointer();

function CopyIcon() {
  return (
    <svg className="icon-copy" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="icon-check" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.46889L6.26923 11.58L12.5 4.58" /></svg>
  );
}

function OrbPlayground() {
  const [state, setState] = useState<OrbState>("listening");
  const [size, setSize] = useState<OrbSize>(64);
  // Starts paused so the page loads quietly (same as the live playground).
  /* The stage starts paused — Play opts in. The examples above run on
     their own: they are the library introducing itself. */
  const [paused, setPaused] = useState(true);
  const [gravity, setGravity] = useState(false);

  const snippet = buildSnippet(state, size, gravity);

  return (
    <>
      {/* The demo page's own examples first (sites/orbs/components/
          Examples.tsx), showing all nine states: two hero pills, then the
          seven-state grid where working / searching / connecting take the
          large pill and the rest stay compact chips. */}
      <div className="detail-examples">
        <div className="ex-orb-heroes">
          {HERO_PILLS.map(({ state, label }) => (
            <div className="ex-orb-cell ex-orb-cell--hero" key={state}>
              <span className="ex-pill">
                <ThinkingOrb state={state} size={64} theme="dark" style={{ width: 56, height: 56 }} />
                <span className="t-shimmer" data-text={label}>{label}</span>
              </span>
            </div>
          ))}
        </div>

        {/* Row-major auto-placement over 151px rows: this order of 1- and
            2-row spans tiles without leaving gaps. */}
        <div className="ex-orb-grid">
          {CHIP_STATES.map((state) => {
            const large = LARGE_CHIPS.has(state);
            const copy = LABEL_OVERRIDES[state] ?? state;
            return (
              <div
                className={`ex-orb-cell${large ? " ex-orb-cell--lg" : ""}`}
                key={state}
              >
                {large ? (
                  <span className="ex-pill">
                    <ThinkingOrb state={state} size={64} theme="dark" style={{ width: 56, height: 56 }} />
                    <span className="t-shimmer" data-text={`${cap(copy)}….`}>{cap(copy)}….</span>
                  </span>
                ) : (
                  <span className="ex-chip">
                    <ThinkingOrb state={state} size={20} theme="dark" />
                    <span className="t-shimmer" data-text={`Agent ${copy}…`}>Agent {copy}…</span>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="detail-playground-label">Playground</p>

      <div className="pg">
      <div className="pg-stage">
        {/* key remounts the canvas on state/size change, matching the live playground */}
        <ThinkingOrb
          key={`${state}-${size}`}
          state={state}
          size={size}
          paused={paused}
          theme="dark"
          gravity={gravity && gravityAvailable ? { sprite: MAC_ARROW } : false}
        />
        <button
          type="button"
          className="btn-animate pg-play"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={!paused}
        >
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <div className="pg-controls">
        <div className="pg-field" role="radiogroup" aria-label="Orb state">
          <span className="pg-label">State</span>
          <div className="pg-tabs">
            {STATES.map((s) => (
              <button
                key={s}
                type="button"
                className="pg-tab"
                role="radio"
                aria-checked={state === s}
                data-active={state === s}
                onClick={() => setState(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="pg-field" role="radiogroup" aria-label="Orb size">
          <span className="pg-label">Size</span>
          <div className="pg-tabs">
            {SIZES.map((s) => (
              <button
                key={s}
                type="button"
                className="pg-tab"
                role="radio"
                aria-checked={size === s}
                data-active={size === s}
                onClick={() => setSize(s)}
              >
                {s}px
              </button>
            ))}
          </div>
        </div>

        <div className="pg-field" role="radiogroup" aria-label="Cursor gravity">
          <span className="pg-label">Cursor gravity</span>
          <div className="pg-tabs">
            {([false, true] as const).map((on) => (
              <button
                key={String(on)}
                type="button"
                className="pg-tab"
                role="radio"
                aria-checked={gravity === on}
                data-active={gravity === on}
                onClick={() => setGravity(on)}
              >
                {on ? "On" : "Off"}
              </button>
            ))}
          </div>
          {gravity && !gravityAvailable && (
            <span className="pg-note">Draws the macOS pointer, so it only shows on a Mac.</span>
          )}
        </div>

        {/* What the Studio adds past State, Size and Gravity, in its own
            order: Motion, Dots (the picker and both density knobs), the
            Gravity sliders, and a state's Effect settings. Values are the
            Studio's defaults for the listening / working states. */}
        <StudioTeaser
          rows={[
            { kind: "slider", label: "Speed", value: "1\u00d7", fill: 27 },
            { kind: "swatches", label: "Color", colors: ["#ededed", "#7cd4ff", "#ffd28f", "#ff9ec9", "#9fe8a8"] },
            { kind: "slider", label: "Dots amount", value: "207", fill: 37 },
            { kind: "slider", label: "Dot size", value: "1\u00d7", fill: 33 },
            { kind: "slider", label: "Reach", value: "160px", fill: 63 },
            { kind: "slider", label: "Bend", value: "19px", fill: 79 },
            { kind: "slider", label: "Orbit paths", value: "50%", fill: 50 },
          ]}
        />
      </div>

      </div>

      <CodeBlock code={snippet} label="Copy playground snippet" className="pg-snippet" />
      {SHOW_GRAVITY_DEV && <GravityDevPanel enabled={gravity} onToggle={setGravity} available={gravityAvailable} />}
    </>
  );
}

const el = document.getElementById("playground-root");
if (el) {
  createRoot(el).render(
    <StrictMode>
      <OrbPlayground />
    </StrictMode>
  );
}
