import Foundation

/// How a distortion wave looks and moves. Start from the tuned defaults of a type
/// — `DistortionWaveStyle(type: .vertical)`, or the `.vertical`, `.horizontal`
/// and `.center` presets — and change what you need.
public struct DistortionWaveStyle: Sendable {
    // Type
    /// Which way the wave travels: up from a wide source at the bottom, right
    /// from a tall one at the left, or out from the centre of a round one.
    public var type = DistortionWaveType.vertical

    // Timing
    /// Seconds everything is pulled toward the source before the wave leaves it.
    public var anticipation = 0.5
    /// Seconds from the wave leaving the source to its front having settled.
    public var travel = 2.28
    /// How far out from the source's outline the front starts, pt: 0 leaves the
    /// source itself, more starts it clear of the source, away from it.
    public var launchGap = 0.0
    /// Seconds after the wave leaves the source that the colour on the screen's
    /// edges starts to be wiped away. Below 0 it starts before, so it follows
    /// close behind the front while the wave is still moving.
    public var linger = -0.35
    /// Seconds the colour on the edges takes to be wiped away once it goes.
    public var rimFade = 3.03
    /// How the wipe moves over `rimFade`: ease-in-out, so the colour starts
    /// leaving gently and settles out gently.
    public var rimEasing = DistortionWaveEasing(0.42, 0, 0.58, 1)
    /// How much faster the wave collapses back than it opened.
    public var returnSpeed = 1.45
    /// Seconds for the whole of it, by when the swell has settled, the edges
    /// have cleared and the last dot has faded.
    public var duration: Double {
        anticipation + max(travel * 0.6, linger + rimFade, linger + hairlineLinger + hairlineFade, particleLife)
    }
    /// How the front covers its way over `travel`: it leaves the source at full
    /// speed and settles softly at the far side of the screen.
    public var easing = DistortionWaveEasing(0.22, 1, 0.36, 1)

    // Gravity
    /// How far the anticipation pulls content toward the source, pt.
    public var pull = 24.0
    /// How far out the ring of colour that falls onto the source starts, pt.
    public var inhale = 56.0
    /// How strong the colour is through the anticipation, 0–2. 1 has gathered
    /// half the front's full colour by the launch, 2 all of it; 0 leaves the
    /// anticipation without colour, and the front's colour comes in only as it
    /// leaves the source.
    public var gatherGlow = 0.33
    /// How visible the dots hopping toward the source in the anticipation are,
    /// 0–1. 0 leaves only the dots that fly out with the front.
    public var gatherDots = 1.0

    // Swell
    /// How far the swell lifts content as it passes, pt.
    public var amplitude = 34.0
    /// Width of the swell, pt.
    public var lensWidth = 150.0
    /// How far red and blue part either way, as a share of how far the content
    /// has moved: where nothing is distorted, the colours stay together.
    public var aberration = 0.78
    /// How far the front bends along its length, pt.
    public var swell = 22.0

    // Progressive blur
    /// Blur radius on the front, pt.
    public var blur = 18.0
    /// Distance ahead of the front over which the blur gathers, pt.
    public var blurAhead = 90.0
    /// Distance behind the front over which the blur clears, pt.
    public var blurBehind = 240.0

    // Colour on the front
    /// Distance the colour feathers out ahead of the front, pt.
    public var lead = 130.0
    /// Length of the colour trailing behind the front, pt.
    public var tail = 300.0
    /// Peak opacity of the colour, 0–1.
    public var strength = 0.92

    // Colour on the edges
    /// How far in from the edges the colour reaches, pt.
    public var rimWidth = 14.0
    /// How unequal the colour's thickness is along the edges, 0–2: 0 is even all
    /// the way round, 1 drifting lumps almost three times as thick as the average
    /// with stretches a tenth as thick between, as in BorderBeamKit; past 1 the
    /// lumps grow further and the thinnest stretches break off.
    public var rimUnevenness = 1.0
    /// Peak opacity of the colour, 0–1.
    public var rimStrength = 0.82
    /// How softly the colour is wiped away, pt.
    public var rimSoftness = 343.0
    /// The corner radius of the view the wave fills — the screen's, or a
    /// sheet's — which the colour on the edges and its hairline follow, pt.
    public var cornerRadius = 62.0
    /// How alive the colour on the edges is, 0–1, as BorderBeamKit's pulse: its
    /// lumps drift and breathe, a soft brightness runs round the edge, and its
    /// colours flow. 0 keeps only a slow drift.
    public var rimPulse = 0.6
    /// Width of a hairline right on the screen's edge, over the colour, as
    /// BorderBeamKit's stroke ring, pt. 0 draws none.
    public var hairlineWidth = 1.5
    /// Peak opacity of the hairline, 0–1.
    public var hairlineOpacity = 0.9
    /// How far the hairline whitens where the pulse's light runs, 0–1.
    public var hairlineWhite = 0.95
    /// Seconds the hairline holds on after the colour on the edges starts to be
    /// wiped away.
    public var hairlineLinger = 0.47
    /// Seconds the hairline takes to be wiped away once it goes: longer than
    /// `rimFade`, so it fades out slower than the colour, on the same easing.
    public var hairlineFade = 3.0

