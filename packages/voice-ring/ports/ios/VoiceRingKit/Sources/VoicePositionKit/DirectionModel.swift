// The side half of the Voice position model: per pose, a linear classifier over
// the stereo cues in many bands — the level difference in thirteen bands from
// 150 Hz to 9 kHz and the phase difference in six bands up to 2.7 kHz — trained
// on rounds one speaker recorded on an iPhone 15 Pro, held upright and lying flat
// on a desk, and on the desk also far voices from ahead, whose cues lean right on
// their own. It is what lets the side work without a calibration: on rounds it
// never saw, once settled it was on the correct side 98% of the time on the desk
// and 91% in the hand, and on the opposite side at most 0.5% of the time. Other
// iPhones place their mics differently and are not tested yet; a calibration
// adapts it to any phone.
//
// The weights are not in this package. They ship as `VoicePosition.mfxl`
// (libraries.dev/voice-position, under the Libraries.dev Model License), which
// the host app adds to its target; `PositionModelFile.bundled` loads it from
// there. Without it the side needs a calibration and the distance reads nil.
//
// The file is MFXL, as Magnet.mfxl: "MFXL", a little-endian UInt32 header
// length, a JSON header (kind "position", version, bands, an entry per pose for
// each model with its offset and length), then the payload as float32. A pose in
// `poses`: mean, std, weights (features × left / ahead / right) and bias. A pose
// in `distance`: mean, std, weights and bias over its first `features` features.

import Foundation
import VoiceCore

public struct DirectionModel: Sendable {
    let mean: [Double]
    let std: [Double]
    /// One row per feature: its weight for left, ahead, right.
    let weights: [[Double]]
    let bias: [Double]

    /// The bands the features are measured in (VoiceCore's `StereoBands`).
    /// The model file names them too; a file with other bands is refused.
    static var levelBands: [Double] { StereoBands.level }
    static var phaseBands: [Double] { StereoBands.phase }
    static var featureCount: Int { StereoBands.featureCount }

    /// How likely the voice is on the left, ahead, on the right.
    public func probabilities(_ features: [Double]) -> SIMD3<Double> {
        var a = SIMD3<Double>(bias[0], bias[1], bias[2])
        for (i, x) in features.enumerated() where i < weights.count {
            let z = (x - mean[i]) / std[i]
            a += z * SIMD3(weights[i][0], weights[i][1], weights[i][2])
        }
        let top = a.max()
        let e = SIMD3(exp(a.x - top), exp(a.y - top), exp(a.z - top))
        return e / e.sum()
    }

    /// −1 left … 1 right: P(right) − P(left). A doubtful voice, split
    /// between the sides or sure it is ahead, reads near 0.
    public func pan(_ features: [Double]) -> Double {
        let p = probabilities(features)
        return p.z - p.x
    }
}

// MARK: - The model file

/// A loaded `VoicePosition.mfxl`: per pose, a model for the side and one for the
/// distance, where it has one.
public struct PositionModelFile: Sendable {
    public enum LoadError: Error {
        case notMFXL, notAPositionModel, bandsDiffer, truncated
    }

    public let version: String
    let poses: [DevicePose: DirectionModel]
    let distances: [DevicePose: DistanceModel]

    /// The side model for a pose, if the file has one.
    public func model(for pose: DevicePose) -> DirectionModel? { poses[pose] }

    /// The distance model for a pose, if the file has one.
    public func distanceModel(for pose: DevicePose) -> DistanceModel? { distances[pose] }

    public init(contentsOf url: URL) throws {
        try self.init(data: Data(contentsOf: url))
    }

    public init(data: Data) throws {
        struct Header: Decodable {
            struct Pose: Decodable { let name: String; let offset: Int; let length: Int; var features: Int? }
            let kind: String
            let version: String
            let levelBands: [Double]
            let phaseBands: [Double]
            let features: Int
            let poses: [Pose]
            let distance: [Pose]
        }
        let bytes = [UInt8](data)
        guard bytes.count > 8, Array(bytes[0..<4]) == Array("MFXL".utf8) else { throw LoadError.notMFXL }
        let length = Int(bytes[4]) | Int(bytes[5]) << 8 | Int(bytes[6]) << 16 | Int(bytes[7]) << 24
        guard bytes.count >= 8 + length else { throw LoadError.truncated }
        let header = try JSONDecoder().decode(Header.self, from: Data(bytes[8..<(8 + length)]))
        guard header.kind == "position" else { throw LoadError.notAPositionModel }
        guard header.levelBands == DirectionModel.levelBands, header.phaseBands == DirectionModel.phaseBands,
              header.features == DirectionModel.featureCount else { throw LoadError.bandsDiffer }

        let start = 8 + length
        func floats(_ entry: Header.Pose, count: Int) throws -> [Double] {
            guard entry.length == count * 4, start + entry.offset + entry.length <= bytes.count else { throw LoadError.truncated }
            var at = start + entry.offset
            return (0..<count).map { _ in
                let bits = UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8 | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24
                at += 4
                return Double(Float(bitPattern: bits))
            }
        }

        // each pose: mean[n], std[n], weights[n × 3], bias[3]
        let n = header.features
        var poses: [DevicePose: DirectionModel] = [:]
        for entry in header.poses {
            guard let pose = DevicePose(rawValue: entry.name) else { continue }
            let values = try floats(entry, count: n * 5 + 3)
            let weights = stride(from: 2 * n, to: 5 * n, by: 3).map { Array(values[$0..<($0 + 3)]) }
            poses[pose] = DirectionModel(mean: Array(values[0..<n]), std: Array(values[n..<(2 * n)]),
                                         weights: weights, bias: Array(values[(5 * n)...]))
        }

        // each pose: mean[k], std[k], weights[k], bias
        var distances: [DevicePose: DistanceModel] = [:]
        for entry in header.distance {
            guard let pose = DevicePose(rawValue: entry.name), let k = entry.features else { continue }
            let values = try floats(entry, count: k * 3 + 1)
            distances[pose] = DistanceModel(mean: Array(values[0..<k]), std: Array(values[k..<(2 * k)]),
                                            weights: Array(values[(2 * k)..<(3 * k)]), bias: values[3 * k])
        }
        version = header.version
        self.poses = poses
        self.distances = distances
    }
}

extension PositionModelFile {
    /// Where the app's copy of the model sits: `VoicePosition.mfxl` in the
    /// main bundle.
    public static var bundledURL: URL? { Bundle.main.url(forResource: "VoicePosition", withExtension: "mfxl") }

    private static let cache = Cache()

    /// The model the voice reads with: the one passed to `use(_:)`, else the
    /// app's bundled file, loaded on first use; nil when the app ships none.
    public static var bundled: PositionModelFile? { cache.file }

    /// Reads the voice with this model file instead of the bundled one
    /// (for example one downloaded into the app's documents).
    public static func use(_ file: PositionModelFile?) { cache.set(file) }

    private final class Cache: @unchecked Sendable {
        private let lock = NSLock()
        private var loaded = false
        private var stored: PositionModelFile?

        var file: PositionModelFile? {
            lock.lock()
            defer { lock.unlock() }
            if !loaded {
                loaded = true
                stored = PositionModelFile.bundledURL.flatMap { try? PositionModelFile(contentsOf: $0) }
            }
            return stored
        }

        func set(_ file: PositionModelFile?) {
            lock.lock()
            loaded = true
            stored = file
            lock.unlock()
        }
    }
}

extension DirectionModel {
    /// The side model for a pose, if one is loaded.
    static func current(_ pose: DevicePose) -> DirectionModel? { PositionModelFile.bundled?.model(for: pose) }
}
