/* Distortion waves — the screens the web preview carries one into another,
   drawn with Canvas 2D at the canvas's backing resolution. As in the SwiftUI
   demo, each prototype is one screen that morphs in place while the wave
   passes over it (the wave's two sides show the same screen):

   - the Send money transfer (vertical and horizontal waves): the avatar pops
     into the success check, the amount shrinks into the line above "sent to
     Maya Chen";
   - the USDC sheet (center wave): Send swaps to a dimmed, spinning
     Processing…, then to Done, the status to Sending… and back to Sent, and
     the token pops into the green check, held still at the ring's centre.

   Every moving part is a pure function of how long ago its change happened,
   with the app's own clocks and curves (transitions-pro's spinner-check morph,
   transitions.dev's text swap). Lengths in points, times in seconds. */

import { bezierEase } from "./model";

const FONT = 'Inter, "SF Pro Text", -apple-system, system-ui, sans-serif';
const INK = {
  page: "#0D0D0D",
  sheet: "#161616",
  faint: "#8F8F8F",
  soft: "#D0D0D0",
  white: "#FFFFFF",
  card: "rgba(48,48,48,0.5)",
  hairline: "rgba(235,235,235,0.1)",
  divider: "rgba(235,235,235,0.1)",
  button: "#F8F8F8",
  success: "#35BA00",
};

/** The phone screen the preview draws, pt (the stage's phone at its 0.7 zoom). */
export const PHONE = { w: 391.43, h: 831.43, top: 59, bottom: 34, radius: 61.43 };
/** The USDC sheet inside it. */
export const SHEET = { x: 8, w: PHONE.w - 16, h: 509, radius: 48, get y() { return PHONE.h - 8 - this.h; } };

/** Where each screen's interactive pieces are, pt, for the DOM over it. */
export const LAYOUT = {
  button: { x: 20, w: PHONE.w - 40, h: 58, get y() { return PHONE.h - Math.max(PHONE.bottom, 16) - 14 - this.h; } },
  edge: { x: 0, w: 24, h: 274, get y() { return PHONE.h / 2 - 137; } },
  /** The token slot, in the sheet's own coordinates. */
  token: { x: (SHEET.w - 64) / 2, y: 55, w: 64, h: 64 },
  sheetButton: { x: 21, w: SHEET.w - 42, h: 58, get y() { return SHEET.h - 21 - 58; } },
};

/** How long ago each change happened, s; null before it has. */
export interface TransferMoment {
  /** Since the text morphed (the amount, "sent to Maya Chen"). */
  text: number | null;
  /** Since the avatar started its morph into the check. */
  badge: number | null;
}
export interface SheetMoment {
  /** Since Send was touched: Sending…, Processing… */
  tap: number | null;
  /** Since the text swapped on to Sent and Done. */
  text: number | null;
  /** Since the token started its morph into the check. */
  badge: number | null;
  /** The clock the spinner turns on. */
  clock: number;
}

/* ── The app's curves ───────────────────────────────────────── */

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const SETTLE = bezierEase(0.22, 1, 0.36, 1);
const FILL = bezierEase(0.34, 1.35, 0.64, 1);
const POP = bezierEase(0.34, 1.96, 0.94, 1);
const LAND = bezierEase(0.14, 2.56, 0.94, 1);
const EASE_OUT = bezierEase(0, 0, 0.58, 1);
const EASE_IN_OUT = bezierEase(0.42, 0, 0.58, 1);

/* ── Drawing ────────────────────────────────────────────────── */

type Ctx = CanvasRenderingContext2D & { letterSpacing?: string; filter?: string };
const canFilter = typeof CanvasRenderingContext2D !== "undefined" && "filter" in CanvasRenderingContext2D.prototype;

