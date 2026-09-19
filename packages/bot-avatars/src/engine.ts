/* The rig. A pose is a handful of numbers — head yaw / pitch / roll, a
   position, squash, how open the eyes are, where they look — and blend
   weights for the four states. A Sim advances a pose through time: each
   state sets targets and wanders around them, runs its own events (a
   flip, a hop, a nod, a blink), and everything is smoothed, so a state
   change is a cross-animation from wherever the avatar was. */

import type { BotAvatarState } from './types';

export const STATES: BotAvatarState[] = ['default', 'thinking', 'happy', 'sleeping'];

export interface Pose {
  /** radians; yaw > 0 turns the face to the viewer's right, pitch > 0 looks up */
  yaw: number;
  pitch: number;
  roll: number;
  /** body-box units (the 100×100 design space) */
  x: number;
  y: number;
  sx: number;
  sy: number;
  /** 0 shut … 1 open, before blinks */
  eyeOpen: number;
  /** how far each lid is down right now, 0 … 1 — a wink closes one */
  blinkL: number;
  blinkR: number;
  lookX: number;
  lookY: number;
  /** the breathing cycle, −1 … 1 */
  breath: number;
  /** happy only: how far the eyes have closed into a laugh, 0 … 1 */
  laugh: number;
  /** blend weights: default, thinking, happy, sleeping — they sum to 1 */
  w: [number, number, number, number];
}

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/* Deterministic per-instance randomness (mulberry32). */
function rng(seed: number): () => number {
  let a = (seed * 0x9e3779b1) >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Exponential approach: `rate` per second, frame-rate independent. */
function approach(cur: number, target: number, rate: number, dt: number): number {
  return cur + (target - cur) * (1 - Math.exp(-rate * dt));
}

const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
/* A value that drifts: picks a new target inside its range every hold,
   and eases toward it. Ranges change with the state; the value never
   jumps. */
class Wander {
  value = 0;
  private target = 0;
  private next = 0;
  constructor(
    private rand: () => number,
    public amp: number,
    public holdMin: number,
    public holdMax: number,
    public rate: number
  ) {}
  update(t: number, dt: number) {
    if (t >= this.next) {
      this.target = (this.rand() * 2 - 1) * this.amp;
      this.next = t + this.holdMin + this.rand() * (this.holdMax - this.holdMin);
    }
    this.value = approach(this.value, this.target, this.rate, dt);
  }
  set(amp: number, holdMin: number, holdMax: number, rate: number) {
    this.amp = amp;
    this.holdMin = holdMin;
    this.holdMax = holdMax;
    this.rate = rate;
    this.next = 0;
  }
}

/* A one-shot event: progress 0 → 1 over its duration, then idle at -1. */
class Event {
  p = -1;
  constructor(public duration: number) {}
  fire() {
    this.p = 0;
  }
  get active() {
    return this.p >= 0;
  }
  update(dt: number) {
    if (this.p < 0) return;
    this.p += dt / this.duration;
    if (this.p >= 1) this.p = -1;
  }
}

/* Resting targets per state. Everything the wanderers and events add sits
   on top of these. */
interface Rest {
  pitch: number;
  roll: number;
  y: number;
  eyeOpen: number;
  lookX: number;
  lookY: number;
}
const REST: Record<BotAvatarState, Rest> = {
  default: { pitch: 0, roll: 0, y: 0, eyeOpen: 1, lookX: 0, lookY: 0 },
  thinking: { pitch: 10 * DEG, roll: -9 * DEG, y: 0, eyeOpen: 0.82, lookX: 0, lookY: -2.6 },
  happy: { pitch: 5 * DEG, roll: 0, y: 0, eyeOpen: 1, lookX: 0, lookY: 0 },
  sleeping: { pitch: -16 * DEG, roll: 6 * DEG, y: 3, eyeOpen: 0, lookX: 0, lookY: 1 },
};

export class Sim {
  readonly pose: Pose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, sx: 1, sy: 1, eyeOpen: 1, blinkL: 0, blinkR: 0, lookX: 0, lookY: 0, breath: 0, laugh: 0, w: [1, 0, 0, 0] };
  state: BotAvatarState = 'default';

  private rand: () => number;
  private t = 0;
  /* time since the state was set — the choreographies count from it */
  private st = 0;
  private yawW: Wander;
  private pitchW: Wander;
  private rollW: Wander;
  private lookXW: Wander;
  private lookYW: Wander;
  private blink = new Event(0.17);
  private blinkAt: number;
  private blinkAgain = false;
  /* −1 left eye only, 1 right eye only, 0 both */
  private wink = 0;
  private dart = new Event(0.12);
  private dartAt: number;
  private dartX = 0;
  private dartY = 0;
  private flip = new Event(0.9);
  private flipAt: number;
  private nod = new Event(1.7);
  private nodAt: number;
  private hmm = new Event(1.5);
  private hmmAt: number;
  private squint = new Event(0.7);
  private squintAt: number;
  private hopPhase = 0;
  private hopCount = 0;
  /* the jelly: a damped spring driven by how fast the head turns, so a
     sweep stretches the body and it wobbles back */
  private prevYaw = 0;
  private jelly = 0;
  private jellyV = 0;
  /* the landing: a vertical spring kicked when a jump touches down */
  private squash = 0;
  private squashV = 0;
  private airborne = false;
  private flipHeight = 20;
  private laughEv = new Event(0.8);
  private laughAt: number;
  /* the pointer, as an offset from the head in head-widths, and how much
     to follow it — both smoothed */
  private ptrX = 0;
  private ptrY = 0;
  private ptrS = 0;
  private ptrTargetX = 0;
  private ptrTargetY = 0;
  private ptrTargetS = 0;
  /* smoothed base pose, before overlays */
  private base = { yaw: 0, pitch: 0, roll: 0, y: 0, eyeOpen: 1, lookX: 0, lookY: 0 };

  constructor(seed: number, state: BotAvatarState = 'default') {
    this.rand = rng(Math.floor(seed * 1e6) + 1);
    const r = this.rand;
    this.yawW = new Wander(r, 36 * DEG, 1.1, 2.6, 3);
    this.pitchW = new Wander(r, 10 * DEG, 1.1, 2.6, 2.6);
    this.rollW = new Wander(r, 5 * DEG, 1.6, 3.2, 2);
    this.lookXW = new Wander(r, 3.6, 0.5, 2, 14);
    this.lookYW = new Wander(r, 2.4, 0.5, 2, 14);
    /* every instance starts somewhere else in its loops */
    this.t = r() * 10;
    this.hopPhase = r();
    /* event timers count from that start, so nothing fires on the first tick */
    this.blinkAt = this.t + 1 + r() * 3;
    this.flipAt = this.t + 5 + r() * 7;
    this.nodAt = this.t + 3 + r() * 4;
    this.hmmAt = this.t + 3 + r() * 4;
    this.squintAt = this.t + 2 + r() * 3;
    this.dartAt = this.t + 1 + r() * 2;
    this.laughAt = this.t + 0.6 + r() * 1.5;
    this.setState(state, true);
  }

  setState(next: BotAvatarState, immediate = false) {
    if (next === this.state && !immediate) return;
    this.state = next;
    this.st = 0;
    switch (next) {
      case 'default':
        this.yawW.set(36 * DEG, 1.1, 2.6, 3);
        this.pitchW.set(10 * DEG, 1.1, 2.6, 2.6);
        this.rollW.set(5 * DEG, 1.6, 3.2, 2);
        this.lookXW.set(3.6, 0.5, 2, 14);
        this.lookYW.set(2.4, 0.5, 2, 14);
        this.flipAt = this.t + 3 + this.rand() * 4;
        break;
      case 'thinking':
        this.flipAt = this.t + 4 + this.rand() * 5;
        this.yawW.set(16 * DEG, 1.2, 2.4, 2.4);
        this.pitchW.set(5 * DEG, 1.2, 2.4, 2.4);
        this.rollW.set(3 * DEG, 1.6, 3, 2);
        this.lookXW.set(2.4, 0.6, 1.6, 12);
        this.lookYW.set(1.4, 0.6, 1.6, 12);
        this.hmmAt = this.t + 1.5 + this.rand() * 2;
        this.squintAt = this.t + 1 + this.rand() * 2;
        break;
      case 'happy':
        this.yawW.set(16 * DEG, 0.9, 1.8, 4);
        this.pitchW.set(3 * DEG, 1.2, 2.4, 3);
        this.rollW.set(0, 1, 2, 3);
        this.lookXW.set(2, 0.5, 1.2, 12);
        this.lookYW.set(1, 0.5, 1.2, 12);
        this.hopPhase = 0;
        this.hopCount = 0;
        this.laughAt = this.t + 0.5 + this.rand() * 1.2;
        break;
      case 'sleeping':
        this.yawW.set(7 * DEG, 3, 6, 0.7);
        this.pitchW.set(3 * DEG, 3, 6, 0.7);
        this.rollW.set(2 * DEG, 3, 6, 0.6);
        this.lookXW.set(0, 2, 4, 2);
        this.lookYW.set(0, 2, 4, 2);
        this.nodAt = this.t + 2.5 + this.rand() * 4;
        break;
    }
    if (immediate) {
      const w = this.pose.w;
      for (let i = 0; i < 4; i++) w[i] = STATES[i] === next ? 1 : 0;
      const r = REST[next];
      Object.assign(this.base, { pitch: r.pitch, roll: r.roll, y: r.y, eyeOpen: r.eyeOpen, lookX: r.lookX, lookY: r.lookY });
    }
  }

  /** Where the pointer is, relative to the head (−1 … 1 across a head
      width), and how strongly to follow it (0 lets go). */
  setPointer(x: number, y: number, strength: number) {
    this.ptrTargetX = Math.max(-1.2, Math.min(1.2, x));
    this.ptrTargetY = Math.max(-1.2, Math.min(1.2, y));
    this.ptrTargetS = Math.max(0, Math.min(1, strength));
  }

  /** A hop and a full turn, right now, whatever the state. */
  poke() {
    if (this.flip.active && this.flip.p < 0.6) return;
    this.flip.fire();
    this.flipAt = this.t + 6 + this.rand() * 6;
  }

  /** Advance by `dt` seconds (already scaled by the speed). */
  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.st += dt;
    const t = this.t;
    const p = this.pose;
    const w = p.w;

    /* blend weights follow the state */
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      w[i] = approach(w[i], STATES[i] === this.state ? 1 : 0, 6, dt);
      sum += w[i];
    }
    for (let i = 0; i < 4; i++) w[i] /= sum;
    const [wd, wt, wh, ws] = w;

    /* rest targets, blended */
    const rest = { pitch: 0, roll: 0, y: 0, eyeOpen: 0, lookX: 0, lookY: 0 };
    for (let i = 0; i < 4; i++) {
      const r = REST[STATES[i]];
      rest.pitch += r.pitch * w[i];
      rest.roll += r.roll * w[i];
      rest.y += r.y * w[i];
      rest.eyeOpen += r.eyeOpen * w[i];
      rest.lookX += r.lookX * w[i];
      rest.lookY += r.lookY * w[i];
    }

    /* wander */
    this.yawW.update(t, dt);
    this.pitchW.update(t, dt);
    this.rollW.update(t, dt);
    this.lookXW.update(t, dt);
    this.lookYW.update(t, dt);

    /* following the pointer: the eyes lead, the head turns after them,
       and the wander quietens while it lasts */
    this.ptrS = approach(this.ptrS, this.ptrTargetS, 8, dt);
    this.ptrX = approach(this.ptrX, this.ptrTargetX, 14, dt);
    this.ptrY = approach(this.ptrY, this.ptrTargetY, 14, dt);
    const ps = this.ptrS;
    const quiet = 1 - 0.75 * ps;

    const b = this.base;
    b.yaw = approach(b.yaw, this.yawW.value * quiet + 22 * DEG * this.ptrX * ps, 5, dt);
    b.pitch = approach(b.pitch, rest.pitch + this.pitchW.value * quiet - 12 * DEG * this.ptrY * ps, 5, dt);
    b.roll = approach(b.roll, rest.roll + this.rollW.value, 5, dt);
    b.y = approach(b.y, rest.y, 5, dt);
    b.eyeOpen = approach(b.eyeOpen, rest.eyeOpen, 9, dt);
    b.lookX = approach(b.lookX, rest.lookX + this.lookXW.value * quiet + 4.5 * this.ptrX * ps, 9, dt);
    b.lookY = approach(b.lookY, rest.lookY + this.lookYW.value * quiet + 3 * this.ptrY * ps, 9, dt);

    /* ── events ── */
    let spin = 0, hopY = 0, sx = 1, sy = 1, pitchAdd = 0, rollAdd = 0, blinkClose = 0, yawAdd = 0, lookXAdd = 0, lookYAdd = 0, eyeMul = 1, laugh = 0;

    /* blinks: idle and thinking blink; a double blink now and then */
    if (t >= this.blinkAt && !this.blink.active && wd + wt > 0.5) {
      this.blink.fire();
      this.blinkAgain = !this.blinkAgain && this.rand() < 0.22;
      /* idle: one blink in seven is a wink */
      this.wink = !this.blinkAgain && this.state === 'default' && this.rand() < 0.14 ? (this.rand() < 0.5 ? -1 : 1) : 0;
      this.blink.duration = this.wink ? 0.34 : 0.17;
      this.blinkAt = t + (this.blinkAgain ? 0.28 : 2.2 + this.rand() * 2.6);
    }
    this.blink.update(dt);
    if (this.blink.active) blinkClose = Math.sin(Math.PI * this.blink.p);

    /* eye darts: a quick glance to the side and back, between the slower
       looks — the eyes have a life of their own */
    if (t >= this.dartAt && !this.dart.active && wd + wt > 0.5) {
      this.dart.fire();
      this.dartX = (this.rand() * 2 - 1) * 4;
      this.dartY = (this.rand() * 2 - 1) * 2;
      this.dart.duration = 0.25 + this.rand() * 0.45;
      this.dartAt = t + 1.2 + this.rand() * 2.6;
    }
    this.dart.update(dt);
    if (this.dart.active) {
      const q = this.dart.p;
      /* snap out, hold, snap back */
      const hold = q < 0.15 ? q / 0.15 : q > 0.8 ? (1 - q) / 0.2 : 1;
      lookXAdd += this.dartX * hold * (wd + wt);
      lookYAdd += this.dartY * hold * (wd + wt);
    }

    /* idle: a full turn now and then, with a little hop; thinking rolls
       over too, a touch slower and rarer */
    if ((this.state === 'default' || this.state === 'thinking') && t >= this.flipAt && !this.flip.active) {
      this.flip.duration = this.state === 'thinking' ? 1 : 0.9;
      this.flipHeight = this.state === 'thinking' ? 24 : 20;
      this.flip.fire();
      this.flipAt = t + (this.state === 'thinking' ? 7 + this.rand() * 6 : 5 + this.rand() * 6);
    }
    this.flip.update(dt);
    if (this.flip.active) {
      const q = this.flip.p;
      /* one full turn, eased in and out, no overshoot to snap back from */
      spin += TAU * easeInOut(q);
      /* a ballistic arc: up fast, slow at the top, fast into the ground */
      hopY -= this.flipHeight * 4 * q * (1 - q);
      /* a stretch on take-off */
      if (q < 0.18) {
        const s = Math.sin((Math.PI * q) / 0.18);
        sy += 0.07 * s;
        sx -= 0.05 * s;
      }
      this.airborne = true;
    } else if (this.airborne) {
      /* touch-down: kick the landing spring */
      this.airborne = false;
      this.squashV -= 2.8;
    }
    /* the landing spring: a squash that rebounds and settles */
    const wsq = 24, zsq = 0.32;
    this.squashV += (-wsq * wsq * this.squash - 2 * zsq * wsq * this.squashV) * dt;
    this.squash += this.squashV * dt;
    sy *= 1 + this.squash;
    sx *= 1 - 0.65 * this.squash;

    /* happy: hops all the time; every third one spins */
    if (wh > 0.02) {
      const period = 0.68;
      const before = this.hopPhase;
      this.hopPhase += dt / period;
      if (this.hopPhase >= 1) {
        this.hopPhase -= 1;
        this.hopCount += 1;
      }
      const q = this.hopPhase;
      const spinning = this.hopCount % 3 === 2;
      const h = spinning ? 26 : 18;
      hopY -= h * Math.sin(Math.PI * q) * wh;
      /* squash on landing, stretch at the top */
      const land = Math.exp(-Math.pow(Math.min(q, 1 - q) / 0.11, 2));
      sx += (0.16 * land - 0.06 * Math.sin(Math.PI * q)) * wh;
      sy += (-0.18 * land + 0.09 * Math.sin(Math.PI * q)) * wh;
      if (spinning) {
        spin += TAU * easeInOut(q) * wh;
        /* eyes shut for the spin */
        laugh = Math.max(laugh, Math.sin(Math.PI * q));
      }
      /* lean into each hop, alternating sides */
      rollAdd += (this.hopCount % 2 === 0 ? 1 : -1) * 6 * DEG * Math.sin(Math.PI * q) * wh;
      void before;
    }

    /* happy: now and then a laugh shuts the eyes into arcs, then they
       open again */
    if (this.state === 'happy' && t >= this.laughAt && !this.laughEv.active) {
      this.laughEv.fire();
      this.laughEv.duration = 0.6 + this.rand() * 0.5;
      this.laughAt = t + 1.6 + this.rand() * 2.2;
    }
    this.laughEv.update(dt);
    if (this.laughEv.active) {
      const q = this.laughEv.p;
      /* quick shut, hold, quick open */
      laugh = Math.max(laugh, q < 0.18 ? q / 0.18 : q > 0.78 ? (1 - q) / 0.22 : 1);
    }

    /* sleeping: the head drops, then jerks back up */
    if (this.state === 'sleeping' && t >= this.nodAt && !this.nod.active) {
      this.nod.fire();
      this.nodAt = t + 4 + this.rand() * 4;
    }
    this.nod.update(dt);
    if (this.nod.active) {
      const q = this.nod.p;
      /* slow slide down, quick recovery */
      const dip = q < 0.72 ? easeInOut(q / 0.72) : 1 - easeInOut((q - 0.72) / 0.28);
      pitchAdd -= 13 * DEG * dip * ws;
    }

    /* thinking: the head sweeps side to side the whole time, the eyes
       leading the turn, with a small nod on top; a "hmm" tilt to the
       other side and a squint now and then */
    if (wt > 0.02) {
      const ph = t * TAU / 3.2;
      yawAdd += 30 * DEG * Math.sin(ph) * wt;
      lookXAdd += 3.2 * Math.sin(ph + 0.7) * wt;
      lookYAdd += 1.2 * Math.sin(ph * 2 + 1) * wt;
      pitchAdd += 4 * DEG * Math.sin(ph * 2) * wt;
      rollAdd += 5 * DEG * Math.sin(ph + Math.PI / 2) * wt;
    }
    if (this.state === 'thinking' && t >= this.hmmAt && !this.hmm.active) {
      this.hmm.fire();
      this.hmmAt = t + 2.5 + this.rand() * 2.5;
    }
    this.hmm.update(dt);
    if (this.hmm.active) rollAdd += 16 * DEG * Math.sin(Math.PI * this.hmm.p) * wt;
    if (this.state === 'thinking' && t >= this.squintAt && !this.squint.active) {
      this.squint.fire();
      this.squintAt = t + 2 + this.rand() * 3;
    }
    this.squint.update(dt);
    if (this.squint.active) eyeMul -= 0.5 * Math.sin(Math.PI * this.squint.p) * wt;

    /* breathing, always, deeper asleep */
    const breath = Math.sin(t * TAU / (3.6 + 1.2 * ws));
    p.breath = breath;
    sx += breath * (0.008 + 0.014 * ws);
    sy += breath * (0.012 + 0.02 * ws);
    const bob = Math.sin(t * TAU / 3.4) * 2 * (wd + wt);

    /* ── compose ── */
    p.yaw = b.yaw + yawAdd + spin;

    /* the jelly: the faster the head turns, the more the body stretches
       along the turn, on a spring that overshoots and settles. Full
       strength while thinking, a hint of it otherwise. A flip's spin is
       left out: that is a jump, and the landing spring handles it. */
    const turnYaw = b.yaw + yawAdd;
    let dyaw = turnYaw - this.prevYaw;
    dyaw = ((dyaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
    this.prevYaw = turnYaw;
    const rate = dt > 0 ? Math.abs(dyaw) / dt : 0;
    const jellyTarget = Math.min(0.22, 0.055 * rate);
    const omega = 16, zeta = 0.45;
    this.jellyV += (omega * omega * (jellyTarget - this.jelly) - 2 * zeta * omega * this.jellyV) * dt;
    this.jelly += this.jellyV * dt;
    const jelly = Math.max(-0.08, Math.min(0.28, this.jelly)) * (wt + 0.3 * (1 - wt));
    sx *= 1 + jelly;
    sy *= 1 - 0.55 * jelly;
    p.pitch = b.pitch + pitchAdd;
    p.roll = b.roll + rollAdd;
    p.x = 0;
    p.y = b.y + hopY + bob;
    p.sx = sx;
    p.sy = sy;
    p.eyeOpen = b.eyeOpen * eyeMul;
    p.laugh = approach(p.laugh, laugh, 30, dt);
    p.blinkL = this.wink === 1 ? 0 : blinkClose;
    p.blinkR = this.wink === -1 ? 0 : blinkClose;
    p.lookX = b.lookX + lookXAdd;
    p.lookY = b.lookY + lookYAdd;
  }
}

/** The still pose of a state, for reduced motion and the first paint. */
export function restPose(state: BotAvatarState): Pose {
  const r = REST[state];
  return {
    yaw: state === 'thinking' ? 14 * DEG : 0,
    pitch: r.pitch,
    roll: r.roll,
    x: 0,
    y: r.y,
    sx: 1,
    sy: 1,
    eyeOpen: r.eyeOpen,
    blinkL: 0,
    blinkR: 0,
    lookX: r.lookX,
    lookY: r.lookY,
    breath: 0,
    laugh: 0,
    w: STATES.map((s) => (s === state ? 1 : 0)) as [number, number, number, number],
  };
}
