/**
 * Gravity — the orb pulls the pointer in.
 *
 * An optional effect: as the pointer nears an orb, its body bends toward
 * it and the side facing it streaks toward the orb's centre, like
 * something caught in a well. The pointer itself does not move — its tip
 * stays exactly where the OS has it, and it is never rotated or scaled as
 * a whole. A page cannot move or reshape the OS cursor, so the
 * trick is the one cursorjoy (and metal-fx v2's cursor light) uses: while
 * the pointer is within reach and the element under it shows the plain
 * arrow, that element gets `cursor: none` and a raster of the platform's
 * pointer is drawn in its place, warped by the well. The raster has to be the platform's real pointer or the swap
 * shows; consumers supply it (`setGravitySprite`, or `gravity.sprite`).
 * Without one the effect stays off. Over buttons and text (hand, I-beam)
 * the OS cursor is left alone.
 *
 * Runs only on `(pointer: fine)` devices. Tracking starts when the first
 * orb attaches and stops with the last; the per-frame loop runs only while
 * the pointer is within reach of some orb (plus the fade-out).
 *
 * Fail-safes for the cursor swap (the only part that can hurt someone):
 *   • off under `prefers-reduced-motion`, `forced-colors`, coarse/no-hover
 *     pointers, and pen/touch input;
 *   • off while the page is zoomed (DPR differs from when the sprite was
 *     registered, or pinch-zoomed) — the sprite would scale, the OS cursor
 *     wouldn't;
 *   • the OS cursor is hidden by one class on <html> for exactly as long
 *     as the pointer is in a well, lifted on every leave/blur/hide/keydown,
 *     over anything with a cursor of its own, and on any exception (which
 *     also disables the effect for the session);
 *   • a frame-time watchdog disables it if it ever becomes expensive;
 *   • it never runs where the pointer is anything but the plain arrow.
 * Not detectable: Accessibility › Pointer size/colour on macOS. A user with
 * an enlarged pointer sees it swap to the stock one — ship the sprite only
 * where that trade-off is acceptable, and give them a way to turn it off.
 */

/** A raster of the platform's real pointer. `width`/`height` in CSS px,
 *  `hotX`/`hotY` the click point. */
export interface CursorSprite {
  src: string;
  width: number;
  height: number;
  hotX: number;
  hotY: number;
}

export interface GravityOptions {
  /** How far outside the orb's edge the pull is felt, CSS px. */
  reach?: number;
  /** How far the pointer trails toward the orb on contact, CSS px. The
   *  pointer itself never moves; this is the length of its tail. */
  strength?: number;
  /** How far the pointer's body is bent toward the orb on contact, CSS
   *  px. The tip stays pinned; the rest of the body is drawn displaced
   *  toward the orb, more the farther a pixel sits from the tip. */
  deform?: number;
  /** How the bend is spread along the body (1..4): 1 bends evenly from
   *  the tip outward, higher keeps the tip end firm and bends the far end
   *  hardest. */
  taper?: number;
  /** How late the pull builds (1..4): the proximity weight is raised to
   *  this power, so higher keeps the pointer whole until it is close. */
  curve?: number;
  /** Width of the band across the pointer, CSS px, over which the tail
   *  fades from the side facing the orb to the side away from it. Small
   *  keeps the tail to the facing edge; large lets the whole body trail. */
  falloff?: number;
  /** Inertia (0..1): how much the deformation lags the pointer. 0 follows
   *  instantly; higher reads heavier. */
  smoothing?: number;
  /** Handover (0..1): how slowly the pull swings from one orb to the next
   *  when the nearest changes. 0 flips at once; higher glides. */
  handover?: number;
  /** Squash (0..3): extra bend and tail when the orb lies off the tip's
   *  side, where the pull shortens the body instead of stretching it. A
   *  shortening reads far weaker than a stretch of the same size, so this
   *  evens the two — 0 leaves them equal in pixels, not in feel. */
  squash?: number;
  /** Progressive blur on the tail, CSS px: none at the pointer, this much
   *  at the tail's far end, growing along it. 0 keeps the tail crisp. */
  blur?: number;
  /** Envelope on enter/leave, ms (~95% settled). */
  fadeMs?: number;
  /** The pointer raster, if not already set with `setGravitySprite`. */
  sprite?: CursorSprite;
}

