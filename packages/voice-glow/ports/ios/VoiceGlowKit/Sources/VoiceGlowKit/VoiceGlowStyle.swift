import Foundation

/// An sRGB colour, 0–255 per channel — the unit the web palettes are written in.
public struct VoiceGlowColor: Equatable, Sendable {
    public var r: Double
    public var g: Double
    public var b: Double

    public init(_ r: Double, _ g: Double, _ b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }

    /// `#rgb` or `#rrggbb`; nil when unparseable.
    public init?(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespaces)
        if h.hasPrefix("#") { h.removeFirst() }
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard h.count == 6, let v = UInt32(h, radix: 16) else { return nil }
        self.init(Double((v >> 16) & 0xFF), Double((v >> 8) & 0xFF), Double(v & 0xFF))
    }
}

/// The seven lobes, in pt for a ~350 pt reference host — a port of
/// `voiceLobes` in the web `styles.ts`. The centre lobe follows the low
/// band, its neighbours the mids, the outer pair the highs and the far pair
/// the mids again, so a voice makes the colours ripple outward.
struct VoiceLobe {
    let x: Double
    let w: Double
    let h: Double
    let band: Int
}

enum VoiceGlowStyle {
    static let lobes: [VoiceLobe] = [
        VoiceLobe(x: 0, w: 74, h: 46, band: 0),
        VoiceLobe(x: -36, w: 54, h: 40, band: 1),
        VoiceLobe(x: 36, w: 54, h: 40, band: 1),
        VoiceLobe(x: -72, w: 48, h: 32, band: 2),
        VoiceLobe(x: 72, w: 48, h: 32, band: 2),
        VoiceLobe(x: -108, w: 42, h: 26, band: 1),
        VoiceLobe(x: 108, w: 42, h: 26, band: 1),
    ]

    /// Resting distance between neighbouring lobes, pt.
    static let lobeSpacing = 36.0
    /// Width of the ring the lobes travel around — one full turn of the flow.
    static var lobeSpan: Double { lobeSpacing * Double(lobes.count) }

    /// Ceiling geometry the glow is masked to (pt at multiplier 1).
    static let ceilingHalfWidth = 170.0
    static let ceilingHeight = 64.0

    static let borderWidth = 1.0

    /// False under plain `swift test`, which does not compile the .metal file.
    static var shadersCompiled: Bool {
        Bundle.module.url(forResource: "default", withExtension: "metallib") != nil
    }

    // MARK: Theme presets (web `themePresets`)

    struct ThemePreset {
        let strokeOpacity: Double
        let innerOpacity: Double
        let bloomOpacity: Double
        /// Inner inset shadow, rgba.
        let innerShadow: (VoiceGlowColor, Double)
        let saturation: Double
        let brightness: Double
        let hueRange: Double
        let hueDuration: Double
        let hueBase: Double
        let strength: Double
    }

    static func themePreset(_ dark: Bool) -> ThemePreset {
        dark
            ? ThemePreset(
                strokeOpacity: 1.16, innerOpacity: 0.47, bloomOpacity: 0.89,
                innerShadow: (VoiceGlowColor(255, 255, 255), 0.1),
                saturation: 1.2, brightness: 1.1,
                hueRange: 24, hueDuration: 12, hueBase: 0, strength: 1
            )
            : ThemePreset(
                strokeOpacity: 1.2, innerOpacity: 0.85, bloomOpacity: 0.5,
                innerShadow: (VoiceGlowColor(0, 0, 0), 0.08),
                saturation: 1.6, brightness: 0.95,
                hueRange: 40, hueDuration: 8.5, hueBase: 5, strength: 0.8
            )
    }

    /// Band colours: the white core and its chromatic fringes.
    struct BandColors {
        let core: VoiceGlowColor
        let above: VoiceGlowColor
        let mid: VoiceGlowColor
        let below: VoiceGlowColor
    }

