import { type RefObject, StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VoiceRing, useMicrophone, type VoiceOrbState, type VoiceRingType } from "voice-ring";
import { demoGetter, MIC_STATUS } from "./examples/voice-mocks";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser } from "./examples/StudioTeaser";
import { PgTabs } from "./examples/PgTabs";

/* Voice ring detail page — one React island: the examples, the playground
   (stage + controls) and the live snippet under it, React or SwiftUI as the
   page's platform is. The library ships for both (npm voice-ring, and
   VoiceRingKit); the stage draws the web engine (packages/voice-ring), inside
   the phone frame the SwiftUI platform puts on the stage. Controls mirror the Studio's Voice ring bench
   (src/studio/voice-ring.tsx) at its first knobs; the rest live there. The
   playground stage starts PAUSED, like every other library's. */

type Source = "demo" | "mic";

const TYPE_OPTIONS = [
  { value: "ring", label: "Ring" },
  { value: "mono", label: "Mono" },
] as const;

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

/* Direction detection is Pro as well: the Voice position model reads
   which side of the iPhone the voice comes from, and the ring leans there. */
const DIRECTION_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on", label: "On", locked: "Uses Voice position model, Pro plan" },
] as const;

/* The ring bending toward the cursor while it waits or works is a Pro
   knob: tuned in the Studio, shown here locked, like direction detection. */
const BEND_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on", label: "On", locked: "Available with Pro" },
] as const;

const SWIFT_STATE: Record<VoiceOrbState, string> = {
  idle: ".idle",
  listening: ".listening",
  speaking: ".speaking",
  processing: ".processing",
};

/* The examples: each type with a voice in it (the user's or the
   assistant's, which look alike) and at work. */
const EXAMPLES: Array<{ label: string; type: VoiceRingType; state: VoiceOrbState; level?: () => number }> = [
  { label: "Listening / Speaking", type: "ring", state: "listening", level: demoGetter },
  { label: "Processing", type: "ring", state: "processing" },
  { label: "Mono: Listening / Speaking", type: "mono", state: "listening", level: demoGetter },
  { label: "Mono: Processing", type: "mono", state: "processing" },
];

/* The first knobs of each type, as the Studio's bench has them. */
const TEASER_ROWS: Record<VoiceRingType, Array<{ kind: "slider"; label: string; value: string; fill: number }>> = {
  ring: [
    { kind: "slider", label: "Rings", value: "6", fill: 45 },
    { kind: "slider", label: "Lean", value: "0.91", fill: 61 },
    { kind: "slider", label: "Ring gap", value: "0.02", fill: 20 },
    { kind: "slider", label: "Halo", value: "0.5", fill: 50 },
  ],
  mono: [
    { kind: "slider", label: "Loops", value: "2", fill: 33 },
    { kind: "slider", label: "Globe opening", value: "0.75", fill: 50 },
    { kind: "slider", label: "Twist", value: "1.69", fill: 68 },
    { kind: "slider", label: "Wobble", value: "0.31", fill: 10 },
  ],
};

function Examples() {
  return (
    <div className="detail-examples">
      <div className="example-row-full vr-examples">
        {EXAMPLES.map((ex) => (
          <div className="vr-example" key={ex.label}>
            <VoiceRing type={ex.type} size={150} state={ex.state} level={ex.level ?? 0} theme="dark" />
            <span className="t-shimmer vr-example-label" data-text={ex.label}>{ex.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* The page's platform as site.js marks it on the stage: SwiftUI (and React
   Native) draw the ring inside a phone. */
function usePhone(stage: RefObject<HTMLDivElement>) {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const read = () => setPhone(el.getAttribute("data-device") === "phone");
    read();
    const watch = new MutationObserver(read);
    watch.observe(el, { attributes: true, attributeFilter: ["data-device"] });
    return () => watch.disconnect();
  }, [stage]);
  return phone;
}

function RingPlayground() {
  const [type, setType] = useState<VoiceRingType>("ring");
  const [state, setState] = useState<VoiceOrbState>("listening");
  const [source, setSource] = useState<Source>("demo");
  const [paused, setPaused] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const phone = usePhone(stage);

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

  /* Live snippet for the page's platform: only what differs from the defaults. */
  let snippet: string;
  if (phone) {
    const args = [`state: ${SWIFT_STATE[state]}`, isMic ? "source: .meter(meter)" : "source: .level { yourLevel }"];
    if (type === "mono") args.unshift(".mono");
    args.push("size: 240");
    const lines = ["import VoiceRingKit", ""];
    if (isMic) lines.push("@State private var meter = VoiceMeter()", "");
    lines.push(`VoiceRing(\n  ${args.join(",\n  ")}\n)${isMic ? "\n.task { try? await meter.start() }" : ""}`);
    snippet = lines.join("\n");
  } else {
    const ring = `<VoiceRing ${type === "mono" ? 'type="mono" ' : ""}size={240} state="${state}" ${isMic ? "stream={mic.stream}" : "level={() => yourLevel}"} />`;
    snippet = isMic
      ? `import { VoiceRing, useMicrophone } from 'voice-ring';\n\nconst mic = useMicrophone();\n\n${ring}\n<button onClick={mic.start}>Listen</button>`
      : `import { VoiceRing } from 'voice-ring';\n\n${ring}`;
  }

  return (
    <>
      <Examples />

      <p className="detail-playground-label">Playground</p>

      <div className="pg">
        <div className="pg-stage" id="playground-stage" ref={stage}>
          <VoiceRing
            type={type}
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
          <PgTabs label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} />
          <PgTabs label="State" options={STATE_OPTIONS} value={state} onChange={setState} />
          <PgTabs label="Source" options={SOURCE_OPTIONS} value={source} onChange={chooseSource} extra={SOURCES_LOCKED} />
          {isMic && MIC_STATUS[mic.state] && (
            <div className="pg-field">
              <span className="pg-note" role="status">{MIC_STATUS[mic.state]}</span>
            </div>
          )}
          <PgTabs label="Emotion" options={EMOTION_OPTIONS} value="off" onChange={() => {}} />
          <div>
            <PgTabs label="Direction detection" options={DIRECTION_OPTIONS} value="off" onChange={() => {}} />
            <span className="pg-note">
              The ring leans toward whoever is speaking: Libraries.dev&apos;s{" "}
              <a
                href="/voice-position.html"
                style={{ color: "color-mix(in srgb, var(--pg-title) 55%, var(--pg-label))", textDecoration: "underline", textUnderlineOffset: 2 }}
              >
                Voice position
              </a>{" "}
              model hears the side on the iPhone&apos;s two built-in mics.
            </span>
          </div>
          <PgTabs label="Hover bend" options={BEND_OPTIONS} value="off" onChange={() => {}} />
          <StudioTeaser rows={TEASER_ROWS[type]} />
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
