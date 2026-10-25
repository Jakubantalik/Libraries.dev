/* React bindings: one shared bridge per page, its state and readings as
   hooks, the Magnetic UI pull for any elements you mark, and a ready-made
   calibration screen. */

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { MagnetBridge, type MagnetFrame, type MagnetGesture, type Pt } from "./bridge";
import { calibrate, type CalibrationState } from "./calibration";
import { MagneticField, type Box } from "./field";

let shared: MagnetBridge | null = null;
/** The page's bridge. Nothing connects until you call `connect()`. */
export function getMagnetBridge(): MagnetBridge {
  return (shared ??= new MagnetBridge());
}

/** Connection state, device and calibration; re-renders when they change. */
export function useMagnetBridge() {
  const bridge = getMagnetBridge();
  const version = useSyncExternalStore(
    (cb) => bridge.addStateListener(cb),
    () => `${bridge.state}|${bridge.device}|${bridge.hello?.grabStage ?? ""}|${bridge.hello?.face ?? ""}`,
    () => "idle||",
  );
  return {
    bridge,
    state: bridge.state,
    device: bridge.device,
    calibrated: bridge.hello?.grabStage === 2,
    connect: () => bridge.connect(),
    key: version,
  };
}

/** Every reading, without re-rendering (~50 a second). */
export function useMagnetFrame(cb: (f: MagnetFrame) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => getMagnetBridge().addFrameListener((f) => ref.current(f)), []);
}

/** The latest reading as state, at most one render per animation frame. */
export function useMagnet(): MagnetFrame | null {
  const [frame, setFrame] = useState<MagnetFrame | null>(getMagnetBridge().frame);
  useEffect(() => {
    let raf = 0;
    let pending: MagnetFrame | null = null;
    const off = getMagnetBridge().addFrameListener((f) => {
      pending = f;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setFrame(pending); });
    });
    return () => { off(); cancelAnimationFrame(raf); };
  }, []);
  return frame;
}

/** Air taps, pushes, pull-aways and swipes. */
export function useMagnetGestures(cb: (g: MagnetGesture) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => getMagnetBridge().addGestureListener((g) => ref.current(g)), []);
}

export type MagneticPullOptions = {
  /** Which elements inside the container move. Default `[data-magnetic]`. */
  selector?: string;
  enabled?: boolean;
  /** Tuning, as MagneticField's: spring stiffness, damping, force, reach (px). */
  stiffness?: number;
  damping?: number;
  force?: number;
  reach?: number;
};

/**
 * The Magnetic UI pull: elements matching `selector` inside the container
 * are springs to their place, pulled toward a magnet held beside the phone,
 * and they come back when it leaves. Off with reduced motion.
 */
export function useMagneticPull(container: RefObject<HTMLElement>, opts: MagneticPullOptions = {}) {
  const { selector = "[data-magnetic]", enabled = true } = opts;
  useEffect(() => {
    const root = container.current;
    if (!root || !enabled) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const bridge = getMagnetBridge();
    const field = new MagneticField();
    field.screenCorner = 24;
    if (opts.stiffness != null) field.stiffness = opts.stiffness;
    if (opts.damping != null) field.damping = opts.damping;
    if (opts.force != null) field.force = opts.force;
    if (opts.reach != null) field.reach = opts.reach;

    type Body = { id: string; el: HTMLElement; box: Box; corner: number };
    let bodies: Body[] = [];
    const measure = () => {
      bodies.forEach((b) => (b.el.style.transform = ""));
      bodies = [...root.querySelectorAll<HTMLElement>(selector)]
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el, i) => {
          if (getComputedStyle(el).display === "inline") el.style.display = "inline-block";
          const r = el.getBoundingClientRect();
          return {
            id: String(i), el,
            box: { left: r.left + scrollX, top: r.top + scrollY, right: r.right + scrollX, bottom: r.bottom + scrollY },
            corner: parseFloat(getComputedStyle(el).borderTopLeftRadius) || 6,
          };
        });
      field.parts.clear();
    };
    measure();
    const onResize = () => measure();
    addEventListener("resize", onResize);

    let raf = 0;
    const tick = () => {
      const now = performance.now() / 1000;
      const o = bridge.offset();
      for (const b of bodies) {
        field.setHome(b.id, {
          left: b.box.left - scrollX + o.x, top: b.box.top - scrollY + o.y,
          right: b.box.right - scrollX + o.x, bottom: b.box.bottom - scrollY + o.y,
        }, b.corner);
      }
      const f = bridge.frame;
      const screenBox: Box = { left: o.x, top: o.y, right: o.x + innerWidth, bottom: o.y + innerHeight };
      if (f) field.step(f, now, screenBox, bridge.hello?.face ?? 1);
      else field.relax(now);
      for (const b of bodies) {
        const p = field.parts.get(b.id);
        if (!p) continue;
        b.el.style.transform = p.resting ? "" : `translate(${p.ox.toFixed(2)}px, ${p.oy.toFixed(2)}px) rotate(${p.angle.toFixed(4)}rad)`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", onResize);
      bodies.forEach((b) => (b.el.style.transform = ""));
    };
  }, [container, selector, enabled, opts.stiffness, opts.damping, opts.force, opts.reach]);
}

