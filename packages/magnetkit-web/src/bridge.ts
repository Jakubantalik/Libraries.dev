/* Magnet Bridge client: the Android app that runs the magnet model on the
   phone and serves its answers on ws://127.0.0.1:47613 (Chrome's own
   Magnetometer API cannot be switched on). Positions arrive in screen dp,
   which on Android Chrome are CSS px; the page's own coordinates are offset
   by the browser's bars above the viewport. */

import type { MagnetFrame, MagnetGesture, ModelHello, Pt } from "./types";

export type { MagnetFrame, MagnetGesture, ModelHello, Pt } from "./types";
export { fitCalibration, type CalibrationFit, type CalibrationSpot } from "./fit";

const URL = "ws://127.0.0.1:47613";

export class MagnetBridge {
  frame: MagnetFrame | null = null;
  hello: ModelHello | null = null;
  device = "";
  /** The app's protocol version (0.5 sends to each page on its own). */
  version = 0;
  state: "idle" | "connecting" | "open" | "failed" = "idle";
  onFrame: ((f: MagnetFrame) => void) | null = null;
  onGesture: ((g: MagnetGesture) => void) | null = null;
  onState: (() => void) | null = null;
  private frameListeners = new Set<(f: MagnetFrame) => void>();
  private gestureListeners = new Set<(g: MagnetGesture) => void>();
  private stateListeners = new Set<() => void>();

  /** Every reading (~50 a second). Returns an unsubscribe function. */
  addFrameListener(l: (f: MagnetFrame) => void) { this.frameListeners.add(l); return () => { this.frameListeners.delete(l); }; }
  /** Air taps, pushes, pull-aways and swipes. Returns an unsubscribe function. */
  addGestureListener(l: (g: MagnetGesture) => void) { this.gestureListeners.add(l); return () => { this.gestureListeners.delete(l); }; }
  /** Connection state, device and calibration changes. Returns an unsubscribe function. */
  addStateListener(l: () => void) { this.stateListeners.add(l); return () => { this.stateListeners.delete(l); }; }

  /** Take a new zero on the phone (keep magnets away for a second). */
  zero() { this.send({ type: "calibrate" }); }
  /** Hand the phone a fitted calibration (see fitCalibration). */
  setMagnet(fit: { face: 1 | -1; strength: number; sensor: Pt }) {
    this.send({ type: "set-magnet", face: fit.face, strength: fit.strength, sensor: [fit.sensor.x, fit.sensor.y] });
  }
  private ws: WebSocket | null = null;
  private touchOffset: Pt | null = null;

  constructor() {
    // The exact offset of the page on the screen, from any touch.
    addEventListener(
      "touchstart",
      (e) => {
        const t = e.touches[0];
        if (t) this.touchOffset = { x: t.screenX - t.clientX, y: t.screenY - t.clientY };
      },
      { passive: true },
    );
  }

  connect(): Promise<boolean> {
    if (this.state === "open" || this.state === "connecting") return Promise.resolve(this.state === "open");
    this.set("connecting");
    return new Promise((resolve) => {
      let settled = false;
      const done = (ok: boolean) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      let ws: WebSocket;
      try {
        ws = new WebSocket(URL);
      } catch {
        this.set("failed");
        return done(false);
      }
      this.ws = ws;
      ws.onopen = () => {
        this.set("open");
        done(true);
      };
      ws.onclose = () => {
        this.ws = null;
        this.frame = null;
        this.set("failed");
        done(false);
      };
      ws.onmessage = (m) => this.receive(String(m.data));
    });
  }

  send(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  /** Screen dp → client px. The viewport runs to the bottom of the screen on
   *  Android Chrome, so the bars above it are what is left of the screen. */
  offset(): Pt {
    return this.touchOffset ?? { x: 0, y: Math.max(0, screen.height - innerHeight) };
  }

  toClient(p: Pt): Pt {
    const o = this.offset();
    return { x: p.x - o.x, y: p.y - o.y };
  }

  toScreen(p: Pt): Pt {
    const o = this.offset();
    return { x: p.x + o.x, y: p.y + o.y };
  }

  private set(s: MagnetBridge["state"]) {
    this.state = s;
    this.emitState();
  }

  private emitState() {
    this.onState?.();
    this.stateListeners.forEach((l) => l());
  }

  private receive(text: string) {
    let d: any;
    try {
      d = JSON.parse(text);
    } catch {
      return;
    }
    if (d.type === "m") {
      const f: MagnetFrame = {
        t: d.t,
        pos: d.pos ? { x: d.pos[0], y: d.pos[1] } : null,
        spread: d.sp ?? 0,
        height: d.h ?? null,
        presence: d.p ?? 1,
        pull: d.pull ?? 0,
        strength: d.s ?? 0,
        delta: d.d ?? [0, 0, 0],
        tooClose: !!d.tc,
        calibrating: !!d.cal,
      };
      this.frame = f;
      this.onFrame?.(f);
      this.frameListeners.forEach((l) => l(f));
    } else if (d.type === "gesture") {
      const g: MagnetGesture = d.g === "tap" ? { g: "tap", at: d.at ? { x: d.at[0], y: d.at[1] } : null } : d;
      this.onGesture?.(g);
      this.gestureListeners.forEach((l) => l(g));
    } else if (d.type === "model-hello") {
      this.hello = d;
      this.emitState();
    } else if (d.type === "hello") {
      this.device = `${d.manufacturer} ${d.model}`;
      this.version = Number(d.version) || 0;
      this.emitState();
    }
  }
}
