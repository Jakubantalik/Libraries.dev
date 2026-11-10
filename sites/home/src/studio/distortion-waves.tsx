import { useCallback, useMemo, useRef, useState } from "react";
import { ControlsPanel, PgTabs, PgSlider, PgSwatches, PanelSep, Snippet, num, StageBar, PgGroup } from "./controls";
import { DistortionWavePreview } from "../distortion-waves/Preview";
import {
  defaultStyle,
  duration,
  hexToRgb,
  PALETTES,
  rgbToHex,
  singlePalette,
  type PaletteName,
  type WaveStyle,
  type WaveType,
} from "../distortion-waves/model";
import { PHONE, SHEET } from "../distortion-waves/scenes";

/* Studio — Distortion waves workbench. The library is SwiftUI only
   (DistortionWavesKit), so React shows greyed and the stage is the phone;
   the WebGL port draws the wave from the same timeline. Every knob is a
   DistortionWaveStyle property under its own name, so the Install tab writes
   `style.<knob> = value` for exactly what was moved from the type's tuned
   defaults. Each type keeps its own values as the bench switches between
   them. */

const TYPE_OPTIONS = [
  { value: "vertical", label: "Vertical" },
  { value: "horizontal", label: "Horizontal" },
  { value: "center", label: "Center" },
] as const;

const PALETTE_LABEL: Record<PaletteName, string> = {
  colorful: "Colorful",
  green: "Green",
  ocean: "Ocean",
  sunset: "Sunset",
  mono: "Mono",
};

type Unit = "s" | "pt" | "%" | "x" | "n";
interface Knob {
  key: keyof WaveStyle & string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: Unit;
}

const fmt = (v: number, u: Unit) =>
  u === "s" ? `${v.toFixed(2)}s` : u === "pt" ? `${num(Math.round(v * 10) / 10)}pt` : u === "%" ? `${Math.round(v * 100)}%` : u === "x" ? `${num(v)}×` : `${Math.round(v)}`;

