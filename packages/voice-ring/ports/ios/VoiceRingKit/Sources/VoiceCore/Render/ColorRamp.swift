// Colourful mode for the ink types — port of src/engine/colors.ts: a
// two-colour gradient across the orb, the neutral ink on one side and one
// colour (the emotion's, or a fixed accent) on the other, sampled into
// steps so strokes still batch by colour.

import Foundation

public struct OrbColors: Sendable {
    /// 0 = monochrome, 1 = full colour on the gradient's far side.
    public var saturation: Double
    public var accent: RGB
    /// Degrees — 0 left → right, 90 top → bottom.
    public var angle: Double
    /// 1 starts in the neutral ink; 0 is colour end to end.
    public var neutral: Double
    public var size: Double
    /// 0–1: the accent purer and deeper than itself — saturation past 1.
    public var vivid: Double
    /// Multiplier on the accent's lightness.
    public var brightness: Double
    /// Degrees to turn the accent's hue.
    public var hue: Double
    /// Where along the gradient (0–1) the colour begins to come in.
    public var start: Double
    /// How far along the gradient (0–1) it takes to arrive in full.
    public var width: Double

    public init(saturation: Double, accent: RGB, angle: Double, neutral: Double, size: Double,
                vivid: Double = 0, brightness: Double = 1, hue: Double = 0, start: Double = 0.1, width: Double = 0.6) {
        self.saturation = saturation
        self.accent = accent
        self.angle = angle
        self.neutral = neutral
        self.size = size
        self.vivid = vivid
        self.brightness = brightness
        self.hue = hue
        self.start = start
        self.width = width
    }
}

/// The accent, turned and shaded: its hue turned by `hue` degrees, its
/// lightness scaled by `brightness`, and `vivid` (0–1) taking it purer —
/// more saturated, its lightness drawn toward the full-colour middle.
func adjustAccent(_ c: RGB, hue: Double = 0, vivid: Double = 0, brightness: Double = 1) -> RGB {
    let r = c.r / 255, g = c.g / 255, b = c.b / 255
    let mx = max(r, g, b), mn = min(r, g, b)
    var l = (mx + mn) / 2
    var s = mx == mn ? 0 : (mx - mn) / (1 - abs(2 * l - 1))
    var h = 0.0
    if mx != mn {
        let d = mx - mn
        h = mx == r ? ((g - b) / d).truncatingRemainder(dividingBy: 6) : mx == g ? (b - r) / d + 2 : (r - g) / d + 4
        h *= 60
    }
    h = ((h + hue).truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
    s = min(1, s * (1 + vivid))
    l = 0.5 + (l - 0.5) * (1 - 0.6 * vivid)
    l = max(0, min(1, l * brightness))
    // back to RGB
    let a = s * min(l, 1 - l)
    func f(_ n: Double) -> Double {
        let k = (n + h / 30).truncatingRemainder(dividingBy: 12)
        return l - a * max(-1, min(k - 3, 9 - k, 1))
    }
    return RGB((f(0) * 255).rounded(), (f(8) * 255).rounded(), (f(4) * 255).rounded())
}

struct ColorRamp {
    static let steps = 32
    let rgb: RGB
    let mix: [Double]
    let ca: Double, sa: Double, half: Double, span: Double

    init(_ c: OrbColors) {
        let sat = clamp01(c.saturation)
        let neutral = clamp01(c.neutral)
        let start = c.start, width = max(0.05, c.width)
        mix = (0..<Self.steps).map { i in
            let t = Double(i) / Double(Self.steps - 1)
            let u = clamp01((t - start) / width)
            let rise = u * u * (3 - 2 * u)
            return sat * (1 - neutral * (1 - rise))
        }
        rgb = adjustAccent(c.accent, hue: c.hue, vivid: clamp01(c.vivid), brightness: c.brightness)
        let rad = c.angle * .pi / 180
        ca = cos(rad)
        sa = sin(rad)
        half = c.size / 2
        span = c.size * 0.8
    }

    func at(_ x: Double, _ y: Double) -> Int {
        let t = ((x - half) * ca + (y - half) * sa) / span + 0.5
        return max(0, min(Self.steps - 1, Int((t * Double(Self.steps - 1)).rounded())))
    }
}
