import SwiftUI

/// Per-instance state that outlives view updates: the pause clock, the bend
/// simulation, the glow state machine, and the last-known geometry that
/// reflections and the edge halo read from.
public final class MetalFxModel: ObservableObject {
    let clock = MetalInstanceClock()
    let bend = MetalBendModel()
    let glow = MetalGlowState()

    // Snapshot of the anchor for reflections, refreshed every frame.
    var size: CGSize = .zero
    var cornerRadius: CGFloat = 0
    var ringWidth: CGFloat = 1
    var kind: MetalShapeKind = .pill
    var material: MetalMaterial = .base
    var opacityMul: Float = 1
    var shaderScale: Float = 1.6
    var frame: CGRect = .zero
    /// Text / badge anchors: the whole box is metal (a masked sheet), not a band.
    var isSheet = false
    var tiltAttached = false
    var registeredID: String?

    public init() {}

    func time(now: TimeInterval) -> Double { clock.time(now: now) }
    var mapping: MetalSheetMapping { MetalSheetMapping(size: size, shaderScale: shaderScale) }
    var deform: MetalDeform? { bend.field.map { f in { f.deform($0) } } }
}

/// Registry of on-screen anchors (rings, text, badges) by id — what
/// `.metalReflection(of:)` and `.metalEdgeHalo()` look up.
public final class MetalFrameStore: ObservableObject {
    public static let shared = MetalFrameStore()
    @Published private(set) var anchors: [String: MetalFxModel] = [:]

    private init() {}

    func register(_ id: String, model: MetalFxModel) {
        if anchors[id] !== model { anchors[id] = model }
    }

    func unregister(_ id: String, model: MetalFxModel) {
        if anchors[id] === model { anchors.removeValue(forKey: id) }
    }

    /// Frames change rarely; publish only real moves so per-frame work stays local.
    func updateFrame(_ id: String, _ frame: CGRect, model: MetalFxModel) {
        let prev = model.frame
        model.frame = frame
        if abs(prev.minX - frame.minX) > 0.5 || abs(prev.minY - frame.minY) > 0.5
            || abs(prev.width - frame.width) > 0.5 || abs(prev.height - frame.height) > 0.5 {
            objectWillChange.send()
        }
    }
}

/// Reports a view's global frame to an anchor model.
struct MetalFrameReporter: View {
    let id: String?
    let model: MetalFxModel
    var body: some View {
        GeometryReader { g in
            Color.clear
                .onChange(of: g.frame(in: .global), initial: true) { _, f in
                    model.frame = f
                    if let id { MetalFrameStore.shared.updateFrame(id, f, model: model) }
                }
        }
    }
}

// MARK: - Shader

extension MetalMaterial {
    /// The `mfxLiquidMetal` colour effect for this material.
    func shader(mapping: MetalSheetMapping, time: Double, opacityMul: Float, ditherScale: CGFloat) -> Shader {
        ShaderLibrary.bundle(.module).mfxLiquidMetal(
            .float2(Double(mapping.origin.x), Double(mapping.origin.y)),
            .float2(Double(mapping.scale.x), Double(mapping.scale.y)),
            .float(time * Double(speed)),
            .float4(Double(colorBack.x), Double(colorBack.y), Double(colorBack.z), Double(colorBack.w)),
            .float4(Double(colorTint.x), Double(colorTint.y), Double(colorTint.z), Double(colorTint.w)),
            .float(Double(repetition)), .float(Double(softness)),
            .float(Double(shiftRed)), .float(Double(shiftBlue)),
            .float(Double(distortion)), .float(Double(contour)), .float(Double(angle)),
            .float(Double(opacityMul)), .float(Double(ditherScale))
        )
    }
}

// MARK: - MetalFx

/// The liquid-metal ring around any content — metal-fx v2's `<MetalFx>`.
///
/// Wraps `content` tightly (like the web's inline-flex root): the content is
/// the visible surface, the metal band runs along its edge, and the glow,
/// rims and inner shadow sit between the two. Tilting the phone bends the
/// ring like liquid; give it an `id` to let neighbours reflect it and the
/// screen edge glow from it.
public enum MetalFxVariant: Sendable { case button, circle }

public struct MetalFx<Content: View>: View {
    public typealias Variant = MetalFxVariant