export const GRAVITY_DEFAULTS: Readonly<Required<Omit<GravityOptions, 'sprite'>>> = Object.freeze({
  reach: 160,
  strength: 11,
  deform: 19,
  taper: 1.95,
  curve: 2.8,
  falloff: 24,
  smoothing: 0.3,
  handover: 0.6,
  squash: 1.2,
  blur: 1,
  fadeMs: 180,
});

/** Live override for tuning: while set, every orb uses these values in
 *  place of its own. Dev panels write it; ship code leaves it null. */
let tuning: Partial<Required<Omit<GravityOptions, 'sprite'>>> | null = null;
export function setGravityConfig(patch: Partial<Required<Omit<GravityOptions, 'sprite'>>> | null): void {
  tuning = patch ? { ...(tuning ?? {}), ...patch } : null;
  kick();
}
export function getGravityConfig(): Readonly<Required<Omit<GravityOptions, 'sprite'>>> {
  return { ...GRAVITY_DEFAULTS, ...(tuning ?? {}) };
}

type Resolved = Required<Omit<GravityOptions, 'sprite'>>;

interface Instance {
  el: HTMLElement;
  opts: Resolved;
}

// ─── Sprite ────────────────────────────────────────────────────────────

let sprite: CursorSprite | null = null;
let spriteImg: HTMLImageElement | null = null;
/** The sprite's pixels at the current device scale — the bend samples
 *  these. Rebuilt when the sprite or the DPR changes. */
let src: ImageData | null = null;
let srcDpr = 0;
/** DPR when the sprite was registered — a change means browser zoom or a
 *  different display, where the sprite no longer matches the OS cursor. */
let spriteDpr = 0;
/** Sticky off-switch flipped by the fail-safes, with why. Cleared by a new
 *  sprite or `resetGravity()`. */
let disabled = false;
let disabledReason = '';
let slowFrames = 0;

/** Clear the fail-safe off-switch (a dev panel's "re-arm"). */
export function resetGravity(): void {
  disabled = false;
  disabledReason = '';
  slowFrames = 0;
  kick();
}
/** Supply the pointer raster (or null to turn the effect off). Must match
 *  the OS pointer pixel-for-pixel, or the swap is visible. */
export function setGravitySprite(next: CursorSprite | null): void {
  if (next === sprite) return;
  sprite = next;
  spriteImg = null;
  src = null;
  disabled = false;
  slowFrames = 0;
  spriteDpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  hideCursor();
  if (!next || typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    if (sprite !== next) return;
    spriteImg = img;
    kick();
  };
  img.src = next.src;
}

// ─── Tracking ──────────────────────────────────────────────────────────

const instances = new Set<Instance>();
let tracking = false;
let raf = 0;
let last = 0;
let px = Number.NaN, py = Number.NaN; // live pointer, NaN when gone
let lpx = 0, lpy = 0;                 // last known, for the fade-out
let uS = 0;                           // smoothed proximity weight
let near: Instance | null = null;
let pointerIsMouse = true;
/** Set on keydown, cleared by the next pointer move — keeps the sprite off
 *  while someone types, as macOS hides the pointer then. */
let typing = false;

