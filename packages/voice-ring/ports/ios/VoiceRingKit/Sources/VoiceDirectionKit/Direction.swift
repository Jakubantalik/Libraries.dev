// Where the voice comes from, from the iPhone's stereo mics. Measured on an
// iPhone 15 Pro (front mics, portrait) over three sessions, the stereo image
// is weak and lopsided:
//
// - the left channel runs several dB hot wherever the voice is, most of
//   all below 1 kHz, so the broadband level difference leans one way;
// - over 1–4 kHz the level difference mostly tells the right from the
//   rest (left and ahead about +1 dB, right +6.5…8);
// - the phase difference over 200–700 Hz tells the left from the rest
//   (left −23…−33° every time, ahead near 0°, right near +97°);
// - the broadband time difference follows how high the voice is against
//   the phone more than its side, and jumps between sessions — no use;
// - all of it shifts with how the phone is held: a calibration made one
//   way does not carry over to another.
//
// So VoiceDirection reads the meter's stereo frames, voiced ones only.
// Without a calibration the Voice direction model reads them (DirectionModel: many bands,
// one model per pose, trained on recorded rounds). A calibration — a few
// seconds of voice from the left, ahead and the right — replaces it for
// the pose it was made in: it lays a path through the two main cues, and a
// voice reads as its place along that path, eased toward the centre where
// two places fit about as well, and toward nothing where it fits none.

import Foundation
import VoiceCore

/// A calibration point: someone speaking from that side of the phone.
public enum DirectionSide: String, CaseIterable, Codable, Sendable {
    case left, ahead, right
}

extension DirectionCues {
    /// The phase as a point on the unit circle, so it averages and compares
    /// without a seam at ±180°.
    var phasor: SIMD2<Double> {
        let r = phase * .pi / 180
        return SIMD2(cos(r), sin(r))
    }

    static func degrees(_ v: SIMD2<Double>) -> Double { atan2(v.y, v.x) * 180 / .pi }
}

/// The cues between frames: only voiced frames count, each by how far it
/// stands above the noise floor and how sharply it rises (the direct sound
/// arrives before the room's reflections). Eased over a quarter second,
/// held through the gaps between words, let go after a second of quiet.
struct DirectionGate {
    /// The eased cues; nil when quiet.
    var cues: DirectionCues? { level.map { DirectionCues(level: $0, phase: DirectionCues.degrees(phasor)) } }
    /// The eased model features; nil when quiet.
    private(set) var features: [Double]?
    /// The latest frame stood clear of the noise floor.
    private(set) var voiced = false
    private var level: Double?
    private var phasor = SIMD2<Double>(1, 0)
    private var floor: Double?
    private var recent: Double?
    private var quiet: Double = 0

    static let voicedAbove = 15.0, fullAbove = 30.0, ease = 0.25, holdFor = 1.0

    mutating func step(_ frame: StereoFrame, dt: Double) {
        let power = frame.power
        // the floor drops at once and creeps up over a few seconds
        let f = floor ?? power
        floor = power < f ? power : f + (power - f) * (1 - exp(-dt / 4))
        let snr = power - (floor ?? power)
        let rise = max(0, power - (recent ?? power))
        recent = (recent ?? power) + (power - (recent ?? power)) * (1 - exp(-dt / 0.15))

        voiced = snr > Self.voicedAbove
        guard voiced else {
            quiet += dt
            if quiet > Self.holdFor {
                level = nil
                features = nil
            }
            return
        }
        quiet = 0
        guard let current = level else {
            level = frame.cues.level
            phasor = frame.cues.phasor
            features = frame.features
            return
        }
        let weight = min(1, (snr - Self.voicedAbove) / (Self.fullAbove - Self.voicedAbove)) * min(3, 1 + rise / 6)
        let k = 1 - exp(-dt * weight / Self.ease)
        level = current + (frame.cues.level - current) * k
        phasor += (frame.cues.phasor - phasor) * k
        if var f = features, f.count == frame.features.count {
            for i in f.indices { f[i] += (frame.features[i] - f[i]) * k }
            features = f
        } else {
            features = frame.features
        }
    }
}

/// Turns the moment-to-moment reading into a direction the orb commits to.
/// The reading feeds a belief (it builds over about 0.5 s of voice); a side
/// is taken only once the belief has stayed past 0.5 for 0.15 s — a clear
/// voice commits in about 0.65 s — and kept until it falls under 0.25, so a
/// doubtful or passing reading never tips it, and going from one side to the
/// other always passes through the centre. How far it leans grows with the belief; quiet lets it drift home.
/// Mirrored by `decide` in swift/Training/direction.py, which scores it.
struct DirectionDecision {
    /// −1 left … 1 right, eased.
    private(set) var pan: Double = 0
    /// The committed side: −1, 0 or 1.
    private(set) var side = 0
    private(set) var belief: Double = 0
    /// How long the belief has stayed past `take` on one side.
    private var held: Double = 0

    static let build = 0.5, take = 0.5, keep = 0.25, hold = 0.15, fade = 1.5, ease = 0.6

    mutating func step(_ reading: Double?, dt: Double) {
        if let reading {
            belief += (reading - belief) * (1 - exp(-dt / Self.build))
        } else {
            belief *= exp(-dt / Self.fade)
        }
        if side == 0 {
            let want = belief > Self.take ? 1 : belief < -Self.take ? -1 : 0
            held = want == 0 ? 0 : held + dt
            if want != 0, held >= Self.hold {
                side = want
                held = 0
            }
        } else if belief * Double(side) < Self.keep {
            side = 0
        }
        let target = side == 0 ? 0 : Double(side) * min(1, abs(belief) / 0.8)
        pan += (target - pan) * (1 - exp(-dt / Self.ease))
    }
}

