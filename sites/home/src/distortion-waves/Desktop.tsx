import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { BorderBeam } from "border-beam";
import { defaultStyle, DistortionWave, type DistortionWaveHandle, type PaletteLike, type WaveStyleInput, type WaveType } from "distortion-waves";
import "./preview.css";
import "./desktop.css";

/* The desktop preview, on the page and in the Studio: the phone's moments (a
   transfer confirmed, from its button or from the card's edge, and a token
   sent) as a dialog on a web page, built the way a reader would build it.
   Both views are ordinary DOM inside the library's own <DistortionWave>;
   nothing here draws the wave. The button that starts it sits in `overlay`,
   so its beam, its spinner and its label stay live above the wave while the
   views under it are bent. */

type Phase = "rest" | "busy" | "done";
type Row = [label: string, value: string, accessory?: "copy" | "disclosure"];

export interface DesktopProps {
  type: WaveType;
  /** Loops the wave while true. */
  playing: boolean;
  /** How long the sent state stays before the demo goes back, s. */
  resetAfter?: number;
  /** How long the center type shows "Processing..." before its wave, s. */
  processing?: number;
  /** The wave's numbers, over the type's defaults (the Studio's knobs). */
  waveStyle?: WaveStyleInput;
  /** The wave's colours. Default: the type's own. */
  palette?: PaletteLike;
}

const TRANSFER_ROWS: Row[] = [
  ["From", "Everyday ·· 4821"],
  ["Arrives", "In seconds"],
  ["Fee", "Free"],
  ["Note", "Studio rent"],
];

const SHEET_ROWS: Row[] = [
  ["To", "HTjz…sUjs", "copy"],
  ["Onchain transaction", "3dpD…vfg8", "copy"],
  ["Onchain fees", "0.00206 SOL", "disclosure"],
];

const COIN_ARCS = "M24 15.36C14.2 20 10.6 31.5 15.2 41.3C17.2 45.5 20.3 48.6 24 50.4M40 15.36C49.8 20 53.4 31.5 48.8 41.3C46.8 45.5 43.7 48.6 40 50.4";
const COIN_DOLLAR = "M37.76 26.24C36.8 24 34.56 22.72 31.84 22.72C28.32 22.72 25.92 24.48 25.92 27.2C25.92 33.6 38.4 30.4 38.4 36.96C38.4 39.84 35.84 41.6 32 41.6C28.96 41.6 26.56 40.32 25.6 37.92M32 41.6V45.44M32 18.56V22.72";

/** One type at a time: a change of type starts the demo afresh. */
export function DistortionWaveDesktop(props: DesktopProps) {
  return <Scene key={props.type} {...props} />;
}

