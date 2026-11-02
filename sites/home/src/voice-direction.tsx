import { type CSSProperties, type RefObject, StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { EMOTION_COLORS, VoiceRing, type VoiceOrbEmotion } from "voice-ring";
import { demoGetter } from "./examples/voice-mocks";
import "./voice-direction.css";

/* Voice direction page — the showcase on the stage card: Voice ring on a
   phone, listening to a voice that moves round it (simulated), with where
   the sound comes from drawn around the phone and a live readout of what
   the models detect: the side, and the feeling of the voice. The same
   stage as the voice orbs demo's "Simulated direction" tab. It runs on its
   own and pauses off screen; with reduced motion it waits for Play. */

type Source = "left" | "front" | "right";

// A speaker moves round the phone: left, in front, right, in front again.
const ROUTE: Source[] = ["left", "front", "right", "front"];
/** What the voice sounds like: one of the ring's emotions, or neutral (its own colours). */
type Mood = VoiceOrbEmotion | "neutral";
// a feeling from each side; from in front, a level, neutral voice
const MOODS: Mood[] = ["positive", "neutral", "negative", "neutral"];
const TURN = 5600;
// what the models take to commit, as on the device: the side first, then
// the feeling, which needs a little more of the voice
const SIDE_AFTER = 700;
const MOOD_AFTER = 1600;

// The stage is laid out at least this wide; narrower, it is scaled down.
const STAGE_W = 880;
const STAGE_H = 680;
// the voice screen: 240 px of the design's 402, its top 30 px down the stage
const PHONE_W = 240;
const PHONE_TOP = 30;
const U = PHONE_W / 402;
// how far out from the phone a voice on either side is drawn
const SIDE_GAP = 150;

const LABEL: Record<Source, string> = { left: "Left", front: "Front", right: "Right" };
const PAN: Record<Source, number> = { left: -1, front: 0, right: 1 };
const ANGLE: Record<Source, number> = { left: -62, front: 0, right: 58 };
const MOOD_LABEL: Record<Mood, string> = { positive: "Positive", negative: "Negative", calm: "Calm", neutral: "Neutral" };
// where each feeling sits: valence (unhappy … happy), arousal (calm … excited)
const AFFECT: Record<Mood, [number, number]> = {
  positive: [0.64, 0.58],
  negative: [-0.57, 0.71],
  calm: [0.31, 0.18],
  neutral: [0.03, 0.24],
};

interface Reading {
  turn: number;
  /** Where the voice is now; the detector catches up a moment later. */
  source: Source;
  side: Source | null;
  sideConfidence: number;
  mood: Mood | null;
  moodConfidence: number;
}

/** The scripted run: a voice from each side in turn, detected a beat after it starts. */
function useSimulation(paused: boolean): Reading {
  const [r, setR] = useState<Reading>({
    turn: 0,
    source: ROUTE[0],
    side: null,
    sideConfidence: 0,
    mood: null,
    moodConfidence: 0,
  });
  useEffect(() => {
    if (paused) return;
    const t = r.turn;
    const jitter = (k: number) => 0.84 + ((t * 37 + k * 13) % 11) / 100;
    const ids = [
      setTimeout(() => setR((p) => ({ ...p, side: p.source, sideConfidence: jitter(1) })), SIDE_AFTER),
      setTimeout(() => setR((p) => ({ ...p, mood: MOODS[t % MOODS.length], moodConfidence: jitter(2) - 0.06 })), MOOD_AFTER),
      setTimeout(
        () =>
          setR((p) => ({
            ...p,
            turn: t + 1,
            source: ROUTE[(t + 1) % ROUTE.length],
            side: null,
            sideConfidence: 0,
            mood: null,
            moodConfidence: 0,
          })),
        TURN
      ),
    ];
    return () => ids.forEach(clearTimeout);
  }, [r.turn, paused]);
  return r;
}

/** The width the stage gets on the page, and whether it is on screen. */
function useFit(box: RefObject<HTMLDivElement>) {
  const [width, setWidth] = useState(STAGE_W);
  const [visible, setVisible] = useState(true);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, [box]);
  return { width, visible };
}

