// The luminous painter — port of src/engine/light.ts. A frame's strokes
// drawn as coloured light: one conic gradient carries the spectrum around
// the orb; bloom is stacked wide, faint strokes, added on dark substrates
// (plusLighter) so overlaps run hot toward white; a chromatic fringe either
// side of each ring; a white specular hot spot.

import SwiftUI

private let fringeOut = RGB(120, 232, 214)
private let fringeIn = RGB(64, 72, 255)

private func toHsl(_ c: RGB) -> (Double, Double, Double) {
    let r = c.r / 255, g = c.g / 255, b = c.b / 255
    let mx = max(r, g, b), mn = min(r, g, b)
    let l = (mx + mn) / 2
    guard mx != mn else { return (0, 0, l) }
    let d = mx - mn
    let s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    let h: Double
    if mx == r { h = (g - b) / d + (g < b ? 6 : 0) } else if mx == g { h = (b - r) / d + 2 } else { h = (r - g) / d + 4 }
    return (h / 6, s, l)
}

private func fromHsl(_ h: Double, _ s: Double, _ l: Double) -> RGB {
    func k(_ n: Double) -> Double { (n + h * 12).truncatingRemainder(dividingBy: 12) }
    let a = s * min(l, 1 - l)
    func f(_ n: Double) -> Double { l - a * max(-1, min(k(n) - 3, 9 - k(n), 1)) }
    return RGB(f(0) * 255, f(8) * 255, f(4) * 255)
}

// OKLab, where a straight line between two colours looks like an even blend
private func lin(_ c: Double) -> Double {
    let v = c / 255
    return v <= 0.04045 ? v / 12.92 : pow((v + 0.055) / 1.055, 2.4)
}

private func gam(_ c: Double) -> Double {
    255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * pow(max(0, c), 1 / 2.4) - 0.055)
}

private func toLab(_ c: RGB) -> SIMD3<Double> {
    let r = lin(c.r), g = lin(c.g), b = lin(c.b)
    let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    return SIMD3(
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
    )
}

