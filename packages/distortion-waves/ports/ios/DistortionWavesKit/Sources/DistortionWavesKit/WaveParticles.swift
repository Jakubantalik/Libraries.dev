import SwiftUI

/// One tiny white dot. Like everything else in the wave, where it is follows from
/// the front alone, so it scrubs and reverses with the rest.
///
/// During the anticipation it makes short hops toward the source: each starts
/// somewhere above it, flies a little way in, faster and faster, and fades out
/// well short of it, while the next starts somewhere else. When the front leaves,
/// the dot is thrown out with it: the quickest ride the front, the slowest trail far
/// behind. As the wave settles each one floats on, swaying and twinkling, until it
/// fades out. No two are equally bright.
///
/// Round a ring it is the same, all the way round: the hops come in from every
/// side, and the dots are thrown out every way.
struct WaveParticle {
    let index: Double
    /// Where across the source it leaves from, -1…1.
    let column: Double
    /// Which way it leaves a ring, radians.
    let heading: Double
    /// Its share of the front's way: 1 rides the front, less trails behind it.
    let pace: Double
    /// How fast it keeps rising once the front has slowed down, pt/s.
    let drift: Double
    /// How far it sways from side to side, pt.
    let sway: Double
    let swayRate: Double
    let twinkleRate: Double
    let phase: Double
    /// Seconds after the launch by which it has faded out.
    let life: Double
    /// Its diameter, pt.
    let size: Double
    /// How bright it is at its brightest, 0–1.
    let brightness: Double
    /// Seconds each hop toward the source lasts.
    let hop: Double
    let hopOffset: Double

    private let reach: Double
    private let flight: Double
    private let gap: Double
    private let anticipation: Double
    private let gatherDots: Double
    private let spread: Double

    /// How much wider than the source the quickest end up: the front is an arc, opening.
    private static let fan = 0.22
    /// How much lower they fly at the source's ends than in its middle, as the front does.
    private static let bow = 0.3

    init(index: Int, style: DistortionWaveStyle) {
        // Low-discrepancy sequences: evenly scattered, the same on every run.
        let i = Double(index + 1)
        func scatter(_ step: Double) -> Double { (i * step).truncatingRemainder(dividingBy: 1) }
        self.index = i
        // Short of the source's ends, so a dot leaving it starts behind it.
        column = (scatter(0.7548776662) * 2 - 1) * 0.92
        heading = scatter(0.7548776662) * 2 * .pi
        // More of them toward the front, the rest thinning out behind it.
        pace = 0.35 + 0.72 * scatter(0.8191725134).squareRoot()
        drift = 15 + 50 * scatter(0.6710436067)
        sway = 3 + 11 * scatter(0.4142135624)
        swayRate = 2.5 + 3.5 * scatter(0.7320508076)
        twinkleRate = 8 + 12 * scatter(0.2360679775)
        phase = scatter(0.6180339887) * 2 * .pi
        life = style.particleLife * (0.4 + 0.6 * scatter(0.6457513111))
        let small = scatter(0.5497004779)
        size = style.particleSize * (0.55 + 0.45 * small * small)
        brightness = 0.3 + 0.7 * scatter(0.6055512755)
        hop = 0.16 + 0.14 * scatter(0.1231056256)
        hopOffset = scatter(0.4721359550)
        reach = style.particleReach
        flight = style.particleFlight
        gap = style.particleGap
        anticipation = style.anticipation
        gatherDots = style.gatherDots
        spread = min(max(style.particleSpread, 0), 1)
    }

    func point(on front: WaveFront, source: CGRect) -> CGPoint {
        if front.ring {
            return front.launched ? ringOutflow(front, source: source) : ringInflow(front, source: source)
        }
        return front.launched ? outflow(front, source: source) : inflow(front, source: source)
    }

    func opacity(on front: WaveFront) -> Double {
        let twinkle = 0.5 + 0.5 * sin(front.time * twinkleRate + phase)
        let glint = brightness * (0.7 + 0.3 * twinkle)
        if !front.launched {
            // In and out within each hop, and all of them gone by the launch.
            let along = hopAt(front.time).along
            let hopping = WaveFront.smooth(0, 0.25, along) * (1 - WaveFront.smooth(0.55, 1, along))
            let ending = 1 - WaveFront.smooth(anticipation * 0.75, anticipation, front.time)
            return front.sparkle * hopping * ending * glint * gatherDots
        }
        let burning = 1 - WaveFront.smooth(life * 0.55, life, front.flying)
        return burning * glint
    }

