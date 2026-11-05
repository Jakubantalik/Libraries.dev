import XCTest
@testable import VoiceCore
@testable import VoicePositionKit

final class DistanceTests: XCTestCase {
    private struct Fixture: Decodable {
        let rate: Double, dt: Double
        let left: [Float], right: [Float], coherence: [Double], bandPower: [Double]
        let power: [Double], bands: [[Double]], coherences: [[Double]], features: [Double]
    }

    private func fixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "distance-frames", withExtension: "json", subdirectory: "Fixtures"))
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    /// The app measures a recorded frame as the training script does. Levels
    /// only as differences: their overall scale differs, and nothing reads it.
    func testFrameMatchesTraining() throws {
        let fx = try fixture()
        let frame = SpectrumAnalyser(fftSize: 1024).stereoFrame(left: fx.left, right: fx.right, sampleRate: fx.rate)
        XCTAssertEqual(frame.coherence.count, fx.coherence.count)
        for (i, (swift, python)) in zip(frame.coherence, fx.coherence).enumerated() {
            XCTAssertEqual(swift, python, accuracy: 0.01, "coherence \(i)")
        }
        let offset = frame.bandPower[0] - fx.bandPower[0]
        for (i, (swift, python)) in zip(frame.bandPower, fx.bandPower).enumerated() {
            XCTAssertEqual(swift - offset, python, accuracy: 0.05, "band \(i)")
        }
    }

    /// The gate turns the same frames into the training script's features.
    func testGateMatchesTraining() throws {
        let fx = try fixture()
        var gate = DistanceGate()
        for i in fx.power.indices {
            let frame = StereoFrame(cues: DirectionCues(level: 0, phase: 0), power: fx.power[i], bandPower: fx.bands[i], coherence: fx.coherences[i])
            gate.step(frame, dt: fx.dt)
        }
        let features = try XCTUnwrap(gate.features)
        XCTAssertEqual(features.count, fx.features.count)
        for (i, (swift, python)) in zip(features, fx.features).enumerated() {
            XCTAssertEqual(swift, python, accuracy: 0.02, "feature \(i)")
        }
    }

    /// The gate listens to the voice only, holds through a gap, lets go after a second.
    func testGateListensToTheVoiceOnly() {
        var gate = DistanceGate()
        let dt = 1.0 / 60
        let bands = [Double](repeating: 0, count: 13), coherence = [Double](repeating: 0.8, count: 13)
        func step(power: Double, n: Int) {
            for _ in 0..<n {
                gate.step(StereoFrame(cues: DirectionCues(level: 0, phase: 0), power: power, bandPower: bands, coherence: coherence), dt: dt)
            }
        }
        step(power: -10, n: 60)
        XCTAssertNil(gate.features)
        step(power: 30, n: 3)
        XCTAssertNil(gate.features, "a click isn't a voice")
        step(power: -10, n: 10)
        step(power: 30, n: 60)
        XCTAssertEqual(gate.features?.first ?? 0, 0.8, accuracy: 0.001)
        step(power: -10, n: 20)
        XCTAssertNotNil(gate.features)
        step(power: -10, n: 60)
        XCTAssertNil(gate.features)
    }

    /// The distance changes only on a sustained reading, doesn't flip on a
    /// word, holds through a pause, and goes back on a close voice or on quiet.
    func testDecisionCommitsAndHolds() {
        var decision = DistanceDecision()
        let dt = 1.0 / 60
        func step(_ reading: Double?, seconds: Double) {
            for _ in 0..<Int(seconds * 60) { decision.step(reading, dt: dt) }
        }
        step(0.95, seconds: 0.3)
        XCTAssertEqual(decision.distance, .small, "a word isn't enough")
        step(0.1, seconds: 1)
        step(0.95, seconds: 3)
        XCTAssertEqual(decision.distance, .large)
        step(0.5, seconds: 3)
        XCTAssertEqual(decision.distance, .large, "doubt doesn't move it")
        step(nil, seconds: 1.9)
        XCTAssertEqual(decision.distance, .large, "a pause holds it")
        step(0.95, seconds: 0.2)
        step(nil, seconds: 2.1)
        XCTAssertEqual(decision.distance, .small, "quiet lets it go")
        step(0.95, seconds: 3)
        XCTAssertEqual(decision.distance, .large)
        step(0.1, seconds: 2)
        XCTAssertEqual(decision.distance, .small, "a close voice brings it back")
    }

    /// The model reads a linear score through a sigmoid, standardising first.
    func testModelReadsItsWeights() {
        let model = DistanceModel(mean: [1, 2], std: [1, 2], weights: [2, 0], bias: 0)
        XCTAssertEqual(model.large([1, 9]), 0.5, accuracy: 1e-9)
        XCTAssertGreaterThan(model.large([3, 9]), 0.95)
        XCTAssertLessThan(model.large([-1, 9]), 0.05)
    }

    /// The model file, where one is given: the desk reads a close voice as small
    /// and a far one as large, the hand has no distance model yet.
    func testModelFileReadsDistance() throws {
        guard let path = ProcessInfo.processInfo.environment["VOICE_POSITION_MODEL"] else { return }
        let file = try PositionModelFile(contentsOf: URL(fileURLWithPath: path))
        XCTAssertNil(file.distanceModel(for: .hand))
        let model = try XCTUnwrap(file.distanceModel(for: .desk))
        func features(_ alike: Double) -> [Double] { [Double](repeating: alike, count: 7) }
        XCTAssertLessThan(model.large(features(0.95)), 0.05)
        XCTAssertGreaterThan(model.large(features(0.55)), 0.95)
    }
}
