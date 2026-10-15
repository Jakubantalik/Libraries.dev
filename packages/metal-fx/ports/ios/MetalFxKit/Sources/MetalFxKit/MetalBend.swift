import SwiftUI
import CoreMotion

/// The liquid bend, driven by the phone's tilt instead of a pointer.
///
/// Field (the web's `useMetalBend`): two gaussian blobs centred on the
/// contact point — a directional displacement chasing a spring target, and a
/// divergent "liquid" push that thins the stroke under the contact and
/// thickens it either side. Tilting the phone plays the pointer: the ring
/// sags toward the low edge, with the contact point on the outline in the
/// tilt direction and the amplitude following the tilt angle.
public struct MetalBendConfig: Equatable, Sendable {
    public var enabled: Bool = true
    /// Global multiplier on the whole dent.
    public var strength: Double = 0.74
    /// σ of the directional dent, pt.
    public var blob: Double = 13
    /// σ of the liquid push, pt.
    public var liquidBlob: Double = 10
    /// Displacement cap, pt.
    public var maxDisp: Double = 9
    /// Radial stretch under the contact, pt.
    public var liquid: Double = 7.5
    public var stiffness: Double = 260
    public var damping: Double = 13
    public var mass: Double = 1
    public var liquidStiffness: Double = 53
    public var liquidDamping: Double = 9
    /// Contact-point lag behind the tilt direction, per 60 Hz frame (0..1).
    public var follow: Double = 0.32
    /// Low-pass on the targets, ms.
    public var smoothMs: Double = 140
    public var fadeInMs: Double = 200
    public var fadeOutMs: Double = 350
    /// Tilt (as a fraction of g on the screen plane) at which the dent is full.
    public var tiltRange: Double = 0.45
    /// Tilt below which nothing moves.
    public var tiltDeadzone: Double = 0.025

    // Pointer (the desktop hover bend; also what a magnet drives).
    /// How far beyond the edge the pointer is still felt, pt.
    public var reach: Double = 36
    /// Displacement per 100 pt/s of pointer speed — a transient kick.
    public var gain: Double = 0.6
    /// Dent per pt the pointer sits inside the edge.
    public var pressGain: Double = 0.55
    /// Bulge per pt the pointer sits outside the edge (within `reach`).
    public var pullGain: Double = 0.49
    /// Extra dent toward the centre while pressed, pt.
    public var press: Double = 5
    /// Distance from the edge over which the liquid pressure fades, pt.
    public var liquidReach: Double = 8

    // Magnet → virtual pointer.
    /// Multiplier on the pull the magnet's virtual pointer produces.
    public var magnetGain: Double = 3
    /// Where the virtual pointer ends up, as a fraction of `reach` outside
    /// the edge (~0.3 is where the hover pull, felt at the edge, peaks).
    public var magnetPeak: Double = 0.3
    /// Pull at which the virtual pointer arrives there.
    public var magnetFull: Double = 0.85

    public init() {}
    public static let `default` = MetalBendConfig()

    /// The same bend for a bigger shape: every length × `k`. The web's
    /// numbers are tuned for a 40-pt button.
    public func scaled(_ k: Double) -> MetalBendConfig {
        var c = self
        c.blob *= k; c.liquidBlob *= k; c.maxDisp *= k; c.liquid *= k
        c.reach *= k; c.press *= k; c.liquidReach *= k
        return c
    }
}

/// The evaluated field for one frame.
public struct MetalBendField: Equatable, Sendable {
    var cx: Double, cy: Double
    var dirX: Double, dirY: Double
    var radK: Double
    var s2b: Double, s2l: Double

    /// How far any point can travel — the overscan the shape needs.
    var reach: CGFloat

    public func deform(_ p: CGPoint) -> CGPoint {
        let dx = Double(p.x) - cx, dy = Double(p.y) - cy
        let q = dx * dx + dy * dy
        let gb = exp(-q / s2b)
        let gl = exp(-q / s2l)
        return CGPoint(x: p.x + CGFloat(dirX * gb + dx * radK * gl), y: p.y + CGFloat(dirY * gb + dy * radK * gl))
    }
}

/// Device tilt on the screen plane, from CoreMotion's gravity vector. Relative
/// to a slowly adapting baseline, so the ring responds to a tilt and settles
/// back while the phone is held still in any pose.
public final class MetalTiltSource {
    public static let shared = MetalTiltSource()

    /// Set to drive the bend by hand (a debug pad, a test). `nil` = motion.
    public var override: CGVector?
    /// Seconds for the resting pose to become the neutral pose.
    public var baselineSeconds: Double = 4
    /// Interface orientation used to map device axes onto the screen.
    public var orientation: UIInterfaceOrientation = .portrait

