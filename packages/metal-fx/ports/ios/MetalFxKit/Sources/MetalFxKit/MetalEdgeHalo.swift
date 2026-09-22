import SwiftUI
import UIKit

public extension View {
    /// The screen-edge halo. Apply to the view that touches the display's
    /// edge and contains a ring with an `id` — a card, a bar, or a screen
    /// root, as long as it is pure SwiftUI (UIKit-backed views such as
    /// `ScrollView` cannot be rasterised into a layer). When that ring sits
    /// within `reach` of the screen's edge, a strip along the edge pulls
    /// this view's content toward it like liquid glass — a slowly undulating
    /// lens with a faint, steady bloom in the metal's colour. Nothing
    /// flickers: the tint is smoothed and the only motion is the lens.
    ///
    /// While active this is one layer pass over the modified view per frame;
    /// inactive, it costs nothing.
    func metalEdgeHalo(reach: CGFloat = 72, depth: CGFloat = 40, intensity: Double = 1, displacement: CGFloat = 12) -> some View {
        modifier(MetalEdgeHaloModifier(reach: reach, depth: depth, intensity: intensity, displacement: displacement))
    }
}

/// Debug: paint the halo strip's geometry instead of the halo.
public enum MetalEdgeHaloDebug { public static var enabled = false }

struct MetalEdgeHaloModifier: ViewModifier {
    let reach: CGFloat
    let depth: CGFloat
    let intensity: Double
    let displacement: CGFloat

    @ObservedObject private var store = MetalFrameStore.shared
    @State private var hostFrame: CGRect = .zero
    /// Smoothed tint (exponential, ~1.5 s), so the halo never flickers with
    /// the material's stripes.
    @State private var tintState = TintSmoother()

    final class TintSmoother {
        var tint = SIMD3<Float>(repeating: 1)
        var last: TimeInterval = 0
        func update(_ target: SIMD3<Float>, now: TimeInterval) -> SIMD3<Float> {
            let dt = last > 0 ? min(0.2, max(0.001, now - last)) : 0
            last = now
            if dt == 0 { tint = target; return tint }
            let k = Float(1 - exp(-dt / 1.5))
            tint += (target - tint) * k
            return tint
        }
    }

    struct Candidate {
        var edge: Int            // 0 left, 1 right, 2 top, 3 bottom
        var proximity: Double
        var edgeCoord: CGFloat   // the screen edge, in the host layer's coordinates
        var along: CGFloat       // strip centre along the edge, host coordinates
        var halfLen: CGFloat
        var anchor: MetalFxModel
        var facing: CGPoint      // the anchor's point facing the edge, anchor-local
    }

    private static var screenBounds: CGRect {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        return scene?.screen.bounds ?? UIScreen.main.bounds
    }

    private var candidate: Candidate? {
        guard hostFrame.width > 0 else { return nil }
        let screen = Self.screenBounds
        var best: Candidate?
        for (_, a) in store.anchors {
            let f = a.frame
            // Only rings this layer contains (or overlaps) can light its edge.
            guard f.width > 0, f.intersects(hostFrame.insetBy(dx: -8, dy: -8)) else { continue }
            let d: [(Int, CGFloat)] = [
                (0, f.minX - screen.minX), (1, screen.maxX - f.maxX),
                (2, f.minY - screen.minY), (3, screen.maxY - f.maxY),
            ]
            guard let (edge, dist) = d.min(by: { $0.1 < $1.1 }), dist > -f.width else { continue }
            let p = 1 - min(1, max(0, dist / reach))
            let prox = Double(p * p * (3 - 2 * p))
            guard prox > 0.001 else { continue }
            if best == nil || prox > best!.proximity {
                let edgeCoord: CGFloat
                let along: CGFloat
                let facing: CGPoint
                switch edge {
                case 0: edgeCoord = screen.minX - hostFrame.minX; along = f.midY - hostFrame.minY; facing = CGPoint(x: 0, y: f.height / 2)
                case 1: edgeCoord = screen.maxX - hostFrame.minX; along = f.midY - hostFrame.minY; facing = CGPoint(x: f.width, y: f.height / 2)
                case 2: edgeCoord = screen.minY - hostFrame.minY; along = f.midX - hostFrame.minX; facing = CGPoint(x: f.width / 2, y: 0)
                default: edgeCoord = screen.maxY - hostFrame.minY; along = f.midX - hostFrame.minX; facing = CGPoint(x: f.width / 2, y: f.height)
                }
                best = Candidate(edge: edge, proximity: prox, edgeCoord: edgeCoord, along: along,
                                 halfLen: max(f.width, f.height) * 1.6 + 24, anchor: a, facing: facing)
            }
        }
        return best
    }

    func body(content: Content) -> some View {
        let cand = candidate
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: cand == nil)) { ctx in
            // One flat raster: nested shader layers (the rings) would otherwise
            // be run through the effect one by one, each with its own bounds.
            content
                .drawingGroup()
                .layerEffect(shader(cand, now: ctx.date.timeIntervalSinceReferenceDate),
                             maxSampleOffset: CGSize(width: displacement * 1.2, height: displacement * 1.2),
                             isEnabled: cand != nil)
        }
        .background {
            GeometryReader { g in
                Color.clear.onChange(of: g.frame(in: .global), initial: true) { _, f in hostFrame = f }
            }
        }
    }

    private func shader(_ c: Candidate?, now: TimeInterval) -> Shader {
        guard let c else {
            return ShaderLibrary.bundle(.module).mfxEdgeHalo(.float(0), .float(0), .float(0), .float(0), .float(0), .float(0), .float3(0, 0, 0), .float(0), .float(0))
        }
        let a = c.anchor
        // The most saturated colour along the facing edge (the web's
        // `sampleShaderRGBChromatic`): a grey mean would read as white light.
        let t = Float(a.time(now: now))
        var tint = SIMD3<Float>(repeating: 1), best: Float = -1
        for i in 0..<9 {
            let k = CGFloat(i) / 8
            let p = c.edge < 2
                ? CGPoint(x: c.facing.x, y: a.size.height * (0.1 + 0.8 * k))
                : CGPoint(x: a.size.width * (0.1 + 0.8 * k), y: c.facing.y)
            let s = a.material.sample(uv: a.mapping.uv(p), time: t)
            let mx = max(s.x, max(s.y, s.z)), mn = min(s.x, min(s.y, s.z))
            let sat = mx > 0 ? (mx - mn) / mx : 0
            let score = sat * (0.35 + 0.65 * mx)
            if score > best { best = score; tint = s }
        }
        let peak = max(tint.x, max(tint.y, tint.z))
        if peak > 0 { tint = tint / peak }
        tint = tintState.update(tint, now: now)
        let hi = c.proximity * intensity * Double(min(1, a.opacityMul + 0.35))
        return ShaderLibrary.bundle(.module).mfxEdgeHalo(
            .float(Double(c.edge)), .float(Double(c.edgeCoord)), .float(Double(c.along)), .float(Double(c.halfLen)),
            .float(Double(depth + 12 * c.proximity)), .float(hi),
            .float3(Double(tint.x), Double(tint.y), Double(tint.z)),
            .float(MetalClock.seconds(now)), .float(MetalEdgeHaloDebug.enabled ? -1 : Double(displacement))
        )
    }
}
