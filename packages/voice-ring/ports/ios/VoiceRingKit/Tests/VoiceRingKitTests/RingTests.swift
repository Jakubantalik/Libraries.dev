import XCTest
@testable import VoiceCore
@testable import VoiceDirectionKit
@testable import VoiceRingKit

final class RingTests: XCTestCase {
    /// The ring draws its six rings in light, at rest and while speaking.
    func testRingDraws() {
        var voice = VoiceInput()
        for level in [0.0, 0.8] {
            voice.level = level
            voice.soft = level
            voice.bands = SIMD3(level, level, level)
            voice.softBands = voice.bands
            voice.drive = 3
            let p = VoiceRing.preset(size: 200)
            let f = p.frame(200, 2, voice, p.opts)
            XCTAssertEqual(f.strokes.count, 6)
            XCTAssertNotNil(f.light)
        }
    }

    /// The ring leans its own way: pulled and bulging further, never
    /// squashing, stretched far into the lens, right up to the edge.
    func testRingLeansItsOwnWay() {
        let ring = VoiceRing.preset(size: 200)
        XCTAssertEqual(ring.lean, LeanAmounts(pull: 1.26, deform: 0.38, squash: 0, lens: 0.79, stretch: 1.99, split: 1.17,
                                              blur: 1.25, bounce: 0.82))
        XCTAssertEqual(ring.leanMargin, 0)
    }
}

final class ModelFileTests: XCTestCase {
    /// An MFXL file laid out as pack_model.py writes it, with made-up weights.
    private func file(kind: String = "direction", levelBands: [Double] = DirectionModel.levelBands) -> Data {
        let n = DirectionModel.featureCount
        // mean 0, std 1, only the first feature weighted (toward the right), no bias
        var weights = [Float](repeating: 0, count: n * 3)
        weights[0] = -1
        weights[2] = 1
        var values = [Float](repeating: 0, count: n)
        values += [Float](repeating: 1, count: n)
        values += weights
        values += [0, 0, 0]
        var payload = Data()
        for v in values { withUnsafeBytes(of: v.bitPattern.littleEndian) { payload.append(contentsOf: $0) } }
        let header: [String: Any] = [
            "kind": kind, "version": "1.0", "frame": 1024, "rate": 48000,
            "levelBands": levelBands, "phaseBands": DirectionModel.phaseBands, "features": n,
            "outputs": ["left", "ahead", "right"],
            "poses": [["name": "hand", "rounds": 1, "offset": 0, "length": payload.count],
                      ["name": "desk", "rounds": 1, "offset": payload.count, "length": payload.count]],
        ]
        let head = try! JSONSerialization.data(withJSONObject: header)
        var data = Data("MFXL".utf8)
        withUnsafeBytes(of: UInt32(head.count).littleEndian) { data.append(contentsOf: $0) }
        return data + head + payload + payload
    }

    /// Both poses load, and the weights land where the model reads them:
    /// the first feature alone pushes the voice right.
    func testLoadsBothPoses() throws {
        let f = try DirectionModelFile(data: file())
        XCTAssertEqual(f.version, "1.0")
        var features = [Double](repeating: 0, count: DirectionModel.featureCount)
        features[0] = 3
        for pose in DevicePose.allCases {
            let p = try XCTUnwrap(f.model(for: pose)).probabilities(features)
            XCTAssertGreaterThan(p.z, 0.9, "\(pose)")
        }
    }

    /// A file of another kind, or measured in other bands, is refused.
    func testRefusesOtherModels() {
        XCTAssertThrowsError(try DirectionModelFile(data: file(kind: "magnet")))
        XCTAssertThrowsError(try DirectionModelFile(data: file(levelBands: [100, 200])))
        XCTAssertThrowsError(try DirectionModelFile(data: Data("nope".utf8)))
    }
}
