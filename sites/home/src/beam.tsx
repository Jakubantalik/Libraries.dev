import { StrictMode, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { BorderBeam, type BorderBeamSize, type BorderBeamColorVariant } from "border-beam";
import {
  MockChatInput,
  MockIconButton,
  MockSearchBar,
} from "./examples/beam-mocks";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser } from "./examples/StudioTeaser";
import { PgTabs } from "./examples/PgTabs";

/* Beam detail page — one React island rendering the whole playground grid
   (stage + controls) plus the live-updating snippet below it. Controls
   mirror the live beam site (sites/beam/src/App.tsx): family tabs, type,
   color, play/pause. The preview starts ACTIVE (beam convention). */

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

/* Same markup as the static blocks' copy buttons; wired in React because
   the page-level script only binds [data-copy-static] buttons that exist
   before the island mounts. */

type BeamFamily = "rotate" | "pulse";

const FAMILY_OPTIONS = [
  { value: "rotate", label: "Rotate" },
  { value: "pulse", label: "Pulse" },
] as const;

const SIZE_OPTIONS_BY_FAMILY: Record<BeamFamily, ReadonlyArray<{ value: BorderBeamSize; label: string }>> = {
  rotate: [
    { value: "md", label: "Large" },
    { value: "line", label: "Line" },
  ],
  pulse: [
    { value: "pulse-inner", label: "Pulse Inner" },
    { value: "pulse-outside", label: "Pulse Outside" },
  ],
};

/* The small rotate beam is a Studio size; it shows here, locked. */
const SIZES_LOCKED_BY_FAMILY: Record<BeamFamily, readonly string[]> = {
  rotate: ["Small"],
  pulse: [],
};

const DEFAULT_SIZE_BY_FAMILY: Record<BeamFamily, BorderBeamSize> = {
  rotate: "md",
  pulse: "pulse-inner",
};

/* Two palettes here; the other six live in the Studio and show locked. */
const COLOR_OPTIONS = [
  { value: "colorful", label: "Colorful" },
  { value: "mono", label: "Mono" },
] as const;
const COLORS_LOCKED = ["Ocean", "Sunset", "Forest", "Candy", "Ice", "Gold"];

/* Tuned CSS vars for the pulse-outside preview — same values the live beam
   site applies so the outward bloom reads right on a dark stage. */
const PULSE_OUTSIDE_TUNED_VARS = {
  "--sub-glow-offset-x": "1px",
  "--sub-glow-offset-y": "0px",
  "--sub-core-blur": "10px",
  "--sub-bloom-blur": "19px",
  "--sub-glow-opacity-mul": 1.71,
} as CSSProperties;

function DemoCard() {
  return (
    <div className="beam-card">
      <div className="beam-card-line beam-card-line--title" />
      <div className="beam-card-line" />
      <div className="beam-card-line beam-card-line--short" />
    </div>
  );
}

function BeamPlayground() {
  const [family, setFamily] = useState<BeamFamily>("rotate");
  const [size, setSize] = useState<BorderBeamSize>("md");
  const [colorVariant, setColorVariant] = useState<BorderBeamColorVariant>("colorful");
  /* The playground stage is paused on arrival, like every other library's:
     it only animates once you press Play. The examples above run on their
     own — they are the library introducing itself, not a control. */
  const [active, setActive] = useState(false);

  const handleFamilyChange = useCallback((next: BeamFamily) => {
    setFamily(next);
    setSize(DEFAULT_SIZE_BY_FAMILY[next]);
  }, []);

  const isPulseOutside = size === "pulse-outside";

  /* Live snippet: current control state, props at their defaults omitted. */
  const props: string[] = [];
  if (size !== "md") props.push(` size="${size}"`);
  if (colorVariant !== "colorful") props.push(` colorVariant="${colorVariant}"`);
  if (!active) props.push(" active={false}");
  const snippet = `<BorderBeam${props.join("")}>
  <Card>Content</Card>
</BorderBeam>`;

  return (
    <>
      {/* The demo page's own examples come first: real UI wearing the
          effect, before any knobs. The playground below is for trying a
          setting, not for meeting the library. */}
      <div className="detail-examples">
        <div className="example-row-full">
          <BorderBeam className="beam-host" size="md" colorVariant="colorful" theme="dark">
            <MockChatInput />
          </BorderBeam>
        </div>
        <div className="example-row-split">
          <div className="example-cell">
            <BorderBeam className="beam-host" size="sm" colorVariant="colorful" theme="dark">
              <MockIconButton />
            </BorderBeam>
          </div>
          <div className="example-cell">
            <BorderBeam
              className="beam-host"
              size="line"
              colorVariant="colorful"
              theme="dark"
              duration={3.1}
              borderRadius={20}
            >
              <MockSearchBar />
            </BorderBeam>
          </div>
        </div>
      </div>

      <p className="detail-playground-label">Playground</p>

      <div className="pg">
        <div className="pg-stage" id="playground-stage">
          <BorderBeam
            size={size}
            colorVariant={colorVariant}
            theme="dark"
            active={active}
            style={isPulseOutside ? PULSE_OUTSIDE_TUNED_VARS : undefined}
          >
            <DemoCard />
          </BorderBeam>
          <button
            type="button"
            className="btn-animate pg-play"
            onClick={() => setActive((a) => !a)}
            aria-pressed={active}
          >
            {active ? "Pause" : "Play"}
          </button>
        </div>

        <div className="pg-controls" id="playground-controls">
          <PgTabs label="Family" options={FAMILY_OPTIONS} value={family} onChange={handleFamilyChange} />
          <PgTabs
            label="Type"
            options={SIZE_OPTIONS_BY_FAMILY[family]}
            value={size}
            onChange={setSize}
            extra={SIZES_LOCKED_BY_FAMILY[family]}
          />
          <PgTabs
            label="Color"
            options={COLOR_OPTIONS}
            value={colorVariant}
            onChange={setColorVariant}
            extra={COLORS_LOCKED}
          />
          <StudioTeaser
            rows={[
              { kind: "slider", label: "Duration", value: "1.96s", fill: 27 },
              { kind: "slider", label: "Corner radius", value: "16px", fill: 50 },
              { kind: "slider", label: "Brightness", value: "1.3\u00d7", fill: 47 },
              { kind: "slider", label: "Hue shift", value: "0\u00b0", fill: 50 },
            ]}
          />
        </div>
      </div>

      <CodeBlock code={snippet} label="Copy playground code" className="pg-snippet" />
    </>
  );
}

const rootEl = document.getElementById("playground-root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <BeamPlayground />
    </StrictMode>
  );
}
