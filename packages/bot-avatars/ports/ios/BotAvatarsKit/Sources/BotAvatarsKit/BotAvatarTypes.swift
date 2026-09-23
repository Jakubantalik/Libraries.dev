import Foundation

/// The eighteen body shapes, in the web library's order.
public enum BotAvatarType: String, CaseIterable, Identifiable, Sendable {
    case clover, flower, triangle, square, blob, ghost, circle, drop, star, droid, mech, alien, hexagon, cat, cloud, pill, pebble, puddle
    public var id: String { rawValue }
}

/// What the face is made of: the eyes alone, or eyes and a small mouth
/// that changes with the state.
public enum BotAvatarFace: String, CaseIterable, Identifiable, Sendable {
    case eyes, mouth
    public var id: String { rawValue }
}

/// What the bot is doing. Each state is a pose plus its own motion.
public enum BotAvatarState: String, CaseIterable, Identifiable, Sendable {
    case `default`, working, sleeping
    public var id: String { rawValue }
    /// The web's `stateLabels`.
    public var label: String {
        switch self {
        case .default: return "idle"
        case .working: return "working"
        case .sleeping: return "sleeping"
        }
    }
}

/// How the body is lit. `plastic` (default): a glossy material shaded per
/// pixel; `crisp`: a lit rim with a clean edge; `smooth`: a soft shadow and
/// highlight over the whole form; `flat`: the depth alone.
public enum BotAvatarShading: String, CaseIterable, Identifiable, Sendable {
    case plastic, crisp, smooth, flat
    public var id: String { rawValue }
}

/// How the landing squash of a jump plays out.
public enum BotAvatarSquashEase: String, CaseIterable, Identifiable, Sendable {
    case sharp, pulse, soft, bouncy
    public var id: String { rawValue }
}

public struct BotAvatarPreset: Sendable {
    /// Display name, for labels.
    public let label: String
    /// The type's own body colour.
    public let color: BotColor
    /// The face the type ships with.
    public let face: BotAvatarFace
    /// Where the face sits, in the 100×100 body box.
    public let faceX: Double
    public let faceY: Double
    /// Face scale: shapes with a small middle wear a smaller face.
    public let faceScale: Double
}

/// The eighteen types: each body has its own colour and says where on it
/// the face sits. Every type wears the eyes alone by default.
public let botAvatarPresets: [BotAvatarType: BotAvatarPreset] = [
    .clover: .init(label: "Clover", color: BotColor("#35B8FF")!, face: .eyes, faceX: 50, faceY: 50, faceScale: 1),
    .flower: .init(label: "Flower", color: BotColor("#FF7AB8")!, face: .eyes, faceX: 50, faceY: 51, faceScale: 0.95),
    .triangle: .init(label: "Triangle", color: BotColor("#DC48FF")!, face: .eyes, faceX: 50, faceY: 61, faceScale: 0.9),
    .square: .init(label: "Square", color: BotColor("#35B8FF")!, face: .eyes, faceX: 50, faceY: 50, faceScale: 1),
    .blob: .init(label: "Blob", color: BotColor("#2FCB7A")!, face: .eyes, faceX: 49.5, faceY: 50, faceScale: 1),
    .ghost: .init(label: "Ghost", color: BotColor("#F4F2FA")!, face: .eyes, faceX: 50, faceY: 48, faceScale: 0.95),
    .circle: .init(label: "Circle", color: BotColor("#9A62FF")!, face: .eyes, faceX: 50, faceY: 50, faceScale: 1),
    .drop: .init(label: "Drop", color: BotColor("#1ED3C6")!, face: .eyes, faceX: 50, faceY: 62, faceScale: 0.9),
    .star: .init(label: "Star", color: BotColor("#FFD32B")!, face: .eyes, faceX: 50, faceY: 52, faceScale: 0.82),
    .droid: .init(label: "Droid", color: BotColor("#D5DBEA")!, face: .eyes, faceX: 50, faceY: 60, faceScale: 0.95),
    .mech: .init(label: "Mech", color: BotColor("#95A6C4")!, face: .eyes, faceX: 50, faceY: 59, faceScale: 1),
    .alien: .init(label: "Alien", color: BotColor("#9BE85A")!, face: .eyes, faceX: 50, faceY: 45, faceScale: 1.05),
    .hexagon: .init(label: "Hexagon", color: BotColor("#FF8C42")!, face: .eyes, faceX: 50, faceY: 50, faceScale: 0.95),
    .cat: .init(label: "Cat", color: BotColor("#F4D28B")!, face: .eyes, faceX: 50, faceY: 58, faceScale: 1),
    .cloud: .init(label: "Cloud", color: BotColor("#CFE6FF")!, face: .eyes, faceX: 50, faceY: 58, faceScale: 0.95),
    .pill: .init(label: "Pill", color: BotColor("#7B77F0")!, face: .eyes, faceX: 50, faceY: 50, faceScale: 0.9),
    .pebble: .init(label: "Pebble", color: BotColor("#FFB27A")!, face: .eyes, faceX: 50, faceY: 50, faceScale: 0.95),
    .puddle: .init(label: "Puddle", color: BotColor("#FF7F6E")!, face: .eyes, faceX: 50, faceY: 50, faceScale: 0.95),
]