/* The groups and their knobs, as the app's tune panel has them. */
const GROUPS: Array<{ label: string; knobs: Knob[]; arcOnly?: boolean }> = [
  {
    label: "Timing",
    knobs: [
      { key: "anticipation", label: "Anticipation", min: 0.05, max: 1.2, step: 0.01, unit: "s" },
      { key: "travel", label: "Wave", min: 0.4, max: 4.5, step: 0.01, unit: "s" },
      { key: "pull", label: "Pull", min: 0, max: 60, step: 0.5, unit: "pt" },
      { key: "inhale", label: "Colour ring", min: 0, max: 140, step: 1, unit: "pt" },
      { key: "gatherGlow", label: "Ring opacity", min: 0, max: 2, step: 0.01, unit: "%" },
      { key: "gatherDots", label: "Gather dots", min: 0, max: 1, step: 0.01, unit: "%" },
      { key: "launchGap", label: "Start gap", min: 0, max: 200, step: 1, unit: "pt" },
      { key: "returnSpeed", label: "Return speed", min: 0.5, max: 3, step: 0.05, unit: "x" },
    ],
  },
  {
    label: "Wave",
    knobs: [
      { key: "amplitude", label: "Swell", min: 0, max: 80, step: 0.5, unit: "pt" },
      { key: "lensWidth", label: "Swell width", min: 40, max: 300, step: 1, unit: "pt" },
      { key: "swell", label: "Bend", min: 0, max: 60, step: 0.5, unit: "pt" },
      { key: "aberration", label: "Chromatic", min: 0, max: 1, step: 0.01, unit: "%" },
      { key: "blur", label: "Blur", min: 8, max: 60, step: 0.5, unit: "pt" },
      { key: "blurAhead", label: "Blur ahead", min: 20, max: 300, step: 1, unit: "pt" },
      { key: "blurBehind", label: "Blur behind", min: 40, max: 500, step: 1, unit: "pt" },
      { key: "lead", label: "Colour ahead", min: 30, max: 300, step: 1, unit: "pt" },
      { key: "tail", label: "Colour behind", min: 60, max: 500, step: 1, unit: "pt" },
      { key: "strength", label: "Colour opacity", min: 0, max: 1, step: 0.01, unit: "%" },
    ],
  },
  {
    label: "Edges",
    knobs: [
      { key: "rimWidth", label: "Width", min: 4, max: 120, step: 0.5, unit: "pt" },
      { key: "rimUnevenness", label: "Unevenness", min: 0, max: 2, step: 0.01, unit: "%" },
      { key: "rimStrength", label: "Opacity", min: 0, max: 1, step: 0.01, unit: "%" },
      { key: "rimPulse", label: "Pulse", min: 0, max: 1, step: 0.01, unit: "%" },
      { key: "hairlineWidth", label: "Hairline", min: 0, max: 4, step: 0.1, unit: "pt" },
      { key: "hairlineOpacity", label: "Line opacity", min: 0, max: 1, step: 0.01, unit: "%" },
      { key: "hairlineWhite", label: "Line white", min: 0, max: 1, step: 0.01, unit: "%" },
      { key: "hairlineLinger", label: "Line hold", min: 0, max: 6, step: 0.01, unit: "s" },
      { key: "hairlineFade", label: "Line fade out", min: 0.3, max: 6, step: 0.01, unit: "s" },
      { key: "linger", label: "Fade start", min: -1.5, max: 3, step: 0.01, unit: "s" },
      { key: "rimFade", label: "Fade out", min: 0.3, max: 4, step: 0.01, unit: "s" },
      { key: "rimSoftness", label: "Fade softness", min: 40, max: 400, step: 1, unit: "pt" },
    ],
  },
  {
    label: "Dots",
    knobs: [
      { key: "particleCount", label: "Count", min: 0, max: 300, step: 1, unit: "n" },
      { key: "particleSize", label: "Size", min: 0.5, max: 4, step: 0.1, unit: "pt" },
      { key: "particleReach", label: "Born within", min: 40, max: 400, step: 1, unit: "pt" },
      { key: "particleFlight", label: "Hop", min: 4, max: 120, step: 1, unit: "pt" },
      { key: "particleGap", label: "Gap", min: 0, max: 120, step: 1, unit: "pt" },
      { key: "particleLife", label: "Life", min: 0.2, max: 4, step: 0.01, unit: "s" },
      { key: "particleSpread", label: "Spread", min: 0.1, max: 1, step: 0.01, unit: "%" },
    ],
  },
  {
    label: "Touch",
    arcOnly: true,
    knobs: [{ key: "orientation", label: "Orientation", min: 0, max: 1, step: 0.01, unit: "%" }],
  },
];
const KNOBS = GROUPS.flatMap((g) => g.knobs);

const SWIFT_TYPE: Record<WaveType, string> = { vertical: ".vertical", horizontal: ".horizontal", center: ".center" };

/** The style a type starts from on the stage: its tuned defaults, round the
    phone's corners (or the sheet's). */
function stageDefaults(type: WaveType): WaveStyle {
  const s = defaultStyle(type);
  s.cornerRadius = type === "center" ? SHEET.radius : PHONE.radius;
  return s;
}

/** Palette choice: a preset name, or a custom hex (one colour). */
type ColourChoice = PaletteName | string;
const isPreset = (c: ColourChoice): c is PaletteName => c in PALETTES;
const paletteOf = (c: ColourChoice) => (isPreset(c) ? PALETTES[c] : singlePalette(hexToRgb(c)));
const defaultColour = (type: WaveType): ColourChoice => (type === "center" ? "green" : "colorful");

const SWATCHES = (Object.keys(PALETTES) as PaletteName[]).map((name) => {
  const cs = PALETTES[name].colors.map((c) => rgbToHex(c));
  return { value: name, label: PALETTE_LABEL[name], swatch: `conic-gradient(${[...cs, cs[0]].join(", ")})` };
});

