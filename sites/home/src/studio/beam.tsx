import { useCallback, useState, type CSSProperties } from "react";
import { BorderBeam, type BorderBeamSize, type BorderBeamColorVariant } from "border-beam";
import { ControlsPanel, PgTabs, PgSlider, PanelSep, Snippet, num, StageBar, PgGroup } from "./controls";
import { checkCss, tpl, type CoreWiring } from "./core";
import { ChatInputMock } from "../examples/beam-mocks";

/* The stylesheet the library generated for the visible beam, with its
   instance id swapped for the {id} placeholder the `css` prop substitutes —
   what the agent reads before rewriting it. */
function stockBeamCss(): string {
  const root = Array.from(document.querySelectorAll<HTMLElement>(".pg-stage [data-beam]")).find((e) => e.offsetWidth > 0);
  const id = root?.getAttribute("data-beam");
  const style = root?.previousElementSibling;
  if (!root || !id || !style || style.tagName !== "STYLE") return "";
  return (style.textContent ?? "").split(id).join("{id}");
}

/* Studio — Beam workbench. The public playground exposes family/type/color/
   strength; the Studio adds the rest of the prop surface (duration,
   brightness, saturation, hue range, static colors, corner radius) plus the
   overridable CSS hooks: --beam-hue-base (palette hue shift),
   --beam-spike-mul (line-type spike prominence), the per-layer opacity
   multipliers --beam-stroke-opacity / --beam-inner-opacity /
   --beam-bloom-opacity (hairline, inner glow, outer halo — the library
   reads each with a fallback of 1) and the --pulse-glow-* glow-shaping
   vars of the pulse family. */

type BeamFamily = "rotate" | "pulse";

const FAMILY_OPTIONS = [
  { value: "rotate", label: "Rotate" },
  { value: "pulse", label: "Pulse" },
] as const;

const SIZE_OPTIONS_BY_FAMILY: Record<BeamFamily, ReadonlyArray<{ value: BorderBeamSize; label: string }>> = {
  rotate: [
    { value: "md", label: "Large" },
    { value: "sm", label: "Small" },
    { value: "line", label: "Line" },
  ],
  pulse: [
    { value: "pulse-inner", label: "Pulse Inner" },
    { value: "pulse-outside", label: "Pulse Outside" },
  ],
};

