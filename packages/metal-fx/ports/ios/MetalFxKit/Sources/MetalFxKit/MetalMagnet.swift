import SwiftUI
import CoreMotion
import simd

// MARK: - Shared CoreMotion manager

/// One `CMMotionManager` for the whole kit (Apple asks for one per app):
/// the tilt bend reads device motion, the magnet reads the magnetometer.
final class MetalMotion {
    static let shared = MetalMotion()
    let manager = CMMotionManager()
    private var deviceMotionUsers = 0
    private var magnetometerUsers = 0

    private init() {}

    func retainDeviceMotion() {
        deviceMotionUsers += 1
        guard deviceMotionUsers == 1, manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 60.0
        manager.startDeviceMotionUpdates()
    }

    func releaseDeviceMotion() {
        deviceMotionUsers = max(0, deviceMotionUsers - 1)
        if deviceMotionUsers == 0, manager.isDeviceMotionActive { manager.stopDeviceMotionUpdates() }
    }

    func retainMagnetometer() {
        magnetometerUsers += 1
        guard magnetometerUsers == 1, manager.isMagnetometerAvailable, !manager.isMagnetometerActive else { return }
        manager.magnetometerUpdateInterval = 1.0 / 100.0
        manager.startMagnetometerUpdates()
    }

    func releaseMagnetometer() {
        magnetometerUsers = max(0, magnetometerUsers - 1)
        if magnetometerUsers == 0, manager.isMagnetometerActive { manager.stopMagnetometerUpdates() }
    }
}

/// Device axes (x right, y toward the top edge) onto screen axes (x right,
/// y down) for the current interface orientation.
func mfxScreenVector(_ x: Double, _ y: Double, _ orientation: UIInterfaceOrientation) -> CGVector {
    switch orientation {
    case .landscapeLeft: return CGVector(dx: -y, dy: -x)
    case .landscapeRight: return CGVector(dx: y, dy: x)
    case .portraitUpsideDown: return CGVector(dx: -x, dy: y)
    default: return CGVector(dx: x, dy: -y)
    }
}

// MARK: - Magnet

/// Which way a magnet pushes the metal.
public enum MetalMagnetPolarity: String, CaseIterable, Identifiable, Sendable {
    /// From the field's vertical component: one face attracts, the other repels.
    case auto
    case attract
    case repel
    public var id: String { rawValue }
}

/// A trained direction: where the magnet was (its angle around the ring,
/// screen axes) and the field direction that put on the sensor.
public struct MetalMagnetTemplate: Codable, Equatable, Sendable {
    /// Radians, screen axes (x right, y down), from `MetalMagnetConfig.templateOrigin`
    /// (or from the ring's centre when there is none).
    public var angle: Double
    /// Unit vector, device axes.
    public var field: SIMD3<Double>
    /// How far from the origin the magnet was, pt. With it (and an origin)
    /// the magnet's position is estimated (`reading.position`).
    public var distance: Double?
    /// Field strength at this spot, µT. A magnet on a side of the phone
    /// nearer the sensor reads stronger, which separates sides whose field
    /// directions look alike.
    public var strength: Double?

    /// `field` may be the raw change in µT (its length becomes `strength`)
    /// or a unit vector.
    public init(angle: Double, field: SIMD3<Double>, distance: Double? = nil, strength: Double? = nil) {
        self.angle = angle
        let l = simd_length(field)
        self.field = l > 0 ? field / l : SIMD3(1, 0, 0)
        self.distance = distance
        self.strength = strength ?? (l > 1.5 ? l : nil)
    }
}