    private var motion: CMMotionManager { MetalMotion.shared.manager }
    private var subscribers = 0
    private var baseline: CGVector?
    private var lastSampleTime: TimeInterval = 0

    private init() {}

    public func attach() {
        subscribers += 1
        if subscribers == 1 { MetalMotion.shared.retainDeviceMotion() }
    }

    public func detach() {
        guard subscribers > 0 else { return }
        subscribers -= 1
        if subscribers == 0 { MetalMotion.shared.releaseDeviceMotion(); baseline = nil }
    }

    private var cachedNow: TimeInterval = -1
    private var cached: CGVector = .zero

    /// Current tilt (x right, y down, in g). Evaluated once per frame; every
    /// ring on the screen shares the sample.
    public func tilt(now: TimeInterval) -> CGVector {
        if now == cachedNow { return cached }
        cachedNow = now
        cached = compute(now: now)
        return cached
    }

    private func compute(now: TimeInterval) -> CGVector {
        if let o = override { return o }
        guard let g = motion.deviceMotion?.gravity else { return .zero }
        // Device axes: x right, y up (toward the top edge), z out of the screen.
        var sx = g.x, sy = -g.y
        switch orientation {
        case .landscapeLeft: (sx, sy) = (-g.y, -g.x)
        case .landscapeRight: (sx, sy) = (g.y, g.x)
        case .portraitUpsideDown: (sx, sy) = (-g.x, g.y)
        default: break
        }
        let s = CGVector(dx: sx, dy: sy)
        let dt = lastSampleTime > 0 ? min(0.1, max(0.001, now - lastSampleTime)) : 1.0 / 60.0
        lastSampleTime = now
        guard var b = baseline else { baseline = s; return .zero }
        let k = 1 - exp(-dt / max(0.1, baselineSeconds))
        b.dx += (s.dx - b.dx) * k
        b.dy += (s.dy - b.dy) * k
        baseline = b
        return CGVector(dx: s.dx - b.dx, dy: s.dy - b.dy)
    }
}

/// Per-instance bend simulation.
final class MetalBendModel {
    private var cx = 0.0, cy = 0.0
    private var ax = 0.0, ay = 0.0, vax = 0.0, vay = 0.0
    private var la = 0.0, vla = 0.0
    private var stx = 0.0, sty = 0.0, stl = 0.0
    private var env = 0.0
    private var active = false
    private var last: TimeInterval = 0
    // Pointer velocity (pt/s, smoothed) and the last pointer position.
    private var svx = 0.0, svy = 0.0
    private var lastPointer: CGPoint?
    private(set) var field: MetalBendField?

    func reset() {
        ax = 0; ay = 0; vax = 0; vay = 0; la = 0; vla = 0; stx = 0; sty = 0; stl = 0; env = 0; active = false; field = nil
        svx = 0; svy = 0; lastPointer = nil
    }

