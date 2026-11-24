/* Mood recognition's home card, with the real cursor HUD (src/mood-hud.ts)
   on a simulated pointer, sized for a card's 296 × 260 stage. The HUD alone
   on the dot field: a calm stroke, circling one spot (confused), a shake
   with presses on nothing (frustrated), then calm again.

   Mount with <div class="mood-thumb" data-mood-thumb="field">. It runs on its
   own clock, pauses off screen, and with reduced motion holds one telling
   frame. More scripts can sit beside FIELD in SCRIPTS. */

import { createHud, type HudMood, type HudReading } from "./mood-hud";
import "./mood-thumb.css";

const W = 296;
const H = 260;

type P = { x: number; y: number };
/** A stretch of the pointer's way: from `a` to `b`, optionally circling or shaking on the way. */
type Seg = { t0: number; t1: number; a: P; b: P; orbit?: { r: number; turns: number }; shake?: number };
type Beat = HudReading & { at: number; ui: string };
type Press = { at: number; x: number; y: number; disabled: boolean };
type Script = {
  loop: number;
  segs: Seg[];
  beats: Beat[];
  presses: Press[];
  /** What the HUD names over the alert line, from this time on. */
  target?: { from: number; until: number; name: string };
  /** Builds the card's own UI into the artboard, if it has any. */
  build(art: HTMLElement): void;
  /** Hidden before and after these times. */
  show: [number, number];
  /** Readout under the pointer while this holds. */
  below?: (p: P) => boolean;
  /** The time to hold with reduced motion. */
  still: number;
};

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const B = (at: number, score: number, name: string, probs: number[], instant: number, ui: string): Beat => ({
  at,
  score,
  name,
  lead: name === "neutral" ? null : (name as HudMood),
  probs,
  instant,
  alert: score >= 0.65,
  ui,
});

function pointerAt(segs: Seg[], t: number): P {
  const s = segs.find((g) => t >= g.t0 && t < g.t1) ?? segs[segs.length - 1];
  const k = ease(Math.min(1, Math.max(0, (t - s.t0) / (s.t1 - s.t0))));
  let x = s.a.x + (s.b.x - s.a.x) * k;
  let y = s.a.y + (s.b.y - s.a.y) * k;
  const u = (t - s.t0) / (s.t1 - s.t0);
  if (s.orbit && u > 0 && u < 1) {
    // uneven circling, widening and closing again
    const r = s.orbit.r * Math.sin(Math.PI * u);
    const a = Math.PI * 2 * s.orbit.turns * (u - 0.07 * Math.sin(Math.PI * 4 * u));
    x += Math.cos(a) * r + Math.sin(a * 2.3) * r * 0.22;
    y += Math.sin(a) * r * 0.72;
  }
  if (s.shake && u > 0 && u < 1) x += Math.sin((t - s.t0) / 27) * s.shake * Math.sin(Math.PI * u);
  return { x, y };
}

const beatAt = (beats: Beat[], t: number) => beats.reduce((b, n) => (n.at <= t ? n : b), beats[0]);

const el = (cls: string, parent: HTMLElement, text?: string) => {
  const e = document.createElement("div");
  e.className = cls;
  if (text) e.textContent = text;
  parent.append(e);
  return e;
};

// ---------------------------------------------------------------- field

