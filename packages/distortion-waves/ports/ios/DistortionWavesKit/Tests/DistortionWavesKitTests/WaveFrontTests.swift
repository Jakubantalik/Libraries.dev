import CoreGraphics
import XCTest
@testable import DistortionWavesKit

final class WaveFrontTests: XCTestCase {
    private let screen = CGSize(width: 402, height: 874)
    private let button = CGRect(x: 20, y: 782, width: 362, height: 58)
    private let style = DistortionWaveStyle.vertical

    private func front(_ p: Double) -> WaveFront {
        WaveFront(progress: p, source: button, size: screen, style: style)
    }

    private func front(seconds: Double) -> WaveFront {
        front(seconds / style.duration)
    }

    /// The farthest point of the screen in the field's own metric.
    private func farthest(_ f: WaveFront) -> Double {
        hypot(Double(button.midX) * f.squash, Double(button.midY))
    }

    /// The front starts the style's gap out from the button's outline: an offset
    /// of the pill, with the button's own spine.
    func testLaunchesClearOfTheSourceOutline() {
        let f = front(seconds: style.anticipation)
        XCTAssertEqual(f.radius, 29 + style.launchGap, accuracy: 0.01)
        XCTAssertEqual(f.spine, 181 - 29, accuracy: 0.01)
        XCTAssertEqual(f.squash, 1, accuracy: 0.001)
        XCTAssertEqual(f.energy, 0, accuracy: 0.001)
    }

    /// Gravity is a quick pull that peaks on the launch and lets go right after.
    func testGravityPullsOnlyAroundTheLaunch() {
        XCTAssertEqual(front(0).gravity, 0, accuracy: 0.001)
        XCTAssertEqual(front(seconds: style.anticipation).gravity, style.pull, accuracy: 0.01)
        XCTAssertEqual(front(seconds: style.anticipation + 0.25).gravity, 0, accuracy: 0.001)
    }

    /// Before the launch the ring of colour falls in onto where the front starts.
    func testRingFallsInBeforeTheLaunch() {
        var last = Double.infinity
        for i in 0...40 {
            let f = front(seconds: style.anticipation * Double(i) / 40)
            XCTAssertLessThanOrEqual(f.radius, last)
            last = f.radius
        }
        XCTAssertEqual(front(0).radius, 29 + style.launchGap + style.inhale, accuracy: 0.01)
    }

    /// After the launch the front must never retreat as the pill opens into an
    /// arc, or the wave would be seen to pull back in from the screen's edges.
    func testFrontOnlyEverMovesOutwardAfterTheLaunch() {
        var lastTop = -Double.infinity
        var lastSide = -Double.infinity
        for i in 0...400 {
            let f = front(seconds: style.anticipation + (style.duration - style.anticipation) * Double(i) / 400)
            let top = f.radius
            let side = (f.spine + f.radius) / f.squash
            XCTAssertGreaterThanOrEqual(top, lastTop)
            XCTAssertGreaterThanOrEqual(side, lastSide - 0.001)
            lastTop = top
            lastSide = side
        }
    }

    /// The edge colour's thickness averages the rim's width, as if it were even,
    /// and is strongly uneven: about a tenth as thick at its thinnest and almost
    /// three times as thick at its thickest.
    func testRimLumpsAverageOut() {
        let size = CGSize(width: 402, height: 874)
        let r = 62.0
        let ex = 201 - r, ey = 437 - r
        let perimeter = 4 * (ex + ey + 0.5 * .pi * r)
        var all: [Double] = []
        for t in stride(from: 0.0, through: 2.0, by: 0.25) {
            let lumps = WaveRim.lumps(time: t, size: size, cornerRadius: r).map(Double.init)
            for k in 0..<500 {
                let s = perimeter * Double(k) / 500
                var thickness = 0.08
                for i in stride(from: 0, to: lumps.count, by: 3) {
                    var ds = s - lumps[i]
                    ds -= perimeter * (ds / perimeter).rounded()
                    thickness += lumps[i + 2] * exp(-pow(ds / lumps[i + 1], 2))
                }
                all.append(thickness / 1.0498)
            }
        }
        let mean = all.reduce(0, +) / Double(all.count)
        XCTAssertEqual(mean, 1, accuracy: 0.03)
        XCTAssertLessThan(all.min()!, 0.2)
        XCTAssertGreaterThan(all.max()!, 2.5)
    }

