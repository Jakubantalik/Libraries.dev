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

    /// The ring's preset: it barely drifts toward the voice but leans, its
    /// near side drawn out and bulging a touch; light meets the edge through
    /// a soft lens rather than squashing on it, 32 pt short of the edge.
    public static func preset(size: Double, dots: Double = 1, dotSize: Double = 1) -> ResolvedPreset {
        let lean = LeanAmounts(move: 0.21, pull: 0.36, deform: 0.28, squash: 0, lens: 0.49, stretch: 1.04, split: 1.01,
                               blur: 1.24, bounce: 0.92)
        return .resolve(frame: frameAura, speed: 1.6, driveGain: 2, voiceSpeed: 0.9, lean: lean,
                        opts: ["rings": 6, "segs": 140],
                        counts: ["segs": 0.5], size: size, dots: dots, dotSize: dotSize)
    }
}
