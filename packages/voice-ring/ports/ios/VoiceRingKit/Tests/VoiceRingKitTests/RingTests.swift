import XCTest
@testable import VoiceCore
@testable import VoicePositionKit
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

    /// Mono draws its two loops as tubes, each point with a depth, at rest and
    /// while speaking, and leans with no lens.
    func testMonoDraws() throws {
        var voice = VoiceInput()
        var spans: [Double] = []
        for level in [0.0, 0.8] {
            voice.level = level
            voice.soft = level
            voice.bands = SIMD3(level, level, level)
            voice.softBands = voice.bands
            voice.drive = 3
            let p = VoiceRing.preset(.mono, size: 200)
            let f = p.frame(200, 2, voice, p.opts)
            XCTAssertEqual(f.strokes.count, 2)
            XCTAssertNotNil(f.tube)
            XCTAssertNil(f.light)
            let loop = try XCTUnwrap(f.strokes.first)
            XCTAssertEqual(loop.z?.count, loop.a.count)
            let ys = stride(from: 1, to: loop.pts.count, by: 2).map { loop.pts[$0] }
            spans.append(try XCTUnwrap(ys.max()) - XCTUnwrap(ys.min()))
        }
        XCTAssertEqual(VoiceRing.preset(.mono, size: 200).lean.lens, 0)
        XCTAssertEqual(VoiceRing.preset(.mono, size: 200).lean.move, 0.55)
        XCTAssertGreaterThan(spans[0], 60, "a loop has its size at rest")
    }

    /// The ring stays the default, so existing calls draw what they did.
    func testRingIsTheDefaultType() {
        XCTAssertNotNil(VoiceRing.preset(size: 200).frame(200, 1, VoiceInput(), [:]).light)
    }

    /// The ring leans its own way: barely drifting, leaning and bulging a
    /// touch, never squashing, through a softer lens, 32 pt short of the edge.
    func testRingLeansItsOwnWay() {
        let ring = VoiceRing.preset(size: 200)
        XCTAssertEqual(ring.lean, LeanAmounts(move: 0.21, pull: 0.36, deform: 0.28, squash: 0, lens: 0.49, stretch: 1.04,
                                              split: 1.01, blur: 1.24, bounce: 0.92))
        XCTAssertEqual(ring.leanMargin, 32)
    }

    /// The spectrum is resampled along a smooth closed curve: it closes on
    /// itself, keeps the gold at the top, and never jumps between samples.
    func testSpectrumIsSmooth() throws {
        let light = try XCTUnwrap(VoiceRing.preset(size: 200).frame(200, 1, VoiceInput(), [:]).light)
        let smooth = smoothSpectrum(light.stops)
        XCTAssertEqual(smooth.count, 37)
        let first = try XCTUnwrap(smooth.first), last = try XCTUnwrap(smooth.last)
        XCTAssertEqual(first.r, last.r, accuracy: 0.5)
        XCTAssertEqual(first.g, last.g, accuracy: 0.5)
        XCTAssertEqual(first.b, last.b, accuracy: 0.5)
        XCTAssertEqual(first.g, 150, accuracy: 1)            // the gold at the top is kept
        for (a, b) in zip(smooth, smooth.dropFirst()) {
            XCTAssertLessThan(abs(b.r - a.r) + abs(b.g - a.g) + abs(b.b - a.b), 90, "step at \(a.offset)")
        }
    }
}

final class ModelFileTests: XCTestCase {
    /// An MFXL file laid out as pack_model.py writes it, with made-up weights.
    private func file(kind: String = "position", levelBands: [Double] = DirectionModel.levelBands) -> Data {
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
        // the desk's distance model, after both poses: mean, std, weights, bias over two features
        var far = Data()
        for v: Float in [0, 0, 1, 1, 2, 0, 0.5] { withUnsafeBytes(of: v.bitPattern.littleEndian) { far.append(contentsOf: $0) } }
        let header: [String: Any] = [
            "kind": kind, "version": "2.0", "frame": 1024, "rate": 48000,
            "levelBands": levelBands, "phaseBands": DirectionModel.phaseBands, "features": n,
            "outputs": ["left", "ahead", "right"],
            "poses": [["name": "hand", "rounds": 1, "offset": 0, "length": payload.count],
                      ["name": "desk", "rounds": 1, "offset": payload.count, "length": payload.count]],
            "distanceOutputs": ["small", "large"],
            "distance": [["name": "desk", "rounds": 1, "rooms": 1, "features": 2, "offset": 2 * payload.count, "length": far.count]],
        ]
        let head = try! JSONSerialization.data(withJSONObject: header)
        var data = Data("MFXL".utf8)
        withUnsafeBytes(of: UInt32(head.count).littleEndian) { data.append(contentsOf: $0) }
        return data + head + payload + payload + far
    }

    /// Both poses load, and the weights land where the model reads them:
    /// the first feature alone pushes the voice right.
    func testLoadsBothPoses() throws {
        let f = try PositionModelFile(data: file())
        XCTAssertEqual(f.version, "2.0")
        var features = [Double](repeating: 0, count: DirectionModel.featureCount)
        features[0] = 3
        for pose in DevicePose.allCases {
            let p = try XCTUnwrap(f.model(for: pose)).probabilities(features)
            XCTAssertGreaterThan(p.z, 0.9, "\(pose)")
        }
    }

    /// The distance model reads from the file for the pose it has, and only that one.
    func testLoadsDistanceForItsPose() throws {
        let f = try PositionModelFile(data: file())
        XCTAssertNil(f.distanceModel(for: .hand))
        let model = try XCTUnwrap(f.distanceModel(for: .desk))
        XCTAssertEqual(model.large([0, 9]), 1 / (1 + exp(-0.5)), accuracy: 1e-6)
        XCTAssertGreaterThan(model.large([3, 9]), 0.95)
        XCTAssertLessThan(model.large([-3, 9]), 0.05)
    }

    /// A file of another kind, or measured in other bands, is refused.
    func testRefusesOtherModels() {
        XCTAssertThrowsError(try PositionModelFile(data: file(kind: "magnet")))
        XCTAssertThrowsError(try PositionModelFile(data: file(kind: "direction")))
        XCTAssertThrowsError(try PositionModelFile(data: file(levelBands: [100, 200])))
        XCTAssertThrowsError(try PositionModelFile(data: Data("nope".utf8)))
    }
}
