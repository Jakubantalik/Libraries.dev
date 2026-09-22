import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  VoiceBeam,
  useMicrophone,
  resolveVoiceDefaults,
  resolveVoiceStyle,
  voicePalettes,
  parseRgb,
  type VoiceBeamColorVariant,
  type VoiceBeamLook,
  type VoiceBeamType,
  type VoiceGeometry,
} from "voice-glow";
import { ControlsPanel, PgTabs, PgSlider, PgToggles, PgSwatches, PanelSep, Snippet, num, StageBar, PgGroup } from "./controls";
import { checkCss, tpl, type CoreWiring } from "./core";
import { ChatInputMock } from "../examples/beam-mocks";
import { RecordingPill, PhoneScreen, DEMO_TRANSCRIPT, demoGetter, MIC_STATUS } from "../examples/voice-mocks";

/* Studio — Voice workbench. Every prop on the component is a knob
   here: the input chain (sensitivity, gate, attack, release), the shape
   of the reaction (idle presence, reach, spread, bands), and the same
   glow styling surface as the Beam bench, plus the overridable CSS hooks
   --voice-stroke-opacity / --voice-inner-opacity / --voice-bloom-opacity
   and --voice-hue-base.

   Three sources drive the stage. Demo plays a synthetic speech envelope
   so the effect can be judged without a microphone; Microphone asks for
   the real thing through the library's own hook; Manual is a slider, for
   parking the beam at one level while the styling is tuned; Processing is
   the state after the voice — the gathered beam travelling its range. */

type Source = "demo" | "mic" | "manual" | "processing";

/* The host the glow is tuned for. Each type resets the geometry knobs to
   the library's preset and swaps the stage mock (Figma 1561:44248 for the
   pill, 1561:44294 for the phone). */
const TYPE_OPTIONS = [
  { value: "default", label: "Chat input" },
  { value: "pill", label: "Pill" },
  { value: "mobile", label: "Mobile" },
] as const;

/* The stylesheet the library generated for the live instance, with the
   instance id swapped for the {id} placeholder the `css` prop substitutes —
   what the agent starts from when it rebuilds the effect. */
function stockVoiceCss(): string {
  const root = Array.from(document.querySelectorAll<HTMLElement>(".pg-stage [data-voice-beam]")).find((e) => e.offsetWidth > 0);
  const id = root?.getAttribute("data-voice-beam");
  const style = root?.previousElementSibling;
  if (!root || !id || !style || style.tagName !== "STYLE") return "";
  return (style.textContent ?? "").split(id).join("{id}");
}

const LOOK_OPTIONS = [
  { value: "glow", label: "Glow" },
  { value: "dots", label: "Dots" },
] as const;

const RADIUS_BY_TYPE: Record<VoiceBeamType, number> = { default: 20, pill: 106, mobile: 66 };
/* The phone mock is 402×874 shown at 0.68 in a 273×357 crop; the beam wraps the crop. */
const PHONE_CROP = 0.68;
const CHILD_BY_TYPE: Record<VoiceBeamType, string> = {
  default: "<ChatInput />",
  pill: "<RecordingPill />",
  mobile: "<VoiceScreen />",
};

/* Colour helpers: the library's palettes are rgb() strings; the swatch
   rows compare and emit hex. */
function toHex(color: string): string {
  const t = parseRgb(color);
  if (!t) return color;
  return "#" + t.map((v) => v.toString(16).padStart(2, "0")).join("");
}
const LOBE_LABELS = ["Centre", "Inner left", "Inner right", "Outer left", "Outer right", "Far left", "Far right"];
const VARIANTS = ["colorful", "mono", "ocean", "sunset", "forest", "candy", "ice", "gold"] as const;
function paletteHex(variant: VoiceBeamColorVariant, theme: "dark" | "light"): string[] {
  return voicePalettes[variant][theme].map(toHex);
}
/* The library's own band defaults per theme (kept in step with
   BAND_COLORS in VoiceBeam.tsx). */
const BAND_DEFAULTS: Record<"dark" | "light", { core: string; above: string; mid: string; below: string }> = {
  dark: { core: "#ffffff", above: "#ff4650", mid: "#5aff96", below: "#508cff" },
  light: { core: "#c58bff", above: "#ff7ab6", mid: "#7ec4ff", below: "#2dffab" },
};
const BAND_SLOTS: Array<[keyof (typeof BAND_DEFAULTS)["dark"], string]> = [
  ["core", "Band core"], ["above", "Fringe above"], ["mid", "Fringe between"], ["below", "Fringe below"],
];

/* Geometry keys in the order the snippet lists them. */
const GEOMETRY_KEYS: ReadonlyArray<keyof VoiceGeometry> = [
  "scale", "glowSize", "processingDuration", "processingLevel", "processingTravel", "processingCurve", "cornerFollow", "idle", "reach", "spread", "flow", "bend",
  "bandStrength", "bandWidth", "bandPosition", "bandCurve", "bandSpread", "bandSkew", "bandOffset", "bandTail", "bandTailPosition", "bandTailCurve", "bandTailOverflow", "bandAberration",
  "distortion", "distortionDetail",
  "glowWidth", "glowHeight", "lobeSpacing", "rangeWidth", "rangeHeight", "softness", "coreSize", "coreLight", "coreLightWidth", "coreLightHeight",
  "strokeScale", "innerScale", "innerHeight", "bloomScale", "bloomHeight",
];