    // Touch
    /// How much the wave leans with where the source was touched, 0–1: 0 opens
    /// evenly from the whole source, 1 opens from under the finger and leans its
    /// way, so a touch on the right climbs the right side first. The center
    /// type never leans.
    public var orientation = 0.91

    // Particles
    /// How many dots fall into the source and fly out of it with the wave.
    public var particleCount = 64
    /// Diameter of the largest dot, pt.
    public var particleSize = 1.8
    /// How far above the source the farthest dot is born in the anticipation, pt.
    public var particleReach = 150.0
    /// How far each dot flies toward the source in one hop, pt.
    public var particleFlight = 30.0
    /// How close to the source a dot comes before it has faded, at the nearest, pt.
    public var particleGap = 24.0
    /// Seconds after the launch by which the last dot has faded out.
    public var particleLife = 2.19
    /// How far the dots are thrown, as a share of the front's way, 0–1: at 1 the
    /// quickest ride the front off the screen; less keeps them nearer the source,
    /// in view for longer.
    public var particleSpread = 1.0

    // Colour
    /// The colours flowing along the front and round the edges, and the fringes
    /// either side of the front.
    public var palette = DistortionWavePalette.colorful

    /// The tuned defaults for `type`.
    ///
    /// - `.vertical` and `.horizontal`: a full screen, opened from a button, in
    ///   the colourful palette.
    /// - `.center`: a sheet or card about 500pt tall, opened from an avatar or
    ///   icon at its top, in greens: a slower ring, only the pull before it
    ///   leaves, softer colour, no chromatic aberration (which would part white
    ///   into red and blue), and dots that stay in view.
    public init(type: DistortionWaveType = .vertical) {
        self.type = type
        guard type == .center else { return }
        anticipation = 0.25
        travel = 3.43
        rimFade = 2.51
        hairlineLinger = 0.96
        strength = 0.6
        rimStrength = 0.6
        aberration = 0
        gatherGlow = 0
        gatherDots = 0
        particleCount = 89
        particleLife = 3.93
        particleSpread = 0.64
        palette = .green
        cornerRadius = 48
        // A sheet is about 0.6 the height of a screen: its lengths are too.
        pull = 14.4
        inhale = 33.6
        amplitude = 20.4
        lensWidth = 90
        swell = 13.2
        blur = 10.8
        blurAhead = 54
        blurBehind = 144
        lead = 78
        tail = 180
        rimSoftness = 205.8
        particleReach = 90
        particleFlight = 18
        particleGap = 11
    }

    /// Up the screen from a button at the bottom.
    public static let vertical = DistortionWaveStyle(type: .vertical)
    /// Across the screen from a tall source at the left.
    public static let horizontal = DistortionWaveStyle(type: .horizontal)
    /// Out from an avatar or icon, round a sheet or card.
    public static let center = DistortionWaveStyle(type: .center)

    /// OKLab triplets for the band shader: the colours, then the two fringes.
    var bandPalette: [Float] {
        (palette.colors + [palette.ahead, palette.behind]).flatMap(\.oklab)
    }
}

/// Which way a distortion wave travels.
public enum DistortionWaveType: String, CaseIterable, Sendable {
    /// Bottom to top: from a wide source's own outline — a button — into an arc
    /// bowed so it crosses a tall screen as a curve rather than a flat line. It
    /// leans with the touch.
    case vertical
    /// Left to right: the vertical wave on its side, from a tall source at the
    /// left — an edge, a tab, a side button. It leans with the touch too.
    case horizontal
    /// A circle spreading evenly from the source's centre, as from an avatar.
    /// The source itself is left alone — no pull, swell, blur or colour on it —
    /// so it can morph in plain view at the wave's centre.
    case center
}

/// The colours of a wave: several flowing along the front and round the edges,
/// a fringe riding ahead of the front and one trailing behind it.
public struct DistortionWavePalette: Equatable, Sendable {
    public var colors: [DistortionWaveColor]
    /// The fringe riding ahead of the front.
    public var ahead: DistortionWaveColor
    /// The fringe trailing behind the front.
    public var behind: DistortionWaveColor

    public init(colors: [DistortionWaveColor], ahead: DistortionWaveColor, behind: DistortionWaveColor) {
        self.colors = colors.isEmpty ? [ahead] : colors
        self.ahead = ahead
        self.behind = behind
    }

    /// VoiceGlow's colourful palette, with a pink fringe ahead and a blue one behind.
    public static let colorful = DistortionWavePalette(
        colors: [
            DistortionWaveColor(255, 201, 21), DistortionWaveColor(126, 196, 255),
            DistortionWaveColor(180, 40, 230), DistortionWaveColor(235, 100, 160),
            DistortionWaveColor(255, 176, 122), DistortionWaveColor(154, 160, 255),
            DistortionWaveColor(127, 217, 238),
        ],
        ahead: DistortionWaveColor(255, 122, 182),
        behind: DistortionWaveColor(90, 190, 255)
    )