private func fromLab(_ v: SIMD3<Double>) -> RGB {
    let l = pow(v.x + 0.3963377774 * v.y + 0.2158037573 * v.z, 3)
    let m = pow(v.x - 0.1055613458 * v.y - 0.0638541728 * v.z, 3)
    let s = pow(v.x - 0.0894841775 * v.y - 1.291485548 * v.z, 3)
    func c(_ x: Double) -> Double { max(0, min(255, gam(x))) }
    return RGB(
        c(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        c(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        c(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
    )
}

/// The spectrum after the emotion and the theme have had their say, as on
/// the web: an emotion recolours it as a gradient of its own hue's
/// neighbours, blended in evenly from each stop's own colour.
private func palette(_ stops: [FrameLight.Stop], dark: Bool, glow: (color: RGB, amount: Double)?) -> [Gradient.Stop] {
    stops.map { s in
        var c = RGB(s.r, s.g, s.b)
        if let glow, glow.amount > 0.005 {
            // green teal to lime, red magenta to orange, blue cyan to violet —
            // swinging ±36° round the ring so it closes seamlessly; each stop
            // takes its new hue at its own saturation and lightness
            let (_, sat, l) = toHsl(c)
            let (eh, _, _) = toHsl(glow.color)
            let to = fromHsl((eh + 0.1 * sin(2 * .pi * s.offset) + 1).truncatingRemainder(dividingBy: 1), sat, l)
            // an even blend, not a turn of the hue: turning a whole spectrum
            // to one hue tears the ring where neighbours turn opposite ways
            let a = toLab(c)
            c = fromLab(a + (toLab(to) - a) * glow.amount)
        }
        let d = dark ? 1.0 : 0.82
        return Gradient.Stop(color: Color(.sRGB, red: c.r * d / 255, green: c.g * d / 255, blue: c.b * d / 255), location: s.offset)
    }
}

func paintLight(_ context: inout GraphicsContext, _ frame: OrbFrame, _ L: FrameLight, dark: Bool, glow: (color: RGB, amount: Double)?) {
    let spectrum = GraphicsContext.Shading.conicGradient(
        Gradient(stops: palette(L.stops, dark: dark, glow: glow)),
        center: CGPoint(x: L.cx, y: L.cy),
        angle: .radians(L.angle)
    )
    // one path per ring, lit at its mean depth (per-segment opacity would
    // seam where the wide additive strokes overlap)
    let rings: [(path: Path, a: Double, w: Double)] = frame.strokes.map { s in
        var p = Path()
        let n = s.pts.count / 2
        for i in 0..<n {
            let pt = CGPoint(x: s.pts[2 * i], y: s.pts[2 * i + 1])
            if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
        }
        if s.closed { p.closeSubpath() }
        let a = s.a.isEmpty ? 1 : s.a.reduce(0, +) / Double(s.a.count)
        return (p, a, s.w)
    }
    let n = Double(max(1, rings.count))
    let I = L.intensity
    var ctx = context
    ctx.blendMode = dark ? .plusLighter : .normal

    func pass(_ shading: GraphicsContext.Shading, in base: GraphicsContext, width: (Double) -> Double, alpha: (Double) -> Double) {
        for r in rings {
            var c = base
            c.opacity = clamp01(alpha(r.a))
            c.stroke(r.path, with: shading, style: StrokeStyle(lineWidth: width(r.w), lineCap: .round, lineJoin: .round))
        }
    }

    // 1 · halo: very wide, very faint, shared out between the rings
    let haloK = L.halo * I * (dark ? 1 : 0.2) / n
    for (wk, ak) in [(0.7, 0.045), (0.42, 0.075), (0.24, 0.11), (0.12, 0.16)] {
        pass(spectrum, in: ctx, width: { _ in L.r * wk }, alpha: { _ in ak * haloK })
    }
    // 2 · bloom: three soft passes that sum into one luminous band
    let bloomK = I * (dark ? 1 : 0.6)
    for (wk, ak) in [(16.0, 0.05), (8.0, 0.11), (4.0, 0.2)] {
        pass(spectrum, in: ctx, width: { $0 * wk }, alpha: { ak * bloomK * $0 })
    }
    // 3 · chromatic fringes, scaled about the centre (dark substrates only)
    if dark, L.fringe > 0 {
        for (scale, rgb, ak) in [(1 + L.fringe, fringeOut, 0.16), (1 - L.fringe, fringeIn, 0.22)] {
            var c = ctx
            c.translateBy(x: L.cx, y: L.cy)
            c.scaleBy(x: scale, y: scale)
            c.translateBy(x: -L.cx, y: -L.cy)
            let color = GraphicsContext.Shading.color(Color(.sRGB, red: rgb.r / 255, green: rgb.g / 255, blue: rgb.b / 255))
            pass(color, in: c, width: { $0 * 1.4 / scale }, alpha: { ak * I * $0 })
        }
    }
    // 4 · the crisp core of every ring
    pass(spectrum, in: ctx, width: { $0 }, alpha: { 0.7 * $0 * (0.75 + 0.25 * I) })
    // 5 · specular hot spots
    if dark {
        for s in L.spec {
            let shading = GraphicsContext.Shading.radialGradient(
                Gradient(stops: [
                    .init(color: .white, location: 0),
                    .init(color: .white.opacity(0.45), location: 0.35),
                    .init(color: .white.opacity(0), location: 1),
                ]),
                center: CGPoint(x: s.x, y: s.y),
                startRadius: 0,
                endRadius: s.r
            )
            pass(shading, in: ctx, width: { $0 * 2.2 }, alpha: { s.a * $0 })
        }
    }
}

/// The lens that refracts an orb into the screen's edge where it presses
/// on it — `side` (−1 left, 1 right) at `x`, through `L` — as the filter for
/// its layer; the shader is Refract.metal, a port of src/engine/refract.ts.
func refraction(side: Double, x: Double, lens L: OrbLens) -> GraphicsContext.Filter {
    let shader = ShaderLibrary.bundle(.module).voiceRefract(
        .float(x), .float(side), .float(max(1, L.zone)), .float(L.gap), .float(L.flare),
        .float(L.split), .float(L.blur), .float(L.cy)
    )
    // the furthest a pixel reads from where it lands
    let reach = CGSize(
        width: L.gap + L.split + 2 * L.blur + 2,
        height: 1.6 * L.zone * L.flare / (1 + L.flare) + L.split + L.blur + 2
    )
    return .layerShader(shader, maxSampleOffset: reach)
}
