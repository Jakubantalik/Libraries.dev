import SwiftUI
import CoreMotion
import simd

// MARK: - Shared CoreMotion manager

/// One `CMMotionManager` for the app (Apple asks for one per app): the
/// magnet reads the magnetometer; other libraries that need device motion
/// (MetalFxKit's tilt bend) share it rather than starting their own.
public final class MagnetMotion {
    public static let shared = MagnetMotion()
    public let manager = CMMotionManager()
    private var deviceMotionUsers = 0
    private var magnetometerUsers = 0

    private init() {}

    public func retainDeviceMotion() {
        deviceMotionUsers += 1
        guard deviceMotionUsers == 1, manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 60.0
        manager.startDeviceMotionUpdates()
    }

    public func releaseDeviceMotion() {
        deviceMotionUsers = max(0, deviceMotionUsers - 1)
        if deviceMotionUsers == 0, manager.isDeviceMotionActive { manager.stopDeviceMotionUpdates() }
    }

    public func retainMagnetometer() {
        magnetometerUsers += 1
        guard magnetometerUsers == 1, manager.isMagnetometerAvailable, !manager.isMagnetometerActive else { return }
        manager.magnetometerUpdateInterval = 1.0 / 100.0
        manager.startMagnetometerUpdates()
    }

    public func releaseMagnetometer() {
        magnetometerUsers = max(0, magnetometerUsers - 1)
        if magnetometerUsers == 0, manager.isMagnetometerActive { manager.stopMagnetometerUpdates() }
    }
}

/// Device axes (x right, y toward the top edge) onto screen axes (x right,
/// y down) for the current interface orientation.
func magnetScreenVector(_ x: Double, _ y: Double, _ orientation: UIInterfaceOrientation) -> CGVector {
    switch orientation {
    case .landscapeLeft: return CGVector(dx: -y, dy: -x)
    case .landscapeRight: return CGVector(dx: y, dy: x)
    case .portraitUpsideDown: return CGVector(dx: -x, dy: y)
    default: return CGVector(dx: x, dy: -y)
    }
}

// MARK: - Magnet

/// How `MagnetConfig.locatorEnabled` finds the magnet.
public enum MagnetLocatorMode: String, Sendable {
    case network, dipole
}

/// Which way a magnet pushes what it drives: attract, repel, or by its face.
public enum MagnetPolarity: String, CaseIterable, Identifiable, Sendable {
    /// From the field's vertical component: one face attracts, the other repels.
    case auto
    case attract
    case repel
    public var id: String { rawValue }
}

