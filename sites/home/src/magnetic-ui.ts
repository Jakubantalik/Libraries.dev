/* Magnetic UI page: with the Magnet Bridge app on an Android phone, a real
   magnet held beside the phone pulls the page's header toward it — the
   Magnetic UI physics on the site's own top bar and title. Nothing runs (and
   nothing connects) until the visitor asks for it: a page that opens a socket
   to the phone itself makes Chrome ask about local network access. */

import { MagnetBridge, fitCalibration, type CalibrationSpot, type MagnetFrame, type Pt } from "./magnet/bridge";
import { MagneticField, type Box } from "./magnet/field";

const card = document.getElementById("mui-live");
const statusEl = document.getElementById("mui-live-status");
const connectBtn = document.getElementById("mui-live-connect") as HTMLButtonElement | null;
const calibrateBtn = document.getElementById("mui-live-calibrate") as HTMLButtonElement | null;
const params = new URLSearchParams(location.search);
const debug = params.has("magnetdebug");
const android = /Android/i.test(navigator.userAgent);
// iPadOS reports a Mac: tell it apart by its touch screen.
const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const REMEMBER = "mui-bridge";

/* ?magnetdebug on the local phone server: send what happens to its log. */
const devLog = (o: unknown) => {
  if (!debug) return;
  fetch("/__mlog", { method: "POST", body: JSON.stringify({ src: "mui", ...(o as object) }), keepalive: true }).catch(() => {});
};

const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

// Desktop and Android see the card; iPhone and iPad cannot run the bridge.
// Only Android can connect: the bridge runs on the phone that holds the magnet.
const canConnect = android || params.has("magnet");
if (card && (!ios || params.has("magnet"))) card.hidden = false;
if (connectBtn && !canConnect) connectBtn.hidden = true;

const bridge = new MagnetBridge();
const field = new MagneticField();
field.screenCorner = 24;

// The header's bodies: the top bar's visible items and the page title block.
const SELECTORS = [
  ".site-nav .brand",
  ".site-nav .nav-pill",
  ".site-nav .nav-get-pro",
  "#gh-stars-btn",
  "#more-btn",
  "#nav-burger",
  ".detail-head .detail-icon",
  ".detail-head .detail-title",
  ".detail-head .detail-sub",
  ".detail-head .detail-tabs",
  ".detail-head .detail-prompt",
];
type Body = { id: string; el: HTMLElement; docBox: Box; corner: number; strip: boolean };
let bodies: Body[] = [];

/* The library chips: on a phone the sidebar is one sideways-scrolling strip,
   which clips anything that moves out of it. While the magnet acts, the strip
   is lifted (no clip, no fade) and each chip carries the scroll offset itself;
   once they have all settled it scrolls again, where it was. */
const strip = document.querySelector<HTMLElement>(".docs-sidebar");
const isStrip = () => !!strip && matchMedia("(max-width: 900px)").matches;
let lifted = false;
let stripScroll = 0;

function lift() {
  if (!strip || lifted) return;
  stripScroll = strip.scrollLeft;
  strip.style.overflow = "visible";
  strip.style.webkitMaskImage = "none";
  strip.style.maskImage = "none";
  // The unclipped strip is wider than the screen; keep the page from scrolling sideways.
  document.documentElement.style.overflowX = "clip";
  // Chips off screen are not bodies; they still need the scroll offset to stay put.
  const moved = new Set(bodies.filter((b) => b.strip).map((b) => b.el));
  strip.querySelectorAll<HTMLElement>(".docs-link").forEach((el) => {
    if (!moved.has(el)) el.style.transform = `translateX(${-stripScroll}px)`;
  });
  lifted = true;
}

function unlift() {
  if (!strip || !lifted) return;
  strip.querySelectorAll<HTMLElement>(".docs-link").forEach((el) => { el.style.transform = ""; });
  strip.style.overflow = "";
  strip.style.webkitMaskImage = "";
  strip.style.maskImage = "";
  strip.scrollLeft = stripScroll;
  document.documentElement.style.overflowX = "";
  lifted = false;
}

function measure() {
  unlift();
  for (const b of bodies) b.el.style.transform = "";
  const head = SELECTORS.flatMap((s) => [...document.querySelectorAll<HTMLElement>(s)]).map((el) => ({ el, strip: false }));
  // The chips in view, including one cut by the screen's edge (the physics lets
  // it rest where it lives, partly off screen).
  const chips = isStrip()
    ? [...strip!.querySelectorAll<HTMLElement>(".docs-link")]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.right > 8 && r.left < innerWidth - 8; })
        .map((el) => ({ el, strip: true }))
    : [];
  bodies = [...head, ...chips]
    .filter(({ el }) => el.offsetParent !== null && el.getBoundingClientRect().width > 0)
    .map(({ el, strip: inStrip }, i) => {
      if (getComputedStyle(el).display === "inline") el.style.display = "inline-block";
      const r = el.getBoundingClientRect();
      const corner = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 6;
      return { id: String(i), el, docBox: { left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY }, corner, strip: inStrip };
    });
  field.parts.clear();
}

