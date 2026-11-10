import CoreGraphics
import Foundation

/// Where the wave is at a moment of its life — a pure function of progress, so
/// the wave can be scrubbed, reversed and frozen for a screenshot.
///
/// Its life, in order: gravity pulls everything toward the source; the front
/// launches off the source's outline, crosses the screen on the style's easing,
/// and settles past the far side as its swell, blur and colour die away; the
/// colour it left on the screen's edges is wiped away by a second front, `linger`
/// seconds behind.
struct WaveFront: Equatable {
    var origin: CGPoint
    /// How far the wave's frame is turned, radians: positive leans it right.
    var tilt: Double
    /// Half-length of the straight part of the pill the front is an offset of.
    var spine: Double
    /// Distance of the front from that spine.
    var radius: Double
    /// How far the front is along its way, 0–1.
    var moved: Double
    /// Scale of the x axis in the field: above 1 the front bows.
    var squash: Double
    var time: Double
    /// How strongly the swell and the blur act, 0–1. 0 at either end of their
    /// part in the wave, so nothing pops as the shaders switch off.
    var energy: Double
    var swell: Double
    var size: CGSize
    /// How far content is pulled toward the source, pt.
    var gravity: Double
    /// How strong the colour on the front is, 0–1.
    var glow: Double
    /// Distance of the later front that wipes the colour off the screen's edges.
    var clearRadius: Double
    /// Distance of the front that wipes the hairline off them, later still.
    var hairClearRadius: Double
    /// Opacity of the colour on the screen's edges, 0–1.
    var rim: Double
    /// How far the particles have fallen into the source, 0–1.
    var fallen: Double
    /// How far the particles have faded in, 0–1.
    var sparkle: Double
    /// Seconds since the front left the source, 0 before that.
    var flying: Double
    /// True once the front has left the source.
    var launched: Bool
    /// True once the front has crossed the whole screen: nothing of the content
    /// it leaves behind can show any more, so that side need not be drawn.
    var hasCleared: Bool
    /// True for a ring spreading from the source's centre, rather than an arc.
    var ring: Bool
    /// True for an arc travelling left to right, rather than bottom to top.
    var sideways: Bool
    /// Radius of the source the wave leaves alone, pt: a ring's, 0 for an arc.
    var hold: Double

    /// Half the zone over which the two screens crossfade, pt (`coverZone` in
    /// the shaders).
    static let coverZone = 60.0
    /// The most an arc's x axis is ever squashed; a ring's never is.
    private static let arcSquash = 1.4
    /// Seconds gravity takes to let go after the launch.
    private static let release = 0.22
    /// How strong the colour gathering around the source gets before the launch.
    private static let gatheredGlow = 0.5
    /// How far past the point of having crossed the screen the front settles,
    /// pt: enough to see the easing's slowing down on screen, and to stop drawing
    /// the outgoing side well before the front stops.
    private static let overshoot = 100.0
    /// How far the wave turns, at full orientation, when touched at the end of
    /// the source: about 26°.
    private static let maxTilt = 0.45
    /// The part of the travel over which the swell, the blur and the colour die
    /// away. The front has crossed the screen by its start, and from there on it
    /// is slowing down too much to carry them off.
    private static let settleStart = 0.2, settleEnd = 0.55