    /// Touched near its right end, the wave still leaves the button's own outline,
    /// then opens from under the finger and leans right, so the right side leads.
    func testLeansWithTheTouch() {
        let finger = CGPoint(x: button.maxX - 30, y: button.midY)
        let launch = WaveFront(progress: style.anticipation / style.duration, source: button, size: screen, style: style, focus: finger)
        XCTAssertEqual(Double(launch.origin.x), Double(button.midX), accuracy: 0.001)
        XCTAssertEqual(launch.tilt, 0, accuracy: 0.0001)
        let open = WaveFront(progress: (style.anticipation + 0.3 * style.travel) / style.duration, source: button, size: screen, style: style, focus: finger)
        XCTAssertGreaterThan(Double(open.origin.x), Double(button.midX) + 40)
        XCTAssertGreaterThan(open.tilt, 0.1)
        // The front is further up the screen on the touched side.
        func frontHeight(atX x: Double, _ f: WaveFront) -> Double {
            var y = Double(f.origin.y)
            while y > 0 {
                let dx = x - Double(f.origin.x), dy = y - Double(f.origin.y)
                let qx = cos(f.tilt) * dx + sin(f.tilt) * dy
                let qy = -sin(f.tilt) * dx + cos(f.tilt) * dy
                if hypot(max(abs(qx * f.squash) - f.spine, 0), qy) >= f.radius { break }
                y -= 1
            }
            return Double(f.origin.y) - y
        }
        let crossing = WaveFront(progress: (style.anticipation + 0.08 * style.travel) / style.duration, source: button, size: screen, style: style, focus: finger)
        XCTAssertLessThan(frontHeight(atX: 40, crossing), 700)
        XCTAssertGreaterThan(frontHeight(atX: 360, crossing), frontHeight(atX: 40, crossing) + 30)

        var even = style
        even.orientation = 0
        let level = WaveFront(progress: (style.anticipation + 0.3 * style.travel) / style.duration, source: button, size: screen, style: even, focus: finger)
        XCTAssertEqual(Double(level.origin.x), Double(button.midX), accuracy: 0.001)
        XCTAssertEqual(level.tilt, 0, accuracy: 0.0001)
    }

    /// The colour on the edges is wiped on ease-in-out: slow to start, half way
    /// at half time, slow to settle, and gone by the end. With a wipe that starts
    /// after the tap; the defaults may start it a moment before.
    func testEdgesWipeOnEaseInOut() {
        var wiped = style
        wiped.linger = 0.3
        func clear(_ seconds: Double) -> Double {
            WaveFront(progress: seconds / wiped.duration, source: button, size: screen, style: wiped).clearRadius
        }
        let begin = wiped.anticipation + wiped.linger
        let start = clear(begin)
        let end = clear(begin + wiped.rimFade)
        func share(_ part: Double) -> Double {
            (clear(begin + part * wiped.rimFade) - start) / (end - start)
        }
        XCTAssertEqual(share(0.5), 0.5, accuracy: 0.001)
        XCTAssertLessThan(share(0.1), 0.05)
        XCTAssertGreaterThan(share(0.9), 0.95)
        XCTAssertLessThanOrEqual(begin + wiped.rimFade, wiped.duration + 0.001)
        XCTAssertLessThanOrEqual(style.anticipation + style.linger + style.rimFade, style.duration + 0.001)
    }

    /// The curve's parameter at 1/2 gives x = 0.3425, y = 0.875 by hand.
    func testEasingMatchesCSS() {
        let easing = DistortionWaveEasing(0.22, 1, 0.36, 1)
        XCTAssertEqual(easing(0), 0)
        XCTAssertEqual(easing(1), 1)
        XCTAssertEqual(easing(0.3425), 0.875, accuracy: 0.0001)
    }