const FIELD: Script = {
  loop: 10000,
  show: [350, 9300],
  still: 5000,
  build() {},
  segs: [
    { t0: 0, t1: 400, a: { x: 40, y: 220 }, b: { x: 40, y: 220 } },
    { t0: 400, t1: 1500, a: { x: 40, y: 220 }, b: { x: 96, y: 150 } },
    { t0: 1500, t1: 1900, a: { x: 96, y: 150 }, b: { x: 96, y: 150 } },
    { t0: 1900, t1: 3900, a: { x: 96, y: 150 }, b: { x: 96, y: 150 }, orbit: { r: 24, turns: 2 } },
    { t0: 3900, t1: 4400, a: { x: 96, y: 150 }, b: { x: 118, y: 168 } },
    { t0: 4400, t1: 5700, a: { x: 118, y: 168 }, b: { x: 118, y: 168 }, shake: 16 },
    { t0: 5700, t1: 8200, a: { x: 118, y: 168 }, b: { x: 118, y: 168 } },
    { t0: 8200, t1: 9200, a: { x: 118, y: 168 }, b: { x: 262, y: 232 } },
    { t0: 9200, t1: 10000, a: { x: 262, y: 232 }, b: { x: 262, y: 232 } },
  ],
  beats: [
    B(0, 0.03, "neutral", [0.01, 0.01, 0, 0.01], 0, ""),
    B(2600, 0.45, "confused", [0.03, 0.14, 0, 0.01], 0.45, ""),
    B(3100, 0.74, "confused", [0.04, 0.32, 0, 0.02], 0.74, ""),
    B(3900, 0.7, "confused", [0.04, 0.38, 0, 0.03], 0.4, ""),
    B(4700, 0.8, "frustrated", [0.04, 0.3, 0, 0.12], 0.8, ""),
    B(5100, 0.95, "frustrated", [0.03, 0.18, 0, 0.42], 0.95, ""),
    B(6200, 0.78, "frustrated", [0.04, 0.1, 0, 0.6], 0.4, ""),
    B(7000, 0.45, "frustrated", [0.03, 0.06, 0, 0.4], 0, ""),
    B(7600, 0.12, "neutral", [0.02, 0.03, 0, 0.08], 0, ""),
  ],
  // three quick presses on nothing: rage, each red-dotted
  presses: [
    { at: 4700, x: 120, y: 168, disabled: true },
    { at: 4950, x: 116, y: 170, disabled: true },
    { at: 5200, x: 119, y: 167, disabled: true },
  ],
};

const SCRIPTS: Record<string, Script> = { field: FIELD };

const ARROW =
  '<svg width="14" height="17" viewBox="0 0 18 22" fill="none"><path d="M1.5 1.5v15.2l4.1-3.7 2.6 5.6 2.9-1.3-2.5-5.5h5.6L1.5 1.5Z" fill="#f8f8f8" stroke="#0d0d0d" stroke-width="1.2" stroke-linejoin="round"/></svg>';

function mount(host: HTMLElement): void {
  const script = SCRIPTS[host.dataset.moodThumb ?? ""];
  if (!script) return;
  const art = el("mood-thumb-art", host);
  art.dataset.kind = host.dataset.moodThumb;
  script.build(art);
  const arrow = el("mood-thumb-arrow", art);
  arrow.innerHTML = ARROW;
  const hud = createHud(art, () => ({ w: W, h: H }));

  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(host);
  let clock = reduce.matches ? script.still : 0;
  let last = performance.now();
  let shownUi = "";

  const draw = (now: number) => {
    if (visible && !reduce.matches) clock += now - last;
    last = now;
    const t = clock % script.loop;
    const start = clock - t;
    const p = pointerAt(script.segs, t);
    const b = beatAt(script.beats, t);
    if (b.ui !== shownUi) {
      art.dataset.ui = b.ui;
      shownUi = b.ui;
    }
    const on = t >= script.show[0] && t < script.show[1];
    const pressed = script.presses.some((q) => t >= q.at - 60 && t < q.at + 90);
    arrow.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) scale(${pressed ? 0.86 : 1})`;
    arrow.style.opacity = on ? "1" : "0";
    hud.frame({
      t: clock,
      x: p.x,
      y: p.y,
      visible: on,
      reading: b,
      presses: script.presses.filter((q) => q.at <= t).map((q) => ({ ...q, t: start + q.at })),
      target: script.target && t >= script.target.from && t < script.target.until ? script.target.name : null,
      still: reduce.matches,
      below: script.below ? script.below(p) : undefined,
    });
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

document.querySelectorAll<HTMLElement>("[data-mood-thumb]").forEach(mount);