/** Register an orb's element. Returns the detach function. */
export function attachGravity(el: HTMLElement, options: GravityOptions | true = true): () => void {
  const o = options === true ? {} : options;
  if (o.sprite) setGravitySprite(o.sprite);
  const inst: Instance = {
    el,
    opts: {
      reach: Math.max(1, o.reach ?? GRAVITY_DEFAULTS.reach),
      strength: Math.max(0, Math.min(64, o.strength ?? GRAVITY_DEFAULTS.strength)),
      deform: Math.max(0, Math.min(32, o.deform ?? GRAVITY_DEFAULTS.deform)),
      taper: Math.max(1, Math.min(4, o.taper ?? GRAVITY_DEFAULTS.taper)),
      curve: Math.max(1, Math.min(4, o.curve ?? GRAVITY_DEFAULTS.curve)),
      falloff: Math.max(2, Math.min(200, o.falloff ?? GRAVITY_DEFAULTS.falloff)),
      smoothing: clamp01(o.smoothing ?? GRAVITY_DEFAULTS.smoothing),
      handover: clamp01(o.handover ?? GRAVITY_DEFAULTS.handover),
      squash: Math.max(0, Math.min(3, o.squash ?? GRAVITY_DEFAULTS.squash)),
      blur: Math.max(0, Math.min(24, o.blur ?? GRAVITY_DEFAULTS.blur)),
      fadeMs: Math.max(1, o.fadeMs ?? GRAVITY_DEFAULTS.fadeMs),
    },
  };
  instances.add(inst);
  ensureTracking();
  kick();
  return () => {
    instances.delete(inst);
    if (near === inst) near = null;
    /* Tear down only once nothing has registered by the end of the task.
       React runs every cleanup before any new effect in a commit, so a
       page swapping one set of orbs for another passes through zero here
       — stopping at once took the cursor away and gave it back a frame
       later, a flash on every such swap. */
    if (instances.size === 0) queueMicrotask(() => { if (instances.size === 0) stopTracking(); });
  };
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
/** An orb's options with any live tuning laid over them. */
const effective = (inst: Instance): Resolved => (tuning ? { ...inst.opts, ...tuning } : inst.opts);
const mq = (q: string): boolean => typeof window.matchMedia === 'function' && window.matchMedia(q).matches;

/** Why the cursor swap is not acceptable right now, or null when it is.
 *  Re-checked every frame; all of these can change while the page is open. */
function swapBlockedBy(): string | null {
  if (disabled) return disabledReason || 'disabled by a fail-safe';
  if (!sprite) return 'no pointer sprite set';
  if (!spriteImg) return 'pointer sprite still loading';
  if (mq('(prefers-reduced-motion: reduce)')) return 'prefers-reduced-motion is on';
  if (mq('(forced-colors: active)')) return 'forced colours are active';
  if (!mq('(pointer: fine)') || !mq('(hover: hover)')) return 'no fine pointer';
  if ((window.devicePixelRatio || 1) !== spriteDpr) return 'display scale changed since the sprite was set — reload';
  const vv = window.visualViewport;
  if (vv && Math.abs(vv.scale - 1) > 0.001) return 'page is zoomed';
  return null;
}
function swapAllowed(): boolean {
  return swapBlockedBy() === null;
}

/** For dev tooling: whether the effect can run, and why not if it cannot. */
export function getGravityStatus(): { orbs: number; tracking: boolean; active: boolean; blockedBy: string | null } {
  const blocked = typeof window === 'undefined' ? 'no window' : swapBlockedBy();
  return { orbs: instances.size, tracking, active: curShown, blockedBy: instances.size === 0 ? 'no orb has gravity on' : blocked };
}

function ensureTracking(): void {
  if (tracking || instances.size === 0 || typeof document === 'undefined') return;
  if (!mq('(pointer: fine)')) return;
  tracking = true;
  document.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerleave', onLeave);
  document.addEventListener('pointercancel', onLeave);
  document.addEventListener('keydown', onKey, { passive: true });
  document.addEventListener('visibilitychange', onLeave);
  window.addEventListener('blur', onLeave);
}

function stopTracking(): void {
  if (!tracking) return;
  tracking = false;
  document.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerleave', onLeave);
  document.removeEventListener('pointercancel', onLeave);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('visibilitychange', onLeave);
  window.removeEventListener('blur', onLeave);
  if (raf !== 0) { cancelAnimationFrame(raf); raf = 0; }
  near = null;
  uS = 0;
  hideCursor();
  if (curEl) { curEl.remove(); curEl = null; curCanvas = null; curCtx = null; }
  if (hideStyle) { hideStyle.remove(); hideStyle = null; }
}

function onMove(e: PointerEvent): void {
  pointerIsMouse = e.pointerType === 'mouse' || e.pointerType === '';
  typing = false;
  moveSeq++;
  px = lpx = e.clientX;
  py = lpy = e.clientY;
  if (releasePending) {
    // The OS pointer is back with this move; the sprite has done its part.
    releasePending = false;
    hideSprite();
    amp = 0; bend = 0;
    wcx = wcy = Number.NaN;
  }
  kick();
}

function onKey(): void {
  typing = true;
  hideCursor();
}

function onLeave(): void {
  px = py = Number.NaN;
  kick();
}

function kick(): void {
  if (!tracking || raf !== 0) return;
  last = performance.now();
  raf = requestAnimationFrame(step);
}

// ─── Pointer sprite ────────────────────────────────────────────────────

let curEl: HTMLDivElement | null = null;
let curCanvas: HTMLCanvasElement | null = null;
let curCtx: CanvasRenderingContext2D | null = null;
let curShown = false;
/* Hiding the OS pointer. One rule on <html> while the pointer is in a
   well — `cursor: none !important` for everything beneath it — rather than
   an inline style on whichever element is under the pointer. Per-element
   hiding could not keep up: an element sliding under a still pointer is
   painted with its own cursor before the next frame claims it, and every
   crossing was a chance for the arrow to show for a frame. The rule is
   lifted whenever the pointer is over something with a cursor of its own
   (a button's hand, a field's I-beam), so those still show; what an
   element's cursor would be without the rule is read once and cached. */
const HIDE_CLASS = 'thinking-orb-gravity-hide';
let hideStyle: HTMLStyleElement | null = null;
let hiding = false;
const naturalCursor = new WeakMap<Element, string>();
/** Pointer moves seen, and the move on which hiding began. The OS pointer
 *  is still drawn until the move AFTER the rule lands, so the sprite waits
 *  for that move rather than sit beside it. */
let moveSeq = 0;
let claimMove = -1;
/** Frames stepped, and the frame hiding began: the hold above is capped at
 *  two frames, so a pointer that stops right then gets its sprite anyway. */
let stepSeq = 0;
let claimStep = -1;

function ensureCursor(): boolean {
  if (curEl) return true;
  const el = document.createElement('div');
  el.className = 'thinking-orb-gravity-cursor';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;z-index:2147483001;will-change:transform;display:none';
  const c = document.createElement('canvas');
  c.style.display = 'block';
  el.appendChild(c);
  document.body.appendChild(el);
  const ctx = c.getContext('2d');
  if (!ctx) { el.remove(); return false; }
  curEl = el; curCanvas = c; curCtx = ctx;
  /* A new canvas starts at the default 300×150. Forget the last sizing so
     the next draw sizes it — otherwise an orb remounting after the last
     one detached draws into an unsized canvas, which shows scaled. */
  curDpr = 0;
  return true;
}

function ensureHideStyle(): void {
  if (hideStyle) return;
  hideStyle = document.createElement('style');
  hideStyle.textContent = `html.${HIDE_CLASS}, html.${HIDE_CLASS} * { cursor: none !important; }`;
  document.head.appendChild(hideStyle);
}

/** The cursor an element shows on its own, with our rule out of the way. */
function cursorOf(el: Element): string {
  const cached = naturalCursor.get(el);
  if (cached) return cached;
  const root = document.documentElement;
  const had = root.classList.contains(HIDE_CLASS);
  if (had) root.classList.remove(HIDE_CLASS);
  const cur = getComputedStyle(el).cursor;
  if (had) root.classList.add(HIDE_CLASS);
  naturalCursor.set(el, cur);
  return cur;
}

/** Hide the OS cursor if the element under the pointer shows the plain
 *  arrow. Returns whether the sprite may show. */
function claimCursor(x: number, y: number): boolean {
  const target = document.elementFromPoint(x, y);
  if (!target) return false;
  const cur = cursorOf(target);
  if (cur !== 'auto' && cur !== 'default') {
    releaseCursor();
    return false;
  }
  if (!hiding) {
    ensureHideStyle();
    document.documentElement.classList.add(HIDE_CLASS);
    hiding = true;
    claimMove = moveSeq;
    claimStep = stepSeq;
  }
  return true;
}

function releaseCursor(): void {
  if (!hiding) return;
  document.documentElement.classList.remove(HIDE_CLASS);
  hiding = false;
  claimMove = -1;
}

/** Hide the sprite only; the OS cursor stays hidden. */
function hideSprite(): void {
  if (curEl && curShown) { curEl.style.display = 'none'; curShown = false; }
}

/** After the pointer leaves every orb's reach the swap is kept for this
 *  long, the sprite drawn plain at the pointer: crossing from one orb to
 *  the next then never gives the OS cursor back and takes it again, which
 *  is a blank frame each way. */
const LINGER_MS = 500;
/** When the nearest orb was last in reach, performance.now(). */
let lastReach = Number.NEGATIVE_INFINITY;
/** The swap was released with the sprite still drawn: the OS pointer is
 *  painted again on the next move, and the sprite goes on that move. */
let releasePending = false;

function hideCursor(): void {
  releasePending = false;
  releaseCursor();
  hideSprite();
  amp = 0; bend = 0;
  wcx = wcy = Number.NaN;
}

const _c = { cx: 0, cy: 0, r: 0 }; // nearest orb: centre and radius, viewport px
/** Smoothed pull and bend, CSS px — what `smoothing` eases. */
let amp = 0, bend = 0;
/** The well's centre as drawn, viewport px. Eases toward the nearest orb
 *  rather than snapping to it, so handing over from one orb to the next
 *  swings the pull round smoothly instead of flipping it in a frame. */
let wcx = Number.NaN, wcy = Number.NaN;
/** Room around the sprite for the tail and the bend, CSS px. */
const PAD = 48;
/** Ghost passes per frame: more is smoother, all are cheap canvas draws. */
const PASSES = 10;
let refCanvas: HTMLCanvasElement | null = null;
let refCtx: CanvasRenderingContext2D | null = null;
/** The bent pointer — the tail is stamped from this, so it trails from
 *  the body as drawn, not from the stock sprite. */
let bentCanvas: HTMLCanvasElement | null = null;
let bentCtx: CanvasRenderingContext2D | null = null;
let bentData: ImageData | null = null;
let curDpr = 0, curW = 0, curH = 0;

function readSprite(dpr: number): ImageData | null {
  if (!spriteImg || !sprite) return null;
  const c = document.createElement('canvas');
  c.width = Math.ceil(sprite.width * dpr);
  c.height = Math.ceil(sprite.height * dpr);
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.scale(dpr, dpr);
  g.drawImage(spriteImg, 0, 0, sprite.width, sprite.height);
  return g.getImageData(0, 0, c.width, c.height);
}

/**
 * Bend the pointer toward the orb into `bentData`: each output pixel
 * samples the sprite from a point displaced away from the orb, by an
 * amount that grows with the pixel's distance from the tip — so the tip
 * stays exactly where it is and the body leans in behind it. Nothing is
 * rotated or scaled as a whole.
 */
function bendSprite(B: number, taper: number, P: number, hx: number, hy: number, cxo: number, cyo: number): void {
  if (!src || !bentData) return;
  const OW = bentData.width, OH = bentData.height;
  const S = src, SW = S.width, SH = S.height, sd = S.data;
  const od = bentData.data;
  od.fill(0);
  const L = Math.max(1, Math.hypot(SW, SH));
  /* Only the sprite's box, swept along the pull by up to the bend, can
     hold a pixel — the rest of the padded canvas stays clear. Keeps the
     per-frame loop to a few thousand pixels rather than the whole pad. */
  const tdx = cxo - hx, tdy = cyo - hy;
  const tdl = Math.hypot(tdx, tdy) || 1;
  const tux = tdx / tdl, tuy = tdy / tdl;
  const x1 = Math.max(0, Math.floor(P + Math.min(0, B * tux) - 3)), x2 = Math.min(OW, Math.ceil(P + SW + Math.max(0, B * tux) + 3));
  const y1 = Math.max(0, Math.floor(P + Math.min(0, B * tuy) - 3)), y2 = Math.min(OH, Math.ceil(P + SH + Math.max(0, B * tuy) + 3));
  for (let y = y1; y < y2; y++) {
    for (let x = x1; x < x2; x++) {
      const i = (y * OW + x) * 4;
      let sx = x - P, sy = y - P;
      if (B > 0.01) {
        /* Where this pixel comes from: the source q with q + m(q)·u = (x, y),
           m being the bend at q — at the source, not here. Evaluated here,
           a pixel off the orb's side of the tip is far from the tip, gets
           the full bend, and reads that far back into the body: a detached
           sliver of pointer floating off the tip. The equation is solved by
           a damped fixed-point iteration (the plain one oscillates once the
           bend's slope passes 1), and a pixel with no solution — nothing
           lands there — stays empty. */
        let qx = x, qy = y;
        let m = 0, dx = 0, dy = 0, dl = 1;
        for (let it = 0; it < 7; it++) {
          const s = Math.hypot(qx - hx, qy - hy) / L;
          m = B * Math.pow(Math.min(1, s), taper);
          dx = cxo - qx; dy = cyo - qy;
          dl = Math.hypot(dx, dy) || 1;
          qx += (x - (m * dx) / dl - qx) * 0.5;
          qy += (y - (m * dy) / dl - qy) * 0.5;
        }
        const ex = qx + (m * dx) / dl - x, ey = qy + (m * dy) / dl - y;
        if (ex * ex + ey * ey > 2.25) { od[i] = od[i + 1] = od[i + 2] = od[i + 3] = 0; continue; }
        sx = qx - P; sy = qy - P;
      }
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < -1 || y0 < -1 || x0 >= SW || y0 >= SH) { od[i] = od[i + 1] = od[i + 2] = od[i + 3] = 0; continue; }
      const fx = sx - x0, fy = sy - y0;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) {
        const xx = x0 + (k & 1), yy = y0 + (k >> 1);
        if (xx < 0 || yy < 0 || xx >= SW || yy >= SH) continue;
        const wgt = (k & 1 ? fx : 1 - fx) * (k >> 1 ? fy : 1 - fy);
        const j = (yy * SW + xx) * 4;
        const wa = wgt * sd[j + 3];
        r += sd[j] * wa; g += sd[j + 1] * wa; b += sd[j + 2] * wa; a += wa;
      }
      if (a > 0) { od[i] = r / a; od[i + 1] = g / a; od[i + 2] = b / a; od[i + 3] = a; }
      else { od[i] = od[i + 1] = od[i + 2] = od[i + 3] = 0; }
    }
  }
}