    /// - Parameter focus: where the source was touched, if the wave is to lean
    ///   with it.
    init(progress: Double, source: CGRect, size: CGSize, style: DistortionWaveStyle, focus: CGPoint? = nil) {
        let t = min(max(progress, 0), 1) * style.duration
        let sinceLaunch = t - style.anticipation
        // Eased at both ends: a snap into the pull would read as a jolt.
        let gathered = Self.smooth(0, max(style.anticipation, 0.001), t)
        let x = min(max(sinceLaunch / style.travel, 0), 1)
        let moved = style.easing(x)

        let ring = style.type == .center
        let sideways = style.type == .horizontal
        let fullSquash = ring ? 1 : Self.arcSquash
        let startRadius = Double(min(source.width, source.height)) / 2
        // The source's long side, along which the front starts as a pill: across
        // the screen for the vertical wave, down it for the horizontal one.
        let length = Double(sideways ? source.height : source.width)
        // A ring spreads from the source's centre, whatever the source's shape.
        let startSpine = ring ? 0 : max(0, length / 2 - startRadius)
        // The horizontal wave is the vertical one turned a quarter: its frame's
        // up is the screen's right.
        let turned = sideways ? Double.pi / 2 : 0
        let spineAxis = CGVector(dx: cos(turned), dy: sin(turned))

        // Touched off-centre, the wave opens from under the finger and leans its
        // way: touched on the right, it climbs the right side first. It leans only
        // as the pill opens into an arc, so it still leaves the source's own outline.
        let lean = ring ? 0 : focus.map { touch -> Double in
            let off = sideways ? Double(touch.y - source.midY) : Double(touch.x - source.midX)
            return min(max(off / max(length / 2, 1), -1), 1)
        } ?? 0
        let fullShift = lean * length / 2 * style.orientation
        let fullLean = lean * style.orientation * Self.maxTilt
        let fullTilt = turned + fullLean
        let opening = Self.smooth(0, 0.45, moved)

        // The radius at which the front has left the screen's farthest corner,
        // in the wave's own frame once it has finished leaning.
        let cs = cos(fullTilt), sn = sin(fullTilt)
        var reach = 0.0
        for corner in [CGPoint.zero, CGPoint(x: size.width, y: 0), CGPoint(x: 0, y: size.height), CGPoint(x: size.width, y: size.height)] {
            let dx = Double(corner.x - source.midX) - fullShift * Double(spineAxis.dx)
            let dy = Double(corner.y - source.midY) - fullShift * Double(spineAxis.dy)
            reach = max(reach, hypot((cs * dx + sn * dy) * fullSquash, -sn * dx + cs * dy))
        }
        // …and has taken the outgoing side with it. The field divides by its
        // gradient, at most fullSquash.
        let crossed = reach + (style.swell + Self.coverZone) * fullSquash
        let settling = 1 - Self.smooth(Self.settleStart, Self.settleEnd, x)

        self.origin = CGPoint(
            x: Double(source.midX) + fullShift * opening * Double(spineAxis.dx),
            y: Double(source.midY) + fullShift * opening * Double(spineAxis.dy)
        )
        self.tilt = turned + fullLean * opening
        // The pill opens into an arc only as the front travels, so its sides
        // never pull back in while the radius is still small.
        self.spine = startSpine * (1 - opening)
        // Before the launch a ring of colour falls in, onto where the front will
        // start: the style's gap out from the source's outline.
        let launchRadius = startRadius + max(style.launchGap, 0)
        self.radius = sinceLaunch < 0
            ? launchRadius + style.inhale * (1 - gathered)
            : launchRadius + (crossed + Self.overshoot - launchRadius) * moved
        self.moved = moved
        self.squash = 1 + (fullSquash - 1) * Self.smooth(0, 0.5, moved)
        self.time = t
        self.energy = Self.smooth(0, 0.05, x) * settling
        self.swell = style.swell * Self.smooth(0, 0.3, moved)
        self.size = size
        self.gravity = style.pull * gathered * (1 - Self.smooth(0, Self.release, sinceLaunch))
        // From what has gathered on the source, so nothing pops at the launch.
        let gatheredGlow = min(Self.gatheredGlow * max(style.gatherGlow, 0), 1)
        self.glow = sinceLaunch < 0
            ? gatheredGlow * gathered
            : (gatheredGlow + (1 - gatheredGlow) * Self.smooth(0, 0.07, x)) * settling
        // Starts far enough back that the colour is whole all the way to the
        // source, and ends just as the softness of its edge has left the farthest
        // corner, so the whole of the easing plays out on screen.
        let clearStart = startRadius - style.rimSoftness
        let clearEnd = reach + (style.rimSoftness + style.swell) * fullSquash
        self.clearRadius = clearStart + (clearEnd - clearStart) * style.rimEasing((sinceLaunch - style.linger) / max(style.rimFade, 0.01))
        self.hairClearRadius = clearStart + (clearEnd - clearStart)
            * style.rimEasing((sinceLaunch - style.linger - style.hairlineLinger) / max(style.hairlineFade, 0.01))
        self.rim = style.rimStrength * Self.smooth(0, 0.1, x) * (1 - Self.smooth(0.9, 1, t / style.duration))
        // Falling: slowly at first, then faster and faster, as under gravity.
        let falling = min(t / max(style.anticipation, 0.001), 1)
        self.fallen = falling * falling
        self.sparkle = Self.smooth(0, max(style.anticipation, 0.001) * 0.35, t)
        self.flying = max(sinceLaunch, 0)
        self.launched = sinceLaunch > 0
        self.hasCleared = radius > crossed
        self.ring = ring
        self.sideways = sideways
        self.hold = ring ? startRadius : 0
    }

    /// The field as the shaders read it.
    var packed: [Float] {
        [
            Float(origin.x), Float(origin.y), Float(spine), Float(radius), Float(squash),
            Float(time), Float(energy), Float(swell), Float(size.width), Float(size.height),
            Float(gravity), Float(glow), Float(clearRadius), Float(rim), Float(tilt),
            ring ? 1 : 0, Float(hold), launched ? 1 : 0, Float(hairClearRadius),
        ]
    }

    static func smooth(_ a: Double, _ b: Double, _ x: Double) -> Double {
        let t = min(max((x - a) / (b - a), 0), 1)
        return t * t * (3 - 2 * t)
    }
}