    public var variant: Variant = .button
    public var preset: MetalPreset = .chromatic
    public var theme: MetalTheme = .auto
    /// 0..1 — multiplies the material's opacity and the glow.
    public var strength: Double = 1
    /// Zoom on the material; defaults to the variant's (button 1.6, circle 1.3).
    public var shaderScale: Double? = nil
    /// Band width, pt; defaults to the variant's (button 1, circle 2).
    public var ringWidth: Double? = nil
    /// Defaults to fully rounded.
    public var cornerRadius: Double? = nil
    /// The Figma inner-shadow hairline along the band's top inside edge.
    public var innerShadow: Bool = false
    public var glow: Bool = true
    public var glowGain: Double = 1
    public var paused: Bool = false
    /// Bend with the phone's tilt.
    public var tilt: Bool = true
    public var bendConfig: MetalBendConfig = .default
    public var glowConfig: MetalGlowConfig = .default
    /// Surface colour under the content; defaults to the theme's.
    public var fill: Color? = nil
    /// Anchor id for `.metalReflection(of:)` / the edge halo.
    public var id: String? = nil
    public var content: () -> Content

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.displayScale) private var displayScale
    @StateObject private var model = MetalFxModel()

    public init(variant: Variant = .button, preset: MetalPreset = .chromatic, theme: MetalTheme = .auto,
                strength: Double = 1, shaderScale: Double? = nil, ringWidth: Double? = nil, cornerRadius: Double? = nil,
                innerShadow: Bool = false, glow: Bool = true, glowGain: Double = 1, paused: Bool = false,
                tilt: Bool = true, bendConfig: MetalBendConfig = .default, glowConfig: MetalGlowConfig = .default,
                fill: Color? = nil, id: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.variant = variant; self.preset = preset; self.theme = theme; self.strength = strength
        self.shaderScale = shaderScale; self.ringWidth = ringWidth; self.cornerRadius = cornerRadius
        self.innerShadow = innerShadow; self.glow = glow; self.glowGain = glowGain; self.paused = paused
        self.tilt = tilt; self.bendConfig = bendConfig; self.glowConfig = glowConfig; self.fill = fill; self.id = id
        self.content = content
    }

    private var resolvedTheme: MetalResolvedTheme { theme.resolved(colorScheme) }
    private var resolvedRing: CGFloat { CGFloat(ringWidth ?? (variant == .circle ? 2 : 1)) }
    private var resolvedScale: Float { Float(shaderScale ?? (variant == .circle ? 1.3 : 1.6)) }

    public var body: some View {
        content()
            .background {
                GeometryReader { g in
                    TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { ctx in
                        MetalFxFrame(
                            model: model, now: ctx.date.timeIntervalSinceReferenceDate, size: g.size,
                            variant: variant, material: .preset(preset, theme: resolvedTheme), theme: resolvedTheme,
                            strength: strength, shaderScale: resolvedScale, ringWidth: resolvedRing,
                            cornerRadius: cornerRadius.map { CGFloat($0) }, innerShadow: innerShadow,
                            glow: glow, glowGain: glowGain, tilt: tilt, bendConfig: bendConfig, glowConfig: glowConfig,
                            fill: fill, displayScale: displayScale
                        )
                    }
                }
                .allowsHitTesting(false)
            }
            .background { MetalFrameReporter(id: id, model: model) }
            .onChange(of: paused, initial: true) { _, p in model.clock.setPaused(p, now: Date().timeIntervalSinceReferenceDate) }
            .onChange(of: tilt, initial: true) { _, on in
                if on, !model.tiltAttached { MetalTiltSource.shared.attach(); model.tiltAttached = true }
                if !on, model.tiltAttached { MetalTiltSource.shared.detach(); model.tiltAttached = false; model.bend.reset() }
            }
            .onAppear { if let id { model.registeredID = id; MetalFrameStore.shared.register(id, model: model) } }
            .onDisappear {
                if let id = model.registeredID { MetalFrameStore.shared.unregister(id, model: model) }
                if model.tiltAttached { MetalTiltSource.shared.detach(); model.tiltAttached = false }
            }
    }
}

/// One frame of the ring's layers (fill, band, hairline, rim, glow, inner
/// shadow), in the box's coordinates. Overflows the box on purpose: the halo
/// and a bent band reach past it.
struct MetalFxFrame: View {
    let model: MetalFxModel
    let now: TimeInterval
    let size: CGSize
    let variant: MetalFxVariant
    let material: MetalMaterial
    let theme: MetalResolvedTheme
    let strength: Double
    let shaderScale: Float
    let ringWidth: CGFloat
    let cornerRadius: CGFloat?
    let innerShadow: Bool
    let glow: Bool
    let glowGain: Double
    let tilt: Bool
    let bendConfig: MetalBendConfig
    let glowConfig: MetalGlowConfig
    let fill: Color?
    let displayScale: CGFloat

