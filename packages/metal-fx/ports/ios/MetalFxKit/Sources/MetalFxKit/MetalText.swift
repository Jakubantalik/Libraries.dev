import SwiftUI

/// Metal inside the glyphs of a word — metal-fx v2's `<MetalText>`.
///
/// The text is drawn in `color`; the material is composited over it at
/// `strength × metalOpacity`, masked by the letterforms; the inner-shadow
/// hairline and (optionally) a glint run on the glyphs.
public struct MetalText: View {
    public var text: String
    public var font: Font
    public var color: Color
    public var preset: MetalPreset = .chromatic
    public var theme: MetalTheme = .auto
    public var strength: Double = 1
    /// How much metal shows over `color` (0..1).
    public var metalOpacity: Double = 0.62
    public var shaderScale: Double = 2.8
    public var innerShadow: Bool = true
    public var glow: Bool = false
    public var glowGain: Double = 2.5
    public var paused: Bool = false
    public var glowConfig: MetalGlowConfig = .default
    /// Anchor id for `.metalReflection(of:)`.
    public var id: String? = nil

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.displayScale) private var displayScale
    @StateObject private var model = MetalFxModel()
    @State private var glyphPoints: [CGPoint] = []
    @State private var glyphKey = ""

    public init(_ text: String, font: Font = .system(size: 24, weight: .medium), color: Color = Color(red: 0xE2 / 255.0, green: 0xE2 / 255.0, blue: 0xE2 / 255.0),
                preset: MetalPreset = .chromatic, theme: MetalTheme = .auto, strength: Double = 1, metalOpacity: Double = 0.62,
                shaderScale: Double = 2.8, innerShadow: Bool = true, glow: Bool = false, glowGain: Double = 2.5,
                paused: Bool = false, glowConfig: MetalGlowConfig = .default, id: String? = nil) {
        self.text = text; self.font = font; self.color = color; self.preset = preset; self.theme = theme
        self.strength = strength; self.metalOpacity = metalOpacity; self.shaderScale = shaderScale
        self.innerShadow = innerShadow; self.glow = glow; self.glowGain = glowGain; self.paused = paused
        self.glowConfig = glowConfig; self.id = id
    }

    private var label: Text { Text(text).font(font) }

    public var body: some View {
        label.foregroundStyle(color)
            .fixedSize()
            .overlay {
                GeometryReader { g in
                    TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { ctx in
                        frame(size: g.size, now: ctx.date.timeIntervalSinceReferenceDate)
                    }
                    .onChange(of: g.size, initial: true) { _, s in rasterizeGlyphs(size: s) }
                }
                .allowsHitTesting(false)
            }
            .background { MetalFrameReporter(id: id, model: model) }
            .onChange(of: paused, initial: true) { _, p in model.clock.setPaused(p, now: Date().timeIntervalSinceReferenceDate) }
            .onAppear { if let id { model.registeredID = id; MetalFrameStore.shared.register(id, model: model) } }
            .onDisappear { if let id = model.registeredID { MetalFrameStore.shared.unregister(id, model: model) } }
    }

    @ViewBuilder
    private func frame(size: CGSize, now: TimeInterval) -> some View {
        let resolved = theme.resolved(colorScheme)
        let material = MetalMaterial.preset(preset, theme: resolved)
        let t = model.time(now: now)
        let mapping = MetalSheetMapping(size: size, shaderScale: Float(shaderScale))
        let opacityMul = Float(strength * metalOpacity) * material.shaderOpacity
        let shader = material.shader(mapping: mapping, time: t, opacityMul: opacityMul, ditherScale: displayScale)
        let _ = {
            model.size = size; model.cornerRadius = 4; model.ringWidth = 0; model.kind = .pill
            model.material = material; model.opacityMul = opacityMul; model.shaderScale = Float(shaderScale); model.isSheet = true
        }()
        ZStack(alignment: .topLeading) {
            label.foregroundStyle(.white)
                .colorEffect(shader)
            if glow, !glyphPoints.isEmpty {
                glowLayer(size: size, mapping: mapping, material: material, t: t, theme: resolved)
            }
            if innerShadow {
                MetalRimLayer(options: .default) { label.foregroundStyle(.white) }
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }

    @ViewBuilder
    private func glowLayer(size: CGSize, mapping: MetalSheetMapping, material: MetalMaterial, t: Double, theme: MetalResolvedTheme) -> some View {
        let cfg = glowConfig
        let _ = model.glow.configure(size: size, radius: 4, kind: .pill, cfg: cfg, samplePoints: glyphPoints)
        let tf = Float(t)
        let sampler = MetalGlowSampler(
            luminance: { p in material.luminance(uv: mapping.uv(p), time: tf) },
            rgb: { p in material.sample(uv: mapping.uv(p), time: tf) }
        )
        let frame = model.glow.tick(nowMs: Date().timeIntervalSinceReferenceDate * 1000, sampler: sampler, strength: strength * glowGain, theme: theme, deform: nil, cfg: cfg)
        if let frame {
            let ratio = Double(MetalGeometry.rrPerim(size.width, size.height, 4) / MetalGeometry.rrPerim(140, 40, 20))
            let halo = MetalGlowSprites.halo(halfLen: max(1, cfg.haloHalfLen * ratio), s: 1, scale: displayScale, cfg: cfg)
            let extra = MetalGlowSprites.extra(halfLen: max(0.6, cfg.extraHalfLen * ratio), s: 1, scale: displayScale, cfg: cfg)
            let margin: CGFloat = 48
            MetalGlowLayer(frame: frame, halo: halo, extra: extra, theme: theme, small: false, size: size, margin: margin) {
                ZStack(alignment: .topLeading) {
                    label.foregroundStyle(.white).blur(radius: 3.5).opacity(0.5)
                    label.foregroundStyle(.white)
                }
                .frame(width: size.width, height: size.height, alignment: .topLeading)
                .offset(x: margin, y: margin)
            }
        }
    }

    /// Points inside the glyphs on a ~2 pt grid — where the glint may sit and
    /// where luminance is hunted. Rasterised once per text/size.
    @MainActor
    private func rasterizeGlyphs(size: CGSize) {
        let key = "\(text)|\(size.width)x\(size.height)"
        if key == glyphKey { return }
        glyphKey = key
        let renderer = ImageRenderer(content: label.foregroundStyle(.white).frame(width: size.width, height: size.height))
        renderer.scale = 1
        guard let cg = renderer.cgImage else { glyphPoints = []; return }
        let w = cg.width, h = cg.height
        guard w > 0, h > 0, let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                                 space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { glyphPoints = []; return }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        guard let data = ctx.data else { glyphPoints = []; return }
        let p = data.bindMemory(to: UInt8.self, capacity: w * h * 4)
        var pts: [CGPoint] = []
        let step = 2
        var y = step / 2
        while y < h {
            var x = step / 2
            while x < w {
                // CGContext rows are bottom-up.
                if p[((h - 1 - y) * w + x) * 4 + 3] > 128 { pts.append(CGPoint(x: x, y: y)) }
                x += step
            }
            y += step
        }
        glyphPoints = pts
    }
}
