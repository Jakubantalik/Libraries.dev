// The knobs, gathered: every prop of the web VoiceOrb that is not a
// source, as one value type. The demo's sliders write into it; an app sets
// the few it cares about.

import Foundation

/// The conversation state.
public enum VoiceState: String, CaseIterable, Sendable {
    /// Waiting for someone to talk: sources ignored, a calm slow drift.
    case idle
    /// The user's turn: follows the source (usually the microphone).
    case listening
    /// The assistant's turn: follows the source (usually its playback).
    case speaking
    /// Working on what was heard: each type's working motion.
    case processing

    public var label: String {
        switch self {
        case .idle: return "Waiting"
        case .listening: return "Listening"
        case .speaking: return "Speaking"
        case .processing: return "Thinking"
        }
    }
}

public enum VoiceTheme: Sendable {
    case auto, dark, light
}

/// What the orb listens to.
public enum VoiceSource {
    case silence
    /// The microphone (stereo on iPhone; VoiceDirectionKit reads its side).
    case meter(VoiceMeter)
    /// A level you drive, 0–1, sampled every frame.
    case level(() -> Double)
}

public struct VoiceStyle {
    // Motion
    public var speed: Double = 1
    public var sensitivity: Double = 1
    public var threshold: Double = 0.04
    /// Seconds to rise; nil takes the type's own (0.06 s, 0.16 s for pixel).
    public var attack: Double?
    public var release: Double = 0.32
    /// Breathing kept under the voice; 0 for none.
    public var idle: Double = 0.1
    /// Waiting pace, a share of the tuned speed.
    public var calm: Double = 0.4
    /// How much a voice speeds the motion up.
    /// How much a voice speeds the motion up; nil takes the type's own (1, 0.9 for aura).
    public var voiceSpeed: Double?

    // Look
    public var theme: VoiceTheme = .auto
    public var dots: Double = 1
    /// Multiplier on every mark's size; nil takes the type's own (1, 0.55 for pixel).
    public var dotSize: Double?
    /// Raw type knobs over the preset (`radius`, `deform`, `zoom`, …).
    public var opts: TypeOpts = [:]
    public var paused = false

    // Colour (ink types): the gradient from neutral into the emotion's
    // colour, or into `accent` without one.
    /// 0 never, 1 the colour itself, up to 2 purer and deeper still.
    public var saturation: Double = 2
    /// The colour's brightness, a multiplier on its lightness.
    public var colorBrightness: Double = 1.02
    /// Degrees to turn the colour's hue.
    public var colorHue: Double = 0
    /// Where across the orb (0–1) the colour begins to come in.
    public var gradientStart: Double = 0.1
    /// How far across the orb (0–1) the colour takes to arrive in full.
    public var gradientWidth: Double = 0.6
    public var gradientAngle: Double = 99
    public var gradientSpin: Double = 12
    public var neutral: Double = 1
    public var accent: VoiceAccent?

    // Emotion
    /// How far a confident mood takes the colour, 0–1.
    public var moodStrength: Double = 1

    // Direction
    /// How the orb leans toward the voice; nil takes the type's own (aura's
    /// is pulled further, never squashes and stretches far into the lens).
    public var lean: LeanAmounts?
    /// Points the lean stops short of the screen's edge; nil takes the
    /// type's own (32, aura none).
    public var leanMargin: Double?

    public init() {}
}

/// A type resolved at a size: its geometry, clocks and knobs.
public struct ResolvedPreset {
    public var frame: TypeFrame
    public var speed: Double
    public var driveGain: Double
    public var gain: Double
    /// The type's rise time, when the style sets none.
    public var attack: Double
    /// How much a voice speeds the type up, when the style sets none.
    public var voiceSpeed: Double
    /// The type's lean, when the style sets none.
    public var lean: LeanAmounts
    /// Points the type's lean stops short of the screen's edge, when the style sets none.
    public var leanMargin: Double
    public var opts: TypeOpts

    public init(frame: @escaping TypeFrame, speed: Double, driveGain: Double, gain: Double = 1, attack: Double = 0.06,
                voiceSpeed: Double = 1, lean: LeanAmounts = LeanAmounts(), leanMargin: Double = 32, opts: TypeOpts) {
        self.frame = frame
        self.speed = speed
        self.driveGain = driveGain
        self.gain = gain
        self.attack = attack
        self.voiceSpeed = voiceSpeed
        self.lean = lean
        self.leanMargin = leanMargin
        self.opts = opts
    }

    /// Scale count knobs with size and density, as the web presets do.
    public static func resolve(
        frame: @escaping TypeFrame, speed: Double, driveGain: Double, gain: Double = 1, attack: Double = 0.06,
        voiceSpeed: Double = 1, lean: LeanAmounts = LeanAmounts(), leanMargin: Double = 32, opts: TypeOpts,
        counts: [String: Double],
        size: Double, dots: Double, dotSize: Double
    ) -> ResolvedPreset {
        let scale = min(1.4, max(0.2, size / 200)) * max(0.1, dots)
        var o = opts
        for (knob, exp) in counts {
            if let v = o[knob] { o[knob] = max(1, (v * pow(scale, exp)).rounded()) }
        }
        if dotSize != 1 { o["rMul"] = max(0.1, dotSize) }
        return ResolvedPreset(frame: frame, speed: speed, driveGain: driveGain, gain: gain, attack: attack,
                              voiceSpeed: voiceSpeed, lean: lean, leanMargin: leanMargin, opts: o)
    }
}