function Scene({ type, playing, resetAfter = 2, processing = 1.2, waveStyle, palette }: DesktopProps) {
  const center = type === "center";
  const sideways = type === "horizontal";
  const [sent, setSent] = useState(false);
  const [phase, setPhase] = useState<Phase>("rest");
  const [lit, setLit] = useState(false);
  const [gulp, setGulp] = useState(false);
  const [resets, setResets] = useState(0);

  const api = useRef<DistortionWaveHandle>(null);
  const button = useRef<HTMLButtonElement>(null);
  const token = useRef<HTMLSpanElement>(null);
  const edge = useRef<HTMLButtonElement>(null);
  const run = useRef({ on: false, landed: false, timers: [] as number[] });
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const born = useRef(0);
  /* The demo's own moments follow the wave's two times, tuned or not. A ref,
     so a run under way reads the knobs as they are when each moment is set. */
  const base = defaultStyle(type);
  const times = useRef({ anticipation: base.anticipation, travel: base.travel });
  times.current = { anticipation: waveStyle?.anticipation ?? base.anticipation, travel: waveStyle?.travel ?? base.travel };

  const later = (seconds: number, fn: () => void) => {
    run.current.timers.push(window.setTimeout(fn, seconds * 1000));
  };
  const clearTimers = () => {
    run.current.timers.forEach((id) => clearTimeout(id));
    run.current.timers = [];
  };

  const send = () => {
    const r = run.current;
    if (r.on) return;
    r.on = true;
    r.landed = false;
    clearTimers();
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (center) {
      // A moment of processing, then the ring leaves the token.
      setPhase("busy");
      // The status line has changed: picture the view again while there is
      // time, so the wave starts with its lens.
      if (!still) later(Math.min(0.45, processing * 0.5), () => void api.current?.prepare());
      later(processing, () => {
        setSent(true);
        later(still ? 0.15 : times.current.anticipation + times.current.travel * 0.03, () => setPhase("done"));
      });
      return;
    }
    setSent(true);
    if (still) {
      later(0.15, () => setPhase("done"));
      return;
    }
    // The button stays pressed through the anticipation and wears its beam
    // while the wave is out; its title changes as the front leaves it. A wave
    // from the edge leaves the button alone but for its title.
    const { anticipation, travel } = times.current;
    later(anticipation + travel * 0.18, () => setPhase("done"));
    if (sideways) return;
    setLit(true);
    setGulp(true);
    later(anticipation, () => setGulp(false));
    later(anticipation + travel * 0.8, () => setLit(false));
  };

  const toRest = () => {
    clearTimers();
    run.current.on = false;
    run.current.landed = false;
    api.current?.reset();
    setSent(false);
    setPhase("rest");
    setLit(false);
    setGulp(false);
    setResets((n) => n + 1);
    if (playingRef.current) later(0.9, send);
  };

  const onFinish = (revealed: boolean) => {
    if (!revealed) return;
    run.current.landed = true;
    later(resetAfter, toRest);
  };

  /* The button starts the wave, and once it has landed takes the demo back. */
  const press = () => {
    if (!run.current.on) send();
    else if (run.current.landed) toRest();
  };

  useEffect(() => {
    born.current = performance.now();
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Straight after mounting, the element gets a moment to picture itself.
    if (playing && !run.current.on) later(performance.now() - born.current < 400 ? 0.9 : 0, send);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const title = phase === "done" ? "Done" : "Confirm";
  const label = phase === "rest" ? "Send" : phase === "busy" ? "Processing..." : "Done";

  const action = center ? (
    <div className="dw-button-wrap dw-desk-action">
      <button ref={button} type="button" className={`dw-button dw-desk-send${phase === "busy" ? " is-busy" : ""}`} onClick={press}>
        <Swap key={resets} text={label}>
          {(shown) =>
            shown === "Processing..." ? (
              <>
                <Spinner />
                {shown}
              </>
            ) : (
              shown
            )
          }
        </Swap>
      </button>
    </div>
  ) : (
    <div className={`dw-button-wrap dw-desk-action${gulp ? " is-gulp" : ""}`} style={{ ["--dw-gulp" as string]: `${times.current.anticipation}s` }}>
      {/* The beam on the light button and its glow on the dark card, as on
          the phone, while the wave is out. The press scales this wrapper, so
          the beam stays on the button's edge. */}
      <BorderBeam size="pulse-outside" colorVariant="colorful" theme="dark" active={lit} borderRadius={29} style={{ width: "100%", height: "100%" }}>
        <BorderBeam size="md" colorVariant="colorful" theme="light" duration={1.6} active={lit} borderRadius={29} style={{ width: "100%", height: "100%" }}>
          <button ref={button} type="button" className="dw-button" onClick={press}>
            <span key={`${title}${title === "Confirm" ? resets : ""}`} className={`dw-button-title${title === "Done" ? " is-swapped" : ""}`}>
              {title}
            </span>
          </button>
        </BorderBeam>
      </BorderBeam>
    </div>
  );
  /* The handle on the card's left edge, where the sideways wave starts. */
  const handle = sideways ? (
    <button ref={edge} type="button" className={`dw-edge dw-desk-edge${sent ? " is-lit" : ""}`} aria-label="Send from the edge" onClick={press} />
  ) : null;

  return (
    <DistortionWave
      ref={api}
      className="dw-desk"
      data-type={type}
      type={type}
      revealed={sent}
      source={center ? token : sideways ? edge : button}
      waveStyle={waveStyle}
      palette={palette}
      onFinish={onFinish}
      revealedContent={center ? <Sheet done onClose={toRest} /> : <Transfer done />}
      overlay={
        <>
          {action}
          {handle}
        </>
      }
    >
      {center ? <Sheet status={phase === "rest" ? "Sent" : "Sending..."} statusKey={resets} tokenRef={token} onClose={toRest} /> : <Transfer />}
    </DistortionWave>
  );
}

/* ── The transfer: review on the left, its details on the right ── */

function Transfer({ done }: { done?: boolean }) {
  return (
    <div className="dw-view dw-transfer">
      <span className="dw-round dw-round--back" aria-hidden="true">
        <Glyph d="M24 14L17 21L24 28" />
      </span>
      <div className="dw-hero">
        <span className="dw-face">{done ? <Check size={62} /> : <img className="dw-avatar" src="/assets/avatars/maya-chen.jpg" alt="" width={76} height={76} />}</span>
        {done ? (
          <>
            <span className="dw-sum dw-sum--first">$1,250.00</span>
            <span className="dw-sum dw-sum--faint">sent to Maya Chen</span>
          </>
        ) : (
          <>
            <span className="dw-to">
              Sending to <span className="dw-name">Maya Chen</span>
            </span>
            <span className="dw-amount">$1,250.00</span>
          </>
        )}
      </div>
      <Details rows={TRANSFER_ROWS} />
    </div>
  );
}

/* ── The USDC sheet ── */

function Sheet({
  done,
  status = "Sent",
  statusKey,
  tokenRef,
  onClose,
}: {
  done?: boolean;
  status?: string;
  statusKey?: number;
  tokenRef?: RefObject<HTMLSpanElement>;
  onClose: () => void;
}) {
  return (
    <div className="dw-view dw-sheet">
      <button type="button" className="dw-round dw-round--close" aria-label="Close" onClick={onClose}>
        <Glyph d="M16 16L26 26M26 16L16 26" />
      </button>
      <span className="dw-token" ref={tokenRef}>
        {done ? <Check size={52} /> : <Coin />}
      </span>
      <span className="dw-status">{done ? "Sent" : <Swap key={statusKey} text={status} />}</span>
      <span className="dw-usdc">11.054 USDC</span>
      <span className="dw-date">Oct 3, 2026 at 8:55 AM</span>
      <Details rows={SHEET_ROWS} />
    </div>
  );
}

/* ── Parts ── */

function Details({ rows }: { rows: Row[] }) {
  return (
    <div className="dw-details">
      {rows.map(([label, value, accessory]) => (
        <div className="dw-row" key={label}>
          <span className="dw-label">{label}</span>
          <span className="dw-value">{value}</span>
          {accessory === "copy" ? <CopyIcon /> : accessory === "disclosure" ? <Disclosure /> : null}
        </div>
      ))}
    </div>
  );
}

/** The glyph of a round button, in its 42 box. */
function Glyph({ d }: { d: string }) {
  return (
    <svg width="42" height="42" viewBox="0 0 42 42" fill="none" aria-hidden="true">
      <path d={d} stroke="#EBEBEB" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#8F8F8F" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <rect x="5.5" y="5.5" width="8" height="8" rx="2" />
      <path d="M10.4 3.1C10 2.7 9.4 2.5 8.7 2.5H4.5C3.4 2.5 2.5 3.4 2.5 4.5V8.7C2.5 9.3 2.7 9.8 3.1 10.2" />
    </svg>
  );
}

function Disclosure() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="10" fill="#FFFFFF" fillOpacity="0.14" />
      <path d="M6.5 9L10 12.5L13.5 9" stroke="#EBEBEB" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The green disc and its check: 62 for the transfer, 52 for the token. */
function Check({ size }: { size: 62 | 52 }) {
  const big = size === 62;
  return (
    <span className="dw-check" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true">
        <polyline
          points={big ? "19.8,31 27.2667,39 42.2,23" : "18,26 23.3333,32 34,20"}
          stroke="#FFFFFF"
          strokeWidth={big ? 4 : 3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function Coin() {
  return (
    <svg className="dw-coin" width="64" height="64" viewBox="0 0 64 64" fill="none" aria-hidden="true">
      <circle cx="32" cy="32" r="32" fill="#2775CA" />
      <path d={COIN_ARCS} stroke="#FFFFFF" strokeWidth="3.52" strokeLinecap="round" />
      <path d={COIN_DOLLAR} stroke="#FFFFFF" strokeWidth="3.52" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Spinner() {
  return (
    <svg className="dw-spinner" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="9" stroke="#BFBFBF" strokeWidth="2" />
      <path d="M10 1A9 9 0 0 1 18.56 12.78" stroke="#000000" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** transitions.dev's text swap: the old text leaves up, blurring as it
    fades, then the new one comes up from below. */
export function Swap({ text, children }: { text: string; children?: (shown: string) => ReactNode }) {
  const [shown, setShown] = useState(text);
  const [stage, setStage] = useState<"idle" | "out" | "in">("idle");
  useEffect(() => {
    if (text === shown) return;
    setStage("out");
    const id = window.setTimeout(() => {
      setShown(text);
      setStage("in");
    }, 150);
    return () => clearTimeout(id);
  }, [text, shown]);
  return <span className={`dw-text${stage === "idle" ? "" : ` is-${stage}`}`}>{children ? children(shown) : shown}</span>;
}