    /// Which hop it is on at `time`, and how far through it, 0–1.
    func hopAt(_ time: Double) -> (count: Double, along: Double) {
        let hops = time / hop + hopOffset
        let count = hops.rounded(.down)
        return (count, hops - count)
    }

    /// In the source's own frame: `along` its long side, `out` the way the wave
    /// will travel (up for the vertical wave, right for the horizontal one).
    private func onSource(_ source: CGRect, sideways: Bool, along: Double, out: Double) -> CGPoint {
        sideways
            ? CGPoint(x: Double(source.midX) + out, y: Double(source.midY) + along)
            : CGPoint(x: Double(source.midX) + along, y: Double(source.midY) - out)
    }

    private func inflow(_ front: WaveFront, source: CGRect) -> CGPoint {
        let (count, along) = hopAt(front.time)
        let half = Double(front.sideways ? source.height : source.width) / 2
        let face = Double(front.sideways ? source.width : source.height) / 2
        // Born somewhere off the source's face, never nearer than the hop and the gap.
        let x = (Self.hash(index, count, 1) * 2 - 1) * (half + 24)
        let nearest = gap + flight
        let away = nearest + max(reach - nearest, 0) * Self.hash(index, count, 2)
        let start = onSource(source, sideways: front.sideways, along: x, out: face + away)
        // Flying for the nearest point of the source's face, faster and faster.
        let corner = Double(min(source.width, source.height)) / 2
        let target = onSource(source, sideways: front.sideways, along: min(max(x, -half + corner), half - corner), out: face)
        let dx = target.x - start.x, dy = target.y - start.y
        let length = max(hypot(dx, dy), 1)
        let travelled = flight * along * along
        return CGPoint(x: start.x + dx / length * travelled, y: start.y + dy / length * travelled)
    }

    private func outflow(_ front: WaveFront, source: CGRect) -> CGPoint {
        let start = Double(min(source.width, source.height)) / 2
        let widening = 1 + Self.fan * front.moved * pace * spread
        let swaying = sway * sin(swayRate * front.flying + phase) * min(front.flying / 0.25, 1)
        let x = column * Double(front.sideways ? source.height : source.width) / 2 * widening + swaying
        let height = (start + (front.radius - start) * pace * spread) * (1 - Self.bow * column * column)
            + drift * front.flying * spread
        // Into the wave's frame, which leans with the touch.
        let cs = cos(front.tilt), sn = sin(front.tilt)
        return CGPoint(x: front.origin.x + cs * x + sn * height, y: front.origin.y + sn * x - cs * height)
    }

    /// A hop toward a round source's centre from somewhere round it.
    private func ringInflow(_ front: WaveFront, source: CGRect) -> CGPoint {
        let (count, along) = hopAt(front.time)
        let angle = Self.hash(index, count, 1) * 2 * .pi
        let nearest = Double(min(source.width, source.height)) / 2 + gap + flight
        let away = nearest + max(reach - nearest, 0) * Self.hash(index, count, 2)
        let distance = away - flight * along * along
        return CGPoint(x: Double(source.midX) + cos(angle) * distance, y: Double(source.midY) + sin(angle) * distance)
    }

    /// Thrown straight out with the ring, swaying across its way.
    private func ringOutflow(_ front: WaveFront, source: CGRect) -> CGPoint {
        let edge = Double(min(source.width, source.height)) / 2
        let distance = edge + ((front.radius - edge) * pace + drift * front.flying) * spread
        let swaying = sway * sin(swayRate * front.flying + phase) * min(front.flying / 0.25, 1)
        let dx = cos(heading), dy = sin(heading)
        return CGPoint(x: front.origin.x + dx * distance - dy * swaying, y: front.origin.y + dy * distance + dx * swaying)
    }

    private static func hash(_ i: Double, _ n: Double, _ salt: Double) -> Double {
        let x = sin(i * 12.9898 + n * 78.233 + salt * 37.719) * 43758.5453
        return x - x.rounded(.down)
    }
}

/// All the dots, drawn over the wave's colour: flat white, nothing around them.
struct WaveParticles: View {
    let front: WaveFront
    let source: CGRect
    let style: DistortionWaveStyle
    let on: Bool

    var body: some View {
        Canvas { context, _ in
            guard on else { return }
            for index in 0..<style.particleCount {
                let particle = WaveParticle(index: index, style: style)
                let opacity = particle.opacity(on: front)
                guard opacity > 0 else { continue }
                let center = particle.point(on: front, source: source)
                let radius = particle.size / 2
                context.opacity = opacity
                context.fill(
                    Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)),
                    with: .color(.white)
                )
            }
        }
    }
}