/// How a magnetometer reading becomes a pull on the metal.
public struct MetalMagnetConfig: Equatable, Sendable {
    /// Field change, µT, that reads as full pull. 60 suits a small fridge
    /// magnet held close; a neodymium one reaches thousands.
    public var fullScale: Double = 60
    /// Knee of the log scale, µT: pull = log(1 + B/scale) / log(1 + full/scale).
    /// Smaller = more of the range goes to weak, distant fields.
    public var scale: Double = 10
    /// Change below this, µT, is noise (Earth's field wobbles with handling).
    public var deadzone: Double = 3
    /// Low-pass time constant on the reading, s.
    public var smoothing: Double = 0.06
    public var polarity: MetalMagnetPolarity = .auto
    /// Swap which face attracts in `.auto`.
    public var invertPolarity = false
    /// Re-zero once the phone has settled in a new pose (picked up, turned).
    public var autoRecalibrate = true
    /// Attitude change, degrees, that counts as a new pose.
    public var poseTolerance: Double = 10
    /// Stillness needed before re-zeroing in a new pose, s.
    public var settleSeconds: Double = 0.8
    /// Where the magnetometer sits, in global (window) points. With it, each
    /// ring aims at the estimated magnet position instead of sharing the
    /// sensor's bearing. Find it by sliding a magnet over the back of the
    /// phone and watching for the peak.
    public var sensorPosition: CGPoint? = nil
    /// Distance estimate r(cm) = k · B(µT)^(-1/3) — a dipole's 1/r³ fall-off.
    /// 16 fits a fridge magnet (~500 µT at 2 cm).
    public var distanceK: Double = 16
    /// Screen points per centimetre (an iPhone is ~60).
    public var pointsPerCm: Double = 60
    /// Trained directions (3+; 8 around the phone is good). With them the
    /// bearing is read off your phone, sensor spot and grip instead of a
    /// dipole guess, and a flipped magnet is told apart from one on the
    /// opposite side by its full 3-D field. See `MetalMagnetTemplate`.
    public var templates: [MetalMagnetTemplate] = []
    /// Global point the template angles were measured from (the screen's
    /// centre in the demo's trainer).
    public var templateOrigin: CGPoint? = nil
    /// How strongly the nearest trained spot wins over its neighbours when
    /// matching (softmax on the squared feature distance).
    public var templateSharpness: Double = 20
    /// Weight of log field strength in the match (templates that carry a
    /// `strength`). Far from the sensor, spots on different sides of the
    /// phone give near-identical field directions but different strengths;
    /// in a model of an iPhone 15 Pro with its sensor near the top this took
    /// right-edge vs bottom-edge from coin-flip to ~65–100 % correct.
    public var templateStrengthWeight: Double = 2
    /// Weight of the vertical component when matching. Far from the sensor a
    /// flat magnet's field is almost vertical and the position lives in the
    /// small sideways part (1–3 µT next to 10–20 µT vertical on an iPhone 15
    /// Pro with a fridge magnet at the bottom): down-weighting the vertical
    /// part lets that sideways part decide, while how vertical the field is
    /// still separates near from far.
    public var templateVerticalWeight: Double = 0.35
    /// Slow drift (temperature, parts of the phone magnetised by a magnet
    /// that came too close) is re-zeroed with this time constant, s, while
    /// the field is weak and steady. Measured on a real phone: ~4.5 µT left
    /// behind after a magnet was taken away — as large as the signal.
    public var driftSeconds: Double = 2.0
    /// Below this change, µT, a steady field counts as drift (nil: the larger
    /// of 5 µT and 8 % of `fullScale`).
    public var driftThreshold: Double? = nil
    /// Rings follow the side of the phone the magnet is on (the trained
    /// bearing from `templateOrigin`). Within about this distance of a ring,
    /// pt, they can turn to aim at the magnet's estimated position instead.
    /// Off (0) by default: where the sensor is far from the magnet the
    /// position estimate is a blend of look-alike spots, and on a real
    /// iPhone 15 Pro it landed beside a bottom-right button often enough to
    /// pull the ring left or up. Turn it on only with a well-resolved training.
    public var aimRadius: Double = 0

    public init() {}
    public static let `default` = MetalMagnetConfig()
}

/// One magnetometer frame, relative to the calibrated baseline.
public struct MetalMagnetReading: Equatable, Sendable {
    /// A magnetometer (or a simulated field) is feeding the source.
    public var available = false
    /// A baseline has been taken.
    public var calibrated = false
    /// Calibrating right now — keep magnets away.
    public var calibrating = false
    /// Raw field, µT, device axes (x right, y top, z out of the screen).
    public var raw = SIMD3<Double>(0, 0, 0)
    /// Low-passed field minus the baseline, µT, device axes.
    public var delta = SIMD3<Double>(0, 0, 0)
    /// |delta|, µT.
    public var strength = 0.0
    /// 0…1, log scale of `strength`.
    public var pull = 0.0
    /// Unit vector in screen axes from the sensor toward the magnet; zero when unknown.
    public var toward = CGVector.zero
    /// +1 attracts, −1 repels.
    public var polarity = 1.0
    /// Rough distance, cm (∞ without a field).
    public var distance = Double.infinity
    /// The phone has left its calibration pose; re-zeroing once it settles.
    public var moving = false
    /// The bearing comes from trained directions.
    public var trained = false
    /// Estimated magnet position, global points (trained with distances).
    public var position: CGPoint?

