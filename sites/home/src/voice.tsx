import { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VoiceBeam, useMicrophone, type VoiceBeamType } from "voice-glow";
import { ChatInputMock } from "./examples/beam-mocks";
import { PhoneScreen, DEMO_TRANSCRIPT, demoLevel, demoGetter, MIC_STATUS } from "./examples/voice-mocks";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser } from "./examples/StudioTeaser";
import { PgTabs } from "./examples/PgTabs";

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
/* The recording pill is a Studio host; it shows here, locked. */
const TYPES_LOCKED = ["Recording pill"];

/* Demo plays a synthetic speech envelope so the effect can be judged
   without a microphone; Microphone asks for the real thing through the
   library's own hook; Processing is the state after the voice — the
   gathered beam travelling its range. Manual drive lives in the Studio. */
const SOURCE_OPTIONS = [
  { value: "demo", label: "Demo voice" },
  { value: "mic", label: "Microphone" },
  { value: "processing", label: "Processing" },
] as const;
const SOURCES_LOCKED = ["Manual drive"];

const CHILD_BY_TYPE: Record<PageType, string> = {
  default: "<ChatInput />",
  mobile: "<VoiceScreen />",
};

/* The two examples share the demo envelope, half a phrase apart, so they
   take turns speaking instead of pulsing in unison. */
const phoneGetter = () => demoLevel(performance.now() / 1000 + 4.5);

/* The phone crop: the beam wraps the visible 273×357 of the screen, not
   the 402×874 behind it, so its layers raster 3.6× fewer pixels; the
   glow keeps the phone's tuning at the crop's 0.68. */
const PHONE_CROP = 0.68;
const PHONE_SCALE = 1.25 * PHONE_CROP;
const PHONE_RADIUS = 66 * PHONE_CROP;

/* The chat input is authored at 371px; on a narrow screen it shrinks to
   its card, and the glow — authored in px — must shrink with it. */
const CHAT_WIDTH = 371;
function useFitScale(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => setScale(Math.min(1, el.clientWidth / CHAT_WIDTH));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, scale];
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
    <VoiceBeam type="mobile" level={phoneGetter} theme="dark" onLevel={onLevel} scale={PHONE_SCALE} borderRadius={PHONE_RADIUS} className="mock-phone-host">
      <div className="mock-phone-scale">
        <div className="mock-phone-scale-inner">
          <PhoneScreen promptKey={runKey} transcript={transcript} />
        </div>
      </div>
    </VoiceBeam>
  );
}

