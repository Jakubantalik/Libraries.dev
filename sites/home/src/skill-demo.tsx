import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { BorderBeam } from "border-beam";
import { MetalBadge } from "metal-fx";
import { ThinkingOrb } from "thinking-orbs";
import { Liquid } from "liquid-gooey";
import { VoiceBeam, useMicrophone } from "voice-glow";
import { BotAvatar } from "bot-avatars";
import { demoLevel } from "./examples/voice-mocks";

/* Skill demo page (Figma 1635:1035): the libraries applied to plain agent
   UI, one prototype per row, for recording what the Libraries.dev skill
   does to an interface. The left column is the comparison: the same
   components with the stock effect a generic AI agent reaches for in
   place of each library. Not linked from the site. The voice runs on the
   synthetic demo voice; add ?mic to the URL to speak into it instead. */

const USE_MIC = new URLSearchParams(window.location.search).has("mic");

/* The prompt input both columns share. */
function PromptForm() {
  return (
    <form className="sd-input" onSubmit={(e) => e.preventDefault()}>
      <input className="sd-input-field" placeholder="Build anything..." aria-label="What should the agent build?" />
      <button type="submit" className="sd-input-send" aria-label="Send">
        <img src="/assets/icons/arrow-up-16.svg" width={16} height={16} alt="" draggable={false} />
      </button>
    </form>
  );
}

/* Input with the rotating border beam. */
function BuildInput() {
  return (
    <BorderBeam size="md" theme="dark" className="sd-beam">
      <PromptForm />
    </BorderBeam>
  );
}

/* Label with the metal "New" badge (the badge carries the Figma metrics). */
function StudioApp() {
  return (
    <div className="sd-studio">
      <span className="sd-studio-label">Studio app</span>
      {/* 0.88 × the Figma's 45×25 badge: 22px tall. */}
      <MetalBadge theme="dark" scale={0.88}>New</MetalBadge>
    </div>
  );
}

/* Button with the inner pulse of the border beam. */
function GetPro() {
  return (
    <BorderBeam size="pulse-inner" theme="dark" strength={0.8} className="sd-beam">
      <button type="button" className="sd-btn">Get Pro</button>
    </BorderBeam>
  );
}

function Planning() {
  return (
    <div className="sd-status">
      {/* Sizes are 64 / 32 / 20 presets; the 32 drawn at 24px stays crisp. */}
      <ThinkingOrb state="connecting" size={32} theme="dark" style={{ width: 24, height: 24 }} />
      <span className="t-shimmer" data-text="Planning next steps">Planning next steps</span>
    </div>
  );
}

/* Generate → Generating video…: the pill resizes to the incoming label
   (transitions.dev card resize) while the two labels cross-blur in place,
   and the working label carries an orb and the shimmer. Both layers are
   always mounted so each can be measured; the button's width is set to
   the active one. */
function GenerateButton({ generic = false }: { generic?: boolean }) {
  const [generating, setGenerating] = useState(false);
  const idleRef = useRef<HTMLSpanElement>(null);
  const busyRef = useRef<HTMLSpanElement>(null);
  const [widths, setWidths] = useState<[number, number] | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      if (idleRef.current && busyRef.current) setWidths([idleRef.current.offsetWidth, busyRef.current.offsetWidth]);
    };
    measure();
    /* Inter arrives after first paint; its metrics differ from the fallback. */
    document.fonts?.ready.then(measure);
  }, []);

  const width = widths ? widths[generating ? 1 : 0] : undefined;

  return (
    <div className="sd-gen-anchor" style={{ width: widths?.[0] }}>
      <button
        type="button"
        className="sd-btn sd-gen"
        data-state={generating ? "busy" : "idle"}
        style={{ width }}
        aria-label={generating ? "Generating video, click to cancel" : "Generate"}
        onClick={() => setGenerating((g) => !g)}
      >
        <span ref={idleRef} className="sd-gen-layer" data-layer="idle" aria-hidden="true">
          Generate
        </span>
        <span ref={busyRef} className="sd-gen-layer" data-layer="busy" aria-hidden="true">
          {generic ? (
            <>
              <span className="gx-spinner gx-spinner--sm" />
              <span className="gx-pulse">Generating video...</span>
            </>
          ) : (
            <>
              {/* The Orb page's "Agent thinking…" chip orb. */}
              <ThinkingOrb state="breathing" size={20} theme="dark" paused={!generating} />
              <span className="t-shimmer" data-text="Generating video...">Generating video...</span>
            </>
          )}
        </span>
      </button>
    </div>
  );
}

