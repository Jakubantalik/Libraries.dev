import SwiftUI

/// Sound-reactive glow — SwiftUI port of the `voice-glow` web library, with
/// mood colouring.
///
/// A centred, colourful beam along the bottom edge of the wrapped view that
/// rises and blooms with the level of a voice. Feed it a ``VoiceMeter``, or
/// drive it yourself with `level`. Pass a ``VoiceMood`` and the colours
/// follow how the voice feels: happy green, calm teal, angry or sad red.
///
/// ```swift
/// @State private var meter = VoiceMeter()
///
/// VoiceGlow(meter: meter, mood: estimator.mood) {
///     ChatInput()
/// }
/// // or
/// ChatInput().voiceGlow(meter: meter)
/// ```
public struct VoiceGlow<Content: View>: View {
    private let type: VoiceGlowType
    private let meter: VoiceMeter?
    private let level: Double
    private let levelProvider: (() -> Double)?
    private let mood: VoiceMood?
    private let motion: (() -> VoiceGlowMotion)?
    private let active: Bool
    private let colorVariant: VoiceGlowColorVariant
    private let theme: VoiceGlowTheme
    private let cornerRadius: Double
    private let options: VoiceGlowOptions
    private let content: Content

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var engine = VoiceGlowEngine()

    /// - Parameters:
    ///   - type: host preset — `.standard` (chat input), `.pill`, `.mobile`.
    ///   - meter: a running ``VoiceMeter``; wins over `level` while it runs.
    ///   - level: 0–1 when you drive the glow yourself.
    ///   - levelProvider: a getter sampled every frame — for a level that
    ///     changes many times a second, without re-rendering your view.
    ///   - mood: how the voice feels; `nil` or zero confidence keeps the palette.
    ///   - motion: the glow's large-scale motion, sampled every frame — nil
    ///     keeps it at rest. VoiceGlow Pro's processing state drives it.
    ///   - active: fades the glow in and out.
    ///   - cornerRadius: the wrapped view's corner radius (SwiftUI has no auto-detect).
    public init(
        type: VoiceGlowType = .standard,
        meter: VoiceMeter? = nil,
        level: Double = 0,
        levelProvider: (() -> Double)? = nil,
        mood: VoiceMood? = nil,
        motion: (() -> VoiceGlowMotion)? = nil,
        active: Bool = true,
        colorVariant: VoiceGlowColorVariant = .colorful,
        theme: VoiceGlowTheme = .auto,
        cornerRadius: Double = 16,
        options: VoiceGlowOptions = .init(),
        @ViewBuilder content: () -> Content
    ) {
        self.type = type
        self.meter = meter
        self.level = level
        self.levelProvider = levelProvider
        self.mood = mood
        self.motion = motion
        self.active = active
        self.colorVariant = colorVariant
        self.theme = theme
        self.cornerRadius = cornerRadius
        self.options = options
        self.content = content()
    }

    public var body: some View {
        content.overlay {
            GeometryReader { geo in
                TimelineView(.animation(paused: !active && !engine.isVisible)) { timeline in
                    let config = VoiceGlowConfig(
                        type: type, options: options, dark: isDark, colorVariant: colorVariant,
                        cornerRadius: cornerRadius, reducedMotion: reduceMotion
                    )
                    let frame = engine.step(
                        time: timeline.date.timeIntervalSinceReferenceDate,
                        input: input,
                        config: config,
                        size: geo.size
                    )
                    if frame.presence > 0.002 {
                        VoiceGlowLayers(frame: frame, config: config, size: geo.size)
                    }
                }
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        }
    }

    private var isDark: Bool {
        switch theme {
        case .dark: return true
        case .light: return false
        case .auto: return colorScheme == .dark
        }
    }

    private var input: VoiceGlowInput {
        if let meter, meter.isRunning, let read = meter.read() {
            return VoiceGlowInput(level: read.rms, bands: read.bands, motion: motion?() ?? .rest, active: active, mood: mood)
        }
        return VoiceGlowInput(level: levelProvider?() ?? level, bands: nil, motion: motion?() ?? .rest, active: active, mood: mood)
    }
}

// MARK: - View modifier sugar

public extension View {
    /// Wraps the view in a ``VoiceGlow``.
    func voiceGlow(
        type: VoiceGlowType = .standard,
        meter: VoiceMeter? = nil,
        level: Double = 0,
        levelProvider: (() -> Double)? = nil,
        mood: VoiceMood? = nil,
        motion: (() -> VoiceGlowMotion)? = nil,
        active: Bool = true,
        colorVariant: VoiceGlowColorVariant = .colorful,
        theme: VoiceGlowTheme = .auto,
        cornerRadius: Double = 16,
        options: VoiceGlowOptions = .init()
    ) -> some View {
        VoiceGlow(
            type: type, meter: meter, level: level, levelProvider: levelProvider, mood: mood, motion: motion,
            active: active, colorVariant: colorVariant, theme: theme,
            cornerRadius: cornerRadius, options: options
        ) { self }
    }
}