/**
 * Draw the pointer being pulled toward the orb. Two parts, both leaving
 * the pointer's position, size and orientation exactly the OS's:
 *   • the bend — the body leans toward the orb behind its pinned tip;
 *   • the tail — fading copies of that bent pointer, stamped along the
 *     line to the orb's centre and masked to the side of the pointer that
 *     faces the orb, so that side trails toward it wherever the orb is.
 *     (Masking by depth in the well would kill the tail whenever the orb
 *     is on the tip's side, since the tip is then the closest point.)
 * `w` is the smoothed proximity weight (0 far, 1 touching).
 */
function drawCursor(inst: Instance, w: number, dt: number): void {
  if (!curCtx || !curCanvas || !curEl || !sprite || !spriteImg) return;
  const sp = sprite;
  const o = effective(inst);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  if (!refCanvas) { refCanvas = document.createElement('canvas'); refCtx = refCanvas.getContext('2d'); }
  if (!bentCanvas) { bentCanvas = document.createElement('canvas'); bentCtx = bentCanvas.getContext('2d'); }
  if (!refCtx || !bentCtx) return;
  if (!src || srcDpr !== dpr) { src = readSprite(dpr); srcDpr = dpr; }
  if (!src) return;
  if (dpr !== curDpr || sp.width !== curW || sp.height !== curH) {
    curDpr = dpr; curW = sp.width; curH = sp.height;
    const OW = Math.ceil((sp.width + 2 * PAD) * dpr), OH = Math.ceil((sp.height + 2 * PAD) * dpr);
    curCanvas.width = refCanvas.width = bentCanvas.width = OW;
    curCanvas.height = refCanvas.height = bentCanvas.height = OH;
    curCanvas.style.width = `${sp.width + 2 * PAD}px`;
    curCanvas.style.height = `${sp.height + 2 * PAD}px`;
    bentData = bentCtx.createImageData(OW, OH);
  }
  const OW = curCanvas.width, OH = curCanvas.height;

  // Pull and bend: strength · w^curve, each eased by `smoothing`.
  const k = Math.pow(w, o.curve);
  const ease = 1 - Math.exp(-dt / (0.012 + o.smoothing * 0.14));
  amp += (o.strength * k - amp) * ease;
  bend += (o.deform * k - bend) * ease;
  let A = amp * dpr, B = bend * dpr;

  // The well's centre eases toward the nearest orb, on `handover`: at the
  // default it takes about half a second to settle, so a switch of orb
  // reads as the pull gliding across rather than snapping.
  if (Number.isNaN(wcx)) { wcx = _c.cx; wcy = _c.cy; }
  else {
    const swing = 1 - Math.exp(-dt / (0.05 + o.handover * 0.6));
    wcx += (_c.cx - wcx) * swing; wcy += (_c.cy - wcy) * swing;
  }

  // Geometry in canvas device px: hotspot at (P + hot), orb centre placed
  // relative to it exactly as on screen.
  const P = PAD * dpr;
  const hx = P + sp.hotX * dpr, hy = P + sp.hotY * dpr;
  const cxo = hx + (wcx - lpx) * dpr, cyo = hy + (wcy - lpy) * dpr;
  const dTip = Math.hypot(cxo - hx, cyo - hy) || 1;
  const ux = (cxo - hx) / dTip, uy = (cyo - hy) / dTip;
  const F = o.falloff * dpr;

  // A pull toward the tip's side shortens the body, and a shortening looks
  // weaker than a stretch of the same size: `squash` adds to both parts in
  // proportion to how far the pull runs against the body's axis.
  if (o.squash > 0) {
    const axL = Math.hypot(sp.width * 0.5 - sp.hotX, sp.height - sp.hotY) || 1;
    const axx = (sp.width * 0.5 - sp.hotX) / axL, axy = (sp.height - sp.hotY) / axL;
    const against = Math.max(0, -(ux * axx + uy * axy));
    const gain = 1 + o.squash * against;
    A *= gain; B *= gain;
  }

  // The only region any pixel can land in: the sprite's box, grown by the
  // bend, swept along the tail. Every raster op below is clipped to it.
  const grow = Math.ceil(Math.max(B, 1)) + 4;
  const bx1 = Math.floor(Math.min(P, P + ux * A) - grow), by1 = Math.floor(Math.min(P, P + uy * A) - grow);
  const bx2 = Math.ceil(Math.max(P, P + ux * A) + sp.width * dpr + grow), by2 = Math.ceil(Math.max(P, P + uy * A) + sp.height * dpr + grow);
  const rx = Math.max(0, bx1), ry = Math.max(0, by1);
  const rw = Math.min(OW, bx2) - rx, rh = Math.min(OH, by2) - ry;

  if (B > 0.01) {
    bendSprite(B, o.taper, P, hx, hy, cxo, cyo);
    bentCtx.putImageData(bentData!, 0, 0, rx, ry, rw, rh);
  } else {
    // No bend: the stock sprite, without touching pixels.
    bentCtx.setTransform(1, 0, 0, 1, 0, 0);
    bentCtx.clearRect(0, 0, OW, OH);
    bentCtx.drawImage(spriteImg, P, P, sp.width * dpr, sp.height * dpr);
  }

  const ctx = curCtx, rctx = refCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, OW, OH);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(bentCanvas, 0, 0);

  if (A > 0.5) {
    // Mask: a band across the pointer's body along the pull axis — full on
    // the side facing the orb, gone on the far side. Anchored on the body's
    // centre so it behaves the same whichever side the orb is on.
    const bcx = P + sp.width * dpr * 0.42, bcy = P + sp.height * dpr * 0.5;
    const half = F / 2;
    const mask = rctx.createLinearGradient(bcx - ux * half, bcy - uy * half, bcx + ux * half, bcy + uy * half);
    mask.addColorStop(0, 'rgba(0,0,0,0)');
    mask.addColorStop(1, 'rgba(0,0,0,1)');
    for (let i = PASSES; i >= 1; i--) {
      const t = i / PASSES;
      rctx.setTransform(1, 0, 0, 1, 0, 0);
      rctx.globalCompositeOperation = 'source-over';
      rctx.globalAlpha = 1;
      rctx.clearRect(rx, ry, rw, rh);
      rctx.drawImage(bentCanvas, rx, ry, rw, rh, rx + ux * A * t, ry + uy * A * t, rw, rh);
      rctx.globalCompositeOperation = 'destination-in';
      rctx.fillStyle = mask;
      rctx.fillRect(rx, ry, rw, rh);
      // Under the pointer, fading with distance along the pull — and, on
      // `blur`, softening with it. The blur rises as √t: the far stamps are
      // nearly transparent already, so a blur that only peaked there would
      // never be seen; this way the mid-tail, still visible, is soft too.
      ctx.globalCompositeOperation = 'destination-over';
      ctx.globalAlpha = Math.pow(1 - t, 1.6) * 0.9;
      if (o.blur > 0) ctx.filter = `blur(${(o.blur * Math.sqrt(t) * dpr).toFixed(2)}px)`;
      ctx.drawImage(refCanvas, rx, ry, rw, rh, rx, ry, rw, rh);
    }
    ctx.filter = 'none';
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  curEl.style.transform = `translate3d(${(lpx - sp.hotX - PAD).toFixed(2)}px,${(lpy - sp.hotY - PAD).toFixed(2)}px,0)`;
  if (!curShown) { curEl.style.display = ''; curShown = true; }
}