const APP_URL = "/downloads/MagnetBridge.apk";

/** Status line; `{app}` in the text becomes the download link for the app. */
function setStatus(text: string) {
  if (!statusEl) return;
  statusEl.textContent = "";
  text.split("{app}").forEach((part, i) => {
    if (i > 0) {
      const a = document.createElement("a");
      a.className = "mui-live-link";
      a.href = APP_URL;
      a.setAttribute("download", "");
      a.textContent = "Magnet Bridge app";
      statusEl.append(a);
    }
    statusEl.append(part);
  });
}

function refreshStatus() {
  if (bridge.state === "connecting") setStatus("Connecting to Magnet Bridge…");
  else if (bridge.state === "failed") setStatus("Couldn't reach the bridge. Install the {app}, tap Start bridge, then try again.");
  else if (bridge.state === "open") {
    const h = bridge.hello;
    const learned = h && h.grabStage === 2;
    setStatus(
      reduced
        ? "Connected. Reduced motion is on, so the header stays put."
        : learned
          ? "Connected. Hold the magnet beside the phone, by an edge, and watch the header."
          : "Connected. Calibrate once so the page knows your magnet.",
    );
  }
  if (connectBtn) connectBtn.hidden = !canConnect || bridge.state === "open";
  if (calibrateBtn) calibrateBtn.hidden = bridge.state !== "open";
}
bridge.onState = refreshStatus;

async function connect() {
  const ok = await bridge.connect();
  if (ok) {
    store.set(REMEMBER, "1");
    bridge.send({ type: "hello" });
    measure();
    start();
  }
}
connectBtn?.addEventListener("click", connect);
if (card && !card.hidden && canConnect && store.get(REMEMBER) === "1") connect();

/* ── The header's physics ─────────────────────────────────────────── */

let running = false;
let dot: HTMLDivElement | null = null;
let lastLog = 0;

function viewportBox(): Box {
  const o = bridge.offset();
  return { left: o.x, top: o.y, right: o.x + innerWidth, bottom: o.y + innerHeight };
}

function start() {
  if (running || reduced) return;
  running = true;
  if (debug && !dot) {
    dot = document.createElement("div");
    dot.style.cssText = "position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px;border-radius:50%;background:#fff;box-shadow:0 0 0 5px rgba(80,160,255,.4);pointer-events:none;z-index:99;opacity:0";
    document.body.appendChild(dot);
  }
  const tick = () => {
    if (!running) return;
    const now = performance.now() / 1000;
    const f = bridge.frame;
    const o = bridge.offset();
    for (const b of bodies) {
      field.setHome(b.id, {
        left: b.docBox.left - scrollX + o.x,
        top: b.docBox.top - scrollY + o.y,
        right: b.docBox.right - scrollX + o.x,
        bottom: b.docBox.bottom - scrollY + o.y,
      }, b.corner);
    }
    if (f && !calibrating) field.step(f, now, viewportBox(), bridge.hello?.face ?? 1);
    if (debug && f && now - lastLog > 0.1) {
      lastLog = now;
      const moved = [...field.parts.values()].reduce((a, p) => Math.max(a, Math.hypot(p.ox, p.oy)), 0);
      devLog({ type: "frame", t: f.t, pos: f.pos, s: f.strength, p: f.presence, d: f.delta, h: f.height, overGlass: field.overGlass, magnet: field.magnet, moved: +moved.toFixed(1) });
    }
    else field.relax(now);
    const moving = bodies.some((b) => b.strip && !field.parts.get(b.id)?.resting);
    if (moving) lift();
    else if (lifted) unlift();
    for (const b of bodies) {
      const p = field.parts.get(b.id);
      if (!p) continue;
      // Lifted, a chip sits at its unscrolled place: carry the scroll offset back.
      const sx = b.strip && lifted ? -stripScroll : 0;
      b.el.style.transform = p.resting && !sx ? "" : `translate(${(p.ox + sx).toFixed(2)}px, ${p.oy.toFixed(2)}px) rotate(${p.angle.toFixed(4)}rad)`;
    }
    if (dot) {
      const pos = f?.pos;
      if (pos && f.presence > 0.5) {
        const c = bridge.toClient(pos);
        dot.style.opacity = "1";
        dot.style.transform = `translate(${Math.min(innerWidth - 11, Math.max(11, c.x))}px, ${Math.min(innerHeight - 11, Math.max(11, c.y))}px)`;
      } else dot.style.opacity = "0";
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

strip?.addEventListener("scroll", () => {
  if (!running || lifted) return;
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(measure, 150);
}, { passive: true });

let resizeTimer = 0;
addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => { if (running) measure(); }, 200);
});

/* ── Calibration: hold the magnet over five rings ─────────────────── */

let calibrating = false;
const SPOTS: Array<[number, number]> = [[0.5, 0.45], [0.5, 0.12], [0.5, 0.88], [0.15, 0.5], [0.85, 0.5]];