/* Recording state and the mm:ss counter, shared by both voice pills. */
function useRecordingClock() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const startedAt = useRef(0);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      setSeconds(Math.floor((performance.now() - startedAt.current) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [recording]);

  const start = () => {
    startedAt.current = performance.now();
    setSeconds(0);
    setRecording(true);
  };
  const stop = () => setRecording(false);

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return { recording, time: `${mm}:${ss}`, startedAt, start, stop };
}

/* The pill itself, shared by both columns: mic, the mm:ss counter and
   the speak button that swaps to stop. It widens on the card resize and
   the anchor around it keeps it centred, so it opens out to both sides. */
function PillBody({ recording, time, onToggle, className = "" }: { recording: boolean; time: string; onToggle: () => void; className?: string }) {
  return (
    <div className={`sd-pill ${className}`} data-state={recording ? "on" : "off"}>
      <img className="sd-pill-mic" src="/assets/icons/mic-16.svg" width={16} height={16} alt="" draggable={false} />
      <span className="sd-pill-time" aria-hidden={!recording}>
        {time}
      </span>
      <button type="button" className="sd-pill-btn" aria-label={recording ? "Stop recording" : "Speak"} onClick={onToggle}>
        <span className="t-icon-swap" data-state={recording ? "b" : "a"}>
          <img className="t-icon" data-icon="a" src="/assets/icons/recording-18.svg" width={18} height={18} alt="" draggable={false} />
          <span className="t-icon sd-pill-stop" data-icon="b" />
        </span>
      </button>
    </div>
  );
}

/* Voice pill: the speak button opens it into the recording pill — the
   counter runs and the voice glow rises from its bottom edge; stop
   closes it again. */
function VoicePill() {
  const { recording, time, startedAt, start, stop } = useRecordingClock();
  const mic = useMicrophone();

  /* The demo voice restarts with every recording so it speaks at once. */
  const level = useCallback(() => demoLevel((performance.now() - startedAt.current) / 1000 + 0.35), [startedAt]);

  const toggle = () => {
    if (recording) {
      if (USE_MIC) mic.stop();
      stop();
      return;
    }
    if (USE_MIC) mic.start();
    start();
  };

  return (
    <div className="sd-pill-anchor">
      <VoiceBeam type="pill" theme="dark" active={recording} {...(USE_MIC ? { stream: mic.stream } : { level })}>
        <PillBody recording={recording} time={time} onToggle={toggle} />
      </VoiceBeam>
    </div>
  );
}

/* Plus → three options, the Gooey demo page's plus menu (same arc,
   springs, stagger and close anticipation) on the Figma's 36px button. */
const BOUNCY = "cubic-bezier(0.34, 1.56, 0.64, 1)";
const SNAPPY = "cubic-bezier(0.22, 1, 0.36, 1)";
/* The Generate pill's 16% white (Figma 1209:4827) flattened onto the
   #070707 ground: the goo filter's alpha contrast would turn a
   translucent fill solid white. */
const PLUS_FILL = "#2f2f2f";
const PLUS_SHADOW = "0 0 0 1px rgba(255, 255, 255, 0.04) inset, 0 1px 0 0 rgba(255, 255, 255, 0.04) inset";
const OPTIONS = [
  {
    label: "New file",
    x: -48,
    y: -30,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6z" />
        <path d="M9 1.5V6h4.5" />
      </svg>
    ),
  },
  {
    label: "Add image",
    x: 0,
    y: -57,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
        <circle cx="5.5" cy="5.5" r="1.25" />
        <path d="M14.5 10.5L11 7l-7.5 7.5" />
      </svg>
    ),
  },
  {
    label: "New folder",
    x: 48,
    y: -30,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 12.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h3L7.5 4H13a1.5 1.5 0 0 1 1.5 1.5z" />
      </svg>
    ),
  },
];

function PlusIcon() {
  return (
    <span className="sd-pm-plus">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M8 3.25V12.75M3.25 8H12.75" />
      </svg>
    </span>
  );
}

