import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { flushSync } from "react-dom";
import { BorderBeam } from "border-beam";
import { bezierEase, defaultStyle, DistortionWave, type DistortionWaveHandle, type Rect, type WaveStyle, type WaveStyleInput } from "distortion-waves";
import { Spinner, Swap } from "./Desktop";
import { NO_TWEAK, tuned, WaveControls, type Tweak, type Which } from "./WaveControls";
import "./components.css";

/* The wave components page (wave-components.html): four components from the
   Portfolio file in Figma (frame 2125:5368), each inside its own
   <DistortionWave>.

   - Send money: the wave of the send money demo, from the Confirm button.
   - Add credits: the USDC prototype's ring, from the token, after a moment
     of processing.
   - Toast: a second of sending, then the same green ring from the token.
   - Document card: a moment of rewriting, then a grey ring from the card's
     top left corner, with no anticipation.

   The views follow the house rule of anything the wave pictures: no
   pseudo-elements, no backdrop filters, an opaque fill. What has to keep
   moving or stay pressable while the wave is out (the buttons, the toast's
   spinner) sits in the overlay, above the wave, and so does the card's
   hairline, on the edge the wave lights. The badge that turns into the check
   is drawn on a live canvas in each view instead, which the wave reads every
   frame, so the front bends it as it does the rest of the view. */

const A = "/assets/wave-components/";

const VERTICAL = defaultStyle("vertical");
const CENTER = defaultStyle("center");

/** Seconds the modals stay on their done view before going back. */
const RESET_AFTER = 2;
/** Seconds of "Processing..." before the credits ring. */
const PROCESSING = 1.2;
/** Seconds the toast's spinner turns before the transfer lands. */
const SENDING = 1;
/** Seconds the toast stays on "Sent" before the next round. */
const TOAST_HOLD = 1;
/** Seconds of "Rewriting..." before the document's wave. */
const REWRITING = 1;
/** Seconds from the ring's start to the token turning into the check: just
    after the ring has left it, as in the USDC prototype. */
const morphAfter = (s: WaveStyle) => s.anticipation + s.travel * 0.03;

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Timeouts in seconds, all dropped when the component goes. */
function useTimers() {
  const ids = useRef<number[]>([]);
  const timers = useRef({
    later(seconds: number, fn: () => void) {
      ids.current.push(window.setTimeout(fn, seconds * 1000));
    },
    clear() {
      ids.current.forEach((id) => clearTimeout(id));
      ids.current = [];
    },
  }).current;
  useEffect(() => timers.clear, [timers]);
  return timers;
}

export function WaveComponents() {
  const [which, setWhich] = useState<Which>("toast");
  const [tweaks, setTweaks] = useState<Record<Which, Tweak>>({ send: NO_TWEAK, credits: NO_TWEAK, toast: NO_TWEAK, doc: NO_TWEAK });
  const onTweak = (w: Which, t: Tweak) => setTweaks((all) => ({ ...all, [w]: t }));
  return (
    <main className="wc-page">
      <SendMoney tweak={tweaks.send} />
      <AddCredits tweak={tweaks.credits} />
      <Toast tweak={tweaks.toast} />
      <DocumentCard tweak={tweaks.doc} />
      <WaveControls which={which} onWhich={setWhich} bases={BASES} tweaks={tweaks} onTweak={onTweak} />
    </main>
  );
}

/** One of the components on its own, for the detail page's playground, where
    each stands for a type: Send money vertical, Add credits center, Toast
    horizontal (its wave crosses it from the token) and Document diagonal (a
    ring from its top left corner). `playing` runs it round by itself, `lean`
    turns the vertical wave's lean toward the press on or off. */
export function WaveVariant({ which, playing, lean }: { which: Which; playing: boolean; lean: boolean }) {
  return (
    <div className="wc-stage">
      {which === "send" ? (
        <SendMoney play={playing} lean={lean} />
      ) : which === "credits" ? (
        <AddCredits play={playing} />
      ) : which === "toast" ? (
        <Toast play={playing} sideways />
      ) : (
        <DocumentCard play={playing} />
      )}
    </div>
  );
}

/* ── Send money: the review modal ─────────────────────────────── */