function text(ctx: Ctx, s: string, x: number, y: number, size: number, weight: number, color: string, align: CanvasTextAlign = "center", tracking = 0) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${tracking}px`;
  ctx.fillText(s, x, y);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

/** Drawn moved, blurred and faded, as SwiftUI's offset, blur and opacity. */
function styled(ctx: Ctx, dy: number, blur: number, alpha: number, draw: () => void) {
  if (alpha <= 0.001) return;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(0, dy);
  if (canFilter && blur > 0.05) ctx.filter = `blur(${blur * (ctx.getTransform().a || 1)}px)`;
  draw();
  ctx.restore();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** The table both screens share: 54pt rows between faint dividers. */
function details(ctx: Ctx, x: number, y: number, w: number, rows: Array<[string, string, string?]>, inset = 0) {
  const h = rows.length * 54 + (rows.length - 1) + 2 + inset * 2;
  roundRect(ctx, x, y, w, h, 24);
  ctx.fillStyle = INK.card;
  ctx.fill();
  roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, 23.5);
  ctx.strokeStyle = INK.hairline;
  ctx.lineWidth = 1;
  ctx.stroke();
  let ry = y + 1 + inset;
  rows.forEach(([label, value, accessory], i) => {
    if (i > 0) {
      ctx.fillStyle = INK.divider;
      ctx.fillRect(x + 19, ry, w - 38, 1);
      ry += 1;
    }
    text(ctx, label, x + 19, ry + 27, 16, 400, INK.faint, "left");
    const right = x + w - 19;
    if (accessory === "copy") {
      copyIcon(ctx, right - 16, ry + 19);
      text(ctx, value, right - 24, ry + 27, 16, 500, INK.white, "right");
    } else if (accessory === "disclosure") {
      disclosure(ctx, right - 20, ry + 17);
      text(ctx, value, right - 28, ry + 27, 16, 500, INK.white, "right");
    } else {
      text(ctx, value, right, ry + 27, 16, 500, INK.white, "right");
    }
    ry += 54;
  });
  return h;
}

function copyIcon(ctx: Ctx, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = INK.faint;
  ctx.lineWidth = 1.5;
  ctx.lineCap = "round";
  roundRect(ctx, 5.5, 5.5, 8, 8, 2);
  ctx.stroke();
  ctx.stroke(new Path2D("M10.4 3.1C10 2.7 9.4 2.5 8.7 2.5H4.5C3.4 2.5 2.5 3.4 2.5 4.5V8.7C2.5 9.3 2.7 9.8 3.1 10.2"));
  ctx.restore();
}

function disclosure(ctx: Ctx, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(10, 10, 10, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fill();
  ctx.strokeStyle = "#EBEBEB";
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D("M6.5 9L10 12.5L13.5 9"));
  ctx.restore();
}

function roundButton(ctx: Ctx, x: number, y: number, glyph: "back" | "close") {
  ctx.beginPath();
  ctx.arc(x + 21, y + 21, 21, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.lineWidth = 0.75;
  ctx.stroke();
  ctx.strokeStyle = "#EBEBEB";
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (glyph === "back") {
    ctx.moveTo(x + 24, y + 14);
    ctx.lineTo(x + 17, y + 21);
    ctx.lineTo(x + 24, y + 28);
  } else {
    ctx.moveTo(x + 16, y + 16);
    ctx.lineTo(x + 26, y + 26);
    ctx.moveTo(x + 26, y + 16);
    ctx.lineTo(x + 16, y + 26);
  }
  ctx.stroke();
}

/* ── The badge morph (CheckBadge) ───────────────────────────── */

interface Badge {
  rest: number;
  done: number;
  /** The check's points in the done disc's own coordinates, and its stroke. */
  check: Array<[number, number]>;
  unit: number;
  line: number;
  avatar: (ctx: Ctx, cx: number, cy: number, d: number) => void;
}

/* Maya's photo, as the app's RecipientAvatar (generated in the Portfolio file
   with Figma AI). Same origin, so the screen canvas stays clean for WebGL.
   Until it has decoded, the design's "MC" disc stands in; the preview
   repaints its resting screen once `sceneImagesReady` settles. */
const MAYA_PHOTO = typeof Image === "undefined" ? null : Object.assign(new Image(), { src: "/assets/avatars/maya-chen.jpg" });
export const sceneImagesReady: Promise<void> = MAYA_PHOTO ? MAYA_PHOTO.decode().catch(() => undefined) : Promise.resolve();

const MAYA: Badge = {
  rest: 76,
  done: 62,
  check: [[19.8, 31], [27.2667, 39], [42.2, 23]],
  unit: 62,
  line: 4,
  avatar(ctx, cx, cy, d) {
    if (MAYA_PHOTO && MAYA_PHOTO.complete && MAYA_PHOTO.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(MAYA_PHOTO, cx - d / 2, cy - d / 2, d, d);
      ctx.restore();
      // The controls' faint rim, inside the edge.
      ctx.beginPath();
      ctx.arc(cx, cy, d / 2 - 0.375, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.16)";
      ctx.lineWidth = 0.75;
      ctx.stroke();
      return;
    }
    const g = ctx.createLinearGradient(cx - d * 0.12, cy + d * 0.34, cx + d * 0.26, cy - d * 0.71);
    g.addColorStop(0, "rgba(13,127,131,0.6)");
    g.addColorStop(1, "rgba(91,120,177,0.6)");
    ctx.beginPath();
    ctx.arc(cx, cy, d / 2, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.16)";
    ctx.lineWidth = 0.75;
    ctx.stroke();
    text(ctx, "MC", cx, cy + 1, 26, 600, "#EEEEEE");
  },
};

const COIN_ARCS = new Path2D("M24 15.36C14.2 20 10.6 31.5 15.2 41.3C17.2 45.5 20.3 48.6 24 50.4M40 15.36C49.8 20 53.4 31.5 48.8 41.3C46.8 45.5 43.7 48.6 40 50.4");
const COIN_DOLLAR = new Path2D("M37.76 26.24C36.8 24 34.56 22.72 31.84 22.72C28.32 22.72 25.92 24.48 25.92 27.2C25.92 33.6 38.4 30.4 38.4 36.96C38.4 39.84 35.84 41.6 32 41.6C28.96 41.6 26.56 40.32 25.6 37.92M32 41.6V45.44M32 18.56V22.72");

const TOKEN: Badge = {
  rest: 64,
  done: 52,
  check: [[18, 26], [23.3333, 32], [34, 20]],
  unit: 52,
  line: 3,
  avatar(ctx, cx, cy, d) {
    ctx.save();
    ctx.translate(cx - d / 2, cy - d / 2);
    ctx.scale(d / 64, d / 64);
    ctx.beginPath();
    ctx.arc(32, 32, 32, 0, Math.PI * 2);
    ctx.fillStyle = "#2775CA";
    ctx.fill();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 3.52;
    ctx.lineCap = "round";
    ctx.stroke(COIN_ARCS);
    ctx.stroke(COIN_DOLLAR);
    ctx.restore();
  },
};

/** The badge `since` seconds into its morph (null: at rest), its frame's
    centre at (cx, top + size/2) when top-aligned, else at (cx, cy). */
function badge(ctx: Ctx, b: Badge, since: number | null, cx: number, anchor: { top?: number; cy?: number }) {
  const t = since ?? -1;
  const done = since !== null;
  // The frame pops from the avatar's size to the badge's, overshooting.
  const size = done ? b.rest + (b.done - b.rest) * POP(clamp01(t / 0.35)) : b.rest;
  // Up, then down with an overshoot; the cross-blur, both ways.
  const hopTo = (6 * b.done) / 62;
  let hop = 0;
  if (done) hop = t < 0.25 ? hopTo * FILL(t / 0.25) : hopTo * (1 - LAND(clamp01((t - 0.25) / 0.3)));
  const crossBlur = (1.5 * b.done) / 62;
  let blur = 0;
  if (done) blur = t < 0.1575 ? crossBlur * FILL(t / 0.1575) : crossBlur * (1 - SETTLE(clamp01((t - 0.1575) / 0.25)));
  const cy = (anchor.cy ?? (anchor.top ?? 0) + size / 2) - hop;
  const avatarA = done ? 1 - EASE_OUT(clamp01(t / 0.245)) : 1;
  const discA = done ? clamp01(FILL(clamp01(t / 0.35))) : 0;
  const trim = done ? SETTLE(clamp01((t - 0.23) / 0.6)) : 0;

  styled(ctx, 0, Math.max(blur, 0), 1, () => {
    if (avatarA > 0.001) {
      ctx.save();
      ctx.globalAlpha *= avatarA;
      b.avatar(ctx, cx, cy, size);
      ctx.restore();
    }
    if (discA > 0.001) {
      ctx.save();
      ctx.globalAlpha *= discA;
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fillStyle = INK.success;
      ctx.fill();
      // The white highlight under the top edge, and the faint inner ring.
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      ctx.arc(cx, cy + 1, size / 2, Math.PI * 1.05, Math.PI * 1.95);
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      ctx.restore();
    }
    if (trim > 0.001) {
      const k = size / b.unit;
      const pts = b.check.map(([x, y]) => [cx - size / 2 + x * k, cy - size / 2 + y * k]);
      const segs = [Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]), Math.hypot(pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])];
      let left = (segs[0] + segs[1]) * trim;
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 0; i < 2 && left > 0; i++) {
        const f = Math.min(left / segs[i], 1);
        ctx.lineTo(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f);
        left -= segs[i];
      }
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = b.line;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  });
}

/* ── Send money ─────────────────────────────────────────────── */

const TRANSFER_ROWS: Array<[string, string]> = [
  ["From", "Everyday ·· 4821"],
  ["Arrives", "In seconds"],
  ["Fee", "Free"],
  ["Fee", "Free"],
  ["Note", "Studio rent"],
];

export function drawTransfer(ctx: Ctx, m: TransferMoment) {
  ctx.fillStyle = INK.page;
  ctx.fillRect(0, 0, PHONE.w, PHONE.h);
  const top = PHONE.top + 6;
  roundButton(ctx, 20, top, "back");
  const hero = top + 42 + 93;
  const x0 = (PHONE.w - 362) / 2;
  const at = (x: number) => x0 + x;

  badge(ctx, MAYA, m.badge, at(181), { top: hero });

  const tt = m.text;
  // "Sending to Maya Chen" makes way for the amount coming up…
  const out = tt === null ? 0 : EASE_OUT(clamp01(tt / 0.2));
  styled(ctx, -10 * out, 6 * out, 1 - out, () => {
    ctx.font = `500 16px ${FONT}`;
    const lead = "Sending to ";
    const total = ctx.measureText(lead + "Maya Chen").width;
    const leadW = ctx.measureText(lead).width;
    text(ctx, lead, at(181) - total / 2, hero + 103.5, 16, 500, INK.faint, "left");
    text(ctx, "Maya Chen", at(181) - total / 2 + leadW, hero + 103.5, 16, 500, INK.soft, "left");
  });
  // …the amount moves up and down to 21pt, drawn at each size on the way…
  const p = tt === null ? 0 : SETTLE(clamp01(tt / 0.7));
  const mix = (a: number, b: number) => a + (b - a) * p;
  text(ctx, "$1,250.00", at(mix(181, 179)), hero + mix(153, 104), mix(53, 21), 500, INK.white, "center", mix(-1.6, 0));
  // …and "sent to Maya Chen" settles in under it.
  const inn = tt === null ? 0 : SETTLE(clamp01((tt - 0.2) / 0.7));
  styled(ctx, 8 * (1 - inn), 6 * (1 - inn), inn, () => {
    text(ctx, "sent to Maya Chen", at(179), hero + 132, 21, 500, INK.faint);
  });

  details(ctx, 20, hero + 240, PHONE.w - 40, TRANSFER_ROWS);
}

/* ── The USDC sheet ─────────────────────────────────────────── */

const SHEET_ROWS: Array<[string, string, string]> = [
  ["To", "HTjz…sUjs", "copy"],
  ["Onchain transaction", "3dpD…vfg8", "copy"],
  ["Onchain fees", "0.00206 SOL", "disclosure"],
];

/** transitions.dev's text swap at `since` s into it: the old text leaves up,
    blurring as it fades, then the new one comes up from below. */
function swap<T>(since: number | null, from: T, to: T) {
  if (since === null) return { value: from, dy: 0, blur: 0, alpha: 1 };
  const t = since;
  const stage = t < 0.15 ? EASE_IN_OUT(t / 0.15) : t < 0.3 ? 1 + EASE_IN_OUT((t - 0.15) / 0.15) : 2;
  const gone = stage <= 1 ? stage : 2 - stage;
  return { value: stage < 1 ? from : to, dy: (stage <= 1 ? -4 : 4) * gone, blur: 2 * gone, alpha: 1 - gone };
}

export function drawSheet(ctx: Ctx, m: SheetMoment) {
  // Square: the lens samples past the corners and finds the same colour there.
  ctx.fillStyle = INK.sheet;
  ctx.fillRect(0, 0, SHEET.w, SHEET.h);
  roundButton(ctx, SHEET.w - 20 - 42, 20, "close");
  const cx = SHEET.w / 2;

  badge(ctx, TOKEN, m.badge, cx, { cy: LAYOUT.token.y + 32 });

  // The status and the button: Sent → Sending… → Sent, Send → Processing… → Done.
  const sentPhase = m.text !== null;
  const status = sentPhase ? swap(m.text, "Sending...", "Sent") : swap(m.tap, "Sent", "Sending...");
  styled(ctx, status.dy, status.blur, status.alpha, () => text(ctx, status.value, cx, 135 + 9.5, 16, 500, INK.faint));
  text(ctx, "11.054 USDC", cx, 135 + 21 + 22, 36, 500, INK.white, "center", -0.8);
  text(ctx, "Oct 3, 2026 at 8:55 AM", cx, 135 + 67 + 9, 15, 400, INK.faint);
  details(ctx, 21, 246, SHEET.w - 42, SHEET_ROWS, 1);

  const label = sentPhase ? swap(m.text, "Processing...", "Done") : swap(m.tap, "Send", "Processing...");
  // Dimmed while processing, on the swap's own 150ms ease-in-out.
  let dim = 1;
  if (m.tap !== null && !sentPhase) dim = 1 - 0.2 * EASE_IN_OUT(clamp01(m.tap / 0.15));
  if (sentPhase) dim = 0.8 + 0.2 * EASE_IN_OUT(clamp01((m.text ?? 0) / 0.15));
  const b = LAYOUT.sheetButton;
  ctx.save();
  ctx.globalAlpha = dim;
  roundRect(ctx, b.x, b.y, b.w, b.h, 29);
  ctx.fillStyle = INK.button;
  ctx.fill();
  styled(ctx, label.dy, label.blur, label.alpha, () => {
    if (label.value === "Processing...") {
      ctx.font = `500 17px ${FONT}`;
      const w = ctx.measureText(label.value).width + 28;
      const sx = cx - w / 2 + 10;
      const turn = ((m.clock % 0.8) / 0.8) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(sx, b.y + 29, 9, 0, Math.PI * 2);
      ctx.strokeStyle = "#BFBFBF";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, b.y + 29, 9, -Math.PI / 2 + turn, Math.PI * 0.1 + turn);
      ctx.strokeStyle = "#000000";
      ctx.lineCap = "round";
      ctx.stroke();
      text(ctx, label.value, sx + 18, b.y + 29, 17, 500, INK.page, "left");
    } else {
      text(ctx, label.value, cx, b.y + 29, 17, 500, INK.page);
    }
  });
  ctx.restore();
}

/** A canvas for a screen of `wPt` × `hPt` at `scale` pixels per point, with
    its context already scaled to points. */
export function screenCanvas(wPt: number, hPt: number, scale: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(wPt * scale));
  c.height = Math.max(1, Math.round(hPt * scale));
  const ctx = c.getContext("2d") as Ctx;
  ctx.setTransform(c.width / wPt, 0, 0, c.height / hPt, 0, 0);
  return { c, ctx };
}
