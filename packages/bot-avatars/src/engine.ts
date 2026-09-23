/* The rig. A pose is a handful of numbers — head yaw / pitch / roll, a
   position, squash, how open the eyes are, where they look — and blend
   weights for the three states. A Sim advances a pose through time: each
   state sets targets and wanders around them, runs its own events (a
   flip, a hop, a nod, a blink), and a state change eases from one set of
   targets to the next on a timed curve, so it starts and ends softly. */

import type { BotAvatarState, BotAvatarSquashEase } from './types';

export const STATES: BotAvatarState[] = ['default', 'working', 'sleeping'];
/* the working state's hop: its period, and the height of the spinning one */
const HOP_T = 0.68;
const HOP_SPIN_H = 26;
/* a flip is that spinning hop on its own: a crouch before it (the squash
   that, in the working state, the previous landing leaves), the hop, and
   the landing's recovery after — measured in hop periods */
const FLIP_PRE = 0.2;
const FLIP_POST = 0.66;
/** The jump's numbers: an idle flip's and a click's. */
export interface JumpConfig {
  /** how high, in body units (the body is 100 tall) */
  height: number;
  /** seconds in the air */
  time: number;
  /** how much the body stretches in the air, 0–2 */
  stretch: number;
  /** how much it squashes on the ground, before take-off and on landing, 0–2 */
  squash: number;
  /** seconds the landing squash takes, contact to recovered */
  squashTime: number;
  /** the landing squash's shape */
  squashEase: BotAvatarSquashEase;
  /** seconds the body holds its deepest squash on the ground */
  groundTime: number;
  /** how the weight settles through that hold */
  groundEase: BotAvatarSquashEase;
  /** seconds the body takes to rise from its deepest squash back to shape */
  riseTime: number;
  /** how it rises */
  riseEase: BotAvatarSquashEase;
  /** seconds a click's jump takes for its landing squash */
  clickSquashTime: number;
  /** whole turns in the air */
  spin: number;
  /** degrees of lean into it */
  lean: number;
  /** seconds between idle jumps, roughly (±40 %); 0 for none */
  every: number;
  /** when the landing squash begins: seconds before (negative) or after
      touch-down; 0 is the moment of contact */
  land: number;
}
export const JUMP_DEFAULTS: JumpConfig = { height: HOP_SPIN_H, time: HOP_T, stretch: 1, squash: 1.15, squashTime: 0.37, squashEase: 'pulse', groundTime: 0.11, groundEase: 'pulse', riseTime: 0.33, riseEase: 'pulse', clickSquashTime: 0.24, spin: 1, lean: 6, every: 8, land: 0 };
/* a click's jump crouches for its squash time before take-off and lands
   with a squash of the same length; an idle jump's crouch is the working
   hop's short one */
const flipPre = (j: JumpConfig, poked: boolean) => (poked ? j.clickSquashTime : FLIP_PRE * j.time);
const flipDuration = (j: JumpConfig, poked: boolean) =>
  flipPre(j, poked) +
  j.time +
  SQUASH_PEAK[j.squashEase] * (poked ? j.clickSquashTime : j.squashTime) +
  Math.max(0, j.groundTime) +
  j.riseTime +
  Math.max(0, j.land) +
  0.05;
/* where in its time each easing reaches the deepest squash */
const SQUASH_PEAK: Record<BotAvatarSquashEase, number> = { sharp: 0, pulse: 2 / 7, soft: 0.5, bouncy: 0.144 };
/* the rise: how the body comes back from its deepest squash to its own
   shape, 1 → 0 over the rise time. `sharp` lets go at once and eases in
   to rest, `pulse` leaves quickly with a long settle, `soft` eases out of
   the squash and into rest, `bouncy` passes rest into a slight stretch
   and settles back. */
const risePulse = (v: number, ease: BotAvatarSquashEase) => {
  if (v <= 0) return 1;
  if (v >= 1) return 0;
  switch (ease) {
    case 'sharp':
      return (1 - v) * (1 - v);
    case 'soft':
      return 0.5 + 0.5 * Math.cos(Math.PI * v);
    case 'bouncy':
      return Math.exp(-3.2 * v) * Math.cos(5.4 * v) - v * v * v * 0.026;
    default: {
      const k = 4.2 * v;
      return (1 + k) * Math.exp(-k) - v * v * v * 0.078;
    }
  }
};

