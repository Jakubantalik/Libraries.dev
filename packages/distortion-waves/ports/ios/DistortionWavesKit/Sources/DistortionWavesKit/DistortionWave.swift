import SwiftUI

/// A colourful distortion wave that opens from a source view — the button,
/// edge or avatar that started it — and carries one screen into another.
///
/// Everything falls toward the source for a moment, tiny sparks with it. Then the
/// front leaves the source and travels outward as one soft swell, carrying the
/// sparks and the palette, with a progressive blur peaking on it. The colour
/// stays on the view's edges after the middle has cleared.
///
/// ```swift
/// DistortionWave(isRevealed: sent, source: buttonFrame, style: .vertical) {
///     ReviewScreen()
/// } revealed: {
///     ReceiptScreen()
/// }
/// ```
///
/// The style's `type` sets the way it travels: `.vertical` up from a button at
/// the bottom, `.horizontal` right from a tall source at the left, `.center` out
/// from an avatar as a ring. Set `cornerRadius` to the corners of the view it
/// fills, for the colour on the edges to follow them.
///
/// `source` is in the transition's own coordinate space. Give both content
/// views an opaque background, and keep them free of UIKit-backed views and
/// materials, which SwiftUI cannot pass through a shader.
public struct DistortionWave<Content: View, Revealed: View>: View {
    private let isRevealed: Bool
    private let source: CGRect
    private let focus: CGPoint?
    private let style: DistortionWaveStyle
    private let scrub: Double?
    private let onFinish: (() -> Void)?
    private let content: Content
    private let revealed: Revealed

    @State private var progress: Double
    @State private var run = 0
    @State private var warming = true
    /// The touch the current wave leans with. Taken only when a wave starts from
    /// rest: changing it mid-wave would make everything on screen jump.
    @State private var heldFocus: CGPoint?
    @State private var atRest = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// - Parameters:
    ///   - isRevealed: flip it to send the wave out, flip it back to collapse it.
    ///   - source: the frame the wave opens from.
    ///   - focus: where the source was touched, in the transition's coordinate
    ///     space; the wave leans with it as much as the style's `orientation` says.
    ///   - scrub: holds the wave at this progress, 0–1, instead of animating it.
    ///   - onFinish: called when the wave has left and the screen's edges have
    ///     cleared, or when it has collapsed back. Not called for a run that was
    ///     interrupted by flipping `isRevealed` again.
    public init(
        isRevealed: Bool,
        source: CGRect,
        focus: CGPoint? = nil,
        style: DistortionWaveStyle = .vertical,
        scrub: Double? = nil,
        onFinish: (() -> Void)? = nil,
        @ViewBuilder content: () -> Content,
        @ViewBuilder revealed: () -> Revealed
    ) {
        self.isRevealed = isRevealed
        self.source = source
        self.focus = focus
        self.style = style
        self.scrub = scrub
        self.onFinish = onFinish
        self.content = content()
        self.revealed = revealed()
        _progress = State(initialValue: isRevealed ? 1 : 0)
    }

    public var body: some View {
        WaveStage(
            progress: scrub ?? progress,
            source: source,
            focus: scrub == nil ? heldFocus : focus,
            style: style,
            plain: reduceMotion,
            content: content,
            revealed: revealed
        )
        .background {
            if warming {
                warmUp
            }
        }
        .onChange(of: isRevealed) { _, nowRevealed in
            if atRest { heldFocus = focus }
            atRest = false
            run += 1
            let thisRun = run
            withAnimation(animation(revealing: nowRevealed), completionCriteria: .logicallyComplete) {
                progress = nowRevealed ? 1 : 0
            } completion: {
                if run == thisRun {
                    atRest = true
                    onFinish?()
                }
            }
        }
    }

    private func animation(revealing: Bool) -> Animation {
        if reduceMotion { return .linear(duration: 0.3) }
        if revealing { return .linear(duration: style.duration) }
        // On the wave's easing too, which is quick through the end of its life,
        // where little is on screen: the collapse answers the tap at once.
        let easing = style.easing
        return .timingCurve(easing.x1, easing.y1, easing.x2, easing.y2, duration: style.duration / style.returnSpeed)
    }

    /// The first draw of a wave compiles its shaders and rasterises text no one
    /// has seen yet — a third of a second, which would otherwise land on the
    /// first frames of the first wave. So it is drawn once, out of sight, behind
    /// the real stage, as the view appears.
    private var warmUp: some View {
        WaveStage(
            progress: (style.anticipation + 0.2) / style.duration,
            source: source,
            focus: nil,
            style: style,
            plain: false,
            content: content,
            revealed: revealed
        )
        .opacity(0.01)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .task {
            try? await Task.sleep(for: .milliseconds(150))
            warming = false
        }
    }
}