    static func bandColors(_ dark: Bool) -> BandColors {
        dark
            ? BandColors(core: .init(255, 255, 255), above: .init(255, 70, 80), mid: .init(90, 255, 150), below: .init(80, 140, 255))
            : BandColors(core: .init(197, 139, 255), above: .init(255, 122, 182), mid: .init(126, 196, 255), below: .init(45, 255, 171))
    }

    // MARK: Palettes (web `voicePalettes`)

    static func palette(_ variant: VoiceGlowColorVariant, dark: Bool) -> [VoiceGlowColor] {
        let p = palettes[variant]!
        return (dark ? p.dark : p.light).map { VoiceGlowColor($0.0, $0.1, $0.2) }
    }

    private typealias RGB = (Double, Double, Double)

    private static let palettes: [VoiceGlowColorVariant: (dark: [RGB], light: [RGB])] = [
        .colorful: (
            [(255, 70, 120), (60, 190, 255), (175, 70, 255), (60, 220, 130), (255, 150, 40), (90, 100, 255), (40, 200, 190)],
            [(255, 201, 21), (126, 196, 255), (180, 40, 230), (235, 100, 160), (255, 176, 122), (154, 160, 255), (127, 217, 238)]
        ),
        .mono: (
            [(215, 215, 215), (180, 180, 180), (190, 190, 190), (160, 160, 160), (170, 170, 170), (150, 150, 150), (155, 155, 155)],
            [(60, 60, 60), (90, 90, 90), (85, 85, 85), (110, 110, 110), (105, 105, 105), (125, 125, 125), (120, 120, 120)]
        ),
        .ocean: (
            [(80, 140, 255), (40, 200, 230), (120, 90, 255), (30, 170, 210), (160, 80, 240), (60, 110, 255), (40, 190, 180)],
            [(40, 100, 240), (20, 160, 200), (90, 60, 230), (20, 130, 180), (130, 50, 220), (40, 80, 230), (20, 150, 150)]
        ),
        .sunset: (
            [(255, 110, 60), (255, 180, 40), (255, 60, 90), (255, 210, 80), (240, 70, 140), (255, 140, 50), (230, 50, 110)],
            [(235, 80, 30), (230, 150, 10), (230, 30, 70), (225, 175, 30), (215, 40, 110), (235, 110, 20), (205, 30, 90)]
        ),
        .forest: (
            [(70, 220, 120), (40, 200, 180), (140, 230, 80), (30, 170, 140), (190, 235, 70), (50, 190, 110), (30, 150, 120)],
            [(30, 170, 80), (20, 150, 130), (90, 180, 30), (20, 130, 100), (130, 180, 20), (30, 150, 80), (20, 120, 90)]
        ),
        .candy: (
            [(255, 90, 170), (255, 120, 220), (210, 80, 255), (255, 150, 190), (180, 110, 255), (255, 70, 140), (230, 100, 240)],
            [(235, 40, 140), (230, 70, 190), (180, 40, 230), (235, 100, 160), (150, 70, 230), (230, 30, 110), (200, 60, 210)]
        ),
        .ice: (
            [(150, 230, 255), (90, 200, 255), (190, 240, 255), (120, 190, 255), (160, 220, 250), (80, 170, 255), (200, 235, 255)],
            [(30, 160, 220), (20, 130, 210), (60, 180, 230), (40, 120, 220), (50, 160, 220), (20, 110, 220), (70, 170, 230)]
        ),
        .gold: (
            [(255, 200, 70), (255, 170, 40), (255, 220, 110), (240, 150, 30), (255, 235, 140), (230, 160, 40), (250, 210, 90)],
            [(200, 140, 10), (190, 120, 0), (210, 160, 30), (180, 110, 0), (205, 170, 40), (175, 115, 5), (195, 150, 20)]
        ),
    ]
}

// MARK: - Geometry presets (web `presets.ts`)