function DirectionDemo() {
  const box = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const clock = useRef({ elapsed: 0 });
  const [paused, setPaused] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const { width, visible } = useFit(box);
  const still = paused || !visible;

  const r = useSimulation(still);
  // the ring holds its side and its colour until the next ones are detected
  const [lean, setLean] = useState(0);
  const [mood, setMood] = useState<Mood | null>(null);
  useEffect(() => {
    if (r.side) setLean(PAN[r.side]);
  }, [r.side]);
  useEffect(() => {
    if (r.mood) setMood(r.mood);
  }, [r.mood]);

  // laid out at the card's width, or at STAGE_W and scaled down to fit
  const w = Math.max(width, STAGE_W);
  const h = STAGE_H;
  const scale = Math.min(1, width / STAGE_W);
  // the phone in the middle, a source a little way out on either side of it
  // at the ring's height, and one in front, below it
  const phone = { l: w / 2 - PHONE_W / 2, r: w / 2 + PHONE_W / 2, b: PHONE_TOP + 874 * U };
  const ringY = PHONE_TOP + 518 * U;
  const at: Record<Source, { x: number; y: number }> = {
    left: { x: phone.l - SIDE_GAP, y: ringY },
    right: { x: phone.r + SIDE_GAP, y: ringY },
    front: { x: w / 2, y: phone.b + 56 },
  };
  const src = at[r.source];
  // the signal runs from the source to just short of the phone
  const end: Record<Source, { x: number; y: number }> = {
    left: { x: phone.l - 14, y: ringY },
    right: { x: phone.r + 14, y: ringY },
    front: { x: w / 2, y: phone.b + 14 },
  };
  const towards = { left: 0, right: 180, front: -90 }[r.source];

  // the readout: centred under a side source, beside the phone for one in
  // front; a dotted leader runs up (or across) to the source
  const front = r.source === "front";
  const bx = front ? phone.r + 40 : src.x - BADGE_W / 2;
  const by = front ? Math.min(src.y - BADGE_H / 2, h - 24 - BADGE_H) : src.y + 66;
  const leader: CSSProperties = front
    ? { right: "100%", top: src.y - by, width: bx - src.x - 12 }
    : { left: BADGE_W / 2 - 1, bottom: "100%", height: Math.max(0, by - src.y - 48) };
  const tint = mood && mood !== "neutral" ? EMOTION_COLORS[mood] : null;
  const accent = tint ? `rgb(${tint.r}, ${tint.g}, ${tint.b})` : "rgb(237, 237, 237)";

  return (
    <div className="vd-fit" ref={box} data-paused-by-user={paused} style={{ height: h * scale }}>
      <div
        className="vd-stage"
        data-paused={still}
        role="img"
        aria-label={`Voice ring on a phone, leaning toward a simulated voice that moves from the left, to the front, to the right. Now: a voice from the ${LABEL[r.source].toLowerCase()}, detected as ${r.side ? LABEL[r.side].toLowerCase() : "…"}, sounding ${r.mood ? MOOD_LABEL[r.mood].toLowerCase() : "…"}.`}
        style={{ width: w, height: h, transform: scale < 1 ? `scale(${scale})` : undefined, "--accent": accent } as CSSProperties}
      >
        <svg className="vd-signal" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <line key={r.turn} data-live={r.side ? "true" : "false"} x1={src.x} y1={src.y} x2={end[r.source].x} y2={end[r.source].y} />
        </svg>

        <div className="vd-phone" aria-hidden="true">
          <div className="vd-screen" ref={screen}>
            <div className="vd-ring">
              <VoiceRing
                size={Math.round(192 * (PHONE_W / 300))}
                state="listening"
                level={demoGetter}
                direction={lean}
                emotion={mood === "neutral" ? null : mood}
                directionBounds={screen}
                directionMargin={Math.round(32 * U)}
                paused={still}
                theme="dark"
              />
            </div>
            <p className="vd-status">Listening</p>
            <div className="vd-composer">
              <div className="vd-ask">Ask anything</div>
              <span className="vd-glass">
                <span className="vd-icon" style={{ "--icon": "url(/assets/voice-direction/microphone-01.svg)" } as CSSProperties} />
              </span>
              <span className="vd-glass">
                <span className="vd-icon plus" style={{ "--icon": "url(/assets/voice-direction/plus.svg)" } as CSSProperties} />
              </span>
            </div>
          </div>
        </div>

        <Emitter key={`e${r.turn}`} x={src.x} y={src.y} towards={towards} label={LABEL[r.source]} live={!!r.side} />

        {/* a new readout with each voice, so it appears beside its source
            rather than sliding across the phone to get there */}
        <Badge key={r.turn} reading={r} x={bx} y={by} leader={leader} across={front} clock={clock.current} paused={still} />
      </div>

      <button
        type="button"
        className="mui-play"
        data-playing={!paused}
        aria-label={paused ? "Play the demo" : "Pause the demo"}
        onClick={() => setPaused((p) => !p)}
      >
        <svg className="mui-ico-pause" aria-hidden="true" viewBox="0 0 16 16"><rect x="4" y="3" width="2.75" height="10" rx="1" /><rect x="9.25" y="3" width="2.75" height="10" rx="1" /></svg>
        <svg className="mui-ico-play" aria-hidden="true" viewBox="0 0 16 16"><path d="M5.25 3.6c0-.6.65-.97 1.17-.66l6.3 3.9c.5.3.5 1.02 0 1.32l-6.3 3.9c-.52.31-1.17-.06-1.17-.66V3.6Z" /></svg>
      </button>
    </div>
  );
}