    /// Greens only, from a success badge's #35BA00 out to lime and mint.
    public static let green = DistortionWavePalette(
        colors: [
            DistortionWaveColor(53, 186, 0), DistortionWaveColor(140, 235, 90),
            DistortionWaveColor(0, 196, 110), DistortionWaveColor(190, 250, 130),
            DistortionWaveColor(40, 160, 60), DistortionWaveColor(110, 225, 160),
            DistortionWaveColor(90, 210, 40),
        ],
        ahead: DistortionWaveColor(196, 255, 120),
        behind: DistortionWaveColor(0, 150, 70)
    )

    /// Blues and teals.
    public static let ocean = DistortionWavePalette(
        colors: [
            DistortionWaveColor(40, 120, 255), DistortionWaveColor(90, 200, 255),
            DistortionWaveColor(20, 80, 200), DistortionWaveColor(120, 230, 240),
            DistortionWaveColor(60, 150, 255), DistortionWaveColor(150, 180, 255),
            DistortionWaveColor(0, 180, 220),
        ],
        ahead: DistortionWaveColor(150, 230, 255),
        behind: DistortionWaveColor(30, 70, 220)
    )

    /// Oranges, pinks and magentas.
    public static let sunset = DistortionWavePalette(
        colors: [
            DistortionWaveColor(255, 140, 60), DistortionWaveColor(255, 90, 120),
            DistortionWaveColor(255, 200, 80), DistortionWaveColor(240, 70, 90),
            DistortionWaveColor(255, 170, 120), DistortionWaveColor(220, 90, 200),
            DistortionWaveColor(255, 120, 80),
        ],
        ahead: DistortionWaveColor(255, 220, 120),
        behind: DistortionWaveColor(200, 60, 160)
    )

    /// Whites and silvers.
    public static let mono = DistortionWavePalette(
        colors: [
            DistortionWaveColor(240, 240, 245), DistortionWaveColor(200, 205, 215),
            DistortionWaveColor(255, 255, 255), DistortionWaveColor(170, 175, 190),
            DistortionWaveColor(225, 228, 235), DistortionWaveColor(190, 195, 205),
            DistortionWaveColor(245, 245, 250),
        ],
        ahead: DistortionWaveColor(255, 255, 255),
        behind: DistortionWaveColor(160, 165, 180)
    )

    /// A single colour, lighter ahead of the front and deeper behind it.
    public static func single(_ color: DistortionWaveColor) -> DistortionWavePalette {
        DistortionWavePalette(
            colors: [color, color.mixed(with: .white, 0.25), color, color.mixed(with: .black, 0.15)],
            ahead: color.mixed(with: .white, 0.45),
            behind: color.mixed(with: .black, 0.3)
        )
    }
}

/// A timing curve, with the same control points as CSS `cubic-bezier()`.
public struct DistortionWaveEasing: Equatable, Sendable {
    public var x1: Double
    public var y1: Double
    public var x2: Double
    public var y2: Double

    public init(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) {
        self.x1 = x1
        self.y1 = y1
        self.x2 = x2
        self.y2 = y2
    }

    /// The eased value after `x` of the time, both 0–1.
    func callAsFunction(_ x: Double) -> Double {
        guard x > 0 else { return 0 }
        guard x < 1 else { return 1 }
        // x grows with the curve's parameter, so halving always finds it.
        var low = 0.0
        var high = 1.0
        for _ in 0..<24 {
            let s = (low + high) / 2
            if Self.bezier(s, x1, x2) < x { low = s } else { high = s }
        }
        return Self.bezier((low + high) / 2, y1, y2)
    }

    private static func bezier(_ s: Double, _ a: Double, _ b: Double) -> Double {
        let r = 1 - s
        return 3 * r * r * s * a + 3 * r * s * s * b + s * s * s
    }
}

/// An sRGB colour, 0–255 per channel.
public struct DistortionWaveColor: Equatable, Sendable {
    public var r: Double
    public var g: Double
    public var b: Double

    public init(_ r: Double, _ g: Double, _ b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }

    /// From a hex value: `DistortionWaveColor(hex: 0x35BA00)`.
    public init(hex: UInt32) {
        self.init(Double((hex >> 16) & 0xFF), Double((hex >> 8) & 0xFF), Double(hex & 0xFF))
    }

    static let white = DistortionWaveColor(255, 255, 255)
    static let black = DistortionWaveColor(0, 0, 0)

    func mixed(with other: DistortionWaveColor, _ amount: Double) -> DistortionWaveColor {
        DistortionWaveColor(r + (other.r - r) * amount, g + (other.g - g) * amount, b + (other.b - b) * amount)
    }

    var oklab: [Float] {
        func linear(_ v: Double) -> Double {
            let c = v / 255
            return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
        }
        let (lr, lg, lb) = (linear(r), linear(g), linear(b))
        let l = cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
        let m = cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
        let s = cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
        return [
            Float(0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s),
            Float(1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s),
            Float(0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s),
        ]
    }
}
