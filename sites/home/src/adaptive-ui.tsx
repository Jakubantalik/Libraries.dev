import { type CSSProperties, type RefObject, StrictMode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createHud, type HudMood, type HudReading } from "./adaptive-hud";
import "./voice-position.css";
import "./adaptive-ui.css";

/* Adaptive UI page — the showcase on the stage card: the lab's dark Pay
   screen (frustration-ui, lab/adaptive.ts, "Transaction") with the lab's
   cursor HUD (src/adaptive-hud.ts), driven by a simulated pointer instead
   of the visitor's. Someone circles the locked Pay, unsure: the HUD reads
   confused and the screen moves from state 1 (neutral) to state 2: the
   locked Pay steps back, so it stops looking like the next step. They press
   it again and again and shake the pointer: frustrated, state 3, and the
   terms line, the one thing that unlocks Pay, comes forward too. They tick
   it, the screen is back to state 1 at once, the reading eases back to
   neutral and they pay. It runs on its own and pauses off screen; with reduced motion it
   waits for Play. */

const LOOP = 15800;

// The stage is laid out at least this wide; narrower, it is scaled down.
const STAGE_W = 880;
const STAGE_H = 520;
// The dark screen, and the Pay form inside it, as the lab lays them out.
const SCREEN_W = 460;
const SCREEN_H = 300;
const FORM_W = 338;
const PAY_H = 48;
const FORM_GAP = 19;
const BOX = 18;
const FORM_H = PAY_H + FORM_GAP + BOX;

type UiState = 1 | 2 | 3;

/** What the reading says from `at` ms into the loop on, and the screen's state. */
interface Beat extends HudReading {
  at: number;
  ui: UiState;
}

// Lost, confused, away, frustrated: the HUD's L C A F. Confused comes from
// the pointer's movement alone, no press: the fast signals (I) see it
// circling one spot within a turn or two, and the screen moves to state 2. Presses on the locked Pay read frustrated at once, as the
// real rules do: one 0.6, a second within 1.5 s 0.9 (the confused reading
// holds a moment first), and the screen moves to state 3. The shake keeps
// them up while the model's own reading of frustrated builds. Once the terms
// are agreed nothing is locked any more: the screen is back to state 1 at
// once, and the reading eases back to neutral.
const B = (at: number, score: number, name: string, probs: number[], instant: number, ui: UiState): Beat => ({
  at,
  score,
  name,
  lead: name === "neutral" ? null : (name as HudMood),
  probs,
  instant,
  alert: score >= 0.65,
  ui,
});
const BEATS: Beat[] = [
  B(0, 0.03, "neutral", [0.01, 0.01, 0, 0.01], 0, 1),
  B(1500, 0.08, "neutral", [0.02, 0.05, 0, 0.01], 0, 1),
  B(2300, 0.42, "confused", [0.03, 0.12, 0, 0.01], 0.42, 1),
  B(2800, 0.7, "confused", [0.04, 0.28, 0, 0.02], 0.7, 2),
  B(3400, 0.78, "confused", [0.05, 0.41, 0, 0.02], 0.78, 2),
  // the pointer rests above Pay a moment, still unsure, then goes to it
  B(4200, 0.71, "confused", [0.05, 0.44, 0, 0.02], 0.4, 2),
  B(5500, 0.62, "confused", [0.05, 0.42, 0, 0.03], 0.12, 2),
  B(6000, 0.66, "confused", [0.05, 0.4, 0, 0.06], 0.6, 2),
  B(6350, 0.9, "frustrated", [0.05, 0.36, 0, 0.14], 0.9, 3),
  B(6950, 0.94, "frustrated", [0.04, 0.24, 0, 0.38], 0.94, 3),
  B(7500, 0.95, "frustrated", [0.04, 0.18, 0, 0.52], 0.95, 3),
  B(8300, 0.81, "frustrated", [0.05, 0.12, 0, 0.66], 0.54, 3),
  B(9000, 0.72, "frustrated", [0.06, 0.08, 0, 0.72], 0.18, 3),
  // the terms are agreed: nothing is locked any more, so the screen is
  // neutral at once, and the reading follows
  B(10100, 0.58, "frustrated", [0.05, 0.06, 0, 0.55], 0, 1),
  B(10600, 0.3, "frustrated", [0.04, 0.04, 0, 0.26], 0, 1),
  B(10900, 0.1, "neutral", [0.03, 0.03, 0, 0.07], 0, 1),
  B(11700, 0.04, "neutral", [0.02, 0.02, 0, 0.02], 0, 1),
];

const ORBIT = { from: 1600, to: 3800, turns: 2.1, radius: 30 };
const PRESSES = [6000, 6350, 6650, 7500];
const SHAKE = { from: 6950, to: 7950 };
const AGREE_AT = 10100;
const PAY_AT = 12500;
const RESET_AT = 15000;
/** What the HUD names over the alert line, as the lab's HUD names a button. */
const TARGET = "BUTTON-PAY-$97.54 · DISABLED";

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const beatAt = (t: number) => BEATS.reduce((b, n) => (n.at <= t ? n : b), BEATS[0]);