    /// With edges held long enough that the wave runs its whole travel; with the
    /// defaults it ends once the front has settled, short of the curve's end.
    func testFrontMovesOnTheEasing() {
        var long = style
        long.linger = 2
        long.rimFade = 2
        func radius(_ seconds: Double) -> Double {
            WaveFront(progress: seconds / long.duration, source: button, size: screen, style: long).radius
        }
        let start = radius(long.anticipation)
        let end = radius(long.anticipation + long.travel)
        let mid = radius(long.anticipation + 0.3425 * long.travel)
        XCTAssertEqual((mid - start) / (end - start), 0.875, accuracy: 0.0001)
    }

    /// The front has crossed the screen long before the easing lets it stop, and
    /// what it carries must not hang there, parked, while it slows down.
    func testSwellBlurAndColourDieAsTheFrontSettles() {
        let f = front(seconds: style.anticipation + 0.55 * style.travel)
        XCTAssertTrue(f.hasCleared)
        XCTAssertEqual(f.energy, 0, accuracy: 0.001)
        XCTAssertEqual(f.glow, 0, accuracy: 0.001)
    }

    private var particles: [WaveParticle] {
        (0..<style.particleCount).map { WaveParticle(index: $0, style: style) }
    }

    private func distanceToButton(_ p: CGPoint) -> Double {
        let dx = max(Double(button.minX - p.x), 0, Double(p.x - button.maxX))
        let dy = max(Double(button.minY - p.y), 0, Double(p.y - button.maxY))
        return hypot(dx, dy)
    }

    /// In the anticipation the dots make short hops toward the button: never
    /// nearer than the gap, each closing in by no more than the hop.
    func testParticlesHopTowardTheButton() {
        for particle in particles {
            var hopStart: (count: Double, distance: Double)?
            for i in 0..<200 {
                let seconds = style.anticipation * Double(i) / 200
                let f = front(seconds: seconds)
                let distance = distanceToButton(particle.point(on: f, source: button))
                XCTAssertGreaterThanOrEqual(distance, style.particleGap - 0.5)
                XCTAssertLessThanOrEqual(distance, style.particleReach + 30)
                let count = particle.hopAt(f.time).count
                if let start = hopStart, start.count == count {
                    XCTAssertLessThanOrEqual(distance, start.distance + 0.001)
                    XCTAssertLessThanOrEqual(start.distance - distance, style.particleFlight + 0.5)
                } else {
                    hopStart = (count, distance)
                }
            }
        }
    }

    /// No two equally bright.
    func testParticlesDifferInBrightness() {
        let levels = Set(particles.map { ($0.brightness * 20).rounded() })
        XCTAssertGreaterThan(levels.count, 10)
        XCTAssertGreaterThanOrEqual(particles.map(\.brightness).min()!, 0.3)
    }

    /// Once the wave has left, every dot only rises, and the quickest stay with
    /// the front while it crosses the screen.
    func testParticlesRideOutWithTheFront() {
        for particle in particles {
            var lastY = Double.infinity
            for i in 1...200 {
                let f = front(seconds: style.anticipation + style.travel * Double(i) / 200)
                let y = Double(particle.point(on: f, source: button).y)
                XCTAssertLessThanOrEqual(y, lastY + 0.001)
                lastY = y
            }
        }
        let quickest = particles.filter { $0.pace > 0.95 }.min { abs($0.column) < abs($1.column) }!
        for seconds in [0.05, 0.1, 0.2] {
            let f = front(seconds: style.anticipation + seconds)
            let height = f.origin.y - Double(quickest.point(on: f, source: button).y)
            XCTAssertEqual(height, f.radius, accuracy: style.lead)
        }
    }

    /// They fly as a scatter, not as one sheet: by the time the wave has settled
    /// they are spread over much of the screen's height.
    func testParticlesSpreadOutBehindTheFront() {
        let f = front(seconds: style.anticipation + 0.5)
        let heights = particles.map { Double($0.point(on: f, source: button).y) }
        XCTAssertGreaterThan(heights.max()! - heights.min()!, 400)
    }