function calibrate() {
  if (calibrating || bridge.state !== "open") return;
  calibrating = true;
  const ov = document.createElement("div");
  ov.className = "mui-cal";
  ov.innerHTML = '<div class="mui-cal-ring"><i></i></div><p class="mui-cal-msg"></p><button type="button" class="mui-cal-cancel">Cancel</button>';
  document.body.appendChild(ov);
  const ring = ov.querySelector<HTMLElement>(".mui-cal-ring")!;
  const fill = ring.querySelector<HTMLElement>("i")!;
  const msg = ov.querySelector<HTMLElement>(".mui-cal-msg")!;
  const spots: CalibrationSpot[] = [];
  let i = 0;
  let hold: MagnetFrame[] = [];
  let zeroUntil = performance.now() + 1500;
  bridge.send({ type: "calibrate" });

  const place = () => {
    const [fx, fy] = SPOTS[i];
    ring.style.left = fx * innerWidth + "px";
    ring.style.top = fy * innerHeight + "px";
    msg.style.top = (fy < 0.5 ? fy * innerHeight + 64 : fy * innerHeight - 120) + "px";
    msg.textContent = `Ring ${i + 1} of ${SPOTS.length}: hold the magnet 1–2 cm above it and keep it still.`;
    fill.style.transform = "scale(0)";
    hold = [];
  };
  const finish = (text: string | null) => {
    bridge.onFrame = null;
    ov.remove();
    calibrating = false;
    if (text) setStatus(text);
  };
  ov.querySelector(".mui-cal-cancel")!.addEventListener("click", () => { finish(null); refreshStatus(); });
  msg.textContent = "Keep the magnet away for a moment…";
  ring.style.opacity = "0";

  bridge.onFrame = (f) => {
    if (performance.now() < zeroUntil || f.calibrating) return;
    if (ring.style.opacity === "0") { ring.style.opacity = "1"; place(); }
    if (f.strength < 15) { hold = []; fill.style.transform = "scale(0)"; return; }
    hold.push(f);
    hold = hold.filter((h) => h.t > f.t - 1200);
    const med = (j: number) => { const v = hold.map((h) => h.delta[j]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const m: [number, number, number] = [med(0), med(1), med(2)];
    const spread = Math.max(...hold.map((h) => Math.hypot(h.delta[0] - m[0], h.delta[1] - m[1], h.delta[2] - m[2])));
    if (spread > Math.max(4, 0.12 * f.strength)) { hold = [f]; fill.style.transform = "scale(0)"; return; }
    const progress = Math.min(1, (f.t - hold[0].t) / 1000);
    fill.style.transform = `scale(${progress.toFixed(3)})`;
    if (progress < 1) return;
    const [fx, fy] = SPOTS[i];
    spots.push({ screen: bridge.toScreen({ x: fx * innerWidth, y: fy * innerHeight }), delta: m });
    navigator.vibrate?.(40);
    i++;
    if (i < SPOTS.length) { place(); return; }
    const h = bridge.hello;
    const screenDp: Pt = h ? { x: h.screenDp[0], y: h.screenDp[1] } : { x: screen.width, y: screen.height };
    const fit = fitCalibration(spots, screenDp);
    if (!fit) return finish("Calibration didn't work. Try again, holding the magnet still over each ring.");
    bridge.send({ type: "set-magnet", face: fit.face, strength: fit.strength, sensor: [fit.sensor.x, fit.sensor.y] });
    store.set("mui-fit", JSON.stringify(fit));
    devLog({ type: "fit", fit, spots });
    const good = fit.error < 0.25;
    finish(
      good
        ? "Calibrated. Now hold the magnet beside the phone, by an edge, and watch the header."
        : "Calibrated, but loosely. For a better fit, run it again holding the magnet 1–2 cm above each ring.",
    );
  };
}
calibrateBtn?.addEventListener("click", calibrate);

bridge.onGesture = (g) => {
  if (debug) setStatus(`Gesture: ${g.g}`);
};

/* ── ?magnetsim: the mouse plays the magnet (desktop check of the physics).
   Press and hold to bring the magnet in; release to take it away. */
if (params.has("magnetsim")) {
  bridge.offset = () => ({ x: 0, y: 0 });
  let held = false;
  let at: Pt = { x: 0, y: 0 };
  const frame = (): MagnetFrame => ({
    t: performance.now(), pos: held ? at : null, spread: 20, height: null, presence: 1, pull: held ? 0.8 : 0,
    strength: held ? 80 : 0, delta: held ? [0, 0, -40] : [0, 0, 0], tooClose: false, calibrating: false,
  });
  addEventListener("pointerdown", (e) => { held = true; at = { x: e.clientX, y: e.clientY }; });
  addEventListener("pointermove", (e) => { at = { x: e.clientX, y: e.clientY }; });
  addEventListener("pointerup", () => { held = false; });
  setInterval(() => { bridge.frame = frame(); }, 20);
  measure();
  start();
}