public extension BotAvatarType {
    var preset: BotAvatarPreset { botAvatarPresets[self]! }
    /// Body colour by type — the palette on its own.
    var paletteColor: BotColor { preset.color }
}

/// The jump's numbers: an idle flip's and a click's.
public struct BotAvatarJumpConfig: Equatable, Sendable {
    /// how high, in body units (the body is 100 tall)
    public var height: Double = 26
    /// seconds in the air
    public var time: Double = 0.68
    /// how much the body stretches in the air, 0–2
    public var stretch: Double = 1
    /// how much it squashes on the ground, before take-off and on landing, 0–2
    public var squash: Double = 1.15
    /// seconds the landing squash takes, contact to recovered
    public var squashTime: Double = 0.37
    /// the landing squash's shape
    public var squashEase: BotAvatarSquashEase = .pulse
    /// seconds a click's jump takes for its landing squash
    public var clickSquashTime: Double = 0.24
    /// whole turns in the air
    public var spin: Double = 1
    /// degrees of lean into it
    public var lean: Double = 6
    /// seconds between idle jumps, roughly (±40 %); 0 for none
    public var every: Double = 8
    /// when the landing squash begins: seconds before (negative) or after
    /// touch-down; 0 is the moment of contact
    public var land: Double = 0

    public init(height: Double = 26, time: Double = 0.68, stretch: Double = 1, squash: Double = 1.15, squashTime: Double = 0.37, squashEase: BotAvatarSquashEase = .pulse, clickSquashTime: Double = 0.24, spin: Double = 1, lean: Double = 6, every: Double = 8, land: Double = 0) {
        self.height = height; self.time = time; self.stretch = stretch; self.squash = squash; self.squashTime = squashTime
        self.squashEase = squashEase; self.clickSquashTime = clickSquashTime; self.spin = spin; self.lean = lean; self.every = every; self.land = land
    }

    /// The web's `JUMP_DEFAULTS`.
    public static let defaults = BotAvatarJumpConfig()
}

/// The whirl round a spin: its strength and the ring's shape. Off by
/// default (`strength` 0); 1 turns it on.
public struct BotAvatarWhirl: Equatable, Sendable {
    /// 0–2; off at 0
    public var strength: Double = 0
    /// size of the ring, 0.6–1.6
    public var size: Double = 1
    /// thickness of the trail, 0.4–2
    public var width: Double = 1
    /// length of the trail round the ring, 0.4–1.6
    public var length: Double = 1
    /// how flat the ring is seen, 0.5–1.8 (higher is more open)
    public var tilt: Double = 1
    public init(strength: Double = 0, size: Double = 1, width: Double = 1, length: Double = 1, tilt: Double = 1) {
        self.strength = strength; self.size = size; self.width = width; self.length = length; self.tilt = tilt
    }
    public static let off = BotAvatarWhirl()
    public static let on = BotAvatarWhirl(strength: 1)
}