/** Where things sit on a stage `w` wide. */
function layout(w: number) {
  const screen = { x: Math.round((w - SCREEN_W) / 2), y: Math.round((STAGE_H - SCREEN_H) / 2 - 18) };
  const form = { x: screen.x + (SCREEN_W - FORM_W) / 2, y: screen.y + (SCREEN_H - FORM_H) / 2 + 8 };
  const pay = { x: form.x, y: form.y, w: FORM_W, h: PAY_H };
  const check = { x: form.x, y: form.y + PAY_H + FORM_GAP, w: BOX, h: BOX };
  return { screen, form, pay, check };
}

type Point = { x: number; y: number };

/** The pointer's way through the loop: [from ms, to ms, from, to]. */
function route(l: ReturnType<typeof layout>): [number, number, Point, Point][] {
  const out = { x: l.screen.x + SCREEN_W + 60, y: l.screen.y + SCREEN_H + 50 };
  // the hesitation happens above Pay, in the empty space, before it is ever pressed
  const round = { x: l.pay.x + l.pay.w / 2 + 40, y: l.pay.y - 52 };
  const onPay = { x: l.pay.x + l.pay.w / 2 + 22, y: l.pay.y + PAY_H / 2 + 4 };
  const onCheck = { x: l.check.x + BOX / 2 + 1, y: l.check.y + BOX / 2 + 2 };
  // near Pay's top edge, so the readout above the pointer clears the lit button
  const onPay2 = { x: l.pay.x + l.pay.w / 2 - 14, y: l.pay.y + 12 };
  return [
    [0, 500, out, out],
    [500, 1500, out, round],
    // circling, then a moment's stillness above Pay before going to it
    [1500, 4700, round, round],
    [4700, 5500, round, onPay],
    // a beat on Pay before the first press
    [5500, 8900, onPay, onPay],
    [8900, 9800, onPay, onCheck],
    [9800, 11400, onCheck, onCheck],
    [11400, 12200, onCheck, onPay2],
    [12200, 13800, onPay2, onPay2],
    [13800, 14800, onPay2, out],
    [14800, LOOP, out, out],
  ];
}

function pointerAt(path: ReturnType<typeof route>, t: number): Point {
  const seg = path.find(([a, b]) => t >= a && t < b) ?? path[path.length - 1];
  const [a, b, from, to] = seg;
  const k = ease(Math.min(1, Math.max(0, (t - a) / (b - a))));
  let x = from.x + (to.x - from.x) * k;
  let y = from.y + (to.y - from.y) * k;
  // the hesitation, from movement alone: no press, just the pointer
  // circling round the locked Pay, unevenly, slowing and speeding up,
  // drifting wider and closing in again
  if (t > ORBIT.from && t < ORBIT.to) {
    const s = (t - ORBIT.from) / (ORBIT.to - ORBIT.from);
    const r = ORBIT.radius * Math.sin(Math.PI * s);
    // speed that swells and slackens on the way round
    const a = Math.PI * 2 * ORBIT.turns * (s - 0.07 * Math.sin(Math.PI * 4 * s));
    x += Math.cos(a) * r + Math.sin(a * 2.3) * r * 0.22;
    y += Math.sin(a) * r * 0.72 + Math.cos(a * 1.7) * r * 0.16;
  }
  // the shake: quick swings back and forth, rising and falling away
  if (t > SHAKE.from && t < SHAKE.to) {
    const s = (t - SHAKE.from) / (SHAKE.to - SHAKE.from);
    x += Math.sin((t - SHAKE.from) / 27) * 18 * Math.sin(Math.PI * s);
  }
  return { x, y };
}