/// A trained direction: where the magnet was (its angle around the origin,
/// screen axes) and the field direction that put on the sensor.
public struct MagnetTemplate: Codable, Equatable, Sendable {
    /// Radians, screen axes (x right, y down), from `MagnetConfig.templateOrigin`
    /// (or from the driven view's centre when there is none).
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

/// A quick magnet movement, read from how fast the field grows or fades
/// (and, with the locator, from how fast the located point moves).
public enum MagnetGesture: Equatable, Sendable {
    /// Pushed quickly toward the phone; approach speed, cm/s.
    case push(speed: Double)
    /// Pulled quickly away; retreat speed, cm/s.
    case pullAway(speed: Double)
    /// An air tap: hovering over the glass, dipped quickly toward the screen
    /// and brought back (the tap network, `config.tapModel`; without it, a
    /// push and a pull-away in quick succession). `at`: the located point,
    /// global screen points, when the locator is on.
    case tap(at: CGPoint?)
    /// Swept across the screen (needs the locator); unit direction and speed, pt/s.
    case swipe(direction: CGVector, speed: Double)
}

/// How a magnetometer reading becomes a magnet reading.
public struct MagnetConfig: Equatable, Sendable {
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
    public var polarity: MagnetPolarity = .auto
    /// Swap which face attracts in `.auto`.
    public var invertPolarity = false
    /// Re-zero once the phone has settled in a new pose (picked up, turned).
    public var autoRecalibrate = true
    /// Attitude change, degrees, that counts as a new pose.
    public var poseTolerance: Double = 10
    /// Stillness needed before re-zeroing in a new pose, s.
    public var settleSeconds: Double = 0.8
    /// Where the magnetometer sits, in global (window) points. With it, views
    /// can aim at the estimated magnet position instead of sharing the
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
    /// opposite side by its full 3-D field. See `MagnetTemplate`.
    public var templates: [MagnetTemplate] = []
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
    /// Re-zero the offset an overload leaves: a magnet brought within ~2 cm
    /// of the sensor (above `tooCloseStrength`) can magnetise parts of the
    /// phone, shifting its no-magnet reading by 50–250 µT for minutes — a
    /// phantom magnet that drowns a real one anywhere but next to the sensor.
    /// It shows right after such an overload, when the magnet is yanked away:
    /// the field falls by 85 %+ within a second and what remains settles
    /// (within ~3.5 µT) a few seconds later. If that happens within 10 s of
    /// the drop, it is zeroed (and the old zero restored if the field later
    /// comes back to it).
    /// A magnet simply set down near the phone is left alone.
    public var steadyRezero = true
    /// Above this field change, µT, `MagnetReading.tooClose` is set:
    /// close enough to the sensor to start magnetising the phone.
    public var tooCloseStrength = 2000.0
    /// Run the presence network (`MagnetPresence`, bundled): readings
    /// carry `presence` (is there really a magnet, from the last 15 s) and
    /// `offsetEstimate`; the pull fades with presence, and a confident "no
    /// magnet" with a steady field re-zeros the sensor (replacing the
    /// overload rule of `steadyRezero`, which stays as the fallback).
    public var presenceModel = true
    /// Recognise air taps with the bundled network (`MagnetTap`):
    /// a dip of the hovering magnet toward the glass and back fires
    /// `.tap(at:)`, and the push-then-pull-away rule no longer does.
    public var tapModel = true
    /// Locate the magnet over the screen with the bundled network
    /// (`MagnetLocator`); needs `sensorPosition`. Readings then carry
    /// `screenPosition`, and views can aim at it.
    public var locatorEnabled = false
    /// The magnet's dipole constant, µT·cm³, if known (a 10×8×2 mm N52 ring
    /// is ~6500, a 12×5 mm disc ~65000); nil lets the network assume any.
    public var magnetStrength: Double? = nil
    /// Which face of the magnet points at the screen: +1 north toward the
    /// user, −1 south, nil unknown. Known, the locator is sure on every side
    /// of the sensor; unknown, it assumes the magnet is below the sensor
    /// when the reading could mean either side.
    public var magnetFace: Int? = nil
    /// How the locator works: `.network` (MagnetLocator, best over the
    /// glass, copes without the face) or `.dipole` (MagnetDipole: the
    /// physics solved directly; needs `magnetFace`, works over the glass and
    /// beside the phone alike). `.dipole` falls back to the network while
    /// the face is unknown.
    public var locatorMode: MagnetLocatorMode = .network
    /// `.dipole` only: the highest the magnet is taken to be above the
    /// sensor, cm (see `MagnetDipole.locate(maxHeight:)`).
    public var dipoleMaxHeight: Double? = 4
    /// A magnet resting on the desk beside the phone sits at about the
    /// sensor's height: its field is almost vertical and the sideways part
    /// that carries the bearing is a few % — a slight tilt swings it by 50°
    /// (measured on an iPhone 15 Pro). Its distance is still sure
    /// (|B| ≈ K / r³) and so is its side (the sideways part's sign). With
    /// this on, such a reading is placed beside that edge (~1.5 cm out, below
    /// the sensor's height) at that distance, instead of trusting the bearing.
    /// Needs `magnetFace` and `sensorPosition`; portrait only.
    public var deskPrior = true
    /// Gestures: a push or pull-away fires above this rate of change of
    /// ln|B| per second (5 ≈ the distance shrinking or growing by ~1.8× a second).
    public var gesturePushRate: Double = 5
    public var gesturePullRate: Double = 5
    /// A push then a pull-away within this many seconds is a tap.
    public var gestureTapWindow: Double = 0.45
    /// Gestures need at least this much pull (the magnet properly near).
    public var gestureMinPull: Double = 0.2
    /// With the locator: a sweep faster than this, pt/s, is a swipe.
    public var gestureSwipeSpeed: Double = 1500
    /// Views driven by the magnet (MetalFxKit's rings, for one) follow the
    /// side of the phone it is on (the trained bearing from `templateOrigin`).
    /// Within about this distance of a view, pt, they can turn to aim at the
    /// magnet's estimated position instead.
    /// Off (0) by default: where the sensor is far from the magnet the
    /// position estimate is a blend of look-alike spots, and on a real
    /// iPhone 15 Pro it landed beside a bottom-right button often enough to
    /// pull a ring left or up. Turn it on only with a well-resolved training.
    public var aimRadius: Double = 0