function ChatExample() {
  const [ref, scale] = useFitScale();
  return (
    <div ref={ref} className="voice-fit">
      <VoiceBeam type="default" level={demoGetter} theme="dark" scale={scale}>
        <ChatInputMock />
      </VoiceBeam>
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

  /* Choosing Microphone starts listening right away — the click is the
     user gesture browsers require — and presses Play, since a paused
     stage would show nothing of it. Choosing it again retries after a
     refusal; leaving it releases the device (the effect above). */
  const chooseSource = (next: Source) => {
    setSource(next);
    if (next === "mic" && mic.state !== "live" && mic.state !== "requesting") {
      void mic.start();
      setPaused(false);
    }
  };

  /* Live snippet: only non-default props survive. */
  const props: string[] = [];
  if (type !== "default") props.push(`type="${type}"`);
  if (isMic) props.push("stream={mic.stream}");
  else if (processing) props.push("processing");
  else props.push("level={() => yourLevel}");
  if (paused) props.push("paused");
  const attrs = "\n  " + props.join("\n  ") + "\n";
  const imports = isMic ? "import { VoiceBeam, useMicrophone } from 'voice-glow';" : "import { VoiceBeam } from 'voice-glow';";
  const decl = isMic ? "const mic = useMicrophone();\n\n" : "";
  const snippet = `${imports}\n\n${decl}<VoiceBeam${attrs}>\n  ${CHILD_BY_TYPE[type]}\n</VoiceBeam>${isMic ? "\n\n<button onClick={mic.start}>Listen</button>" : ""}`;

  const [fitRef, fitScale] = useFitScale();
  const beam =
    type === "mobile" ? (
      <VoiceBeam type="mobile" stream={stream} level={level} processing={processing} theme="dark" paused={paused} onLevel={onLevel} scale={PHONE_SCALE} borderRadius={PHONE_RADIUS} className="mock-phone-host">
        <div className="mock-phone-scale">
          <div className="mock-phone-scale-inner">
            <PhoneScreen promptKey={runKey} transcript={transcript} />
          </div>
        </div>
      </VoiceBeam>
    ) : (
      <div ref={fitRef} className="voice-fit">
        <VoiceBeam type="default" stream={stream} level={level} processing={processing} theme="dark" paused={paused} onLevel={onLevel} scale={fitScale}>
          <ChatInputMock />
        </VoiceBeam>
      </div>
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
          <ChatExample />
        </div>
      </div>

      <p className="detail-playground-label">Playground</p>

      <div className="pg">
        <div className="pg-stage" id="playground-stage">
          {beam}
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
          <PgTabs label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} extra={TYPES_LOCKED} />
          <PgTabs label="Source" options={SOURCE_OPTIONS} value={source} onChange={chooseSource} extra={SOURCES_LOCKED} />
          {isMic && MIC_STATUS[mic.state] && (
            <div className="pg-field">
              <span className="pg-note" role="status">{MIC_STATUS[mic.state]}</span>
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

/* Debug switches for a phone that has no inspector: ?vbdbg=a,b,c applies
   ablations after mount and shows a readout of the chat host's layers
   (nohalfres, noclip, nowarp, nomirror, nobase, nomask, nowc, nourl,
   hold=<s>). Inert without the parameter. */
const dbg = new URLSearchParams(location.search).get("vbdbg");
if (dbg) {
  const flags = new Set(dbg.split(","));
  const apply = () => {
    const hold = [...flags].find((f) => f.startsWith("hold="));
    if (hold) { const t = parseFloat(hold.slice(5)) * 1000; performance.now = () => t; }
    const roots = [...document.querySelectorAll<HTMLElement>("[data-voice-beam]")];
    const css: string[] = [];
    if (flags.has("nohalfres")) roots.forEach((r) => r.removeAttribute("data-voice-halfres"));
    if (flags.has("noclip")) css.push("[data-voice-beam]::before,[data-voice-beam] [data-voice-beam-bloom]{clip-path:none!important}");
    if (flags.has("nowarp")) css.push("[data-voice-beam] [data-voice-beam-warp]{display:none!important}[data-voice-beam]::before,[data-voice-beam] [data-voice-beam-bloom]{clip-path:none!important}");
    if (flags.has("nomirror")) css.push("[data-voice-beam] [data-voice-beam-warp]{display:none!important}");
    if (flags.has("nobase")) css.push("[data-voice-beam]::before,[data-voice-beam] [data-voice-beam-bloom]{display:none!important}");
    if (flags.has("nomask")) css.push("[data-voice-beam]::before,[data-voice-beam] [data-voice-beam-bloom],[data-voice-beam] [data-voice-beam-warp]{mask:none!important;-webkit-mask:none!important;mask-image:none!important;-webkit-mask-image:none!important}");
    if (flags.has("nowc")) css.push("[data-voice-beam] *,[data-voice-beam]::before,[data-voice-beam]::after{will-change:auto!important}");
    if (flags.has("nourl")) roots.forEach((r) => r.querySelectorAll<HTMLElement>("[data-voice-beam-warp]").forEach((m) => { m.style.filter = getComputedStyle(m).filter.replace(/url\([^)]*\)/g, ""); }));
    if (css.length) { const s = document.createElement("style"); s.textContent = css.join("\n"); document.head.appendChild(s); }
    const chat = roots.find((r) => r.querySelector(".mock-vchat"));
    chat?.scrollIntoView({ block: "center" });
    const out = document.createElement("pre");
    out.style.cssText = "position:fixed;left:0;right:0;top:0;z-index:99999;margin:0;padding:6px;font:10px/1.3 monospace;background:#000c;color:#0f0;white-space:pre-wrap;pointer-events:none";
    const tick = () => {
      if (!chat) { out.textContent = "no chat host"; return; }
      const id = chat.getAttribute("data-voice-beam");
      const b = getComputedStyle(chat, "::before"); const bloom = chat.querySelector("[data-voice-beam-bloom]"); const bs = bloom && getComputedStyle(bloom);
      const m = chat.querySelector("[data-voice-beam-warp]"); const ms = m && getComputedStyle(m);
      out.textContent = [
        `ua ${navigator.userAgent.match(/OS [\d_]+|Version\/[\d.]+/g)?.join(" ")} dpr ${devicePixelRatio} flags ${dbg}`,
        `halfres ${chat.hasAttribute("data-voice-halfres")} warp ${chat.getAttribute("data-voice-warp")} level ${chat.style.getPropertyValue("--vb-level-" + id)}`,
        `before: z ${b.getPropertyValue("--vb-z-" + id)} tf ${b.getPropertyValue("transform").slice(0, 22)}|${b.getPropertyValue("-webkit-transform").slice(0, 22)} lt ${b.left},${b.top} size ${b.width}x${b.height} clip ${b.clipPath.slice(0, 30)} op ${b.getPropertyValue("opacity")} disp ${b.display} bg ${b.backgroundImage.slice(0, 40)}`,
        `bloom: tf ${bs?.transform.slice(0, 22)} lt ${bs?.left},${bs?.top} size ${bs?.width}x${bs?.height} clip ${bs?.clipPath.slice(0, 30)} op ${bs?.opacity} filter ${bs?.filter.slice(0, 40)}`,
        `mirror: size ${ms?.width}x${ms?.height} clip ${ms?.clipPath.slice(0, 34)} op ${ms?.opacity} disp ${ms?.display} filter ${ms?.filter.slice(0, 60)}`,
        `region ${["x", "y", "width", "height"].map((a) => chat.querySelector("svg filter")?.getAttribute(a)).join(" ")}`,
      ].join("\n");
    };
    tick(); setInterval(tick, 1000);
    document.body.appendChild(out);
  };
  setTimeout(apply, 2000);
}