    public init() {}
}

/// What a ring feels from a magnet (or a finger, or any driver).
public struct MetalMagnetSample: Equatable, Sendable {
    /// 0…1.
    public var pull: Double
    /// Unit vector in screen axes from the ring toward the magnet.
    public var toward: CGVector
    /// +1 attracts, −1 repels.
    public var polarity: Double

    public init(pull: Double, toward: CGVector, polarity: Double = 1) {
        self.pull = pull; self.toward = toward; self.polarity = polarity
    }

    public static let none = MetalMagnetSample(pull: 0, toward: .zero, polarity: 1)
}

/// The phone's magnetometer as a magnet detector. A nearby magnet bends the
/// field the sensor reads; against a baseline taken with no magnet near
/// (Earth plus the phone's own magnets, e.g. MagSafe), the change gives a
/// closeness (log scale), a rough bearing (±30°), and a polarity. No
/// permission is needed. Earth's 25–65 µT is small next to a fridge magnet a
/// few cm away (hundreds of µT); a dipole falls off as 1/r³, so the range is
/// a few cm for a fridge magnet and ~10 cm for a neodymium one.
///
/// Bearing: a flat magnet on the table sits a little below the sensor, so
/// its in-plane field points along the line to the sensor and its vertical
/// field gives the face (north up reads Bz < 0 beside the phone, and
/// attracts). The direction toward the magnet is `sign(Bz) · B_xy` — it
/// survives flipping the magnet, which flips both.
public final class MetalMagnetSource {
    public static let shared = MetalMagnetSource()

    public var config = MetalMagnetConfig.default
    /// Feed a raw field by hand, µT in device axes (Simulator, tests, a
    /// recorded trace). Takes precedence over the sensor.
    public var simulatedField: SIMD3<Double>?
    /// With a simulated field: the field with the simulated magnet lifted
    /// away. Calibration averages this, so a magnet already in place still reads.
    public var simulatedAmbient: SIMD3<Double>?
    /// Interface orientation used to map device axes onto the screen.
    public var orientation: UIInterfaceOrientation = .portrait
    /// Pause the drift re-zero (a trainer holding a magnet still at a weak spot).
    public var holdBaseline = false

    public var isSensorAvailable: Bool { MetalMotion.shared.manager.isMagnetometerAvailable }

    private var subscribers = 0
    private var baseline: SIMD3<Double>?
    private var calStart: TimeInterval = -1
    private var calSum = SIMD3<Double>(0, 0, 0)
    private var calCount = 0
    private var calAttitude: CMAttitude?
    private var smoothed: SIMD3<Double>?
    private var lastSign = 1.0
    private var lastToward = CGVector.zero
    private var lastPolarity = 1.0
    private var lastFlipped = false
    private var lastPosition: CGPoint?
    private var lastT: TimeInterval = 0
    private var stillSince: TimeInterval = -1
    private var recent: [(t: TimeInterval, v: SIMD3<Double>)] = []
    private var quietSince: TimeInterval = -1
    private var cachedNow: TimeInterval = -1
    private var cached = MetalMagnetReading()

    private static let settleDelay = 0.25
    private static let calDuration = 0.35

    private init() {}

    public func attach() {
        subscribers += 1
        guard subscribers == 1 else { return }
        MetalMotion.shared.retainMagnetometer()
        MetalMotion.shared.retainDeviceMotion()
        if baseline == nil { calibrate() }
    }

    public func detach() {
        subscribers = max(0, subscribers - 1)
        guard subscribers == 0 else { return }
        MetalMotion.shared.releaseMagnetometer()
        MetalMotion.shared.releaseDeviceMotion()
        smoothed = nil
    }

    /// Take a new baseline over the next ~0.6 s. Keep magnets away.
    public func calibrate() {
        calStart = 0   // starts on the next frame
        calSum = .zero
        calCount = 0
    }

    /// The current reading. Evaluated once per frame; every ring shares it.
    public func reading(now: TimeInterval) -> MetalMagnetReading {
        if now == cachedNow { return cached }
        cachedNow = now
        cached = compute(now: now)
        return cached
    }