    public init() {}
    public static let `default` = MagnetConfig()
}

/// One magnetometer frame, relative to the calibrated baseline.
public struct MagnetReading: Equatable, Sendable {
    /// A magnetometer (or a simulated field) is feeding the source.
    public var available = false
    /// A baseline has been taken.
    public var calibrated = false
    /// Calibrating right now — keep magnets away.
    public var calibrating = false
    /// The magnet is close enough to the sensor (see
    /// `MagnetConfig.tooCloseStrength`) to leave an offset in the phone:
    /// worth telling the user to keep it a little farther.
    public var tooClose = false
    /// The presence network's answer (0–1): is the field a real magnet, or
    /// the phone's own leftover offset / drift. 1 when the network is off.
    public var presence: Double = 1
    /// The presence network's estimate of the part of `delta` that is not a
    /// magnet, µT (reliable once the magnet is gone; rough while one is near).
    public var offsetEstimate = SIMD3<Double>(0, 0, 0)
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
    /// With the locator: where the magnet is over the screen, global points
    /// (smoothed), its 1-σ spread in points, and its height above the glass, cm.
    public var screenPosition: CGPoint?
    public var screenSpread: Double = 0
    public var height: Double?
    /// How fast the field is growing, ln|B| per second (+ approaching, − leaving).
    public var approachRate: Double = 0
    /// The same as a speed, cm/s (+ toward the phone), from the distance estimate.
    public var approachSpeed: Double = 0
    /// With the locator: how fast the located point moves over the screen, pt/s.
    public var lateralVelocity: CGVector = .zero

    public init() {}
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
public final class MagnetSource {
    public static let shared = MagnetSource()

    public var config = MagnetConfig.default
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

    public var isSensorAvailable: Bool { MagnetMotion.shared.manager.isMagnetometerAvailable }

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
    private var located: CGPoint?
    /// Recent raw locator targets, for the weak-field median.
    private var targets: [(t: Double, p: CGPoint)] = []
    private var locatedDistance: Double?
    // Motion and gestures.
    private var lnHistory: [(t: TimeInterval, ln: Double, r: Double)] = []
    private var posHistory: [(t: TimeInterval, p: CGPoint)] = []
    private var motionRate = 0.0
    private var pullHistory: [(t: TimeInterval, pull: Double)] = []
    private var pushed = false
    private var lastPushT: TimeInterval = -10
    private var lastPullT: TimeInterval = -10
    private var lastSwipeT: TimeInterval = -10
    private var gestureHandlers: [UUID: (MagnetGesture) -> Void] = [:]
    private var lastT: TimeInterval = 0
    /// The current overload episode (reading above `tooCloseStrength`): its
    /// peak and when it was last over; and until when to watch for a leftover.
    private var overloadPeak = 0.0
    private var overloadAt: TimeInterval = -10
    private var leftoverWatchUntil: TimeInterval = -10
    private var stillSince: TimeInterval = -1
    private var recent: [(t: TimeInterval, v: SIMD3<Double>)] = []
    private var quietSince: TimeInterval = -1
    /// Since when a strong reading has held perfectly still (a phantom).
    private var phantomSince: TimeInterval = -1
    /// Raw readings for the presence network (≈ its 15 s window), its last
    /// answer, smoothed, and when it last ran.
    private var rawHistory: [(t: TimeInterval, v: SIMD3<Double>)] = []
    private var presence = 1.0
    private var offsetEstimate = SIMD3<Double>(0, 0, 0)
    private var presenceAt: TimeInterval = 0
    /// When the phone was last overloaded, while it has not been zeroed since
    /// (its parts may still be magnetised: a leftover of up to a few hundred
    /// µT that lasts minutes), and the field's recent size — the presence
    /// network is told about the overload only right after the field drops.
    private var overloadedAt: TimeInterval?
    private var recentSize: [(t: TimeInterval, s: Double)] = []
    /// The tap network: its last answer, when it ran, whether it is still
    /// above the threshold since firing, and recent located points (the tap
    /// lands where the field was strongest — the bottom of the dip).
    private var tapP = 0.0
    private var tapAt: TimeInterval = 0
    private var tapHigh = false
    private var lastTapT: TimeInterval = -10
    private var tapPoints: [(t: TimeInterval, p: CGPoint, s: Double)] = []
    /// The zero from before the last phantom re-zero, and when: if the field
    /// comes back to it, what was zeroed was a magnet set down (now lifted
    /// away), not an offset — restore it at once.
    private var zeroBeforePhantom: SIMD3<Double>?
    private var zeroBeforePhantomAt: TimeInterval = 0
    /// Recent no-magnet readings (from calibrations), kept across launches:
    /// when the field settles back onto one, that is the zero — e.g. a
    /// magnet that was lying next to the phone during a calibration and has
    /// now been taken away.
    private var knownZeros: [(v: SIMD3<Double>, t: Double)] = MagnetSource.loadZeros()
    private static let zerosKey = "MagnetKit.zeros"