/* the weight settling through the hold, as a gain on the deepest squash:
   the same four curves as the landing squash, pressing up to a quarter
   deeper and back to the held depth, so the hold's ends never step */
const groundShape = (v: number, ease: BotAvatarSquashEase) => 1 + 0.25 * squashPulse(v, ease);
/* the landing squash over its time, 0–1 → its depth, 0–1 at the peak:
   sharp is all there at contact and eases off; pulse presses quickly and
   recovers without a wobble (a critically damped spring under a short
   push); soft eases in and out; bouncy overshoots into a stretch and
   settles. Each is faded out over the last part so it ends at nothing. */
const squashPulse = (u: number, ease: BotAvatarSquashEase) => {
  if (u <= 0 || u >= 1) return 0;
  let x: number;
  switch (ease) {
    case 'sharp':
      x = (1 - u) * (1 - u);
      break;
    case 'soft':
      x = Math.sin(Math.PI * u) ** 2;
      break;
    case 'bouncy':
      x = (Math.exp(-3.15 * u) * Math.sin(8.43 * u)) / 0.596;
      break;
    default: {
      const k = 7 * u;
      x = (k * k * Math.exp(2 - k)) / 4;
    }
  }
  const tail = u > 0.85 ? 1 - (u - 0.85) / 0.15 : 1;
  return x * tail * tail * (3 - 2 * tail);
};
/* the hop's shaping: squash on the ground, stretch at the top */
const hopSquash = (a: number) => Math.exp(-Math.pow(Math.min(Math.abs(a), Math.abs(a - 1)) / 0.11, 2));


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
  /** how far each lid is down right now, 0 … 1 */
  blinkL: number;
  blinkR: number;
  lookX: number;
  lookY: number;
  /** the breathing cycle, −1 … 1 */
  breath: number;
  /** working only: how far the eyes have closed into a laugh, 0 … 1 */
  laugh: number;
  /** the cartoon whirl round a spinning body: strength 0 … 1, and where
      its head is, in radians round the ring */
  whirl: number;
  whirlAngle: number;
  /** blend weights: default, working, sleeping — they sum to 1 */
  w: [number, number, number];
}

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/* how long a state change takes: dozing off is slow, waking a little
   quicker, the rest brisk */
/* How long a switch takes. Settling down takes longer than getting to
   work: coming back to idle the body has to let go of the hops, so it
   eases out over more than a second. */
const SWITCH_TO: Record<BotAvatarState, number> = { default: 1.2, working: 0.7, sleeping: 1.4 };
const SWITCH_FROM_SLEEP = 1;

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
/* gentler at both ends than the cubic: for drifting off and waking */
const easeSine = (p: number) => 0.5 - 0.5 * Math.cos(Math.PI * p);

/* A value that drifts: picks a new target inside its range every hold,
   and eases toward it. Ranges change with the state; the value never
   jumps. */
