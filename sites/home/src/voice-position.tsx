import { type CSSProperties, type RefObject, StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { VoiceRing } from "voice-ring";
import { demoGetter } from "./examples/voice-mocks";
import "./voice-position.css";

/* Voice position page — the showcase on the stage card: Voice ring on a
   phone, listening to a voice that moves round it (simulated), with where
   the sound comes from drawn around the phone, a live readout of the side
   and the distance the model detects, and the bar under the ring growing
   when the voice is further off, as the voice orbs iPhone demo does. It runs
   on its own and pauses off screen; with reduced motion it waits for Play. */

type Source = "left" | "front" | "right";
type Distance = "small" | "large";

// A speaker moves round the phone: close on the left, far off in front, close
// on the right, far off in front again. Only combinations the model was tested
// on: voices far off to one side aren't yet.
const ROUTE: { source: Source; distance: Distance }[] = [
  { source: "left", distance: "small" },
  { source: "front", distance: "large" },
  { source: "right", distance: "small" },
  { source: "front", distance: "large" },
];
const TURN = 5600;
// what the model takes to commit to a side and to a distance, as on the device
const SIDE_AFTER = 700;
const DISTANCE_AFTER = 1250;

// The stage is laid out at least this wide; narrower, it is scaled down.
const STAGE_W = 880;
const STAGE_H = 760;
// the voice screen: 240 px of the design's 402, its top 30 px down the stage
const PHONE_W = 240;
const PHONE_TOP = 30;
const U = PHONE_W / 402;
// how far out from the phone a close voice on either side is drawn, and a far
// voice in front
const SIDE_GAP = 100;
const FAR_GAP = 150;

const LABEL: Record<Source, string> = { left: "Left", front: "Front", right: "Right" };
const PAN: Record<Source, number> = { left: -1, front: 0, right: 1 };
const ANGLE: Record<Source, number> = { left: -62, front: 0, right: 58 };
const DISTANCE_LABEL: Record<Distance, string> = { small: "Small", large: "Large" };
// where the simulated voice stands, and the side of the line it reads
const STANDS: Record<Distance, string> = { small: "40 CM", large: "1 M" };
const RANGE: Record<Distance, string> = { small: "< 70 cm", large: "≥ 70 cm" };

interface Reading {
  turn: number;
  /** Where the voice is now; the detector catches up a moment later. */
  source: Source;
  stands: Distance;
  side: Source | null;
  sideConfidence: number;
  distance: Distance | null;
  distanceConfidence: number;
}

/** The scripted run: a voice from each place in turn, its side detected a beat after it starts and its distance a beat later. */
function useSimulation(paused: boolean): Reading {
  const [r, setR] = useState<Reading>({
    turn: 0,
    source: ROUTE[0].source,
    stands: ROUTE[0].distance,
    side: null,
    sideConfidence: 0,
    distance: null,
    distanceConfidence: 0,
  });
  useEffect(() => {
    if (paused) return;
    const t = r.turn;
    const jitter = (k: number) => 0.84 + ((t * 37 + k * 13) % 11) / 100;
    const ids = [
      setTimeout(() => setR((p) => ({ ...p, side: p.source, sideConfidence: jitter(1) })), SIDE_AFTER),
      setTimeout(() => setR((p) => ({ ...p, distance: p.stands, distanceConfidence: jitter(2) })), DISTANCE_AFTER),
      setTimeout(
        () =>
          setR((p) => ({
            ...p,
            turn: t + 1,
            source: ROUTE[(t + 1) % ROUTE.length].source,
            stands: ROUTE[(t + 1) % ROUTE.length].distance,
            side: null,
            sideConfidence: 0,
            distance: null,
            distanceConfidence: 0,
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
  // the ring holds its side, and the bar its size, until the next is detected
  const [lean, setLean] = useState(0);
  useEffect(() => {
    if (r.side) setLean(PAN[r.side]);
  }, [r.side]);
  const [large, setLarge] = useState(false);
  useEffect(() => {
    if (r.distance) setLarge(r.distance === "large");
  }, [r.distance]);

  // laid out at the card's width, or at STAGE_W and scaled down to fit
  const w = Math.max(width, STAGE_W);
  const h = STAGE_H;
  const scale = Math.min(1, width / STAGE_W);
  // the phone in the middle, a close source a little way out on either side of
  // it at the ring's height, and a far one in front, well below it
  const phone = { l: w / 2 - PHONE_W / 2, r: w / 2 + PHONE_W / 2, b: PHONE_TOP + 874 * U };
  const ringY = PHONE_TOP + 518 * U;
  const at: Record<Source, { x: number; y: number }> = {
    left: { x: phone.l - SIDE_GAP, y: ringY },
    right: { x: phone.r + SIDE_GAP, y: ringY },
    front: { x: w / 2, y: phone.b + FAR_GAP },
  };
  const src = at[r.source];
  // the signal runs from the source to just short of the phone
  const end: Record<Source, { x: number; y: number }> = {
    left: { x: phone.l - 14, y: ringY },
    right: { x: phone.r + 14, y: ringY },
    front: { x: w / 2, y: phone.b + 14 },
  };

  // the readout: centred under a side source, beside the phone for one in
  // front; a dotted leader runs up (or across) to the source
  const front = r.source === "front";
  const bx = front ? phone.r + 40 : src.x - BADGE_W / 2;
  const by = front ? Math.min(src.y - BADGE_H / 2, h - 24 - BADGE_H) : src.y + 66;
  const leader: CSSProperties = front
    ? { right: "100%", top: src.y - by, width: bx - src.x - 12 }
    : { left: BADGE_W / 2 - 1, bottom: "100%", height: Math.max(0, by - src.y - 48) };

  return (
    <div className="vp-fit" ref={box} data-paused-by-user={paused} style={{ height: h * scale }}>
      <div
        className="vp-stage"
        data-paused={still}
        role="img"
        aria-label={`Voice ring on a phone, leaning toward a simulated voice that moves from the left, to far off in front, to the right, while the bar under it grows when the voice is further off. Now: a voice from the ${LABEL[r.source].toLowerCase()}, detected as ${r.side ? LABEL[r.side].toLowerCase() : "…"}, at a ${r.distance ?? "…"} distance.`}
        style={{ width: w, height: h, transform: scale < 1 ? `scale(${scale})` : undefined, "--accent": "rgb(237, 237, 237)" } as CSSProperties}
      >
        <svg className="vp-signal" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
          <line key={r.turn} data-live={r.side ? "true" : "false"} x1={src.x} y1={src.y} x2={end[r.source].x} y2={end[r.source].y} />
        </svg>

        <div className="vp-phone" aria-hidden="true">
          <div className="vp-screen" ref={screen}>
            <div className="vp-ring">
              <VoiceRing
                size={Math.round(192 * (PHONE_W / 300))}
                state="listening"
                level={demoGetter}
                direction={lean}
                directionBounds={screen}
                directionMargin={Math.round(32 * U)}
                paused={still}
                theme="dark"
              />
            </div>
            <p className="vp-status">Listening</p>
            <div className="vp-composer" data-large={large}>
              <div className="vp-ask">
                <span>Ask anything</span>
              </div>
              <span className="vp-glass">
                <span className="vp-icon" style={{ "--icon": "url(/assets/voice-position/microphone-01.svg)" } as CSSProperties} />
              </span>
              <span className="vp-end">
                <span className="vp-icon close" style={{ "--icon": "url(/assets/voice-position/close.svg)" } as CSSProperties} />
              </span>
            </div>
          </div>
        </div>

        <Emitter
          key={`e${r.turn}`}
          x={src.x}
          y={src.y}
          to={{ x: end[r.source].x - src.x, y: end[r.source].y - src.y }}
          label={`${LABEL[r.source]} · ${STANDS[r.stands]}`}
          live={!!r.side}
        />

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

// Detection boxes, in the source's own frame: `a` px along the way to the
// phone and `o` px across it. The trace boxes pick the voice out of the air
// on its way to the phone once its side is known, in quick succession, each
// for a moment; `d` is when, in s from the voice's start, and `alpha` how
// strongly each shows. The scan boxes flash round the source while it is
// still being found.
const TRACE = [
  { a: 44, o: -18, w: 20, h: 16, d: 0.75, alpha: 0.8, tag: true },
  { a: 74, o: 12, w: 24, h: 18, d: 0.95, alpha: 0.35, tag: false },
  { a: 100, o: -22, w: 16, h: 12, d: 1.15, alpha: 0.6, tag: false },
  { a: 60, o: 26, w: 18, h: 14, d: 1.35, alpha: 0.45, tag: true },
  { a: 112, o: 8, w: 14, h: 12, d: 1.55, alpha: 0.25, tag: false },
  { a: 88, o: -36, w: 22, h: 16, d: 1.75, alpha: 0.55, tag: false },
];
const SCAN = [
  { x: -36, y: -6, w: 16, h: 12, d: 0, alpha: 0.5 },
  { x: 36, y: -22, w: 20, h: 14, d: 0.1, alpha: 0.8 },
  { x: -32, y: 14, w: 16, h: 12, d: 0.2, alpha: 0.3 },
  { x: 34, y: 12, w: 14, h: 10, d: 0.3, alpha: 0.6 },
];
// the box locked round the source (its size is in the CSS too)
const LOCK = { w: 28, h: 22 };

/** How far along (dx, dy), in its own units, a `w` × `h` box's edge is from its centre. */
const toEdge = (w: number, h: number, dx: number, dy: number) =>
  Math.min(dx ? w / 2 / Math.abs(dx) : Infinity, dy ? h / 2 / Math.abs(dy) : Infinity);

/**
 * The sound's source, as detection: a box that searches round it and locks
 * on once the side is detected, with the source's position on a tag; and
 * small boxes flicking up in the air between it and the phone, linked back
 * to the source.
 */
function Emitter({
  x,
  y,
  to,
  label,
  live,
}: {
  x: number;
  y: number;
  /** Where the phone is from the source, CSS px. */
  to: { x: number; y: number };
  label: string;
  live: boolean;
}) {
  const ox = Math.round(x);
  const oy = Math.round(y);
  const reach = Math.hypot(to.x, to.y) || 1;
  const u = { x: to.x / reach, y: to.y / reach };
  // a source just under the phone has no room on the way to it, so its
  // boxes spread out across the way instead
  const spread = reach < 80 ? 2.6 : 1;
  const trace = TRACE.map((q) => {
    const a = Math.min(q.a, reach - toEdge(q.w, q.h, u.x, u.y) - 8);
    const cx = u.x * a - u.y * q.o * spread;
    const cy = u.y * a + u.x * q.o * spread;
    const from = toEdge(LOCK.w, LOCK.h, cx, cy);
    const into = 1 - toEdge(q.w, q.h, cx, cy);
    return {
      ...q,
      x: Math.round(cx - q.w / 2),
      y: Math.round(cy - q.h / 2),
      link: into > from ? [cx * from, cy * from, cx * into, cy * into] : null,
    };
  });

  return (
    <div className="vp-emitter" data-live={live} style={{ left: ox, top: oy }} aria-hidden="true">
      <svg className="vp-links" width="1" height="1">
        {trace.map(
          (q, i) =>
            q.link && (
              <line
                key={i}
                x1={q.link[0]}
                y1={q.link[1]}
                x2={q.link[2]}
                y2={q.link[3]}
                style={{ "--d": `${q.d}s`, strokeOpacity: q.alpha } as CSSProperties}
              />
            )
        )}
      </svg>
      {SCAN.map((q, i) => (
        <Box key={`s${i}`} className="scan" rect={{ x: q.x - q.w / 2, y: q.y - q.h / 2, w: q.w, h: q.h }} delay={q.d} alpha={q.alpha} />
      ))}
      {trace.map((q, i) => (
        <Box key={`t${i}`} className="trace" rect={q} delay={q.d} alpha={q.alpha} tag={q.tag ? `${ox + q.x}, ${oy + q.y}` : undefined} />
      ))}
      <Box className="lock" tag={live ? `${ox}, ${oy}` : "SCAN"} />
      <span className="vp-emitter-label">SRC · {label.toUpperCase()}</span>
    </div>
  );
}

/**
 * One detection box: a 1px frame drawn in from its corner handles and a tag
 * over its corner. Without a `rect` its place and size come from the CSS.
 */
function Box({
  className,
  rect,
  delay = 0,
  alpha = 1,
  tag,
}: {
  className: string;
  rect?: { x: number; y: number; w: number; h: number };
  delay?: number;
  alpha?: number;
  tag?: string;
}) {
  const style = { "--d": `${delay}s`, opacity: alpha } as CSSProperties;
  if (rect) Object.assign(style, { left: Math.round(rect.x), top: Math.round(rect.y), width: rect.w, height: rect.h });
  return (
    <span className={`vp-box ${className}`} style={style}>
      {tag && (
        <span className="vp-box-tag">
          <Decode text={tag} pending={tag === "SCAN"} />
        </span>
      )}
    </span>
  );
}

const BADGE_W = 172;
const BADGE_H = 80;

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

  return (
    <div className="vp-badge" data-orient={across ? "across" : "down"} style={{ width: BADGE_W, height: BADGE_H, transform: `translate(${x}px, ${y}px)` }}>
      <svg className="vp-badge-outline" aria-hidden="true">
        <rect className="dots" x="0.5" y="0.5" width={BADGE_W - 1} height={BADGE_H - 1} rx="9" pathLength="100" />
      </svg>
      <span className="vp-corner tl" />
      <span className="vp-corner tr" />
      <span className="vp-corner bl" />
      <span className="vp-corner br" />
      <span className="vp-leader" style={leader} aria-hidden="true" />

      <div className="vp-badge-head">
        <span className="vp-live">LIVE</span>
        <span>VOICE ANALYSIS</span>
        <Clock clock={clock} paused={paused} />
      </div>

      <div className="vp-row">
        <span className="vp-key">DIRECTION</span>
        <Decode className="vp-value" text={r.side ? LABEL[r.side] : "Detecting"} pending={!r.side} />
        <span className="vp-read">{angle == null ? "—" : `${angle > 0 ? "+" : angle < 0 ? "−" : "±"}${Math.abs(angle)}°`}</span>
      </div>
      <DotMeter value={r.side ? r.sideConfidence : 0} />

      <div className="vp-row">
        <span className="vp-key">DISTANCE</span>
        <Decode className="vp-value" text={r.distance ? DISTANCE_LABEL[r.distance] : "Detecting"} pending={!r.distance} />
        <span className="vp-read">{r.distance ? RANGE[r.distance] : "—"}</span>
      </div>
      <DotMeter value={r.distance ? r.distanceConfidence : 0} />
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
function DotMeter({ value }: { value: number }) {
  const lit = Math.round(value * DOTS);
  return (
    <div className="vp-meter" aria-hidden="true">
      {Array.from({ length: DOTS }, (_, i) => (
        <i key={i} data-on={i < lit} style={{ transitionDelay: `${i * 22}ms` }} />
      ))}
      <span className="vp-pct">{value ? `${Math.round(value * 100)}%` : "··%"}</span>
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
    <span className="vp-clock" ref={el}>
      {stamp(clock.elapsed)}
    </span>
  );
}

const rootEl = document.getElementById("position-demo");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <DirectionDemo />
    </StrictMode>
  );
}
