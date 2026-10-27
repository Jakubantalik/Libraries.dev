import XCTest
@testable import VoiceCore
@testable import VoiceDirectionKit

final class DirectionTests: XCTestCase {
    private func frame(_ level: Double, _ phase: Double, power: Double) -> StereoFrame {
        StereoFrame(cues: DirectionCues(level: level, phase: phase), power: power)
    }

    /// Voiced frames set the cues; the noise between words does not move
    /// them, and a second of quiet lets them go.
    func testGateListensToTheVoiceOnly() {
        var gate = DirectionGate()
        let dt = 1.0 / 60
        for _ in 0..<60 { gate.step(frame(5, 120, power: -10), dt: dt) }      // a room, its noise on the right
        XCTAssertNil(gate.cues)
        for i in 0..<90 { gate.step(i % 10 < 7 ? frame(-3, -50, power: 30) : frame(5, 120, power: -10), dt: dt) }
        XCTAssertEqual(gate.cues?.level ?? 0, -3, accuracy: 0.5)
        XCTAssertEqual(gate.cues?.phase ?? 0, -50, accuracy: 5)
        for _ in 0..<20 { gate.step(frame(5, 120, power: -10), dt: dt) }      // a gap between words
        XCTAssertEqual(gate.cues?.level ?? 0, -3, accuracy: 0.5)
        for _ in 0..<60 { gate.step(frame(5, 120, power: -10), dt: dt) }
        XCTAssertNil(gate.cues)
    }

    /// The phase eases the short way round, across ±180°.
    func testPhaseWrapsAround() {
        var gate = DirectionGate()
        gate.step(frame(0, 170, power: 0), dt: 1.0 / 60)
        for _ in 0..<120 { gate.step(frame(0, -170, power: 30), dt: 1.0 / 60) }
        XCTAssertGreaterThan(abs(gate.cues?.phase ?? 0), 165)
    }

    /// The path through cues like those measured on an iPhone 15 Pro: the
    /// phase splits left from ahead, the level ahead from right, and a
    /// voice reads as its place along the way.
    func testCalibratedPathFollowsBothCues() {
        var cal = DirectionCalibration()
        XCTAssertNil(cal.pan(DirectionCues(level: 0, phase: 0)))
        let left = DirectionCues(level: 1.4, phase: -50), ahead = DirectionCues(level: 0.7, phase: 0), right = DirectionCues(level: 8.2, phase: 130)
        for (side, cues) in [(DirectionSide.left, left), (.ahead, ahead), (.right, right)] {
            cal.add(side, cues: cues, spread: DirectionCues(level: 1.5, phase: 15))
        }
        XCTAssertEqual(cal.pan(left) ?? 9, -1, accuracy: 0.01)
        XCTAssertEqual(cal.pan(ahead) ?? 9, 0, accuracy: 0.01)
        XCTAssertEqual(cal.pan(right) ?? 9, 1, accuracy: 0.01)
        XCTAssertLessThan(cal.pan(DirectionCues(level: 1, phase: -30)) ?? 9, -0.3)      // left of centre
        XCTAssertGreaterThan(cal.pan(DirectionCues(level: 5, phase: 60)) ?? -9, 0.3)    // right of centre
        XCTAssertEqual(cal.pan(DirectionCues(level: 10, phase: 130)) ?? 9, 1, accuracy: 0.01)
        XCTAssertEqual(cal.pan(DirectionCues(level: -40, phase: 180)) ?? 9, 0, accuracy: 0.01)  // like nothing calibrated
        XCTAssertNil(cal.issue)
        let data = try! JSONEncoder().encode(cal)
        XCTAssertEqual(try! JSONDecoder().decode(DirectionCalibration.self, from: data), cal)
    }

    /// The app computes the training script's features for a recorded
    /// frame, and the model file agrees with the trained one.
    func testFeaturesMatchTraining() throws {
        struct Fixture: Decodable {
            let rate: Double
            let left: [Float], right: [Float], features: [Double]
            let probabilities: [String: [Double]]
        }
        let url = try XCTUnwrap(Bundle.module.url(forResource: "direction-frame", withExtension: "json", subdirectory: "Fixtures"))
        let fx = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        var frame = SpectrumAnalyser(fftSize: 1024).stereoFrame(left: fx.left, right: fx.right, sampleRate: fx.rate)
        frame.mirror()
        XCTAssertEqual(frame.features.count, DirectionModel.featureCount)
        XCTAssertEqual(frame.features.count, fx.features.count)
        for (i, (swift, python)) in zip(frame.features, fx.features).enumerated() {
            XCTAssertEqual(swift, python, accuracy: i < DirectionModel.levelBands.count - 1 ? 0.05 : 0.005, "feature \(i)")
        }
        // The model is not in the repository: point VOICE_DIRECTION_MODEL at
        // a copy of VoiceDirection.mfxl to check it agrees with training.
        guard let path = ProcessInfo.processInfo.environment["VOICE_DIRECTION_MODEL"] else { return }
        let file = try DirectionModelFile(contentsOf: URL(fileURLWithPath: path))
        for pose in DevicePose.allCases {
            let expected = try XCTUnwrap(fx.probabilities[pose.rawValue])
            let p = try XCTUnwrap(file.model(for: pose)).probabilities(frame.features)
            XCTAssertEqual(p.x, expected[0], accuracy: 0.02, "\(pose) left")
            XCTAssertEqual(p.y, expected[1], accuracy: 0.02, "\(pose) ahead")
            XCTAssertEqual(p.z, expected[2], accuracy: 0.02, "\(pose) right")
        }
    }

