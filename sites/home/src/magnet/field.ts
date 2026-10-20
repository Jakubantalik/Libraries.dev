/* The Magnetic UI physics, ported from Magnetic Home (Android) / the iOS
   wallet demo: every element is a small rigid body on a stiff damped string
   to its place. A magnet beside the phone (not over the glass) pulls each by
   its nearest point (1/d³, capped), so it also tilts; bodies collide and
   rest against the screen's rounded edge; the strings bring everything back
   when it leaves. All lengths in screen dp (= CSS px on Android Chrome). */

import type { MagnetFrame, Pt } from "./bridge";

export type Box = { left: number; top: number; right: number; bottom: number };

const w = (b: Box) => b.right - b.left;
const h = (b: Box) => b.bottom - b.top;
const offsetBox = (b: Box, dx: number, dy: number): Box => ({ left: b.left + dx, top: b.top + dy, right: b.right + dx, bottom: b.bottom + dy });
const inset = (b: Box, d: number): Box => ({ left: b.left + d, top: b.top + d, right: b.right - d, bottom: b.bottom - d });
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class Particle {
  home: Box = { left: 0, top: 0, right: 0, bottom: 0 };
  corner = 8;
  ox = 0;
  oy = 0;
  vx = 0;
  vy = 0;
  angle = 0;
  spin = 0;
  atEdge = false;
  get mass() { return Math.max(1, (w(this.home) * h(this.home)) / 1000); }
  get inertia() { return (this.mass * (w(this.home) ** 2 + h(this.home) ** 2)) / 12; }
  get center(): Pt { return { x: (this.home.left + this.home.right) / 2 + this.ox, y: (this.home.top + this.home.bottom) / 2 + this.oy }; }
  get resting() { return Math.abs(this.ox) < 0.2 && Math.abs(this.oy) < 0.2 && Math.abs(this.vx) < 2 && Math.abs(this.vy) < 2 && Math.abs(this.angle) < 0.001; }
}

export class MagneticField {
  parts = new Map<string, Particle>();
  magnet: Pt | null = null;
  overGlass = false;
  private lastT = 0;
  private gate = 0;
  private lostAt = 0;
  private strengths: Array<[number, number]> = [];

  screenCorner = 40;
  stiffness = 150;
  damping = 21;
  force = 30000;
  reach = 150;
  maxForce = 26000;
  standoff = 40;
  softening = 40;
  nearBand = 90;
  farBand = 320;
  tiltGain = 0.5;
  maxTilt = 0.1;
  spinStiffness = 80;
  spinDamping = 12;
  restitution = 0.3;
  wallRestitution = 0.25;
  restingSpeed = 250;
  wallFriction = 0.35;

  setHome(id: string, b: Box, corner: number) {
    let p = this.parts.get(id);
    if (!p) this.parts.set(id, (p = new Particle()));
    p.home = b;
    p.corner = corner;
  }

  get active() { return this.gate > 0.01 || [...this.parts.values()].some((p) => !p.resting); }

  relax(now: number) { this.simulate(now, null); }

  step(r: MagnetFrame, now: number, screenBox: Box, face: number) {
    const dt = this.lastT > 0 ? Math.min(1 / 30, Math.max(1 / 240, now - this.lastT)) : 1 / 60;
    const p = r.pos;
    if (r.strength > 4 && p) {
      const m = this.magnet;
      if (m) {
        const jump = Math.hypot(p.x - m.x, p.y - m.y);
        const k = 1 - Math.exp(-dt / (jump > 200 ? 0.4 : 0.08));
        this.magnet = { x: m.x + (p.x - m.x) * k, y: m.y + (p.y - m.y) * k };
      } else this.magnet = p;
      this.lostAt = now;
    } else if (now - this.lostAt > 0.15) this.magnet = null;
    // Leaving: the field falling well below its peak of the last half second.
    this.strengths.push([now, r.strength]);
    while (this.strengths.length && now - this.strengths[0][0] > 0.5) this.strengths.shift();
    const recentMax = Math.max(...this.strengths.map((s) => s[1]));
    const leaving = recentMax > 25 ? clamp((r.strength / recentMax - 0.15) / 0.3, 0, 1) : 1;
    // Over the glass: no pull at all (the field along the face, or well inside and above).
    const along = ((face < 0 ? -1 : 1) * r.delta[2]) / Math.max(1e-6, r.strength);
    const m = this.magnet;
    const inside = !!m && this.outside(m, screenBox) < -25 && (r.height ?? 0) > 0.8;
    if (r.strength > 4) {
      if (along > 0.2 || inside) this.overGlass = true;
      else if (along < 0) this.overGlass = false;
    }
    let target = 0;
    if (m && !this.overGlass) {
      const field = clamp((r.strength - 10) / 25, 0, 1);
      const real = clamp((r.presence - 0.2) / 0.4, 0, 1);
      target = field * real * leaving;
    }
    this.gate += (target - this.gate) * (1 - Math.exp(-dt / (target > this.gate ? 0.08 : 0.04)));
    this.simulate(now, screenBox);
  }