/** A ready-made calibration screen: five rings, full screen, cancel button. */
export function MagnetCalibration({ open, onClose }: { open: boolean; onClose?: (ok: boolean) => void }) {
  const [s, setS] = useState<CalibrationState | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const cancelRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!open) return;
    const run = calibrate(getMagnetBridge(), { onUpdate: setS });
    cancelRef.current = run.cancel;
    run.promise.then((fit) => closeRef.current?.(!!fit));
    return () => run.cancel();
  }, [open]);
  if (!open || !s || s.phase === "done" || s.phase === "cancelled") return null;
  const msg =
    s.phase === "zeroing" ? "Keep the magnet away for a moment…"
    : s.phase === "failed" ? "That didn't fit. Try again, holding the magnet still over each ring."
    : `Ring ${s.index + 1} of ${s.total}: hold the magnet 1–2 cm above it and keep it still.`;
  const diag = s.field == null ? "No readings from the bridge. Open Magnet Bridge and tap Start bridge." : `${s.field.toFixed(0)} µT${s.zeroing ? " · zeroing" : ""}`;
  const spot = s.spot;
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2147483000, background: "rgba(0,0,0,0.94)", color: "#fff", font: "500 16px/24px system-ui, sans-serif", touchAction: "none" }}>
      {spot && (
        <div style={{ position: "absolute", left: spot.x, top: spot.y, width: 72, height: 72, margin: -36, borderRadius: "50%", boxShadow: "inset 0 0 0 3px #fff" }}>
          <i style={{ position: "absolute", inset: 10, borderRadius: "50%", background: "#4f9cff", transform: `scale(${s.progress.toFixed(3)})` }} />
        </div>
      )}
      <p style={{ position: "absolute", left: 16, right: 16, top: spot ? (spot.y < innerHeight / 2 ? spot.y + 64 : spot.y - 120) : "40%", margin: 0, textAlign: "center" }}>{msg}</p>
      <p style={{ position: "absolute", left: 16, right: 16, bottom: 88, margin: 0, textAlign: "center", font: "400 13px/18px system-ui, sans-serif", color: "#9a9a9a" }}>{diag}</p>
      <button type="button" onClick={() => cancelRef.current()} style={{ position: "absolute", left: "50%", bottom: 32, transform: "translateX(-50%)", height: 40, padding: "0 18px", border: 0, borderRadius: 999, background: "#2a2a2a", color: "#fff", font: "500 14px/1 system-ui, sans-serif" }}>
        Cancel
      </button>
    </div>
  );
}

/**
 * Desktop development without a phone: the pointer plays the magnet. Press
 * and hold to bring it in, release to take it away. Returns a stop function.
 */
export function simulateMagnetWithPointer(bridge: MagnetBridge = getMagnetBridge()) {
  let held = false;
  let at: Pt = { x: 0, y: 0 };
  const realOffset = bridge.offset.bind(bridge);
  bridge.offset = () => ({ x: 0, y: 0 });
  const down = (e: PointerEvent) => { held = true; at = { x: e.clientX, y: e.clientY }; };
  const move = (e: PointerEvent) => { at = { x: e.clientX, y: e.clientY }; };
  const up = () => { held = false; };
  addEventListener("pointerdown", down);
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
  const timer = window.setInterval(() => {
    bridge.frame = {
      t: performance.now(), pos: held ? at : null, spread: 20, height: null, presence: 1, pull: held ? 0.8 : 0,
      strength: held ? 80 : 0, delta: held ? [0, 0, -40] : [0, 0, 0], tooClose: false, calibrating: false,
    };
  }, 20);
  return () => {
    clearInterval(timer);
    removeEventListener("pointerdown", down);
    removeEventListener("pointermove", move);
    removeEventListener("pointerup", up);
    bridge.offset = realOffset;
  };
}
