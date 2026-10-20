/* Magnet Bridge client: the Android app that runs the magnet model on the
   phone and serves its answers on ws://127.0.0.1:47613 (Chrome's own
   Magnetometer API cannot be switched on). Positions arrive in screen dp,
   which on Android Chrome are CSS px; the page's own coordinates are offset
   by the browser's bars above the viewport. */

export type Pt = { x: number; y: number };

export type MagnetFrame = {
  t: number;
  /** Where the magnet is, screen dp (null while the locator is unsure). */
  pos: Pt | null;
  spread: number;
  height: number | null;
  presence: number;
  pull: number;
  strength: number;
  /** Field change from the zero, µT, device axes (x right, y up, z out of the screen). */
  delta: [number, number, number];
  tooClose: boolean;
  calibrating: boolean;
};

export type MagnetGesture =
  | { g: "tap"; at: Pt | null }
  | { g: "push" | "pullAway"; speed: number }
  | { g: "swipe"; dir: Pt; speed: number };

export type ModelHello = {
  screenDp: [number, number];
  grabStage: number;
  face: number | null;
  strength: number | null;
  sensorDp: [number, number];
  model: boolean;
};

const URL = "ws://127.0.0.1:47613";

export class MagnetBridge {
  frame: MagnetFrame | null = null;
  hello: ModelHello | null = null;
  device = "";
  state: "idle" | "connecting" | "open" | "failed" = "idle";
  onFrame: ((f: MagnetFrame) => void) | null = null;
  onGesture: ((g: MagnetGesture) => void) | null = null;
  onState: (() => void) | null = null;
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
    this.onState?.();
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
    } else if (d.type === "gesture") {
      this.onGesture?.(d.g === "tap" ? { g: "tap", at: d.at ? { x: d.at[0], y: d.at[1] } : null } : d);
    } else if (d.type === "model-hello") {
      this.hello = d;
      this.onState?.();
    } else if (d.type === "hello") {
      this.device = `${d.manufacturer} ${d.model}`;
      this.onState?.();
    }
  }
}

/* ── Calibration ───────────────────────────────────────────────────────
   The magnet held still over a few known spots. One magnetometer gives
   three numbers per spot; a dipole whose axis points at the screen,
   seen from the sensor, explains them with four unknowns: which face is
   toward the phone, its strength, where the sensor sits, and how high
   the magnet was held. A grid over those, the strength solved in closed
   form, picks the best fit. */

export type CalibrationSpot = { screen: Pt; delta: [number, number, number] };
export type CalibrationFit = { face: 1 | -1; strength: number; sensor: Pt; height: number; error: number };

const PPCM = 160 / 2.54;

function unitField(offX: number, offY: number, h: number, face: number): [number, number, number] {
  // Field at the sensor from a unit dipole (moment along ±z) at (offX, offY, h) cm.
  const r = Math.hypot(offX, offY, h);
  const rx = -offX / r, ry = -offY / r, rz = -h / r;
  const mDotR = face * rz;
  const k = 1 / (r * r * r);
  return [k * 3 * mDotR * rx, k * 3 * mDotR * ry, k * (3 * mDotR * rz - face)];
}

export function fitCalibration(spots: CalibrationSpot[], screenDp: Pt): CalibrationFit | null {
  if (spots.length < 3) return null;
  const norm = spots.reduce((a, s) => a + s.delta[0] ** 2 + s.delta[1] ** 2 + s.delta[2] ** 2, 0);
  let best: CalibrationFit | null = null;
  for (const face of [1, -1] as const) {
    for (let sx = 0; sx <= screenDp.x; sx += 8) {
      for (let sy = -30; sy <= screenDp.y * 0.5; sy += 8) {
        for (let h = 0.6; h <= 5.01; h += 0.2) {
          let bg = 0, gg = 0;
          const gs = spots.map((s) => {
            const g = unitField((s.screen.x - sx) / PPCM, -(s.screen.y - sy) / PPCM, h, face);
            bg += g[0] * s.delta[0] + g[1] * s.delta[1] + g[2] * s.delta[2];
            gg += g[0] * g[0] + g[1] * g[1] + g[2] * g[2];
            return g;
          });
          const k = bg / gg;
          if (!(k > 0)) continue;
          let err = 0;
          spots.forEach((s, i) => {
            const g = gs[i];
            err += (s.delta[0] - k * g[0]) ** 2 + (s.delta[1] - k * g[1]) ** 2 + (s.delta[2] - k * g[2]) ** 2;
          });
          err /= norm;
          if (!best || err < best.error) best = { face, strength: k, sensor: { x: sx, y: sy }, height: h, error: err };
        }
      }
    }
  }
  return best;
}