class Wander {
  value = 0;
  private vel = 0;
  private target = 0;
  private next = 0;
  /* A channel that picks a new target now and then and moves to it. The
     head channels move as a lightly damped spring — the turn starts and
     ends softly, the way a head does — while the eyes dart with an
     exponential approach, the way eyes do. */
  constructor(
    private rand: () => number,
    public amp: number,
    public holdMin: number,
    public holdMax: number,
    public rate: number,
    private spring = false
  ) {}
  update(t: number, dt: number) {
    if (t >= this.next) {
      this.target = (this.rand() * 2 - 1) * this.amp;
      this.next = t + this.holdMin + this.rand() * (this.holdMax - this.holdMin);
    }
    if (this.spring) {
      const w = this.rate * 1.6, z = 0.9;
      this.vel += (w * w * (this.target - this.value) - 2 * z * w * this.vel) * dt;
      this.value += this.vel * dt;
    } else this.value = approach(this.value, this.target, this.rate, dt);
  }
  /** aim at a value and stay there: the rig picks the next one */
  aim(v: number) {
    this.target = v;
    this.next = Infinity;
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

/* The idle gaze: how far the head swings, and how long it stays. The
   sideways reach is the big one — a look to a corner reads as a turn of
   the head, with the rise and a slight tilt going along. */
const GAZE_YAW = 35 * DEG;
const GAZE_PITCH = 14 * DEG;
const GAZE_ROLL = 3.2 * DEG;
const GAZE_HOLD_MIN = 2.6;
const GAZE_HOLD_MAX = 4.4;

/* Resting targets per state. Everything the wanderers and events add sits
   on top of these. */
interface Rest {
  pitch: number;
  roll: number;
  y: number;
  lookX: number;
  lookY: number;
}
const REST: Record<BotAvatarState, Rest> = {
  default: { pitch: 0, roll: 0, y: 0, lookX: 0, lookY: 0 },
  working: { pitch: 5 * DEG, roll: 0, y: 0, lookX: 0, lookY: 0 },
  sleeping: { pitch: -16 * DEG, roll: 6 * DEG, y: 3, lookX: 0, lookY: 1 },
};

export class Sim {
  readonly pose: Pose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, sx: 1, sy: 1, eyeOpen: 1, blinkL: 0, blinkR: 0, lookX: 0, lookY: 0, breath: 0, laugh: 0, whirl: 0, whirlAngle: 0, w: [1, 0, 0] };
  state: BotAvatarState = 'default';

  private rand: () => number;
  private t = 0;
  /* a state change: the weights it started from and its progress */
  private wFrom: [number, number, number] = [1, 0, 0];
  private tr = 1;
  private trDuration = 1.2;
  private yawW: Wander;
  private pitchW: Wander;
  private rollW: Wander;
  private lookXW: Wander;
  private lookYW: Wander;
  private blink = new Event(0.17);
  private blinkAt: number;
  private blinkAgain = false;
  /* −1 left eye only, 1 right eye only, 0 both */
  private dart = new Event(0.12);
  private dartAt: number;
  private dartX = 0;
  private dartY = 0;
  private flip = new Event(flipDuration(JUMP_DEFAULTS, false));
  private flipPoked = false;
  private jump: JumpConfig = { ...JUMP_DEFAULTS };
  private flipAt: number;
  private flipSide = 1;
  private nod = new Event(1.7);
  private nodAt: number;
  private hopPhase = 0;
  private hopCount = 0;
  /** the hops' gain: the working weight while in the state, then held so
      a hop under way finishes whole when the state is left */
  private hopGain = 0;
  private laughEv = new Event(0.8);
  private laughAt: number;
  /* the jelly: a damped spring driven by how fast the head turns, so a
     sweep stretches the body and it wobbles back */
  private prevYaw = 0;
  private jelly = 0;
  private jellyV = 0;
  /** how far the eyes run ahead of a head turn */
  private gazeLead = 0;
  /** the idle gaze: where the head is looking, and when it moves on */
  private gazeDir: [number, number] = [0, 0];
  private gazeAt = 0;
  /** how far it turns to the side, 1 as the gaze has it */
  private turnK = 1;
  /** the breathing cycle's phase, in turns */
  private breathPhase = 0;
  /* the pointer, as an offset from the head in head-widths, and how much
     to follow it — both smoothed */
  private ptrX = 0;
  private ptrY = 0;
  private ptrS = 0;
  private ptrTargetX = 0;
  private ptrTargetY = 0;
  private ptrTargetS = 0;
  /* the smoothed yaw the head is turning to on its own */
  private baseYaw = 0;

  constructor(seed: number, state: BotAvatarState = 'default') {
    this.rand = rng(Math.floor(seed * 1e6) + 1);
    const r = this.rand;
    this.yawW = new Wander(r, 36 * DEG, 1.1, 2.6, 3, true);
    this.pitchW = new Wander(r, 10 * DEG, 1.1, 2.6, 2.6, true);
    this.rollW = new Wander(r, 5 * DEG, 1.6, 3.2, 2, true);
    this.lookXW = new Wander(r, 3.6, 0.5, 2, 14);
    this.lookYW = new Wander(r, 2.4, 0.5, 2, 14);
    /* every instance starts somewhere else in its loops */
    this.t = r() * 10;
    this.hopPhase = r();
    this.breathPhase = r();
    /* event timers count from that start, so nothing fires on the first tick */
    this.blinkAt = this.t + 1 + r() * 3;
    this.flipAt = this.nextFlip(this.t, 1);
    this.nodAt = this.t + 3 + r() * 4;
    this.dartAt = this.t + 1 + r() * 2;
    this.laughAt = this.t + 0.6 + r() * 1.5;
    this.setState(state, true);
  }

  setState(next: BotAvatarState, immediate = false) {
    if (next === this.state && !immediate) return;
    const from = this.state;
    this.state = next;
    const w = this.pose.w;
    if (immediate) {
      for (let i = 0; i < 3; i++) w[i] = STATES[i] === next ? 1 : 0;
      this.tr = 1;
    } else {
      this.wFrom = [w[0], w[1], w[2]];
      this.tr = 0;
      this.trDuration = from === 'sleeping' ? SWITCH_FROM_SLEEP : SWITCH_TO[next];
    }
    switch (next) {
      case 'default':
        /* the head takes its time: it holds a place, then swings to the
           next over about a second — no short quick jabs. The gaze picks
           where, so these carry the motion and their amplitude is unused. */
        this.yawW.set(GAZE_YAW, 2.6, 5.4, 2);
        this.pitchW.set(GAZE_PITCH, 2.8, 5.8, 1.8);
        this.rollW.set(GAZE_ROLL, 3.4, 6.6, 1.5);
        this.gazeAt = 0;
        this.gazeDir = [0, 0];
        /* the eyes keep their quickness: they dart, the head follows */
        this.lookXW.set(3.6, 0.6, 2.2, 13);
        this.lookYW.set(2.4, 0.6, 2.2, 13);
        this.flipAt = this.nextFlip(this.t, 0.6);
        break;
      case 'working':
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
    this.flipPoked = true;
    this.flip.duration = flipDuration(this.jump, true);
    this.flipSide = this.rand() < 0.5 ? -1 : 1;
    this.flip.fire();
    this.flipAt = this.nextFlip(this.t, 1.1);
  }

  /** How far the head turns to the side while idle: 1 as the gaze has
      it, 0 keeps it facing forward. */
  setTurn(k: number) {
    const next = Math.max(0, k);
    if (next === this.turnK) return;
    this.turnK = next;
    /* take the new reach at once rather than at the next place */
    if (this.state === 'default') this.gazeAt = 0;
  }

  /** The jump's numbers; any subset. */
  setJump(j: Partial<JumpConfig>) {
    const every = this.jump.every;
    Object.assign(this.jump, j);
    /* a new interval takes effect at once, so `every: 0` stops the next
       jump that was already due and a first value starts the clock */
    if (j.every !== undefined && j.every !== every) this.flipAt = this.nextFlip(this.t, 1);
  }

  /* Where the head looks next. From a corner it mostly swings straight
     across to the opposite one — top right, stay, bottom left — now and
     then only sideways, or back to the middle for a beat. */
  private nextGaze(): [number, number] {
    const r = this.rand;
    const [px, py] = this.gazeDir;
    if (px !== 0 || py !== 0) {
      const p = r();
      if (p < 0.66) return [-px, -py];
      if (p < 0.85) return [-px, py];
      return [0, 0];
    }
    const corners: Array<[number, number]> = [
      [1, -1],
      [-1, 1],
      [-1, -1],
      [1, 1],
    ];
    return corners[Math.floor(r() * corners.length)];
  }

  /** when the next idle jump is due: `every` seconds, give or take 40 % */
  private nextFlip(t: number, k: number) {
    const every = this.jump.every;
    return every > 0 ? t + every * k * (0.625 + this.rand() * 0.75) : Infinity;
  }

  /** Advance by `dt` seconds (already scaled by the speed). */
  update(dt: number) {
    dt = Math.min(dt, 0.05);
    this.t += dt;
    const t = this.t;
    const p = this.pose;
    const w = p.w;

    /* the state change eases from the weights it started with to the new
       state's on an S-curve: soft start, soft finish, no creeping tail */
    if (this.tr < 1) {
      this.tr = Math.min(1, this.tr + dt / this.trDuration);
      /* a sine ease: no kick at either end of a switch */
      const e = easeSine(this.tr);
      for (let i = 0; i < 3; i++) {
        const target = STATES[i] === this.state ? 1 : 0;
        w[i] = this.wFrom[i] + (target - this.wFrom[i]) * e;
      }
    }
    const [wd, ww, ws] = w;

    /* rest targets, blended */
    const rest = { pitch: 0, roll: 0, y: 0, lookX: 0, lookY: 0 };
    for (let i = 0; i < 3; i++) {
      const r = REST[STATES[i]];
      rest.pitch += r.pitch * w[i];
      rest.roll += r.roll * w[i];
      rest.y += r.y * w[i];
      rest.lookX += r.lookX * w[i];
      rest.lookY += r.lookY * w[i];
    }

    /* the idle gaze: a place to look, a while to stay, then the swing to
       the next — the wanderers carry it on their own springs */
    if (this.state === 'default' && t >= this.gazeAt) {
      const [gx, gy] = this.nextGaze();
      this.gazeDir = [gx, gy];
      const reach = 0.84 + this.rand() * 0.16;
      this.yawW.aim(gx * GAZE_YAW * reach * this.turnK);
      this.pitchW.aim(gy * GAZE_PITCH * reach);
      /* the tilt goes with the turn, so it follows it */
      this.rollW.aim(gx * GAZE_ROLL * reach * this.turnK);
      this.gazeAt = t + GAZE_HOLD_MIN + this.rand() * (GAZE_HOLD_MAX - GAZE_HOLD_MIN);
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

    /* the base pose: the blended rest plus the smoothed wander and the
       pointer's pull — every term is already continuous */
    this.baseYaw = approach(this.baseYaw, this.yawW.value * quiet + 22 * DEG * this.ptrX * ps, 5, dt);
    const basePitch = rest.pitch + this.pitchW.value * quiet - 12 * DEG * this.ptrY * ps;
    const baseRoll = rest.roll + this.rollW.value * quiet;
    const baseY = rest.y;
    const baseLookX = rest.lookX + this.lookXW.value * quiet + 4.5 * this.ptrX * ps;
    const baseLookY = rest.lookY + this.lookYW.value * quiet + 3 * this.ptrY * ps;

    /* ── events ── */
    let spin = 0, hopY = 0, sx = 1, sy = 1, pitchAdd = 0, rollAdd = 0, blinkClose = 0, lookXAdd = 0, lookYAdd = 0, laugh = 0;
    let whirl = 0, whirlAngle = 0;
    /* the whirl: not there until the turn is visibly under way, gone
       before the landing */
    const smooth = (a: number, b: number, v: number) => {
      const x = Math.min(1, Math.max(0, (v - a) / (b - a)));
      return x * x * (3 - 2 * x);
    };
    const envelope = (q: number) => smooth(0.1, 0.26, q) * (1 - smooth(0.66, 0.9, q));
    /* the ring's own travel: fast and steady from the first frame, with a
       little of the body's own easing on top, so it is moving the moment
       it shows */
    const ringAngle = (q: number) => TAU * (1.5 * q + 0.9 * easeInOut(q));

    /* blinks: idle and working blink; a double blink now and then */
    if (t >= this.blinkAt && !this.blink.active && wd + ww > 0.5) {
      this.blink.fire();
      this.blinkAgain = !this.blinkAgain && this.rand() < 0.22;
      this.blinkAt = t + (this.blinkAgain ? 0.28 : 2.2 + this.rand() * 2.6);
    }
    this.blink.update(dt);
    if (this.blink.active) blinkClose = Math.sin(Math.PI * this.blink.p);

    /* eye darts: a quick glance to the side and back, between the slower
       looks — the eyes have a life of their own */
    if (t >= this.dartAt && !this.dart.active && wd + ww > 0.5) {
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
      lookXAdd += this.dartX * hold * (wd + ww);
      lookYAdd += this.dartY * hold * (wd + ww);
    }

    /* idle: a full turn now and then, with a jump */
    if (this.state === 'default' && t >= this.flipAt && !this.flip.active) {
      this.flipPoked = false;
      this.flip.duration = flipDuration(this.jump, false);
      this.flipSide = this.rand() < 0.5 ? -1 : 1;
      this.flip.fire();
      this.flipAt = this.nextFlip(t, 1);
    }
    this.flip.update(dt);
    if (this.flip.active) {
      const J = this.jump;
      /* the hop's own phase: below 0 the crouch, above 1 the recovery */
      const preS = flipPre(J, this.flipPoked);
      const a = (this.flip.p * this.flip.duration - preS) / J.time;
      const q = Math.min(1, Math.max(0, a));
      const arc = Math.sin(Math.PI * q);
      /* whole turns, eased in and out, no overshoot to snap back from */
      spin += TAU * J.spin * easeInOut(q);
      hopY -= J.height * arc;
      /* the crouch before take-off; then the landing squash from `land`
         seconds round the moment of contact — before it, the body braces
         for the ground; after it, it gives late */
      const tl = (a - 1) * J.time - J.land;
      const squashTime = this.flipPoked ? J.clickSquashTime : J.squashTime;
      /* the crouch: a click's builds over its squash time, an idle jump's
         is the hop's short bump; then the hop, then the landing squash */
      const crouch = (u: number) => (this.flipPoked ? u * u * (3 - 2 * u) : hopSquash(u - 1));
      /* the landing in three parts: the press down to the deepest squash
         in the squash easing's own shape, the hold on the ground, then
         the rise back to the body's shape — each with its own time and
         easing, and all three meeting at the same depth, so nothing steps */
      const hold = Math.max(0, J.groundTime);
      const peakT = SQUASH_PEAK[J.squashEase] * squashTime;
      const rise = tl - peakT - hold;
      const depth =
        tl <= peakT
          ? squashPulse(tl / squashTime, J.squashEase)
          : rise <= 0
            ? groundShape((tl - peakT) / hold, J.groundEase)
            : risePulse(rise / J.riseTime, J.riseEase);
      const land = (a < 0 ? crouch(Math.max(0, 1 + (a * J.time) / preS)) : tl > 0 ? depth : a < 0.2 ? hopSquash(a) : 0) * J.squash;
      sx += 0.16 * land - 0.06 * arc * J.stretch;
      sy += -0.18 * land + 0.09 * arc * J.stretch;
      /* lean into it; eyes shut for a turn */
      rollAdd += this.flipSide * J.lean * DEG * arc;
      if (J.spin > 0) {
        laugh = Math.max(laugh, arc);
        whirl = Math.max(whirl, envelope(q));
        whirlAngle = ringAngle(q);
      }
    }

    /* working: hops all the time; every third one spins. Leaving the
       state, the hop under way keeps the strength it had — it flies its
       whole arc, finishes its turn and lands — and that last landing is
       not the rhythm's quick bump but a jump's proper one: the hold on
       the ground and the rise back, from the depth the hop reached. */
    const J = this.jump;
    const exitHold = Math.max(0, J.groundTime);
    const exitFor = exitHold + J.riseTime;
    if (this.state === 'working') this.hopGain = ww;
    if (this.hopGain > 0.02 && (this.state === 'working' || this.hopPhase > 0)) {
      this.hopPhase += dt / HOP_T;
      if (this.hopPhase >= 1) {
        if (this.state === 'working') {
          this.hopPhase -= 1;
          this.hopCount += 1;
        } else if ((this.hopPhase - 1) * HOP_T >= exitFor) {
          /* the last hop has landed and settled */
          this.hopPhase = 0;
          this.hopGain = 0;
        }
      }
      const g = this.hopGain;
      /* past 1 the body is down and only the landing is still playing */
      const q = Math.min(1, this.hopPhase);
      const arc = Math.sin(Math.PI * q);
      const spinning = this.hopCount % 3 === 2;
      const h = spinning ? HOP_SPIN_H : 18;
      hopY -= h * arc * g;
      /* squash on landing, stretch at the top */
      const exitT = this.state !== 'working' && this.hopPhase > 1 ? (this.hopPhase - 1) * HOP_T : -1;
      const land =
        exitT < 0
          ? hopSquash(this.hopPhase)
          : exitT < exitHold
            ? groundShape(exitT / exitHold, J.groundEase)
            : risePulse((exitT - exitHold) / J.riseTime, J.riseEase);
      sx += (0.16 * land - 0.06 * arc) * g;
      sy += (-0.18 * land + 0.09 * arc) * g;
      if (spinning) {
        spin += TAU * easeInOut(q) * g;
        /* eyes shut for the spin */
        laugh = Math.max(laugh, arc * g);
        if (envelope(q) * g > whirl) {
          whirl = envelope(q) * g;
          whirlAngle = ringAngle(q);
        }
      }
      /* lean into each hop, alternating sides */
      rollAdd += (this.hopCount % 2 === 0 ? 1 : -1) * 6 * DEG * arc * g;
    }

    /* working: now and then a laugh shuts the eyes into arcs, then they
       open again */
    if (this.state === 'working' && t >= this.laughAt && !this.laughEv.active) {
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

    /* breathing, always, deeper and slower asleep. The phase is integrated
       so the period can change with the state without the cycle jumping */
    this.breathPhase += dt / (3.6 + 1.2 * ws);
    const breath = Math.sin(this.breathPhase * TAU);
    p.breath = breath;
    sx += breath * (0.008 + 0.014 * ws);
    sy += breath * (0.012 + 0.02 * ws);
    const bob = Math.sin(t * TAU / 3.4) * 2 * (1 - ws);

    /* ── compose ── */
    p.yaw = this.baseYaw + spin;

    /* the jelly: the faster the head turns, the more the body stretches
       along the turn, on a spring that overshoots and settles. A flip's
       spin is left out: that is a jump, and the landing spring handles it. */
    let dyaw = this.baseYaw - this.prevYaw;
    dyaw = ((dyaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
    this.prevYaw = this.baseYaw;
    const rate = dt > 0 ? Math.abs(dyaw) / dt : 0;
    /* the eyes lead a head turn, the way a gaze shift goes: they run
       ahead of it and come back as the head settles */
    const leadTarget = dt > 0 ? Math.max(-2.2, Math.min(2.2, (dyaw / dt) * 2.4)) : 0;
    this.gazeLead = approach(this.gazeLead, leadTarget, 9, dt);
    const jellyTarget = Math.min(0.22, 0.055 * rate);
    const omega = 16, zeta = 0.45;
    this.jellyV += (omega * omega * (jellyTarget - this.jelly) - 2 * zeta * omega * this.jellyV) * dt;
    this.jelly += this.jellyV * dt;
    const jelly = Math.max(-0.08, Math.min(0.28, this.jelly)) * 0.6;
    sx *= 1 + jelly;
    sy *= 1 - 0.55 * jelly;

    p.pitch = basePitch + pitchAdd;
    p.roll = baseRoll + rollAdd;
    p.x = 0;
    p.y = baseY + hopY + bob;
    p.sx = sx;
    p.sy = sy;
    /* the lids: the sleeping state closes them through its own weight in
       the renderer, so here the eyes stay open apart from blinks */
    p.eyeOpen = 1;
    p.laugh = approach(p.laugh, laugh, 30, dt);
    p.blinkL = blinkClose;
    p.blinkR = blinkClose;
    p.lookX = baseLookX + lookXAdd + this.gazeLead;
    p.lookY = baseLookY + lookYAdd;
    p.whirl = whirl;
    p.whirlAngle = whirlAngle;
  }
}

/** The still pose of a state, for reduced motion and the first paint. */
export function restPose(state: BotAvatarState): Pose {
  const r = REST[state];
  return {
    yaw: 0,
    pitch: r.pitch,
    roll: r.roll,
    x: 0,
    y: r.y,
    sx: 1,
    sy: 1,
    eyeOpen: 1,
    blinkL: 0,
    blinkR: 0,
    lookX: r.lookX,
    lookY: r.lookY,
    breath: 0,
    laugh: 0,
    whirl: 0,
    whirlAngle: 0,
    w: STATES.map((s) => (s === state ? 1 : 0)) as [number, number, number],
  };
}
