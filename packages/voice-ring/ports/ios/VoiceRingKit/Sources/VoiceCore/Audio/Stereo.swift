// What the iPhone's two built-in mics tell apart, frame by frame: the level
// and phase differences between the channels, from the user's side. The
// meter measures them (`VoiceMeter.stereoFrame()`); reading a side out of
// them is VoiceDirectionKit's job, so nothing here decides anything.

import Foundation

/// The two broad cues to a voice's side, from the user's point of view.
public struct DirectionCues: Codable, Sendable, Equatable {
    /// Level difference between the channels over 1–4 kHz, in dB.
    public var level: Double
    /// Phase difference between the channels over 200–700 Hz, in degrees.
    public var phase: Double

    public init(level: Double, phase: Double) {
        self.level = level
        self.phase = phase
    }
}

/// The bands the per-band features are measured in: the level difference
/// between each pair of `level` edges, the phase difference between each
/// pair of `phase` edges. The Voice direction model was trained on these.
public enum StereoBands {
    public static let level: [Double] = [150, 250, 400, 600, 800, 1000, 1300, 1700, 2200, 2800, 3500, 4500, 6000, 9000]
    public static let phase: [Double] = [150, 300, 500, 800, 1200, 1800, 2700]

    /// Features per frame: a level per level band, then (cos, sin) of the
    /// phase per phase band.
    public static var featureCount: Int { (level.count - 1) + 2 * (phase.count - 1) }
}

/// One frame of the latest 1024 samples, seen from the user's side.
public struct StereoFrame: Sendable {
    /// The broad cues — what a calibration reads.
    public var cues: DirectionCues
    /// The per-band level differences (dB), then (cos, sin) of the per-band
    /// phase differences, in `StereoBands` — what the model reads.
    public var features: [Double]
    /// The 300–6000 Hz band in dB, for telling a voice from the room.
    public var power: Double

    public init(cues: DirectionCues, features: [Double] = [], power: Double) {
        self.cues = cues
        self.features = features
        self.power = power
    }

    /// Seen from the other side: for the front mics, whose stereo image is
    /// the front camera's, so its left is the user's right.
    public mutating func mirror() {
        cues.level = -cues.level
        cues.phase = -cues.phase
        let levels = StereoBands.level.count - 1
        for i in features.indices where i < levels || (i - levels) % 2 == 1 {
            features[i] = -features[i]      // the levels, and the phases' sines
        }
    }
}
