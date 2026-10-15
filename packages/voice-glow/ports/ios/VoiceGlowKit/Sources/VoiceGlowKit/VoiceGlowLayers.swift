import SwiftUI

/// The glow's layers for one frame, bottom to top as the web stacks them:
/// inner light (z1), edge stroke (z2), blurred bloom (z3), the band and its
/// halo (z4), and — light theme — the white epicentre wash over the band's
/// halo.
struct VoiceGlowLayers: View {
    let frame: VoiceGlowFrame
    let config: VoiceGlowConfig
    let size: CGSize

    var body: some View {
        let c = config
        let g = c.g
        let f = frame
        let theme = c.theme
        let mono = c.colorVariant == .mono ? 0.6 : 1
        let base = f.presence * f.glow * c.strength
        let fade = max(40, min(95, (70 * g.softness).rounded())) / 100
        let bloomFade = min(95, fade * 100 + 2) / 100

        ZStack {
            layer(
                kind: 1,
                lobes: lobes(alpha: 0.46, sw: g.glowWidth * 0.9 * g.innerScale, sh: g.glowHeight * 0.9 * g.innerScale * g.innerHeight, y: 0),
                highlight: [],
                mask: edgeMask(170, 64, mid: 0.45, tail: 0.3),
                fade: fade,
                opacity: min(1, base * theme.innerOpacity * mono * g.innerOpacity)
            )
            layer(
                kind: 0,
                lobes: lobes(alpha: 1, sw: g.glowWidth * g.strokeScale, sh: g.glowHeight * g.strokeScale, y: 2),
                highlight: highlight,
                mask: edgeMask(170, 64, mid: 0.45, tail: -1),
                fade: fade,
                opacity: min(1, base * theme.strokeOpacity * mono * g.strokeOpacity)
            )
            // CSS blurs the bloom's gradients first and masks after.
            layer(
                kind: 2,
                lobes: lobes(alpha: c.dark ? 0.9 : 0.7, sw: g.glowWidth * 1.15 * g.bloomScale, sh: g.glowHeight * 1.5 * g.bloomScale * g.bloomHeight, y: 0),
                highlight: [],
                mask: [],
                fade: bloomFade,
                opacity: 1
            )
            .blur(radius: max(0.5, 10 * g.glowSize))
            .mask {
                layer(kind: 3, lobes: [], highlight: [], mask: edgeMask(200, 130, mid: 0.35, tail: -1), fade: 1, opacity: 1)
            }
            .opacity(min(1, base * theme.bloomOpacity * mono * g.bloomOpacity))

            VoiceGlowBand(frame: f, config: c, size: size)
                .opacity(f.presence * c.strength)
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: c.cornerRadius, style: .continuous))
    }

    // MARK: - Layer inputs

    private var beamX: Double { Double(size.width) / 2 + frame.cx * frame.w }

    /// Each lobe as [cx, cy, rx, ry, r, g, b, a].
    private func lobes(alpha: Double, sw: Double, sh: Double, y: Double) -> [Float] {
        let W = Double(size.width), H = Double(size.height)
        var out: [Float] = []
        out.reserveCapacity(VoiceGlowStyle.lobes.count * 8)
        for (i, lobe) in VoiceGlowStyle.lobes.enumerated() {
            let rx = (lobe.w * sw).rounded() * frame.w
            let ry = (lobe.h * sh).rounded() * frame.h * frame.lobeL[i]
            let cx = W / 2 + (frame.cx + frame.lobeX[i]) * frame.w
            let cy = H + y + frame.lobeY[i]
            let col = frame.colors[i]
            out += [Float(cx), Float(cy), Float(rx), Float(ry), col.x, col.y, col.z, Float(alpha)]
        }
        return out
    }

    /// The ellipse every layer is masked to: on the beam, growing with the
    /// level, humped by the bend, narrowed into a beam while gathered.
    private func edgeMask(_ w: Double, _ h: Double, mid: Double, tail: Double) -> [Float] {
        let g = config.g
        let rx = w * g.rangeWidth * frame.w * frame.maskWidth
        let ry = h * g.rangeHeight * frame.h + frame.lift
        return [Float(beamX), Float(Double(size.height) + frame.cy), Float(rx), Float(ry), Float(mid), Float(tail)]
    }

    /// The hot core at the centre of the edge: white on dark, ink on light.
    private var highlight: [Float] {
        let g = config.g
        let H = Double(size.height)
        let dark = config.dark
        let rx = (dark ? 30 : 40) * g.coreSize * frame.w
        let ry = 30 * g.coreSize * frame.h
        let col = VoiceColorMatrix.apply(frame.colorMatrix, dark ? VoiceGlowColor(255, 255, 255) : VoiceGlowColor(0, 0, 0))
        return dark
            ? [Float(beamX), Float(H + 2 + frame.cy), Float(rx), Float(ry), col.x, col.y, col.z, 0.45, 0.30, 0.14, 0.65]
            : [Float(beamX), Float(H + 2 + frame.cy), Float(rx), Float(ry), col.x, col.y, col.z, 0.55, 0.35, 0.22, 0.70]
    }

    private func layer(kind: Int, lobes: [Float], highlight: [Float], mask: [Float], fade: Double, opacity: Double) -> some View {
        let c = config
        let shadow = c.theme.innerShadow
        let shadowColor = VoiceColorMatrix.apply(frame.colorMatrix, shadow.0)
        let params: [Float] = [
            Float(kind), Float(c.cornerRadius), Float(VoiceGlowStyle.borderWidth), Float(fade),
            Float(28 * c.g.scale), Float(9 * c.g.scale),
            shadowColor.x, shadowColor.y, shadowColor.z, Float(shadow.1),
            Float(opacity),
        ]
        let shader = ShaderLibrary.bundle(.module).voiceGlowLayer(
            .float2(size),
            .floatArray(lobes.isEmpty ? [0] : lobes),
            .floatArray(highlight.isEmpty ? [0] : highlight),
            .floatArray(mask.isEmpty ? [0] : mask),
            .floatArray(params)
        )
        return Rectangle().fill(Color.white).colorEffect(shader)
    }
}

