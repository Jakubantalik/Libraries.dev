/* One animation frame loop for every avatar on the screen, on the JS
   thread, where the rig lives. Each frame every subscribed avatar advances
   its sim (microseconds) and writes its packet into one flat array; the
   array is handed to the UI thread once, as a shared value, and the
   avatars' pictures are recorded from it there. The loop stops while the
   app is in the background and while nobody is subscribed. */

import { AppState } from 'react-native';
import { makeMutable } from 'react-native-reanimated';
import { botAvatarCapFrame, type BotAvatarPose } from 'bot-avatars';
import { PK, STRIDE } from './packet';

/** every avatar's packet, `STRIDE` floats each, by slot: one ArrayBuffer
    of float32s per frame — a buffer crosses to the UI runtime as one
    copy, where an array of numbers is cloned element by element */
export const packed = makeMutable<ArrayBuffer>(new ArrayBuffer(0));

let buf = new Float32Array(0);
let slots = 0;
const free: number[] = [];

export function acquireSlot(): number {
  const s = free.length ? free.pop()! : slots++;
  if (buf.length < slots * STRIDE) {
    const next = new Float32Array(Math.max(slots, 8) * STRIDE);
    next.set(buf);
    buf = next;
  }
  return s;
}
export function releaseSlot(s: number) {
  free.push(s);
}

type Tick = (dt: number, buf: Float32Array, off: number) => void;
const subs = new Map<number, Tick>();
let raf = 0;
let last = 0;
let awake = true;

/** JS-thread cost of the loop: frames counted, milliseconds spent, avatar-frames advanced */
export const jsStats = { frames: 0, ms: 0, avatars: 0, flushMs: 0 };

const now = (): number => {
  const g = globalThis as unknown as { performance?: { now(): number } };
  return g.performance ? g.performance.now() : Date.now();
};

function flush() {
  packed.value = buf.buffer.slice(0, slots * STRIDE * 4);
}

function frame(t: number) {
  raf = 0;
  const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
  last = t;
  const t0 = now();
  subs.forEach((fn, slot) => fn(dt, buf, slot * STRIDE));
  const t1 = now();
  flush();
  const t2 = now();
  jsStats.ms += t1 - t0;
  jsStats.flushMs += t2 - t1;
  jsStats.frames++;
  jsStats.avatars += subs.size;
  if (subs.size && awake) raf = requestAnimationFrame(frame);
}

function start() {
  if (raf || !awake) return;
  last = 0;
  raf = requestAnimationFrame(frame);
}
function stop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  AppState.addEventListener('change', (s) => {
    awake = s === 'active';
    if (awake) {
      if (subs.size) start();
    } else stop();
  });
}

export function subscribe(slot: number, fn: Tick): () => void {
  wire();
  subs.set(slot, fn);
  start();
  return () => {
    subs.delete(slot);
    if (!subs.size) stop();
  };
}

/** Write a packet outside the loop (a still avatar, a first paint) and hand it over. */
export function pushStill(slot: number, write: (buf: Float32Array, off: number) => void) {
  write(buf, slot * STRIDE);
  flush();
}

/* edge-on, every slice would thin to a line and the stack would show
   gaps; a floor on the foreshortening keeps it a solid */
const floor = (v: number) => (Math.abs(v) < 0.22 ? (v < 0 ? -0.22 : 0.22) : v);

/**
 * Pack a pose, and in `plastic` the cap's lighting frame for it, into the
 * packet at `off`.
 */
export function packPose(buf: Float32Array, off: number, pose: BotAvatarPose, plastic: boolean, halfDepth: number, cap: number, lx: number, ly: number, dev: number) {
  buf[off + PK.yaw] = pose.yaw;
  buf[off + PK.pitch] = pose.pitch;
  buf[off + PK.roll] = pose.roll;
  buf[off + PK.x] = pose.x;
  buf[off + PK.y] = pose.y;
  buf[off + PK.sx] = pose.sx;
  buf[off + PK.sy] = pose.sy;
  buf[off + PK.eyeOpen] = pose.eyeOpen;
  buf[off + PK.blinkL] = pose.blinkL;
  buf[off + PK.blinkR] = pose.blinkR;
  buf[off + PK.lookX] = pose.lookX;
  buf[off + PK.lookY] = pose.lookY;
  buf[off + PK.breath] = pose.breath;
  buf[off + PK.laugh] = pose.laugh;
  buf[off + PK.whirl] = pose.whirl;
  buf[off + PK.whirlAngle] = pose.whirlAngle;
  buf[off + PK.w0] = pose.w[0];
  buf[off + PK.w1] = pose.w[1];
  buf[off + PK.w2] = pose.w[2];
  if (!plastic) return;
  const cy0 = Math.cos(pose.yaw), sy = Math.sin(pose.yaw);
  const cp0 = Math.cos(pose.pitch), sp = Math.sin(pose.pitch);
  const f = botAvatarCapFrame({ cy: floor(cy0), sy, cp: floor(cp0), sp, facing: cy0 * cp0, roll: pose.roll, halfDepth, cap, lx, ly, dev, ctm: [1, 0, 0, 1, 0, 0] });
  let i = off + PK.frame;
  const vs = [f.L, f.V, f.H, f.U, f.W, f.A, f.B];
  for (let k = 0; k < 7; k++) {
    const v = vs[k];
    buf[i++] = v[0];
    buf[i++] = v[1];
    buf[i++] = v[2];
  }
}