type Values = Record<WaveType, Record<string, number>>;
const initialValues = (): Values =>
  Object.fromEntries((["vertical", "horizontal", "center"] as WaveType[]).map((t) => {
    const s = stageDefaults(t);
    return [t, Object.fromEntries(KNOBS.map((k) => [k.key, s[k.key] as number]))];
  })) as Values;

const LABELS: Record<string, string> = {
  type: "Type",
  colour: "Colour",
  paused: "Paused",
  processing: "Processing",
  resetAfter: "Reset after",
  ...Object.fromEntries(KNOBS.map((k) => [k.key, k.label])),
};

export function DistortionWavesStudio({ visible = true }: { visible?: boolean; theme?: "dark" | "light" }) {
  const [type, setType] = useState<WaveType>("vertical");
  const [values, setValues] = useState<Values>(initialValues);
  const [colours, setColours] = useState<Record<WaveType, ColourChoice>>({ vertical: "colorful", horizontal: "colorful", center: "green" });
  const [paused, setPaused] = useState(false);
  const [processing, setProcessing] = useState(1.2);
  const [resetAfter, setResetAfter] = useState(2);

  const typeRef = useRef(type);
  typeRef.current = type;
  const v = values[type];
  const colour = colours[type];
  const style = useMemo<WaveStyle>(() => {
    const s = stageDefaults(type);
    for (const k of KNOBS) (s as unknown as Record<string, number>)[k.key] = v[k.key];
    s.palette = paletteOf(colour);
    return s;
  }, [type, v, colour]);

  const set = (key: string, value: number) => setValues((prev) => ({ ...prev, [type]: { ...prev[type], [key]: value } }));

  /* SwiftUI: only what moved from the type's tuned defaults. */
  const defaults = stageDefaults(type);
  const moved = KNOBS.filter((k) => Math.abs(v[k.key] - (defaults[k.key] as number)) > 1e-6);
  const lines = moved.map((k) => `style.${k.key} = ${k.unit === "n" ? Math.round(v[k.key]) : num(v[k.key])}`);
  if (colour !== defaultColour(type)) {
    lines.push(isPreset(colour) ? `style.palette = .${colour}` : `style.palette = .single(DistortionWaveColor(hex: 0x${colour.replace("#", "").toUpperCase()}))`);
  }
  if (type === "center") lines.unshift("style.cornerRadius = 48   // your sheet's corners");
  const source = type === "center" ? "tokenFrame" : type === "horizontal" ? "edgeFrame" : "buttonFrame";
  const focus = type === "center" ? "" : ", focus: touch";
  const swiftUsage = [
    "import DistortionWavesKit",
    "",
    ...(lines.length ? [`var style = DistortionWaveStyle${SWIFT_TYPE[type]}`, ...lines, ""] : []),
    `DistortionWave(isRevealed: sent, source: ${source}${focus}, style: ${lines.length ? "style" : SWIFT_TYPE[type]}) {`,
    "    ReviewScreen()",
    "} revealed: {",
    "    ReceiptScreen()",
    "}",
  ].join("\n");

  const platforms = [
    {
      id: "swift",
      label: "SwiftUI",
      installTitle: "Add DistortionWavesKit from GitHub with Swift Package Manager (iOS 17+ / macOS 14+)",
      install: `// Package.swift, or Xcode: File › Add Package Dependencies… › paste the URL (Branch: main)\n.package(url: "https://github.com/Jakubantalik/Libraries.dev", branch: "main")\n// …and in your target's dependencies:\n.product(name: "DistortionWavesKit", package: "Libraries.dev")`,
      note: "Build through Xcode: the wave is three Metal shaders, compiled by Xcode's build system. Give both sides an opaque background.",
      usage: swiftUsage,
    },
  ];

  /* Presets and reset ride the same params. */
  const params: Record<string, unknown> = {
    type, colour, paused, processing, resetAfter,
    ...Object.fromEntries(KNOBS.map((k) => [k.key, v[k.key]])),
  };
  const applyParams = useCallback((patch: Record<string, unknown>) => {
    const t = patch.type === "vertical" || patch.type === "horizontal" || patch.type === "center" ? patch.type : null;
    const target = t ?? typeRef.current;
    if (t) setType(t);
    const knobs = KNOBS.filter((k) => typeof patch[k.key] === "number");
    if (knobs.length) setValues((prev) => ({ ...prev, [target]: { ...prev[target], ...Object.fromEntries(knobs.map((k) => [k.key, patch[k.key] as number])) } }));
    if (typeof patch.colour === "string") setColours((prev) => ({ ...prev, [target]: patch.colour as string }));
    if (typeof patch.paused === "boolean") setPaused(patch.paused);
    if (typeof patch.processing === "number") setProcessing(patch.processing);
    if (typeof patch.resetAfter === "number") setResetAfter(patch.resetAfter);
  }, []);

  /* Reset to the type's defaults. */
  const resetType = () => {
    const s = stageDefaults(type);
    setValues((prev) => ({ ...prev, [type]: Object.fromEntries(KNOBS.map((k) => [k.key, s[k.key] as number])) }));
    setColours((prev) => ({ ...prev, [type]: defaultColour(type) }));
  };

  return (
    <div className="pg">
      <StageBar
        library="Distortion waves"
        prompt={{ pkg: "", docsPath: "/distortion-waves.html", snippet: swiftUsage, web: false, platforms }}
        agent={{ libraryId: "distortion-waves", params, labels: LABELS, onApply: applyParams }}
      />
      <div className="pg-stage">
        {visible && <DistortionWavePreview style={style} playing={!paused} processing={processing} resetAfter={resetAfter} />}
        <button type="button" className="btn-animate pg-play" onClick={() => setPaused((p) => !p)} aria-pressed={!paused}>
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <ControlsPanel library="Distortion waves">
        <PgTabs label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} />
        <PgSwatches
          label="Colour"
          options={SWATCHES}
          value={colour}
          onChange={(c) => setColours((prev) => ({ ...prev, [type]: c }))}
          allowCustom
        />
        <span style={{ display: "block", fontSize: 12, lineHeight: 1.5, opacity: 0.6, margin: "-4px 0 6px" }}>
          {isPreset(colour) ? PALETTE_LABEL[colour] : `One colour, ${colour}`} · whole wave {duration(style).toFixed(2)}s
        </span>
        {GROUPS.filter((g) => !(g.arcOnly && type === "center")).map((g) => (
          <div key={g.label}>
            <PanelSep />
            <PgGroup label={g.label}>
              {g.knobs.map((k) => (
                <PgSlider
                  key={`${type}.${k.key}`}
                  label={k.label}
                  value={v[k.key]}
                  min={k.min}
                  max={k.max}
                  step={k.step}
                  display={fmt(v[k.key], k.unit)}
                  onChange={(n) => set(k.key, n)}
                />
              ))}
            </PgGroup>
          </div>
        ))}
        <PanelSep />
        <PgGroup label="Preview">
          {type === "center" && (
            <PgSlider label="Processing" value={processing} min={0} max={4} step={0.05} display={`${processing.toFixed(2)}s`} onChange={setProcessing} />
          )}
          <PgSlider label="Reset after" value={resetAfter} min={0.5} max={6} step={0.05} display={`${resetAfter.toFixed(2)}s`} onChange={setResetAfter} />
          <button type="button" className="btn-animate" style={{ marginTop: 8 }} onClick={resetType}>
            Reset {TYPE_OPTIONS.find((o) => o.value === type)?.label.toLowerCase()} to its defaults
          </button>
        </PgGroup>
      </ControlsPanel>

      <Snippet code={swiftUsage} />
    </div>
  );
}