const SOURCE_OPTIONS = [
  { value: "demo", label: "Demo voice" },
  { value: "mic", label: "Microphone" },
  { value: "manual", label: "Manual" },
  { value: "processing", label: "Processing" },
] as const;

/* Agent tab: the knob's own label for each prop the agent may set, so the
   applied-change line reads like the panel. The keys match VOICE_SPEC in
   services/studio-agent/spec.ts. */
const VOICE_PARAM_LABELS: Record<string, string> = {
  type: "Type",
  look: "Look",
  dotSize: "Dot size",
  dotGap: "Spacing",
  texture: "Texture",
  gravity: "Gravity",
  colorVariant: "Color theme",
  sensitivity: "Sensitivity",
  threshold: "Threshold",
  attack: "Attack",
  release: "Release",
  reach: "Reach",
  spread: "Spread",
  scale: "Scale",
  glowSize: "Size",
  idle: "Idle presence",
  breathe: "Breathe",
  flow: "Flow",
  bend: "Bend",
  bandStrength: "Band strength",
  bandWidth: "Band width",
  bandPosition: "Band height",
  bandAberration: "Aberration",
  distortion: "Distortion",
  coreLight: "Epicentre",
  coreSize: "Core",
  softness: "Softness",
  strength: "Strength",
  brightness: "Brightness",
  saturation: "Saturation",
  strokeOpacity: "Stroke",
  innerOpacity: "Inner glow",
  bloomOpacity: "Bloom",
  radius: "Corner radius",
  staticColors: "Static colors",
  hueRange: "Hue range",
  hueDuration: "Hue speed",
  hueShift: "Hue shift",
  processingDuration: "Pass duration",
  processingLevel: "Held level",
  processingTravel: "Travel",
  processingCurve: "Turn ease",
  cornerFollow: "Corner follow",
  paused: "Paused",
  core: "Core",
};

const COLOR_OPTIONS = [
  { value: "colorful", label: "Colorful" },
  { value: "mono", label: "Mono" },
  { value: "ocean", label: "Ocean" },
  { value: "sunset", label: "Sunset" },
  { value: "forest", label: "Forest" },
  { value: "candy", label: "Candy" },
  { value: "ice", label: "Ice" },
  { value: "gold", label: "Gold" },
] as const;