    /// What a ring centred at `center` (global points) feels this frame.
    public func sample(center: CGPoint, now: TimeInterval) -> MetalMagnetSample {
        let r = reading(now: now)
        guard r.pull > 0, r.toward != .zero else { return MetalMagnetSample(pull: r.pull, toward: r.toward, polarity: r.polarity) }
        var dir = r.toward
        if let p = r.position, config.aimRadius > 0 {
            // Near the ring, aim at the magnet; further away, keep the side.
            let vx = Double(p.x - center.x), vy = Double(p.y - center.y)
            let l = hypot(vx, vy)
            if l > 1 {
                let w = 1 - ss(config.aimRadius * 0.5, config.aimRadius * 1.4, l)
                let bx = Double(dir.dx) * (1 - w) + vx / l * w, by = Double(dir.dy) * (1 - w) + vy / l * w
                let bl = hypot(bx, by)
                if bl > 1e-6 { dir = CGVector(dx: bx / bl, dy: by / bl) }
            }
        } else if let s = config.sensorPosition, r.distance.isFinite {
            let d = r.distance * config.pointsPerCm
            let mx = Double(s.x) + Double(dir.dx) * d, my = Double(s.y) + Double(dir.dy) * d
            let vx = mx - Double(center.x), vy = my - Double(center.y)
            let l = hypot(vx, vy)
            if l > 1 { dir = CGVector(dx: vx / l, dy: vy / l) }
        }
        return MetalMagnetSample(pull: r.pull, toward: dir, polarity: r.polarity)
    }

    /// Bearing from trained directions: a blend of the trained spots whose
    /// field looks most like the reading (softmax on the cosine, sharpness
    /// `templateSharpness`), averaged on the circle. Fields are compared with
    /// the vertical part down-weighted (`templateVerticalWeight`) so the small
    /// sideways part, which carries the position far from the sensor, decides.
    /// The reversed field is tried too (a flipped magnet); the better match
    /// wins, with hysteresis.
    private func match(_ d: SIMD3<Double>, _ ts: [MetalMagnetTemplate]) -> (angle: Double, flipped: Bool, distance: Double?)? {
        guard ts.count >= 3 else { return nil }
        let lam = max(0.01, config.templateVerticalWeight)
        func feature(_ x: SIMD3<Double>) -> SIMD3<Double> {
            let w = SIMD3(x.x, x.y, x.z * lam)
            let l = simd_length(w)
            return l > 0 ? w / l : w
        }
        let v = feature(d)
        let fields = ts.map { feature($0.field) }
        let kappa = max(1, config.templateSharpness)
        let mu = max(0, config.templateStrengthWeight)
        let useStrength = mu > 0 && ts.allSatisfy { $0.strength != nil }
        let logB = log(max(1e-3, simd_length(d)))
        let logs = ts.map { log(max(1e-3, $0.strength ?? 1)) }
        // Score = minus the squared distance in (weighted direction, μ·ln|B|).
        func blend(_ x: SIMD3<Double>) -> (score: Double, angle: Double, distance: Double?) {
            var dists: [Double] = []
            dists.reserveCapacity(ts.count)
            for i in ts.indices {
                var q = simd_length_squared(x - fields[i])
                if useStrength { let e = mu * (logB - logs[i]); q += e * e }
                dists.append(q)
            }
            let best = dists.min() ?? 0
            var cx = 0.0, cy = 0.0, wsum = 0.0, dsum = 0.0
            var hasDistance = true
            for (t, q) in zip(ts, dists) {
                let w = exp(-kappa * (q - best))
                cx += w * cos(t.angle); cy += w * sin(t.angle); wsum += w
                if let dist = t.distance { dsum += w * dist } else { hasDistance = false }
            }
            return (-best, atan2(cy, cx), hasDistance && wsum > 0 ? dsum / wsum : nil)
        }
        let p = blend(v), q = blend(-v)
        let flipped = lastFlipped ? !(p.score > q.score + 0.24) : (q.score > p.score + 0.24)
        return flipped ? (q.angle, true, q.distance) : (p.angle, false, p.distance)
    }

    private func rawField() -> SIMD3<Double>? {
        if let f = simulatedField { return f }
        guard let m = MetalMotion.shared.manager.magnetometerData?.magneticField else { return nil }
        return SIMD3(m.x, m.y, m.z)
    }