/// The calibrated path: the cues heard from each side, and how much each
/// cue wanders while the voice stays put — the scale they are compared on.
/// Codable, so an app can keep it between launches.
public struct DirectionCalibration: Codable, Sendable, Equatable {
    public private(set) var points: [DirectionSide: DirectionCues] = [:]
    /// Per side: the level's spread in dB, the phase's in degrees.
    public private(set) var spreads: [DirectionSide: DirectionCues] = [:]

    public init() {}

    /// Both sides are in, so the calibration drives the direction.
    public var isReady: Bool { points[.left] != nil && points[.right] != nil }

    mutating func add(_ side: DirectionSide, cues: DirectionCues, spread: DirectionCues) {
        points[side] = cues
        spreads[side] = spread
    }

    /// The scale for each cue: the sides' typical wander, never finer than
    /// half a dB or 6°.
    var spread: DirectionCues {
        let s = Array(spreads.values)
        guard !s.isEmpty else { return DirectionCues(level: 1.5, phase: 20) }
        return DirectionCues(level: max(0.5, s.map(\.level).reduce(0, +) / Double(s.count)),
                             phase: max(6, s.map(\.phase).reduce(0, +) / Double(s.count)))
    }

    /// What is wrong with a calibration, once all three sides are in.
    public enum Issue: Sendable, Equatable {
        /// Left and right sound too much alike to tell apart reliably.
        case sidesAlike
        /// Ahead does not sit between left and right.
        case aheadOutside
    }

    /// Left and right must stand at least 3 spreads apart, and ahead must
    /// fall between them, not past either.
    public var issue: Issue? {
        guard let l = points[.left], let r = points[.right] else { return nil }
        let d = z(r) - z(l)
        let length = (d * d).sum()
        if length < 9 { return .sidesAlike }
        if let a = points[.ahead] {
            let t = ((z(a) - z(l)) * d).sum() / length
            if t < 0.05 || t > 0.95 { return .aheadOutside }
        }
        return nil
    }

    /// A cue as a point where one spread is one unit: the level, and the
    /// phase on the unit circle.
    private func z(_ c: DirectionCues) -> SIMD3<Double> {
        let scale = spread
        let p = c.phasor / (scale.phase * .pi / 180)
        return SIMD3(c.level / scale.level, p.x, p.y)
    }

    /// −1 left … 1 right: the place on the path left → ahead → right nearest
    /// `cues`, each cue scaled by its spread. Where both stretches of the
    /// path fit about as well, their places are blended, which pulls a
    /// doubtful voice toward the centre; a voice more than 5 spreads from
    /// the path, like nothing calibrated, fades to 0. nil until both sides
    /// are in.
    public func pan(_ cues: DirectionCues) -> Double? {
        guard let l = points[.left], let r = points[.right] else { return nil }
        var path: [(pan: Double, at: SIMD3<Double>)] = [(-1, z(l))]
        if let a = points[.ahead] { path.append((0, z(a))) }
        path.append((1, z(r)))
        let p = z(cues)
        var fits: [(dist: Double, pan: Double)] = []
        for i in 0..<(path.count - 1) {
            let a = path[i].at, d = path[i + 1].at - a
            let length = (d * d).sum()
            let t = length > 1e-9 ? max(0, min(1, ((p - a) * d).sum() / length)) : 0.5
            let off = a + t * d - p
            fits.append(((off * off).sum().squareRoot(), path[i].pan + t * (path[i + 1].pan - path[i].pan)))
        }
        let nearest = fits.map(\.dist).min() ?? 0
        let weights = fits.map { exp(-pow($0.dist - nearest, 2) / (2 * 0.3 * 0.3)) }
        let blended = zip(weights, fits).map { $0 * $1.pan }.reduce(0, +) / weights.reduce(0, +)
        let familiar = max(0, min(1, (6.5 - nearest) / 1.5))
        return blended * familiar
    }

    /// From a calibration window: the frames of strong voice (within 15 dB
    /// of the loudest, 20 dB over the quietest), their typical cues (the
    /// level's median, the phase's circular mean) and spreads. nil without
    /// a voice.
    static func measure(_ frames: [StereoFrame]) -> (cues: DirectionCues, spread: DirectionCues)? {
        guard frames.count >= 20 else { return nil }
        let powers = frames.map(\.power).sorted()
        let peak = powers[powers.count - 1], quiet = powers[powers.count / 10]
        guard peak - quiet > 20 else { return nil }
        let strong = frames.filter { $0.power >= max(peak - 15, quiet + 20) }
        guard strong.count >= 15 else { return nil }
        let level = strong.map(\.cues.level).sorted()
        let mean = strong.map(\.cues.phasor).reduce(SIMD2<Double>(0, 0), +) / Double(strong.count)
        let resultant = max(1e-6, min(1, (mean * mean).sum().squareRoot()))
        return (DirectionCues(level: level[level.count / 2], phase: DirectionCues.degrees(mean)),
                DirectionCues(level: (level[level.count * 3 / 4] - level[level.count / 4]) / 1.35,
                              phase: (-2 * log(resultant)).squareRoot() * 180 / .pi))
    }
}