const REVIEW_ROWS: [string, string][] = [
  ["From", "Everyday ·· 4821"],
  ["Arrives", "In seconds"],
  ["Fee", "Free"],
  ["Note", "Studio rent"],
];

/** The time of day, as the sent review shows when the money arrived. */
const clockTime = (at: Date) => at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** How a component runs: tuned from the panel, playing by itself (the
    detail page's Play), and for the vertical wave, whether it leans toward
    the press. */
type RunProps = { tweak?: Tweak; play?: boolean; lean?: boolean };

/** Keeps `play` readable from timers set before it changed. */
function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

function SendMoney({ tweak = NO_TWEAK, play = false, lean }: RunProps) {
  const [sent, setSent] = useState(false);
  // When it was sent, for the sent review's "Arrived" row.
  const [sentAt, setSentAt] = useState(() => clockTime(new Date()));
  const [done, setDone] = useState(false);
  const [lit, setLit] = useState(false);
  const [gulp, setGulp] = useState(false);
  const [resets, setResets] = useState(0);
  const api = useRef<DistortionWaveHandle>(null);
  const button = useRef<HTMLButtonElement>(null);
  const run = useRef({ on: false, landed: false });
  const { later, clear } = useTimers();
  const tunedSend = tuned(BASES.send, tweak);
  const { style } = tunedSend;
  const input = lean === undefined ? tunedSend.input : { ...tunedSend.input, orientation: lean ? VERTICAL.orientation : 0 };
  const { anticipation, travel } = style;
  const playing = useLatest(play);

  const send = () => {
    const r = run.current;
    if (r.on) return;
    r.on = true;
    r.landed = false;
    clear();
    setSentAt(clockTime(new Date()));
    setSent(true);
    if (still()) {
      later(0.15, () => setDone(true));
      return;
    }
    // The button stays pressed through the anticipation and wears its beam
    // while the wave is out; its title changes as the front leaves it.
    later(anticipation + travel * 0.18, () => setDone(true));
    setLit(true);
    setGulp(true);
    later(anticipation, () => setGulp(false));
    later(anticipation + travel * 0.8, () => setLit(false));
  };

  const toRest = () => {
    clear();
    run.current.on = false;
    run.current.landed = false;
    api.current?.reset();
    setSent(false);
    setDone(false);
    setLit(false);
    setGulp(false);
    setResets((n) => n + 1);
    if (playing.current) later(0.9, send);
  };

  useEffect(() => {
    if (play && !run.current.on) later(0.9, send);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const onFinish = (revealed: boolean) => {
    if (!revealed) return;
    run.current.landed = true;
    later(RESET_AFTER, toRest);
  };

  /* The button starts the wave, and once it has landed takes the modal back. */
  const press = () => {
    if (!run.current.on) send();
    else if (run.current.landed) toRest();
  };

  const title = done ? "Done" : "Confirm";

  return (
    <DistortionWave
      ref={api}
      className="wc-card"
      type="vertical"
      waveStyle={input}
      revealed={sent}
      source={button}
      onFinish={onFinish}
      revealedContent={<Review done arrived={sentAt} badge={done} />}
      overlay={
        <>
          <Hairline />
          <div className={`wc-action${gulp ? " is-gulp" : ""}`} style={{ ["--wc-gulp" as string]: `${anticipation}s` }}>
            {/* The beam on the light button and its glow on the dark card. The
                press scales this wrapper, so the beam stays on the button's edge. */}
            <BorderBeam size="pulse-outside" colorVariant="colorful" theme="dark" active={lit} borderRadius={24} style={{ width: "100%", height: "100%" }}>
              <BorderBeam size="md" colorVariant="colorful" theme="light" duration={1.6} active={lit} borderRadius={24} style={{ width: "100%", height: "100%" }}>
                <button ref={button} type="button" className="wc-cta" onClick={press}>
                  <span key={`${title}${title === "Confirm" ? resets : ""}`} className={`dw-button-title${title === "Done" ? " is-swapped" : ""}`}>
                    {title}
                  </span>
                </button>
              </BorderBeam>
            </BorderBeam>
          </div>
        </>
      }
    >
      <Review badge={done} />
    </DistortionWave>
  );
}

/** The review, sending or sent; sent, it says when the money arrived.
    `badge` turns the avatar into the check: as in the app, it does as the
    button's title does, with the front 18% of its way up. */
function Review({ done, arrived, badge }: { done?: boolean; arrived?: string; badge: boolean }) {
  const rows: [string, string][] = done && arrived ? REVIEW_ROWS.map(([label, value]) => (label === "Arrives" ? ["Arrived", arrived] : [label, value])) : REVIEW_ROWS;
  return (
    <div className="wc-view wc-view--send">
      <div className="wc-review-head">
        <BadgeSlot kind="send" size={48} done={badge} />
        <div className="wc-amount">
          <span className="wc-recipient">
            <span>{done ? "Sent to" : "Sending to"}</span>
            <span className="wc-name">Maya Chen</span>
          </span>
          <span className="wc-sum">$1,250.00</span>
        </div>
      </div>
      <div className="wc-body">
        <div className="wc-box">
          {rows.map(([label, value], i) => (
            <div key={i}>
              {i > 0 ? <span className="wc-divider" /> : null}
              <div className="wc-row">
                <span className="wc-label">{label}</span>
                <span className="wc-value">{value}</span>
              </div>
            </div>
          ))}
        </div>
        <span className="wc-cta-space" />
      </div>
    </div>
  );
}

/* ── Add credits: the USDC prototype's ring ───────────────────── */

const FEATURES = ["Balance goes to $85.73 right away", "Use credits for document rewrites", "Credits never expire"];

type Phase = "rest" | "busy" | "done";

function AddCredits({ tweak = NO_TWEAK, play = false }: RunProps) {
  const [sent, setSent] = useState(false);
  const [phase, setPhase] = useState<Phase>("rest");
  const [resets, setResets] = useState(0);
  const api = useRef<DistortionWaveHandle>(null);
  const token = useRef<HTMLSpanElement>(null);
  const run = useRef({ on: false, landed: false });
  const { later, clear } = useTimers();
  const { input, style } = tuned(BASES.credits, tweak);
  const playing = useLatest(play);

  const buy = () => {
    const r = run.current;
    if (r.on) return;
    r.on = true;
    r.landed = false;
    clear();
    const quiet = still();
    // A moment of processing, then the ring leaves the token, and just after
    // it has, the token turns into the check and the button says so.
    setPhase("busy");
    if (!quiet) later(Math.min(0.45, PROCESSING * 0.5), () => void api.current?.prepare());
    later(PROCESSING, () => {
      setSent(true);
      later(quiet ? 0.15 : morphAfter(style), () => setPhase("done"));
    });
  };

  const toRest = () => {
    clear();
    run.current.on = false;
    run.current.landed = false;
    api.current?.reset();
    setSent(false);
    setPhase("rest");
    setResets((n) => n + 1);
    if (playing.current) later(0.9, buy);
  };

  useEffect(() => {
    if (play && !run.current.on) later(0.9, buy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const onFinish = (revealed: boolean) => {
    if (!revealed) return;
    run.current.landed = true;
    later(RESET_AFTER, toRest);
  };

  const press = () => {
    if (!run.current.on) buy();
    else if (run.current.landed) toRest();
  };

  const label = phase === "rest" ? "Buy $20 tokens" : phase === "busy" ? "Processing..." : "Done";
  // The token dips while the ring gathers, and turns into the check after.
  const badge = { done: phase === "done", dip: sent && phase !== "done" };

  return (
    <DistortionWave
      ref={api}
      className="wc-card"
      type="center"
      waveStyle={input}
      revealed={sent}
      source={token}
      onFinish={onFinish}
      revealedContent={<Credits done badge={badge} />}
      overlay={
        <>
          <Hairline />
          <div className="wc-action">
            <button type="button" className={`wc-cta${phase === "busy" ? " is-busy" : ""}`} onClick={press}>
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
        </>
      }
    >
      <Credits badge={badge} tokenRef={token} />
    </DistortionWave>
  );
}

function Credits({ done, badge, tokenRef }: { done?: boolean; badge: { done: boolean; dip: boolean }; tokenRef?: RefObject<HTMLSpanElement> }) {
  return (
    <div className="wc-view wc-view--credits">
      <div className="wc-credits-head">
        <div className="wc-credits-title">
          <BadgeSlot kind="credits" size={46} {...badge} slotRef={tokenRef} />
          <span className="wc-title">{done ? "Credits added" : "Add credits"}</span>
        </div>
        <span className="wc-subtitle">Current balance: {done ? "$85.73" : "$65.73"}</span>
      </div>
      <div className="wc-body">
        <div className="wc-box">
          {FEATURES.map((text) => (
            <div key={text}>
              <div className="wc-feature">
                <img src={`${A}check.svg`} width={20} height={20} alt="" />
                <span className="wc-feature-text">{text}</span>
              </div>
              <span className="wc-divider" />
            </div>
          ))}
        </div>
        <span className="wc-cta-space" />
      </div>
    </div>
  );
}

/* ── Toast: sending, then sent ────────────────────────────────── */

/** The toast's wave crossing it from the token, left to right: the detail
    page's horizontal type. */
const SIDEWAYS_TOAST = defaultStyle("horizontal");

function Toast({ tweak = NO_TWEAK, play = true, sideways = false }: RunProps & { sideways?: boolean }) {
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);
  const api = useRef<DistortionWaveHandle>(null);
  const token = useRef<HTMLSpanElement>(null);
  const run = useRef({ on: false });
  const { later, clear } = useTimers();
  const { input, style } = tuned(sideways ? SIDEWAYS_TOAST : BASES.toast, tweak);
  const playing = useLatest(play);
  // Read by the timers, so a change in the panel reaches the next round.
  const morph = useRef(morphAfter(style));
  morph.current = morphAfter(style);

  /* It runs by itself: the spinner turns for a second, the ring leaves
     the token, and after a hold on "Sent" the toast starts over. */
  const start = () => {
    const r = run.current;
    if (r.on) return;
    r.on = true;
    clear();
    const quiet = still();
    // Pictured shortly before the ring, so it starts with its lens.
    if (!quiet) later(SENDING - 0.6, () => void api.current?.prepare());
    later(SENDING, () => {
      setSent(true);
      later(quiet ? 0.15 : morph.current, () => setDone(true));
    });
  };

  const again = () => {
    clear();
    run.current.on = false;
    api.current?.reset();
    setSent(false);
    setDone(false);
    if (playing.current) start();
  };

  const onFinish = (revealed: boolean) => {
    if (revealed) later(TOAST_HOLD, again);
  };

  // The token dips while the ring gathers, and turns into the check after.
  const dip = sent && !done;

  useEffect(() => () => {
    clear();
    run.current.on = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (play && !run.current.on) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  return (
    <DistortionWave
      ref={api}
      className="wc-toast"
      role="status"
      type={sideways ? "horizontal" : "center"}
      palette={sideways ? "green" : undefined}
      waveStyle={input}
      revealed={sent}
      source={token}
      onFinish={onFinish}
      revealedContent={
        <div className="wc-toast-view">
          <BadgeSlot kind="toast" size={40} done={done} dip={dip} />
          <div className="wc-toast-copy">
            <span className="wc-toast-title">Sent 11.054 USDC</span>
            <span className="wc-toast-meta">To HTjz…sUjs</span>
          </div>
          <button type="button" className="wc-view-button">
            View
          </button>
        </div>
      }
      overlay={
        <>
          <Hairline />
          <span className={`wc-toast-progress${sent ? " is-done" : ""}`} aria-hidden="true">
            <img className="dw-spinner" src={`${A}spinner.svg`} width={20} height={20} alt="" />
          </span>
        </>
      }
    >
      <div className="wc-toast-view">
        <BadgeSlot kind="toast" size={40} done={done} dip={dip} slotRef={token} />
        <div className="wc-toast-copy">
          <span className="wc-toast-title">Sending 11.054 USDC</span>
          <span className="wc-toast-meta">To HTjz…sUjs</span>
        </div>
        <span className="wc-toast-slot" />
      </div>
    </DistortionWave>
  );
}

/* ── Document card: a grey ring from the corner ───────────────── */

interface Doc {
  heading: string;
  body: [string, string];
}

const FIGURES = "Stablecoin volume grew 38% this quarter, driven by faster settlement on Solana and two new payout partners. Average fees fell to $0.002 per transfer.";

/* The draft as in the design, and its rewrite. Each press of Rewrite carries
   the card to the other one. */
const DOCS: Doc[] = [
  { heading: "Q3 at a glance", body: [FIGURES, `${FIGURES}...`] },
  {
    heading: "A strong third quarter",
    body: [
      "Transfers settled faster and cost less this quarter. Stablecoin volume rose 38% as Solana settlement sped up and two payout partners went live.",
      "The average fee is now $0.002 per transfer, and most payments arrive in seconds. Three more payout corridors open next quarter...",
    ],
  },
];

/* The wave leaves the card's top left corner at once: no gathering before
   it, no pull on the page. Its colour, on the front and along the edges, is
   at half the ring's own strength. */
const CORNER: Rect = { x: -1, y: -1, w: 2, h: 2 };
const DOC_WAVE: WaveStyleInput = {
  anticipation: 0,
  pull: 0,
  inhale: 0,
  gatherGlow: 0,
  gatherDots: 0,
  // As tuned in the panel (2026-11-17): the center ring at 0.8× speed, its
  // colour at half strength. The particles' life is slowed with the rest.
  travel: 4.287,
  strength: 0.3,
  rimStrength: 0.3,
  hairlineOpacity: 0.9,
  linger: -0.437,
  rimFade: 3.137,
  hairlineLinger: 1.2,
  hairlineFade: 3.75,
  particleLife: CENTER.particleLife / 0.8,
};

/** The toast's ring, as tuned in the panel (2026-11-17): the center ring at
    0.6× speed, its front colour fainter. */
const TOAST_WAVE: WaveStyleInput = {
  anticipation: 0.417,
  travel: 5.717,
  easeX1: 0.22,
  easeY1: 1,
  easeX2: 0.36,
  easeY2: 1,
  strength: 0.38,
  rimStrength: 0.6,
  hairlineOpacity: 0.9,
  linger: -0.583,
  rimFade: 4.183,
  hairlineLinger: 0.97,
  hairlineFade: 2.44,
  launchGap: 0,
  particleLife: 6.55,
};

/** Each component's wave before the panel's changes. */
const BASES: Record<Which, WaveStyle> = {
  send: VERTICAL,
  credits: CENTER,
  toast: { ...CENTER, ...(TOAST_WAVE as Partial<WaveStyle>) },
  doc: { ...CENTER, ...(DOC_WAVE as Partial<WaveStyle>) },
};

function DocumentCard({ tweak = NO_TWEAK, play = false }: RunProps) {
  const [version, setVersion] = useState(0);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const api = useRef<DistortionWaveHandle>(null);
  const run = useRef({ on: false });
  const { later, clear } = useTimers();
  const { input } = tuned(BASES.doc, tweak);
  const playing = useLatest(play);

  const rewrite = () => {
    if (run.current.on) return;
    run.current.on = true;
    clear();
    setBusy(true);
    // The card was pictured with the last text: picture it again in time.
    if (!still()) later(0.45, () => void api.current?.prepare());
    later(REWRITING, () => {
      setBusy(false);
      setSent(true);
    });
  };

  /* Once the wave has landed the rewrite becomes the card's own text and the
     wave goes back to rest, ready for the next one. Done in one go, so no
     frame shows the old text: the wave first, since a change of `revealed`
     while it still rests on the rewrite would run it backwards. */
  const settle = () => {
    api.current?.reset();
    flushSync(() => {
      setVersion((v) => v + 1);
      setSent(false);
    });
    run.current.on = false;
    if (playing.current) later(RESET_AFTER, rewrite);
  };

  useEffect(() => {
    if (play && !run.current.on) later(0.9, rewrite);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);

  const onFinish = (revealed: boolean) => {
    // Out of the wave's own callback, where React may be mid-commit.
    if (revealed) later(0, settle);
  };

  return (
    <DistortionWave
      ref={api}
      className="wc-card"
      type="center"
      palette="mono"
      waveStyle={input}
      revealed={sent}
      source={CORNER}
      onFinish={onFinish}
      revealedContent={<Document doc={DOCS[(version + 1) % DOCS.length]} />}
      overlay={
        <>
          <Hairline />
          <div className="wc-action">
            <button type="button" className={`wc-cta${busy ? " is-busy" : ""}`} onClick={rewrite}>
              <Swap text={busy ? "Rewriting..." : "Rewrite"}>
                {(shown) =>
                  shown === "Rewrite" ? (
                    <>
                      <img src={`${A}sparkles.svg`} width={20} height={20} alt="" />
                      {shown}
                    </>
                  ) : (
                    <>
                      <Spinner />
                      {shown}
                    </>
                  )
                }
              </Swap>
            </button>
          </div>
        </>
      }
    >
      <Document doc={DOCS[version % DOCS.length]} />
    </DistortionWave>
  );
}

function Document({ doc }: { doc: Doc }) {
  return (
    <div className="wc-view wc-view--doc">
      <div className="wc-doc-head">
        <span className="wc-doc-icon">
          <img src={`${A}page-text.svg`} width={24} height={24} alt="" />
        </span>
        <div className="wc-doc-titles">
          <span className="wc-doc-name">Investor update</span>
          <span className="wc-doc-meta">Draft · Edited 2 min ago</span>
        </div>
      </div>
      <span className="wc-doc-heading">{doc.heading}</span>
      <div className="wc-doc-body">
        <p>{doc.body[0]}</p>
        <p>{doc.body[1]}</p>
      </div>
      <span className="wc-cta-space" />
    </div>
  );
}

/* ── Parts ────────────────────────────────────────────────────── */

/** The card's 1px stroke, on its outermost pixel: the wave's edge line
    lights up right under it. */
function Hairline() {
  return <span className="wc-hairline" aria-hidden="true" />;
}

/* ── The badge: an avatar or a token turning into the check ───── */

type BadgeKind = "send" | "credits" | "toast";

/** What a badge shows: its face and size, whether it has turned into the
    check, and whether it is dipping for the ring's anticipation. */
type BadgeState = { kind: BadgeKind; size: number; done: boolean; dip?: boolean };

/** Room the badge's canvas keeps around it for the hop, the pop and the blur. */
const BADGE_PAD = 8;

/* The curves of the app's CheckBadge (Demo/Sources/TransferScreen.swift). */
const FILL = bezierEase(0.34, 1.35, 0.64, 1);
const SETTLE = bezierEase(0.22, 1, 0.36, 1);
const LAND = bezierEase(0.14, 2.56, 0.94, 1);
const POP_BACK = bezierEase(0.34, 1.96, 0.94, 1);
const EASE_OUT = bezierEase(0, 0, 0.58, 1);
/** How far the badge squeezes while the ring gathers, and how: from the start
    of the anticipation, 0.4 s on a smooth ease-out, held until the check pops
    it back. */
const DIP = 0.9;
const DIP_IN = 0.4;
const DIP_EASE = bezierEase(0.33, 1, 0.68, 1);

const unit = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/** The badge's assets, loaded once and shared. */
const IMAGES = new Map<string, HTMLImageElement>();
function asset(name: string, onLoad: () => void): HTMLImageElement {
  let img = IMAGES.get(name);
  if (!img) {
    img = new Image();
    img.src = `${A}${name}`;
    IMAGES.set(name, img);
  }
  if (!img.complete) img.addEventListener("load", onLoad, { once: true });
  return img;
}
const ready = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

const FILTERS = typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;

/** The place a view keeps for the badge, with the badge drawn in it. */
function BadgeSlot({ slotRef, ...badge }: BadgeState & { slotRef?: RefObject<HTMLSpanElement> }) {
  return (
    <span className="wc-badge-slot" ref={slotRef} style={{ width: badge.size, height: badge.size }}>
      <LiveBadge {...badge} />
    </span>
  );
}

/** The avatar or the token, and the green check it turns into when `done`:
    the app's CheckBadge. The avatar fades out and the green disc in, the
    badge hops and lands, squeezes and pops, blurs across the change and comes
    back sharp, and the check draws itself in. With `dip` it squeezes to 90% for
    the ring's anticipation and comes back up with the pop.

    It is drawn on a canvas the wave reads every frame (data-dw-live), so the
    front bends and tints it while it morphs. Back at rest is at once, as the
    wave's reset is. */
function LiveBadge({ kind, size, done, dip = false }: BadgeState) {
  const ref = useRef<HTMLCanvasElement>(null);
  const clock = useRef({ doneAt: -1, dipAt: -1, level: 1 });

  // When each change happened; every frame works the badge out from these.
  useLayoutEffect(() => {
    const c = clock.current;
    const now = performance.now();
    c.level = c.dipAt >= 0 ? dipLevel(now - c.dipAt) : 1;
    c.doneAt = done ? now : -1;
  }, [done]);
  useLayoutEffect(() => {
    clock.current.dipAt = dip ? performance.now() : -1;
  }, [dip]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let frame = 0;
    let gone = false;
    const layer = document.createElement("canvas");
    const kick = () => {
      if (!frame && !gone) frame = requestAnimationFrame(paint);
    };
    const images = {
      avatar: asset("avatar.png", kick),
      credits: asset("token-usdc-credits.svg", kick),
      coins: asset("coins-stacked.svg", kick),
      toast: asset("token-usdc.svg", kick),
      glyph: asset("success-glyph.svg", kick),
    };
    const paint = () => {
      frame = 0;
      if (gone) return;
      const moving = drawBadge(canvas, layer, images, { kind, size, done, dip }, clock.current, performance.now());
      if (moving) frame = requestAnimationFrame(paint);
    };
    paint();
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
    };
  }, [kind, size, done, dip]);

  const full = size + BADGE_PAD * 2;
  return (
    <canvas
      ref={ref}
      className="wc-badge-canvas"
      data-dw-live=""
      aria-hidden="true"
      style={{ left: -BADGE_PAD, top: -BADGE_PAD, width: full, height: full }}
    />
  );
}

/** The dip's scale, `ms` after it began. */
const dipLevel = (ms: number) => 1 - (1 - DIP) * DIP_EASE(unit(ms / 1000 / DIP_IN));

type BadgeImages = Record<"avatar" | "credits" | "coins" | "toast" | "glyph", HTMLImageElement>;

/** Draws the badge as it is at `now`; true while it is still moving. */
function drawBadge(
  canvas: HTMLCanvasElement,
  layer: HTMLCanvasElement,
  img: BadgeImages,
  b: BadgeState,
  clock: { doneAt: number; dipAt: number; level: number },
  now: number,
): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const S = b.size;
  const full = S + BADGE_PAD * 2;
  const px = Math.round(full * dpr);
  for (const c of [canvas, layer]) {
    if (c.width !== px || c.height !== px) {
      c.width = px;
      c.height = px;
    }
  }
  const quiet = still();

  // Where the morph is.
  let rest = 1;
  let green = 0;
  let blur = 0;
  let hop = 0;
  let scale = 1;
  let wipe = 0.17;
  let moving = false;
  if (b.done && clock.doneAt >= 0) {
    const t = (now - clock.doneAt) / 1000;
    if (quiet) {
      rest = 0;
      green = 1;
      wipe = 0.85;
    } else {
      const cross = (1.5 * S) / 62;
      const rise = (6 * S) / 62;
      rest = 1 - EASE_OUT(unit(t / 0.245));
      green = Math.min(1, FILL(unit(t / 0.35)));
      blur = t < 0.1575 ? cross * FILL(t / 0.1575) : t < 0.4075 ? cross * (1 - SETTLE((t - 0.1575) / 0.25)) : 0;
      hop = t < 0.25 ? -rise * FILL(t / 0.25) : t < 0.55 ? -rise * (1 - LAND((t - 0.25) / 0.3)) : 0;
      scale = t < 0.15 ? 1 - 0.1 * SETTLE(t / 0.15) : t < 0.5 ? 0.9 + 0.1 * POP_BACK((t - 0.15) / 0.35) : 1;
      // Back up from the dip while it squeezes, so the two meet.
      scale *= clock.level + (1 - clock.level) * SETTLE(unit(t / 0.15));
      wipe = 0.17 + 0.68 * SETTLE(unit((t - 0.23) / 0.6));
      moving = t < 0.85;
    }
  } else if (b.dip && clock.dipAt >= 0 && !quiet) {
    const ms = now - clock.dipAt;
    scale = dipLevel(ms);
    moving = ms < DIP_IN * 1000;
  }

  // The faces on a layer, so the blur softens the badge as one surface.
  const x = layer.getContext("2d");
  const out = canvas.getContext("2d");
  if (!x || !out) return false;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.clearRect(0, 0, px, px);
  x.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (full / 2), dpr * (full / 2 + hop));
  x.translate(-S / 2, -S / 2);
  if (rest > 0.001) {
    x.globalAlpha = rest;
    face(x, b.kind, S, dpr, img);
  }
  if (green > 0.001) {
    x.globalAlpha = green;
    success(x, S, wipe, img.glyph);
  }
  x.globalAlpha = 1;

  out.setTransform(1, 0, 0, 1, 0, 0);
  out.clearRect(0, 0, px, px);
  if (blur > 0.01 && FILTERS) out.filter = `blur(${blur * dpr}px)`;
  out.drawImage(layer, 0, 0);
  out.filter = "none";
  return moving;
}

/** The avatar or the token, in a `size` box at the origin. */
function face(x: CanvasRenderingContext2D, kind: BadgeKind, S: number, dpr: number, img: BadgeImages) {
  const r = S / 2;
  if (kind === "send") {
    x.save();
    circle(x, r, r, r);
    x.clip();
    if (ready(img.avatar)) x.drawImage(img.avatar, 0, 0, S, S);
    x.restore();
    // Its 1px inner ring.
    circle(x, r, r, r - 0.5);
    x.lineWidth = 1;
    x.strokeStyle = "rgba(255, 255, 255, 0.16)";
    x.stroke();
    return;
  }
  // The token's box shadows, then the token.
  if (kind === "credits") {
    outerShadow(x, S, dpr, 1, 0.5, "rgba(0, 0, 0, 0.24)");
  } else {
    outerShadow(x, S, dpr, 1.25, 0.625, "rgba(0, 0, 0, 0.04)");
    outerShadow(x, S, dpr, 1.25, 1.875, "rgba(0, 0, 0, 0.04)");
  }
  const token = kind === "credits" ? img.credits : img.toast;
  if (ready(token)) x.drawImage(token, 0, 0, S, S);
  if (kind === "credits") {
    if (ready(img.coins)) x.drawImage(img.coins, r - 12, r - 12, 24, 24);
    topLight(x, S, 0.06);
  }
}

/** A disc's box-shadow: drawn outside the disc only, as CSS draws it. Shadow
    lengths are in device pixels, whatever the transform. */
function outerShadow(x: CanvasRenderingContext2D, S: number, dpr: number, y: number, blur: number, color: string) {
  const r = S / 2;
  x.save();
  x.beginPath();
  x.rect(-S, -S, S * 3, S * 3);
  x.arc(r, r, r, 0, Math.PI * 2, true);
  x.clip("evenodd");
  x.shadowColor = color;
  x.shadowOffsetY = y * dpr;
  x.shadowBlur = blur * dpr;
  circle(x, r, r, r);
  x.fillStyle = "#000";
  x.fill();
  x.restore();
}

/** The green disc and its check, drawn in up to `wipe` of the glyph's box. */
function success(x: CanvasRenderingContext2D, S: number, wipe: number, glyph: HTMLImageElement) {
  const r = S / 2;
  circle(x, r, r, r);
  x.fillStyle = "#35ba00";
  x.fill();
  topLight(x, S, 0.3);
  if (!ready(glyph)) return;
  const g = S / 2;
  x.save();
  x.beginPath();
  x.rect(S / 4, S / 4, g * wipe, g);
  x.clip();
  x.drawImage(glyph, S / 4, S / 4, g, g);
  x.restore();
}

/** A disc's inset 0 1px 0 highlight: a 1px crescent along its top. */
function topLight(x: CanvasRenderingContext2D, S: number, alpha: number) {
  const r = S / 2;
  x.save();
  circle(x, r, r, r);
  x.clip();
  x.beginPath();
  x.arc(r, r, r, 0, Math.PI * 2);
  x.arc(r, r + 1, r, 0, Math.PI * 2, true);
  x.fillStyle = `rgba(255, 255, 255, ${alpha})`;
  x.fill("evenodd");
  x.restore();
}

function circle(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.beginPath();
  x.arc(cx, cy, r, 0, Math.PI * 2);
}
