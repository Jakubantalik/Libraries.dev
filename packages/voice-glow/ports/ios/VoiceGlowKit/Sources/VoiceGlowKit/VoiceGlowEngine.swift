import Foundation

/// Everything the engine and the layers need, resolved from the type
/// preset, the theme and the caller's options.
struct VoiceGlowConfig {
    /// The type preset with the caller's overrides, and `scale` already
    /// multiplied into every pt dimension (as the web component does).
    var g: VoiceGeometry
    var options: VoiceGlowOptions
    var dark: Bool
    var colorVariant: VoiceGlowColorVariant
    var cornerRadius: Double
    var reducedMotion: Bool

    init(
        type: VoiceGlowType, options o: VoiceGlowOptions, dark: Bool,
        colorVariant: VoiceGlowColorVariant, cornerRadius: Double, reducedMotion: Bool
    ) {
        var g = VoiceGeometry.resolve(type, dark: dark)
        if let v = o.scale { g.scale = v }
        if let v = o.reach { g.reach = v }
        if let v = o.spread { g.spread = v }
        if let v = o.flow { g.flow = v }
        if let v = o.bend { g.bend = v }
        if let v = o.bandStrength { g.bandStrength = v }
        if let v = o.bandWidth { g.bandWidth = v }
        let sc = max(0.05, g.scale)
        g.scale = sc
        g.flow *= sc
        g.bend *= sc
        g.bandWidth *= sc
        g.bandOffset *= sc
        g.bandTailOverflow *= sc
        g.glowWidth *= sc
        g.glowHeight *= sc
        g.lobeSpacing *= sc
        g.rangeWidth *= sc
        g.rangeHeight *= sc
        g.coreSize *= sc
        g.glowSize *= sc
        self.g = g
        self.options = o
        self.dark = dark
        self.colorVariant = colorVariant
        self.cornerRadius = cornerRadius
        self.reducedMotion = reducedMotion
    }

    var theme: VoiceGlowStyle.ThemePreset { VoiceGlowStyle.themePreset(dark) }
    var idle: Double { min(max(options.idle ?? g.idle, 0), 1) }
    var strength: Double { min(max(options.strength ?? g.strength ?? theme.strength, 0), 1) }
    var brightness: Double { options.brightness ?? g.brightness ?? theme.brightness }
    var saturation: Double { options.saturation ?? g.saturation ?? theme.saturation }
    var hueRange: Double { max(0, options.hueRange ?? theme.hueRange) }
    var hueDuration: Double { max(0.5, options.hueDuration ?? theme.hueDuration) }
    var staticColors: Bool { colorVariant == .mono }

    var baseColors: [VoiceGlowColor] {
        let palette = VoiceGlowStyle.palette(colorVariant, dark: dark)
        guard let custom = options.colors else { return palette }
        return palette.enumerated().map { i, c in i < custom.count ? custom[i] : c }
    }
}

/// One frame's worth of driven values — what the web driver writes as CSS
/// custom properties, plus the colours it leaves to the stylesheet's filter.
struct VoiceGlowFrame {
    var level = 0.0
    /// Presence of the whole effect, 0–1 (the fade in and out).
    var presence = 0.0
    /// `--vb-glow`: layer opacity factor.
    var glow = 0.4
    /// `--vb-h` / `--vb-w`: height and spread multipliers.
    var h = 0.8
    var w = 1.0
    /// `--vb-cx` / `--vb-cy`: the beam's sideways travel and its corner lift, pt.
    var cx = 0.0
    var cy = 0.0
    /// `--vb-mw`: the range narrowed into a beam while gathered.
    var maskWidth = 1.0
    /// `--vb-bh` / `--vb-bendA`: the ceiling's extra height and the band's strength.
    var lift = 0.0
    var bendA = 0.0
    /// How far the lobes are gathered into one beam (the motion), 0–1.
    var morph = 0.0
    /// Per lobe: offset along the flow (`--vb-xN`), amplitude (`--vb-lN`), corner lift (`--vb-yN`).
    var lobeX = [Double](repeating: 0, count: VoiceGlowStyle.lobes.count)
    var lobeL = [Double](repeating: 1, count: VoiceGlowStyle.lobes.count)
    var lobeY = [Double](repeating: 0, count: VoiceGlowStyle.lobes.count)
    /// Lobe colours after the mood blend and the hue / brightness / saturate
    /// chain, 0–1 linear-in-sRGB-space components.
    var colors = [SIMD3<Float>](repeating: .zero, count: VoiceGlowStyle.lobes.count)
    /// The chain itself, for the highlight and the band.
    var colorMatrix: [Double] = [1, 0, 0, 0, 1, 0, 0, 0, 1]
    /// The mood as the glow currently shows it (smoothed).
    var mood = VoiceMood.neutral
    /// How far the glow has moved into the mood palette, 0–1.
    var moodAmount = 0.0
    /// The mood palette at the current mood (before the filter chain), so
    /// the band's fringes can take the mood too.
    var moodColors: [VoiceGlowColor] = []
}

