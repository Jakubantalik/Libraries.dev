// The view both libraries draw with. TimelineView(.animation) drives the
// clock and Canvas does the drawing, as in ThinkingOrbsKit — SwiftUI stops
// servicing an off-screen TimelineView, the web build's IntersectionObserver
// pause for free. The per-orb state (the voice follower, the eased emotion
// colour) lives in a reference that outlives re-renders, so a new style or
// source never resets the envelope mid-sentence.

import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

public struct VoiceCanvas: View {
    private let resolve: (Double) -> ResolvedPreset
    private let state: VoiceState
    private let source: VoiceSource
    private let style: VoiceStyle
    private let mood: VoiceMood?
    private let direction: Double?
    private let size: CGFloat
    private let colourful: Bool

    @State private var engine = OrbEngine()
    /// Points from the orb's box to the window's edges, left and right.
    @State private var room: (left: CGFloat, right: CGFloat) = (.infinity, .infinity)
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameters:
    ///   - resolve: the type's preset at a size (the libraries pass their own).
    ///   - colourful: whether the type takes colourful mode (ink types do;
    ///     a luminous type shows the mood by shifting its spectrum).
    public init(
        resolve: @escaping (Double) -> ResolvedPreset,
        state: VoiceState,
        source: VoiceSource,
        style: VoiceStyle,
        mood: VoiceMood?,
        direction: Double?,
        size: CGFloat,
        colourful: Bool
    ) {
        self.resolve = resolve
        self.state = state
        self.source = source
        self.style = style
        self.mood = mood
        self.direction = direction
        self.size = size
        self.colourful = colourful
    }

    private var isDark: Bool {
        switch style.theme {
        case .dark: return true
        case .light: return false
        case .auto: return colorScheme == .dark
        }
    }

    public var body: some View {
        // the canvas reaches past the orb's box by as far as the lean can
        // carry it — but no further than the window's edge, where the lean
        // stops — so a leaning orb is never cut off and never overflows; the
        // layout keeps `size`
        let own = resolve(Double(size))
        let reach = CGFloat(leanReach(style.lean ?? own.lean, size: Double(size)))
        let leanMargin = CGFloat(style.leanMargin ?? own.leanMargin)
        // the lean's bounds stop the margin short of the window's edge, but
        // the canvas reaches on into the margin, so a glow or a squashed
        // side fades out there instead of being cut at the bound
        let left = min(reach, room.left), right = min(reach, room.right)
        let margin = reach > 0 ? leanMargin : 0
        let padL = left + margin, padR = right + margin
        TimelineView(.animation(paused: style.paused)) { timeline in
            Canvas(rendersAsynchronously: false) { context, _ in
                context.translateBy(x: padL, y: 0)
                let now = timeline.date.timeIntervalSinceReferenceDate
                MainActor.assumeIsolated {
                    engine.render(
                        &context,
                        now: now,
                        input: OrbEngine.Input(
                            resolve: resolve, state: state, source: source, style: style, mood: mood,
                            direction: direction, bounds: (Double(left), Double(right)), size: Double(size),
                            colourful: colourful,
                            dark: isDark, still: reduceMotion || style.paused
                        )
                    )
                }
            }
        }
        .frame(width: size + padL + padR, height: size)
        .offset(x: (padR - padL) / 2)
        .frame(width: size, height: size)
        .background(GeometryReader { g in
            Color.clear
                .onAppear { measure(g.frame(in: .global), margin: leanMargin) }
                .onChange(of: g.frame(in: .global)) { _, frame in measure(frame, margin: leanMargin) }
        })
        .accessibilityElement()
        .accessibilityLabel(state.label)
        .accessibilityAddTraits(.isImage)
    }
}

extension VoiceCanvas {
    /// The room from the orb's box (in window coordinates) to the window's
    /// edges; a change of more than a point re-sizes the canvas.
    fileprivate func measure(_ frame: CGRect, margin: CGFloat) {
        guard let width = Self.windowWidth() else { return }
        // the lean stops short of the window's edge by the margin
        let next = (left: max(0, (frame.minX - margin).rounded(.down)), right: max(0, (width - frame.maxX - margin).rounded(.down)))
        if abs(next.left - room.left) > 1 || abs(next.right - room.right) > 1 || room.left.isInfinite {
            room = next
        }
    }

