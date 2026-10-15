import SwiftUI

/// The "New" badge (Figma 1458:40880): a white pill with the material over
/// it, a clean white core under the label so the metal lives at the rim, the
/// inset white glows and hairlines, and the label — metal-fx v2's `<MetalBadge>`.
public struct MetalBadge: View {
    public struct Core: Equatable, Sendable {
        /// Solid radius, % of the ellipse.
        public var r: Double = 46
        /// Ramp width, %.
        public var blur: Double = 100
        /// Opacity.
        public var a: Double = 0.94
        /// Ellipse size, % of the box.
        public var size: Double = 49
        public init() {}
        public static let `default` = Core()
    }

    public var text: String
    public var preset: MetalPreset = .chromatic
    public var theme: MetalTheme = .auto
    public var strength: Double = 1
    /// Size multiplier on the Figma metrics (45×25, 12.222 pt).
    public var scale: Double = 1
    public var metalOpacity: Double = 0.8
    public var shaderScale: Double = 1.6
    public var core: Core = .default
    /// Top→bottom white wash (0..1).
    public var gradient: Double = 0
    /// Inner white glow strength (0..1).
    public var glow: Double = 0.41
    public var textColor: Color = Color(red: 0x32 / 255.0, green: 0x32 / 255.0, blue: 0x32 / 255.0)
    public var paused: Bool = false
    public var id: String? = nil

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.displayScale) private var displayScale
    @StateObject private var model = MetalFxModel()

    static let width: CGFloat = 45, height: CGFloat = 25, radius: CGFloat = 55.556

    public init(_ text: String = "New", preset: MetalPreset = .chromatic, theme: MetalTheme = .auto, strength: Double = 1, scale: Double = 1,
                metalOpacity: Double = 0.8, shaderScale: Double = 1.6, core: Core = .default, gradient: Double = 0, glow: Double = 0.41,
                textColor: Color = Color(red: 0x32 / 255.0, green: 0x32 / 255.0, blue: 0x32 / 255.0), paused: Bool = false, id: String? = nil) {
        self.text = text; self.preset = preset; self.theme = theme; self.strength = strength; self.scale = scale
        self.metalOpacity = metalOpacity; self.shaderScale = shaderScale; self.core = core; self.gradient = gradient
        self.glow = glow; self.textColor = textColor; self.paused = paused; self.id = id
    }

    public var body: some View {
        let k = CGFloat(scale)
        let w = MetalBadge.width * k, h = MetalBadge.height * k
        let shape = RoundedRectangle(cornerRadius: MetalBadge.radius * k, style: .circular)
        ZStack {
            shape.fill(.white)
            TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { ctx in
                metal(size: CGSize(width: w, height: h), shape: shape, now: ctx.date.timeIntervalSinceReferenceDate)
            }
            // Clean white core under the label: CSS `radial-gradient(ellipse
            // size% size%, white r%, transparent (r+blur)%)` — radii as a
            // fraction of the box, stops as a fraction of the radius.
            let rx = w * core.size / 100, ry = h * core.size / 100
            Color.clear
                .overlay {
                    Circle()
                        .fill(RadialGradient(
                            stops: [.init(color: .white, location: core.r / 100), .init(color: .white.opacity(0), location: min(1, (core.r + core.blur) / 100))],
                            center: .center, startRadius: 0, endRadius: rx
                        ))
                        .frame(width: rx * 2, height: rx * 2)
                        .scaleEffect(x: 1, y: ry / rx)
                }
                .opacity(core.a)
                .mask(shape)
            // Top wash.
            shape.fill(LinearGradient(colors: [.white.opacity(gradient), .white.opacity(0)], startPoint: .top, endPoint: .bottom))
            // Inset glows: two 8.333-pt white inner glows.
            shape.stroke(Color.white.opacity(glow), lineWidth: 8.333 * 2 * k).blur(radius: 8.333 * 0.5 * k).mask(shape)
            shape.stroke(Color.white.opacity(glow), lineWidth: 8.333 * 2 * k).blur(radius: 8.333 * 0.5 * k).mask(shape)
            // Hairline .833 at 50 %, and the top rim .833 at 78 %.
            shape.strokeBorder(Color.white.opacity(0.5), lineWidth: 0.833 * k)
            MetalRimLayer(options: { var o = MetalRimOptions(); o.offsetY = 0.833 * scale; o.blur = 0; o.alpha = 0.78; return o }()) { shape.fill(.white) }
            Text(text)
                .font(.system(size: 12.222 * scale, weight: .semibold))
                .foregroundStyle(textColor)
                .lineLimit(1)
        }
        .frame(width: w, height: h)
        .background { MetalFrameReporter(id: id, model: model) }
        .onChange(of: paused, initial: true) { _, p in model.clock.setPaused(p, now: Date().timeIntervalSinceReferenceDate) }
        .onAppear { if let id { model.registeredID = id; MetalFrameStore.shared.register(id, model: model) } }
        .onDisappear { if let id = model.registeredID { MetalFrameStore.shared.unregister(id, model: model) } }
    }

    @ViewBuilder
    private func metal(size: CGSize, shape: RoundedRectangle, now: TimeInterval) -> some View {
        let resolved = theme.resolved(colorScheme)
        let material = MetalMaterial.preset(preset, theme: resolved)
        let mapping = MetalSheetMapping(size: size, shaderScale: Float(shaderScale))
        let opacityMul = Float(strength * metalOpacity) * material.shaderOpacity
        let t = model.time(now: now)
        let _ = {
            model.size = size; model.cornerRadius = MetalBadge.radius * CGFloat(scale); model.ringWidth = 0; model.kind = .pill
            model.material = material; model.opacityMul = opacityMul; model.shaderScale = Float(shaderScale); model.isSheet = true
        }()
        shape.fill(.white)
            .colorEffect(material.shader(mapping: mapping, time: t, opacityMul: opacityMul, ditherScale: displayScale))
    }
}