    private static func loadZeros() -> [(v: SIMD3<Double>, t: Double)] {
        guard let a = UserDefaults.standard.array(forKey: zerosKey) as? [[Double]] else { return [] }
        let now = Date().timeIntervalSince1970
        return a.compactMap { e in e.count == 4 && now - e[3] < 2 * 86400 ? (SIMD3(e[0], e[1], e[2]), e[3]) : nil }
    }

    private func rememberZero(_ z: SIMD3<Double>) {
        let now = Date().timeIntervalSince1970
        knownZeros.removeAll { simd_length($0.v - z) < 2 || now - $0.t > 2 * 86400 }
        knownZeros.append((z, now))
        if knownZeros.count > 6 { knownZeros.removeFirst(knownZeros.count - 6) }
        UserDefaults.standard.set(knownZeros.map { [$0.v.x, $0.v.y, $0.v.z, $0.t] }, forKey: Self.zerosKey)
    }
    private var cachedNow: TimeInterval = -1
    private var cached = MagnetReading()

    private static let settleDelay = 0.25
    private static let calDuration = 0.35

    private init() {}

    public func attach() {
        subscribers += 1
        guard subscribers == 1 else { return }
        MagnetMotion.shared.retainMagnetometer()
        MagnetMotion.shared.retainDeviceMotion()
        if baseline == nil { calibrate() }
    }

    public func detach() {
        subscribers = max(0, subscribers - 1)
        guard subscribers == 0 else { return }
        MagnetMotion.shared.releaseMagnetometer()
        MagnetMotion.shared.releaseDeviceMotion()
        smoothed = nil
    }

    /// Be told about quick movements (push, pull away, tap, swipe). Handlers
    /// run on the main queue, outside view updates. Keep the id to remove it.
    @discardableResult
    public func addGestureHandler(_ handler: @escaping (MagnetGesture) -> Void) -> UUID {
        let id = UUID()
        gestureHandlers[id] = handler
        return id
    }

    public func removeGestureHandler(_ id: UUID) { gestureHandlers.removeValue(forKey: id) }

    private func fire(_ g: MagnetGesture) {
        let handlers = Array(gestureHandlers.values)
        DispatchQueue.main.async { handlers.forEach { $0(g) } }
    }

    /// Take a new baseline over the next ~0.6 s. Keep magnets away.
    public func calibrate() {
        zeroBeforePhantom = nil
        calStart = 0   // starts on the next frame
        calSum = .zero
        calCount = 0
    }

    /// One locator answer: the magnet relative to the sensor (cm, device
    /// axes) and a 1-σ spread, cm.
    private func locate(_ d: SIMD3<Double>, _ cfg: MagnetConfig) -> (position: SIMD3<Double>, spread: Double)? {
        let engine = engineLocate(d, cfg)
        guard cfg.deskPrior, let desk = deskPlacement(d, cfg) else { return engine }
        guard let e = engine else { return (desk.position, desk.spread) }
        let w = desk.weight
        return (e.position * (1 - w) + desk.position * w, e.spread * (1 - w) + desk.spread * w)
    }