    /// The desktop hover bend — the web's `useMetalBend` step, line for line.
    /// `pointer` is in box-local points (nil = gone). `gain` scales the
    /// position-based press / pull (the magnet's virtual pointer uses it).
    @discardableResult
    func stepPointer(now: TimeInterval, pointer: CGPoint?, pressed: Bool, size: CGSize, radius: CGFloat,
                     cfg: MetalBendConfig, gain: Double = 1) -> MetalBendField? {
        let dt = last > 0 ? min(0.032, max(0.001, now - last)) : 1.0 / 60.0
        last = now
        let W = Double(size.width), H = Double(size.height)
        let ecx = W / 2, ecy = H / 2

        // Pointer velocity: ~40 ms time constant, then the web's decay.
        if let p = pointer, let lp = lastPointer {
            let a = 1 - exp(-dt / 0.04)
            svx += ((Double(p.x - lp.x)) / dt - svx) * a
            svy += ((Double(p.y - lp.y)) / dt - svy) * a
        }
        lastPointer = pointer

        var tx = 0.0, ty = 0.0
        var pressure = 0.0
        if cfg.enabled, let p = pointer {
            let lx = Double(p.x), ly = Double(p.y)
            let ddx = lx - ecx, ddy = ly - ecy
            let d = hypot(ddx, ddy)
            // The edge's distance from the centre toward the pointer (the web
            // uses min(W,H)/2 — the same for a circle, right for a pill).
            let b = MetalGeometry.boundaryPoint(size: size, radius: radius, dir: CGVector(dx: ddx, dy: ddy))
            let R = d > 0.001 ? hypot(Double(b.x) - ecx, Double(b.y) - ecy) : min(W, H) / 2
            let reach = max(W, H) / 2 + cfg.reach
            let wasActive = active
            active = d < reach
            let u = max(0, 1 - abs(d - R) / max(1, cfg.liquidReach))
            pressure = u * u * (3 - 2 * u)
            if active {
                if !wasActive { cx = lx; cy = ly }
                let fa = 1 - pow(1 - min(0.999, cfg.follow), dt * 60)
                cx += (lx - cx) * fa
                cy += (ly - cy) * fa
                let edgeFade = 1 - max(0, (d - (reach - cfg.reach)) / cfg.reach)
                tx = svx * (cfg.gain / 100) * edgeFade
                ty = svy * (cfg.gain / 100) * edgeFade
                let ux = d > 0.001 ? ddx / d : 0, uy = d > 0.001 ? ddy / d : 0
                let pen = R - d
                if pen > 0 {
                    let m = pen * cfg.pressGain * gain
                    tx -= ux * m; ty -= uy * m
                } else {
                    let out = -pen
                    let f = max(0, 1 - out / max(1, cfg.reach))
                    let m = out * cfg.pullGain * (f * f * (3 - 2 * f)) * gain
                    tx += ux * m; ty += uy * m
                }
                let tm = hypot(tx, ty)
                if tm > cfg.maxDisp { tx *= cfg.maxDisp / tm; ty *= cfg.maxDisp / tm }
            }
        } else {
            active = false
        }
        svx *= exp(-dt * 12); svy *= exp(-dt * 12)

        let sa = 1 - exp(-(dt * 1000) / max(1, cfg.smoothMs))
        stx += (tx - stx) * sa
        sty += (ty - sty) * sa

        let mass = max(0.05, cfg.mass)
        vax += ((-cfg.stiffness * (ax - stx) - cfg.damping * vax) / mass) * dt
        vay += ((-cfg.stiffness * (ay - sty) - cfg.damping * vay) / mass) * dt
        ax += vax * dt; ay += vay * dt

        let pressAmt = pressed && active && cfg.enabled ? cfg.press : 0
        let tl = active && cfg.enabled ? cfg.liquid * (pressure + (pressed ? 0.5 : 0)) : 0
        stl += (tl - stl) * sa
        vla += ((-cfg.liquidStiffness * (la - stl) - cfg.liquidDamping * vla) / mass) * dt
        la += vla * dt

        let envTarget = active && cfg.enabled ? 1.0 : 0.0
        let tauMs = max(1, envTarget > 0 ? cfg.fadeInMs : cfg.fadeOutMs) / 3
        env += (envTarget - env) * (1 - exp(-(dt * 1000) / tauMs))
        if env < 0.002 && envTarget == 0 { env = 0 }

        let amp = hypot(ax, ay)
        let idle = !active && env == 0 && amp < 0.05 && hypot(vax, vay) < 1 && abs(la) < 0.05 && pressAmt == 0
        if idle {
            ax = 0; ay = 0; vax = 0; vay = 0; la = 0; vla = 0; stx = 0; sty = 0; stl = 0
            field = nil
            return nil
        }

        let k = max(0, cfg.strength) * env
        var pdx = ecx - cx, pdy = ecy - cy
        let pl = hypot(pdx, pdy) > 0 ? hypot(pdx, pdy) : 1
        pdx /= pl; pdy /= pl
        let sb = max(0.5, cfg.blob), sl = max(0.5, cfg.liquidBlob)
        let reachPx = CGFloat(ceil((cfg.maxDisp + cfg.liquid * 1.5) * max(1, cfg.strength)) + 4)
        field = MetalBendField(cx: cx, cy: cy, dirX: (ax + pdx * pressAmt) * k, dirY: (ay + pdy * pressAmt) * k,
                               radK: (la / sl) * k, s2b: 2 * sb * sb, s2l: 2 * sl * sl, reach: reachPx)
        return field
    }

