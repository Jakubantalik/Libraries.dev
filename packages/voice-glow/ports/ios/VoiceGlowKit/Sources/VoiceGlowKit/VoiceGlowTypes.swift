import Foundation

/// Host preset — retunes the glow's geometry for the view it wraps.
///
/// - `standard`: a chat input or card, ~350 pt wide (the web `default`).
/// - `pill`: a small recording pill, ~150×44 — glow pulled in, shallower bend.
/// - `mobile`: the bottom of a phone screen — wider range, taller rise.
public enum VoiceGlowType: String, CaseIterable, Sendable {
    case standard
    case pill
    case mobile
}

/// Theme the glow is tuned for. `.auto` follows the environment's colour scheme.
public enum VoiceGlowTheme: String, CaseIterable, Sendable {
    case dark
    case light
    case auto
}

/// The eight palettes, shared with border-beam and the web `voice-glow`.
public enum VoiceGlowColorVariant: String, CaseIterable, Sendable {
    case colorful
    case mono
    case ocean
    case sunset
    case forest
    case candy
    case ice
    case gold
}

/// How the voice feels, as the two axes emotion research uses.
///
/// - `valence`: −1 (negative: angry, sad) … +1 (positive: happy, calm).
/// - `arousal`: 0 (calm, low energy) … 1 (excited, high energy).
/// - `confidence`: 0 … 1 — how sure the source is. The glow only leaves its
///   own palette in proportion to it, so an unsure estimate stays quiet.
///
/// Any source can produce one: `Emotion2VecMoodEstimator` (VoiceGlowEmotion),
/// a server, a text sentiment model, or a slider in a demo.
public struct VoiceMood: Equatable, Sendable {
    public var valence: Double
    public var arousal: Double
    public var confidence: Double

    public init(valence: Double, arousal: Double, confidence: Double = 1) {
        self.valence = min(max(valence, -1), 1)
        self.arousal = min(max(arousal, 0), 1)
        self.confidence = min(max(confidence, 0), 1)
    }

    /// No opinion: the glow keeps its palette.
    public static let neutral = VoiceMood(valence: 0, arousal: 0.3, confidence: 0)

    public static let happy = VoiceMood(valence: 0.8, arousal: 0.75)
    public static let angry = VoiceMood(valence: -0.75, arousal: 0.85)
    public static let sad = VoiceMood(valence: -0.7, arousal: 0.15)
    public static let calm = VoiceMood(valence: 0.6, arousal: 0.15)

    /// Two reads of one voice, merged: how it sounds (`tone`, e.g. the
    /// emotion2vec estimate) and what it says (`meaning`, e.g. the text
    /// estimate). Each axis trusts the source that reads it better — the
    /// words carry most of the valence ("I don't like it" is negative
    /// however flatly said), the tone most of the arousal — and each source
    /// counts in proportion to its confidence. Either may be nil or unsure;
    /// the other then speaks alone.
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
        // Agreeing sources reinforce; the stronger one sets the floor.
        let confidence = 1 - (1 - t.confidence) * (1 - m.confidence)
        return VoiceMood(valence: valence, arousal: arousal, confidence: confidence)
    }
}

/// The glow's large-scale motion for one frame: how far its lobes are
/// gathered into a single compact beam, and where that beam sits.
///
/// At ``rest`` the glow is the voice glow. A driver that changes it every
/// frame moves the whole effect — the processing state of VoiceGlow Pro
/// (`VoiceGlowProcessing`) sweeps the gathered beam across the range while
/// an assistant is thinking.
public struct VoiceGlowMotion: Equatable, Sendable {
    /// 0 the voice glow at rest … 1 the lobes fully gathered into one beam.
    public var gather: Double
    /// Sideways position of the beam, in half-widths of the lobe ring (0 = centre).
    public var offset: Double
    /// Extra width while the beam moves, 0–1.
    public var stretch: Double
    /// The level the glow is held at while gathered, 0–1, so the beam has colour.
    public var heldLevel: Double
    /// How much the gathered beam rides the host's corner arcs, 0–1.
    public var cornerFollow: Double

    public init(gather: Double, offset: Double = 0, stretch: Double = 0, heldLevel: Double = 0, cornerFollow: Double = 0) {
        self.gather = min(max(gather, 0), 1)
        self.offset = offset
        self.stretch = min(max(stretch, 0), 1)
        self.heldLevel = min(max(heldLevel, 0), 1)
        self.cornerFollow = min(max(cornerFollow, 0), 1)
    }

    public static let rest = VoiceGlowMotion(gather: 0)
}

/// Fine-tuning for ``VoiceGlow``. Every `nil` falls back to the `type`
/// preset, exactly like the web component's props.
public struct VoiceGlowOptions: Sendable {
    // Response
    /// Input gain — raise for quiet sources.
    public var sensitivity: Double = 3.1
    /// Noise gate: raw levels below this are silence.
    public var threshold: Double = 0.015
    /// Seconds to rise.
    public var attack: Double = 0.325
    /// Seconds to settle.
    public var release: Double = 0.86
    /// Breathing presence while silent, 0–1. 0 hides the glow when silent.
    public var idle: Double? = nil
    public var breatheDuration: Double = 5.2
    /// Low / mid / high bands move the lobes independently.
    public var bands: Bool = true

    // Shape
    public var scale: Double? = nil
    public var reach: Double? = nil
    public var spread: Double? = nil
    /// Pt/s the spectrum travels sideways at full level; negative flows right-to-left.
    public var flow: Double? = nil
    public var bend: Double? = nil
    public var bandStrength: Double? = nil
    public var bandWidth: Double? = nil

    // Colour
    public var brightness: Double? = nil
    public var saturation: Double? = nil
    /// Overall strength, 0–1.
    public var strength: Double? = nil
    /// Hue drift range in degrees; 0 holds the colours still.
    public var hueRange: Double? = nil
    public var hueDuration: Double? = nil
    /// Custom lobe colours (up to 7) overriding the variant palette.
    public var colors: [VoiceGlowColor]? = nil

    // Mood
    /// How far a confident mood takes the glow from its palette, 0–1.
    public var moodStrength: Double = 1
    /// Seconds the mood colour takes to follow a new estimate (time
    /// constant). Low is near-instant; raise it if a noisy source flickers.
    public var moodSmoothing: Double = 0.3
    /// Seconds the glow takes to fall back to its palette when the
    /// estimate loses confidence (silence, a neutral sentence).
    public var moodRelease: Double = 0.8
    /// The colours each corner of the mood plane maps to.
    public var moodPalette: VoiceMoodPalette = .standard

    public init() {}
}
