import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VoiceBeam, type VoiceBeamType } from "voice-beam";
import { ChatInputMock } from "./examples/beam-mocks";
import { DEMO_TRANSCRIPT, PhoneScreen, RecordingPill, demoGetter } from "./examples/voice-mocks";

/* Phone test page: the three hosts full screen with the demo voice, so
   the effect can be judged on a real device. The detail page is the
   public one; this is for testing and is not linked from the site. */
const RADIUS: Record<VoiceBeamType, number> = { default: 20, pill: 106, mobile: 0 };

/* The phone's transcript, paced by the level the driver reports (the
   detail page's pacing): a word every ~320 ms while the voice is up, the
   prompt back after 2.5 s of silence, a new run after 1.2 s of quiet. */
function useTranscript() {
  const [transcript, setTranscript] = useState<string[]>([]);
  const [runKey, setRunKey] = useState(0);
  const wordIndex = useRef(0);
  const lastWordAt = useRef(0);
  const silentSince = useRef(performance.now());
  const wasSilent = useRef(true);
  const cleared = useRef(true);
  const onLevel = useCallback((lv: number) => {
    const now = performance.now();
    if (lv < 0.05) {
      if (!wasSilent.current) silentSince.current = now;
      wasSilent.current = true;
      if (!cleared.current && now - silentSince.current > 2500) {
        cleared.current = true;
        wordIndex.current = 0;
        setTranscript([]);
      }
    } else if (wasSilent.current && lv > 0.2) {
      wasSilent.current = false;
      if (now - silentSince.current > 1200) setRunKey((k) => k + 1);
    }
    if (lv > 0.22 && now - lastWordAt.current > 320 && wordIndex.current < DEMO_TRANSCRIPT.length) {
      wordIndex.current += 1;
      lastWordAt.current = now;
      cleared.current = false;
      setTranscript(DEMO_TRANSCRIPT.slice(0, wordIndex.current));
    }
  }, []);
  const restart = useCallback(() => {
    wordIndex.current = 0;
    cleared.current = true;
    setTranscript([]);
    setRunKey((k) => k + 1);
  }, []);
  return { transcript, runKey, onLevel, restart };
}

function App() {
  const [type, setType] = useState<VoiceBeamType>("mobile");
  const [processing, setProcessing] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [paused, setPaused] = useState(false);
  const [fps, setFps] = useState(0);
  const { transcript, runKey, onLevel, restart } = useTranscript();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { restart(); }, [type, processing, restart]);

  /* Frame rate readout, so a device's real rate is on screen. */
  useEffect(() => {
    let frames = 0; let last = performance.now(); let id = 0;
    const tick = (t: number) => { frames++; if (t - last >= 1000) { setFps(Math.round((frames * 1000) / (t - last))); frames = 0; last = t; } id = requestAnimationFrame(tick); };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const level = processing ? 0 : demoGetter;
  const B = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) => (
    <button type="button" aria-pressed={on} onClick={onClick}>{children}</button>
  );
  return (
    <div className="vp">
      <span className="vp-fps" aria-live="off">{fps} fps</span>
      <VoiceBeam type={type} level={level} processing={processing} paused={paused} theme={theme} borderRadius={RADIUS[type]} onLevel={onLevel}>
        {type === "pill" ? <RecordingPill running={!processing} paused={paused} resetKey={runKey} />
          : type === "mobile" ? <PhoneScreen promptKey={runKey} transcript={transcript} />
          : <ChatInputMock radius={RADIUS.default} />}
      </VoiceBeam>
      <div className="vp-bar">
        <B on={type === "default"} onClick={() => setType("default")}>Chat</B>
        <B on={type === "pill"} onClick={() => setType("pill")}>Pill</B>
        <B on={type === "mobile"} onClick={() => setType("mobile")}>Mobile</B>
        <B on={processing} onClick={() => setProcessing((p) => !p)}>Processing</B>
        <B on={theme === "light"} onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>Light</B>
        <B on={paused} onClick={() => setPaused((p) => !p)}>Pause</B>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