    /// A magnet (or any field driver) as the hover pointer: a virtual cursor
    /// on the line toward the magnet. Attracting, it closes in from `reach`
    /// outside the edge as the pull rises (the hover pull, × `magnetGain`);
    /// repelling, it presses in through the edge (the hover press), so the
    /// metal recoils from the magnet. The springs, liquid term, lag and
    /// envelope are the hover bend's own.
    @discardableResult
    func stepMagnet(now: TimeInterval, sample: MetalMagnetSample, size: CGSize, radius: CGFloat, cfg: MetalBendConfig) -> MetalBendField? {
        let tl = hypot(Double(sample.toward.dx), Double(sample.toward.dy))
        guard sample.pull > 0.01, tl > 0.001 else {
            return stepPointer(now: now, pointer: nil, pressed: false, size: size, radius: radius, cfg: cfg)
        }
        let ux = Double(sample.toward.dx) / tl, uy = Double(sample.toward.dy) / tl
        let b = MetalGeometry.boundaryPoint(size: size, radius: radius, dir: CGVector(dx: ux, dy: uy))
        let pull = min(1, sample.pull)
        let p: CGPoint
        let gain: Double
        if sample.polarity >= 0 {
            let t = min(1, pull / max(0.05, cfg.magnetFull))
            let e = t * (2 - t)   // ease out: most of the travel early
            let out = cfg.reach * (1 - e * (1 - cfg.magnetPeak))
            p = CGPoint(x: Double(b.x) + ux * out, y: Double(b.y) + uy * out)
            gain = cfg.magnetGain
        } else {
            let pen = min(1, pull / max(0.05, cfg.magnetFull)) * cfg.maxDisp / max(0.05, cfg.pressGain)
            p = CGPoint(x: Double(b.x) - ux * pen, y: Double(b.y) - uy * pen)
            gain = 1
        }
        return stepPointer(now: now, pointer: p, pressed: false, size: size, radius: radius, cfg: cfg, gain: gain)
    }

    /// Advance the simulation; returns the field for this frame, or nil when idle.
    @discardableResult
    func step(now: TimeInterval, tilt: CGVector, size: CGSize, radius: CGFloat, cfg: MetalBendConfig) -> MetalBendField? {
        let dt = last > 0 ? min(0.032, max(0.001, now - last)) : 1.0 / 60.0
        last = now
        let W = Double(size.width), H = Double(size.height)
        let ecx = W / 2, ecy = H / 2

        var tx = 0.0, ty = 0.0
        var tl = 0.0
        let mag = hypot(tilt.dx, tilt.dy)
        let m = ss(cfg.tiltDeadzone, cfg.tiltRange, mag)
        if cfg.enabled && m > 0.0005 {
            let ux = tilt.dx / mag, uy = tilt.dy / mag
            let contact = MetalGeometry.boundaryPoint(size: size, radius: radius, dir: tilt)
            if !active { cx = Double(contact.x); cy = Double(contact.y); active = true }
            let fa = 1 - pow(1 - min(0.999, cfg.follow), dt * 60)
            cx += (Double(contact.x) - cx) * fa
            cy += (Double(contact.y) - cy) * fa
            // The material pools toward the low side: pull the outline out in
            // the tilt direction, and stretch it there.
            tx = ux * m * cfg.maxDisp
            ty = uy * m * cfg.maxDisp
            tl = cfg.liquid * m
        } else {
            active = false
        }

        let sa = 1 - exp(-(dt * 1000) / max(1, cfg.smoothMs))
        stx += (tx - stx) * sa
        sty += (ty - sty) * sa
        let mass = max(0.05, cfg.mass)
        vax += ((-cfg.stiffness * (ax - stx) - cfg.damping * vax) / mass) * dt
        vay += ((-cfg.stiffness * (ay - sty) - cfg.damping * vay) / mass) * dt
        ax += vax * dt; ay += vay * dt

        stl += (tl - stl) * sa
        vla += ((-cfg.liquidStiffness * (la - stl) - cfg.liquidDamping * vla) / mass) * dt
        la += vla * dt

        let envTarget = active && cfg.enabled ? 1.0 : 0.0
        let tauMs = max(1, envTarget > 0 ? cfg.fadeInMs : cfg.fadeOutMs) / 3
        env += (envTarget - env) * (1 - exp(-(dt * 1000) / tauMs))
        if env < 0.002 && envTarget == 0 { env = 0 }

        let amp = hypot(ax, ay)
        let idle = !active && env == 0 && amp < 0.05 && hypot(vax, vay) < 1 && abs(la) < 0.05
        if idle {
            ax = 0; ay = 0; vax = 0; vay = 0; la = 0; vla = 0; stx = 0; sty = 0; stl = 0
            field = nil
            return nil
        }

        let k = max(0, cfg.strength) * env
        let sb = max(0.5, cfg.blob), sl = max(0.5, cfg.liquidBlob)
        let reach = CGFloat(ceil((cfg.maxDisp + cfg.liquid * 1.5) * max(1, cfg.strength)) + 4)
        _ = ecx; _ = ecy
        field = MetalBendField(cx: cx, cy: cy, dirX: ax * k, dirY: ay * k, radK: (la / sl) * k,
                               s2b: 2 * sb * sb, s2l: 2 * sl * sl, reach: reach)
        return field
    }
}

@inline(__always) func ss(_ e0: Double, _ e1: Double, _ x: Double) -> Double {
    let t = min(1, max(0, (x - e0) / max(1e-9, e1 - e0)))
    return t * t * (3 - 2 * t)
}
