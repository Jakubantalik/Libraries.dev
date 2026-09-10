import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { CodeBlock } from "./examples/CodeCopy";
import { MetalExamples } from "./examples/metal-examples";
import { MetalExamplesV2, useMetalCursorSprite } from "./examples/metal-examples-v2";
import { StudioTeaser } from "./examples/StudioTeaser";
import { MetalFx as MetalFxV1, type MetalFxPreset, type MetalFxVariant } from "metal-fx-v1";
import { MetalFx, MetalText, setCursorLightConfig, useMetalBend, useMetalTextReflection } from "metal-fx";

/* Metal detail page — playground island (stage + controls + live snippet).

   Two families:
     v2 — metal-fx 2 (Paper Shaders liquidMetal engine). Types: Circle
          button, Text — each with the settings the v2 demo page ships
          (rim on the circle, cursor bend, glyph metal with its inner
          shadow). The pill button and the New badge show in the examples
          above; as types they live in the Studio only.
     v1 — metal-fx 1.0.4 as published, unchanged: Button / Circle.

   Preset and strength stay at the demo's baseline (chromatic at 90%)
   rather than being exposed here, since the Studio tunes them in full. */

const PRESET: MetalFxPreset = "chromatic";
const STRENGTH = 90;

type Family = "v2" | "v1";
const FAMILIES: Array<{ id: Family; label: string }> = [
  { id: "v2", label: "v2" },
  { id: "v1", label: "v1" },
];

type V2Type = "circle" | "text";
const V2_TYPES: Array<{ id: V2Type; label: string }> = [
  { id: "circle", label: "Circle button" },
  { id: "text", label: "Text" },
];

const V1_VARIANTS: MetalFxVariant[] = ["button", "circle"];

function buildSnippetV1(
  variant: MetalFxVariant,
  preset: MetalFxPreset,
  strength: number,
  disableGlow: boolean,
  disableReflection: boolean
): string {
  const props = [`preset="${preset}"`];
  if (variant !== "button") props.push(`variant="${variant}"`);
  if (strength !== 1) props.push(`strength={${strength.toFixed(2)}}`);
  if (disableGlow) props.push("disableGlow");
  if (!disableReflection) props.push("reflectionTargets={[siblingRef]}");
  const child = variant === "circle"
    ? `  <button aria-label="Send"><ArrowUpIcon /></button>`
    : `  <button>Upgrade to Pro</button>`;
  return `// npm install metal-fx@1\nimport { MetalFx } from 'metal-fx';\n\n<MetalFx ${props.join(" ")}>\n${child}\n</MetalFx>`;
}

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

/* ── v1 stage (as published) ──────────────────────────────────────────── */

function StageV1({
  variant, paused, disableGlow, disableReflection, playPauseRef,
}: { variant: MetalFxVariant; paused: boolean; disableGlow: boolean; disableReflection: boolean; playPauseRef: RefObject<HTMLButtonElement> }) {
  const searchRef = useRef<HTMLLabelElement>(null);
  const reflectionTargets = disableReflection ? undefined : [searchRef, playPauseRef];
  return (
    <div className="metal-stage-row">
      <label ref={searchRef} className="metal-search">
        <SearchIcon />
        <input type="search" placeholder="Search" spellCheck={false} tabIndex={-1} aria-label="Search" />
      </label>
      {/* key remounts the WebGL instance on variant change, matching the live demo */}
      <MetalFxV1
        key={variant}
        preset={PRESET}
        variant={variant}
        theme="dark"
        strength={STRENGTH / 100}
        paused={paused}
        disableGlow={disableGlow}
        reflectionTargets={reflectionTargets}
      >
        {variant === "circle" ? (
          <button type="button" className="metal-pill metal-pill--circle" aria-label="Send">
            <ArrowUpIcon />
          </button>
        ) : (
          <button type="button" className="metal-pill">Upgrade to Pro</button>
        )}
      </MetalFxV1>
    </div>
  );
}

function MetalPlayground() {
  const [family, setFamily] = useState<Family>("v2");
  const [v2Type, setV2Type] = useState<V2Type>("circle");
  const [variant, setVariant] = useState<MetalFxVariant>("button");
  // Starts paused so the page loads quietly (same as the live playground).
  const [paused, setPaused] = useState(true);
  const [disableGlow, setDisableGlow] = useState(false);
  const [disableReflection, setDisableReflection] = useState(false);
  // v2 only: the ring lights the pointer (macOS sprite). Global config, so
  // it is applied as an effect and restored when the page unmounts.
  const [noCursor, setNoCursor] = useState(false);
  useEffect(() => {
    setCursorLightConfig({ cursor: family === "v2" && !noCursor });
    return () => setCursorLightConfig({ cursor: true });
  }, [family, noCursor]);
  const playPauseRef = useRef<HTMLButtonElement>(null);

  const snippet = family === "v2"
    ? buildSnippetV2(v2Type, STRENGTH / 100, disableGlow, disableReflection, noCursor)
    : buildSnippetV1(variant, PRESET, STRENGTH / 100, disableGlow, disableReflection);

  return (
    <>
      {family === "v2" ? <MetalExamplesV2 key="ex-v2" strength={STRENGTH / 100} /> : <MetalExamples key="ex-v1" strength={STRENGTH / 100} />}

      <p className="detail-playground-label">Playground</p>

      <div className="pg">
      <div className="pg-stage">
        {family === "v2" ? (
          <StageV2 key="stage-v2" type={v2Type} paused={paused} disableGlow={disableGlow} disableReflection={disableReflection} />
        ) : (
          <StageV1 key="stage-v1" variant={variant} paused={paused} disableGlow={disableGlow} disableReflection={disableReflection} playPauseRef={playPauseRef} />
        )}

        <button
          ref={playPauseRef}
          type="button"
          className="btn-animate pg-play"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={!paused}
        >
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <div className="pg-controls">
        <div className="pg-field" role="radiogroup" aria-label="Version">
          <span className="pg-label">Version</span>
          <div className="pg-tabs">
            {FAMILIES.map((f) => (
              <button
                key={f.id}
                type="button"
                className="pg-tab"
                role="radio"
                aria-checked={family === f.id}
                data-active={family === f.id}
                onClick={() => setFamily(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pg-field" role="radiogroup" aria-label="Component type">
          <span className="pg-label">Type</span>
          <div className="pg-tabs">
            {family === "v2"
              ? V2_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="pg-tab"
                    role="radio"
                    aria-checked={v2Type === t.id}
                    data-active={v2Type === t.id}
                    onClick={() => setV2Type(t.id)}
                  >
                    {t.label}
                  </button>
                ))
              : V1_VARIANTS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="pg-tab"
                    role="radio"
                    aria-checked={variant === v}
                    data-active={variant === v}
                    onClick={() => setVariant(v)}
                  >
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
          </div>
        </div>

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
            {family === "v2" && (
              <button
                type="button"
                className="pg-toggle"
                aria-pressed={noCursor}
                data-active={noCursor}
                onClick={() => setNoCursor((c) => !c)}
              >
                No Cursor Reflection
              </button>
            )}
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
