import SwiftUI

// Automatic reflections: every `MetalFx` inside a `.metalReflections()`
// scope lights the surfaces around it — chips, fields, cards, text — with no
// per-view setup. The scope renders itself once without its metal (an
// `ImageRenderer` pass) to learn where surfaces are, then a single shader
// overlay paints each ring's live material onto the edges facing it, with
// the web reflection's gradient, alphas and lift, following the bend.

// MARK: - Mask pass

private struct MetalMaskPassKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// True while a reflection scope renders its surface mask: metal draws nothing.
    var metalMaskPass: Bool {
        get { self[MetalMaskPassKey.self] }
        set { self[MetalMaskPassKey.self] = newValue }
    }
}

// MARK: - Reflectors

/// A ring that reflects onto its surroundings, reported up the view tree.
struct MetalReflector: Equatable {
    let model: MetalFxModel
    let strength: Double
    static func == (a: MetalReflector, b: MetalReflector) -> Bool { a.model === b.model && a.strength == b.strength }
}

struct MetalReflectorsKey: PreferenceKey {
    static let defaultValue: [MetalReflector] = []
    static func reduce(value: inout [MetalReflector], nextValue: () -> [MetalReflector]) {
        value.append(contentsOf: nextValue())
    }
}

// MARK: - Scope

/// Every metal-fx ring inside reflects onto the surfaces around it
/// automatically — no `.metalReflection(of:)` on each neighbour. Wrap a
/// screen's content (or any container) once:
///
/// ```swift
/// MetalReflectionScope {
///     HStack { TextField(…).background(.gray, in: .capsule); MetalFx { … } }
/// }
/// ```
///
/// Surfaces are found by rendering the content once more, off screen and
/// without its metal: anything that differs from the background counts
/// (platform views like a text field's text render as a placeholder there,
/// which is fine — it sits on a surface anyway). Rebuilt when the scope
/// resizes or rings come and go. A ring opts out with `MetalFx(reflection: 0)`.
public struct MetalReflectionScope<Content: View>: View {
    var strength: Double
    var content: () -> Content

    public init(strength: Double = 1, @ViewBuilder content: @escaping () -> Content) {
        self.strength = strength
        self.content = content
    }

    public var body: some View {
        content().modifier(MetalAutoReflections(strength: strength, surfaces: { AnyView(content()) }))
    }
}

/// Debug switch: draw the surface mask and the ring count over the scope.
public enum MetalReflectionDebug { @MainActor public static var enabled = false }

/// A surface found next to a ring: its frame (scope-local points) and an
/// estimated corner radius, plus which ring lights it.
struct MetalAutoTarget: Equatable {
    let rect: CGRect
    let radius: CGFloat
    let ring: Int
}

struct MetalAutoReflections: ViewModifier {
    let strength: Double
    /// A second copy of the content, rendered off screen for the mask.
    let surfaces: () -> AnyView

    @State private var reflectors: [MetalReflector] = []
    @State private var frame: CGRect = .zero
    @State private var targets: [MetalAutoTarget] = []
    @State private var debugImage: Image?
    @Environment(\.metalMaskPass) private var maskPass
    @Environment(\.displayScale) private var displayScale

