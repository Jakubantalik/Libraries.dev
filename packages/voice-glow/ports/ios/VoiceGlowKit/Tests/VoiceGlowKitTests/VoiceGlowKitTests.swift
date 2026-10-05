import XCTest
@testable import VoiceGlowKit

final class VoiceGlowKitTests: XCTestCase {
    // MARK: Driver maths (web parity)

    func testShapeGatesAndSaturates() {
        XCTAssertEqual(VoiceGlowEngine.shape(0.01, 0.015), 0)
        XCTAssertEqual(VoiceGlowEngine.shape(1, 0.015), 1, accuracy: 1e-9)
        XCTAssertGreaterThan(VoiceGlowEngine.shape(0.3, 0.015), 0.5)
    }

    func testWrapStaysInRing() {
        let span = VoiceGlowStyle.lobeSpan
        for x in stride(from: -600.0, through: 600, by: 37) {
            let w = VoiceGlowEngine.wrapX(x, span)
            XCTAssertGreaterThanOrEqual(w, -span / 2)
            XCTAssertLessThan(w, span / 2)
        }
    }

    func testBellIsOneAtCentreZeroAtEnds() {
        XCTAssertEqual(VoiceGlowBand.bell(0, 1.75, 0.87, 0.12), 1, accuracy: 1e-9)
        XCTAssertEqual(VoiceGlowBand.bell(1, 1.75, 0.87, 0.12), 0, accuracy: 1e-9)
        XCTAssertEqual(VoiceGlowBand.bell(-1, 1.75, 0.87, 0.12), 0, accuracy: 1e-9)
    }

    func testEngineRisesWithLevelAndFadesIn() {
        let engine = VoiceGlowEngine()
        let config = VoiceGlowConfig(type: .standard, options: .init(), dark: true, colorVariant: .colorful, cornerRadius: 16, reducedMotion: false)
        var frame = VoiceGlowFrame()
        for i in 0..<120 {
            frame = engine.step(
                time: Double(i) / 60,
                input: VoiceGlowInput(level: 0.8, bands: nil, motion: .rest, active: true, mood: nil),
                config: config, size: CGSize(width: 350, height: 120)
            )
        }
        XCTAssertEqual(frame.presence, 1, accuracy: 1e-6)
        XCTAssertGreaterThan(frame.level, 0.8)
        XCTAssertGreaterThan(frame.h, 1.5)
    }

    // MARK: Mood colour

    func testMoodCornersHaveTheirHue() {
        let p = VoiceMoodPalette.standard
        func mean(_ v: Double, _ a: Double) -> VoiceGlowColor {
            let cs = p.colors(valence: v, arousal: a, dark: true).map(\.color)
            return VoiceGlowColor(cs.map(\.r).reduce(0, +) / 7, cs.map(\.g).reduce(0, +) / 7, cs.map(\.b).reduce(0, +) / 7)
        }
        let happy = mean(1, 1), angry = mean(-1, 1), sad = mean(-1, 0)
        XCTAssertGreaterThan(happy.g, happy.r)
        XCTAssertGreaterThan(happy.g, happy.b)
        XCTAssertGreaterThan(angry.r, angry.g)
        XCTAssertGreaterThan(angry.r, angry.b)
        // Every negative mood is red: sad as well as angry, and in between.
        for neg in [sad, mean(-0.8, 0.5), mean(-0.5, 0.2)] {
            XCTAssertGreaterThan(neg.r, neg.g * 2)
            XCTAssertGreaterThan(neg.r, neg.b * 2)
        }
    }

    func testConfidentMoodTakesOverThePalette() {
        let engine = VoiceGlowEngine()
        let config = VoiceGlowConfig(type: .standard, options: .init(), dark: true, colorVariant: .colorful, cornerRadius: 16, reducedMotion: true)
        var frame = VoiceGlowFrame()
        for i in 0..<(60 * 8) {
            frame = engine.step(
                time: Double(i) / 60,
                input: VoiceGlowInput(level: 0.5, bands: nil, motion: .rest, active: true, mood: .angry),
                config: config, size: CGSize(width: 350, height: 120)
            )
        }
        XCTAssertGreaterThan(frame.moodAmount, 0.95)
        let red = frame.colors.map(\.x).reduce(0, +), green = frame.colors.map(\.y).reduce(0, +)
        XCTAssertGreaterThan(red, green * 2)
    }

    func testOKLabRoundTrip() {
        let c = VoiceGlowColor(255, 70, 120)
        let back = OKLab(c).color
        XCTAssertEqual(back.r, c.r, accuracy: 0.5)
        XCTAssertEqual(back.g, c.g, accuracy: 0.5)
        XCTAssertEqual(back.b, c.b, accuracy: 0.5)
    }

    // MARK: Motion

    func testGatheredMotionNarrowsAndHoldsTheGlow() {
        let engine = VoiceGlowEngine()
        let config = VoiceGlowConfig(type: .mobile, options: .init(), dark: true, colorVariant: .colorful, cornerRadius: 55, reducedMotion: false)
        var frame = VoiceGlowFrame()
        let motion = VoiceGlowMotion(gather: 1, offset: 0.5, stretch: 1, heldLevel: 0.35, cornerFollow: 0.4)
        for i in 0..<120 {
            frame = engine.step(
                time: Double(i) / 60,
                input: VoiceGlowInput(level: 0, bands: nil, motion: motion, active: true, mood: nil),
                config: config, size: CGSize(width: 402, height: 874)
            )
        }
        XCTAssertEqual(frame.morph, 1)
        XCTAssertLessThan(frame.maskWidth, 0.6)
        XCTAssertGreaterThan(frame.cx, 0)
        XCTAssertGreaterThan(frame.glow, 0.15 + 0.85 * 0.3)
    }
}
