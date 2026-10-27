import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { VoiceRing, useMicrophone, type VoiceOrbState } from "voice-ring";
import { demoGetter, MIC_STATUS } from "./examples/voice-mocks";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser } from "./examples/StudioTeaser";
import { PgTabs } from "./examples/PgTabs";

/* Voice ring detail page — one React island: the examples, the playground
   (stage + controls) and the live SwiftUI snippet under it. The library
   ships as SwiftUI (VoiceRingKit); the stage draws the same engine on the
   web (packages/voice-ring), inside the phone frame the SwiftUI platform
   puts on the stage. Controls mirror the Studio's Voice ring bench
   (src/studio/voice-ring.tsx) at its first knobs; the rest live there. The
   playground stage starts PAUSED, like every other library's. */

type Source = "demo" | "mic";

const STATE_OPTIONS = [
  { value: "idle", label: "Idle" },
  { value: "listening", label: "Listening" },
  { value: "speaking", label: "Speaking" },
  { value: "processing", label: "Processing" },
] as const;

const SOURCE_OPTIONS = [
  { value: "demo", label: "Demo voice" },
  { value: "mic", label: "Microphone" },
] as const;
const SOURCES_LOCKED = ["Manual drive"];

/* Emotion is the Voice library's Pro feature here too: emotion2vec+ reads
   the tone of the voice on the iPhone and the ring takes its colour. */
const EMOTION_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "emotion", label: "Emotion", locked: "SwiftUI only, with Pro plan" },
] as const;

/* Direction detection is Pro as well: the Voice direction model reads
   which side of the iPhone the voice comes from, and the ring leans there. */
const DIRECTION_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on", label: "On", locked: "Uses Voice direction model, Pro plan" },
] as const;

const SWIFT_STATE: Record<VoiceOrbState, string> = {
  idle: ".idle",
  listening: ".listening",
  speaking: ".speaking",
  processing: ".processing",
};

/* The examples: the ring with a voice in it (the user's or the
   assistant's, which look alike) and the ring at work. */
const EXAMPLES: Array<{ label: string; state: VoiceOrbState; level?: () => number }> = [
  { label: "Listening / Speaking", state: "listening", level: demoGetter },
  { label: "Processing", state: "processing" },
];

function Examples() {
  return (
    <div className="detail-examples">
      <div className="example-row-full vr-examples">
        {EXAMPLES.map((ex) => (
          <div className="vr-example" key={ex.label}>
            <VoiceRing size={150} state={ex.state} level={ex.level ?? 0} theme="dark" />
            <span className="t-shimmer vr-example-label" data-text={ex.label}>{ex.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RingPlayground() {
  const [state, setState] = useState<VoiceOrbState>("listening");
  const [source, setSource] = useState<Source>("demo");
  const [paused, setPaused] = useState(true);

  const mic = useMicrophone();
  const isMic = source === "mic";

  /* Leaving the Microphone source releases the device. */
  useEffect(() => {
    if (!isMic && mic.stream) mic.stop();
  }, [isMic, mic.stream, mic.stop]);

  /* Choosing Microphone starts it from the click (the user gesture
     browsers need) and presses Play. */
  const chooseSource = (next: Source) => {
    setSource(next);
    if (next === "mic" && mic.state !== "live" && mic.state !== "requesting") {
      void mic.start();
      setPaused(false);
    }
  };

  /* Live SwiftUI snippet: only what differs from the defaults. */
  const args = [`state: ${SWIFT_STATE[state]}`, isMic ? "source: .meter(meter)" : "source: .level { yourLevel }"];
  args.push("size: 240");
  const lines = ["import VoiceRingKit", ""];
  if (isMic) lines.push("@State private var meter = VoiceMeter()", "");
  lines.push(`VoiceRing(\n  ${args.join(",\n  ")}\n)${isMic ? "\n.task { try? await meter.start() }" : ""}`);
  const snippet = lines.join("\n");

  return (
    <>
      <Examples />

      <p className="detail-playground-label">Playground</p>

      <div className="pg">
        <div className="pg-stage" id="playground-stage">
          <VoiceRing
            size={240}
            state={state}
            stream={isMic ? mic.stream : null}
            level={isMic ? 0 : demoGetter}
            paused={paused}
            theme="dark"
          />
          <button type="button" className="btn-animate pg-play" onClick={() => setPaused((p) => !p)} aria-pressed={!paused}>
            {paused ? "Play" : "Pause"}
          </button>
        </div>

        <div className="pg-controls" id="playground-controls">
          <PgTabs label="State" options={STATE_OPTIONS} value={state} onChange={setState} />
          <PgTabs label="Source" options={SOURCE_OPTIONS} value={source} onChange={chooseSource} extra={SOURCES_LOCKED} />
          {isMic && MIC_STATUS[mic.state] && (
            <div className="pg-field">
              <span className="pg-note" role="status">{MIC_STATUS[mic.state]}</span>
            </div>
          )}
          <PgTabs label="Emotion" options={EMOTION_OPTIONS} value="off" onChange={() => {}} />
          <PgTabs label="Direction detection" options={DIRECTION_OPTIONS} value="off" onChange={() => {}} />
          <StudioTeaser
            rows={[
              { kind: "slider", label: "Rings", value: "6", fill: 45 },
              { kind: "slider", label: "Lean", value: "0.91", fill: 61 },
              { kind: "slider", label: "Ring gap", value: "0.02", fill: 20 },
              { kind: "slider", label: "Halo", value: "0.5", fill: 50 },
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
      <RingPlayground />
    </StrictMode>
  );
}
