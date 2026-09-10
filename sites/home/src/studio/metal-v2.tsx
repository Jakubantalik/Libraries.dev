import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BEND_DEFAULTS,
  CURSOR_LIGHT_DEFAULTS,
  GLOW_DEFAULTS,
  METAL_BADGE_DEFAULTS,
  METAL_TEXT_DEFAULTS,
  MetalBadge,
  MetalFx,
  MetalText,
  resetBendConfig,
  resetCursorLightConfig,
  resetGlowConfig,
  setBendConfig,
  setCursorLightConfig,
  setGlowConfig,
  useMetalBend,
  useMetalTextReflection,
  type MetalFxPreset,
} from "metal-fx";
import { useMetalCursorSprite } from "../examples/metal-examples-v2";
import { ControlsPanel, PgTabs, PgSlider, PgToggles, PanelSep, Snippet, num, StageBar, PgGroup } from "./controls";

/* Studio — Metal v2 workbench (metal-fx 2, Paper Shaders liquidMetal).

   Types are the metal-fx v2 demo page's components: the circle send button
   (inner-shadow rim, cursor bend, reflection onto a neighbour), the pill
   button, the "Plan Pro" text (metal in the glyphs, "Plan" catches it) and
   the "Live mode · New" badge. The public playground exposes Circle button
   and Text; Button and Badge are Studio-only.

   Per-instance props go on the component. The glow, the cursor bend and
   the cursor reflection are engine-wide (one pointer, one shared renderer),
   tuned through setGlowConfig / setBendConfig / setCursorLightConfig, and
   the snippet emits those calls whenever a knob left its default. */

export type V2Type = "circle" | "button" | "text" | "badge";

const TYPE_OPTIONS = [
  { value: "circle", label: "Circle button" },
  { value: "button", label: "Button" },
  { value: "text", label: "Text" },
  { value: "badge", label: "Badge" },
] as const;

const PRESET_OPTIONS = [
  { value: "chromatic", label: "Chromatic" },
  { value: "silver", label: "Silver" },
  { value: "gold", label: "Gold" },
] as const;

/* Per-type baselines — what the demo page ships for each component. */
const BASE_STRENGTH: Record<V2Type, number> = { circle: 81, button: 63, text: 90, badge: 90 };
const BASE_SHADER_SCALE: Record<V2Type, number> = {
  circle: 1.3,
  button: 1.6,
  text: METAL_TEXT_DEFAULTS.shaderScale,
  badge: METAL_BADGE_DEFAULTS.shaderScale,
};
const BASE_RING: Record<V2Type, number> = { circle: 2, button: 1, text: 1, badge: 1 };
const BASE_OPACITY: Record<V2Type, number> = {
  circle: 1,
  button: 1,
  text: METAL_TEXT_DEFAULTS.metalOpacity,
  badge: METAL_BADGE_DEFAULTS.metalOpacity,
};
const BADGE_CORE = METAL_BADGE_DEFAULTS.core;

const isRing = (t: V2Type) => t === "circle" || t === "button";

/* Param key -> the knob's own label, for the agent's applied-change line. */
const LABELS: Record<string, string> = {
  version: "Version",
  type: "Type",
  preset: "Color",
  strength: "Strength",
  shaderScale: "Shader scale",
  ring: "Ring width",
  metalOpacity: "Metal opacity",
  innerShadow: "Inner shadow",
  disableGlow: "No Glow",
  disableReflection: "No Reflection",
  noCursor: "No Cursor Reflection",
  noBend: "No Bend",
  paused: "Paused",
  glowIntensity: "Glow intensity",
  glowAppear: "Glow appear",
  glowDisappear: "Glow disappear",
  textGlow: "Text glow",
  textGlowGain: "Text glow gain",
  bendStrength: "Bend strength",
  bendReach: "Bend reach",
  bendMaxDent: "Max dent",
  cursorDistance: "Cursor distance",
  cursorSpecular: "Cursor specular",
  cursorFalloff: "Cursor falloff",
  cursorReach: "Cursor reach",
  badgeCoreSize: "Core size",
  badgeCore: "White core",
  badgeCoreBlur: "Core blur",
  badgeCoreStrength: "Core strength",
  badgeGradient: "Top gradient",
  badgeGlow: "Inner glow",
};

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

