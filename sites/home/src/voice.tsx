import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VoiceBeam, useMicrophone, type VoiceBeamType } from "voice-beam";
import { ChatInputMock } from "./examples/beam-mocks";
import { PhoneScreen, DEMO_TRANSCRIPT, demoLevel, demoGetter, MIC_STATUS } from "./examples/voice-mocks";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser } from "./examples/StudioTeaser";

/* Voice detail page — one React island rendering the examples, the
   playground grid (stage + controls) and the live-updating snippet below
   it. Controls mirror the Studio's Voice bench (src/studio/voice.tsx) at
   its first two knobs, the host type and the source; the palettes and
   every other knob live in the Studio. The playground stage starts
   PAUSED, like every other library's; the examples above run on their
   own. */

type Source = "demo" | "mic" | "processing";

/* The host the glow is tuned for. Each type swaps the stage mock (Figma
   1561:44249 for the chat input, 1561:44294 for the phone) and the
   library's geometry preset with it. The recording pill (`type="pill"`)
   is a Studio-only host. */
type PageType = Exclude<VoiceBeamType, "pill">;
const TYPE_OPTIONS = [
  { value: "default", label: "Chat input" },
  { value: "mobile", label: "Mobile" },
] as const;

/* Demo plays a synthetic speech envelope so the effect can be judged
   without a microphone; Microphone asks for the real thing through the
   library's own hook; Processing is the state after the voice — the
   gathered beam travelling its range. Manual drive lives in the Studio. */
const SOURCE_OPTIONS = [
  { value: "demo", label: "Demo voice" },
  { value: "mic", label: "Microphone" },
  { value: "processing", label: "Processing" },
] as const;

const CHILD_BY_TYPE: Record<PageType, string> = {
  default: "<ChatInput />",
  mobile: "<VoiceScreen />",
};

/* The two examples share the demo envelope, half a phrase apart, so they
   take turns speaking instead of pulsing in unison. */
const phoneGetter = () => demoLevel(performance.now() / 1000 + 4.5);

function PgTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="pg-field" role="radiogroup" aria-label={label}>
      <span className="pg-label">{label}</span>
      <div className="pg-tabs">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="pg-tab"
            role="radio"
            aria-checked={value === o.value}
            data-active={value === o.value ? "true" : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* The phone's live transcript, paced by the level the driver reports
   every frame (the Studio bench's pacing): a word every ~320 ms while the
   voice is up, the whole thing cleared — prompt back — after 2.5 s of
   silence. A voice starting after ≥1.2 s of silence counts as a new run,
   which replays the prompt's word-by-word entrance and resets the pill's
   counter; `restart` does the same on demand. */
function useDemoTranscript() {
  const [transcript, setTranscript] = useState<string[]>([]);
  const [runKey, setRunKey] = useState(0);
  const silentSince = useRef(performance.now());
  const wasSilent = useRef(true);
  const wordIndex = useRef(0);
  const lastWordAt = useRef(0);
  const cleared = useRef(true);

  const onLevel = useCallback((level: number) => {
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

  const restart = useCallback(() => setRunKey((k) => k + 1), []);

  useEffect(() => {
    wordIndex.current = 0;
    cleared.current = true;
    setTranscript([]);
  }, [runKey]);

  return { transcript, runKey, onLevel, restart };
}

/* The phone example: the bottom of a voice screen, the transcript
   arriving as the demo voice speaks. Scaled and cropped OUTSIDE the beam
   so the glow layers measure the real screen. */
function PhoneExample() {
  const { transcript, runKey, onLevel } = useDemoTranscript();
  return (
    <div className="mock-phone-scale">
      <div className="mock-phone-scale-inner">
        <VoiceBeam type="mobile" level={phoneGetter} theme="dark" onLevel={onLevel}>
          <PhoneScreen promptKey={runKey} transcript={transcript} />
        </VoiceBeam>
      </div>
    </div>
  );
}

function VoicePlayground() {
  const [type, setType] = useState<PageType>("default");
  const [source, setSource] = useState<Source>("demo");
  /* Pause holds the effect where it is (the library's `paused`); the
     effect itself stays on. Paused on arrival, like every other
     library's stage: it only animates once you press Play. */
  const [paused, setPaused] = useState(true);

  const mic = useMicrophone();
  const isMic = source === "mic";
  const processing = source === "processing";
  const stream = isMic ? mic.stream : null;

  /* Leaving the Microphone source releases the device; nothing should
     keep a live microphone open on a page that isn't showing it. */
  useEffect(() => {
    if (!isMic && mic.stream) mic.stop();
  }, [isMic, mic.stream, mic.stop]);

  /* Type and source changes restart the mock (the prompt replays, the
     pill's counter resets); Play resumes, it does not restart. */
  const { transcript, runKey, onLevel, restart } = useDemoTranscript();
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    restart();
  }, [type, source, restart]);

  const level = source === "demo" ? demoGetter : 0;

  const toggleMic = () => {
    if (mic.state === "live") {
      mic.stop();
      return;
    }
    /* Browsers only grant the microphone inside a user gesture, and a
       paused stage would show nothing of it, so Listen also presses Play. */
    void mic.start();
    setPaused(false);
  };
  const micLabel = mic.state === "live" ? "Stop listening" : mic.state === "requesting" ? "Asking…" : "Listen";

  /* Live snippet: only non-default props survive. */
  const props: string[] = [];
  if (type !== "default") props.push(`type="${type}"`);
  if (isMic) props.push("stream={mic.stream}");
  else if (processing) props.push("processing");
  else props.push("level={() => yourLevel}");
  if (paused) props.push("paused");
  const attrs = "\n  " + props.join("\n  ") + "\n";
  const imports = isMic ? "import { VoiceBeam, useMicrophone } from 'voice-beam';" : "import { VoiceBeam } from 'voice-beam';";
  const decl = isMic ? "const mic = useMicrophone();\n\n" : "";
  const snippet = `${imports}\n\n${decl}<VoiceBeam${attrs}>\n  ${CHILD_BY_TYPE[type]}\n</VoiceBeam>${isMic ? "\n\n<button onClick={mic.start}>Listen</button>" : ""}`;

  const beam = (
    <VoiceBeam
      type={type}
      stream={stream}
      level={level}
      processing={processing}
      theme="dark"
      paused={paused}
      onLevel={onLevel}
    >
      {type === "mobile" ? (
        <PhoneScreen promptKey={runKey} transcript={transcript} />
      ) : (
        <ChatInputMock />
      )}
    </VoiceBeam>
  );

  return (
    <>
      {/* The library introducing itself first: real UI wearing the
          effect, spoken to by the demo voice, before any knobs. The
          playground below is for trying a setting. */}
      <div className="detail-examples">
        <div className="example-row-full example-row-full--phone">
          <PhoneExample />
        </div>
        <div className="example-row-full">
          <VoiceBeam type="default" level={demoGetter} theme="dark">
            <ChatInputMock />
          </VoiceBeam>
        </div>
      </div>

      <p className="detail-playground-label">Playground</p>

      <div className="pg">
        <div className="pg-stage" id="playground-stage">
          {type === "mobile" ? (
            <div className="mock-phone-scale">
              <div className="mock-phone-scale-inner">{beam}</div>
            </div>
          ) : (
            beam
          )}
          <button
            type="button"
            className="btn-animate pg-play"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={!paused}
          >
            {paused ? "Play" : "Pause"}
          </button>
        </div>

        <div className="pg-controls" id="playground-controls">
          <PgTabs label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} />
          <PgTabs label="Source" options={SOURCE_OPTIONS} value={source} onChange={setSource} />
          {isMic && (
            <div className="pg-field">
              <span className="pg-label">Microphone</span>
              <div className="pg-tabs">
                <button
                  type="button"
                  className="pg-toggle"
                  aria-pressed={mic.state === "live"}
                  data-active={mic.state === "live" ? "true" : undefined}
                  disabled={mic.state === "requesting" || mic.state === "unsupported"}
                  onClick={toggleMic}
                >
                  {micLabel}
                </button>
              </div>
              <span className="pg-note" role="status">{MIC_STATUS[mic.state] ?? ""}</span>
            </div>
          )}
          <StudioTeaser
            rows={[
              { kind: "tabs", label: "Color theme", options: ["Colorful", "Ocean"] },
              { kind: "slider", label: "Sensitivity", value: "3.1×", fill: 76 },
              { kind: "slider", label: "Reach", value: "1.2×", fill: 40 },
              { kind: "slider", label: "Bend", value: "60px", fill: 75 },
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
      <VoicePlayground />
    </StrictMode>
  );
}
