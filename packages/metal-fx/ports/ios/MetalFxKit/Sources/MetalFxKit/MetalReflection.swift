import SwiftUI

/// How a neighbour catches the metal.
public enum MetalReflectionStyle: Sendable {
    /// A chip or card: the mirrored band lands in a soft strip along the
    /// facing edge, plus a hairline of it inside the edge.
    case surface
    /// Text: the mirrored sheet lands on the letterforms only.
    case glyphs
}

public extension View {
    /// Reflect the metal of the anchor registered under `id` onto this view,
    /// along the edge that faces it — metal-fx v2's `reflectionTargets`.
    ///
    /// - Parameters:
    ///   - strength: alpha multiplier (1 = canonical; the demo's "Plan" uses 0.64).
    ///   - cornerRadius: this view's corner radius; defaults to fully rounded.
    func metalReflection(of id: String, strength: Double = 1, cornerRadius: CGFloat? = nil, style: MetalReflectionStyle = .surface) -> some View {
        modifier(MetalReflectionModifier(anchorID: id, strength: strength, cornerRadius: cornerRadius, style: style))
    }
}

struct MetalReflectionModifier: ViewModifier {
    let anchorID: String
    let strength: Double
    let cornerRadius: CGFloat?
    let style: MetalReflectionStyle

    @ObservedObject private var store = MetalFrameStore.shared
    @Environment(\.displayScale) private var displayScale
    @State private var frame: CGRect = .zero

    func body(content: Content) -> some View {
        content
            .background {
                GeometryReader { g in
                    Color.clear.onChange(of: g.frame(in: .global), initial: true) { _, f in frame = f }
                }
            }
            .overlay {
                if let anchor = store.anchors[anchorID], frame.width > 0 {
                    TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { ctx in
                        let layer = MetalReflectionLayer(
                            anchor: anchor, target: frame, strength: strength, style: style,
                            cornerRadius: cornerRadius ?? min(frame.width, frame.height) / 2,
                            now: ctx.date.timeIntervalSinceReferenceDate, displayScale: displayScale
                        )
                        if style == .glyphs {
                            layer.mask { content }
                        } else {
                            layer
                        }
                    }
                    .allowsHitTesting(false)
                }
            }
    }
}

/// One frame of a reflection, in the target's local coordinates.
struct MetalReflectionLayer: View {
    let anchor: MetalFxModel
    let target: CGRect
    let strength: Double
    let style: MetalReflectionStyle
    let cornerRadius: CGFloat
    let now: TimeInterval
    let displayScale: CGFloat

    // Web constants (src/engine/reflection/constants.ts).
    private static let rangePx: CGFloat = 12
    private static let baseAlpha = 0.55, boostAlpha = 1.0
    private static let intensityMult = 1.3, globalAttenuation = 0.7, maxAlphaStack = 3.6
    private static let strokeExtraAlpha = 0.52, borderHiliteAlpha = 0.044
    private static let refDrawW: CGFloat = 235
    private static let fillExtraAlpha = 2.535, fillOpacityMul = 0.7, fillCircleAttenuation = 0.5
    private static let fillBlur: CGFloat = 4

    struct Layout {
        var draw: CGRect
        var flipX: Bool, flipY: Bool
        var g0: UnitPoint, g1: UnitPoint
        var reflectionAlpha: Double
    }