    func body(content: Content) -> some View {
        if maskPass {
            content
        } else {
            content
                .onPreferenceChange(MetalReflectorsKey.self) { reflectors = $0 }
                .background {
                    GeometryReader { g in
                        Color.clear.onChange(of: g.frame(in: .global), initial: true) { _, f in frame = f }
                    }
                }
                .task(id: MaskKey(size: frame.size, count: reflectors.count)) {
                    // Let layout settle, then find the surfaces once.
                    try? await Task.sleep(for: .milliseconds(150))
                    findSurfaces()
                }
                .overlay(alignment: .topLeading) {
                    if !targets.isEmpty, frame.width > 0 {
                        // The same reflection `.metalReflection(of:)` draws,
                        // on each surface found next to a ring.
                        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: false)) { ctx in
                            let now = ctx.date.timeIntervalSinceReferenceDate
                            ZStack(alignment: .topLeading) {
                                ForEach(Array(targets.enumerated()), id: \.offset) { _, t in
                                    if t.ring < reflectors.count {
                                        let r = reflectors[t.ring]
                                        MetalReflectionLayer(
                                            anchor: r.model,
                                            target: t.rect.offsetBy(dx: frame.minX, dy: frame.minY),
                                            strength: r.strength * strength, style: .surface,
                                            cornerRadius: t.radius, now: now, displayScale: displayScale
                                        )
                                        .frame(width: t.rect.width, height: t.rect.height)
                                        .offset(x: t.rect.minX, y: t.rect.minY)
                                    }
                                }
                            }
                            .frame(width: frame.width, height: frame.height, alignment: .topLeading)
                        }
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                    }
                }
                .overlay(alignment: .topLeading) {
                    if MetalReflectionDebug.enabled {
                        ZStack(alignment: .topLeading) {
                            if let debugImage { debugImage.resizable().frame(width: frame.width, height: frame.height).colorMultiply(.red).opacity(0.5) }
                            ForEach(Array(targets.enumerated()), id: \.offset) { _, t in
                                RoundedRectangle(cornerRadius: t.radius).stroke(.yellow, lineWidth: 1)
                                    .frame(width: t.rect.width, height: t.rect.height).offset(x: t.rect.minX, y: t.rect.minY)
                            }
                            Text("rings \(reflectors.count) · surfaces \(targets.count)")
                                .font(.caption2.monospaced()).foregroundStyle(.yellow).padding(.top, 140).padding(.leading, 8)
                        }
                        .allowsHitTesting(false)
                    }
                }
        }
    }

    private struct MaskKey: Equatable {
        let size: CGSize
        let count: Int
    }

    /// Render the content without its metal, then flood-fill the surfaces
    /// that start within reach of each ring.
    @MainActor
    private func findSurfaces() {
        let size = frame.size
        guard size.width > 1, size.height > 1, !reflectors.isEmpty else { targets = []; return }
        let scale: CGFloat = 2
        let renderer = ImageRenderer(content: surfaces().environment(\.metalMaskPass, true).frame(width: size.width, height: size.height))
        renderer.scale = scale
        renderer.isOpaque = false
        guard let cg = renderer.cgImage, let mask = SurfaceMask(cg) else { targets = []; return }
        if MetalReflectionDebug.enabled { debugImage = Image(decorative: cg, scale: scale) }

        var found: [MetalAutoTarget] = []
        var claimed = [Bool](repeating: false, count: mask.w * mask.h)
        for (i, r) in reflectors.enumerated() {
            let f = r.model.frame.offsetBy(dx: -frame.minX, dy: -frame.minY)
            guard f.width > 1 else { continue }
            let ring = f.insetBy(dx: -2, dy: -2)
            let c = CGPoint(x: f.midX, y: f.midY)
            let half = max(f.width, f.height) / 2
            // Probe outward from the ring for surfaces within reach.
            for k in 0..<32 {
                let ang = Double(k) / 32 * 2 * .pi
                for gap in [3.0, 7.0, 12.0, 18.0, 26.0, 36.0] {
                    let p = CGPoint(x: c.x + CGFloat(cos(ang)) * (half + gap), y: c.y + CGFloat(sin(ang)) * (half + gap))
                    if ring.contains(p) { continue }
                    let px = Int(p.x * scale), py = Int(p.y * scale)
                    guard mask.inBounds(px, py), mask.isSurface(px, py), !claimed[py * mask.w + px] else { continue }
                    guard let box = mask.fill(from: px, py, claimed: &claimed) else { continue }
                    let rect = CGRect(x: CGFloat(box.minX) / scale, y: CGFloat(box.minY) / scale,
                                      width: CGFloat(box.width) / scale, height: CGFloat(box.height) / scale)
                    // Not the ring's own content, not a card around it, not the whole page.
                    if rect.intersects(f) || rect.width * rect.height > size.width * size.height * 0.5 { continue }
                    found.append(MetalAutoTarget(rect: rect, radius: mask.cornerRadius(box) / scale, ring: i))
                    break
                }
            }
        }
        targets = found
    }
}

/// The off-screen render as a pixel grid: what counts as a surface, flood
/// fill, and a corner-radius estimate.
private struct SurfaceMask {
    let w: Int, h: Int
    let px: [UInt8]
    let page: (Int, Int, Int, Int)

    init?(_ cg: CGImage) {
        w = cg.width; h = cg.height
        var buf = [UInt8](repeating: 0, count: w * h * 4)
        guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        px = buf
        let i = (3 * w + 3) * 4
        page = (Int(buf[i]), Int(buf[i + 1]), Int(buf[i + 2]), Int(buf[i + 3]))
    }

    func inBounds(_ x: Int, _ y: Int) -> Bool { x >= 1 && y >= 1 && x < w - 1 && y < h - 1 }

    /// Differs from the page colour (premultiplied bytes).
    func isSurface(_ x: Int, _ y: Int) -> Bool {
        let i = (y * w + x) * 4
        let d = max(abs(Int(px[i]) - page.0), abs(Int(px[i + 1]) - page.1), abs(Int(px[i + 2]) - page.2))
        return d > 6 || abs(Int(px[i + 3]) - page.3) > 38
    }

    /// 4-connected fill over surface pixels; the bounding box, or nil if it runs away.
    func fill(from x0: Int, _ y0: Int, claimed: inout [Bool]) -> (minX: Int, minY: Int, width: Int, height: Int)? {
        var stack = [(x0, y0)]
        claimed[y0 * w + x0] = true
        var minX = x0, maxX = x0, minY = y0, maxY = y0, n = 0
        while let (x, y) = stack.popLast() {
            n += 1
            if n > 600_000 { return nil }
            minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
            for (nx, ny) in [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)] where inBounds(nx, ny) {
                let j = ny * w + nx
                if !claimed[j] && isSurface(nx, ny) { claimed[j] = true; stack.append((nx, ny)) }
            }
        }
        return (minX, minY, maxX - minX + 1, maxY - minY + 1)
    }

    /// From the box's top-left corner, how far along the diagonal the surface
    /// starts: a quarter circle of radius r leaves r·(1 − 1/√2) empty.
    func cornerRadius(_ b: (minX: Int, minY: Int, width: Int, height: Int)) -> CGFloat {
        let maxR = min(b.width, b.height) / 2
        var d = 0
        while d < maxR, inBounds(b.minX + d, b.minY + d), !isSurface(b.minX + d, b.minY + d) { d += 1 }
        return min(CGFloat(maxR), CGFloat(d) / (1 - 1 / 2.0.squareRoot()))
    }
}