// ─── Frame ─────────────────────────────────────────────────────────────

function step(now: number): void {
  raf = 0;
  if (!tracking) return;
  /* Timed from here, not from the frame's timestamp: on a page with other
     animation loops (every orb has one) the rAF timestamp can be many ms
     before this callback runs, and that time is not ours. */
  const t0 = performance.now();
  try {
    stepInner(now);
  } catch (err) {
    // Whatever broke, the user must get their cursor back.
    disabled = true;
    disabledReason = `disabled after an error (${err instanceof Error ? err.message : String(err)})`;
    hideCursor();
    near = null;
    if (typeof console !== 'undefined') console.warn('thinking-orbs: gravity disabled after error', err);
    return;
  }
  // Watchdog: the bend and the tail are a few ms at most. If frames stay
  // slower than that — a huge page, a pathological elementFromPoint —
  // stop swapping the cursor rather than make the pointer stutter.
  const took = performance.now() - t0;
  if (took > 12) {
    if (++slowFrames >= 30 && !disabled) {
      disabled = true;
      disabledReason = `disabled after slow frames (~${Math.round(took)}ms each)`;
      hideCursor();
    }
  } else slowFrames = 0;
}

function stepInner(now: number): void {
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
  last = now;
  stepSeq++;

  // Nearest orb within reach. The orb is the disc inscribed in its element.
  let best: Instance | null = null;
  let u = 0;
  if (!Number.isNaN(px) && swapAllowed()) {
    let bestEdge = Number.POSITIVE_INFINITY;
    for (const inst of instances) {
      if (!inst.el.isConnected) continue;
      const r = inst.el.getBoundingClientRect();
      if (r.width <= 0) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const orbR = Math.min(r.width, r.height) / 2;
      const reach = effective(inst).reach;
      if (px < cx - orbR - reach || px > cx + orbR + reach || py < cy - orbR - reach || py > cy + orbR + reach) continue;
      const edge = Math.hypot(px - cx, py - cy) - orbR;
      if (edge <= reach && edge < bestEdge) {
        bestEdge = edge; best = inst;
        _c.cx = cx; _c.cy = cy; _c.r = orbR;
      }
    }
    if (best) {
      const t = 1 - Math.max(0, bestEdge) / effective(best).reach;
      u = t * t * (3 - 2 * t);
      lastReach = now;
    }
  }

  // Envelope on the proximity weight — no pops on enter/leave/jump.
  const nearest = near ?? best;
  const fade = nearest ? effective(nearest).fadeMs : GRAVITY_DEFAULTS.fadeMs;
  const a = 1 - Math.exp(-(dt * 1000) / (fade / 3));
  uS += (u - uS) * a;

  if (best && best !== near) near = best;
  if (!best && uS < 0.002) {
    uS = 0;
    if (near && hiding && !releasePending && pointerIsMouse && !typing && !Number.isNaN(px)) {
      if (now - lastReach < LINGER_MS) {
        // Linger: plain sprite at the pointer, swap kept, so a nearby orb
        // can take over without the cursor changing hands.
        if (claimCursor(px, py)) drawCursor(near, 0, dt);
        else hideSprite();
        raf = requestAnimationFrame(step);
        return;
      }
      if (curShown) {
        // Give the OS pointer back, but leave the sprite up until the move
        // that repaints it — otherwise there is no cursor for a frame.
        releaseCursor();
        releasePending = true;
        near = null;
        return;
      }
    }
    near = null;
    hideCursor();
    return;
  }
  if (!near) return;

  if (uS > 0.002 && pointerIsMouse && !typing && !Number.isNaN(px) && ensureCursor() && claimCursor(px, py)) {
    // A claim made on this very move: the OS pointer is still painted
    // until the next move, so hold the sprite for that move rather than
    // draw two pointers — but never longer than two frames, or a pointer
    // that stops right after crossing an edge would have no cursor at all.
    const holding = claimMove === moveSeq && stepSeq - claimStep < 2 && !curShown;
    if (holding) hideSprite();
    else drawCursor(near, uS, dt);
  } else if (uS > 0.002 && !Number.isNaN(px) && pointerIsMouse && !typing) {
    // Over something with its own cursor (a button): the rule is lifted and
    // the sprite hidden; the OS pointer shows the hand there.
    hideSprite();
  } else {
    hideCursor();
  }

  raf = requestAnimationFrame(step);
}