    /// Each burns out in its own time, and all before the edges have cleared.
    func testParticlesBurnOutOneByOne() {
        XCTAssertTrue(particles.allSatisfy { $0.opacity(on: front(0)) == 0 })
        let launch = front(seconds: style.anticipation + 0.05)
        XCTAssertTrue(particles.allSatisfy { $0.opacity(on: launch) > 0 })
        let midway = particles.map { $0.opacity(on: front(seconds: style.anticipation + 0.5 * style.particleLife)) }
        XCTAssertTrue(midway.contains { $0 == 0 })
        XCTAssertTrue(midway.contains { $0 > 0 })
        let burnt = front(seconds: style.anticipation + style.particleLife)
        XCTAssertLessThanOrEqual(style.anticipation + style.particleLife, style.duration + 0.001)
        XCTAssertTrue(particles.allSatisfy { $0.opacity(on: burnt) == 0 })
    }

    /// Once the front's colour has gone, the edges still hold theirs.
    /// With a hold longer than the front takes to settle; the defaults start
    /// wiping the edges sooner.
    func testColourStaysOnTheEdgesAfterTheFrontHasLeft() {
        var held = style
        held.linger = 0.9
        held.rimFade = 2.05
        let f = WaveFront(progress: (held.anticipation + 0.6 * held.travel) / held.duration, source: button, size: screen, style: held)
        XCTAssertEqual(f.glow, 0, accuracy: 0.001)
        XCTAssertEqual(f.energy, 0, accuracy: 0.001)
        XCTAssertEqual(f.rim, held.rimStrength, accuracy: 0.001)
        XCTAssertLessThan(f.clearRadius, farthest(f))
    }

    /// At the end everything has left the screen, so hiding the outgoing side and
    /// switching the shaders off cannot be seen.
    func testEverythingHasLeftTheScreenByTheEnd() {
        let f = front(1)
        XCTAssertTrue(f.hasCleared)
        XCTAssertGreaterThan(f.clearRadius - style.rimSoftness - style.swell, farthest(f))
        XCTAssertGreaterThanOrEqual(f.hairClearRadius - style.rimSoftness - style.swell + 0.001, farthest(f))
        XCTAssertEqual(f.energy, 0, accuracy: 0.001)
        XCTAssertEqual(f.glow, 0, accuracy: 0.001)
        XCTAssertEqual(f.rim, 0, accuracy: 0.001)
        XCTAssertEqual(f.gravity, 0, accuracy: 0.001)
    }

    /// The hairline is wiped later and slower than the colour under it: never
    /// ahead of it, and still on the edges once the colour has gone.
    func testHairlineOutlastsTheColour() {
        // The defaults are the user's own and may bring the two close; this
        // checks the mechanism with a line that clearly holds on.
        var style = DistortionWaveStyle.vertical
        style.rimFade = 2.51
        style.hairlineLinger = 0.25
        style.hairlineFade = 3.0
        func at(_ seconds: Double) -> WaveFront {
            WaveFront(progress: seconds / style.duration, source: button, size: screen, style: style)
        }
        for i in 0...200 {
            let f = at(style.duration * Double(i) / 200)
            XCTAssertLessThanOrEqual(f.hairClearRadius, f.clearRadius + 0.001)
        }
        let f = at(style.anticipation + style.linger + style.rimFade)
        XCTAssertGreaterThan(f.clearRadius - f.hairClearRadius, 100)
        // Some of it is still kept on the farthest corner.
        XCTAssertLessThan(f.hairClearRadius - style.rimSoftness, farthest(f))
        XCTAssertGreaterThanOrEqual(style.duration, style.anticipation + style.linger + style.hairlineLinger + style.hairlineFade)
    }

