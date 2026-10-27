import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { CodeBlock } from "./examples/CodeCopy";
import { MetalExamplesV2, useMetalCursorSprite } from "./examples/metal-examples-v2";
import { StudioTeaser } from "./examples/StudioTeaser";
import { PgTabs } from "./examples/PgTabs";
import { MetalFx, MetalText, setCursorLightConfig, useMetalBend, useMetalTextReflection } from "metal-fx";

/* Metal detail page — playground island (stage + controls + live snippet).

   metal-fx 2 (Paper Shaders liquidMetal engine). Types: Circle button,
   Text — each with the settings the demo page ships (rim on the circle,
   cursor bend, glyph metal with its inner shadow). The pill button and
   the New badge show in the examples above; as types they live in the
   Studio only.

   Strength stays at the demo's baseline (90%) rather than being exposed
   here, since the Studio tunes it in full. */

const STRENGTH = 90;

type V2Type = "circle" | "text";
const V2_TYPES: Array<{ id: V2Type; label: string }> = [
  { id: "circle", label: "Circle button" },
  { id: "text", label: "Text" },
];
const V2_TYPE_OPTIONS = V2_TYPES.map((t) => ({ value: t.id, label: t.label }));
/* The other two v2 components are the Studio's; they show here, locked. */
const V2_TYPES_LOCKED = ["Button", "Badge"];

function buildSnippetV2(type: V2Type, strength: number, disableGlow: boolean, disableReflection: boolean, noCursor: boolean): string {
  const s = strength !== 1 ? ` strength={${strength.toFixed(2)}}` : "";
  const g = disableGlow ? " disableGlow" : "";
  const r = disableReflection ? "" : " reflectionTargets={[siblingRef]}";
  const body = snippetBodyV2(type, s, g, r);
  // Cursor reflection is global (one pointer): a sprite of the OS pointer
  // gets lit by the nearest metal. Off = one config call.
  return noCursor
    ? `import { setCursorLightConfig } from 'metal-fx';\nsetCursorLightConfig({ cursor: false }); // no cursor reflection\n\n${body}`
    : body;
}

function snippetBodyV2(type: V2Type, s: string, g: string, r: string): string {
  switch (type) {
    case "circle":
      return [
        `import { MetalFx, useMetalBend } from 'metal-fx';`,
        ``,
        `const ref = useRef(null);`,
        `useMetalBend(ref); // cursor-driven liquid dent`,
        ``,
        `<MetalFx ref={ref} preset="chromatic" variant="circle" innerShadow${s}${g}${r}>`,
        `  <button aria-label="Send"><ArrowUpIcon /></button>`,
        `</MetalFx>`,
      ].join("\n");
    case "text":
      return [
        `import { MetalText, useMetalTextReflection } from 'metal-fx';`,
        ``,
        `const planRef = useRef(null);`,
        `useMetalTextReflection(planRef); // "Plan" catches the metal`,
        ``,
        `<span ref={planRef}>Plan</span>`,
        `<MetalText font="500 24px/1.2 Inter, sans-serif" color="#E2E2E2"${s}${r ? " reflectionTargets={[{ ref: planRef, strength: 0.64 }]}" : ""}>`,
        `  Pro`,
        `</MetalText>`,
      ].join("\n");
  }
}

function ArrowUpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 18 18" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="m16 16-3.5-3.5" />
    </svg>
  );
}

/* ── v2 stage ─────────────────────────────────────────────────────────── */

function StageV2({
  type, paused, disableGlow, disableReflection,
}: { type: V2Type; paused: boolean; disableGlow: boolean; disableReflection: boolean }) {
  useMetalCursorSprite();
  // Each type is its own component so the hooks that need a mounted element
  // (useMetalBend on the send button, useMetalTextReflection on "Plan") run
  // against it. One component with a conditional return ran them once, with
  // a null ref, and the type mounted later never got its bend / glyph mask.
  return type === "text"
    ? <TextStageV2 disableReflection={disableReflection} />
    : <CircleStageV2 paused={paused} disableGlow={disableGlow} disableReflection={disableReflection} />;
}

function TextStageV2({ disableReflection }: { disableReflection: boolean }) {
  const strength = STRENGTH / 100;
  const planRef = useRef<HTMLSpanElement>(null);
  useMetalTextReflection(planRef);
  const planTargets = useMemo(() => [{ ref: planRef, strength: 0.64 }], []);
  return (
    <div className="metal-stage-row">
      <div className="mx-card-line mx-card-line--plan">
        <span ref={planRef} className="mx-plan">Plan</span>
        <MetalText
          font="500 24px/1.2 Inter, sans-serif"
          color="#E2E2E2"
          strength={strength}
          theme="dark"
          reflectionTargets={disableReflection ? undefined : planTargets}
          glow={false}
        >
          Pro
        </MetalText>
      </div>
    </div>
  );
}

