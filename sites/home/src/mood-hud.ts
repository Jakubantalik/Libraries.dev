/* The Adaptive UI lab's cursor HUD (frustration-ui, lab/hud.ts), for the
   page's simulated showcase. Everything sits on the pointer: faint corner
   brackets that tighten as the score rises, two scan boxes gliding round
   them (faster and closer as frustration rises), a dust of small boxes left
   behind as it moves, each tied back to the brackets while it lasts, and a
   short leader to an uppercase readout with the reading and score, the
   pointer's position and the four mood values. Over the alert line the
   readout names the element being fought with. The presses the model is
   looking at stay as small squares, red-dotted when they hit a disabled
   control or nothing; each new press sends a wave of tiny squares out and
   kicks the brackets.

   The lab's HUD follows the real pointer over the whole window; this one
   draws inside the showcase's stage, in stage coordinates, at the
   showcase's own clock, so pausing holds it. It is always on a dark screen,
   so it always wears the lab's dark styling. */

import "./mood-hud.css";

const WINDOW_MS = 8000;
export type HudMood = "lost" | "confused" | "away" | "frustrated";
const COLORS: Record<HudMood, string> = { lost: "#7b4fd6", confused: "#ec8420", away: "#7b818c", frustrated: "#c8212b" };
/** The four moods, then the instant signals. */
const LETTERS = ["L", "C", "A", "F", "I"];
const SVG = "http://www.w3.org/2000/svg";
const SCANS = 2;
const WAVE_MS = 560;
const WAVE_MAX = 6;
const POP_MS = 260;
const KICK_MS = 220;
const DUST_STEP_PX = 40;
const DUST_STEP_HOT_PX = 22;
const DUST_MAX = 12;
const DUST_LIFE_MS: [number, number] = [450, 800];
const DUST_OPACITY = 0.78;
const DUST_JUMP_PX = 240;
const TIE_FADE_PX: [number, number] = [90, 200];

type Box = { x: number; y: number; w: number; h: number };

export type HudReading = {
  score: number;
  /** "neutral" or a mood. */
  name: string;
  lead: HudMood | null;
  /** Lost, confused, away and frustrated. */
  probs: readonly number[];
  alert: boolean;
  /** The fast signals' score, 0..1. */
  instant: number;
};

/** A press the model is looking at, in stage coordinates at the showcase's clock. */
export type HudPress = { x: number; y: number; t: number; disabled: boolean };

