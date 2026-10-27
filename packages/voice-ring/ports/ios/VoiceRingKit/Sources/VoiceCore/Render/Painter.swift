// The SwiftUI painter: draws a finished frame into a Canvas. Ink frames
// (dots, depth-faded strokes) are batched by quantised colour — one path
// per batch, as the web painter does — so a 900-dot orb is a few dozen
// fills, not 900. Luminous frames go to `paintLight`.

import SwiftUI

/// Everything the painter needs besides the frame.
public struct PaintStyle {
    public var dark: Bool
    /// Colourful mode (ink types); nil or zero saturation draws monochrome.
    public var colors: OrbColors?
    /// The emotion as a glow (luminous types shift their spectrum toward it).
    public var glow: (color: RGB, amount: Double)?

    public init(dark: Bool, colors: OrbColors? = nil, glow: (color: RGB, amount: Double)? = nil) {
        self.dark = dark
        self.colors = colors
        self.glow = glow
    }
}

/// One ink value to a colour: grey, or the accent on the same depth ramp.
func inkColor(_ w: Double, _ alpha: Double, dark: Bool, hue: RGB? = nil, mix: Double = 0) -> Color {
    let w = clamp01(w)
    let g = (dark ? 1 - w : w) * 255
    var r = g, gr = g, b = g
    if let hue, mix > 0 {
        func ramp(_ c: Double) -> Double { dark ? c * (1 - w) : c + (255 - c) * w }
        r += (ramp(hue.r) - r) * mix
        gr += (ramp(hue.g) - gr) * mix
        b += (ramp(hue.b) - b) * mix
    }
    return Color(.sRGB, red: r / 255, green: gr / 255, blue: b / 255, opacity: clamp01(alpha))
}

private struct InkKey: Hashable {
    let q: Int, white: Int, width: Int, ci: Int
}

/// Paint `frame` into `context`.
public func paintFrame(_ context: inout GraphicsContext, _ frame: OrbFrame, style: PaintStyle) {
    // refracted into the edge where the orb presses on it
    if let c = frame.contact, let lens = c.lens {
        var glass = context
        glass.addFilter(refraction(side: c.side, x: c.x, lens: lens))
        glass.drawLayer { layer in paintMarks(&layer, frame, style: style) }
    } else {
        paintMarks(&context, frame, style: style)
    }
}

private func paintMarks(_ context: inout GraphicsContext, _ frame: OrbFrame, style: PaintStyle) {
    if let light = frame.light {
        paintLight(&context, frame, light, dark: style.dark, glow: style.glow)
    } else {
        let ramp = style.colors.flatMap { $0.saturation > 0 ? ColorRamp($0) : nil }
        paintStrokes(&context, frame.strokes, dark: style.dark, ramp: ramp)
        paintDots(&context, frame.dots, dark: style.dark, ramp: ramp, square: frame.square)
    }
}

private func paintStrokes(_ context: inout GraphicsContext, _ strokes: [Stroke], dark: Bool, ramp: ColorRamp?) {
    let alphaSteps = 24.0
    var paths: [InkKey: Path] = [:]
    var order: [InkKey] = []
    for s in strokes {
        let n = s.pts.count / 2
        guard n > 1 else { continue }
        let segs = s.closed ? n : n - 1
        var key: InkKey?
        for i in 0..<segs {
            let j = i + 1 == n ? 0 : i + 1
            let q = Int((clamp01((s.a[i] + s.a[j]) / 2) * alphaSteps).rounded())
            if q == 0 {
                key = nil
                continue
            }
            let ci = ramp?.at((s.pts[2 * i] + s.pts[2 * j]) / 2, (s.pts[2 * i + 1] + s.pts[2 * j + 1]) / 2) ?? 0
            let k = InkKey(q: q, white: Int((s.white * 20).rounded()), width: Int((s.w * 20).rounded()), ci: ci)
            if paths[k] == nil {
                paths[k] = Path()
                order.append(k)
            }
            if k != key {
                paths[k]!.move(to: CGPoint(x: s.pts[2 * i], y: s.pts[2 * i + 1]))
                key = k
            }
            paths[k]!.addLine(to: CGPoint(x: s.pts[2 * j], y: s.pts[2 * j + 1]))
        }
    }
    for k in order {
        guard let path = paths[k] else { continue }
        let color = inkColor(Double(k.white) / 20, Double(k.q) / alphaSteps, dark: dark, hue: ramp?.rgb, mix: ramp?.mix[k.ci] ?? 0)
        context.stroke(path, with: .color(color), style: StrokeStyle(lineWidth: Double(k.width) / 20, lineCap: .round, lineJoin: .round))
    }
}

private func paintDots(_ context: inout GraphicsContext, _ dots: [Dot], dark: Bool, ramp: ColorRamp?, square: Bool) {
    // Batched by quantised ink, opacity and colour step, each batch drawn
    // where its first (farthest) dot falls in the z order.
    var paths: [InkKey: Path] = [:]
    var order: [InkKey] = []
    for d in dots {
        let ci = ramp?.at(d.x, d.y) ?? 0
        let k = InkKey(q: Int((clamp01(d.a) * 32).rounded()), white: Int((clamp01(d.white) * 48).rounded()), width: 0, ci: ci)
        if paths[k] == nil {
            paths[k] = Path()
            order.append(k)
        }
        let box = CGRect(x: d.x - d.r, y: d.y - d.r, width: d.r * 2, height: d.r * 2)
        if square { paths[k]!.addRect(box) } else { paths[k]!.addEllipse(in: box) }
    }
    for k in order {
        guard let path = paths[k] else { continue }
        let color = inkColor(Double(k.white) / 48, Double(k.q) / 32, dark: dark, hue: ramp?.rgb, mix: ramp?.mix[k.ci] ?? 0)
        context.fill(path, with: .color(color))
    }
}
