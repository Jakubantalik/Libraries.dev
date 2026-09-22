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

    public init() {}
    public static let `default` = MetalBendConfig()
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

    private let motion = CMMotionManager()
    private var subscribers = 0
    private var baseline: CGVector?
    private var lastSampleTime: TimeInterval = 0

    private init() {}

    public func attach() {
        subscribers += 1
        guard subscribers == 1, motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive else { return }
        motion.deviceMotionUpdateInterval = 1.0 / 60.0
        motion.startDeviceMotionUpdates()
    }

    public func detach() {
        subscribers = max(0, subscribers - 1)
        if subscribers == 0, motion.isDeviceMotionActive { motion.stopDeviceMotionUpdates(); baseline = nil }
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
    private(set) var field: MetalBendField?

    func reset() {
        ax = 0; ay = 0; vax = 0; vay = 0; la = 0; vla = 0; stx = 0; sty = 0; stl = 0; env = 0; active = false; field = nil
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