// MARK: - Band

/// The band: an organic bell along the glow's ceiling, traced by a core light
/// with a red fringe above and a blue one below that split further and
/// thicken with the voice — a port of `bandPoints` / `drawBand`.
struct VoiceGlowBand: View {
    let frame: VoiceGlowFrame
    let config: VoiceGlowConfig
    let size: CGSize

    private static let samples = 56

    var body: some View {
        Canvas { ctx, canvasSize in
            let pts = points(cw: Double(canvasSize.width), ch: Double(canvasSize.height))
            drawBand(&ctx, pts)
            drawCoreWash(&ctx, pts, ch: Double(canvasSize.height))
        }
        .frame(width: size.width, height: size.height)
    }

    // MARK: Line

    private func points(cw: Double, ch: Double) -> [CGPoint] {
        let g = config.g
        let f = frame
        let centre = cw / 2 + f.cx * f.w
        let half = VoiceGlowStyle.ceilingHalfWidth * g.rangeWidth * f.w * f.maskWidth
        let apexCap = ch * 0.82 * min(1, g.scale)
        let apex = min(apexCap, (VoiceGlowStyle.ceilingHeight * g.rangeHeight * f.h + f.lift) * g.bandPosition)
        let base = ch - g.bandOffset
        let tailT = min(1, f.morph * 4)
        let tail = g.bandTail * (1 - tailT * tailT * (3 - 2 * tailT))
        let withTail = tail > 0.001
        let over = withTail ? g.bandTailOverflow : 0
        let x0 = withTail ? -over : centre - half
        let x1 = withTail ? cw + over : centre + half
        let radius = VoiceGlowEngine.paintedRadius(config.cornerRadius, cw, ch)
        return (0...Self.samples).map { i in
            let x = x0 + (x1 - x0) * Double(i) / Double(Self.samples)
            let t = max(-1, min(1, (x - centre) / max(1, half)))
            let edge = (x < centre ? centre : cw - centre) + over
            let y = Self.bell(t, g.bandCurve, g.bandSpread, g.bandSkew)
                + Self.tailLift(abs(x - centre), edge, tail, g.bandTailPosition, g.bandTailCurve)
            let arc = f.morph > 0 ? VoiceGlowEngine.cornerLift(x, cw, radius) * f.morph : 0
            return CGPoint(x: x, y: base - apex * y - arc)
        }
    }