export function VoiceStudio({ visible = true, theme = "dark" }: { visible?: boolean; theme?: "dark" | "light" }) {
  const [source, setSource] = useState<Source>("demo");
  const [manualLevel, setManualLevel] = useState(60);
  const [colorVariant, setColorVariant] = useState<VoiceBeamColorVariant>("colorful");
  /* The seven lobe colours and the band's four, as hex — reset to the
     variant's / theme's own whenever either changes. */
  const [lobeColors, setLobeColors] = useState<string[]>(() => paletteHex("colorful", theme));
  const [bandCols, setBandCols] = useState(() => ({ ...BAND_DEFAULTS[theme] }));
  useEffect(() => {
    setLobeColors(paletteHex(colorVariant, theme));
    setBandCols({ ...BAND_DEFAULTS[theme] });
  }, [colorVariant, theme]);
  const defaultStrength = (t: VoiceBeamType, th: "dark" | "light") =>
    Math.round((resolveVoiceStyle(t, th).strength ?? (th === "light" ? 0.8 : 1)) * 100);
  const [strength, setStrength] = useState(() => defaultStrength("default", theme));
  const [radius, setRadius] = useState(RADIUS_BY_TYPE.default);
  const [brightness, setBrightness] = useState(theme === "light" ? 0.95 : 1.1);
  const [saturation, setSaturation] = useState(theme === "light" ? 1.6 : 1.2);
  const [strokeOpacity, setStrokeOpacity] = useState(1);
  const [innerOpacity, setInnerOpacity] = useState(1);
  const [bloomOpacity, setBloomOpacity] = useState(1);
  const [hueRange, setHueRange] = useState(theme === "light" ? 40 : 24);
  const [hueDuration, setHueDuration] = useState(theme === "light" ? 8.5 : 12);
  const [hueShift, setHueShift] = useState(0);
  const [staticColors, setStaticColors] = useState(false);
  const [sensitivity, setSensitivity] = useState(3.1);
  const [threshold, setThreshold] = useState(0.015);
  const [attack, setAttack] = useState(0.325);
  const [release, setRelease] = useState(0.86);
  const [type, setType] = useState<VoiceBeamType>("default");
  const [geo, setGeo] = useState<VoiceGeometry>(() => resolveVoiceDefaults("default", theme));
  const [breathe, setBreathe] = useState(5.2);
  const [processingEase, setProcessingEase] = useState(0.6);
  const [bands, setBands] = useState(true);
  /* Pause holds the effect where it is (the library's `paused`); the
     effect itself stays on. */
  const [paused, setPaused] = useState(false);
  /* The look: coloured light, or the same light as a field of dots. */
  const [look, setLook] = useState<VoiceBeamLook>("glow");
  const [dotSize, setDotSize] = useState(1);
  const [dotGap, setDotGap] = useState(1);
  const [texture, setTexture] = useState(0.6);
  const [gravity, setGravity] = useState(1);
  const isDots = look === "dots";
  /* A stylesheet the agent rewrote, appended after the generated one; "" is
     the stock effect. */
  const [core, setCore] = useState("");
  const coreWiring: CoreWiring = { lang: "css", source: stockVoiceCss, check: checkCss };
  /* Bumped whenever the "simulation" (re)starts, to replay the phone's
     prompt and restart the pill's counter. */
  const [runKey, setRunKey] = useState(0);
  /* The words heard so far in this run, for the phone's live transcript. */
  const [transcript, setTranscript] = useState<string[]>([]);

  const setG = useCallback(
    (key: keyof VoiceGeometry) => (v: number) => setGeo((g) => ({ ...g, [key]: v })),
    []
  );

  /* Switching type resets the geometry to that preset and the radius to
     the mock's own, so the snippet starts minimal. */
  const handleTypeChange = useCallback((next: VoiceBeamType) => {
    setType(next);
    setGeo(resolveVoiceDefaults(next, theme));
    setStrength(defaultStrength(next, theme));
    setRadius(RADIUS_BY_TYPE[next]);
    setBrightness(resolveVoiceStyle(next, theme).brightness ?? (theme === "light" ? 0.95 : 1.1));
    setSaturation(resolveVoiceStyle(next, theme).saturation ?? (theme === "light" ? 1.6 : 1.2));
    setRunKey((k) => k + 1);
  }, [theme]);

  /* Agent tab. The geometry lives in one object and the rest in their own
     pieces of state; the agent sees one flat set of props, the same names
     the snippet uses. `processing` is context rather than a knob — it tells
     the spec whether the travelling-beam props are live. */
  const agentParams: Record<string, unknown> = {
    type,
    look,
    dotSize,
    dotGap,
    texture,
    gravity,
    colorVariant,
    sensitivity,
    threshold,
    attack,
    release,
    reach: geo.reach,
    spread: geo.spread,
    scale: geo.scale,
    glowSize: geo.glowSize,
    idle: geo.idle,
    breathe,
    flow: geo.flow,
    bend: geo.bend,
    bandStrength: geo.bandStrength,
    bandWidth: geo.bandWidth,
    bandPosition: geo.bandPosition,
    bandAberration: geo.bandAberration,
    distortion: geo.distortion,
    coreLight: geo.coreLight,
    coreSize: geo.coreSize,
    softness: geo.softness,
    strength,
    brightness,
    saturation,
    strokeOpacity,
    innerOpacity,
    bloomOpacity,
    radius,
    staticColors,
    hueRange,
    hueDuration,
    hueShift,
    processingDuration: geo.processingDuration,
    processingLevel: geo.processingLevel,
    processingTravel: geo.processingTravel,
    processingCurve: geo.processingCurve,
    cornerFollow: geo.cornerFollow,
    paused,
    core,
    processing: source === "processing",
  };

  const applyAgentParams = useCallback((patch: Record<string, unknown>) => {
    /* Type first: it re-tunes the geometry, so anything else in the same
       patch must land on top of the new defaults. */
    if (typeof patch.type === "string") handleTypeChange(patch.type as VoiceBeamType);
    if (patch.look === "glow" || patch.look === "dots") setLook(patch.look);
    if (typeof patch.dotSize === "number") setDotSize(patch.dotSize);
    if (typeof patch.dotGap === "number") setDotGap(patch.dotGap);
    if (typeof patch.texture === "number") setTexture(patch.texture);
    if (typeof patch.gravity === "number") setGravity(patch.gravity);
    if (typeof patch.colorVariant === "string") setColorVariant(patch.colorVariant as VoiceBeamColorVariant);
    if (typeof patch.sensitivity === "number") setSensitivity(patch.sensitivity);
    if (typeof patch.threshold === "number") setThreshold(patch.threshold);
    if (typeof patch.attack === "number") setAttack(patch.attack);
    if (typeof patch.release === "number") setRelease(patch.release);
    if (typeof patch.breathe === "number") setBreathe(patch.breathe);
    if (typeof patch.strength === "number") setStrength(patch.strength);
    if (typeof patch.brightness === "number") setBrightness(patch.brightness);
    if (typeof patch.saturation === "number") setSaturation(patch.saturation);
    if (typeof patch.strokeOpacity === "number") setStrokeOpacity(patch.strokeOpacity);
    if (typeof patch.innerOpacity === "number") setInnerOpacity(patch.innerOpacity);
    if (typeof patch.bloomOpacity === "number") setBloomOpacity(patch.bloomOpacity);
    if (typeof patch.radius === "number") setRadius(patch.radius);
    if (typeof patch.staticColors === "boolean") setStaticColors(patch.staticColors);
    if (typeof patch.hueRange === "number") setHueRange(patch.hueRange);
    if (typeof patch.hueDuration === "number") setHueDuration(patch.hueDuration);
    if (typeof patch.hueShift === "number") setHueShift(patch.hueShift);
    if (typeof patch.paused === "boolean") setPaused(patch.paused);
    if (typeof patch.core === "string") setCore(patch.core);
    /* Everything else is geometry, under the same key it carries here. */
    const GEO_KEYS = [
      "reach", "spread", "scale", "glowSize", "idle", "flow", "bend",
      "bandStrength", "bandWidth", "bandPosition", "bandAberration", "distortion",
      "coreLight", "coreSize", "softness",
      "processingDuration", "processingLevel", "processingTravel", "processingCurve", "cornerFollow",
    ] as const;
    const geoPatch: Partial<VoiceGeometry> = {};
    for (const key of GEO_KEYS) {
      const v = patch[key];
      if (typeof v === "number") geoPatch[key] = v;
    }
    if (Object.keys(geoPatch).length) setGeo((g) => ({ ...g, ...geoPatch }));
  }, [handleTypeChange]);

  useEffect(() => {
    setBrightness(resolveVoiceStyle(type, theme).brightness ?? (theme === "light" ? 0.95 : 1.1));
    setSaturation(resolveVoiceStyle(type, theme).saturation ?? (theme === "light" ? 1.6 : 1.2));
    setHueRange(theme === "light" ? 40 : 24);
    setHueDuration(theme === "light" ? 8.5 : 12);
    setHueShift(0);
    setStrength(defaultStrength(type, theme));
    setGeo(resolveVoiceDefaults(type, theme));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  const mic = useMicrophone();
  const isMic = source === "mic";
  const processing = source === "processing";
  const stream = isMic ? mic.stream : null;

  /* Leaving the Microphone source releases the device; nothing else
     should keep a live microphone open on a page that isn't showing it. */
  useEffect(() => {
    if ((!isMic || !visible) && mic.stream) mic.stop();
  }, [isMic, visible, mic.stream, mic.stop]);

  /* The live level, drawn straight into a meter under the stage without
     going through React state (the driver reports it every frame). */
  const meterRef = useRef<HTMLDivElement | null>(null);
  /* A voice starting after ≥1.2 s of silence counts as a new simulation:
     the phone prompt replays its word-by-word entrance. */
  const silentSince = useRef<number>(performance.now());
  const wasSilent = useRef(true);
  /* Transcript pacing: a word every ~320 ms while the voice is up, the
     whole thing cleared (prompt back) after 2.5 s of silence. */
  const wordIndex = useRef(0);
  const lastWordAt = useRef(0);
  const cleared = useRef(true);
  const onLevel = useCallback((level: number) => {
    const el = meterRef.current;
    if (el) el.style.transform = `scaleX(${level.toFixed(3)})`;
    const now = performance.now();
    if (level < 0.05) {
      if (!wasSilent.current) silentSince.current = now;
      wasSilent.current = true;
      if (!cleared.current && now - silentSince.current > 2500) {
        cleared.current = true;
        wordIndex.current = 0;
        setTranscript([]);
      }
    } else if (wasSilent.current && level > 0.2) {
      wasSilent.current = false;
      if (now - silentSince.current > 1200) setRunKey((k) => k + 1);
    }
    if (level > 0.22 && now - lastWordAt.current > 320 && wordIndex.current < DEMO_TRANSCRIPT.length) {
      wordIndex.current += 1;
      lastWordAt.current = now;
      cleared.current = false;
      setTranscript(DEMO_TRANSCRIPT.slice(0, wordIndex.current));
    }
  }, []);

  /* Source changes restart the simulation too (Play resumes, it does
     not restart). */
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setRunKey((k) => k + 1);
  }, [source]);
  useEffect(() => {
    wordIndex.current = 0;
    cleared.current = true;
    setTranscript([]);
  }, [runKey]);

  const level = source === "manual" ? manualLevel / 100 : source === "demo" ? demoGetter : 0;

  const defaultBrightness = resolveVoiceStyle(type, theme).brightness ?? (theme === "light" ? 0.95 : 1.1);
  const defaultSaturation = resolveVoiceStyle(type, theme).saturation ?? (theme === "light" ? 1.6 : 1.2);

  /* CSS hooks the library reads with fallbacks — only emit touched ones. */
  const varStyle: Record<string, string | number> = {};
  if (hueShift !== 0 && !staticColors) varStyle["--voice-hue-base"] = `${hueShift}deg`;
  if (strokeOpacity !== 1) varStyle["--voice-stroke-opacity"] = num(strokeOpacity);
  if (innerOpacity !== 1) varStyle["--voice-inner-opacity"] = num(innerOpacity);
  if (bloomOpacity !== 1) varStyle["--voice-bloom-opacity"] = num(bloomOpacity);
  const hasVars = Object.keys(varStyle).length > 0;
  const beamStyle = hasVars ? (varStyle as CSSProperties) : undefined;

  /* Live snippet: only non-default props survive. */
  const props: string[] = [];
  if (isDots) props.push(`look="dots"`);
  if (isDots && dotSize !== 1) props.push(`dotSize={${num(dotSize)}}`);
  if (isDots && dotGap !== 1) props.push(`dotGap={${num(dotGap)}}`);
  if (isDots && texture !== 0.6) props.push(`texture={${num(texture)}}`);
  if (isDots && gravity !== 1) props.push(`gravity={${num(gravity)}}`);
  if (isMic) props.push("stream={mic.stream}");
  else if (source === "manual") props.push(`level={${num(manualLevel / 100)}}`);
  else props.push("level={() => yourLevel}");
  if (sensitivity !== 3.1) props.push(`sensitivity={${num(sensitivity)}}`);
  if (threshold !== 0.015) props.push(`threshold={${num(threshold)}}`);
  if (attack !== 0.325) props.push(`attack={${num(attack)}}`);
  if (release !== 0.86) props.push(`release={${num(release)}}`);
  if (type !== "default") props.splice(1, 0, `type="${type}"`);
  if (breathe !== 5.2) props.push(`breatheDuration={${num(breathe)}}`);
  if (processing) props.push("processing");
  if (processingEase !== 0.6) props.push(`processingEase={${num(processingEase)}}`);
  if (!bands) props.push("bands={false}");
  if (colorVariant !== "colorful") props.push(`colorVariant="${colorVariant}"`);
  const paletteDefault = paletteHex(colorVariant, theme);
  if (lobeColors.some((c, i) => c !== paletteDefault[i])) props.push(`colors={[${lobeColors.map((c) => `'${c}'`).join(", ")}]}`);
  const bandDefault = BAND_DEFAULTS[theme];
  const bandDiff = BAND_SLOTS.filter(([k]) => bandCols[k] !== bandDefault[k]);
  if (bandDiff.length) props.push(`bandColors={{ ${bandDiff.map(([k]) => `${k}: '${bandCols[k]}'`).join(", ")} }}`);
  if (theme === "light") props.push(`theme="light"`);
  if (strength !== defaultStrength(type, theme)) props.push(`strength={${num(strength / 100)}}`);
  if (radius !== RADIUS_BY_TYPE[type]) props.push(`borderRadius={${num(radius)}}`);
  const preset = resolveVoiceDefaults(type, theme);
  for (const key of GEOMETRY_KEYS) if (geo[key] !== preset[key]) props.push(`${key}={${num(geo[key])}}`);
  if (brightness !== defaultBrightness) props.push(`brightness={${num(brightness)}}`);
  if (saturation !== defaultSaturation) props.push(`saturation={${num(saturation)}}`);
  if (hueRange !== (theme === "light" ? 40 : 24)) props.push(`hueRange={${num(hueRange)}}`);
  if (hueDuration !== (theme === "light" ? 8.5 : 12)) props.push(`hueDuration={${num(hueDuration)}}`);
  if (staticColors) props.push("staticColors");
  if (paused) props.push("paused");
  if (core) props.push("css={voiceCss}");
  if (hasVars) {
    const varLines = Object.entries(varStyle)
      .map(([k, v]) => `'${k}': ${typeof v === "string" ? `'${v}'` : v}`)
      .join(", ");
    props.push(`style={{ ${varLines} }}`);
  }
  const attrs = "\n  " + props.join("\n  ") + "\n";
  const imports = isMic ? "import { VoiceBeam, useMicrophone } from 'voice-glow';" : "import { VoiceBeam } from 'voice-glow';";
  const decl = (core ? `const voiceCss = ${tpl(core)};\n\n` : "") + (isMic ? "const mic = useMicrophone();\n\n" : "");
  const snippet = `${imports}\n\n${decl}<VoiceBeam${attrs}>\n  ${CHILD_BY_TYPE[type]}\n</VoiceBeam>${isMic ? "\n\n<button onClick={mic.start}>Listen</button>" : ""}`;

  /* Choosing Microphone starts listening right away — the click is the
     user gesture browsers require. Choosing it again retries after a
     refusal; leaving it releases the device (the effect above). */
  const chooseSource = (next: Source) => {
    setSource(next);
    if (next === "mic" && mic.state !== "live" && mic.state !== "requesting") void mic.start();
  };

  return (
    <div className="pg">
      <StageBar library="Voice" prompt={{ pkg: "voice-glow", docsPath: "/studio/app.html#voice", snippet }} agent={{ libraryId: "voice", params: agentParams, labels: VOICE_PARAM_LABELS, onApply: applyAgentParams }} />
      <div className="pg-stage">
        {visible && (
          <VoiceBeam
            type={type}
            look={look}
            dotSize={dotSize}
            dotGap={dotGap}
            texture={texture}
            gravity={gravity}
            stream={stream}
            level={level}
            sensitivity={sensitivity}
            threshold={threshold}
            attack={attack}
            release={release}
            breatheDuration={breathe}
            processing={processing}
            processingEase={processingEase}
            bands={bands}
            colorVariant={colorVariant}
            colors={lobeColors}
            bandColors={bandCols}
            theme={theme}
            css={core || undefined}
            paused={paused}
            strength={strength / 100}
            {...geo}
            /* The phone host wraps its crop (273×357 of the 402×874
               screen), so the glow runs at the crop's 0.68 of the knobs;
               the snippet keeps the real phone's values. */
            scale={type === "mobile" ? geo.scale * PHONE_CROP : geo.scale}
            borderRadius={type === "mobile" ? radius * PHONE_CROP : radius}
            className={type === "mobile" ? "mock-phone-host" : undefined}
            brightness={brightness}
            saturation={saturation}
            hueRange={hueRange}
            hueDuration={hueDuration}
            staticColors={staticColors}
            style={beamStyle}
            onLevel={onLevel}
          >
            {type === "pill" ? (
              <RecordingPill running={!processing} paused={paused} resetKey={runKey} />
            ) : type === "mobile" ? (
              <div className="mock-phone-scale">
                <div className="mock-phone-scale-inner">
                  <PhoneScreen promptKey={runKey} transcript={transcript} />
                </div>
              </div>
            ) : (
              <ChatInputMock radius={radius} />
            )}
          </VoiceBeam>
        )}
        {/* Level meter: a hairline above the Play button that the driver
            scales every frame, so what the knobs do to the envelope is
            visible even when the glow is turned down. Sits 12px over the
            32px button, which rests 20px off the stage's bottom. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            left: "50%",
            bottom: 64,
            transform: "translateX(-50%)",
            width: 120,
            height: 2,
            borderRadius: 1,
            background: "rgba(128, 128, 128, 0.22)",
            overflow: "hidden",
          }}
        >
          <div
            ref={meterRef}
            style={{
              height: "100%",
              background: "rgba(128, 128, 128, 0.9)",
              transform: "scaleX(0)",
              transformOrigin: "left center",
              willChange: "transform",
            }}
          />
        </div>
        <button
          type="button"
          className="btn-animate pg-play"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={!paused}
        >
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <ControlsPanel
        library="Voice"
        agent={{
          libraryId: "voice",
          params: agentParams,
          labels: VOICE_PARAM_LABELS,
          onApply: applyAgentParams,
          core: coreWiring,
        }}
      >
        <PgTabs label="Type" options={TYPE_OPTIONS} value={type} onChange={handleTypeChange} />
        <PgTabs label="Look" options={LOOK_OPTIONS} value={look} onChange={setLook} />
        {isDots && (
          <PgGroup label="Dots">
            <PgSlider label="Dot size" value={dotSize} min={0.4} max={2.5} step={0.05} display={`${num(dotSize)}×`} onChange={setDotSize} />
            <PgSlider label="Spacing" value={dotGap} min={0.6} max={2.5} step={0.05} display={`${num(dotGap)}×`} onChange={setDotGap} />
            <PgSlider label="Texture" value={texture} min={0} max={1} step={0.01} display={`${Math.round(texture * 100)}%`} onChange={setTexture} />
            <PgSlider label="Gravity" value={gravity} min={0.2} max={3} step={0.05} display={`${num(gravity)}×`} onChange={setGravity} />
          </PgGroup>
        )}
        <PgTabs label="Source" options={SOURCE_OPTIONS} value={source} onChange={chooseSource} />
        {isMic && MIC_STATUS[mic.state] && (
          <div className="pg-field">
            <span style={{ display: "block", fontSize: 12, opacity: 0.7 }} role="status">
              {MIC_STATUS[mic.state]}
            </span>
          </div>
        )}
        {source === "manual" && (
          <PgSlider label="Level" value={manualLevel} min={0} max={100} step={1} display={`${manualLevel}%`} onChange={setManualLevel} />
        )}
        {processing && (
          <>
            <PgSlider label="Pass duration" value={geo.processingDuration} min={0.3} max={3} step={0.05} display={`${num(geo.processingDuration)}s`} onChange={setG("processingDuration")} />
            <PgSlider label="Held level" value={geo.processingLevel} min={0} max={1} step={0.01} display={`${Math.round(geo.processingLevel * 100)}%`} onChange={setG("processingLevel")} />
            <PgSlider label="Travel" value={geo.processingTravel} min={0} max={2} step={0.05} display={`${num(geo.processingTravel)}×`} onChange={setG("processingTravel")} />
            <PgSlider label="Turn ease" value={geo.processingCurve} min={1} max={4} step={0.05} display={`${num(geo.processingCurve)}`} onChange={setG("processingCurve")} />
            <PgSlider label="Corner follow" value={geo.cornerFollow} min={0} max={1} step={0.05} display={`${Math.round(geo.cornerFollow * 100)}%`} onChange={setG("cornerFollow")} />
            <PgSlider label="Morph" value={processingEase} min={0.1} max={2} step={0.05} display={`${num(processingEase)}s`} onChange={setProcessingEase} />
          </>
        )}
        {!isDots && (
          <>
        <PgTabs label="Color theme" options={COLOR_OPTIONS} value={colorVariant} onChange={setColorVariant} />
        <PanelSep />
        {/* Every colour the effect paints, each with the eight variants'
            colour for that slot to pick from, or the picker. */}
        <div className="vb-colors">
        <PgGroup label="Colors">
          {lobeColors.map((c, i) => (
            <PgSwatches
              key={`lobe-${i}`}
              label={LOBE_LABELS[i]}
              options={VARIANTS.map((v) => ({ value: paletteHex(v, theme)[i], label: `${v} ${LOBE_LABELS[i]}` }))}
              value={c}
              onChange={(v) => setLobeColors((prev) => prev.map((x, j) => (j === i ? v : x)))}
              allowCustom
            />
          ))}
          {BAND_SLOTS.map(([key, label]) => (
            <PgSwatches
              key={key}
              label={label}
              options={[
                { value: BAND_DEFAULTS.dark[key], label: `${label} dark default` },
                { value: BAND_DEFAULTS.light[key], label: `${label} light default` },
                ...paletteHex(colorVariant, theme).slice(0, 4).map((v, i) => ({ value: v, label: `${label} from lobe ${i + 1}` })),
              ]}
              value={bandCols[key]}
              onChange={(v) => setBandCols((prev) => ({ ...prev, [key]: v }))}
              allowCustom
            />
          ))}
        </PgGroup>
        </div>
          </>
        )}
        <PanelSep />
        {/* The input chain, in signal order: gain, gate, then the envelope. */}
        <PgGroup label="Response">
          <PgSlider label="Sensitivity" value={sensitivity} min={0.2} max={4} step={0.05} display={`${num(sensitivity)}×`} onChange={setSensitivity} />
          <PgSlider label="Threshold" value={threshold} min={0} max={0.3} step={0.005} display={num(threshold)} onChange={setThreshold} />
          <PgSlider label="Attack" value={attack} min={0} max={0.5} step={0.005} display={`${Math.round(attack * 1000)}ms`} onChange={setAttack} />
          <PgSlider label="Release" value={release} min={0.02} max={1.5} step={0.01} display={`${Math.round(release * 1000)}ms`} onChange={setRelease} />
        </PgGroup>
        <PanelSep />
        {/* What the envelope does to the glow. */}
        <PgGroup label="Shape">
          {/* One multiplier on every px dimension of the effect. */}
          <PgSlider label="Scale" value={geo.scale} min={0.3} max={3} step={0.05} display={`${num(geo.scale)}×`} onChange={setG("scale")} />
          <PgSlider label="Reach" value={geo.reach} min={0} max={3} step={0.05} display={`${num(geo.reach)}×`} onChange={setG("reach")} />
          <PgSlider label="Spread" value={geo.spread} min={0} max={1.5} step={0.05} display={`${num(geo.spread)}×`} onChange={setG("spread")} />
          {/* Sideways travel of the colours: left→right for positive, still at 0. */}
          <PgSlider label="Flow" value={geo.flow} min={-200} max={200} step={4} display={`${geo.flow} px/s`} onChange={setG("flow")} />
          <PgSlider label="Idle presence" value={geo.idle} min={0} max={1} step={0.01} display={`${Math.round(geo.idle * 100)}%`} onChange={setG("idle")} />
          <PgSlider label="Breathe" value={breathe} min={1} max={8} step={0.1} display={`${num(breathe)}s`} onChange={setBreathe} />
          <PgToggles
            label="Options"
            options={[
              { label: "Bands", active: bands, onToggle: () => setBands((b) => !b) },
              { label: "Static colors", active: staticColors, onToggle: () => setStaticColors((s) => !s) },
            ]}
          />
        </PgGroup>
        <PanelSep />
        {/* The bend and its band: the hump on top of the glow and the light
            that traces it, with its chromatic split. */}
        <PgGroup label="Bend & band">
          <PgSlider label="Bend" value={geo.bend} min={0} max={80} step={1} display={`${geo.bend}px`} onChange={setG("bend")} />
          {/* The bell: exponent (cusp … gaussian … flat top), width, skew. */}
          <PgSlider label="Curve" value={geo.bandCurve} min={0.6} max={4} step={0.05} display={num(geo.bandCurve)} onChange={setG("bandCurve")} />
          <PgSlider label="Spread" value={geo.bandSpread} min={0.15} max={1.2} step={0.01} display={`${num(geo.bandSpread)}×`} onChange={setG("bandSpread")} />
          <PgSlider label="Skew" value={geo.bandSkew} min={-0.6} max={0.6} step={0.02} display={num(geo.bandSkew)} onChange={setG("bandSkew")} />
          <PgSlider label="Band strength" value={geo.bandStrength} min={0} max={3} step={0.05} display={`${num(geo.bandStrength)}×`} onChange={setG("bandStrength")} />
          <PgSlider label="Band width" value={geo.bandWidth} min={0.3} max={3} step={0.05} display={`${num(geo.bandWidth)}×`} onChange={setG("bandWidth")} />
          <PgSlider label="Band height" value={geo.bandPosition} min={0.1} max={1.3} step={0.01} display={`${Math.round(geo.bandPosition * 100)}%`} onChange={setG("bandPosition")} />
          <PgSlider label="Tail lift" value={geo.bandTail} min={0} max={1} step={0.01} display={`${Math.round(geo.bandTail * 100)}%`} onChange={setG("bandTail")} />
          <PgSlider label="Tail position" value={geo.bandTailPosition} min={0} max={0.98} step={0.01} display={`${Math.round(geo.bandTailPosition * 100)}%`} onChange={setG("bandTailPosition")} />
          <PgSlider label="Tail curve" value={geo.bandTailCurve} min={1} max={6} step={0.1} display={num(geo.bandTailCurve)} onChange={setG("bandTailCurve")} />
          <PgSlider label="Tail overflow" value={geo.bandTailOverflow} min={0} max={60} step={1} display={`${geo.bandTailOverflow}px`} onChange={setG("bandTailOverflow")} />
          <PgSlider label="Line offset" value={geo.bandOffset} min={-40} max={60} step={1} display={`${geo.bandOffset}px`} onChange={setG("bandOffset")} />
          <PgSlider label="Aberration" value={geo.bandAberration} min={0} max={1} step={0.01} display={`${Math.round(geo.bandAberration * 100)}%`} onChange={setG("bandAberration")} />
          {/* The warp under the band: amount, and the grain of its noise. */}
          <PgSlider label="Distortion" value={geo.distortion} min={0} max={1} step={0.01} display={`${Math.round(geo.distortion * 100)}%`} onChange={setG("distortion")} />
          <PgSlider label="Distortion detail" value={geo.distortionDetail} min={0.3} max={3} step={0.05} display={`${num(geo.distortionDetail)}×`} onChange={setG("distortionDetail")} />
        </PgGroup>
        <PanelSep />
        {/* Resting geometry of the glow: the lobes, the visible range, and
            each layer's own size — all multipliers on the tuned shape. */}
        <PgGroup label="Glow shape">
          <PgSlider label="Lobe width" value={geo.glowWidth} min={0.3} max={3} step={0.05} display={`${num(geo.glowWidth)}×`} onChange={setG("glowWidth")} />
          <PgSlider label="Lobe height" value={geo.glowHeight} min={0.3} max={3} step={0.05} display={`${num(geo.glowHeight)}×`} onChange={setG("glowHeight")} />
          <PgSlider label="Lobe spacing" value={geo.lobeSpacing} min={0.4} max={2.2} step={0.05} display={`${num(geo.lobeSpacing)}×`} onChange={setG("lobeSpacing")} />
          <PgSlider label="Range width" value={geo.rangeWidth} min={0.4} max={2.5} step={0.05} display={`${num(geo.rangeWidth)}×`} onChange={setG("rangeWidth")} />
          <PgSlider label="Range height" value={geo.rangeHeight} min={0.4} max={2.5} step={0.05} display={`${num(geo.rangeHeight)}×`} onChange={setG("rangeHeight")} />
          <PgSlider label="Softness" value={geo.softness} min={0.6} max={1.35} step={0.01} display={`${num(geo.softness)}×`} onChange={setG("softness")} />
          <PgSlider label="Core" value={geo.coreSize} min={0} max={3} step={0.05} display={`${num(geo.coreSize)}×`} onChange={setG("coreSize")} />
          <PgSlider label="Stroke size" value={geo.strokeScale} min={0.3} max={3} step={0.05} display={`${num(geo.strokeScale)}×`} onChange={setG("strokeScale")} />
          <PgSlider label="Inner size" value={geo.innerScale} min={0.3} max={3} step={0.05} display={`${num(geo.innerScale)}×`} onChange={setG("innerScale")} />
          <PgSlider label="Inner height" value={geo.innerHeight} min={0.3} max={3} step={0.05} display={`${num(geo.innerHeight)}×`} onChange={setG("innerHeight")} />
          <PgSlider label="Bloom size" value={geo.bloomScale} min={0.3} max={3} step={0.05} display={`${num(geo.bloomScale)}×`} onChange={setG("bloomScale")} />
          <PgSlider label="Bloom height" value={geo.bloomHeight} min={0.3} max={3} step={0.05} display={`${num(geo.bloomHeight)}×`} onChange={setG("bloomHeight")} />
          <PgSlider label="Epicentre" value={geo.coreLight} min={0} max={3} step={0.05} display={`${Math.round(geo.coreLight * 100)}%`} onChange={setG("coreLight")} />
          <PgSlider label="Epicentre width" value={geo.coreLightWidth} min={0.3} max={3} step={0.05} display={`${num(geo.coreLightWidth)}×`} onChange={setG("coreLightWidth")} />
          <PgSlider label="Epicentre height" value={geo.coreLightHeight} min={0.3} max={3} step={0.05} display={`${num(geo.coreLightHeight)}×`} onChange={setG("coreLightHeight")} />
        </PgGroup>
        <PanelSep />
        <PgGroup label="Glow styling">
          <PgSlider label="Strength" value={strength} min={0} max={100} step={1} display={`${strength}%`} onChange={setStrength} />
          <PgSlider label="Corner radius" value={radius} min={0} max={120} step={1} display={`${radius}px`} onChange={setRadius} />
          <PgSlider label="Size" value={geo.glowSize} min={0.25} max={3} step={0.05} display={`${num(geo.glowSize)}×`} onChange={setG("glowSize")} />
          <PgSlider label="Brightness" value={brightness} min={0.5} max={2.2} step={0.05} display={`${num(brightness)}×`} onChange={setBrightness} />
          {!isDots && <PgSlider label="Saturation" value={saturation} min={0.4} max={2.2} step={0.05} display={`${num(saturation)}×`} onChange={setSaturation} />}
          {/* The three stacked layers, each on its own multiplier: the
              1px edge stroke, the soft light inside it, the blurred halo. */}
          <PgSlider label="Stroke" value={strokeOpacity} min={0} max={2} step={0.05} display={`${num(strokeOpacity)}×`} onChange={setStrokeOpacity} />
          <PgSlider label="Inner glow" value={innerOpacity} min={0} max={2} step={0.05} display={`${num(innerOpacity)}×`} onChange={setInnerOpacity} />
          <PgSlider label="Bloom" value={bloomOpacity} min={0} max={2} step={0.05} display={`${num(bloomOpacity)}×`} onChange={setBloomOpacity} />
          {!isDots && !staticColors && (
            <>
              <PgSlider label="Hue range" value={hueRange} min={0} max={120} step={1} display={`${hueRange}°`} onChange={setHueRange} />
              <PgSlider label="Hue speed" value={hueDuration} min={2} max={40} step={0.5} display={`${num(hueDuration)}s`} onChange={setHueDuration} />
              <PgSlider label="Hue shift" value={hueShift} min={-180} max={180} step={5} display={`${hueShift}°`} onChange={setHueShift} />
            </>
          )}
        </PgGroup>
      </ControlsPanel>

      <Snippet code={snippet} />
    </div>
  );
}