    private func compute(now: TimeInterval) -> MetalMagnetReading {
        var out = MetalMagnetReading()
        guard let raw = rawField() else { return out }
        out.available = true
        out.raw = raw
        let cfg = config
        let dt = lastT > 0 ? min(0.1, max(0.001, now - lastT)) : 1.0 / 60.0
        lastT = now

        var s = smoothed ?? raw
        s += (raw - s) * (1 - exp(-dt / max(0.005, cfg.smoothing)))
        smoothed = s

        // Calibration: let the reading settle, then average.
        if calStart >= 0 {
            if calStart == 0 { calStart = now }
            out.calibrating = true
            out.calibrated = baseline != nil
            let age = now - calStart
            if age >= Self.settleDelay {
                calSum += simulatedField != nil ? (simulatedAmbient ?? raw) : raw
                calCount += 1
            }
            if age >= Self.settleDelay + Self.calDuration, calCount > 0 {
                baseline = calSum / Double(calCount)
                smoothed = baseline
                calAttitude = MetalMotion.shared.manager.deviceMotion?.attitude.copy() as? CMAttitude
                calStart = -1
                stillSince = -1
            }
            return out
        }
        guard let base = baseline else { calibrate(); return out }
        out.calibrated = true

        // New pose (picked up, turned on the table): Earth's field now reads
        // differently in device axes, so re-zero once the phone settles.
        if simulatedField == nil, cfg.autoRecalibrate, let ref = calAttitude, let dm = MetalMotion.shared.manager.deviceMotion {
            let att = dm.attitude.copy() as! CMAttitude
            att.multiply(byInverseOf: ref)
            let q = att.quaternion
            let angle = 2 * acos(min(1, abs(q.w))) * 180 / .pi
            if angle > cfg.poseTolerance {
                out.moving = true
                let r = dm.rotationRate
                let still = sqrt(r.x * r.x + r.y * r.y + r.z * r.z) < 0.12
                if still {
                    if stillSince < 0 { stillSince = now }
                    if now - stillSince > cfg.settleSeconds { calibrate() }
                } else {
                    stillSince = -1
                }
            } else {
                stillSince = -1
            }
        }

        // Drift: while the change is weak and steady, ease the baseline onto it.
        recent.append((now, s))
        recent.removeAll { now - $0.t > 0.8 }
        var steady = recent.count >= 4
        if steady {
            var mean = SIMD3<Double>(0, 0, 0)
            for e in recent { mean += e.v }
            mean /= Double(recent.count)
            steady = recent.allSatisfy { simd_length($0.v - mean) < 0.8 }
        }
        var zero = base
        if !holdBaseline, simd_length(s - zero) < (cfg.driftThreshold ?? max(5, 0.08 * cfg.fullScale)) && steady {
            if quietSince < 0 { quietSince = now }
            if now - quietSince > 0.6 {
                zero += (s - zero) * (1 - exp(-dt / max(0.2, cfg.driftSeconds)))
                baseline = zero
            }
        } else {
            quietSince = -1
        }

        let d = s - zero
        out.delta = d
        let strength = simd_length(d)
        out.strength = strength
        let b = max(0, strength - cfg.deadzone)
        let k = max(0.5, cfg.scale)
        out.pull = min(1, log10(1 + b / k) / max(0.01, log10(1 + max(1, cfg.fullScale - cfg.deadzone) / k)))
        if strength > 1 { out.distance = cfg.distanceK * pow(strength, -1.0 / 3.0) }

        // Face: the vertical component's sign, with hysteresis near zero.
        if abs(d.z) > 0.15 * strength + 0.5 { lastSign = d.z >= 0 ? 1 : -1 }
        let inPlane = hypot(d.x, d.y)
        var flippedFace = lastFlipped
        if out.pull > 0, cfg.templates.count >= 3 {
            out.trained = true
            // Trained: read the bearing off the templates, and tell a flipped
            // magnet from one on the far side by the full 3-D match.
            if let m = match(d, cfg.templates) {
                lastToward = CGVector(dx: cos(m.angle), dy: sin(m.angle))
                flippedFace = m.flipped
                lastFlipped = m.flipped
                if let o = cfg.templateOrigin, let dist = m.distance {
                    lastPosition = CGPoint(x: Double(o.x) + cos(m.angle) * dist, y: Double(o.y) + sin(m.angle) * dist)
                } else {
                    lastPosition = nil
                }
            }
            out.position = lastPosition
        } else if out.pull > 0, inPlane > 0.06 * strength + 1.5 {
            // Untrained: a magnet lying flat (vertical field) gives its side by
            // sign(Bz); one facing the phone's edge (in-plane field) does not,
            // so keep the side it had instead of flipping on noise.
            let flat = abs(d.z) > 0.6 * strength
            var side: Double
            if flat {
                side = lastSign
            } else {
                let raw = mfxScreenVector(d.x / inPlane, d.y / inPlane, orientation)
                side = lastToward == .zero ? -1 : (raw.dx * lastToward.dx + raw.dy * lastToward.dy >= 0 ? 1 : -1)
            }
            lastToward = mfxScreenVector(side * d.x / inPlane, side * d.y / inPlane, orientation)
            if flat { lastPolarity = -lastSign }
        } else if out.pull == 0 {
            lastToward = .zero
            lastPosition = nil
        }
        out.toward = lastToward

        let inv = cfg.invertPolarity ? -1.0 : 1.0
        switch cfg.polarity {
        case .attract: out.polarity = 1
        case .repel: out.polarity = -1
        case .auto:
            // Trained: the face you trained with attracts, the other repels.
            // Untrained: a flat magnet north face up (Bz < 0) attracts.
            out.polarity = (out.trained ? (flippedFace ? -1 : 1) : lastPolarity) * inv
        }
        return out
    }
}

