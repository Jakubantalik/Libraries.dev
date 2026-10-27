import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceRing, useMicrophone, type VoiceOrbState } from "voice-ring";
import { ControlsPanel, PgTabs, PgSlider, PanelSep, Snippet, num, StageBar, PgGroup } from "./controls";
import { MOOD_PRESETS, moodColors, type MoodPoint, type MoodPreset } from "./voice-mood";
import { MoodPad } from "./voice";
import { demoGetter, MIC_STATUS } from "../examples/voice-mocks";

/* Studio — Voice ring workbench. The library ships as SwiftUI
   (VoiceRingKit); the stage draws the same engine on the web
   (packages/voice-ring) and the Install tab writes the SwiftUI call from
   the knobs. Every knob is a VoiceRing parameter or one of the ring's own
   `style.opts`, so the snippet carries only what was moved.

   Two models plug into the ring, and both are previewed here by hand:
   Emotion (emotion2vec+ on the iPhone, Pro, as on the Voice bench) tints
   the spectrum toward a mood; Direction (our Voice direction model,
   free account) leans it toward the side the voice comes from. */

type Source = "demo" | "mic" | "manual";
type Emotion = "off" | MoodPreset;
type Direction = "off" | "manual";

const STATE_OPTIONS = [
  { value: "idle", label: "Idle" },
  { value: "listening", label: "Listening" },
  { value: "speaking", label: "Speaking" },
  { value: "processing", label: "Processing" },
] as const;

const SOURCE_OPTIONS = [
  { value: "demo", label: "Demo voice" },
  { value: "mic", label: "Microphone" },
  { value: "manual", label: "Manual" },
] as const;

const EMOTION_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "happy", label: "Happy" },
  { value: "calm", label: "Calm" },
  { value: "angry", label: "Angry" },
  { value: "sad", label: "Sad" },
] as const;

const DIRECTION_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "manual", label: "Manual" },
] as const;

/* The ring's own knobs: the `opts` keys the aura frame reads (the engine's
   fallbacks are the defaults, so a slider at rest writes nothing). */
interface RingKnob {
  label: string;
  def: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}
const RING_KNOBS: Record<string, RingKnob> = {
  rings: { label: "Rings", def: 6, min: 1, max: 12, step: 1, format: (v) => `${v}` },
  lean: { label: "Lean", def: 0.91, min: 0, max: 1.5, step: 0.01, format: num },
  ringGap: { label: "Ring gap", def: 0.02, min: 0, max: 0.2, step: 0.005, format: num },
  deform: { label: "Deform", def: 1.45, min: 0, max: 3, step: 0.05, format: (v) => `${num(v)}×` },
  halo: { label: "Halo", def: 0.5, min: 0, max: 1.5, step: 0.05, format: num },
  radius: { label: "Radius", def: 0.56, min: 0.3, max: 0.8, step: 0.01, format: num },
};
type KnobValues = Record<string, number>;
const KNOB_DEFAULTS: KnobValues = Object.fromEntries(Object.entries(RING_KNOBS).map(([k, v]) => [k, v.def]));

const SWIFT_STATE: Record<VoiceOrbState, string> = {
  idle: ".idle",
  listening: ".listening",
  speaking: ".speaking",
  processing: ".processing",
};

const LABELS: Record<string, string> = {
  state: "State",
  source: "Source",
  level: "Level",
  speed: "Speed",
  sensitivity: "Sensitivity",
  emotion: "Emotion",
  direction: "Direction",
  lean: "Voice from",
  paused: "Paused",
  ...Object.fromEntries(Object.entries(RING_KNOBS).map(([k, v]) => [`knob.${k}`, v.label])),
};

const hexToTint = (hex: string) => {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
};