    /// The outgoing side stops being drawn partway through, but never while the
    /// front is still on screen.
    func testClearsOnlyOnceTheFrontHasCrossedTheScreen() {
        XCTAssertFalse(front(seconds: style.anticipation + 0.2).hasCleared)
        XCTAssertTrue(front(seconds: style.anticipation + style.travel).hasCleared)
        for i in 0...400 {
            let f = front(Double(i) / 400)
            if f.hasCleared {
                XCTAssertGreaterThan(f.radius, farthest(f) + WaveFront.coverZone)
            }
        }
    }

    // MARK: Ring

    private let sheet = CGSize(width: 386, height: 509)
    private let avatar = CGRect(x: 161, y: 54, width: 64, height: 64)

    private func ring(seconds: Double, focus: CGPoint? = nil) -> WaveFront {
        WaveFront(progress: seconds / DistortionWaveStyle.center.duration, source: avatar, size: sheet, style: .center, focus: focus)
    }

    /// A ring is a circle round the avatar's centre all the way: no spine, no
    /// squash, and no lean, wherever it was touched.
    func testRingSpreadsEvenlyFromTheCentre() {
        let style = DistortionWaveStyle.center
        for t in stride(from: 0.0, through: style.duration, by: 0.1) {
            let f = ring(seconds: t, focus: CGPoint(x: avatar.maxX, y: avatar.midY))
            XCTAssertEqual(f.spine, 0, accuracy: 0.001)
            XCTAssertEqual(f.squash, 1, accuracy: 0.001)
            XCTAssertEqual(f.tilt, 0, accuracy: 0.001)
            XCTAssertEqual(f.origin.x, avatar.midX, accuracy: 0.001)
            XCTAssertEqual(f.origin.y, avatar.midY, accuracy: 0.001)
            XCTAssertTrue(f.ring)
            // The token itself is held out of the wave.
            XCTAssertEqual(f.hold, 32, accuracy: 0.001)
        }
        XCTAssertEqual(ring(seconds: style.anticipation).radius, 32, accuracy: 0.01)
    }

    /// The ring has left every corner of the sheet, and cleared its edges, by the end.
    func testRingCrossesTheWholeSheet() {
        let style = DistortionWaveStyle.center
        let end = ring(seconds: style.duration)
        let corner = hypot(Double(sheet.width - avatar.midX), Double(sheet.height - avatar.midY))
        XCTAssertGreaterThan(end.radius, corner + WaveFront.coverZone)
        XCTAssertGreaterThanOrEqual(end.clearRadius - style.rimSoftness - style.swell + 0.001, corner)
        XCTAssertTrue(ring(seconds: style.anticipation + style.travel).hasCleared)
    }

    /// The success ring only pulls before the launch: no colour, no dots. Its
    /// colour comes in smoothly once the ring has left the avatar.
    func testSuccessGathersNothingBeforeTheLaunch() {
        let style = DistortionWaveStyle.center
        for t in stride(from: 0.0, through: style.anticipation, by: 0.01) {
            let f = ring(seconds: t)
            XCTAssertEqual(f.glow, 0, accuracy: 0.0001)
            for index in 0..<style.particleCount {
                XCTAssertEqual(WaveParticle(index: index, style: style).opacity(on: f), 0, accuracy: 0.0001)
            }
        }
        XCTAssertEqual(ring(seconds: style.anticipation + 0.01).glow, 0, accuracy: 0.05)
        XCTAssertGreaterThan(ring(seconds: style.anticipation + 0.3).glow, 0.5)
        XCTAssertGreaterThan(ring(seconds: style.anticipation).gravity, 0)
    }