/// The geometry and response knobs a `type` preset retunes.
struct VoiceGeometry {
    var scale = 1.0
    var glowSize = 1.0
    var strokeOpacity = 1.0
    var innerOpacity = 1.0
    var bloomOpacity = 1.0
    var idle = 0.18
    var reach = 1.2
    var spread = 1.05
    var flow = 48.0
    var bend = 60.0
    var bandStrength = 1.55
    var bandWidth = 2.15
    var bandPosition = 0.35
    var bandCurve = 1.75
    var bandSpread = 0.87
    var bandSkew = 0.12
    var bandOffset = -27.0
    var bandTail = 0.59
    var bandTailPosition = 0.67
    var bandTailCurve = 2.4
    var bandTailOverflow = 15.0
    var bandAberration = 0.89
    var glowWidth = 0.65
    var glowHeight = 1.25
    var lobeSpacing = 0.85
    var rangeWidth = 0.75
    var rangeHeight = 1.0
    var softness = 1.07
    var coreSize = 1.0
    var coreLight = 0.0
    var coreLightWidth = 1.0
    var coreLightHeight = 1.0
    var strokeScale = 1.0
    var innerScale = 1.0
    var innerHeight = 1.0
    var bloomScale = 1.0
    var bloomHeight = 1.0

    // Colour tuning a type carries on top of the theme preset.
    var brightness: Double? = nil
    var saturation: Double? = nil
    var strength: Double? = nil

    /// The full geometry for a type on a theme: defaults, the theme's own
    /// tweaks where the type leaves them alone, the type, then the type's
    /// light-theme overrides — the order `resolveVoiceDefaults` applies.
    static func resolve(_ type: VoiceGlowType, dark: Bool) -> VoiceGeometry {
        var g = VoiceGeometry()
        switch type {
        case .standard:
            if !dark {
                g.reach = 1.8
                g.spread = 0.8
                g.coreLight = 1.8
                g.bandStrength = 1.7
            } else {
                g.brightness = 1.15
            }
        case .pill:
            if !dark { g.coreLight = 1.8 }
            g.scale = 0.45
            g.glowSize = 0.95
            g.strokeOpacity = 1.2
            g.innerOpacity = 0.85
            g.reach = 1.35
            g.spread = 1.1
            g.flow = 0
            g.bend = 23
            g.bandStrength = dark ? 1.55 : 2
            g.bandWidth = 1.85
            g.bandCurve = 1.95
            g.bandSpread = 0.38
            g.bandOffset = -16
            g.bandTail = 0
            g.glowWidth = 0.65
            g.glowHeight = 0.95
            g.lobeSpacing = 0.45
            g.rangeWidth = 0.8
            g.rangeHeight = 0.7
            g.softness = 0.88
            g.coreSize = 0.25
            g.strokeScale = 1.25
            g.innerScale = 0.95
            g.bloomScale = 1.05
            g.bloomHeight = 2.25
            if dark {
                g.brightness = 1.35
                g.saturation = 1.5
            }
        case .mobile:
            if !dark { g.coreLight = 1.8 }
            g.scale = 1.25
            g.spread = 0.45
            g.reach = 3
            g.flow = 60
            g.bend = 70
            g.bandWidth = 2.4
            g.bandCurve = 1.55
            g.bandSpread = 0.9
            g.bandOffset = -50
            g.bandTail = 0.62
            g.bandTailPosition = 0.42
            g.bandTailCurve = 2.7
            g.bandTailOverflow = 22
            g.bandStrength = dark ? 1.8 : 1.7
            g.glowWidth = 1.15
            g.glowHeight = 2.1
            g.lobeSpacing = 1.35
            g.rangeWidth = 1.25
            g.rangeHeight = 1.2
            g.softness = 1.1
            g.strength = 1
            if dark {
                g.brightness = 1.2
                g.saturation = 1.5
            }
        }
        return g
    }
}