  private outside(p: Pt, s: Box) {
    const dx = Math.max(s.left - p.x, p.x - s.right), dy = Math.max(s.top - p.y, p.y - s.bottom);
    if (dx > 0 || dy > 0) return Math.hypot(Math.max(0, dx), Math.max(0, dy));
    return Math.max(dx, dy);
  }

  private nearestEdge(m: Pt, s: Box): Pt {
    const dl = m.x - s.left, dr = s.right - m.x, dt = m.y - s.top, db = s.bottom - m.y;
    const mn = Math.min(dl, dr, dt, db);
    return mn === dl ? { x: -1, y: 0 } : mn === dr ? { x: 1, y: 0 } : mn === dt ? { x: 0, y: -1 } : { x: 0, y: 1 };
  }

  private pullPoint(m: Pt, s: Box): Pt {
    let qx = clamp(m.x, s.left, s.right), qy = clamp(m.y, s.top, s.bottom);
    let nx = m.x - qx, ny = m.y - qy;
    if (Math.hypot(nx, ny) < 1) {
      const e = this.nearestEdge(m, s);
      if (e.x) qx = e.x < 0 ? s.left : s.right;
      else qy = e.y < 0 ? s.top : s.bottom;
      nx = e.x; ny = e.y;
    }
    const l = Math.max(1e-6, Math.hypot(nx, ny));
    return { x: qx + (nx / l) * this.standoff, y: qy + (ny / l) * this.standoff };
  }

  private proximity(m: Pt, s: Box) {
    return clamp(1 - (this.outside(m, s) - this.nearBand) / (this.farBand - this.nearBand), 0, 1);
  }

  private direction(c: Pt, m: Pt, s: Box): Pt {
    let rx = m.x - c.x, ry = m.y - c.y;
    const rl = Math.max(1e-6, Math.hypot(rx, ry));
    rx /= rl; ry /= rl;
    let ex = m.x - clamp(m.x, s.left, s.right), ey = m.y - clamp(m.y, s.top, s.bottom);
    if (Math.hypot(ex, ey) < 1) {
      const e = this.nearestEdge(m, s);
      ex = e.x; ey = e.y;
    }
    const el = Math.max(1e-6, Math.hypot(ex, ey));
    ex /= el; ey /= el;
    const k = 0.65;
    let dx = ex * k + rx * (1 - k), dy = ey * k + ry * (1 - k);
    const dl = Math.max(1e-6, Math.hypot(dx, dy));
    return { x: dx / dl, y: dy / dl };
  }