    var body: some View {
        let radius = min(cornerRadius ?? .infinity, min(size.width, size.height) / 2)
        let kind = MetalGeometry.kind(size: size, radius: radius)
        let t = model.time(now: now)
        let box = CGRect(origin: .zero, size: size)

        // Bend: tilt → field → outline displacement.
        let tiltV = tilt ? MetalTiltSource.shared.tilt(now: now) : .zero
        let field = tilt ? model.bend.step(now: now, tilt: tiltV, size: size, radius: radius, cfg: bendConfig) : nil
        let deform: MetalDeform? = field.map { f in { f.deform($0) } }

        let outer = MetalGeometry.roundRectOutline(box, radius: radius, deform: deform)
        let inner = MetalGeometry.roundRectOutline(box.insetBy(dx: ringWidth, dy: ringWidth), radius: max(0, radius - ringWidth), deform: deform)
        let outerPath = MetalGeometry.path(outer)
        let bandPath = MetalGeometry.bandPath(outer: outer, inner: inner)
        let rimW: CGFloat = variant == .circle ? 2 : 1
        let rimInner = MetalGeometry.roundRectOutline(box.insetBy(dx: rimW, dy: rimW), radius: max(0, radius - rimW), deform: deform)
        let rimPath = MetalGeometry.bandPath(outer: outer, inner: rimInner)

        let mapping = MetalSheetMapping(size: size, shaderScale: shaderScale)
        let opacityMul = Float(strength) * material.shaderOpacity
        let shader = material.shader(mapping: mapping, time: t, opacityMul: opacityMul, ditherScale: displayScale)

        let surface = fill ?? (theme == .dark ? Color(red: 0x27 / 255.0, green: 0x27 / 255.0, blue: 0x27 / 255.0) : .white)
        let rimColor = theme == .dark ? Color.white.opacity(0.1) : Color.black.opacity(0.06)

        // Keep the anchor snapshot current for reflections / the edge halo.
        let _ = {
            model.size = size; model.cornerRadius = radius; model.ringWidth = ringWidth; model.kind = kind
            model.material = material; model.opacityMul = opacityMul; model.shaderScale = shaderScale; model.isSheet = false
        }()

        ZStack(alignment: .topLeading) {
            outerPath.fill(surface)
            bandPath.fill(.white, style: FillStyle(eoFill: true))
                .colorEffect(shader)
            if variant == .circle && theme == .dark {
                // The circle variant's dark hairline just outside the box.
                MetalGeometry.path(MetalGeometry.roundRectOutline(box.insetBy(dx: -0.5, dy: -0.5), radius: radius + 0.5, deform: deform))
                    .stroke(Color.black.opacity(0.45), lineWidth: 1)
            }
            rimPath.fill(rimColor, style: FillStyle(eoFill: true))
            if glow {
                glowLayer(mapping: mapping, t: t, radius: radius, kind: kind, deform: deform, bandPath: bandPath)
            }
            if innerShadow {
                MetalRimLayer(options: .default) { bandPath.fill(.white, style: FillStyle(eoFill: true)) }
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }

    @ViewBuilder
    private func glowLayer(mapping: MetalSheetMapping, t: Double, radius: CGFloat, kind: MetalShapeKind, deform: MetalDeform?, bandPath: Path) -> some View {
        let cfg = glowConfig
        let _ = model.glow.configure(size: size, radius: radius, kind: kind, cfg: cfg)
        let mat = material
        let tf = Float(t)
        let sampler = MetalGlowSampler(
            luminance: { p in mat.luminance(uv: mapping.uv(p), time: tf) },
            rgb: { p in mat.sample(uv: mapping.uv(p), time: tf) }
        )
        let frame = model.glow.tick(nowMs: now * 1000, sampler: sampler, strength: strength * glowGain, theme: theme, deform: deform, cfg: cfg)
        if let frame {
            let ratio = Double(MetalGeometry.shapePerim(size.width, size.height, radius, kind) / MetalGeometry.rrPerim(140, 40, 20))
            let halo = MetalGlowSprites.halo(halfLen: max(1, cfg.haloHalfLen * ratio), s: 1, scale: displayScale, cfg: cfg)
            let extra = MetalGlowSprites.extra(halfLen: max(0.6, cfg.extraHalfLen * ratio), s: 1, scale: displayScale, cfg: cfg)
            let margin: CGFloat = 48
            MetalGlowLayer(frame: frame, halo: halo, extra: extra, theme: theme, small: kind == .circle && min(size.width, size.height) <= 44, size: size, margin: margin) {
                ZStack(alignment: .topLeading) {
                    Color.white.opacity(0.5)
                    bandPath.offsetBy(dx: margin, dy: margin).fill(.white, style: FillStyle(eoFill: true))
                }
            }
        }
    }
}