/// Raw input for one frame.
struct VoiceGlowInput {
    /// Raw RMS from the meter, or the caller's level when there is no meter.
    var level: Double
    var bands: SIMD3<Double>?
    var motion: VoiceGlowMotion
    var active: Bool
    var mood: VoiceMood?
}

/// The voice driver, ported from the web `voiceDriver.ts`: shapes the raw
/// level (gain, noise gate, soft saturation), follows it with an
/// attack/release envelope, advances the flow, gathers the lobes into a beam
/// where a motion driver asks for it, folds in the idle breathing and the
/// hue drift — and, new here, eases the mood colour in.
final class VoiceGlowEngine {
    // Envelope state, carried across frames.
    private var level = 0.0
    private var bands = SIMD3<Double>(0, 0, 0)
    private var phase = 0.0
    private var t = 0.0
    private var lastTime: Double?
    private var presence = 0.0

    // Mood state: the target the glow is easing to, and how far it is in.
    private var moodValence = 0.0
    private var moodArousal = 0.3
    private var moodAmount = 0.0

    /// Gain applied before `sensitivity` (a phone mic at speaking distance
    /// gives an RMS of roughly 0.03–0.2).
    private static let baseGain = 5.0
    private static let bandGain = 1.7

    /// True while the effect is visible or fading — the view stops drawing below this.
    var isVisible: Bool { presence > 0.002 }

    func step(time now: Double, input: VoiceGlowInput, config c: VoiceGlowConfig, size: CGSize) -> VoiceGlowFrame {
        let dt = lastTime.map { min(0.05, max(0, now - $0)) } ?? (1.0 / 60)
        lastTime = now
        t += dt
        let o = c.options
        let g = c.g

        // ── Presence: the web's 0.6 s fade in, 0.5 s out ─────────────────
        let fadeStep = dt / (input.active ? 0.6 : 0.5)
        presence = input.active ? min(1, presence + fadeStep) : max(0, presence - fadeStep)

        // ── Raw level and bands ──────────────────────────────────────────
        var rawLevel: Double
        var rawBands: SIMD3<Double>
        if let b = input.bands {
            rawLevel = input.level * Self.baseGain * o.sensitivity
            rawBands = b * Self.bandGain * o.sensitivity
        } else {
            // No spectrum: give the bands slow, out-of-phase wobbles scaled
            // by the level so the lobes still ripple.
            rawLevel = min(max(input.level, 0), 1)
            rawBands = SIMD3(
                rawLevel,
                rawLevel * (0.72 + 0.28 * sin(t * 9.1)),
                rawLevel * (0.6 + 0.4 * sin(t * 13.7 + 2))
            )
        }

        // ── Shape and follow ─────────────────────────────────────────────
        let target = Self.shape(rawLevel, o.threshold)
        level = Self.follow(level, target, dt, o.attack, o.release)
        for b in 0..<3 {
            let bt = Self.shape(rawBands[b], o.threshold * 0.6)
            bands[b] = Self.follow(bands[b], bt, dt, o.attack, o.release * 1.15)
        }

        // ── Motion: the lobes gathered into one beam, and where it sits ──
        // (rest unless a driver — VoiceGlow Pro's processing — moves it).
        let span = VoiceGlowStyle.lobeSpan * g.lobeSpacing
        let motion = input.motion
        let morph = motion.gather
        let cx = c.reducedMotion ? 0 : motion.offset * span / 2
        let gather = 1 - morph * 0.6
        let maskWidth = 1 - morph * 0.45
        let passWidth = 1 + morph * 0.3 * motion.stretch

        // ── Idle breathing folded under the voice ────────────────────────
        let breathe = c.reducedMotion ? 0.5 : 0.5 + 0.5 * sin(2 * .pi * t / max(0.2, o.breatheDuration))
        let voiced = level + (1 - level) * c.idle * breathe
        let heldT = max(0, min(1, (morph - 0.25) / 0.75))
        let held = heldT * heldT * (3 - 2 * heldT)
        let eff = max(voiced, motion.heldLevel * held)

        let reach = g.reach
        let spread = g.spread
        var f = VoiceGlowFrame()
        f.level = level
        f.presence = presence * presence * (3 - 2 * presence)
        f.glow = 0.15 + 0.85 * eff
        f.h = 0.5 + reach * eff
        f.w = (0.85 + spread * eff) * passWidth
        f.cx = cx
        f.maskWidth = maskWidth
        f.morph = morph

        // ── Flow: the spectrum slides sideways as the voice comes in ─────
        let flow = g.flow
        if flow != 0 && !c.reducedMotion {
            phase = ((phase + flow * eff * dt).truncatingRemainder(dividingBy: span) + span)
                .truncatingRemainder(dividingBy: span)
        }

        // ── Bend ─────────────────────────────────────────────────────────
        let bend = max(0, g.bend)
        f.lift = bend * eff
        f.bendA = bend > 0 ? min(1, f.lift / bend) : 0

        // ── Corner arcs while gathered ───────────────────────────────────
        let cw = Double(size.width), ch = Double(size.height)
        let arcRadius = Self.paintedRadius(c.cornerRadius, cw, ch)
        let cornerBlend = morph * motion.cornerFollow
        let lobeReach = 30 * g.scale * f.w
        let beamAbsX = cw / 2 + cx * f.w
        f.cy = -Self.cornerLift(beamAbsX, cw, arcRadius, lobeReach * 1.4) * cornerBlend

        for (i, lobe) in VoiceGlowStyle.lobes.enumerated() {
            let x = Self.wrapX(lobe.x * g.lobeSpacing + phase, span)
            let bandLift = o.bands ? 0.6 + 0.7 * bands[lobe.band] : 1
            f.lobeX[i] = x * gather
            f.lobeL[i] = bandLift * Self.edgeEnvelope(x, span)
            let lobeAbsX = cw / 2 + (cx + x * gather) * f.w
            f.lobeY[i] = -Self.cornerLift(lobeAbsX, cw, arcRadius, lobeReach) * cornerBlend
        }

        // ── Mood: ease toward the estimate, by its confidence ────────────
        let a = 1 - exp(-dt / max(0.02, o.moodSmoothing))
        if let m = input.mood, m.confidence > 0 {
            // The hue follows at full speed once the estimate means it
            // (15% confidence); a barely-there one only nudges it.
            let pull = a * min(1, m.confidence / 0.15)
            moodValence += (m.valence - moodValence) * pull
            moodArousal += (m.arousal - moodArousal) * pull
        }
        // A barely-there estimate is treated as none, so a near-neutral voice
        // shows the palette instead of a faint tint that wanders with noise.
        let raw = input.mood?.confidence ?? 0
        let moodTarget = max(0, (raw - 0.15) / 0.85) * min(max(o.moodStrength, 0), 1)
        // Into a mood fast, back to the palette a little slower.
        moodAmount = Self.follow(moodAmount, moodTarget, dt, max(0.02, o.moodSmoothing), max(0.02, o.moodRelease))
        f.mood = VoiceMood(valence: moodValence, arousal: moodArousal, confidence: moodAmount)
        f.moodAmount = moodAmount

        // ── Hue drift (calmer while a mood holds the colour) ─────────────
        let hueRange = c.hueRange * (1 - 0.7 * moodAmount)
        let hue = c.staticColors || c.reducedMotion || hueRange == 0
            ? 0
            : -hueRange + 2 * hueRange * Self.pingPong(t / c.hueDuration)
        f.colorMatrix = VoiceColorMatrix.composed(
            hueDegrees: c.theme.hueBase + hue, brightness: c.brightness, saturation: c.saturation
        )

        // ── Lobe colours: palette → mood blend → filter chain ────────────
        let base = c.baseColors
        let moodColors = moodAmount > 0.001
            ? o.moodPalette.colors(valence: moodValence, arousal: moodArousal, dark: c.dark)
            : nil
        f.moodColors = moodColors?.map(\.color) ?? []
        for i in 0..<VoiceGlowStyle.lobes.count {
            var color = base[i % base.count]
            if let moodColors {
                color = OKLab(color).mixed(with: moodColors[i], moodAmount).color
            }
            f.colors[i] = VoiceColorMatrix.apply(f.colorMatrix, color)
        }
        return f
    }