  private simulate(now: number, screenBox: Box | null) {
    const dt = this.lastT > 0 ? Math.min(1 / 30, Math.max(1 / 240, now - this.lastT)) : 1 / 60;
    this.lastT = now;
    for (const p of this.parts.values()) {
      if (w(p.home) <= 0) continue;
      let ax = -this.stiffness * p.ox - this.damping * p.vx;
      let ay = -this.stiffness * p.oy - this.damping * p.vy;
      let torque = 0;
      const raw = this.magnet;
      if (raw && screenBox && this.gate > 0.01) {
        const m = this.pullPoint(raw, screenBox);
        const c = p.center;
        const pw = w(p.home), ph = h(p.home);
        const box = offsetBox(p.home, p.ox, p.oy);
        const qx = clamp(m.x, box.left, box.right), qy = clamp(m.y, box.top, box.bottom);
        const dist = Math.hypot(m.x - qx, m.y - qy) + this.softening;
        const f = Math.min(this.maxForce, this.force * (this.reach / dist) ** 3) * this.gate * this.proximity(raw, screenBox);
        const u = this.direction(c, m, screenBox);
        ax += f * u.x;
        ay += f * u.y;
        // Gripped by its nearest point: an off-centre pull turns it.
        const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
        const lx = (m.x - c.x) * ca + (m.y - c.y) * sa, ly = -(m.x - c.x) * sa + (m.y - c.y) * ca;
        const nlx = clamp(lx, -pw / 2, pw / 2), nly = clamp(ly, -ph / 2, ph / 2);
        const nx = nlx * ca - nly * sa, ny = nlx * sa + nly * ca;
        torque = (this.tiltGain * (nx * f * u.y - ny * f * u.x)) / ((pw * pw + ph * ph) / 12);
        if (p.atEdge) torque *= 0.4;
      }
      p.vx += ax * dt; p.vy += ay * dt;
      const v = Math.hypot(p.vx, p.vy);
      if (v > 2600) { p.vx = (p.vx / v) * 2600; p.vy = (p.vy / v) * 2600; }
      p.ox += p.vx * dt; p.oy += p.vy * dt;
      p.spin += (torque - this.spinStiffness * p.angle - this.spinDamping * p.spin) * dt;
      p.angle += p.spin * dt;
      if (Math.abs(p.angle) > this.maxTilt) { p.angle = clamp(p.angle, -this.maxTilt, this.maxTilt); p.spin *= 0.4; }
    }
    if (!screenBox) return;
    const list = [...this.parts.values()].filter((p) => w(p.home) > 0);
    for (let it = 0; it < 4; it++) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) this.collide(list[i], list[j]);
      for (const p of list) this.contain(p, screenBox);
    }
    for (const p of list) p.angle = clamp(p.angle, -this.maxTilt, this.maxTilt);
  }

  /** Two boxes (separating axes): push apart by mass; a real knock bounces and spins them. */
  private collide(a: Particle, b: Particle) {
    const ca = a.center, cb = b.center;
    const haw = w(a.home) / 2, hah = h(a.home) / 2, hbw = w(b.home) / 2, hbh = h(b.home) / 2;
    if (Math.abs(cb.x - ca.x) > haw + hbw + 20 || Math.abs(cb.y - ca.y) > hah + hbh + 20) return;
    const axA = [{ x: Math.cos(a.angle), y: Math.sin(a.angle) }, { x: -Math.sin(a.angle), y: Math.cos(a.angle) }];
    const axB = [{ x: Math.cos(b.angle), y: Math.sin(b.angle) }, { x: -Math.sin(b.angle), y: Math.cos(b.angle) }];
    const dx = cb.x - ca.x, dy = cb.y - ca.y;
    let best = Infinity, nX = 0, nY = 0;
    for (const n of [...axA, ...axB]) {
      const ra = haw * Math.abs(axA[0].x * n.x + axA[0].y * n.y) + hah * Math.abs(axA[1].x * n.x + axA[1].y * n.y);
      const rb = hbw * Math.abs(axB[0].x * n.x + axB[0].y * n.y) + hbh * Math.abs(axB[1].x * n.x + axB[1].y * n.y);
      const dist = dx * n.x + dy * n.y;
      const overlap = ra + rb - Math.abs(dist);
      if (overlap <= 0) return;
      if (overlap < best) { best = overlap; nX = dist < 0 ? -n.x : n.x; nY = dist < 0 ? -n.y : n.y; }
    }
    // Page elements can overlap where they live (a title's box over its icon):
    // those pairs never collide, or they would shove each other forever.
    const ha = a.home, hb = b.home;
    if (ha.left < hb.right - 1 && hb.left < ha.right - 1 && ha.top < hb.bottom - 1 && hb.top < ha.bottom - 1) return;
    const wa = 1 / a.mass, wb = 1 / b.mass;
    const k = best / (wa + wb);
    a.ox -= nX * k * wa; a.oy -= nY * k * wa;
    b.ox += nX * k * wb; b.oy += nY * k * wb;
    const vn = (b.vx - a.vx) * nX + (b.vy - a.vy) * nY;
    if (vn < 0) {
      const knock = -vn > this.restingSpeed;
      const j = (-(1 + (knock ? this.restitution : 0)) * vn) / (wa + wb);
      a.vx -= nX * j * wa; a.vy -= nY * j * wa;
      b.vx += nX * j * wb; b.vy += nY * j * wb;
      if (!knock) return;
      const pcx = (ca.x + cb.x) / 2, pcy = (ca.y + cb.y) / 2;
      a.spin -= (0.5 * ((pcx - ca.x) * nY - (pcy - ca.y) * nX) * j) / a.inertia;
      b.spin += (0.5 * ((pcx - cb.x) * nY - (pcy - cb.y) * nX) * j) / b.inertia;
    }
  }

  /** Keep a body inside the screen's rounded rectangle. A body whose home is
   *  already cut by the screen's edge may rest there, but go no further out. */
  private contain(p: Particle, screenBox: Box) {
    const s: Box = {
      left: Math.min(screenBox.left, p.home.left), top: Math.min(screenBox.top, p.home.top),
      right: Math.max(screenBox.right, p.home.right), bottom: Math.max(screenBox.bottom, p.home.bottom),
    };
    const c = p.center;
    const hw = w(p.home) / 2, hh = h(p.home) / 2;
    const r = Math.min(p.corner, Math.min(hw, hh));
    const inner = inset(s, r);
    const rr = Math.max(0, this.screenCorner - r);
    const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
    let wx = 0, wy = 0, worst = 0, wpx = c.x, wpy = c.y;
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = sx * (hw - r), ly = sy * (hh - r);
      const qx = c.x + lx * ca - ly * sa, qy = c.y + lx * sa + ly * ca;
      const corr = pushInside(qx, qy, inner, rr);
      const len = Math.hypot(corr.x, corr.y);
      if (len > worst) { worst = len; wx = corr.x; wy = corr.y; wpx = qx; wpy = qy; }
    }
    if (worst < 0.5) { p.atEdge = false; return; }
    const wasAtEdge = p.atEdge;
    p.atEdge = true;
    p.ox += wx; p.oy += wy;
    const nx = wx / worst, ny = wy / worst;
    const vn = p.vx * nx + p.vy * ny;
    if (vn < 0) {
      // Held against the edge: it just stops there, friction holds it. A real hit bounces a little.
      const resting = wasAtEdge && -vn < 900;
      const hit = resting ? 0 : -vn;
      const e = resting ? 0 : this.wallRestitution;
      p.vx -= (1 + e) * vn * nx; p.vy -= (1 + e) * vn * ny;
      const vn2 = p.vx * nx + p.vy * ny;
      const tx = p.vx - vn2 * nx, ty = p.vy - vn2 * ny;
      const tl = Math.hypot(tx, ty);
      if (tl > 1e-6) {
        const drop = resting ? Math.min(tl, this.wallFriction * -vn) / tl : 0.15;
        p.vx -= tx * drop; p.vy -= ty * drop;
      }
      if (resting) p.spin *= 0.7;
      else p.spin += (0.5 * ((wpx - c.x) * ny - (wpy - c.y) * nx) * hit * p.mass) / p.inertia;
    }
  }
}

function pushInside(qx: number, qy: number, rect: Box, radius: number): Pt {
  const cx = qx < rect.left + radius ? rect.left + radius : qx > rect.right - radius ? rect.right - radius : null;
  const cy = qy < rect.top + radius ? rect.top + radius : qy > rect.bottom - radius ? rect.bottom - radius : null;
  if (cx != null && cy != null && radius > 0) {
    const d = Math.hypot(qx - cx, qy - cy);
    if (d <= radius) return { x: 0, y: 0 };
    return { x: ((cx - qx) * (d - radius)) / d, y: ((cy - qy) * (d - radius)) / d };
  }
  let vx = 0, vy = 0;
  if (qx < rect.left) vx = rect.left - qx; else if (qx > rect.right) vx = rect.right - qx;
  if (qy < rect.top) vy = rect.top - qy; else if (qy > rect.bottom) vy = rect.bottom - qy;
  return { x: vx, y: vy };
}