    /// exp(-(|t| / σ)^p), 1 at the centre and exactly 0 at the ends.
    static func bell(_ t: Double, _ p: Double, _ sigma: Double, _ skew: Double) -> Double {
        let side = t < 0 ? 1 - skew : 1 + skew
        let s = max(0.05, sigma * side)
        let v = exp(-pow(abs(t) / s, p))
        let tail = exp(-pow(1 / s, p))
        return max(0, (v - tail) / (1 - tail))
    }

    /// The ends rise again toward the corners.
    static func tailLift(_ dist: Double, _ edge: Double, _ lift: Double, _ position: Double, _ curve: Double) -> Double {
        if lift <= 0 || edge <= 0 { return 0 }
        let start = edge * max(0, min(0.98, position))
        if dist <= start { return 0 }
        let u = min(1, (dist - start) / max(1, edge - start))
        return lift * pow(u, max(0.5, curve))
    }

    // MARK: Drawing

    private func drawBand(_ ctx: inout GraphicsContext, _ pts: [CGPoint]) {
        let g = config.g
        let f = frame
        let alpha = min(1, 0.6 * g.bandStrength * f.bendA)
        guard alpha >= 0.005, g.bandWidth > 0, let first = pts.first, let last = pts.last else { return }

        let colors = VoiceGlowStyle.bandColors(config.dark)
        func rgb(_ c: VoiceGlowColor) -> SIMD3<Float> { VoiceColorMatrix.apply(f.colorMatrix, c) }
        // A confident mood tints the fringes (not the white core), so the
        // band reads in the mood's colour along with the glow.
        func fringe(_ c: VoiceGlowColor, _ i: Int) -> SIMD3<Float> {
            guard f.moodAmount > 0.001, i < f.moodColors.count else { return rgb(c) }
            return rgb(OKLab(c).mixed(with: OKLab(f.moodColors[i]), 0.75 * f.moodAmount).color)
        }
        let bw = g.bandWidth * (1 + 0.35 * f.level)
        let split = g.bandAberration * (0.35 + 0.65 * f.level)
        let dy = (4 + 12 * split) * g.scale
        let dx = 4 * split * g.scale
        let base = (config.dark ? 0.42 : 0.4) * alpha
        let thickness = 14 * bw
        let blur = 3.5 * g.bandWidth / 2
        let fadeStop = g.bandTail > 0 ? 0.015 : 0.18

        func path(_ ox: Double, _ oy: Double) -> Path {
            var p = Path()
            p.move(to: CGPoint(x: first.x + ox, y: first.y + oy))
            for pt in pts.dropFirst() { p.addLine(to: CGPoint(x: pt.x + ox, y: pt.y + oy)) }
            return p
        }
        func shading(_ c: SIMD3<Float>, _ a: Double) -> GraphicsContext.Shading {
            let col = Color(.sRGB, red: Double(c.x), green: Double(c.y), blue: Double(c.z), opacity: a)
            let clear = col.opacity(0)
            return .linearGradient(
                Gradient(stops: [
                    .init(color: clear, location: 0),
                    .init(color: col, location: fadeStop),
                    .init(color: col, location: 1 - fadeStop),
                    .init(color: clear, location: 1),
                ]),
                startPoint: CGPoint(x: first.x, y: 0), endPoint: CGPoint(x: last.x, y: 0)
            )
        }

        // Halo: wide and hazy, three times the ridge's blur.
        ctx.drawLayer { layer in
            layer.addFilter(.blur(radius: blur * 3))
            layer.stroke(path(0, 0), with: shading(rgb(colors.core), base * 0.3),
                         style: StrokeStyle(lineWidth: thickness * 2.2, lineCap: .round, lineJoin: .round))
        }

        // The ridge: stacked strokes of shrinking width — a linear ramp across
        // its thickness — red riding above, blue below, a faint green between.
        let ramp: [(Double, Double)] = [(1, 0.16), (0.72, 0.2), (0.46, 0.26), (0.22, 0.34)]
        let ridges: [(SIMD3<Float>, Double, Double, Double)] = [
            (fringe(colors.above, 1), 1, dx, -dy),
            (fringe(colors.mid, 0), 0.55, dx * 0.35, -dy * 0.35),
            (fringe(colors.below, 2), 1, -dx, dy),
            (rgb(colors.core), 0.9, 0, 0),
        ]
        ctx.drawLayer { layer in
            layer.addFilter(.blur(radius: blur))
            for (col, a, ox, oy) in ridges {
                let p = path(ox, oy)
                for (wm, am) in ramp {
                    layer.stroke(p, with: shading(col, base * a * am),
                                 style: StrokeStyle(lineWidth: max(0.6, thickness * wm), lineCap: .round, lineJoin: .round))
                }
            }
        }
    }

