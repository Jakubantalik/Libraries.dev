// Mood: how the voice feels, and the colour that shows it — the same model
// as VoiceGlowKit's `VoiceMood`. Any source can produce one: the on-device
// estimators in VoiceRingEmotion (tone + words, as in VoiceGlow Pro), a
// server, or a picker in a demo. The ring maps it onto the three emotion
// colours the web build uses — positive green, negative red, calm blue —
// blended over the mood plane in OKLab, and show it by its confidence.

import Foundation

/// RGB, 0–255 per channel.
public struct RGB: Sendable, Equatable {
    public var r: Double
    public var g: Double
    public var b: Double

    public init(_ r: Double, _ g: Double, _ b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }
}

/// How the voice feels, on the two axes emotion research uses.
///
/// - `valence`: −1 (negative: angry, sad) … +1 (positive: happy, calm).
/// - `arousal`: 0 (calm, low energy) … 1 (excited).
/// - `confidence`: 0 … 1 — how sure the source is; the colour shows in
///   proportion, so an unsure estimate stays quiet.
public struct VoiceMood: Equatable, Sendable {
    public var valence: Double
    public var arousal: Double
    public var confidence: Double

    public init(valence: Double, arousal: Double, confidence: Double = 1) {
        self.valence = min(max(valence, -1), 1)
        self.arousal = min(max(arousal, 0), 1)
        self.confidence = min(max(confidence, 0), 1)
    }

    /// No opinion: the orb stays neutral.
    public static let neutral = VoiceMood(valence: 0, arousal: 0.3, confidence: 0)
    public static let happy = VoiceMood(valence: 0.8, arousal: 0.75)
    public static let angry = VoiceMood(valence: -0.75, arousal: 0.85)
    public static let sad = VoiceMood(valence: -0.7, arousal: 0.15)
    public static let calm = VoiceMood(valence: 0.6, arousal: 0.15)

    /// Two reads of one voice, merged: how it sounds (`tone`) and what it
    /// says (`meaning`). The words carry most of the valence, the tone most
    /// of the arousal, each in proportion to its confidence — VoiceGlow's
    /// blend, unchanged.
    public static func blend(tone: VoiceMood?, meaning: VoiceMood?, meaningWeight: Double = 0.65) -> VoiceMood {
        let t = tone ?? .neutral, m = meaning ?? .neutral
        let w = min(max(meaningWeight, 0), 1)
        let tv = t.confidence * (1 - w), mv = m.confidence * w
        let ta = t.confidence * w, ma = m.confidence * (1 - w)
        guard t.confidence + m.confidence > 0.001 else {
            return VoiceMood(valence: m.valence, arousal: t.arousal, confidence: 0)
        }
        let valence = tv + mv > 0 ? (t.valence * tv + m.valence * mv) / (tv + mv) : 0
        let arousal = ta + ma > 0 ? (t.arousal * ta + m.arousal * ma) / (ta + ma) : 0.3
        let confidence = 1 - (1 - t.confidence) * (1 - m.confidence)
        return VoiceMood(valence: valence, arousal: arousal, confidence: confidence)
    }

    /// The mood's colour: the four corners of the plane — happy green,
    /// angry red, sad red, calm blue — mixed in OKLab. Below −0.35 valence
    /// it is fully the negative side, above +0.35 fully the positive, with a
    /// short smooth crossover, as VoiceMoodPalette does.
    public var color: RGB {
        let t = min(max((valence + 0.35) / 0.7, 0), 1)
        let u = t * t * (3 - 2 * t)
        let top = OKLab(VoiceOrbEmotion.negative.color).mixed(with: OKLab(VoiceOrbEmotion.positive.color), u)
        let bottom = OKLab(RGB(230, 92, 112)).mixed(with: OKLab(VoiceOrbEmotion.calm.color), u)
        return bottom.mixed(with: top, arousal).rgb
    }
}

/// The three emotions the web orbs know, as presets on the mood plane.
public enum VoiceOrbEmotion: String, CaseIterable, Sendable {
    case positive, negative, calm

    /// The same colours as the web build's `EMOTION_COLORS`.
    public var color: RGB {
        switch self {
        case .positive: return RGB(92, 224, 150)
        case .negative: return RGB(255, 104, 104)
        case .calm: return RGB(104, 162, 255)
        }
    }

    public var mood: VoiceMood {
        switch self {
        case .positive: return .happy
        case .negative: return .angry
        case .calm: return .calm
        }
    }
}

/// A fixed colour for colourful mode, shown without any emotion.
public enum VoiceAccent: String, CaseIterable, Sendable {
    case green, red, blue

    public var color: RGB {
        switch self {
        case .green: return VoiceOrbEmotion.positive.color
        case .red: return VoiceOrbEmotion.negative.color
        case .blue: return VoiceOrbEmotion.calm.color
        }
    }
}

/// One orb's eased emotion colour: how present it is, and which colour it
/// has reached. Eases in, crossfades between moods, fades out — port of
/// the web `GlowFollower`.
public final class GlowFollower {
    public private(set) var color = RGB(0, 0, 0)
    public private(set) var amount: Double = 0

    public init() {}

    public func step(dt: Double, target: RGB?, strength: Double, still: Bool) {
        func ease(_ tau: Double) -> Double { still ? 1 : 1 - exp(-dt / tau) }
        let goal = target == nil ? 0 : min(max(strength, 0), 1)
        amount += (goal - amount) * ease(goal > amount ? 0.7 : 1.1)
        if let target {
            let k = amount < 0.03 ? 1 : ease(0.6)
            color = RGB(color.r + (target.r - color.r) * k, color.g + (target.g - color.g) * k, color.b + (target.b - color.b) * k)
        }
    }
}

// MARK: - OKLab

/// Björn Ottosson's OKLab: a straight mix keeps lightness and chroma.
struct OKLab {
    var l: Double, a: Double, b: Double

    init(l: Double, a: Double, b: Double) {
        self.l = l
        self.a = a
        self.b = b
    }

    init(_ c: RGB) {
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

    func mixed(with o: OKLab, _ t: Double) -> OKLab {
        OKLab(l: l + (o.l - l) * t, a: a + (o.a - a) * t, b: b + (o.b - b) * t)
    }

    var rgb: RGB {
        let l_ = l + 0.3963377774 * a + 0.2158037573 * b
        let m_ = l - 0.1055613458 * a - 0.0638541728 * b
        let s_ = l - 0.0894841775 * a - 1.2914855480 * b
        let l3 = l_ * l_ * l_, m3 = m_ * m_ * m_, s3 = s_ * s_ * s_
        func srgb(_ x: Double) -> Double {
            let v = max(0, min(1, x))
            return (v <= 0.0031308 ? 12.92 * v : 1.055 * pow(v, 1 / 2.4) - 0.055) * 255
        }
        return RGB(
            srgb(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
            srgb(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
            srgb(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3)
        )
    }
}
