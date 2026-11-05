// How far the voice is from the phone: `small`, the phone within reach, or
// `large`, further off, from about 70 cm. No loudness in it, since a whisper up
// close and a shout from across a room can measure the same. What it reads
// instead is how much of the sound is the voice and how much the room:
//
// - how alike the two channels are, band by band: the direct sound arrives
//   alike, the room's reflections don't;
// - the voice's colour, each band against the others, which the room shapes
//   as the voice gets further off;
// - how much the level swings between syllables, in three broad bands: a room
//   fills the gaps, so a far voice swings less;
// - how far the voice stands above the room's noise.
//
// One linear model per pose, from `VoicePosition.mfxl`. The one trained so far
// is for the desk and weighs only the first of these, the alikeness averaged
// over 800-1700 Hz: it held up in a room the model hadn't heard, and a voice
// from the side loses alikeness above those bands rather than in them. The
// others stay measured so a retrain with more rooms can bring them back. Without
// a model for the pose `DistanceModel.current` is nil and the distance reads nil.

import Foundation
import VoiceCore

/// How far the voice is from the phone.
public enum VoiceDistance: String, CaseIterable, Codable, Sendable {
    /// The phone within reach.
    case small
    /// Further off, from about 70 cm.
    case large
}

/// The features between frames, voiced frames only, each by how far it stands
/// above the noise floor. Eased over 0.6 s, held through the gaps between
/// words, let go after a second of quiet. A read starts only on 0.15 s of
/// unbroken voice, so a knock or a click in a quiet room isn't taken for one.
struct DistanceGate {
    /// The eased features; nil when quiet.
    private(set) var features: [Double]?
    private var floor: Double?
    private var swingMean: [Double]?
    private var swingVar = [Double](repeating: 0, count: 3)
    private var quiet: Double = 0
    private var voiced: Double = 0

    static let voicedAbove = 15.0, fullAbove = 30.0, ease = 0.6, swingOver = 1.0, holdFor = 1.0, startAfter = 0.15

    mutating func step(_ frame: StereoFrame, dt: Double) {
        guard frame.bandPower.count == StereoBands.level.count - 1 else { return }
        let power = frame.power
        let f = floor ?? power
        floor = power < f ? power : f + (power - f) * (1 - exp(-dt / 4))
        let snr = power - (floor ?? power)

        // the swing runs through voice and gaps alike: the gaps are the point
        func mean(_ r: Range<Int>) -> Double { frame.bandPower[r].reduce(0, +) / Double(r.count) }
        let broad = [mean(0..<4), mean(4..<9), mean(9..<13)]    // 150–800 Hz, –2.8 kHz, –9 kHz
        let k = 1 - exp(-dt / Self.swingOver)
        var m = swingMean ?? broad
        for i in broad.indices {
            m[i] += (broad[i] - m[i]) * k
            swingVar[i] += ((broad[i] - m[i]) * (broad[i] - m[i]) - swingVar[i]) * k
        }
        swingMean = m

        guard snr > Self.voicedAbove else {
            quiet += dt
            voiced = 0
            if quiet > Self.holdFor { features = nil }
            return
        }
        voiced += dt
        guard features != nil || voiced >= Self.startAfter else { return }
        quiet = 0
        let all = mean(0..<13)
        let now = frame.coherence + frame.bandPower.map { $0 - all } + swingVar.map { $0.squareRoot() } + [snr]
        guard var eased = features else {
            features = now
            return
        }
        let weight = min(1, (snr - Self.voicedAbove) / (Self.fullAbove - Self.voicedAbove))
        let e = 1 - exp(-dt * weight / Self.ease)
        for i in eased.indices { eased[i] += (now[i] - eased[i]) * e }
        features = eased
    }
}

/// Turns the model's moment-to-moment reading into a distance. The reading
/// feeds a belief that builds over about 0.8 s of voice; the distance changes
/// only once the belief has stayed past the far threshold for 0.25 s, so the
/// interface doesn't flip on a word. Large goes back to small on a close voice,
/// or after 3 s of quiet: the gate's second of hold, then `forgetAfter`.
struct DistanceDecision {
    private(set) var distance = VoiceDistance.small
    /// 0 small … 1 large.
    private(set) var belief: Double = 0
    private var held: Double = 0
    private var quiet: Double = 0

    static let build = 0.8, toLarge = 0.65, toSmall = 0.35, hold = 0.25, forgetAfter = 2.0

    mutating func step(_ reading: Double?, dt: Double) {
        if let reading {
            quiet = 0
            belief += (reading - belief) * (1 - exp(-dt / Self.build))
        } else {
            quiet += dt
            if quiet >= Self.forgetAfter {
                belief = 0
                distance = .small
            }
        }
        let crossing = distance == .small ? belief > Self.toLarge : belief < Self.toSmall
        held = crossing ? held + dt : 0
        if crossing, held >= Self.hold {
            distance = distance == .small ? .large : .small
            held = 0
        }
    }
}

/// The distance model for one pose: a linear classifier over `DistanceGate`'s
/// features, read from `VoicePosition.mfxl`.
public struct DistanceModel: Sendable {
    let mean: [Double]
    let std: [Double]
    let weights: [Double]
    let bias: Double

    /// How likely the voice is further off, 0…1.
    func large(_ features: [Double]) -> Double {
        var a = bias
        for (i, x) in features.enumerated() where i < weights.count {
            a += (x - mean[i]) / std[i] * weights[i]
        }
        return 1 / (1 + exp(-a))
    }

    /// The model for a pose, if the loaded file has one.
    static func current(_ pose: DevicePose) -> DistanceModel? { PositionModelFile.bundled?.distanceModel(for: pose) }
}