/// The transition at one progress. Animating `progress` re-renders it every
/// frame, and everything on screen is derived from that one number.
private struct WaveStage<Content: View, Revealed: View>: View, Animatable {
    var progress: Double
    let source: CGRect
    let focus: CGPoint?
    let style: DistortionWaveStyle
    let plain: Bool
    let content: Content
    let revealed: Revealed

    var animatableData: Double {
        get { progress }
        set { progress = newValue }
    }

    /// The blur radius of the first blurred copy; the second has the full radius.
    private static var nearBlur: Double { 7 }

    var body: some View {
        GeometryReader { geo in
            let front = WaveFront(progress: progress, source: source, size: geo.size, style: style, focus: focus)
            let field = front.packed
            let live = progress > 0 && progress < 1 && !plain
            let acting = live && front.energy > 0
            ZStack {
                side(revealed, side: -1, field: field, lens: acting, blurred: acting)
                    .opacity(plain ? progress : (front.launched ? 1 : 0))
                    .allowsHitTesting(progress >= 1)
                // Once the front has crossed, nothing of this side shows: no lens
                // for it either, a whole-screen pass saved for the rest of the wave.
                side(content, side: 1, field: field, lens: (acting || (live && front.gravity > 0)) && !front.hasCleared, blurred: acting && !front.hasCleared)
                    .opacity(plain ? 1 - progress : (front.hasCleared ? 0 : 1))
                    .allowsHitTesting(progress <= 0)
                band(field: field, lumps: WaveRim.lumps(time: front.time, size: geo.size, cornerRadius: style.cornerRadius, pulse: style.rimPulse), on: live)
                // Stays mounted, like the blurred copies: building it on the wave's
                // first frame would cost a stall.
                WaveParticles(front: front, source: source, style: style, on: live)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }

    /// One side of the transition: sharp, with its blurred copies over it, all
    /// through the swell as one layer. The copies stay mounted while hidden, as
    /// building them on the first frame of the wave costs a visible stall.
    private func side<Side: View>(_ view: Side, side: Float, field: [Float], lens: Bool, blurred: Bool) -> some View {
        ZStack {
            view
            copy(of: view, radius: Self.nearBlur, from: 0, to: Self.nearBlur, field: field, on: blurred)
            copy(of: view, radius: style.blur, from: Self.nearBlur, to: style.blur, field: field, on: blurred)
        }
        // One image: without the group each item goes through the shader alone,
        // and the channels of a half-transparent copy part into coloured bands.
        .compositingGroup()
        .layerEffect(
            ShaderLibrary.bundle(.module).waveLens(
                .floatArray(field),
                .float(style.amplitude),
                .float(style.lensWidth),
                .float(style.aberration),
                .float(side)
            ),
            maxSampleOffset: .zero,
            isEnabled: lens
        )
    }

    private func copy<Side: View>(of view: Side, radius: Double, from: Double, to: Double, field: [Float], on: Bool) -> some View {
        // Flattened first: without the group SwiftUI blurs each text and shape
        // on its own instead of the screen as one image.
        // No radius while hidden: a hidden copy then costs nothing, rather than a
        // whole-screen blur every frame of the wave's quieter parts.
        view
            .compositingGroup()
            .blur(radius: on ? radius : 0)
            .colorEffect(
                ShaderLibrary.bundle(.module).waveBlurMask(
                    .floatArray(field),
                    .float(style.blur),
                    .float(style.blurAhead),
                    .float(style.blurBehind),
                    .float(from),
                    .float(to)
                ),
                isEnabled: on
            )
            .opacity(on ? 1 : 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private func band(field: [Float], lumps: [Float], on: Bool) -> some View {
        Rectangle()
            .fill(Color.white)
            .colorEffect(
                ShaderLibrary.bundle(.module).waveBand(
                    .floatArray(field),
                    .floatArray(style.bandPalette),
                    .float(style.lead),
                    .float(style.tail),
                    .float(style.strength),
                    .float(style.rimWidth),
                    .float(style.rimSoftness),
                    .float(style.cornerRadius),
                    .float(style.rimUnevenness),
                    .float(style.rimPulse),
                    .float(style.hairlineWidth),
                    .float(style.hairlineOpacity),
                    .float(style.hairlineWhite),
                    .floatArray(lumps)
                ),
                isEnabled: on
            )
            .opacity(on ? 1 : 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}