/* ── Stages ─────────────────────────────────────────────────────────────
   One component per type, so the hooks that need a mounted element
   (useMetalBend on the ring, useMetalTextReflection on "Plan") run against
   it rather than against a ref that is still null. */

interface RingStageProps {
  type: "circle" | "button";
  preset: MetalFxPreset;
  theme: "dark" | "light";
  strength: number;
  shaderScale?: number;
  ringCssPx?: number;
  innerShadow: boolean;
  paused: boolean;
  disableGlow: boolean;
  disableReflection: boolean;
  playPauseRef: React.RefObject<HTMLButtonElement>;
}

function RingStage({ type, preset, theme, strength, shaderScale, ringCssPx, innerShadow, paused, disableGlow, disableReflection, playPauseRef }: RingStageProps) {
  const searchRef = useRef<HTMLLabelElement>(null);
  const ringRef = useRef<HTMLDivElement>(null);
  useMetalBend(ringRef);
  const targets = useMemo(() => [searchRef, playPauseRef], [playPauseRef]);
  return (
    <div className="metal-stage-row">
      <label ref={searchRef} className="metal-search">
        <SearchIcon />
        <input type="search" placeholder="Search" spellCheck={false} tabIndex={-1} aria-label="Search" />
      </label>
      <MetalFx
        key={type}
        ref={ringRef}
        preset={preset}
        variant={type}
        theme={theme}
        strength={strength}
        shaderScale={shaderScale}
        ringCssPx={ringCssPx}
        innerShadow={innerShadow}
        paused={paused}
        disableGlow={disableGlow}
        reflectionTargets={disableReflection ? undefined : targets}
      >
        {type === "circle" ? (
          <button type="button" className="metal-pill metal-pill--circle metal-pill--send" aria-label="Send">
            <ArrowUpIcon />
          </button>
        ) : (
          <button type="button" className="metal-pill">Upgrade to Pro</button>
        )}
      </MetalFx>
    </div>
  );
}

interface TextStageProps {
  theme: "dark" | "light";
  strength: number;
  metalOpacity: number;
  shaderScale: number;
  innerShadow: boolean;
  glow: boolean;
  glowGain: number;
  disableReflection: boolean;
}

function TextStage({ theme, strength, metalOpacity, shaderScale, innerShadow, glow, glowGain, disableReflection }: TextStageProps) {
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
          theme={theme}
          metalOpacity={metalOpacity}
          shaderScale={shaderScale}
          innerShadow={innerShadow ? METAL_TEXT_DEFAULTS.innerShadow : null}
          glow={glow}
          glowGain={glowGain}
          reflectionTargets={disableReflection ? undefined : planTargets}
        >
          Pro
        </MetalText>
      </div>
    </div>
  );
}

interface BadgeStageProps {
  theme: "dark" | "light";
  strength: number;
  metalOpacity: number;
  shaderScale: number;
  core: { r: number; blur: number; a: number; size: number };
  gradient: number;
  glow: number;
}

function BadgeStage({ theme, strength, metalOpacity, shaderScale, core, gradient, glow }: BadgeStageProps) {
  return (
    <div className="metal-stage-row">
      <div className="mx-card-line mx-card-line--live">
        <span className="mx-live">Live mode</span>
        <MetalBadge strength={strength} theme={theme} metalOpacity={metalOpacity} shaderScale={shaderScale} core={core} gradient={gradient} glow={glow}>
          New
        </MetalBadge>
      </div>
    </div>
  );
}

/* ── Workbench ────────────────────────────────────────────────────────── */

