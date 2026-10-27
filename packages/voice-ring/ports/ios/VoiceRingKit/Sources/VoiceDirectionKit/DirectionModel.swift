// The Voice direction model: per pose, a linear classifier over the
// stereo cues in many bands — the level difference in thirteen bands from
// 150 Hz to 9 kHz and the phase difference in six bands up to 2.7 kHz —
// trained on rounds one speaker recorded on an iPhone 15 Pro, held upright
// and lying flat on a desk. It is what lets the direction work without a
// calibration: on rounds it never saw, once settled it was on the correct
// side 97% of the time on the desk and 91% in the hand, and on the opposite
// side at most 0.5% of the time. Other iPhones
// place their mics differently and are not tested yet; a calibration
// adapts it to any phone.
//
// The weights are not in this package. They ship as `VoiceDirection.mfxl`
// (libraries.dev/voice-direction, under the Libraries.dev Model License),
// which the host app adds to its target; `DirectionModel.bundled` loads it
// from there. Without it the direction needs a calibration.
//
// The file is MFXL, as Magnet.mfxl: "MFXL", a little-endian UInt32 header
// length, a JSON header (kind "direction", version, bands, one entry per
// pose with its offset and length), then each pose as float32: mean, std,
// weights (features × left / ahead / right) and bias.

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

/// A loaded `VoiceDirection.mfxl`: one model per pose.
public struct DirectionModelFile: Sendable {
    public enum LoadError: Error {
        case notMFXL, notADirectionModel, bandsDiffer, truncated
    }

    public let version: String
    let poses: [DevicePose: DirectionModel]

    /// The model for a pose, if the file has one.
    public func model(for pose: DevicePose) -> DirectionModel? { poses[pose] }

    public init(contentsOf url: URL) throws {
        try self.init(data: Data(contentsOf: url))
    }

    public init(data: Data) throws {
        struct Header: Decodable {
            struct Pose: Decodable { let name: String; let offset: Int; let length: Int }
            let kind: String
            let version: String
            let levelBands: [Double]
            let phaseBands: [Double]
            let features: Int
            let poses: [Pose]
        }
        let bytes = [UInt8](data)
        guard bytes.count > 8, Array(bytes[0..<4]) == Array("MFXL".utf8) else { throw LoadError.notMFXL }
        let length = Int(bytes[4]) | Int(bytes[5]) << 8 | Int(bytes[6]) << 16 | Int(bytes[7]) << 24
        guard bytes.count >= 8 + length else { throw LoadError.truncated }
        let header = try JSONDecoder().decode(Header.self, from: Data(bytes[8..<(8 + length)]))
        guard header.kind == "direction" else { throw LoadError.notADirectionModel }
        guard header.levelBands == DirectionModel.levelBands, header.phaseBands == DirectionModel.phaseBands,
              header.features == DirectionModel.featureCount else { throw LoadError.bandsDiffer }

        // each pose: mean[n], std[n], weights[n × 3], bias[3]
        let n = header.features
        let count = n * 5 + 3
        let start = 8 + length
        var poses: [DevicePose: DirectionModel] = [:]
        for entry in header.poses {
            guard let pose = DevicePose(rawValue: entry.name) else { continue }
            guard entry.length == count * 4, start + entry.offset + entry.length <= bytes.count else { throw LoadError.truncated }
            var values: [Double] = []
            values.reserveCapacity(count)
            var at = start + entry.offset
            for _ in 0..<count {
                let bits = UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8 | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24
                values.append(Double(Float(bitPattern: bits)))
                at += 4
            }
            let weights = stride(from: 2 * n, to: 5 * n, by: 3).map { Array(values[$0..<($0 + 3)]) }
            poses[pose] = DirectionModel(mean: Array(values[0..<n]), std: Array(values[n..<(2 * n)]),
                                         weights: weights, bias: Array(values[(5 * n)...]))
        }
        version = header.version
        self.poses = poses
    }
}

extension DirectionModel {
    /// Where the app's copy of the model sits: `VoiceDirection.mfxl` in the
    /// main bundle.
    public static var bundledURL: URL? { Bundle.main.url(forResource: "VoiceDirection", withExtension: "mfxl") }

    private static let cache = Cache()

    /// The model the meter reads with: the one passed to `use(_:)`, else the
    /// app's bundled file, loaded on first use; nil when the app ships none.
    public static var bundled: DirectionModelFile? { cache.file }

    /// Reads the direction with this model file instead of the bundled one
    /// (for example one downloaded into the app's documents).
    public static func use(_ file: DirectionModelFile?) { cache.set(file) }

    /// The model for a pose, if one is loaded.
    static func current(_ pose: DevicePose) -> DirectionModel? { bundled?.model(for: pose) }

    private final class Cache: @unchecked Sendable {
        private let lock = NSLock()
        private var loaded = false
        private var stored: DirectionModelFile?

        var file: DirectionModelFile? {
            lock.lock()
            defer { lock.unlock() }
            if !loaded {
                loaded = true
                stored = DirectionModel.bundledURL.flatMap { try? DirectionModelFile(contentsOf: $0) }
            }
            return stored
        }

        func set(_ file: DirectionModelFile?) {
            lock.lock()
            loaded = true
            stored = file
            lock.unlock()
        }
    }
}