/** The sound's source: a pulsing point with dotted wavefronts toward the phone. */
function Emitter({ x, y, towards, label, live }: { x: number; y: number; towards: number; label: string; live: boolean }) {
  return (
    <div className="vd-emitter" data-live={live} style={{ left: x, top: y }} aria-hidden="true">
      <span className="vd-emitter-ring" />
      <span className="vd-emitter-ring" />
      <span className="vd-emitter-core" />
      <svg className="vd-waves" viewBox="-40 -40 80 80" width="80" height="80" style={{ rotate: `${towards}deg` }}>
        {[14, 22, 30].map((rad, i) => (
          <path
            key={rad}
            d={`M ${rad * Math.cos(-0.6)} ${rad * Math.sin(-0.6)} A ${rad} ${rad} 0 0 1 ${rad * Math.cos(0.6)} ${rad * Math.sin(0.6)}`}
            style={{ animationDelay: `${i * 180}ms` }}
          />
        ))}
      </svg>
      <span className="vd-emitter-label">SRC · {label.toUpperCase()}</span>
    </div>
  );
}

const BADGE_W = 172;
const BADGE_H = 86;

/** The live readout, at `x`, `y` on the stage, its leader running to the source. */
function Badge({
  reading: r,
  x,
  y,
  leader,
  across,
  clock,
  paused,
}: {
  reading: Reading;
  x: number;
  y: number;
  leader: CSSProperties;
  across: boolean;
  /** Seconds run so far, shared by every readout. */
  clock: { elapsed: number };
  paused: boolean;
}) {
  const angle = r.side ? ANGLE[r.side] + (r.turn % 3) - 1 : null;
  const affect = r.mood ? AFFECT[r.mood] : null;

  return (
    <div className="vd-badge" data-orient={across ? "across" : "down"} style={{ width: BADGE_W, height: BADGE_H, transform: `translate(${x}px, ${y}px)` }}>
      <svg className="vd-badge-outline" aria-hidden="true">
        <rect className="dots" x="0.5" y="0.5" width={BADGE_W - 1} height={BADGE_H - 1} rx="9" pathLength="100" />
        <rect className="sweep" x="0.5" y="0.5" width={BADGE_W - 1} height={BADGE_H - 1} rx="9" pathLength="100" />
      </svg>
      <span className="vd-corner tl" />
      <span className="vd-corner tr" />
      <span className="vd-corner bl" />
      <span className="vd-corner br" />
      <span className="vd-leader" style={leader} aria-hidden="true" />

      <div className="vd-badge-head">
        <span className="vd-live">LIVE</span>
        <span>VOICE ANALYSIS</span>
        <Clock clock={clock} paused={paused} />
      </div>

      <div className="vd-row">
        <span className="vd-key">DIRECTION</span>
        <Decode className="vd-value" text={r.side ? LABEL[r.side] : "Detecting"} pending={!r.side} />
        <span className="vd-read">{angle == null ? "—" : `${angle > 0 ? "+" : angle < 0 ? "−" : "±"}${Math.abs(angle)}°`}</span>
      </div>
      <DotMeter value={r.side ? r.sideConfidence : 0} />

      <div className="vd-row">
        <span className="vd-key">EMOTION</span>
        <Decode className="vd-value tinted" text={r.mood ? MOOD_LABEL[r.mood] : "Detecting"} pending={!r.mood} />
        <span className="vd-read">{affect ? `v${affect[0] > 0 ? "+" : "−"}${Math.abs(affect[0]).toFixed(2)} a${affect[1].toFixed(2)}` : "—"}</span>
      </div>
      <DotMeter value={r.mood ? r.moodConfidence : 0} tinted />
    </div>
  );
}

