// VoiceRing — a ring of light that listens: a few glassy rings bundled into
// one ribbon, a conic spectrum running round it, bending with the voice.
// It is the aura type of Voice orbs, as a library of its own. Import
// VoiceRingKit alone; the shared core (the meter, moods, styles) comes with it.

@_exported import VoiceCore
import SwiftUI

/// A voice-reactive ring of light.
///
/// ```swift
/// @State private var meter = VoiceMeter()
///
/// VoiceRing(state: .listening, source: .meter(meter), size: 240)
///     .task { try? await meter.start() }
/// ```
///
/// `mood` shifts the spectrum toward how the voice feels (from
/// VoiceRingEmotion, or set by hand). `direction` (−1 left … 1 right) leans
/// the ring toward the voice: pass `VoiceDirection.pan` from
/// VoiceDirectionKit, or your own; nil leans nowhere.
public struct VoiceRing: View {
    private let state: VoiceState
    private let source: VoiceSource
    private let style: VoiceStyle
    private let mood: VoiceMood?
    private let direction: Double?
    private let size: CGFloat

    public init(
        state: VoiceState = .listening,
        source: VoiceSource = .silence,
        style: VoiceStyle = VoiceStyle(),
        mood: VoiceMood? = nil,
        direction: Double? = nil,
        size: CGFloat = 200
    ) {
        self.state = state
        self.source = source
        self.style = style
        self.mood = mood
        self.direction = direction
        self.size = size
    }

    public init(
        state: VoiceState = .listening,
        source: VoiceSource = .silence,
        style: VoiceStyle = VoiceStyle(),
        emotion: VoiceOrbEmotion?,
        direction: Double? = nil,
        size: CGFloat = 200
    ) {
        self.init(state: state, source: source, style: style, mood: emotion?.mood, direction: direction, size: size)
    }

    public var body: some View {
        let style = self.style
        VoiceCanvas(
            resolve: { VoiceRing.preset(size: $0, dots: style.dots, dotSize: style.dotSize ?? 1) },
            state: state, source: source, style: style, mood: mood, direction: direction,
            size: size, colourful: false
        )
    }

    /// The ring's preset: drawn out further and bulging more toward the
    /// voice; light meets the edge through the lens, stretched far, rather
    /// than squashing on it, and leans right up to the screen's edge.
    public static func preset(size: Double, dots: Double = 1, dotSize: Double = 1) -> ResolvedPreset {
        let lean = LeanAmounts(pull: 1.26, deform: 0.38, squash: 0, lens: 0.79, stretch: 1.99, split: 1.17,
                               blur: 1.25, bounce: 0.82)
        return .resolve(frame: frameAura, speed: 1.6, driveGain: 2, voiceSpeed: 0.9, lean: lean, leanMargin: 0,
                        opts: ["rings": 6, "segs": 140],
                        counts: ["segs": 0.5], size: size, dots: dots, dotSize: dotSize)
    }
}