    /// The epicentre (light theme): a soft white wash at the source, under
    /// the band line, so the centre reads lighter than the band.
    private func drawCoreWash(_ ctx: inout GraphicsContext, _ pts: [CGPoint], ch: Double) {
        let g = config.g
        let f = frame
        let coreLight = max(0, min(3, g.coreLight))
        guard coreLight > 0, let first = pts.first, let last = pts.last else { return }
        let boost = max(0, min(2, coreLight - 1))
        let b1 = min(1, boost), b2 = max(0, boost - 1)
        let grow = 1 + 0.3 * boost
        let solid = (45 * b1 + 27 * b2) / 100
        let midStop = (40 + 25 * b1 + 15 * b2) / 100
        let midAlpha = min(1, 0.55 + 0.35 * b1 + 0.1 * b2)
        let endStop = (72 + 14 * b1 + 8 * b2) / 100
        let opacity = f.presence * min(1, f.glow * min(1, coreLight) * (1.6 + 1.4 * boost))
        guard opacity > 0.005 else { return }

        let cx = Double(size.width) / 2 + f.cx * f.w
        let cy = ch + f.cy
        let rx = 120 * g.coreLightWidth * grow * g.scale * f.w
        let ry = 70 * g.coreLightHeight * grow * g.scale * f.h + f.lift
        guard rx > 0, ry > 0 else { return }

        var below = Path()
        below.move(to: CGPoint(x: first.x, y: ch + 40))
        for pt in pts { below.addLine(to: pt) }
        below.addLine(to: CGPoint(x: last.x, y: ch + 40))
        below.closeSubpath()

        ctx.drawLayer { layer in
            layer.opacity = opacity
            layer.addFilter(.blur(radius: max(0.5, 8 * g.glowSize)))
            layer.clip(to: below)
            layer.translateBy(x: cx, y: cy)
            layer.scaleBy(x: 1, y: ry / rx)
            let white = Color.white
            layer.fill(
                Path(ellipseIn: CGRect(x: -rx, y: -rx, width: 2 * rx, height: 2 * rx)),
                with: .radialGradient(
                    Gradient(stops: [
                        .init(color: white, location: 0),
                        .init(color: white, location: solid),
                        .init(color: white.opacity(midAlpha), location: midStop),
                        .init(color: white.opacity(0), location: endStop),
                    ]),
                    center: .zero, startRadius: 0, endRadius: rx
                )
            )
        }
    }
}
