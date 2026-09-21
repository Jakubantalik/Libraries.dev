/**
 * The liquid bend, driven by the phone's tilt (Reanimated's gravity sensor,
 * UI thread). The web's `useMetalBend` field: a directional gaussian dent
 * chasing a spring target plus a divergent "liquid" push at the contact
 * point; tilting the phone plays the pointer — the ring sags toward the low
 * edge, from the outline point in the tilt direction.
 */
import { useEffect, useMemo } from 'react';
import {
  SensorType,
  useAnimatedSensor,
  useFrameCallback,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { boundaryPoint, type Pt } from './geometry';

export interface BendConfig {
  enabled: boolean;
  strength: number;
  blob: number;
  liquidBlob: number;
  maxDisp: number;
  liquid: number;
  stiffness: number;
  damping: number;
  mass: number;
  liquidStiffness: number;
  liquidDamping: number;
  follow: number;
  smoothMs: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Tilt (fraction of g on the screen plane) at which the dent is full. */
  tiltRange: number;
  tiltDeadzone: number;
}

export const BEND_DEFAULTS: BendConfig = {
  enabled: true,
  strength: 0.74,
  blob: 13,
  liquidBlob: 10,
  maxDisp: 9,
  liquid: 7.5,
  stiffness: 260,
  damping: 13,
  mass: 1,
  liquidStiffness: 53,
  liquidDamping: 9,
  follow: 0.32,
  smoothMs: 140,
  fadeInMs: 200,
  fadeOutMs: 350,
  tiltRange: 0.45,
  tiltDeadzone: 0.025,
};

export interface BendField {
  cx: number; cy: number;
  dirX: number; dirY: number;
  radK: number;
  s2b: number; s2l: number;
  reach: number;
}

export function deformPoint(f: BendField, x: number, y: number): Pt {
  'worklet';
  const dx = x - f.cx, dy = y - f.cy;
  const q = dx * dx + dy * dy;
  const gb = Math.exp(-q / f.s2b);
  const gl = Math.exp(-q / f.s2l);
  return { x: x + f.dirX * gb + dx * f.radK * gl, y: y + f.dirY * gb + dy * f.radK * gl };
}

function ss(e0: number, e1: number, x: number): number {
  'worklet';
  const t = Math.min(1, Math.max(0, (x - e0) / Math.max(1e-9, e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Manual tilt (x right, y down, in g) for tests and the simulator; null = sensor. */
export const tiltOverride: SharedValue<{ dx: number; dy: number } | null> | null = null;

interface TiltState { bx: number; by: number; has: boolean; last: number }

/**
 * Screen-plane tilt relative to a slowly adapting baseline, so a tilt reads
 * as a gesture and the resting pose settles back to neutral.
 */
export function useTilt(enabled: boolean, override?: SharedValue<{ dx: number; dy: number } | null>): SharedValue<{ dx: number; dy: number }> {
  const gravity = useAnimatedSensor(SensorType.GRAVITY, { interval: 16 });
  const tilt = useSharedValue({ dx: 0, dy: 0 });
  const state = useSharedValue<TiltState>({ bx: 0, by: 0, has: false, last: 0 });
  const baselineSeconds = 4;
  useFrameCallback((info) => {
    'worklet';
    const o = override?.value;
    if (o) { tilt.value = o; return; }
    if (!enabled) { tilt.value = { dx: 0, dy: 0 }; return; }
    const g = gravity.sensor.value;
    // Device axes: x right, y up (toward the top edge). Portrait mapping.
    const sx = g.x, sy = -g.y;
    const now = info.timestamp / 1000;
    const st = state.value;
    const dt = st.last > 0 ? Math.min(0.1, Math.max(0.001, now - st.last)) : 1 / 60;
    if (!st.has) { state.value = { bx: sx, by: sy, has: true, last: now }; tilt.value = { dx: 0, dy: 0 }; return; }
    const k = 1 - Math.exp(-dt / baselineSeconds);
    const bx = st.bx + (sx - st.bx) * k, by = st.by + (sy - st.by) * k;
    state.value = { bx, by, has: true, last: now };
    tilt.value = { dx: sx - bx, dy: sy - by };
  }, enabled);
  return tilt;
}

interface SimState {
  cx: number; cy: number; ax: number; ay: number; vax: number; vay: number;
  la: number; vla: number; stx: number; sty: number; stl: number; env: number;
  active: boolean; last: number;
}

/**
 * Per-instance bend simulation on the UI thread. `size` and `radius` are
 * shared values from the host's layout; `field` is null while idle.
 */
export function useBendField(
  tilt: SharedValue<{ dx: number; dy: number }>,
  size: SharedValue<{ width: number; height: number }>,
  radius: SharedValue<number>,
  cfg: BendConfig,
  enabled: boolean
): SharedValue<BendField | null> {
  const field = useSharedValue<BendField | null>(null);
  const sim = useSharedValue<SimState>({ cx: 0, cy: 0, ax: 0, ay: 0, vax: 0, vay: 0, la: 0, vla: 0, stx: 0, sty: 0, stl: 0, env: 0, active: false, last: 0 });
  const c = useMemo(() => ({ ...cfg }), [cfg]);
  useFrameCallback((info) => {
    'worklet';
    const now = info.timestamp / 1000;
    const s = { ...sim.value };
    const dt = s.last > 0 ? Math.min(0.032, Math.max(0.001, now - s.last)) : 1 / 60;
    s.last = now;
    const { width: W, height: H } = size.value;
    const t = tilt.value;
    let tx = 0, ty = 0, tl = 0;
    const mag = Math.hypot(t.dx, t.dy);
    const m = ss(c.tiltDeadzone, c.tiltRange, mag);
    if (c.enabled && m > 0.0005 && W > 0) {
      const ux = t.dx / mag, uy = t.dy / mag;
      const contact = boundaryPoint(W, H, radius.value, t.dx, t.dy);
      if (!s.active) { s.cx = contact.x; s.cy = contact.y; s.active = true; }
      const fa = 1 - Math.pow(1 - Math.min(0.999, c.follow), dt * 60);
      s.cx += (contact.x - s.cx) * fa;
      s.cy += (contact.y - s.cy) * fa;
      tx = ux * m * c.maxDisp; ty = uy * m * c.maxDisp;
      tl = c.liquid * m;
    } else {
      s.active = false;
    }
    const sa = 1 - Math.exp(-(dt * 1000) / Math.max(1, c.smoothMs));
    s.stx += (tx - s.stx) * sa; s.sty += (ty - s.sty) * sa;
    const mass = Math.max(0.05, c.mass);
    s.vax += ((-c.stiffness * (s.ax - s.stx) - c.damping * s.vax) / mass) * dt;
    s.vay += ((-c.stiffness * (s.ay - s.sty) - c.damping * s.vay) / mass) * dt;
    s.ax += s.vax * dt; s.ay += s.vay * dt;
    s.stl += (tl - s.stl) * sa;
    s.vla += ((-c.liquidStiffness * (s.la - s.stl) - c.liquidDamping * s.vla) / mass) * dt;
    s.la += s.vla * dt;
    const envTarget = s.active && c.enabled ? 1 : 0;
    const tauMs = Math.max(1, envTarget ? c.fadeInMs : c.fadeOutMs) / 3;
    s.env += (envTarget - s.env) * (1 - Math.exp(-(dt * 1000) / tauMs));
    if (s.env < 0.002 && envTarget === 0) s.env = 0;
    const amp = Math.hypot(s.ax, s.ay);
    const idle = !s.active && s.env === 0 && amp < 0.05 && Math.hypot(s.vax, s.vay) < 1 && Math.abs(s.la) < 0.05;
    if (idle) {
      s.ax = 0; s.ay = 0; s.vax = 0; s.vay = 0; s.la = 0; s.vla = 0; s.stx = 0; s.sty = 0; s.stl = 0;
      sim.value = s;
      if (field.value !== null) field.value = null;
      return;
    }
    const k = Math.max(0, c.strength) * s.env;
    const sb = Math.max(0.5, c.blob), sl = Math.max(0.5, c.liquidBlob);
    sim.value = s;
    field.value = {
      cx: s.cx, cy: s.cy, dirX: s.ax * k, dirY: s.ay * k, radK: (s.la / sl) * k,
      s2b: 2 * sb * sb, s2l: 2 * sl * sl,
      reach: Math.ceil((c.maxDisp + c.liquid * 1.5) * Math.max(1, c.strength)) + 4,
    };
  }, enabled);
  useEffect(() => { if (!enabled) field.value = null; }, [enabled, field]);
  return field;
}
