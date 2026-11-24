import XCTest
@testable import VoiceCore
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