    /// The web's per-target layout: which edge faces the anchor, where the
    /// mirrored anchor lands, the gradient across the strip, the alpha.
    private func layout() -> Layout? {
        let a = anchor.frame, tr = target
        let tW = tr.width, tH = tr.height
        guard a.width >= 4, a.height >= 4, tW >= 1, tH >= 1 else { return nil }
        let dx = a.midX - tr.midX, dy = a.midY - tr.midY
        let edgeGapH = max(a.minX - tr.maxX, tr.minX - a.maxX, 0)
        let edgeGapV = max(a.minY - tr.maxY, tr.minY - a.maxY, 0)
        let horiz = edgeGapH >= edgeGapV
        let dist = hypot(edgeGapH, edgeGapV)
        var proximity = 1 - min(1, Double(dist / Self.rangePx))
        proximity = proximity * proximity * (3 - 2 * proximity)
        let intensity = Self.baseAlpha + (Self.boostAlpha - Self.baseAlpha) * proximity
        let reflectionAlpha = min(Self.maxAlphaStack, intensity * Self.intensityMult * Self.globalAttenuation) * strength
        let glyph = style == .glyphs
        let band = min(glyph ? Self.rangePx * 1.5 : Self.rangePx, max(tW, tH))
        let refW: CGFloat = glyph
            ? max(1, min(horiz ? tW : tH, horiz ? a.width : a.height))
            : max(1, Self.refDrawW * max(0.1, a.width / 140))
        let draw: CGRect
        let flipX: Bool, flipY: Bool
        let g0: UnitPoint, g1: UnitPoint
        if horiz {
            let top = max(a.minY, tr.minY), bot = min(a.maxY, tr.maxY)
            draw = CGRect(x: dx > 0 ? tW - refW : 0, y: top - tr.minY, width: refW, height: max(1, bot - top))
            flipX = true; flipY = false
            g0 = UnitPoint(x: dx > 0 ? 1 : 0, y: 0.5)
            g1 = UnitPoint(x: dx > 0 ? 1 - band / tW : band / tW, y: 0.5)
        } else {
            let left = max(a.minX, tr.minX), right = min(a.maxX, tr.maxX)
            draw = CGRect(x: left - tr.minX, y: dy > 0 ? tH - refW : 0, width: max(1, right - left), height: refW)
            flipX = false; flipY = true
            g0 = UnitPoint(x: 0.5, y: dy > 0 ? 1 : 0)
            g1 = UnitPoint(x: 0.5, y: dy > 0 ? 1 - band / tH : band / tH)
        }
        return Layout(draw: draw, flipX: flipX, flipY: flipY, g0: g0, g1: g1, reflectionAlpha: reflectionAlpha)
    }

    var body: some View {
        if let L = layout() {
            let tW = target.width, tH = target.height
            let gradient = LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black.opacity(0.85), location: 0.5), .init(color: .black.opacity(0), location: 1)], startPoint: L.g0, endPoint: L.g1)
            let source = MetalReflectionSource(anchor: anchor, draw: L.draw, flipX: L.flipX, flipY: L.flipY, now: now, displayScale: displayScale)
            let targetShape = RoundedRectangle(cornerRadius: cornerRadius, style: .circular)
            if style == .glyphs {
                // One pass, never over 1: stacked passes clip the highlights to white.
                source.opacity(min(1, L.reflectionAlpha * Self.fillOpacityMul))
                    .mask(gradient)
                    .modifier(FilterChain(blur: 0.4, saturation: 1.35, brightness: 1.2))
                    .frame(width: tW, height: tH)
            } else {
                let fillAlpha = min(Self.maxAlphaStack, L.reflectionAlpha * Self.fillExtraAlpha * Self.fillOpacityMul * Self.fillCircleAttenuation)
                let fillBand = Self.rangePx + Self.fillBlur * 3
                ZStack(alignment: .topLeading) {
                    // Fill: the mirrored band in the edge strip, blurred and lifted.
                    StackedPasses(total: fillAlpha) { source }
                        .mask(gradient)
                        .mask { EdgeBand(shape: targetShape, width: fillBand) }
                        .modifier(FilterChain(blur: Self.fillBlur, saturation: 1.2, brightness: 1.58))
                    // Stroke: a hairline of it just inside the edge.
                    StackedPasses(total: L.reflectionAlpha * Self.strokeExtraAlpha) { source }
                        .mask(gradient)
                        .mask { EdgeBand(shape: targetShape, width: 1) }
                        .modifier(FilterChain(blur: 0, saturation: 1.35, brightness: 1.75))
                    // Border highlight.
                    EdgeBand(shape: targetShape, width: 1)
                        .foregroundStyle(.white)
                        .opacity(min(0.85, Self.borderHiliteAlpha * L.reflectionAlpha))
                        .mask(gradient)
                }
                .frame(width: tW, height: tH, alignment: .topLeading)
                .clipShape(targetShape)
            }
        }
    }
}

