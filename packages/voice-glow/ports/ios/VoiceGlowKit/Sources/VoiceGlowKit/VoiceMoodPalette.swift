import Foundation

/// The colours the mood plane maps to: one seven-colour palette per corner.
///
/// ```
///  arousal 1   angry ──────── happy
///                │              │
///  arousal 0    sad  ──────── calm
///            valence −1     valence +1
/// ```
///
/// A mood is the bilinear blend of the four corners at its (valence,
/// arousal), mixed in OKLab so the in-betweens stay clean (red → green
/// passes through amber, not mud). The glow then moves from its own palette
/// toward that blend by the mood's confidence.
public struct VoiceMoodPalette: Equatable, Sendable {
    public struct Corners: Equatable, Sendable {
        public var happy: [VoiceGlowColor]
        public var angry: [VoiceGlowColor]
        public var sad: [VoiceGlowColor]
        public var calm: [VoiceGlowColor]

        public init(happy: [VoiceGlowColor], angry: [VoiceGlowColor], sad: [VoiceGlowColor], calm: [VoiceGlowColor]) {
            self.happy = happy
            self.angry = angry
            self.sad = sad
            self.calm = calm
        }
    }

    public var dark: Corners
    public var light: Corners

    public init(dark: Corners, light: Corners) {
        self.dark = dark
        self.light = light
    }

    /// Happy green, calm teal; every negative mood red — angry a hot red,
    /// sad a deeper crimson, so the whole negative side reads as red.
    public static let standard = VoiceMoodPalette(
        dark: Corners(
            happy: rgb([(70, 230, 120), (150, 235, 70), (40, 215, 165), (190, 240, 80), (60, 220, 100), (30, 195, 140), (120, 230, 90)]),
            angry: rgb([(255, 50, 55), (255, 85, 60), (235, 30, 80), (255, 65, 45), (240, 40, 100), (255, 100, 75), (215, 30, 50)]),
            sad: rgb([(200, 30, 60), (225, 45, 75), (180, 25, 70), (210, 40, 55), (190, 30, 90), (230, 60, 80), (170, 20, 50)]),
            calm: rgb([(60, 210, 200), (90, 200, 255), (80, 230, 170), (40, 180, 215), (120, 220, 235), (50, 200, 160), (100, 190, 240)])
        ),
        light: Corners(
            happy: rgb([(30, 175, 75), (100, 185, 25), (20, 160, 120), (140, 190, 30), (25, 165, 60), (15, 145, 100), (80, 175, 45)]),
            angry: rgb([(220, 30, 40), (230, 60, 35), (205, 20, 65), (225, 45, 30), (210, 25, 85), (230, 75, 50), (185, 20, 40)]),
            sad: rgb([(180, 25, 50), (200, 40, 60), (160, 20, 60), (190, 35, 45), (170, 25, 75), (205, 50, 65), (145, 15, 40)]),
            calm: rgb([(20, 165, 160), (40, 150, 220), (30, 175, 130), (20, 135, 175), (60, 165, 200), (25, 155, 125), (50, 145, 205)])
        )
    )

    private static func rgb(_ list: [(Double, Double, Double)]) -> [VoiceGlowColor] {
        list.map { VoiceGlowColor($0.0, $0.1, $0.2) }
    }

    /// The palette at a point of the mood plane.
    func colors(valence: Double, arousal: Double, dark: Bool) -> [OKLab] {
        let c = dark ? self.dark : self.light
        // Negative or positive, not a muddy mix: below −0.35 the colour is
        // fully the negative (red) side, above +0.35 fully the positive side,
        // with a short smooth crossover around neutral.
        let t = min(max((valence + 0.35) / 0.7, 0), 1)
        let u = t * t * (3 - 2 * t)
        let a = min(max(arousal, 0), 1)
        return (0..<VoiceGlowStyle.lobes.count).map { i in
            func at(_ list: [VoiceGlowColor]) -> OKLab { OKLab(list[i % max(1, list.count)]) }
            let top = at(c.angry).mixed(with: at(c.happy), u)
            let bottom = at(c.sad).mixed(with: at(c.calm), u)
            return bottom.mixed(with: top, a)
        }
    }
}

// MARK: - OKLab

/// Björn Ottosson's OKLab — a perceptual space where a straight mix between
/// two colours keeps its lightness and chroma.
struct OKLab: Equatable {
    var l: Double
    var a: Double
    var b: Double

    init(l: Double, a: Double, b: Double) {
        self.l = l
        self.a = a
        self.b = b
    }

    init(_ c: VoiceGlowColor) {
        func lin(_ v: Double) -> Double {
            let x = v / 255
            return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4)
        }
        let r = lin(c.r), g = lin(c.g), bl = lin(c.b)
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl)
        self.l = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
        self.a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s
        self.b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s
    }

    func mixed(with other: OKLab, _ t: Double) -> OKLab {
        OKLab(l: l + (other.l - l) * t, a: a + (other.a - a) * t, b: b + (other.b - b) * t)
    }

    var color: VoiceGlowColor {
        let l_ = l + 0.3963377774 * a + 0.2158037573 * b
        let m_ = l - 0.1055613458 * a - 0.0638541728 * b
        let s_ = l - 0.0894841775 * a - 1.2914855480 * b
        let l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_
        func srgb(_ x: Double) -> Double {
            let v = max(0, min(1, x))
            let e = v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1 / 2.4) - 0.055
            return e * 255
        }
        return VoiceGlowColor(
            srgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
            srgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
            srgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3)
        )
    }
}

// MARK: - CSS filter colour matrix

/// `hue-rotate(θ) brightness(b) saturate(s)` as one 3×3 matrix, from the W3C
/// Filter Effects spec (what browsers run — not a true HSL rotation). The
/// web glow applies the chain as a CSS filter on each layer; it is linear,
/// so applying it to each lobe colour up front draws the same picture.
enum VoiceColorMatrix {
    static func composed(hueDegrees: Double, brightness: Double, saturation: Double) -> [Double] {
        let rad = hueDegrees * .pi / 180
        let c = cos(rad), s = sin(rad)
        let hue: [Double] = [
            0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
            0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
            0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
        ].map { $0 * brightness }
        let sat: [Double] = [
            0.213 + 0.787 * saturation, 0.715 - 0.715 * saturation, 0.072 - 0.072 * saturation,
            0.213 - 0.213 * saturation, 0.715 + 0.285 * saturation, 0.072 - 0.072 * saturation,
            0.213 - 0.213 * saturation, 0.715 - 0.715 * saturation, 0.072 + 0.928 * saturation,
        ]
        var out = [Double](repeating: 0, count: 9)
        for row in 0..<3 {
            for col in 0..<3 {
                var sum = 0.0
                for k in 0..<3 { sum += sat[row * 3 + k] * hue[k * 3 + col] }
                out[row * 3 + col] = sum
            }
        }
        return out
    }

    /// Applies the matrix to a 0–255 colour and returns 0–1 components,
    /// clamped as the browser clamps after the chain.
    static func apply(_ m: [Double], _ c: VoiceGlowColor) -> SIMD3<Float> {
        let r = c.r / 255, g = c.g / 255, b = c.b / 255
        func cl(_ v: Double) -> Float { Float(max(0, min(1, v))) }
        return SIMD3(
            cl(m[0] * r + m[1] * g + m[2] * b),
            cl(m[3] * r + m[4] * g + m[5] * b),
            cl(m[6] * r + m[7] * g + m[8] * b)
        )
    }
}