const GLYPHS = "01·:+×#<>/";

/** Text that decodes into place: each character cycles a few glyphs, then settles. */
function Decode({ text, pending, className }: { text: string; pending: boolean; className?: string }) {
  const [shown, setShown] = useState(text);
  const [settled, setSettled] = useState(text.length);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(text);
      setSettled(text.length);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = now - start;
      const done = Math.min(text.length, Math.floor(Math.max(0, t - 60) / 42));
      let out = text.slice(0, done);
      for (let i = done; i < text.length; i++) out += text[i] === " " ? " " : GLYPHS[Math.floor((t / 50 + i * 7) % GLYPHS.length)];
      setShown(out);
      setSettled(done);
      if (done < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);

  return (
    <span className={className} data-pending={pending}>
      {[...shown].map((ch, i) => (
        <span key={i} className={i < settled ? "on" : "scramble"}>
          {ch}
        </span>
      ))}
    </span>
  );
}

const DOTS = 18;

/** Confidence as a row of fine dots, filling one after another. */
function DotMeter({ value, tinted }: { value: number; tinted?: boolean }) {
  const lit = Math.round(value * DOTS);
  return (
    <div className="vd-meter" data-tinted={tinted ? "true" : "false"} aria-hidden="true">
      {Array.from({ length: DOTS }, (_, i) => (
        <i key={i} data-on={i < lit} style={{ transitionDelay: `${i * 22}ms` }} />
      ))}
      <span className="vd-pct">{value ? `${Math.round(value * 100)}%` : "··%"}</span>
    </div>
  );
}

const stamp = (s: number) => `T+${s.toFixed(1).padStart(5, "0")}s`;

/** Seconds the demo has run, counting live and holding while paused. */
function Clock({ clock, paused }: { clock: { elapsed: number }; paused: boolean }) {
  const el = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (paused) return;
    let last = performance.now();
    const id = setInterval(() => {
      const now = performance.now();
      clock.elapsed += (now - last) / 1000;
      last = now;
      if (el.current) el.current.textContent = stamp(clock.elapsed);
    }, 100);
    return () => clearInterval(id);
  }, [clock, paused]);
  return (
    <span className="vd-clock" ref={el}>
      {stamp(clock.elapsed)}
    </span>
  );
}

const rootEl = document.getElementById("direction-demo");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <DirectionDemo />
    </StrictMode>
  );
}