function PlusMenu() {
  const [open, setOpen] = useState(false);
  const [anticipating, setAnticipating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const toggle = () => {
    /* Closing dips the liquid toward the returning options, then settles. */
    if (open) {
      if (timer.current) clearTimeout(timer.current);
      setAnticipating(false);
      requestAnimationFrame(() => setAnticipating(true));
      timer.current = setTimeout(() => setAnticipating(false), 700);
    }
    setOpen((o) => !o);
  };

  return (
    <Liquid
      blur={6}
      contrast={18}
      fill={PLUS_FILL}
      shadow={PLUS_SHADOW}
      className={`sd-pm${open ? " is-open" : ""}${anticipating ? " is-anticipating" : ""}`}
    >
      {OPTIONS.map((o, i) => (
        <Liquid.Item
          key={o.label}
          className="sd-pm-slot"
          x={open ? o.x : 0}
          y={open ? o.y : 0}
          transition={open ? { duration: 550, ease: BOUNCY } : { duration: 250, ease: SNAPPY }}
          delay={open ? i * 40 : 0}
        >
          <button type="button" className="sd-pm-btn sd-pm-opt" aria-label={o.label} tabIndex={open ? 0 : -1} onClick={toggle}>
            <span className="sd-pm-icon" style={{ transitionDelay: open ? `${120 + i * 40}ms` : "0ms" }}>
              {o.icon}
            </span>
          </button>
        </Liquid.Item>
      ))}
      <Liquid.Item className="sd-pm-slot">
        <button
          type="button"
          className="sd-pm-btn sd-pm-main"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={toggle}
        >
          <PlusIcon />
        </button>
      </Liquid.Item>
    </Liquid>
  );
}

function Assistant() {
  return (
    <div className="sd-agent">
      <BotAvatar type="triangle" state="default" size={48} theme="dark" />
      <div className="sd-agent-text">
        <p>Personal assistant</p>
        <p className="t-shimmer" data-text="Booking the venue…">Booking the venue…</p>
      </div>
    </div>
  );
}

/* ── Generic AI column ──────────────────────────────────────────
   The same components with the effect a generic agent writes when asked
   for "a glowing border", "a shiny badge", "a loading state": stock
   Tailwind-style keyframes (spin, pulse, ping), violet gradients, and
   state changes that jump instead of transition. */

function GenericInput() {
  return (
    <div className="gx-input-glow">
      <PromptForm />
    </div>
  );
}

function GenericStudioApp() {
  return (
    <div className="sd-studio">
      <span className="sd-studio-label">Studio app</span>
      <span className="gx-badge">New</span>
    </div>
  );
}

function GenericGetPro() {
  return (
    <button type="button" className="sd-btn gx-ping">Get Pro</button>
  );
}

function GenericPlanning() {
  return (
    <div className="sd-status">
      <span className="gx-spinner" aria-hidden="true" />
      <span className="t-shimmer" data-text="Planning next steps">Planning next steps</span>
    </div>
  );
}

/* Same pill and motion; a red ping stands in for the voice glow. */
function GenericVoicePill() {
  const { recording, time, start, stop } = useRecordingClock();
  return (
    <div className="sd-pill-anchor">
      <PillBody recording={recording} time={time} onToggle={recording ? stop : start} className={recording ? "gx-pill is-rec" : "gx-pill"} />
    </div>
  );
}

/* Same arc and button as the gooey menu, but the options just scale and
   fade out of the button on one `transition: all`. */
function GenericPlusMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className={`sd-pm gx-pm${open ? " is-open" : ""}`}>
      {OPTIONS.map((o) => (
        <button
          key={o.label}
          type="button"
          className="sd-pm-btn gx-pm-opt"
          style={{ "--x": `${o.x}px`, "--y": `${o.y}px` } as CSSProperties}
          aria-label={o.label}
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
        >
          {o.icon}
        </button>
      ))}
      <button
        type="button"
        className="sd-pm-btn gx-pm-main"
        aria-expanded={open}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((v) => !v)}
      >
        <PlusIcon />
      </button>
    </div>
  );
}

function GenericAssistant() {
  return (
    <div className="sd-agent">
      <span className="gx-avatar" aria-hidden="true">
        🤖
      </span>
      <div className="sd-agent-text">
        <p>Personal assistant</p>
        <p className="t-shimmer" data-text="Booking the venue…">Booking the venue…</p>
      </div>
    </div>
  );
}

/* Row by row, generic on the left and the library on the right, so each
   pair shares a grid row and lines up. */
function SkillDemo() {
  return (
    <main className="sd">
      <div className="sd-grid">
        <p className="sd-head">Generic AI</p>
        <p className="sd-head">Libraries.dev</p>
        <GenericInput />
        <BuildInput />
        <GenericStudioApp />
        <StudioApp />
        <GenericGetPro />
        <GetPro />
        <GenericPlanning />
        <Planning />
        <GenerateButton generic />
        <GenerateButton />
        <GenericVoicePill />
        <VoicePill />
        <GenericPlusMenu />
        <PlusMenu />
        <GenericAssistant />
        <Assistant />
      </div>
    </main>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  /* No StrictMode: metal-fx keeps one shared renderer, and the simulated
     double mount leaves its loop frozen (see metal.tsx). */
  createRoot(rootEl).render(<SkillDemo />);
}