    /// Dots hop in toward the avatar from every side, and are thrown out every way.
    func testRingDotsComeInAndGoOutAllRound() {
        var style = DistortionWaveStyle.center
        style.gatherDots = 1
        let centre = CGPoint(x: avatar.midX, y: avatar.midY)
        var sides = Set<Int>()
        for index in 0..<style.particleCount {
            let dot = WaveParticle(index: index, style: style)
            // Within one hop, it only ever closes in.
            let a = ring(seconds: 0.1), b = ring(seconds: 0.1 + dot.hop * 0.2)
            if dot.hopAt(a.time).count == dot.hopAt(b.time).count {
                XCTAssertLessThan(hypot(dot.point(on: b, source: avatar).x - centre.x, dot.point(on: b, source: avatar).y - centre.y),
                                  hypot(dot.point(on: a, source: avatar).x - centre.x, dot.point(on: a, source: avatar).y - centre.y) + 0.001)
            }
            let out = dot.point(on: ring(seconds: style.anticipation + 0.4), source: avatar)
            XCTAssertGreaterThan(hypot(out.x - centre.x, out.y - centre.y), 32)
            sides.insert(Int((atan2(out.y - centre.y, out.x - centre.x) + .pi) / (.pi / 2)) % 4)
        }
        XCTAssertEqual(sides.count, 4)
    }

    // MARK: Horizontal

    /// A tall source at the screen's left edge, as an edge swipe or a side tab.
    private let edge = CGRect(x: 0, y: 300, width: 24, height: 274)

    private func sideways(seconds: Double, focus: CGPoint? = nil) -> WaveFront {
        let style = DistortionWaveStyle.horizontal
        return WaveFront(progress: seconds / style.duration, source: edge, size: screen, style: style, focus: focus)
    }

    /// How far inside the front a point is, pt: above 0 the front has passed it.
    private func passed(_ p: CGPoint, _ f: WaveFront) -> Double {
        let dx = Double(p.x - f.origin.x), dy = Double(p.y - f.origin.y)
        let qx = cos(f.tilt) * dx + sin(f.tilt) * dy
        let qy = -sin(f.tilt) * dx + cos(f.tilt) * dy
        return f.radius - hypot(max(abs(qx * f.squash) - f.spine, 0), qy)
    }

    /// The horizontal wave leaves the source's own outline and crosses the screen
    /// to the right, well ahead of how far it reaches up or down.
    func testHorizontalTravelsLeftToRight() {
        let style = DistortionWaveStyle.horizontal
        let launch = sideways(seconds: style.anticipation)
        XCTAssertEqual(launch.tilt, .pi / 2, accuracy: 0.0001)
        XCTAssertEqual(launch.spine + launch.radius, 137, accuracy: 0.01)
        XCTAssertEqual(launch.radius, 12, accuracy: 0.01)
        let f = sideways(seconds: style.anticipation + 0.1 * style.travel)
        let right = CGPoint(x: edge.maxX + 250, y: edge.midY)
        let up = CGPoint(x: edge.midX, y: edge.minY - 250)
        XCTAssertGreaterThan(passed(right, f), 0)
        XCTAssertGreaterThan(passed(right, f), passed(up, f) + 60)
        XCTAssertTrue(sideways(seconds: style.anticipation + style.travel).hasCleared)
    }

    /// Touched low on the source, the horizontal wave opens from under the finger
    /// and leans down.
    func testHorizontalLeansWithTheTouch() {
        let style = DistortionWaveStyle.horizontal
        let finger = CGPoint(x: edge.midX, y: edge.maxY - 20)
        let open = sideways(seconds: style.anticipation + 0.3 * style.travel, focus: finger)
        XCTAssertGreaterThan(Double(open.origin.y), Double(edge.midY) + 40)
        XCTAssertEqual(Double(open.origin.x), Double(edge.midX), accuracy: 0.001)
        XCTAssertGreaterThan(open.tilt, .pi / 2 + 0.1)
    }

    /// In the anticipation the dots hop in from the right of the source, toward
    /// its face; after the launch they fly off to the right with the front.
    func testHorizontalDotsComeFromTheRight() {
        let style = DistortionWaveStyle.horizontal
        let before = sideways(seconds: style.anticipation * 0.6)
        let after = sideways(seconds: style.anticipation + 0.5)
        for index in 0..<style.particleCount {
            let dot = WaveParticle(index: index, style: style)
            XCTAssertGreaterThan(dot.point(on: before, source: edge).x, edge.maxX)
            XCTAssertGreaterThan(dot.point(on: after, source: edge).x, edge.midX)
        }
    }
}