    // MARK: - Driver maths (web parity)

    /// Noise gate then soft saturation, so a shout rounds off instead of clipping.
    static func shape(_ raw: Double, _ threshold: Double) -> Double {
        if raw <= threshold { return 0 }
        let t = (raw - threshold) / max(0.001, 1 - threshold)
        return min(1, max(0, (1 - exp(-3 * t)) / (1 - exp(-3))))
    }

    /// One-pole follower: fast up (attack), slow down (release).
    static func follow(_ prev: Double, _ target: Double, _ dt: Double, _ attack: Double, _ release: Double) -> Double {
        let tau = target > prev ? attack : release
        let a = 1 - exp(-dt / max(0.001, tau))
        return prev + (target - prev) * a
    }

    /// Wrap a lobe offset into [-span/2, span/2).
    static func wrapX(_ x: Double, _ span: Double) -> Double {
        let half = span / 2
        let m = (x + half).truncatingRemainder(dividingBy: span)
        return (m < 0 ? m + span : m) - half
    }

    /// Full at the centre, gone at the wrap edge so a lobe never pops sides.
    static func edgeEnvelope(_ x: Double, _ span: Double) -> Double {
        let t = x / (span / 2 + 4)
        return max(0, 1 - t * t)
    }

    static func pingPong(_ phase: Double) -> Double {
        (1 - cos(2 * .pi * phase)) / 2
    }

    /// The radius the host actually paints (clamped to half its box).
    static func paintedRadius(_ radius: Double, _ cw: Double, _ ch: Double) -> Double {
        max(0, min(radius, cw / 2, ch / 2))
    }

    /// How far above the bottom edge the outline sits at `x`.
    static func cornerLift(_ x: Double, _ cw: Double, _ radius: Double, _ influence: Double = 0) -> Double {
        if radius <= 0 { return 0 }
        let d = min(x, cw - x) - influence
        if d >= radius { return 0 }
        if d <= 0 { return radius }
        let dx = radius - d
        return radius - sqrt(max(0, radius * radius - dx * dx))
    }
}
