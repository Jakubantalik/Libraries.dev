// VoiceRing — a ring that listens. `ring`: a few glassy rings bundled into one
// ribbon, a conic spectrum running round it, bending with the voice. `mono`:
// two loops of grey tube that a voice opens into a turning globe. They are the
// aura types of Voice orbs, as a library of their own. Import VoiceRingKit
// alone; the shared core (the meter, moods, styles) comes with it.

@_exported import VoiceCore
import SwiftUI

/// How the ring is drawn.
public enum VoiceRingType: String, CaseIterable, Sendable {
    /// A glassy ribbon with a spectrum running round it: a ring of light.
    case ring
    /// Two loops of grey tube that a voice opens into a turning globe. An
    /// emotion colours the tube, fading into the grey.
    case mono
}

/// A voice-reactive ring.
///
/// ```swift
/// @State private var meter = VoiceMeter()
///
/// VoiceRing(state: .listening, source: .meter(meter), size: 240)
///     .task { try? await meter.start() }
/// ```
///
/// Pass `.mono` first for the mono type: `VoiceRing(.mono, state: .listening)`.
///
/// `mood` shifts the colour toward how the voice feels (from
/// VoiceRingEmotion, or set by hand). `direction` (−1 left … 1 right) leans
/// the ring toward the voice: pass `VoicePosition.pan` from
/// VoicePositionKit, or your own; nil leans nowhere.
public struct VoiceRing: View {
    private let type: VoiceRingType
    private let state: VoiceState
    private let source: VoiceSource
    private let style: VoiceStyle
    private let mood: VoiceMood?
    private let direction: Double?
    private let size: CGFloat

    public init(
        _ type: VoiceRingType = .ring,
        state: VoiceState = .listening,
        source: VoiceSource = .silence,
        style: VoiceStyle = VoiceStyle(),
        mood: VoiceMood? = nil,
        direction: Double? = nil,
        size: CGFloat = 200
    ) {
        self.type = type
        self.state = state
        self.source = source
        self.style = style
        self.mood = mood
        self.direction = direction
        self.size = size
    }

    public init(
        _ type: VoiceRingType = .ring,
        state: VoiceState = .listening,
        source: VoiceSource = .silence,
        style: VoiceStyle = VoiceStyle(),
        emotion: VoiceOrbEmotion?,
        direction: Double? = nil,
        size: CGFloat = 200
    ) {
        self.init(type, state: state, source: source, style: style, mood: emotion?.mood, direction: direction, size: size)
    }

    public var body: some View {
        let style = self.style
        let type = self.type
        VoiceCanvas(
            resolve: { VoiceRing.preset(type, size: $0, dots: style.dots, dotSize: style.dotSize ?? 1) },
            state: state, source: source, style: style, mood: mood, direction: direction,
            size: size, colourful: false
        )
    }

    /// The preset for a type. The ring barely drifts toward the voice but
    /// leans, its near side drawn out and bulging a touch; light meets the edge
    /// through a soft lens rather than squashing on it, 32 pt short of the edge.
    /// Mono leans the same way but drifts further and meets the edge with no
    /// lens, and a voice spins it up a long way: waiting it drifts, speaking it
    /// turns and morphs quickly.
    public static func preset(_ type: VoiceRingType = .ring, size: Double, dots: Double = 1, dotSize: Double = 1) -> ResolvedPreset {
        switch type {
        case .ring:
            let lean = LeanAmounts(move: 0.21, pull: 0.36, deform: 0.28, squash: 0, lens: 0.49, stretch: 1.04, split: 1.01,
                                   blur: 1.24, bounce: 0.92)
            return .resolve(frame: frameAura, speed: 1.6, driveGain: 2, voiceSpeed: 0.9, lean: lean,
                            opts: ["rings": 6, "segs": 140],
                            counts: ["segs": 0.5], size: size, dots: dots, dotSize: dotSize)
        case .mono:
            let lean = LeanAmounts(move: 0.55, pull: 0.36, deform: 0.28, squash: 0, lens: 0, stretch: 0, split: 0,
                                   blur: 1.24, bounce: 0.92)
            return .resolve(frame: frameAuraMono, speed: 1.2, driveGain: 4, lean: lean,
                            opts: ["segs": 180],
                            counts: ["segs": 0.5], size: size, dots: dots, dotSize: dotSize)
        }
    }
}