function CircleStageV2({
  paused, disableGlow, disableReflection,
}: { paused: boolean; disableGlow: boolean; disableReflection: boolean }) {
  const strength = STRENGTH / 100;
  const searchRef = useRef<HTMLLabelElement>(null);
  const sendRef = useRef<HTMLDivElement>(null);
  useMetalBend(sendRef);
  const searchTargets = useMemo(() => [searchRef], []);
  return (
    <div className="metal-stage-row">
      <label ref={searchRef} className="metal-search">
        <SearchIcon />
        <input type="search" placeholder="Search" spellCheck={false} tabIndex={-1} aria-label="Search" />
      </label>
      <MetalFx
        ref={sendRef}
        preset="chromatic"
        variant="circle"
        theme="dark"
        strength={strength * 0.9}
        paused={paused}
        disableGlow={disableGlow}
        innerShadow
        reflectionTargets={disableReflection ? undefined : searchTargets}
      >
        <button type="button" className="metal-pill metal-pill--circle metal-pill--send" aria-label="Send">
          <ArrowUpIcon />
        </button>
      </MetalFx>
    </div>
  );
}

function MetalPlayground() {
  const [v2Type, setV2Type] = useState<V2Type>("circle");
  // Starts paused so the page loads quietly (same as the live playground).
  const [paused, setPaused] = useState(true);
  const [disableGlow, setDisableGlow] = useState(false);
  const [disableReflection, setDisableReflection] = useState(false);
  // The ring lights the pointer (macOS sprite). Off by default on
  // this page, an opt-in option: the pointer sprite is a lot of motion to
  // meet before you've touched anything. Global config, so it is applied as
  // an effect and the library default (on) is restored when the page
  // unmounts.
  const [cursorReflection, setCursorReflection] = useState(false);
  useEffect(() => {
    setCursorLightConfig({ cursor: cursorReflection });
    return () => setCursorLightConfig({ cursor: true });
  }, [cursorReflection]);

  const snippet = buildSnippetV2(v2Type, STRENGTH / 100, disableGlow, disableReflection, !cursorReflection);

  return (
    <>
      <MetalExamplesV2 strength={STRENGTH / 100} />

      <p className="detail-playground-label">Playground</p>

      <div className="pg">
      <div className="pg-stage">
        <StageV2 type={v2Type} paused={paused} disableGlow={disableGlow} disableReflection={disableReflection} />

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
        <PgTabs
          label="Type"
          options={V2_TYPE_OPTIONS}
          value={v2Type}
          onChange={setV2Type}
          extra={V2_TYPES_LOCKED}
        />

        <div className="pg-field">
          <span className="pg-label">Options</span>
          <div className="pg-tabs">
            <button
              type="button"
              className="pg-toggle"
              aria-pressed={disableGlow}
              data-active={disableGlow}
              onClick={() => setDisableGlow((g) => !g)}
            >
              No Glow
            </button>
            <button
              type="button"
              className="pg-toggle"
              aria-pressed={disableReflection}
              data-active={disableReflection}
              onClick={() => setDisableReflection((r) => !r)}
            >
              No Reflection
            </button>
            <button
              type="button"
              className="pg-toggle"
              aria-pressed={cursorReflection}
              data-active={cursorReflection}
              onClick={() => setCursorReflection((c) => !c)}
            >
              Cursor Reflection
            </button>
          </div>
        </div>
        <StudioTeaser
          rows={[
            { kind: "tabs", label: "Color", options: ["Chromatic", "Silver", "Gold"] },
            { kind: "slider", label: "Strength", value: "90%", fill: 90 },
            { kind: "slider", label: "Glow strength", value: "100%", fill: 100 },
            { kind: "slider", label: "Shader scale", value: "1.6×", fill: 42 },
          ]}
        />
      </div>

      </div>

      <CodeBlock code={snippet} label="Copy playground snippet" className="pg-snippet" />
    </>
  );
}

const el = document.getElementById("playground-root");
if (el) {
  createRoot(el).render(
    /* No StrictMode: metal-fx keeps one shared renderer per engine, and the
       simulated double-mount destroys it in a state its loop never
       recovers from — everything paints one frame and freezes. The
       library's own demo mounts without StrictMode too. */
    <MetalPlayground />
  );
}