export function VoiceRingStudio({ visible = true, theme = "dark" }: { visible?: boolean; theme?: "dark" | "light" }) {
  const [state, setState] = useState<VoiceOrbState>("listening");
  const [source, setSource] = useState<Source>("demo");
  const [level, setLevel] = useState(60);
  const [speed, setSpeed] = useState(1);
  const [sensitivity, setSensitivity] = useState(1);
  const [knobs, setKnobs] = useState<KnobValues>(KNOB_DEFAULTS);
  const [emotion, setEmotion] = useState<Emotion>("off");
  const [moodPoint, setMoodPoint] = useState<MoodPoint>(MOOD_PRESETS.happy);
  const [direction, setDirection] = useState<Direction>("off");
  const [lean, setLean] = useState(0.6);
  const [paused, setPaused] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const mic = useMicrophone();
  const isMic = source === "mic";
  /* Leaving the Microphone source releases the device, and so does
     switching to another bench. */
  useEffect(() => {
    if ((!isMic || !visible) && mic.stream) mic.stop();
  }, [isMic, visible, mic.stream, mic.stop]);
  const chooseSource = (next: Source) => {
    setSource(next);
    if (next === "mic" && mic.state !== "live" && mic.state !== "requesting") void mic.start();
  };

  const chooseEmotion = (next: Emotion) => {
    setEmotion(next);
    if (next !== "off") setMoodPoint(MOOD_PRESETS[next]);
  };
  /* Dragging the pad lights the tab of the nearest mood (as on Voice). */
  const dragMood = (p: MoodPoint) => {
    setMoodPoint(p);
    let best: MoodPreset = "happy";
    let bestD = Infinity;
    for (const [name, q] of Object.entries(MOOD_PRESETS) as Array<[MoodPreset, MoodPoint]>) {
      const d = (q.valence - p.valence) ** 2 + (q.arousal - p.arousal) ** 2;
      if (d < bestD) { bestD = d; best = name; }
    }
    setEmotion(best);
  };

  /* The mood's lead colour, as the web ring's emotion tint: the spectrum
     shifts toward it, as VoiceRing(mood:) does on SwiftUI. */
  const tint = emotion !== "off" ? hexToTint(moodColors(moodPoint, theme !== "light")[0]) : null;

  const moved = Object.keys(RING_KNOBS).filter((k) => knobs[k] !== RING_KNOBS[k].def);
  const opts = Object.fromEntries(moved.map((k) => [k, knobs[k]]));

  /* SwiftUI snippet: a VoiceStyle only when something in it moved. */
  const styleLines: string[] = [];
  if (speed !== 1) styleLines.push(`style.speed = ${num(speed)}`);
  if (sensitivity !== 1) styleLines.push(`style.sensitivity = ${num(sensitivity)}`);
  if (theme === "light") styleLines.push("style.theme = .light");
  if (moved.length) styleLines.push(`style.opts = [${moved.map((k) => `"${k}": ${num(knobs[k])}`).join(", ")}]`);
  const args = [`state: ${SWIFT_STATE[state]}`];
  if (isMic) args.push("source: .meter(meter)");
  else if (source === "manual") args.push(`source: .level { ${num(level / 100)} }`);
  else args.push("source: .level { yourLevel }");
  if (styleLines.length) args.push("style: style");
  if (emotion !== "off") args.push(`mood: VoiceMood(valence: ${num(moodPoint.valence)}, arousal: ${num(moodPoint.arousal)})`);
  if (direction === "manual") args.push(`direction: ${num(lean)}`);
  args.push("size: 240");
  const notes: string[] = [];
  if (emotion !== "off") notes.push("// A fixed mood here. Live emotion (Pro): import VoiceRingEmotion,\n// await emotion.start(meter: meter), then mood: emotion.mood.");
  if (direction === "manual") notes.push("// A fixed lean here. On an iPhone, add VoiceDirection.mfxl (Voice direction)\n// to the app target and pass direction: voice.pan (VoiceDirectionKit): the ring follows the voice.");
  const swiftUsage = [
    "import VoiceRingKit",
    "",
    ...(isMic ? ["@State private var meter = VoiceMeter()", ""] : []),
    ...(styleLines.length ? ["var style = VoiceStyle()", ...styleLines, ""] : []),
    ...(notes.length ? [notes.join("\n")] : []),
    `VoiceRing(\n  ${args.join(",\n  ")}\n)${isMic ? "\n.task { try? await meter.start() }" : ""}`,
  ].join("\n");

  const platforms = [
    {
      id: "swift",
      label: "SwiftUI",
      installTitle: "Add VoiceRingKit from GitHub with Swift Package Manager (iOS 17+ / macOS 14+)",
      install: `// Package.swift, or Xcode: File › Add Package Dependencies… › paste the URL (Branch: main)\n.package(url: "https://github.com/Jakubantalik/Libraries.dev", branch: "main")\n// …and in your target's dependencies:\n.product(name: "VoiceRingKit", package: "Libraries.dev")`,
      note: "Build through Xcode (the edge lens is a Metal shader) and add NSMicrophoneUsageDescription. Emotion is VoiceRingEmotion with Pro's emotion2vec+ models; direction is the Voice direction model (VoiceDirection.mfxl, free account).",
      usage: swiftUsage,
    },
  ];

  /* Presets and reset ride the same params; the chat agent is not wired
     for this library yet, so the controls panel gets none. */
  const params: Record<string, unknown> = {
    state, source, level, speed, sensitivity, emotion, direction, lean, paused,
    ...Object.fromEntries(Object.entries(knobs).map(([k, v]) => [`knob.${k}`, v])),
  };
  const applyParams = useCallback((patch: Record<string, unknown>) => {
    if (typeof patch.state === "string") setState(patch.state as VoiceOrbState);
    if (patch.source === "demo" || patch.source === "manual") setSource(patch.source);
    if (typeof patch.level === "number") setLevel(patch.level);
    if (typeof patch.speed === "number") setSpeed(patch.speed);
    if (typeof patch.sensitivity === "number") setSensitivity(patch.sensitivity);
    if (typeof patch.emotion === "string") chooseEmotion(patch.emotion as Emotion);
    if (patch.direction === "off" || patch.direction === "manual") setDirection(patch.direction);
    if (typeof patch.lean === "number") setLean(patch.lean);
    if (typeof patch.paused === "boolean") setPaused(patch.paused);
    const next = Object.entries(patch).filter(([k, v]) => k.startsWith("knob.") && typeof v === "number");
    if (next.length) setKnobs((prev) => ({ ...prev, ...Object.fromEntries(next.map(([k, v]) => [k.slice(5), v as number])) }));
  }, []);

  return (
    <div className="pg">
      <StageBar
        library="Voice ring"
        prompt={{ pkg: "voice-ring", docsPath: "/voice-ring.html", snippet: swiftUsage, platforms, web: false }}
        agent={{ libraryId: "voice-ring", params, labels: LABELS, onApply: applyParams }}
      />
      <div className="pg-stage" ref={stageRef}>
        {visible && (
          <VoiceRing
            size={240}
            state={state}
            stream={isMic ? mic.stream : null}
            level={isMic ? 0 : source === "manual" ? level / 100 : demoGetter}
            speed={speed}
            sensitivity={sensitivity}
            opts={moved.length ? opts : undefined}
            emotion={tint ? "positive" : null}
            emotionColors={tint ? { positive: tint } : undefined}
            direction={direction === "manual" ? lean : undefined}
            directionBounds={stageRef}
            paused={paused}
            theme={theme}
          />
        )}
        <button type="button" className="btn-animate pg-play" onClick={() => setPaused((p) => !p)} aria-pressed={!paused}>
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <ControlsPanel library="Voice ring">
        <PgTabs label="State" options={STATE_OPTIONS} value={state} onChange={setState} />
        <PgTabs label="Source" options={SOURCE_OPTIONS} value={source} onChange={chooseSource} />
        {isMic && MIC_STATUS[mic.state] && (
          <div className="pg-field">
            <span style={{ display: "block", fontSize: 12, opacity: 0.7 }} role="status">{MIC_STATUS[mic.state]}</span>
          </div>
        )}
        {source === "manual" && (
          <PgSlider label="Level" value={level} min={0} max={100} step={1} display={`${level}%`} onChange={setLevel} />
        )}
        <PgGroup label="Motion">
          <PgSlider label="Speed" value={speed} min={0.25} max={3} step={0.05} display={`${num(speed)}×`} onChange={setSpeed} />
          <PgSlider label="Sensitivity" value={sensitivity} min={0.25} max={4} step={0.05} display={`${num(sensitivity)}×`} onChange={setSensitivity} />
        </PgGroup>
        <PanelSep />
        <PgGroup label="Ring">
          {Object.entries(RING_KNOBS).map(([k, knob]) => (
            <PgSlider
              key={k}
              label={knob.label}
              value={knobs[k]}
              min={knob.min}
              max={knob.max}
              step={knob.step}
              display={knob.format(knobs[k])}
              onChange={(v) => setKnobs((prev) => ({ ...prev, [k]: v }))}
            />
          ))}
        </PgGroup>
        <PanelSep />
        <PgGroup label="Emotion (emotion2vec)">
          <PgTabs label="Emotion" options={EMOTION_OPTIONS} value={emotion} onChange={chooseEmotion} />
          {emotion !== "off" && (
            <div className="pg-field">
              <MoodPad value={moodPoint} onChange={dragMood} />
              <span style={{ display: "block", fontSize: 12, opacity: 0.6, margin: "8px 0 0" }}>
                A preview of the mood the ring&apos;s spectrum shifts toward. Detection runs on the iPhone with
                VoiceRingEmotion: emotion2vec+ reads the tone of the voice, GoEmotions its words (Pro).
              </span>
            </div>
          )}
        </PgGroup>
        <PanelSep />
        <PgGroup label="Direction (Voice direction)">
          <PgTabs label="Direction" options={DIRECTION_OPTIONS} value={direction} onChange={setDirection} />
          {direction === "manual" && (
            <PgSlider
              label="Voice from"
              value={lean}
              min={-1}
              max={1}
              step={0.05}
              display={Math.abs(lean) < 0.05 ? "Ahead" : `${lean < 0 ? "Left" : "Right"} ${Math.round(Math.abs(lean) * 100)}%`}
              onChange={setLean}
            />
          )}
          <span style={{ display: "block", fontSize: 12, opacity: 0.6, margin: "4px 0 0" }}>
            The ring leans while a voice is heard. On an iPhone the{" "}
            <a href="/voice-direction.html" style={{ color: "inherit", textDecoration: "underline" }}>Voice direction</a>{" "}
            model (beta, tested on iPhone 15 Pro) reads the side from the stereo mics, with no calibration.
          </span>
        </PgGroup>
      </ControlsPanel>

      <Snippet code={swiftUsage} />
    </div>
  );
}