// MARK: - Manual and pointer drivers

/// Drive the metal with any field — audio bass, a game, a recorded trace.
/// Set the values from anywhere on the main thread; rings read them every frame.
public final class MetalMagnetDriver {
    public var pull: Double = 0
    /// Unit vector in screen axes toward the "magnet".
    public var toward: CGVector = CGVector(dx: 0, dy: -1)
    public var polarity: Double = 1

    public init() {}
    public var sample: MetalMagnetSample { MetalMagnetSample(pull: pull, toward: toward, polarity: polarity) }
}

/// A finger as the desktop cursor. Install `.metalPointerTracking()` on a
/// root view; rings with `source: .pointer` then bend toward the touch
/// exactly as the web's hover bend does toward the mouse.
public final class MetalPointerSource {
    public static let shared = MetalPointerSource()
    /// Global (window) location of the touch, or nil.
    public var location: CGPoint?
    private init() {}
}

struct MetalPointerTracking: ViewModifier {
    func body(content: Content) -> some View {
        content.simultaneousGesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .onChanged { MetalPointerSource.shared.location = $0.location }
                .onEnded { _ in MetalPointerSource.shared.location = nil }
        )
    }
}

public extension View {
    /// Track touches anywhere in this view for rings with `source: .pointer`.
    func metalPointerTracking() -> some View { modifier(MetalPointerTracking()) }
}

// MARK: - Simulated magnet

/// A dipole on the table, for the Simulator and for tuning without a magnet:
/// the field it puts on a sensor, in the magnetometer's device axes.
public enum MetalMagnetSimulator {
    /// - Parameters:
    ///   - magnet / sensor: global points on the screen plane.
    ///   - northUp: which face points up.
    ///   - moment: µT·cm³ (4800 ≈ 600 µT 2 cm to the side — a small neodymium disc).
    ///   - depth: how far below the sensor the magnet's centre sits, cm.
    public static func field(magnet: CGPoint, sensor: CGPoint, northUp: Bool, moment: Double = 4800,
                             depth: Double = 0.3, pointsPerCm: Double = 60) -> SIMD3<Double> {
        // Device axes: x right, y toward the top edge, z out of the screen.
        let r = SIMD3(Double(sensor.x - magnet.x) / pointsPerCm, -Double(sensor.y - magnet.y) / pointsPerCm, depth)
        let len = max(0.4, simd_length(r))
        let rh = r / simd_length(r)
        let m = SIMD3<Double>(0, 0, northUp ? 1 : -1)
        return moment * (3 * simd_dot(m, rh) * rh - m) / (len * len * len)
    }

    /// Earth's field plus a little hard-iron bias, as an unmoving phone reads it.
    public static let ambient = SIMD3<Double>(14, -21, -38)
}