/// The anchor as the target sees it: its band (or its whole sheet for text /
/// badge anchors), stretched into `draw` and mirrored, sampling the same
/// window of the material at the same moment.
struct MetalReflectionSource: View {
    let anchor: MetalFxModel
    let draw: CGRect
    let flipX: Bool
    let flipY: Bool
    let now: TimeInterval
    let displayScale: CGFloat

    private func geometry() -> (Path, MetalSheetMapping) {
        let aSize = anchor.size
        let sx = draw.width / max(1, aSize.width) * (flipX ? -1 : 1)
        let sy = draw.height / max(1, aSize.height) * (flipY ? -1 : 1)
        let xf = CGAffineTransform(translationX: draw.minX + (flipX ? draw.width : 0), y: draw.minY + (flipY ? draw.height : 0))
            .scaledBy(x: sx, y: sy)
        let box = CGRect(origin: .zero, size: aSize)
        let deform = anchor.deform
        let path: Path
        if anchor.isSheet {
            path = Path(box).applying(xf)
        } else {
            let outer = MetalGeometry.roundRectOutline(box, radius: anchor.cornerRadius, deform: deform)
            let inner = MetalGeometry.roundRectOutline(box.insetBy(dx: anchor.ringWidth, dy: anchor.ringWidth), radius: max(0, anchor.cornerRadius - anchor.ringWidth), deform: deform)
            path = MetalGeometry.bandPath(outer: outer, inner: inner).applying(xf)
        }
        // uv = origin + position·scale in the anchor's box, re-expressed in the
        // target's coordinates through the same stretch and mirror.
        var m = anchor.mapping.stretched(from: aSize, to: draw.size, flipX: flipX, flipY: flipY)
        m.origin -= m.scale * SIMD2<Float>(Float(draw.minX), Float(draw.minY))
        return (path, m)
    }

    var body: some View {
        let (path, m) = geometry()
        let t = anchor.time(now: now)
        path.fill(.white, style: FillStyle(eoFill: true))
            .colorEffect(anchor.material.shader(mapping: m, time: t, opacityMul: anchor.opacityMul, ditherScale: displayScale))
    }
}

/// `lighter`-stacked passes: alpha over 1 draws again additively.
struct StackedPasses<Source: View>: View {
    let total: Double
    @ViewBuilder let source: () -> Source
    var body: some View {
        let a0 = min(1, max(0, total))
        let a1 = min(1, max(0, total - 1))
        let a2 = min(1, max(0, total - 2))
        ZStack {
            source().opacity(a0)
            if a1 > 1e-4 { source().opacity(a1).blendMode(.plusLighter) }
            if a2 > 1e-4 { source().opacity(a2).blendMode(.plusLighter) }
        }
        .compositingGroup()
    }
}

/// The strip inside a shape's edge, `width` pt deep (even-odd).
struct EdgeBand<S: InsettableShape>: View {
    let shape: S
    let width: CGFloat
    var body: some View {
        ZStack {
            shape.fill(.white)
            shape.inset(by: width).fill(.black).blendMode(.destinationOut)
        }
        .compositingGroup()
    }
}

/// CSS `blur() saturate() brightness()`, with brightness as a multiply
/// (an additive self-copy), not SwiftUI's additive offset.
struct FilterChain: ViewModifier {
    let blur: CGFloat
    let saturation: Double
    let brightness: Double
    func body(content: Content) -> some View {
        let base = content.blur(radius: blur).saturation(saturation)
        ZStack {
            base
            if brightness > 1 { base.opacity(brightness - 1).blendMode(.plusLighter) }
        }
        .compositingGroup()
    }
}