    /// Mirroring flips the levels and the phases' sines, nothing else.
    func testMirror() {
        let n = DirectionModel.featureCount, levels = DirectionModel.levelBands.count - 1
        var f = StereoFrame(cues: DirectionCues(level: 2, phase: 30), features: (0..<n).map { Double($0 + 1) }, power: 0)
        f.mirror()
        XCTAssertEqual(f.cues, DirectionCues(level: -2, phase: -30))
        XCTAssertEqual(f.features[0], -1)
        XCTAssertEqual(f.features[levels], Double(levels + 1))         // a cosine
        XCTAssertEqual(f.features[levels + 1], -Double(levels + 2))    // a sine
    }

    /// A calibration that came out wrong says so: the third session on the
    /// iPhone, where right sounded like ahead and ahead fell past it.
    func testIssues() {
        var cal = DirectionCalibration()
        let spread = DirectionCues(level: 2.8, phase: 21)
        cal.add(.left, cues: DirectionCues(level: 0.1, phase: -33), spread: spread)
        cal.add(.right, cues: DirectionCues(level: 3.0, phase: 1), spread: spread)
        XCTAssertEqual(cal.issue, .sidesAlike)
        cal.add(.right, cues: DirectionCues(level: 8, phase: 98), spread: spread)
        XCTAssertNil(cal.issue)
        cal.add(.ahead, cues: DirectionCues(level: 9, phase: 120), spread: spread)
        XCTAssertEqual(cal.issue, .aheadOutside)
    }

    /// The decision commits only after the voice keeps reading one way,
    /// ignores a reading that flips back and forth, and crosses from one
    /// side to the other through the centre.
    func testDecisionWaitsForConfidence() {
        let dt = 1.0 / 60
        var d = DirectionDecision()
        for _ in 0..<24 { d.step(0.8, dt: dt) }                       // 0.4 s
        XCTAssertEqual(d.side, 0)
        XCTAssertLessThan(abs(d.pan), 0.05)
        for _ in 0..<126 { d.step(0.8, dt: dt) }                      // 2.5 s
        XCTAssertEqual(d.side, 1)
        XCTAssertGreaterThan(d.pan, 0.5)

        // a weak reading never commits, however long it lasts
        var weak = DirectionDecision()
        for _ in 0..<600 { weak.step(0.45, dt: dt) }
        XCTAssertEqual(weak.side, 0)

        var sides: [Int] = [d.side]
        for _ in 0..<240 {
            d.step(-0.8, dt: dt)
            if sides.last != d.side { sides.append(d.side) }
        }
        XCTAssertEqual(sides, [1, 0, -1])

        var flicker = DirectionDecision()
        for i in 0..<600 { flicker.step((i / 9) % 2 == 0 ? 0.8 : -0.8, dt: dt) }   // flips every 0.15 s
        XCTAssertEqual(flicker.side, 0)
        XCTAssertLessThan(abs(flicker.pan), 0.1)

        for _ in 0..<240 { d.step(nil, dt: dt) }                      // quiet
        XCTAssertEqual(d.side, 0)
    }

    /// A calibration window keeps the strong voice and refuses silence.
    func testMeasureNeedsAVoice() {
        let quiet = (0..<100).map { _ in frame(6, 120, power: -10) }
        XCTAssertNil(DirectionCalibration.measure(quiet))
        let talk = (0..<100).map { i in i % 3 == 0 ? frame(6, 120, power: -10) : frame(-2 + Double(i % 5) * 0.1, -50 + Double(i % 5), power: 30) }
        let m = DirectionCalibration.measure(talk)
        XCTAssertEqual(m?.cues.level ?? 0, -1.8, accuracy: 0.25)
        XCTAssertEqual(m?.cues.phase ?? 0, -48, accuracy: 1)
        XCTAssertLessThan(m?.spread.phase ?? 99, 3)
    }

    /// The analyser reads a louder, later right channel: 6 dB up, and the
    /// phase behind by the delay at the band's middle.
    func testAnalyserFindsLevelAndPhase() {
        var seed: UInt64 = 1
        let noise: [Float] = (0..<1200).map { _ in
            seed = seed &* 6364136223846793005 &+ 1442695040888963407
            return Float(Int64(bitPattern: seed >> 11) % 2000) / 2000
        }
        let delay = 10
        let left = Array(noise[delay..<(delay + 1024)])
        let right = (0..<1024).map { 2 * noise[$0] }          // 6 dB louder, 10 samples behind
        let f = SpectrumAnalyser(fftSize: 1024).stereoFrame(left: left, right: right, sampleRate: 48000)
        XCTAssertEqual(f.cues.level, 6.02, accuracy: 0.5)
        XCTAssertEqual(f.cues.phase, -360 * 450 * Double(delay) / 48000, accuracy: 12)
    }
}