    @MainActor
    fileprivate static func windowWidth() -> CGFloat? {
        #if canImport(UIKit)
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        return (windows.first(where: \.isKeyWindow) ?? windows.first)?.bounds.width
        #elseif canImport(AppKit)
        return NSApplication.shared.keyWindow?.contentView?.bounds.width
        #else
        return nil
        #endif
    }
}

/// One orb's living state, stepped once per drawn frame.
@MainActor
final class OrbEngine {
    struct Input {
        var resolve: (Double) -> ResolvedPreset
        var state: VoiceState
        var source: VoiceSource
        var style: VoiceStyle
        var mood: VoiceMood?
        var direction: Double?
        /// How far past the box, left and right, the lean may carry a mark.
        var bounds: (left: Double, right: Double)
        var size: Double
        var colourful: Bool
        var dark: Bool
        var still: Bool
    }

    let follower = VoiceFollower()
    let glow = GlowFollower()
    /// The bounce off the edge, chasing how hard the last frame pressed on it.
    let bounce = EdgeBounce()
    private var press = 0.0
    private var last: Double = 0
    private var cache: (key: [Double], preset: ResolvedPreset)?

    func render(_ context: inout GraphicsContext, now: Double, input: Input) {
        let dt = last == 0 ? 1 / 60 : min(0.05, max(0, now - last))
        last = now
        let s = input.style
        let key = [input.size, s.dots, s.dotSize ?? -1]
        let preset: ResolvedPreset
        if let cache, cache.key == key {
            preset = cache.preset
        } else {
            preset = input.resolve(input.size)
            cache = (key, preset)
        }

        // waiting and processing do not listen, whatever is attached
        let hears = input.state == .listening || input.state == .speaking
        let sensitivity = s.sensitivity * preset.gain
        switch (hears, input.source) {
        case (true, .meter(let meter)):
            if let reading = meter.read() {
                follower.read(reading, sensitivity: sensitivity, dt: dt)
            } else {
                follower.readSilence()
            }
        case (true, .level(let get)):
            follower.readLevel(get(), sensitivity: sensitivity)
        default:
            follower.readSilence()
        }
        let voice = follower.step(
            dt: dt,
            FollowerConfig(
                sensitivity: sensitivity, threshold: s.threshold, attack: s.attack ?? preset.attack, release: s.release,
                idle: s.idle, driveGain: preset.driveGain * (s.voiceSpeed ?? preset.voiceSpeed), calm: s.calm,
                rate: preset.speed * s.speed, processing: input.state == .processing,
                // the side the app passes in (VoiceDirectionKit, or its own)
                direction: input.direction
            ),
            still: input.still
        )

        // the mood as a colour, eased: in by its confidence, out to nothing
        let m = input.mood
        let confident = (m?.confidence ?? 0) > 0.001
        glow.step(dt: dt, target: confident ? m!.color : nil, strength: (m?.confidence ?? 0) * s.moodStrength, still: input.still)

        var opts = preset.opts
        for (k, v) in s.opts { opts[k] = v }
        var frame = preset.frame(input.size, follower.t, voice, opts)
        let hit = input.still ? 0 : bounce.step(press: press, dt: dt)
        leanFrame(&frame, pan: voice.pan, size: input.size, amounts: s.lean ?? preset.lean, bounds: input.bounds, bounce: hit)
        press = frame.contact?.press ?? 0

        var paint = PaintStyle(dark: input.dark)
        if input.colourful {
            // the emotion is the colour; a fixed accent holds one without it
            let e = glow.amount
            let base = s.accent?.color
            let hue: RGB
            if let base {
                hue = RGB(base.r + (glow.color.r - base.r) * e, base.g + (glow.color.g - base.g) * e, base.b + (glow.color.b - base.b) * e)
            } else {
                hue = glow.color
            }
            // saturation past 1 is vividness: the colour itself purer and deeper
            paint.colors = OrbColors(
                saturation: min(1, s.saturation) * (base == nil ? e : 1), accent: hue,
                angle: s.gradientAngle + s.gradientSpin * follower.clock, neutral: s.neutral, size: input.size,
                vivid: max(0, min(1, s.saturation - 1)), brightness: s.colorBrightness, hue: s.colorHue,
                start: s.gradientStart, width: s.gradientWidth
            )
        } else {
            paint.glow = (glow.color, glow.amount)
        }
        paintFrame(&context, frame, style: paint)
    }
}