export type HudFrame = {
  /** The showcase's clock, ms; it stands still while paused. */
  t: number;
  x: number;
  y: number;
  visible: boolean;
  reading: HudReading;
  presses: readonly HudPress[];
  /** What is being fought with, named once over the alert line. */
  target: string | null;
  /** Reduced motion: no scan boxes, dust or waves. */
  still: boolean;
  /** Put the readout under the pointer rather than over it, clear of what is above. */
  below?: boolean;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const r1 = (v: number) => Math.round(v * 10) / 10;
const fmt = (v: number) => v.toFixed(3).replace(/^0/, "");
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** 1€ filter (Casiez, Roussel and Vogel, 2012): steady when slow, next to no lag when fast. */
class OneEuro {
  private x: number | null = null;
  private dx = 0;
  constructor(private minCutoff: number, private beta: number, private dCutoff = 1) {}
  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  reset(): void {
    this.x = null;
    this.dx = 0;
  }
  filter(value: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      if (this.x === null) this.x = value;
      return this.x;
    }
    const dx = (value - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }
}

/** 1 px ink over a halo, so lines read on light and dark surfaces alike. */
function layer(parent: SVGElement, cls: string): { halo: SVGPathElement; ink: SVGPathElement } {
  const g = document.createElementNS(SVG, "g");
  g.setAttribute("class", cls);
  const halo = document.createElementNS(SVG, "path");
  halo.setAttribute("class", "hud-halo");
  const ink = document.createElementNS(SVG, "path");
  ink.setAttribute("class", "hud-ink");
  g.append(halo, ink);
  parent.append(g);
  return { halo, ink };
}

function setD(l: { halo: SVGPathElement; ink: SVGPathElement }, d: string): void {
  l.halo.setAttribute("d", d);
  l.ink.setAttribute("d", d);
}

/** Four L-shaped corners around a box. */
function brackets(b: Box, arm: number): string {
  const { x, y, w, h } = b;
  const a = Math.min(arm, w / 2, h / 2);
  return (
    `M${r1(x)} ${r1(y + a)}V${r1(y)}H${r1(x + a)}` +
    `M${r1(x + w - a)} ${r1(y)}H${r1(x + w)}V${r1(y + a)}` +
    `M${r1(x + w)} ${r1(y + h - a)}V${r1(y + h)}H${r1(x + w - a)}` +
    `M${r1(x + a)} ${r1(y + h)}H${r1(x)}V${r1(y + h - a)}`
  );
}

const rect = (b: Box) => `M${r1(b.x)} ${r1(b.y)}h${r1(b.w)}v${r1(b.h)}h${r1(-b.w)}Z`;

type Spot = { a: number; gap: number; w: number; h: number };
type Scan = { from: Spot; to: Spot; turn: number; t0: number; dur: number; next: number };
type Mote = { x: number; y: number; w: number; h: number; vx: number; vy: number; born: number; life: number };
type Grain = { a: number; from: number; to: number; delay: number; size: number; bend: number };

/** The point at angle `a` (radians) on a square of half-side `r` around the origin. */
function onSquare(a: number, r: number): { x: number; y: number } {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const m = Math.max(Math.abs(c), Math.abs(s));
  return { x: (c / m) * r, y: (s / m) * r };
}

/** How far a box sits outside a square of half-side `r` centred on (cx, cy); below 0 it overlaps. */
function clearance(b: Box, cx: number, cy: number, r: number): number {
  return Math.max(Math.abs(b.x + b.w / 2 - cx) - b.w / 2, Math.abs(b.y + b.h / 2 - cy) - b.h / 2) - r;
}

export function createHud(container: HTMLElement, size: () => { w: number; h: number }) {
  const root = document.createElement("div");
  root.className = "hud mood-hud is-dark is-away";
  root.setAttribute("aria-hidden", "true");

  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "hud-svg");
  const trail = layer(svg, "hud-trail");
  const trailRed = document.createElementNS(SVG, "path");
  trailRed.setAttribute("class", "hud-red-dots");
  svg.append(trailRed);
  const waveEls = Array.from({ length: WAVE_MAX }, () => {
    const l = layer(svg, "hud-wave");
    const g = l.ink.parentNode as SVGGElement;
    g.style.display = "none";
    return { g, ...l };
  });
  const dustLayer = document.createElementNS(SVG, "g");
  dustLayer.setAttribute("class", "hud-dust");
  const dustEls = Array.from({ length: DUST_MAX }, () => {
    const g = document.createElementNS(SVG, "g");
    const tie = layer(g, "hud-tie");
    const halo = document.createElementNS(SVG, "rect");
    halo.setAttribute("class", "hud-halo");
    const ink = document.createElementNS(SVG, "rect");
    ink.setAttribute("class", "hud-ink");
    g.append(halo, ink);
    g.style.display = "none";
    dustLayer.append(g);
    return { g, rects: [halo, ink], tie, tieG: tie.ink.parentNode as SVGGElement };
  });
  svg.append(dustLayer);
  const scanLayer = layer(svg, "hud-scan");
  const scanDots = document.createElementNS(SVG, "path");
  scanDots.setAttribute("class", "hud-scan-dots");
  svg.append(scanDots);
  const reticle = layer(svg, "hud-reticle");
  const leader = layer(svg, "hud-leader");

  const label = document.createElement("div");
  label.className = "hud-label";
  label.innerHTML = `
    <div class="hud-l1"><i class="hud-mark"></i><span class="hud-name"></span></div>
    <div class="hud-l2 hud-pos"></div>
    <div class="hud-vals">${LETTERS.map((c) => `<span><b>${c}</b><em>.00</em></span>`).join("")}</div>
    <div class="hud-l2 hud-at" hidden></div>`;
  const nameEl = label.querySelector<HTMLElement>(".hud-name")!;
  const posEl = label.querySelector<HTMLElement>(".hud-pos")!;
  const atEl = label.querySelector<HTMLElement>(".hud-at")!;
  const vals = Array.from(label.querySelectorAll<HTMLElement>(".hud-vals em"));

  root.append(svg, label);
  container.append(root);

  let last = -1;
  let fx = 0;
  let fy = 0;
  const euroX = new OneEuro(3, 0.02);
  const euroY = new OneEuro(3, 0.02);
  let seen = false;
  let right = true;
  let up = true;
  let wasAlert = false;
  const scans: Scan[] = [];
  const motes: (Mote | null)[] = Array.from({ length: DUST_MAX }, () => null);
  let dustX = 0;
  let dustY = 0;
  let dustTravel = 0;
  const waves: { x: number; y: number; born: number; grains: Grain[] }[] = [];
  let lastPressT = -Infinity;
  let lastWaveAt = -Infinity;

  const readoutQuarter = () => (right ? (up ? -90 : 0) : up ? 180 : 90);

  function pickScan(heat: number): Spot {
    const a = (readoutQuarter() + 90 + rand(0, 270) + 360) % 360;
    const w = rand(4, 10) * (1 - 0.2 * heat);
    const h = Math.random() < 0.5 ? w : rand(4, 10) * (1 - 0.2 * heat);
    return { a, gap: rand(3, 12) * (1 - 0.35 * heat), w, h };
  }

  function turnBetween(from: number, to: number): number {
    let turn = ((to - from + 540) % 360) - 180;
    const mid = (((readoutQuarter() + 45 - from) % 360) + 360) % 360;
    if (turn > 0 && mid < turn) turn -= 360;
    else if (turn < 0 && mid > 0 && 360 - mid < -turn) turn += 360;
    return turn;
  }

  function stepScans(t: number, heat: number, r: number): void {
    while (scans.length < SCANS) {
      const spot = { a: rand(0, 360), gap: 0, w: 0, h: 0 };
      scans.push({ from: spot, to: spot, turn: 0, t0: t, dur: 1, next: t + scans.length * 120 });
    }
    let d = "";
    let dots = "";
    for (let i = 0; i < SCANS; i++) {
      const s = scans[i];
      const k = easeInOut(Math.min(1, (t - s.t0) / s.dur));
      const cur: Spot = {
        a: (s.from.a + s.turn * k + 360) % 360,
        gap: s.from.gap + (s.to.gap - s.from.gap) * k,
        w: s.from.w + (s.to.w - s.from.w) * k,
        h: s.from.h + (s.to.h - s.from.h) * k,
      };
      if (t >= s.next) {
        s.from = cur;
        s.to = pickScan(heat);
        s.turn = turnBetween(s.from.a, s.to.a);
        s.t0 = t;
        s.dur = rand(260, 380) * (1 - 0.45 * heat);
        s.next = t + s.dur + rand(260, 700) * (1 - 0.65 * heat);
      }
      if (cur.w < 0.5) continue;
      const c = onSquare((cur.a * Math.PI) / 180, r + cur.gap + Math.max(cur.w, cur.h) / 2);
      const box = { x: fx + c.x - cur.w / 2, y: fy + c.y - cur.h / 2, w: cur.w, h: cur.h };
      d += rect(box);
      if (i === 0) dots += `M${r1(box.x + box.w / 2 - 0.75)} ${r1(box.y + box.h / 2 - 0.75)}h1.5v1.5h-1.5Z`;
    }
    setD(scanLayer, d);
    scanDots.setAttribute("d", dots);
  }

  function spawnMote(x: number, y: number, t: number, heat: number, rb: Box, back: number): void {
    const slot = motes.indexOf(null);
    if (slot < 0) return;
    const w = rand(3, 8) * (1 - 0.2 * heat);
    const h = Math.random() < 0.5 ? w : rand(3, 8) * (1 - 0.2 * heat);
    const cx = rb.x + rb.w / 2;
    const cy = rb.y + rb.h / 2;
    let mx = x + rand(-7, 7);
    let my = y + rand(-7, 7);
    const gap = rand(3, 9);
    if (clearance({ x: mx - w / 2, y: my - h / 2, w, h }, cx, cy, rb.w / 2) < gap) {
      const c = onSquare(back + rand(-0.6, 0.6), rb.w / 2 + gap + Math.max(w, h) / 2);
      mx = cx + c.x;
      my = cy + c.y;
    }
    const a = Math.atan2(my - cy, mx - cx) + rand(-0.8, 0.8);
    const drift = rand(6, 18);
    motes[slot] = { x: mx, y: my, w, h, vx: Math.cos(a) * drift, vy: Math.sin(a) * drift, born: t, life: rand(DUST_LIFE_MS[0], DUST_LIFE_MS[1]) };
  }

  function stepDust(t: number, heat: number, moving: boolean, rb: Box): void {
    const dx = fx - dustX;
    const dy = fy - dustY;
    const seg = Math.hypot(dx, dy);
    if (!moving || seg > DUST_JUMP_PX) {
      dustTravel = 0;
    } else if (seg > 0) {
      const step = DUST_STEP_PX + (DUST_STEP_HOT_PX - DUST_STEP_PX) * heat;
      const back = Math.atan2(-dy, -dx);
      let along = step - dustTravel;
      for (; along <= seg; along += step) spawnMote(dustX + (dx * along) / seg, dustY + (dy * along) / seg, t, heat, rb, back);
      dustTravel = seg - (along - step);
    }
    dustX = fx;
    dustY = fy;

    for (let i = 0; i < DUST_MAX; i++) {
      const m = motes[i];
      const el = dustEls[i];
      const k = m ? (t - m.born) / m.life : 1;
      if (!m || k >= 1) {
        motes[i] = null;
        el.g.style.display = "none";
        continue;
      }
      const s = 1 - 0.4 * k;
      const go = (m.life / 1000) * (k - (k * k) / 2);
      const w = m.w * s;
      const h = m.h * s;
      const x = r1(m.x + m.vx * go - w / 2);
      const y = r1(m.y + m.vy * go - h / 2);
      for (const r of el.rects) {
        r.setAttribute("x", String(x));
        r.setAttribute("y", String(y));
        r.setAttribute("width", String(r1(w)));
        r.setAttribute("height", String(r1(h)));
      }
      const under = Math.min(1, Math.max(0, clearance({ x, y, w, h }, rb.x + rb.w / 2, rb.y + rb.h / 2, rb.w / 2) / 4));
      if (under <= 0) {
        el.g.style.display = "none";
        continue;
      }
      el.g.style.opacity = (DUST_OPACITY * Math.pow(1 - k, 1.5) * under).toFixed(3);
      el.g.style.display = "";

      const cx = rb.x + rb.w / 2;
      const cy = rb.y + rb.h / 2;
      const vx = x + w / 2 - cx;
      const vy = y + h / 2 - cy;
      const edge = (hw: number, hh: number) => Math.min(vx ? hw / Math.abs(vx) : Infinity, vy ? hh / Math.abs(vy) : Infinity);
      const from = edge(rb.w / 2, rb.h / 2);
      const to = 1 - edge(w / 2, h / 2);
      const len = (to - from) * Math.hypot(vx, vy);
      const fade = 1 - Math.min(1, Math.max(0, (len - TIE_FADE_PX[0]) / (TIE_FADE_PX[1] - TIE_FADE_PX[0])));
      if (len < 2 || fade <= 0) {
        setD(el.tie, "");
        continue;
      }
      setD(el.tie, `M${r1(cx + vx * from)} ${r1(cy + vy * from)}L${r1(cx + vx * to)} ${r1(cy + vy * to)}`);
      el.tieG.style.opacity = fade.toFixed(3);
    }
  }

  function clearDust(): void {
    motes.fill(null);
    for (const el of dustEls) el.g.style.display = "none";
    dustTravel = 0;
  }

  function makeGrains(): Grain[] {
    const grains: Grain[] = [];
    const ring = (n: number, from: number, to: number, delay: number, sz: number) => {
      const spin = rand(0, Math.PI * 2);
      for (let k = 0; k < n; k++) {
        if (Math.random() < 0.12) continue;
        grains.push({
          a: spin + ((k + rand(-0.35, 0.35)) / n) * Math.PI * 2,
          from: from * rand(0.7, 1.2),
          to: to * rand(0.65, 1.3),
          delay: delay + rand(0, 70),
          size: sz * rand(0.6, 1.35),
          bend: rand(-0.35, 0.35),
        });
      }
    };
    ring(Math.round(rand(11, 14)), 6, 30, 0, 3);
    ring(Math.round(rand(7, 10)), 3, 16, 60, 2.5);
    return grains;
  }

  function catchPresses(t: number, presses: readonly HudPress[]): void {
    let newest = lastPressT;
    for (const p of presses) {
      if (p.t <= lastPressT || p.t > t) continue;
      if (p.t > newest) newest = p.t;
      waves.push({ x: p.x, y: p.y, born: t, grains: makeGrains() });
      if (waves.length > WAVE_MAX) waves.shift();
      lastWaveAt = t;
    }
    lastPressT = newest;
  }

  function drawWaves(t: number): void {
    while (waves.length && t - waves[0].born >= WAVE_MS) waves.shift();
    for (let w = 0; w < WAVE_MAX; w++) {
      const el = waveEls[w];
      const wave = waves[w];
      if (!wave) {
        el.g.style.display = "none";
        continue;
      }
      const age = t - wave.born;
      let d = "";
      for (const g of wave.grains) {
        const q = (age - g.delay) / (WAVE_MS - g.delay);
        if (q <= 0 || q >= 1) continue;
        const e = 1 - Math.pow(1 - q, 3);
        const r = g.from + (g.to - g.from) * e;
        const a = g.a + g.bend * e;
        const s = g.size * (1 - 0.6 * q);
        d += `M${r1(wave.x + Math.cos(a) * r - s / 2)} ${r1(wave.y + Math.sin(a) * r - s / 2)}h${r1(s)}v${r1(s)}h${r1(-s)}Z`;
      }
      setD(el, d);
      el.g.style.opacity = Math.pow(1 - age / WAVE_MS, 1.3).toFixed(3);
      el.g.style.display = "";
    }
  }

  function clearWaves(): void {
    waves.length = 0;
    for (const el of waveEls) el.g.style.display = "none";
  }

  function drawTrail(t: number, presses: readonly HudPress[], still: boolean): void {
    let d = "";
    let red = "";
    for (const e of presses) {
      const age = t - e.t;
      if (age < 0 || age > WINDOW_MS) continue;
      // A new press's square pops: 14 px, settling to 7.
      const s = still || age >= POP_MS ? 7 : 7 + 7 * Math.pow(1 - age / POP_MS, 3);
      d += `M${r1(e.x - s / 2)} ${r1(e.y - s / 2)}h${r1(s)}v${r1(s)}h${r1(-s)}Z`;
      if (e.disabled) red += `M${r1(e.x - 1)} ${r1(e.y - 1)}h2v2h-2Z`;
    }
    setD(trail, d);
    trailRed.setAttribute("d", red);
  }

  function restart(el: HTMLElement, cls: string): void {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  return {
    /** Draws one frame. */
    frame(f: HudFrame): void {
      const { t, reading, still } = f;
      const dt = last < 0 ? 1 / 60 : Math.min(0.05, Math.max(0, (t - last) / 1000));
      last = t;
      if (!f.visible) {
        seen = false;
      } else if (!seen) {
        euroX.reset();
        euroY.reset();
        dustX = f.x;
        dustY = f.y;
        seen = true;
      }
      catchPresses(t, f.presses);
      fx = still ? f.x : euroX.filter(f.x, dt);
      fy = still ? f.y : euroY.filter(f.y, dt);
      root.classList.toggle("is-away", !f.visible);

      const heat = Math.min(1, reading.score / 0.65);
      root.style.setProperty("--hud-accent", reading.lead ? COLORS[reading.lead] : "var(--hud-ink)");

      const kickAge = t - lastWaveAt;
      const kick = still || kickAge >= KICK_MS ? 0 : 5 * Math.pow(1 - kickAge / KICK_MS, 2);
      const open = 35.75 - 4 * heat;
      const sz = open - kick;
      const rb = { x: fx - sz / 2, y: fy - sz / 2, w: sz, h: sz };
      setD(reticle, brackets(rb, 6.5));

      const { w: W, h: H } = size();
      // The readout goes right of the pointer while it fits, and flips left
      // only when it doesn't and the left has room, with a margin, so it
      // never flaps.
      // When neither side fits, it takes the side with more room.
      const lw = label.offsetWidth;
      const roomR = W - 8 - (fx + 16);
      const roomL = fx - 16 - 8;
      if (right && roomR < lw && roomL > roomR + 20) right = false;
      else if (!right && (roomR > lw + 40 || (roomL < lw && roomR > roomL + 20))) right = true;
      if (f.below !== undefined) up = !f.below;
      else if (up && fy < 70) up = false;
      else if (!up && fy > 110) up = true;
      const cx = right ? rb.x + rb.w : rb.x;
      const cy = up ? rb.y : rb.y + rb.h;
      const ex = cx + (right ? 9 : -9);
      const ey = cy + (up ? -9 : 9);
      setD(leader, `M${r1(cx)} ${r1(cy)}L${r1(ex)} ${r1(ey)}H${r1(ex + (right ? 5 : -5))}`);
      label.style.transform =
        `translate3d(${r1(ex + (right ? 7 : -7))}px, ${r1(ey + (up ? 5 : -5))}px, 0) ` +
        `translate(${right ? "0" : "-100%"}, ${up ? "-100%" : "0"})`;

      nameEl.textContent = `${reading.name.toUpperCase()}-${reading.score.toFixed(2)}`;
      posEl.textContent = `X${fmt(Math.min(0.999, Math.max(0, f.x / W)))} Y${fmt(Math.min(0.999, Math.max(0, f.y / H)))}`;
      label.classList.toggle("is-alert", reading.alert);
      label.classList.toggle("is-mood", reading.lead !== null);
      if (reading.alert && !wasAlert && !still) restart(label, "is-glitch");
      wasAlert = reading.alert;
      for (let i = 0; i < vals.length; i++) {
        const p = i < LETTERS.length - 1 ? reading.probs[i] ?? 0 : reading.instant;
        vals[i].textContent = p.toFixed(2).replace(/^0/, "");
        vals[i].classList.toggle("is-hot", p >= 0.3);
      }
      if (reading.alert && f.target) {
        atEl.textContent = `▸ ${f.target}`;
        atEl.hidden = false;
      } else if (reading.score < 0.5) {
        atEl.hidden = true;
      }

      if (still) {
        setD(scanLayer, "");
        scanDots.setAttribute("d", "");
        clearDust();
        clearWaves();
      } else {
        stepScans(t, heat, open / 2);
        stepDust(t, heat, f.visible, rb);
        drawWaves(t);
      }
      drawTrail(t, f.presses, still);
    },
    destroy(): void {
      root.remove();
    },
  };
}