export function MetalStudioV2({
  visible = true, theme = "dark", versionTabs,
}: { visible?: boolean; theme?: "dark" | "light"; versionTabs?: ReactNode }) {
  const [type, setType] = useState<V2Type>("circle");
  const [preset, setPreset] = useState<MetalFxPreset>("chromatic");
  const [strength, setStrength] = useState(BASE_STRENGTH.circle);
  const [shaderScale, setShaderScale] = useState(BASE_SHADER_SCALE.circle);
  const [ring, setRing] = useState(BASE_RING.circle);
  const [metalOpacity, setMetalOpacity] = useState(BASE_OPACITY.circle);
  const [innerShadow, setInnerShadow] = useState(true);
  const [paused, setPaused] = useState(false);
  const [disableGlow, setDisableGlow] = useState(false);
  const [disableReflection, setDisableReflection] = useState(false);
  const [noCursor, setNoCursor] = useState(false);
  const [noBend, setNoBend] = useState(false);
  /* Engine-wide: glow */
  const [glowIntensity, setGlowIntensity] = useState<number>(GLOW_DEFAULTS.haloOpMul);
  const [glowAppear, setGlowAppear] = useState<number>(GLOW_DEFAULTS.relocFadeMs);
  const [glowDisappear, setGlowDisappear] = useState<number>(GLOW_DEFAULTS.relocFadeOutMs);
  const [textGlow, setTextGlow] = useState(false);
  const [textGlowGain, setTextGlowGain] = useState<number>(METAL_TEXT_DEFAULTS.glowGain);
  /* Engine-wide: cursor bend */
  const [bendStrength, setBendStrength] = useState<number>(BEND_DEFAULTS.strength);
  const [bendReach, setBendReach] = useState<number>(BEND_DEFAULTS.reach);
  const [bendMaxDent, setBendMaxDent] = useState<number>(BEND_DEFAULTS.maxDisp);
  /* Engine-wide: cursor reflection */
  const [cursorDistance, setCursorDistance] = useState<number>(CURSOR_LIGHT_DEFAULTS.cursorDistance);
  const [cursorSpecular, setCursorSpecular] = useState<number>(CURSOR_LIGHT_DEFAULTS.cursorStrength);
  const [cursorFalloff, setCursorFalloff] = useState<number>(CURSOR_LIGHT_DEFAULTS.cursorFalloff);
  const [cursorReach, setCursorReach] = useState<number>(CURSOR_LIGHT_DEFAULTS.cursorReach);
  /* Badge layers */
  const [badgeCoreSize, setBadgeCoreSize] = useState<number>(BADGE_CORE.size);
  const [badgeCore, setBadgeCore] = useState<number>(BADGE_CORE.r);
  const [badgeCoreBlur, setBadgeCoreBlur] = useState<number>(BADGE_CORE.blur);
  const [badgeCoreStrength, setBadgeCoreStrength] = useState<number>(BADGE_CORE.a);
  const [badgeGradient, setBadgeGradient] = useState<number>(METAL_BADGE_DEFAULTS.gradient);
  const [badgeGlow, setBadgeGlow] = useState<number>(METAL_BADGE_DEFAULTS.glow);

  const playPauseRef = useRef<HTMLButtonElement>(null);
  useMetalCursorSprite();

  /* Push the engine-wide knobs; restore the defaults when the bench goes. */
  useEffect(() => {
    setGlowConfig({ haloOpMul: glowIntensity, relocFadeMs: glowAppear, relocFadeOutMs: glowDisappear });
  }, [glowIntensity, glowAppear, glowDisappear]);
  useEffect(() => {
    setBendConfig({ enabled: !noBend, strength: bendStrength, reach: bendReach, maxDisp: bendMaxDent });
  }, [noBend, bendStrength, bendReach, bendMaxDent]);
  useEffect(() => {
    setCursorLightConfig({ cursor: !noCursor, cursorDistance, cursorStrength: cursorSpecular, cursorFalloff, cursorReach });
  }, [noCursor, cursorDistance, cursorSpecular, cursorFalloff, cursorReach]);
  useEffect(() => () => { resetGlowConfig(); resetBendConfig(); resetCursorLightConfig(); }, []);

  const handleType = useCallback((t: V2Type) => {
    setType(t);
    setStrength(BASE_STRENGTH[t]);
    setShaderScale(BASE_SHADER_SCALE[t]);
    setRing(BASE_RING[t]);
    setMetalOpacity(BASE_OPACITY[t]);
  }, []);

  /* Agent wiring — keys match the Worker's spec, which owns the ranges. */
  const agentParams: Record<string, unknown> = {
    version: "v2", type, preset, strength, shaderScale, ring, metalOpacity, innerShadow,
    disableGlow, disableReflection, noCursor, noBend, paused,
    glowIntensity, glowAppear, glowDisappear, textGlow, textGlowGain,
    bendStrength, bendReach, bendMaxDent,
    cursorDistance, cursorSpecular, cursorFalloff, cursorReach,
    badgeCoreSize, badgeCore, badgeCoreBlur, badgeCoreStrength, badgeGradient, badgeGlow,
  };

  const applyAgentParams = useCallback((patch: Record<string, unknown>) => {
    /* Type first, through handleType so its baselines land — then explicit
       values in the same patch overwrite them. */
    if (typeof patch.type === "string") handleType(patch.type as V2Type);
    const n = (k: string, set: (v: number) => void) => { if (typeof patch[k] === "number") set(patch[k] as number); };
    const b = (k: string, set: (v: boolean) => void) => { if (typeof patch[k] === "boolean") set(patch[k] as boolean); };
    if (typeof patch.preset === "string") setPreset(patch.preset as MetalFxPreset);
    n("strength", setStrength); n("shaderScale", setShaderScale); n("ring", setRing); n("metalOpacity", setMetalOpacity);
    b("innerShadow", setInnerShadow); b("disableGlow", setDisableGlow); b("disableReflection", setDisableReflection);
    b("noCursor", setNoCursor); b("noBend", setNoBend); b("paused", setPaused);
    n("glowIntensity", setGlowIntensity); n("glowAppear", setGlowAppear); n("glowDisappear", setGlowDisappear);
    b("textGlow", setTextGlow); n("textGlowGain", setTextGlowGain);
    n("bendStrength", setBendStrength); n("bendReach", setBendReach); n("bendMaxDent", setBendMaxDent);
    n("cursorDistance", setCursorDistance); n("cursorSpecular", setCursorSpecular); n("cursorFalloff", setCursorFalloff); n("cursorReach", setCursorReach);
    n("badgeCoreSize", setBadgeCoreSize); n("badgeCore", setBadgeCore); n("badgeCoreBlur", setBadgeCoreBlur); n("badgeCoreStrength", setBadgeCoreStrength);
    n("badgeGradient", setBadgeGradient); n("badgeGlow", setBadgeGlow);
  }, [handleType]);

  /* ── Snippet ── */
  const scaleTouched = shaderScale !== BASE_SHADER_SCALE[type];
  const ringTouched = ring !== BASE_RING[type];
  const opacityTouched = metalOpacity !== BASE_OPACITY[type];
  const s = strength / 100;
  const badgeCoreObj = { r: badgeCore, blur: badgeCoreBlur, a: badgeCoreStrength, size: badgeCoreSize };

  const configLines: string[] = [];
  const imports = new Set<string>();
  const glowTouched = glowIntensity !== GLOW_DEFAULTS.haloOpMul || glowAppear !== GLOW_DEFAULTS.relocFadeMs || glowDisappear !== GLOW_DEFAULTS.relocFadeOutMs;
  if (glowTouched && !disableGlow) {
    imports.add("setGlowConfig");
    const parts: string[] = [];
    if (glowIntensity !== GLOW_DEFAULTS.haloOpMul) parts.push(`haloOpMul: ${num(glowIntensity)}`);
    if (glowAppear !== GLOW_DEFAULTS.relocFadeMs) parts.push(`relocFadeMs: ${glowAppear}`);
    if (glowDisappear !== GLOW_DEFAULTS.relocFadeOutMs) parts.push(`relocFadeOutMs: ${glowDisappear}`);
    configLines.push(`setGlowConfig({ ${parts.join(", ")} }); // halo`);
  }
  const bendTouched = bendStrength !== BEND_DEFAULTS.strength || bendReach !== BEND_DEFAULTS.reach || bendMaxDent !== BEND_DEFAULTS.maxDisp;
  if (isRing(type) && (noBend || bendTouched)) {
    imports.add("setBendConfig");
    if (noBend) configLines.push(`setBendConfig({ enabled: false }); // no cursor bend`);
    else {
      const parts: string[] = [];
      if (bendStrength !== BEND_DEFAULTS.strength) parts.push(`strength: ${num(bendStrength)}`);
      if (bendReach !== BEND_DEFAULTS.reach) parts.push(`reach: ${num(bendReach)}`);
      if (bendMaxDent !== BEND_DEFAULTS.maxDisp) parts.push(`maxDisp: ${num(bendMaxDent)}`);
      configLines.push(`setBendConfig({ ${parts.join(", ")} }); // cursor bend`);
    }
  }
  const cursorTouched = cursorDistance !== CURSOR_LIGHT_DEFAULTS.cursorDistance || cursorSpecular !== CURSOR_LIGHT_DEFAULTS.cursorStrength
    || cursorFalloff !== CURSOR_LIGHT_DEFAULTS.cursorFalloff || cursorReach !== CURSOR_LIGHT_DEFAULTS.cursorReach;
  if (noCursor || cursorTouched) {
    imports.add("setCursorLightConfig");
    if (noCursor) configLines.push(`setCursorLightConfig({ cursor: false }); // no cursor reflection`);
    else {
      const parts: string[] = [];
      if (cursorDistance !== CURSOR_LIGHT_DEFAULTS.cursorDistance) parts.push(`cursorDistance: ${num(cursorDistance)}`);
      if (cursorSpecular !== CURSOR_LIGHT_DEFAULTS.cursorStrength) parts.push(`cursorStrength: ${num(cursorSpecular)}`);
      if (cursorFalloff !== CURSOR_LIGHT_DEFAULTS.cursorFalloff) parts.push(`cursorFalloff: ${num(cursorFalloff)}`);
      if (cursorReach !== CURSOR_LIGHT_DEFAULTS.cursorReach) parts.push(`cursorReach: ${num(cursorReach)}`);
      configLines.push(`setCursorLightConfig({ ${parts.join(", ")} }); // cursor reflection`);
    }
  }

  let body: string;
  if (isRing(type)) {
    imports.add("MetalFx");
    if (!noBend) imports.add("useMetalBend");
    const props = [`preset="${preset}"`];
    if (type === "circle") props.push(`variant="circle"`);
    if (s !== 1) props.push(`strength={${num(s)}}`);
    if (scaleTouched) props.push(`shaderScale={${num(shaderScale)}}`);
    if (ringTouched) props.push(`ringCssPx={${num(ring)}}`);
    if (innerShadow) props.push("innerShadow");
    if (disableGlow) props.push("disableGlow");
    if (!disableReflection) props.push("reflectionTargets={[siblingRef]}");
    const child = type === "circle" ? `  <button aria-label="Send"><ArrowUpIcon /></button>` : `  <button>Upgrade to Pro</button>`;
    const hook = noBend ? "" : `const ref = useRef(null);\nuseMetalBend(ref); // cursor-driven liquid dent\n\n`;
    body = `${hook}<MetalFx ${noBend ? "" : "ref={ref} "}${props.join(" ")}>\n${child}\n</MetalFx>`;
  } else if (type === "text") {
    imports.add("MetalText");
    if (!disableReflection) imports.add("useMetalTextReflection");
    const props = [`font="500 24px/1.2 Inter, sans-serif"`, `color="#E2E2E2"`];
    if (s !== 1) props.push(`strength={${num(s)}}`);
    if (opacityTouched) props.push(`metalOpacity={${num(metalOpacity)}}`);
    if (scaleTouched) props.push(`shaderScale={${num(shaderScale)}}`);
    if (!innerShadow) props.push("innerShadow={null}");
    if (textGlow) props.push(textGlowGain !== METAL_TEXT_DEFAULTS.glowGain ? `glow glowGain={${num(textGlowGain)}}` : "glow");
    if (!disableReflection) props.push("reflectionTargets={[{ ref: planRef, strength: 0.64 }]}");
    const hook = disableReflection ? "" : `const planRef = useRef(null);\nuseMetalTextReflection(planRef); // "Plan" catches the metal\n\n<span ref={planRef}>Plan</span>\n`;
    body = `${hook}<MetalText ${props.join(" ")}>\n  Pro\n</MetalText>`;
  } else {
    imports.add("MetalBadge");
    const props: string[] = [];
    if (s !== 1) props.push(`strength={${num(s)}}`);
    if (opacityTouched) props.push(`metalOpacity={${num(metalOpacity)}}`);
    if (scaleTouched) props.push(`shaderScale={${num(shaderScale)}}`);
    const coreTouched = badgeCore !== BADGE_CORE.r || badgeCoreBlur !== BADGE_CORE.blur || badgeCoreStrength !== BADGE_CORE.a || badgeCoreSize !== BADGE_CORE.size;
    if (coreTouched) props.push(`core={{ r: ${num(badgeCore)}, blur: ${num(badgeCoreBlur)}, a: ${num(badgeCoreStrength)}, size: ${num(badgeCoreSize)} }}`);
    if (badgeGradient !== METAL_BADGE_DEFAULTS.gradient) props.push(`gradient={${num(badgeGradient)}}`);
    if (badgeGlow !== METAL_BADGE_DEFAULTS.glow) props.push(`glow={${num(badgeGlow)}}`);
    body = `<MetalBadge${props.length ? " " + props.join(" ") : ""}>New</MetalBadge>`;
  }
  const importLine = `import { ${[...imports].join(", ")} } from 'metal-fx';`;
  const snippet = [importLine, "", ...(configLines.length ? [...configLines, ""] : []), body].join("\n");

  const stageStrength = s;

  return (
    <div className="pg">
      <StageBar library="Metal" prompt={{ pkg: "metal-fx", docsPath: "/metal.html", snippet }} agent={{ libraryId: "metal", params: agentParams, labels: LABELS, onApply: applyAgentParams }} />
      <div className="pg-stage">
        {visible && isRing(type) && (
          <RingStage
            type={type}
            preset={preset}
            theme={theme}
            strength={stageStrength}
            shaderScale={scaleTouched ? shaderScale : undefined}
            ringCssPx={ringTouched ? ring : undefined}
            innerShadow={innerShadow}
            paused={paused}
            disableGlow={disableGlow}
            disableReflection={disableReflection}
            playPauseRef={playPauseRef}
          />
        )}
        {visible && type === "text" && (
          <TextStage
            theme={theme}
            strength={stageStrength}
            metalOpacity={metalOpacity}
            shaderScale={shaderScale}
            innerShadow={innerShadow}
            glow={textGlow && !disableGlow}
            glowGain={textGlowGain}
            disableReflection={disableReflection}
          />
        )}
        {visible && type === "badge" && (
          <BadgeStage
            theme={theme}
            strength={stageStrength}
            metalOpacity={metalOpacity}
            shaderScale={shaderScale}
            core={badgeCoreObj}
            gradient={badgeGradient}
            glow={badgeGlow}
          />
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

      <ControlsPanel
        library="Metal"
        agent={{ libraryId: "metal", params: agentParams, labels: LABELS, onApply: applyAgentParams }}
      >
        {versionTabs}
        <PgTabs label="Type" options={TYPE_OPTIONS} value={type} onChange={handleType} />
        {isRing(type) && <PgTabs label="Color" options={PRESET_OPTIONS} value={preset} onChange={setPreset} />}
        <PanelSep />
        <PgGroup label="Metal effect styling">
          <PgSlider label="Strength" value={strength} min={0} max={100} step={1} display={`${strength}%`} onChange={setStrength} />
          <PgSlider label="Shader scale" value={shaderScale} min={0.6} max={4} step={0.05} display={`${num(shaderScale)}×`} onChange={setShaderScale} />
          {isRing(type) && (
            <PgSlider label="Ring width" value={ring} min={0.5} max={4} step={0.25} display={`${num(ring)}px`} onChange={setRing} />
          )}
          {!isRing(type) && (
            <PgSlider label="Metal opacity" value={metalOpacity} min={0} max={1} step={0.01} display={`${Math.round(metalOpacity * 100)}%`} onChange={setMetalOpacity} />
          )}
        </PgGroup>
        {type === "badge" && (
          <PgGroup label="Badge layers">
            <PgSlider label="Core size" value={badgeCoreSize} min={5} max={100} step={1} display={`${badgeCoreSize}%`} onChange={setBadgeCoreSize} />
            <PgSlider label="White core" value={badgeCore} min={0} max={100} step={1} display={`${badgeCore}%`} onChange={setBadgeCore} />
            <PgSlider label="Core blur" value={badgeCoreBlur} min={0} max={100} step={1} display={`${badgeCoreBlur}%`} onChange={setBadgeCoreBlur} />
            <PgSlider label="Core strength" value={badgeCoreStrength} min={0} max={1} step={0.01} display={num(badgeCoreStrength)} onChange={setBadgeCoreStrength} />
            <PgSlider label="Top gradient" value={badgeGradient} min={0} max={1} step={0.01} display={num(badgeGradient)} onChange={setBadgeGradient} />
            <PgSlider label="Inner glow" value={badgeGlow} min={0} max={1} step={0.01} display={num(badgeGlow)} onChange={setBadgeGlow} />
          </PgGroup>
        )}
        {type !== "badge" && !disableGlow && (
          <PgGroup label="Glow">
            {type === "text" && (
              <PgSlider label="Text glow gain" value={textGlowGain} min={0} max={6} step={0.05} display={`${num(textGlowGain)}×`} onChange={setTextGlowGain} />
            )}
            <PgSlider label="Intensity" value={glowIntensity} min={0} max={2} step={0.01} display={`${num(glowIntensity)}×`} onChange={setGlowIntensity} />
            <PgSlider label="Appear" value={glowAppear} min={0} max={2000} step={10} display={`${glowAppear}ms`} onChange={setGlowAppear} />
            <PgSlider label="Disappear" value={glowDisappear} min={0} max={3000} step={10} display={`${glowDisappear}ms`} onChange={setGlowDisappear} />
          </PgGroup>
        )}
        {isRing(type) && !noBend && (
          <PgGroup label="Cursor bend">
            <PgSlider label="Strength" value={bendStrength} min={0} max={3} step={0.01} display={`${num(bendStrength)}×`} onChange={setBendStrength} />
            <PgSlider label="Reach" value={bendReach} min={0} max={120} step={1} display={`${bendReach}px`} onChange={setBendReach} />
            <PgSlider label="Max dent" value={bendMaxDent} min={0} max={30} step={0.5} display={`${num(bendMaxDent)}px`} onChange={setBendMaxDent} />
          </PgGroup>
        )}
        {!noCursor && (
          <PgGroup label="Cursor reflection">
            <PgSlider label="Distance" value={cursorDistance} min={4} max={200} step={1} display={`${cursorDistance}px`} onChange={setCursorDistance} />
            <PgSlider label="Specular" value={cursorSpecular} min={0} max={4} step={0.05} display={num(cursorSpecular)} onChange={setCursorSpecular} />
            <PgSlider label="Falloff" value={cursorFalloff} min={2} max={60} step={1} display={`${cursorFalloff}px`} onChange={setCursorFalloff} />
            <PgSlider label="Reach" value={cursorReach} min={1} max={30} step={0.5} display={`${num(cursorReach)}px`} onChange={setCursorReach} />
          </PgGroup>
        )}
        <PgToggles
          label="Options"
          options={[
            ...(type !== "badge" ? [{ label: "No Glow", active: disableGlow, onToggle: () => setDisableGlow((g) => !g) }] : []),
            ...(type === "text" ? [{ label: "Text Glow", active: textGlow, onToggle: () => setTextGlow((g) => !g) }] : []),
            ...(type !== "badge" ? [{ label: "No Reflection", active: disableReflection, onToggle: () => setDisableReflection((r) => !r) }] : []),
            ...(type !== "badge" ? [{ label: "No Inner Shadow", active: !innerShadow, onToggle: () => setInnerShadow((v) => !v) }] : []),
            ...(isRing(type) ? [{ label: "No Bend", active: noBend, onToggle: () => setNoBend((v) => !v) }] : []),
            { label: "No Cursor Reflection", active: noCursor, onToggle: () => setNoCursor((v) => !v) },
          ]}
        />
      </ControlsPanel>

      <Snippet code={snippet} />
    </div>
  );
}