    /// A magnet resting at desk height beside the phone (see `deskPrior`):
    /// placed beside the edge its field's sideways part points to, at the
    /// distance its strength gives. Weight 1 when the field is almost all
    /// vertical, fading out as the sideways share grows to 30 %.
    private func deskPlacement(_ d: SIMD3<Double>, _ cfg: MagnetConfig) -> (position: SIMD3<Double>, spread: Double, weight: Double)? {
        guard let face = cfg.magnetFace, let sensor = cfg.sensorPosition,
              orientation == .portrait || orientation == .unknown else { return nil }
        let nb = simd_length(d)
        guard nb > 1e-6 else { return nil }
        let f: Double = face < 0 ? -1 : 1
        // Beside the phone at its height the vertical part points against the face.
        guard f * d.z < 0 else { return nil }
        let inPlane = (d.x * d.x + d.y * d.y).squareRoot() / nb
        let w = min(1, max(0, (0.3 - inPlane) / 0.15))
        guard w > 0 else { return nil }
        let r = pow((cfg.magnetStrength ?? 30000) / nb, 1.0 / 3.0)
        // The sideways part points toward the magnet (north-up face, magnet a
        // little above the sensor); its side is reliable, its angle is not.
        var tx = f * d.x, ty = f * d.y
        let tl = (tx * tx + ty * ty).squareRoot()
        guard tl > 1e-6 else { return nil }
        tx /= tl; ty /= tl
        let b = UIScreen.main.bounds, ppcm = cfg.pointsPerCm
        // Screen edges relative to the sensor, cm, device axes (y toward the top).
        let left = -Double(sensor.x - b.minX) / ppcm, right = Double(b.maxX - sensor.x) / ppcm
        let top = Double(sensor.y - b.minY) / ppcm
        let gap = 1.5
        var x: Double, y: Double
        if ty > 0.85 {
            // Above the top edge.
            y = top + gap
            if r <= y { y = r; x = 0 } else { x = (tx >= 0 ? 1 : -1) * (r * r - y * y).squareRoot() }
        } else if ty < -0.85 {
            // Below the bottom edge, far from the sensor: the bearing will do.
            x = r * tx; y = r * ty
        } else {
            // Beside a long edge, below the sensor's height.
            let side: Double = tx >= 0 ? 1 : -1
            x = side > 0 ? right + gap : left - gap
            if r <= abs(x) { x = side * r; y = 0 } else { y = -(r * r - x * x).squareRoot() }
        }
        return (SIMD3(x, y, 0.5), 0.3 + 0.15 * r, w)
    }

    private func engineLocate(_ d: SIMD3<Double>, _ cfg: MagnetConfig) -> (position: SIMD3<Double>, spread: Double)? {
        if cfg.locatorMode == .dipole, let face = cfg.magnetFace,
           let r = MagnetDipole.locate(field: d, face: face, strength: cfg.magnetStrength ?? 30000, maxHeight: cfg.dipoleMaxHeight) {
            // The bearing rests on the field's in-plane share; a few degrees of
            // tilt move it by ~0.12 of the field, so a small share is fragile.
            let lateral = (r.position.x * r.position.x + r.position.y * r.position.y).squareRoot()
            let bearingSD = min(1.2, 0.12 / max(0.05, r.inPlane))
            let spread = 0.3 + 0.12 * simd_length(r.position) + lateral * bearingSD
            return (r.position, spread)
        }
        guard let loc = MagnetModel.bundled?.locator else { return nil }
        return loc.locate(field: d, strength: cfg.magnetStrength, face: cfg.magnetFace)
    }

    /// The current reading. Evaluated once per frame; every view shares it.
    public func reading(now: TimeInterval) -> MagnetReading {
        if now == cachedNow { return cached }
        cachedNow = now
        cached = compute(now: now)
        return cached
    }

    /// Bearing from trained directions: a blend of the trained spots whose
    /// field looks most like the reading (softmax on the cosine, sharpness
    /// `templateSharpness`), averaged on the circle. Fields are compared with
    /// the vertical part down-weighted (`templateVerticalWeight`) so the small
    /// sideways part, which carries the position far from the sensor, decides.
    /// The reversed field is tried too (a flipped magnet); the better match
    /// wins, with hysteresis.
    private func match(_ d: SIMD3<Double>, _ ts: [MagnetTemplate]) -> (angle: Double, flipped: Bool, distance: Double?)? {
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
        guard let m = MagnetMotion.shared.manager.magnetometerData?.magneticField else { return nil }
        return SIMD3(m.x, m.y, m.z)
    }