/** Every press in the loop: four on the locked Pay, the terms, then Pay. */
function pressesIn(path: ReturnType<typeof route>) {
  const all = [...PRESSES.map((at) => ({ at, disabled: true })), { at: AGREE_AT, disabled: false }, { at: PAY_AT, disabled: false }];
  return all.map((p, i) => {
    const q = pointerAt(path, p.at);
    return { ...p, x: q.x + ((i * 7) % 5) - 2, y: q.y + ((i * 11) % 7) - 3 };
  });
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

/** The discrete part of the run, which React renders; the pointer and the HUD move outside it. */
interface Frame {
  ui: UiState;
  agreed: boolean;
  paid: boolean;
  resetting: boolean;
}

function frameAt(t: number): Frame {
  return {
    ui: beatAt(t).ui,
    agreed: t >= AGREE_AT && t < RESET_AT,
    paid: t >= PAY_AT && t < RESET_AT,
    resetting: t >= RESET_AT - 400 && t < RESET_AT + 300,
  };
}

const sameFrame = (a: Frame, b: Frame) => a.ui === b.ui && a.agreed === b.agreed && a.paid === b.paid && a.resetting === b.resetting;

function AdaptiveDemo() {
  const box = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointer = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
  const { width, visible } = useFit(box);
  const still = paused || !visible;
  const [frame, setFrame] = useState<Frame>(() => frameAt(0));

  const w = Math.max(width, STAGE_W);
  const scale = Math.min(1, width / STAGE_W);
  const l = layout(w);
  const path = useRef(route(l));
  path.current = route(l);
  const where = useRef(l);
  where.current = l;
  const size = useRef({ w, h: STAGE_H });
  size.current = { w, h: STAGE_H };
  // The showcase's clock: it only runs while playing, so pausing holds
  // everything, the pointer and the HUD included.
  const clock = useRef(0);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const hud = createHud(el, () => size.current);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0;
    let last = performance.now();
    const draw = (now: number) => {
      if (!still) clock.current += now - last;
      last = now;
      const t = clock.current % LOOP;
      const loopStart = clock.current - t;
      const next = frameAt(t);
      setFrame((f) => (sameFrame(f, next) ? f : next));
      const p = pointerAt(path.current, t);
      const l2 = where.current;
      const gone = t < 300 || t > 14700;
      const arrow = pointer.current;
      if (arrow) {
        const pressed = [...PRESSES, AGREE_AT, PAY_AT].some((at) => t >= at - 60 && t < at + 90);
        arrow.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
        arrow.style.setProperty("--press", pressed ? "0.86" : "1");
        arrow.style.opacity = gone ? "0" : "1";
      }
      hud.frame({
        t: clock.current,
        x: p.x,
        y: p.y,
        visible: !gone,
        reading: beatAt(t),
        // this round's presses, until the screen starts over
        presses: t < RESET_AT ? pressesIn(path.current).filter((q) => q.at <= t).map((q) => ({ ...q, t: loopStart + q.at })) : [],
        // named once it has been pressed, as the lab's HUD names what was pressed
        target: t >= PRESSES[0] && !next.agreed ? TARGET : null,
        still: reduce.matches,
        // under the pointer while it is below Pay, so the readout never
        // sits on the button
        below: p.y > l2.pay.y + PAY_H + 4,
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      hud.destroy();
    };
  }, [still]);

  const locked = !frame.agreed;

  return (
    <div className="vp-fit au-fit" ref={box} data-paused-by-user={paused} style={{ height: STAGE_H * scale }}>
      <div
        className="vp-stage au-stage"
        ref={stage}
        data-paused={still}
        role="img"
        aria-label={`A dark checkout screen with a locked Pay button, and the model's cursor HUD on a simulated pointer. The pointer circles the locked Pay; the HUD reads confused and the screen moves to state 2: Pay steps back. Then it presses Pay again and again and shakes; the HUD reads frustrated and the screen moves to state 3: the terms that unlock Pay come forward too. Once the terms are agreed the screen returns to state 1 and the reading eases back to neutral. Now: state ${frame.ui}.`}
        style={{ width: w, height: STAGE_H, transform: scale < 1 ? `scale(${scale})` : undefined } as CSSProperties}
      >
        <div
          className="au-screen"
          data-state={frame.ui}
          data-resetting={frame.resetting}
          style={{ left: l.screen.x, top: l.screen.y, width: SCREEN_W, height: SCREEN_H }}
          aria-hidden="true"
        >
          <div className="au-pay" data-agreed={frame.agreed} style={{ left: l.form.x - l.screen.x, top: l.form.y - l.screen.y, width: FORM_W }}>
            <span className="au-btn" data-locked={locked} data-paid={frame.paid}>
              <span className="au-btn-label">Pay $97.54</span>
              <span className="au-btn-label au-btn-paid">
                <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.92 7.44 5.83 11.08 11.08 2.92" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                Paid
              </span>
            </span>
            <span className="au-terms">
              <span className="au-box">
                <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2.92 7.44 5.83 11.08 11.08 2.92" stroke="#2C2C2C" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </span>
              <span className="au-terms-text">I agree to the terms of sale and the return policy</span>
            </span>
          </div>
        </div>

        <div className="au-states" style={{ left: l.screen.x, top: l.screen.y + SCREEN_H + 18, width: SCREEN_W }} aria-hidden="true">
          <span className="au-states-key">UI STATE</span>
          <span className="au-state" data-on={frame.ui === 1}>
            <i>1</i>Neutral
          </span>
          <span className="au-state" data-on={frame.ui === 2}>
            <i>2</i>Confused
          </span>
          <span className="au-state" data-on={frame.ui === 3}>
            <i>3</i>Frustrated
          </span>
        </div>

        <div className="au-pointer" ref={pointer} aria-hidden="true">
          <svg className="au-arrow" width="18" height="22" viewBox="0 0 18 22" fill="none">
            <path d="M1.5 1.5v15.2l4.1-3.7 2.6 5.6 2.9-1.3-2.5-5.5h5.6L1.5 1.5Z" fill="#f8f8f8" stroke="#0d0d0d" strokeWidth="1.2" strokeLinejoin="round" />
          </svg>
        </div>
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

const rootEl = document.getElementById("adaptive-demo");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <AdaptiveDemo />
    </StrictMode>
  );
}