const DEFAULT_SIZE_BY_FAMILY: Record<BeamFamily, BorderBeamSize> = {
  rotate: "md",
  pulse: "pulse-inner",
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

/* Tuned CSS vars for the pulse-outside preview — same values the live beam
   site applies so the outward bloom reads right on a dark stage. */
const PULSE_OUTSIDE_TUNED_VARS = {
  "--sub-glow-offset-x": "1px",
  "--sub-glow-offset-y": "0px",
  "--sub-core-blur": "10px",
  "--sub-bloom-blur": "19px",
  "--sub-glow-opacity-mul": 1.71,
} as CSSProperties;

const DEFAULT_DURATION: Record<string, number> = { line: 2.4 };

/* Param key -> the knob's own label, so an agent-applied change reads
   "Duration 1.96 → 3.2" in the transcript rather than naming the prop. */
const BEAM_PARAM_LABELS: Record<string, string> = {
  size: "Type",
  colorVariant: "Color theme",
  strength: "Strength",
  duration: "Duration",
  glowSize: "Glow size",
  strokeOpacity: "Stroke",
  innerOpacity: "Inner glow",
  bloomOpacity: "Bloom",
  brightness: "Brightness",
  saturation: "Saturation",
  hueRange: "Hue range",
  hueShift: "Hue shift",
  staticColors: "Static colors",
  radius: "Corner radius",
  spikes: "Spikes",
  glowSx: "Glow spread X",
  glowSy: "Glow spread Y",
  glowBoost: "Glow boost",
  core: "Core",
  active: "Playing",
};

/* The card follows the beam type, exactly like the live demo page: sm gets
   the 80x36 button pill (.card-sm), everything else the 348px text card
   (.card-md) — each beam's glow geometry is tuned for that one card, and
   any other pairing smears. */
function DemoCard({ size, radius }: { size: BorderBeamSize; radius: number }) {
  if (size === "sm") {
    return <div className="beam-card beam-card--btn" />;
  }
  return <ChatInputMock radius={radius} />;
}

export function BeamStudio({ visible = true, theme = "dark" }: { visible?: boolean; theme?: "dark" | "light" }) {
  const [family, setFamily] = useState<BeamFamily>("rotate");
  const [size, setSize] = useState<BorderBeamSize>("md");
  const [colorVariant, setColorVariant] = useState<BorderBeamColorVariant>("colorful");
  const [strength, setStrength] = useState(100);
  const [duration, setDuration] = useState(1.96);
  const [brightness, setBrightness] = useState(1.3);
  const [saturation, setSaturation] = useState(1.2);
  const [hueRange, setHueRange] = useState(30);
  const [hueShift, setHueShift] = useState(0);
  const [staticColors, setStaticColors] = useState(false);
  const [radius, setRadius] = useState(16);
  const [spikes, setSpikes] = useState(1);
  const [glowSize, setGlowSize] = useState(1);
  const [strokeOpacity, setStrokeOpacity] = useState(1);
  const [innerOpacity, setInnerOpacity] = useState(1);
  const [bloomOpacity, setBloomOpacity] = useState(1);
  const [glowSx, setGlowSx] = useState(1);
  const [glowSy, setGlowSy] = useState(1);
  const [glowBoost, setGlowBoost] = useState(1);
  const [active, setActive] = useState(true);
  /* The agent's rebuilt stylesheet, appended after the generated one; ""
     is stock. */
  const [core, setCore] = useState("");
  const coreWiring: CoreWiring = { lang: "css", source: stockBeamCss, check: checkCss };

  /* An untouched duration follows the type's own default across switches
     (md 1.96s vs line 2.4s), so the snippet never emits a duration the
     user didn't set. */
  const handleSizeChange = useCallback((next: BorderBeamSize) => {
    setSize((prev) => {
      setDuration((d) =>
        d === (DEFAULT_DURATION[prev] ?? 1.96) ? (DEFAULT_DURATION[next] ?? 1.96) : d
      );
      return next;
    });
  }, []);

  const handleFamilyChange = useCallback(
    (next: BeamFamily) => {
      setFamily(next);
      handleSizeChange(DEFAULT_SIZE_BY_FAMILY[next]);
    },
    [handleSizeChange]
  );

  /* ── Agent wiring ──────────────────────────────────────────────────
   * The knobs stay the source of truth; the agent just drives the same
   * setters. Keys match the Worker's spec (services/studio-agent/spec.ts),
   * which owns the ranges and rejects anything out of them, so nothing is
   * re-validated here. */
  const agentParams: Record<string, unknown> = {
    size, colorVariant, strength, duration, glowSize,
    strokeOpacity, innerOpacity, bloomOpacity, brightness, saturation,
    hueRange, hueShift, staticColors, radius, spikes,
    glowSx, glowSy, glowBoost, active, core,
  };

  const applyAgentParams = useCallback(
    (patch: Record<string, unknown>) => {
      /* `size` goes through handleSizeChange rather than setSize so an
         untouched duration still follows the type's default, and family
         is derived from it — the agent picks a type, not a family, and a
         stale family would leave the Type tabs offering the wrong set. */
      if (typeof patch.size === "string") {
        const next = patch.size as BorderBeamSize;
        setFamily(next === "pulse-inner" || next === "pulse-outside" ? "pulse" : "rotate");
        handleSizeChange(next);
      }
      if (typeof patch.colorVariant === "string") setColorVariant(patch.colorVariant as BorderBeamColorVariant);
      if (typeof patch.strength === "number") setStrength(patch.strength);
      if (typeof patch.duration === "number") setDuration(patch.duration);
      if (typeof patch.glowSize === "number") setGlowSize(patch.glowSize);
      if (typeof patch.strokeOpacity === "number") setStrokeOpacity(patch.strokeOpacity);
      if (typeof patch.innerOpacity === "number") setInnerOpacity(patch.innerOpacity);
      if (typeof patch.bloomOpacity === "number") setBloomOpacity(patch.bloomOpacity);
      if (typeof patch.brightness === "number") setBrightness(patch.brightness);
      if (typeof patch.saturation === "number") setSaturation(patch.saturation);
      if (typeof patch.hueRange === "number") setHueRange(patch.hueRange);
      if (typeof patch.hueShift === "number") setHueShift(patch.hueShift);
      if (typeof patch.staticColors === "boolean") setStaticColors(patch.staticColors);
      if (typeof patch.radius === "number") setRadius(patch.radius);
      if (typeof patch.spikes === "number") setSpikes(patch.spikes);
      if (typeof patch.glowSx === "number") setGlowSx(patch.glowSx);
      if (typeof patch.glowSy === "number") setGlowSy(patch.glowSy);
      if (typeof patch.glowBoost === "number") setGlowBoost(patch.glowBoost);
      if (typeof patch.active === "boolean") setActive(patch.active);
      if (typeof patch.core === "string") setCore(patch.core);
    },
    [handleSizeChange]
  );

  const isPulse = family === "pulse";
  const isPulseOutside = size === "pulse-outside";
  const isLine = size === "line";
  const defaultDuration = DEFAULT_DURATION[size] ?? 1.96;

  /* CSS hooks the library reads with fallbacks — only emit touched ones. */
  const varStyle: Record<string, string | number> = {};
  if (hueShift !== 0 && !staticColors) varStyle["--beam-hue-base"] = `${hueShift}deg`;
  if (isLine && spikes !== 1) varStyle["--beam-spike-mul"] = num(spikes);
  if (strokeOpacity !== 1) varStyle["--beam-stroke-opacity"] = num(strokeOpacity);
  if (innerOpacity !== 1) varStyle["--beam-inner-opacity"] = num(innerOpacity);
  if (bloomOpacity !== 1) varStyle["--beam-bloom-opacity"] = num(bloomOpacity);
  if (isPulse && glowSx !== 1) varStyle["--pulse-glow-sx"] = num(glowSx);
  if (isPulse && glowSy !== 1) varStyle["--pulse-glow-sy"] = num(glowSy);
  if (isPulse && glowBoost !== 1) varStyle["--pulse-glow-boost"] = num(glowBoost);
  const hasVars = Object.keys(varStyle).length > 0;
  const beamStyle: CSSProperties | undefined = isPulseOutside
    ? ({ ...PULSE_OUTSIDE_TUNED_VARS, ...varStyle } as CSSProperties)
    : hasVars
      ? (varStyle as CSSProperties)
      : undefined;

  /* Live snippet: only non-default props survive. */
  const props: string[] = [];
  if (size !== "md") props.push(`size="${size}"`);
  if (colorVariant !== "colorful") props.push(`colorVariant="${colorVariant}"`);
  if (strength !== 100) props.push(`strength={${num(strength / 100)}}`);
  if (duration !== defaultDuration) props.push(`duration={${num(duration)}}`);
  if (glowSize !== 1) props.push(`glowSize={${num(glowSize)}}`);
  if (brightness !== 1.3) props.push(`brightness={${num(brightness)}}`);
  if (saturation !== 1.2) props.push(`saturation={${num(saturation)}}`);
  if (hueRange !== 30) props.push(`hueRange={${num(hueRange)}}`);
  if (radius !== 16) props.push(`borderRadius={${num(radius)}}`);
  if (staticColors) props.push("staticColors");
  if (!active) props.push("active={false}");
  if (hasVars) {
    const varLines = Object.entries(varStyle)
      .map(([k, v]) => `'${k}': ${typeof v === "string" ? `'${v}'` : v}`)
      .join(", ");
    props.push(`style={{ ${varLines} }}`);
  }
  if (core) props.push("css={beamCss}");
  const attrs = props.length ? "\n  " + props.join("\n  ") + "\n" : "";
  const coreDecl = core ? `const beamCss = ${tpl(core)};\n\n` : "";
  const snippet = `import { BorderBeam } from 'border-beam';\n\n${coreDecl}<BorderBeam${attrs}>\n  <Card>Content</Card>\n</BorderBeam>`;

  /* The ports mirror the web props (border-beam-native/src/types.ts,
     BorderBeamKit/BorderBeam.swift) with two differences the snippets
     honor: neither auto-detects the child's radius, so borderRadius is
     always written; and glowSize plus the CSS-variable tuning are web-only,
     so they are left out rather than invented. Both ports default to the
     dark theme, so light is spelled out when the Studio is in light. */
  const rn: string[] = [];
  if (size !== "md") rn.push(`size="${size}"`);
  if (colorVariant !== "colorful") rn.push(`colorVariant="${colorVariant}"`);
  if (theme === "light") rn.push(`theme="light"`);
  rn.push(`borderRadius={${num(radius)}}`);
  if (strength !== 100) rn.push(`strength={${num(strength / 100)}}`);
  if (duration !== defaultDuration) rn.push(`duration={${num(duration)}}`);
  if (brightness !== 1.3) rn.push(`brightness={${num(brightness)}}`);
  if (saturation !== 1.2) rn.push(`saturation={${num(saturation)}}`);
  if (hueRange !== 30) rn.push(`hueRange={${num(hueRange)}}`);
  if (staticColors) rn.push("staticColors");
  if (!active) rn.push("active={false}");
  const rnAttrs = "\n  " + rn.join("\n  ") + "\n";
  const rnSnippet = `import { BorderBeam } from 'border-beam-native';\n\n<BorderBeam${rnAttrs}>\n  <Card />\n</BorderBeam>`;

  const swiftSize: Record<BorderBeamSize, string> = {
    sm: ".sm", md: ".md", line: ".line", "pulse-outside": ".pulseOutside", "pulse-inner": ".pulseInner",
  };
  const sw: string[] = [];
  if (size !== "md") sw.push(`size: ${swiftSize[size]}`);
  if (colorVariant !== "colorful") sw.push(`colorVariant: .${colorVariant}`);
  if (theme === "light") sw.push("theme: .light");
  sw.push(`borderRadius: ${num(radius)}`);
  if (strength !== 100) sw.push(`strength: ${num(strength / 100)}`);
  if (duration !== defaultDuration) sw.push(`duration: ${num(duration)}`);
  if (brightness !== 1.3) sw.push(`brightness: ${num(brightness)}`);
  if (saturation !== 1.2) sw.push(`saturation: ${num(saturation)}`);
  if (hueRange !== 30) sw.push(`hueRange: ${num(hueRange)}`);
  if (staticColors) sw.push("staticColors: true");
  if (!active) sw.push("active: false");
  const swiftSnippet = `import BorderBeamKit\n\nBorderBeam(\n    ${sw.join(",\n    ")}\n) {\n    Card()\n}`;

  const platforms = [
    {
      id: "rn",
      label: "React Native",
      installTitle: "Install border-beam-native with Skia and Reanimated",
      install: "npm install border-beam-native @shopify/react-native-skia react-native-reanimated",
      note: "border-beam-native is not on npm yet — it lives in this repo at packages/border-beam/ports/react-native/border-beam-native. Expo needs expo run:ios / run:android (native modules).",
      usage: rnSnippet,
    },
    {
      id: "swift",
      label: "Swift UI",
      installTitle: "Add BorderBeamKit as a local Swift package (iOS 17+)",
      install: `// Package.swift — or Xcode: File › Add Package Dependencies… › Add Local…\n.package(path: "packages/border-beam/ports/ios/BorderBeamKit")`,
      note: "Build through Xcode: the Metal shader is compiled by Xcode's build system, not by SwiftPM alone.",
      usage: swiftSnippet,
    },
  ];

  return (
    <>
      <div className="pg">
        <StageBar library="Border beam" prompt={{ pkg: "border-beam", docsPath: "/beam.html", snippet, platforms }} agent={{ libraryId: "beam", params: agentParams, labels: BEAM_PARAM_LABELS, onApply: applyAgentParams }} />
        <div className="pg-stage">
          {visible && (
          <BorderBeam
            size={size}
            colorVariant={colorVariant}
            theme={theme}
            active={active}
            strength={strength / 100}
            duration={duration}
            glowSize={glowSize}
            brightness={brightness}
            saturation={saturation}
            hueRange={hueRange}
            borderRadius={radius !== 16 ? radius : undefined}
            staticColors={staticColors}
            style={beamStyle}
            css={core || undefined}
          >
            <DemoCard size={size} radius={radius} />
          </BorderBeam>
          )}
          <button
            type="button"
            className="btn-animate pg-play"
            onClick={() => setActive((a) => !a)}
            aria-pressed={active}
          >
            {active ? "Pause" : "Play"}
          </button>
        </div>

        <ControlsPanel
          library="Border beam"
          agent={{
            libraryId: "beam",
            params: agentParams,
            labels: BEAM_PARAM_LABELS,
            onApply: applyAgentParams,
            core: coreWiring,
          }}
        >
          <PgTabs label="Family" options={FAMILY_OPTIONS} value={family} onChange={handleFamilyChange} />
          <PgTabs label="Type" options={SIZE_OPTIONS_BY_FAMILY[family]} value={size} onChange={handleSizeChange} />
          <PgTabs label="Color theme" options={COLOR_OPTIONS} value={colorVariant} onChange={setColorVariant} />
          <PanelSep />
          <PgGroup label="Motion">
            <PgSlider label="Duration" value={duration} min={0.5} max={6} step={0.02} display={`${num(duration)}s`} onChange={setDuration} />
          </PgGroup>
          <PanelSep />
          {/* Everything else that shapes the glow lives in one section. */}
          <PgGroup label="Glow styling">
            <PgSlider label="Strength" value={strength} min={0} max={100} step={1} display={`${strength}%`} onChange={setStrength} />
            <PgSlider label="Corner radius" value={radius} min={0} max={32} step={1} display={`${radius}px`} onChange={setRadius} />
            <PgSlider label="Size" value={glowSize} min={0.25} max={3} step={0.05} display={`${num(glowSize)}×`} onChange={setGlowSize} />
            <PgSlider label="Brightness" value={brightness} min={0.5} max={2.2} step={0.05} display={`${num(brightness)}×`} onChange={setBrightness} />
            <PgSlider label="Saturation" value={saturation} min={0.4} max={2.2} step={0.05} display={`${num(saturation)}×`} onChange={setSaturation} />
            {/* The three stacked layers, each on its own multiplier: the
                1px hairline, the soft light inside it, the outer halo. */}
            <PgSlider label="Stroke" value={strokeOpacity} min={0} max={2} step={0.05} display={`${num(strokeOpacity)}×`} onChange={setStrokeOpacity} />
            <PgSlider label="Inner glow" value={innerOpacity} min={0} max={2} step={0.05} display={`${num(innerOpacity)}×`} onChange={setInnerOpacity} />
            <PgSlider label="Bloom" value={bloomOpacity} min={0} max={2} step={0.05} display={`${num(bloomOpacity)}×`} onChange={setBloomOpacity} />
            {!staticColors && (
              <>
                <PgSlider label="Hue range" value={hueRange} min={0} max={120} step={1} display={`${hueRange}°`} onChange={setHueRange} />
                <PgSlider label="Hue shift" value={hueShift} min={-180} max={180} step={5} display={`${hueShift}°`} onChange={setHueShift} />
              </>
            )}
            {isLine && (
              <PgSlider label="Spikes" value={spikes} min={0} max={2} step={0.05} display={`${num(spikes)}×`} onChange={setSpikes} />
            )}
            {isPulse && (
              <>
                <PgSlider label="Glow spread X" value={glowSx} min={0.5} max={2} step={0.05} display={`${num(glowSx)}×`} onChange={setGlowSx} />
                <PgSlider label="Glow spread Y" value={glowSy} min={0.5} max={2} step={0.05} display={`${num(glowSy)}×`} onChange={setGlowSy} />
                <PgSlider label="Glow boost" value={glowBoost} min={0.5} max={2} step={0.05} display={`${num(glowBoost)}×`} onChange={setGlowBoost} />
              </>
            )}
          </PgGroup>
        </ControlsPanel>

        <Snippet code={snippet} />
      </div>
    </>
  );
}