    private func compute(now: TimeInterval) -> MagnetReading {
        var out = MagnetReading()
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
                overloadedAt = nil
                if simulatedField == nil, let b = baseline { rememberZero(b) }
                smoothed = baseline
                calAttitude = MagnetMotion.shared.manager.deviceMotion?.attitude.copy() as? CMAttitude
                calStart = -1
                stillSince = -1
            }
            return out
        }
        guard let base = baseline else { calibrate(); return out }
        out.calibrated = true

        // New pose (picked up, turned on the table): Earth's field now reads
        // differently in device axes, so re-zero once the phone settles.
        if simulatedField == nil, cfg.autoRecalibrate, let ref = calAttitude, let dm = MagnetMotion.shared.manager.deviceMotion {
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
        var zero = base
        if let prev = zeroBeforePhantom {
            if now - zeroBeforePhantomAt > 120 {
                zeroBeforePhantom = nil
            } else if simd_length(s - prev) < max(2, 0.05 * simd_length(prev - zero)) {
                zero = prev; baseline = prev; zeroBeforePhantom = nil
            }
        }
        let away = simd_length(s - zero)
        let weak = away < (cfg.driftThreshold ?? max(5, 0.08 * cfg.fullScale))
        if away > cfg.tooCloseStrength {
            overloadPeak = max(overloadPeak, away); overloadAt = now
            overloadedAt = now
        } else if overloadPeak > 0 {
            if away < 0.15 * overloadPeak, now - overloadAt < 20 {
                // Taken away after an overload (quickly or not): what settles
                // next is the leftover (iPhone 15 Pro: still to ~2–3 µT in 1–8 s).
                leftoverWatchUntil = now + 10
                overloadPeak = 0
            } else if now - overloadAt > 20 {
                overloadPeak = 0
            }
        }
        var devMax = Double.infinity
        if recent.count >= 4 {
            var mean = SIMD3<Double>(0, 0, 0)
            for e in recent { mean += e.v }
            mean /= Double(recent.count)
            devMax = recent.map { simd_length($0.v - mean) }.max() ?? .infinity
        }
        // Presence: is this a magnet, or the sensor's own offset? (~30 Hz)
        let net = cfg.presenceModel ? MagnetModel.bundled?.presence : nil
        let tapNet = cfg.tapModel ? MagnetModel.bundled?.tap : nil
        if net != nil || tapNet != nil {
            rawHistory.append((now, raw))
            let keep = max(net.map { $0.window + 1 } ?? 0, tapNet.map { Double($0.window) / $0.hz + 0.5 } ?? 0)
            rawHistory.removeAll { now - $0.t > keep }
        }
        if let tapNet, now - tapAt >= 1.0 / 50 {
            // Air tap: the last ~1.3 s at the network's rate. (~50 Hz)
            tapAt = now
            let n = tapNet.window
            var h = [SIMD3<Double>](); h.reserveCapacity(n)
            var j = 0
            for k in 0..<n {
                let tk = now - Double(n - 1 - k) / tapNet.hz
                while j + 1 < rawHistory.count, rawHistory[j + 1].t <= tk { j += 1 }
                h.append(rawHistory[j].v - zero)
            }
            tapP = tapNet.evaluate(history: h)
        } else if tapNet == nil {
            tapP = 0
        }
        if let net {
            if now - presenceAt >= 1.0 / 30 {
                presenceAt = now
                let n = Int(net.window * net.hz)
                var h = [SIMD3<Double>](); h.reserveCapacity(n)
                var j = 0
                for k in 0..<n {
                    let tk = now - Double(n - 1 - k) / net.hz
                    while j + 1 < rawHistory.count, rawHistory[j + 1].t <= tk { j += 1 }
                    h.append(rawHistory[j].v - zero)
                }
                // Told about an unzeroed overload only while the field has
                // just dropped (the magnet moving away): steady, a leftover and
                // a magnet lying still read alike, and a resting magnet must
                // not be taken for one.
                let size = simd_length(raw - zero)
                recentSize.append((now, size))
                recentSize.removeAll { now - $0.t > 10 }
                let peak = recentSize.map(\.s).max() ?? size
                let dropped = peak - size > max(15, 0.12 * peak)
                let r = net.evaluate(history: h, overloadedFor: dropped ? overloadedAt.map { now - $0 } : nil)
                presence += (r.presence - presence) * (1 - exp(-(1.0 / 30) / 0.1))
                offsetEstimate = r.offset
            }
        } else {
            presence = 1
        }

        // Settled back onto a remembered no-magnet reading: that is the zero.
        var snapped = false
        if !holdBaseline, !weak, devMax < 1.5,
           let k = knownZeros.min(by: { simd_length($0.v - s) < simd_length($1.v - s) }),
           simd_length(k.v - s) < 2.5 {
            zero = k.v; baseline = k.v
            zeroBeforePhantom = nil
            overloadedAt = nil
            snapped = true
        }
        if snapped {
            quietSince = -1
            phantomSince = -1
        } else if !holdBaseline, weak, devMax < 0.8 {
            // Slow drift (temperature, small magnetisation): ease it in.
            phantomSince = -1
            if quietSince < 0 { quietSince = now }
            if now - quietSince > 0.6 {
                zero += (s - zero) * (1 - exp(-dt / max(0.2, cfg.driftSeconds)))
                baseline = zero
            }
        } else if !holdBaseline, net != nil ? presence < 0.25 : (cfg.steadyRezero && now < leftoverWatchUntil),
                  !weak, devMax < max(3.5, 0.03 * away) {
            // Not a magnet (the presence network, or right after an overload
            // without it) and holding still: the sensor's own offset.
            quietSince = -1
            if phantomSince < 0 { phantomSince = now }
            if now - phantomSince > 0.6 {
                if zeroBeforePhantom == nil || now - zeroBeforePhantomAt > 2 { zeroBeforePhantom = zero; zeroBeforePhantomAt = now }
                zero += (s - zero) * (1 - exp(-dt / 0.25))
                baseline = zero
                // Zeroed onto the leftover: the overload is dealt with.
                if simd_length(s - zero) < 2 { overloadedAt = nil }
            }
        } else {
            quietSince = -1
            phantomSince = -1
        }

        let d = s - zero
        out.delta = d
        let strength = simd_length(d)
        out.strength = strength
        out.tooClose = strength > cfg.tooCloseStrength
        let b = max(0, strength - cfg.deadzone)
        let k = max(0.5, cfg.scale)
        out.pull = min(1, log10(1 + b / k) / max(0.01, log10(1 + max(1, cfg.fullScale - cfg.deadzone) / k)))
        // No magnet, just the sensor's own offset: nothing to pull.
        out.presence = presence
        out.offsetEstimate = offsetEstimate
        if net != nil { out.pull *= min(1, max(0, (presence - 0.15) / 0.35)) }
        if strength > 1 { out.distance = cfg.distanceK * pow(strength, -1.0 / 3.0) }

        // Locator: where over the screen, smoothed more when the network is unsure.
        if cfg.locatorEnabled, strength > 2.5, let sensor = cfg.sensorPosition,
           let r = locate(d, cfg) {
            let v = magnetScreenVector(r.position.x, r.position.y, orientation)
            var target = CGPoint(x: Double(sensor.x) + Double(v.dx) * cfg.pointsPerCm, y: Double(sensor.y) + Double(v.dy) * cfg.pointsPerCm)
            // Far from the sensor the field is weak and a hand's wobble can
            // flip the bearing for a moment: a median over a short window
            // (longer when weaker) drops those blips without lagging a real move.
            let window = strength < 15 ? 0.2 : strength < 40 ? 0.12 : 0.04
            targets.append((now, target))
            targets.removeAll { now - $0.t > window }
            if targets.count >= 3 {
                let xs = targets.map(\.p.x).sorted(), ys = targets.map(\.p.y).sorted()
                target = CGPoint(x: xs[xs.count / 2], y: ys[ys.count / 2])
            }
            let spreadCm = r.spread
            let tau = 0.04 + 0.22 * min(1, spreadCm / 1.5)
            if let cur = located {
                let k = 1 - exp(-dt / tau)
                located = CGPoint(x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k)
            } else {
                located = target
            }
            out.screenPosition = located
            out.screenSpread = spreadCm * cfg.pointsPerCm
            out.height = r.position.z - 0.4
            locatedDistance = simd_length(r.position)
        } else if strength <= 2.5 {
            located = nil
            targets.removeAll()
            locatedDistance = nil
        }

        // Motion: the slope of ln|B| over the last ~0.12 s. The field goes as
        // 1/r³, so d ln r/dt = −⅓ d ln|B|/dt: the approach speed in cm/s.
        let rEst = locatedDistance ?? out.distance
        if strength > max(3, cfg.deadzone * 1.5) {
            lnHistory.append((now, log(strength), rEst))
        }
        lnHistory.removeAll { now - $0.t > 0.12 }
        var rate = 0.0
        if lnHistory.count >= 3 {
            let n = Double(lnHistory.count)
            let mt = lnHistory.reduce(0) { $0 + $1.t } / n, ml = lnHistory.reduce(0) { $0 + $1.ln } / n
            var num = 0.0, den = 0.0
            for e in lnHistory { num += (e.t - mt) * (e.ln - ml); den += (e.t - mt) * (e.t - mt) }
            if den > 1e-9 { rate = num / den }
        }
        motionRate += (rate - motionRate) * (1 - exp(-dt / 0.03))
        out.approachRate = motionRate
        let rNow = lnHistory.last?.r ?? rEst
        out.approachSpeed = rNow.isFinite ? motionRate * rNow / 3 : 0

        // Lateral motion of the located point.
        if let p = out.screenPosition {
            posHistory.append((now, p))
            posHistory.removeAll { now - $0.t > 0.1 }
            if let first = posHistory.first, now - first.t > 0.03 {
                let span = now - first.t
                out.lateralVelocity = CGVector(dx: (p.x - first.p.x) / span, dy: (p.y - first.p.y) / span)
            }
        } else {
            posHistory.removeAll()
        }

        // Gestures.
        pullHistory.append((now, out.pull))
        pullHistory.removeAll { now - $0.t > 0.5 }
        let recentPull = pullHistory.map(\.pull).max() ?? 0
        if motionRate > cfg.gesturePushRate, out.pull >= cfg.gestureMinPull, !pushed, now - lastPushT > 0.3 {
            pushed = true
            lastPushT = now
            fire(.push(speed: max(0, out.approachSpeed)))
        } else if motionRate < cfg.gesturePushRate * 0.3 {
            pushed = false
        }
        if motionRate < -cfg.gesturePullRate, recentPull >= cfg.gestureMinPull, now - lastPullT > 0.3 {
            lastPullT = now
            fire(.pullAway(speed: max(0, -out.approachSpeed)))
            if tapNet == nil, now - lastPushT < cfg.gestureTapWindow { fire(.tap(at: out.screenPosition)) }
        }
        if tapNet != nil {
            if let p = out.screenPosition { tapPoints.append((now, p, strength)) }
            tapPoints.removeAll { now - $0.t > 1.0 }
            // No presence gate: a tap is a quick rise and fall, which a
            // leftover offset never makes — and right after an overload the
            // presence model may doubt a magnet that is plainly there.
            if tapP > 0.5, !tapHigh, now - lastTapT > 0.35, strength > cfg.deadzone {
                tapHigh = true
                lastTapT = now
                fire(.tap(at: tapPoints.max(by: { $0.s < $1.s })?.p))
            } else if tapP < 0.3 {
                tapHigh = false
            }
        }
        let lv = out.lateralVelocity
        let lspeed = hypot(lv.dx, lv.dy)
        if lspeed > cfg.gestureSwipeSpeed, now - lastSwipeT > 0.4 {
            lastSwipeT = now
            fire(.swipe(direction: CGVector(dx: lv.dx / lspeed, dy: lv.dy / lspeed), speed: lspeed))
        }

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
                let raw = magnetScreenVector(d.x / inPlane, d.y / inPlane, orientation)
                side = lastToward == .zero ? -1 : (raw.dx * lastToward.dx + raw.dy * lastToward.dy >= 0 ? 1 : -1)
            }
            lastToward = magnetScreenVector(side * d.x / inPlane, side * d.y / inPlane, orientation)
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

// MARK: - Simulated magnet

/// A dipole on the table, for the Simulator and for tuning without a magnet:
/// the field it puts on a sensor, in the magnetometer's device axes.
public enum MagnetSimulator {
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
