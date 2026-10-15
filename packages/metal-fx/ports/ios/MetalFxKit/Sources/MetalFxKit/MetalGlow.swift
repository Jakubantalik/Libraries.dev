import SwiftUI
import CoreGraphics

/// The wandering halo: a luminance-driven glint that tracks the brightest
/// point on the ring (or inside the glyphs), with dwell, fade-out / fade-in
/// relocation and a slow wander. Same numbers as the web's `GLOW` config.
public struct MetalGlowConfig: Equatable, Sendable {
    public var haloOpMul: Double = 2.0
    public var extraIntensity: Double = 3.51
    public var peakOp: Double = 0.85
    public var baseOp: Double = 0.34
    public var inset: Double = 1.5
    public var extraOutward: Double = 1.0
    public var wanderRange: Double = 15
    public var wanderLerp: Double = 0.0075
    public var fadeRate: Double = 0.00875
    public var lumLo: Double = 0.08
    public var lumHi: Double = 0.32
    public var minDwellMs: Double = 1500
    public var relocFadeMs: Double = 300
    public var relocFadeOutMs: Double = 450
    public var pointGain: Double = 2.5
    public var haloHalfLen: Double = 7.8
    public var extraHalfLen: Double = 9.13952 / 3
    public var haloStrokeXl: Double = 26.4, haloStrokeLg: Double = 15.6, haloStrokeMd: Double = 7.2, haloStrokeSm: Double = 3.0
    public var haloBlurXl: Double = 8.4, haloBlurLg: Double = 4.8, haloBlurMd: Double = 2.1, haloBlurSm: Double = 0.9
    public var haloOpXl: Double = 0.385, haloOpLg: Double = 0.595, haloOpMd: Double = 0.70, haloOpSm: Double = 0.70
    public var extraStrokeOuter: Double = 4.0 / 3, extraStrokeCore: Double = 2.0 / 3
    public var extraBlurOuter: Double = 2.0 / 3, extraBlurCore: Double = 1.35 / 3
    public var extraFadeR: Double = 13.0 / 3
    public var extraOpOuter: Double = 0.85

    public init() {}
    public static let `default` = MetalGlowConfig()
}

struct MetalGlowFrame {
    var position: CGPoint
    var extraPosition: CGPoint
    var tangent: CGFloat
    var haloOpacity: Double
    var extraOpacity: Double
    var envelope: Double
    var tint: SIMD3<Float>
}

/// A luminance / colour probe at a box-local point, for the current frame.
struct MetalGlowSampler {
    var luminance: (CGPoint) -> Float
    var rgb: (CGPoint) -> SIMD3<Float>
}

private struct Tween {
    var from: Double, to: Double, duration: Double, startedAt: Double
    var value: Double
    var done: Bool { value == to }
    init(from: Double, to: Double, duration: Double, startedAt: Double) {
        self.from = from; self.to = to; self.duration = duration; self.startedAt = startedAt; self.value = from
    }
    mutating func tick(_ clock: Double) -> Double {
        let t = min(1, max(0, (clock - startedAt) / max(1, duration)))
        let e = t * t * (3 - 2 * t)
        value = t >= 1 ? to : from + (to - from) * e
        return value
    }
}

final class MetalGlowState {
    private static let relocateDelta = 0.05
    private static let wanderRetargetMs = 120.0 * (1000.0 / 15.0)
    private static let rateTickMs = 1000.0 / 15.0
    private static let huntIntervalMs = 66.0
    private static let tintHoldMs = 2000.0, tintFadeMs = 400.0
    private static let envMaxStepMs = 34.0

    struct Perim { var point: CGPoint; var arc: CGFloat }

    private(set) var perim: [Perim] = []
    private var pointMode = false
    private var size = CGSize.zero
    private var radius: CGFloat = 0
    private var kind: MetalShapeKind = .pill

    private var currentIdx = 0
    private var glowOpacity = 0.0
    private var appearedAt = 0.0
    private var relocNextIdx = 0
    private var relocTween: Tween?
    private var relocMul = 0.0
    private var envClock = 0.0
    private var lastTickMs = 0.0
    private var lastHuntMs = 0.0
    private var lumCache: [Float] = []
    private var wanderS = 0.0, wanderTargetS = 0.0, wanderMs = 0.0
    private var tintFrom = SIMD3<Float>(repeating: 1), tintTarget = SIMD3<Float>(repeating: 1)
    private var tintTween: Tween?
    private var tintHoldUntil = 0.0

    /// Rebuild the perimeter table when the box or the mask changes.
    func configure(size: CGSize, radius: CGFloat, kind: MetalShapeKind, cfg: MetalGlowConfig, samplePoints: [CGPoint]? = nil) {
        if size == self.size && radius == self.radius && kind == self.kind && (samplePoints == nil) == !pointMode && !perim.isEmpty { return }
        self.size = size; self.radius = radius; self.kind = kind
        if let pts = samplePoints {
            pointMode = true
            perim = pts.map { Perim(point: $0, arc: 0) }
        } else {
            pointMode = false
            let n = 16
            let total = MetalGeometry.shapePerim(size.width, size.height, radius, kind)
            perim = (0..<n).map { i in
                let s = total * CGFloat(i) / CGFloat(n)
                return Perim(point: MetalGeometry.sampleAtArc(s, size.width, size.height, radius, inset: cfg.inset, outward: 0, kind), arc: s)
            }
        }
        lumCache = Array(repeating: 0, count: perim.count)
        if currentIdx >= perim.count { currentIdx = 0 }
    }

    func tick(nowMs: Double, sampler: MetalGlowSampler, strength: Double, theme: MetalResolvedTheme, deform: MetalDeform?, cfg: MetalGlowConfig) -> MetalGlowFrame? {
        guard !perim.isEmpty else { return nil }
        let halfWin: CGFloat = 0
        _ = halfWin

        let dtMs = lastTickMs > 0 ? min(200, max(0.5, nowMs - lastTickMs)) : MetalGlowState.rateTickMs
        lastTickMs = nowMs
        envClock += min(dtMs, MetalGlowState.envMaxStepMs)
        func rate(_ perTick: Double) -> Double { 1 - pow(1 - perTick, dtMs / MetalGlowState.rateTickMs) }

        // The luminance hunt runs at the web's shader rate; the envelope every frame.
        if nowMs - lastHuntMs >= MetalGlowState.huntIntervalMs || lastHuntMs == 0 {
            lastHuntMs = nowMs
            for i in 0..<perim.count { lumCache[i] = sampler.luminance(perim[i].point) }
        }
        var maxLum: Float = -1, maxIdx = currentIdx
        for i in 0..<perim.count where lumCache[i] > maxLum { maxLum = lumCache[i]; maxIdx = i }
        let curLum = Double(lumCache[currentIdx])

        let dwellActive = appearedAt > 0 && nowMs - appearedAt < cfg.minDwellMs
        let targetOp = cfg.baseOp + (cfg.peakOp - cfg.baseOp) * ss(cfg.lumLo, cfg.lumHi, curLum)
        let rivalDominates = !dwellActive && Double(maxLum) - curLum > MetalGlowState.relocateDelta

        let fadeMs = max(1, cfg.relocFadeMs), fadeOutMs = max(1, cfg.relocFadeOutMs)
        func fadeIn() {
            appearedAt = nowMs
            wanderS = 0; wanderTargetS = 0; wanderMs = 0
            relocTween = Tween(from: 0, to: 1, duration: fadeMs, startedAt: envClock)
        }
        func fadeOut(_ next: Int) {
            relocNextIdx = next
            relocTween = Tween(from: 1, to: 0, duration: fadeOutMs, startedAt: envClock)
        }
        if let t = relocTween, t.done, t.to == 0 {
            currentIdx = relocNextIdx
            let nl = Double(lumCache[currentIdx])
            glowOpacity = cfg.baseOp + (cfg.peakOp - cfg.baseOp) * ss(cfg.lumLo, cfg.lumHi, nl)
            fadeIn()
        }
        if relocTween == nil || relocTween!.done {
            if appearedAt == 0 {
                currentIdx = maxIdx; glowOpacity = targetOp
                fadeIn()
            } else if rivalDominates {
                fadeOut(maxIdx)
            }
        }
        glowOpacity += (targetOp - glowOpacity) * rate(cfg.fadeRate)
        glowOpacity = min(1, max(0, glowOpacity))
        relocMul = relocTween.map { _ in relocTween!.tick(envClock) } ?? 1

        let ratio = Double(MetalGeometry.shapePerim(size.width, size.height, radius, kind) / MetalGeometry.rrPerim(140, 40, 20))
        let wanderRange = cfg.wanderRange * ratio
        wanderMs += dtMs
        if wanderMs >= MetalGlowState.wanderRetargetMs { wanderTargetS = Double.random(in: -1...1) * wanderRange; wanderMs = 0 }
        wanderS += (wanderTargetS - wanderS) * rate(cfg.wanderLerp)

        var blob: CGPoint, extra: CGPoint, tangent: CGFloat
        if pointMode {
            let p = perim[currentIdx].point
            blob = CGPoint(x: p.x + CGFloat(wanderS), y: p.y); tangent = 0; extra = blob
        } else {
            let arc = perim[currentIdx].arc + CGFloat(wanderS)
            let inset = CGFloat(cfg.inset)
            blob = MetalGeometry.sampleAtArc(arc, size.width, size.height, radius, inset: inset, outward: 0, kind)
            tangent = MetalGeometry.tangentAngleAtArc(arc, size.width, size.height, radius, inset: inset, kind)
            extra = MetalGeometry.sampleAtArc(arc, size.width, size.height, radius, inset: inset, outward: CGFloat(cfg.extraOutward * ratio), kind)
        }
        if let d = deform { blob = d(blob); extra = d(extra) }

        let samp = sampler.rgb(blob)
        let light = theme == .light
        if tintTween == nil {
            tintFrom = samp; tintTarget = samp
            tintTween = Tween(from: 0, to: 1, duration: MetalGlowState.tintFadeMs, startedAt: nowMs)
            tintHoldUntil = light ? 0 : nowMs + MetalGlowState.tintHoldMs
        } else if tintTween!.done {
            if light {
                let v = Float(tintTween!.value)
                tintFrom = tintFrom + (tintTarget - tintFrom) * v
                tintTarget = samp
                tintTween = Tween(from: 0, to: 1, duration: MetalGlowState.tintFadeMs, startedAt: nowMs)
            } else if nowMs >= tintHoldUntil {
                tintFrom = tintTarget; tintTarget = samp
                tintTween = Tween(from: 0, to: 1, duration: MetalGlowState.tintFadeMs, startedAt: nowMs)
                tintHoldUntil = nowMs + MetalGlowState.tintHoldMs
            }
        }
        let ft = Float(tintTween!.tick(nowMs))
        var tint = tintFrom + (tintTarget - tintFrom) * ft
        if !light {
            let peak = max(tint.x, max(tint.y, tint.z))
            if peak > 0 { tint = tint / peak }
        }

        let m = min(1, max(0, strength)) * (pointMode ? cfg.pointGain : 1)
        let haloOp = min(1, glowOpacity * cfg.haloOpMul * m)
        let extraOp = min(1, glowOpacity * cfg.extraIntensity * m)
        return MetalGlowFrame(position: blob, extraPosition: extra, tangent: tangent, haloOpacity: haloOp, extraOpacity: extraOp, envelope: relocMul, tint: tint)
    }
}

// MARK: - Sprites

/// A baked halo sprite: white, alpha only, anchored at `anchor` (the segment's
/// start), drawn along +x with half-length `halfLen`.
struct MetalGlowSprite {
    let image: CGImage
    let size: CGSize      // points
    let anchor: CGPoint   // points, the segment's left end
    let scale: CGFloat
}

enum MetalGlowSprites {
    private static var cache: [String: MetalGlowSprite] = [:]

    struct Layer { var stroke: Double; var blur: Double; var opacity: Double }

    static func halo(halfLen: Double, s: Double, scale: CGFloat, cfg: MetalGlowConfig) -> MetalGlowSprite {
        let key = "h|\(halfLen)|\(s)|\(scale)|\(cfg.haloStrokeXl),\(cfg.haloBlurXl),\(cfg.haloOpXl)"
        if let c = cache[key] { return c }
        let sp = compose([
            Layer(stroke: cfg.haloStrokeXl, blur: cfg.haloBlurXl, opacity: cfg.haloOpXl),
            Layer(stroke: cfg.haloStrokeLg, blur: cfg.haloBlurLg, opacity: cfg.haloOpLg),
            Layer(stroke: cfg.haloStrokeMd, blur: cfg.haloBlurMd, opacity: cfg.haloOpMd),
            Layer(stroke: cfg.haloStrokeSm, blur: cfg.haloBlurSm, opacity: cfg.haloOpSm),
        ], halfLen: halfLen, s: s, scale: scale, fade: 0)
        cache[key] = sp
        return sp
    }

    static func extra(halfLen: Double, s: Double, scale: CGFloat, cfg: MetalGlowConfig) -> MetalGlowSprite {
        let key = "e|\(halfLen)|\(s)|\(scale)|\(cfg.extraStrokeOuter),\(cfg.extraFadeR)"
        if let c = cache[key] { return c }
        let sp = compose([
            Layer(stroke: cfg.extraStrokeOuter, blur: cfg.extraBlurOuter, opacity: cfg.extraOpOuter),
            Layer(stroke: cfg.extraStrokeCore, blur: cfg.extraBlurCore, opacity: 1),
        ], halfLen: halfLen, s: s, scale: scale, fade: cfg.extraFadeR)
        cache[key] = sp
        return sp
    }

    /// The web's `compose`: round-capped strokes, gaussian-blurred, stacked
    /// (alpha only, white over white), with the optional radial end fade.
    private static func compose(_ layers: [Layer], halfLen: Double, s: Double, scale: CGFloat, fade: Double) -> MetalGlowSprite {
        var padMax = 0.0
        for l in layers { padMax = max(padMax, (l.stroke / 2 + 3 * l.blur) * s) }
        let pad = ceil(padMax) + 1
        let cw = 2 * halfLen + 2 * pad, ch = 2 * pad
        let w = Int(ceil(cw * Double(scale))), h = Int(ceil(ch * Double(scale)))
        var acc = [Float](repeating: 0, count: w * h)
        for l in layers {
            var a = strokeAlpha(halfLen: halfLen, strokeW: l.stroke * s, w: w, h: h, scale: scale, ax: pad, ay: pad)
            a = gaussBlur(a, w, h, sigma: l.blur * s * Double(scale))
            let op = Float(l.opacity)
            for i in 0..<acc.count { let la = a[i] * op; acc[i] = acc[i] + la * (1 - acc[i]) }
        }
        if fade > 0 {
            let cx = pad * Double(scale), cy = pad * Double(scale), R = fade * s * Double(scale)
            for y in 0..<h { for x in 0..<w {
                let t = hypot(Double(x) + 0.5 - cx, Double(y) + 0.5 - cy) / R
                let m: Double
                if t <= 0.3 { m = 1 } else if t <= 0.65 { m = 1 - ((t - 0.3) / 0.35) * 0.75 } else if t < 1 { m = 0.25 * (1 - (t - 0.65) / 0.35) } else { m = 0 }
                acc[y * w + x] *= Float(m)
            } }
        }
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        for i in 0..<acc.count {
            let a = UInt8(max(0, min(255, (acc[i] * 255).rounded())))
            bytes[i * 4] = a; bytes[i * 4 + 1] = a; bytes[i * 4 + 2] = a; bytes[i * 4 + 3] = a
        }
        let cs = CGColorSpaceCreateDeviceRGB()
        let ctx = CGContext(data: &bytes, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: cs,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        let img = ctx.makeImage()!
        return MetalGlowSprite(image: img, size: CGSize(width: cw, height: ch), anchor: CGPoint(x: pad, y: pad), scale: scale)
    }

    private static func strokeAlpha(halfLen: Double, strokeW: Double, w: Int, h: Int, scale: CGFloat, ax: Double, ay: Double) -> [Float] {
        var out = [Float](repeating: 0, count: w * h)
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return out }
        ctx.scaleBy(x: scale, y: scale)
        ctx.setStrokeColor(gray: 1, alpha: 1)
        ctx.setLineCap(.round)
        ctx.setLineJoin(.round)
        ctx.setLineWidth(strokeW)
        ctx.move(to: CGPoint(x: ax - halfLen, y: ay))
        ctx.addLine(to: CGPoint(x: ax + halfLen, y: ay))
        ctx.strokePath()
        guard let data = ctx.data else { return out }
        let p = data.bindMemory(to: UInt8.self, capacity: w * h)
        for i in 0..<(w * h) { out[i] = Float(p[i]) / 255 }
        return out
    }

    // Three box blurs ≈ gaussian, the web's `gaussBlur`.
    private static func boxesForGauss(_ sigma: Double, _ n: Int) -> [Int] {
        let wIdeal = sqrt((12 * sigma * sigma / Double(n)) + 1)
        var wl = Int(floor(wIdeal)); if wl % 2 == 0 { wl -= 1 }
        let wu = wl + 2
        let mIdeal = (12 * sigma * sigma - Double(n * wl * wl) - Double(4 * n * wl) - Double(3 * n)) / Double(-4 * wl - 4)
        let m = Int(mIdeal.rounded())
        return (0..<n).map { $0 < m ? wl : wu }
    }

    private static func gaussBlur(_ a: [Float], _ w: Int, _ h: Int, sigma: Double) -> [Float] {
        if sigma <= 0.05 { return a }
        var cur = a
        var tmp = [Float](repeating: 0, count: a.count)
        for box in boxesForGauss(sigma, 3) {
            let r = (box - 1) / 2
            boxBlurH(cur, &tmp, w, h, r)
            boxBlurV(tmp, &cur, w, h, r)
        }
        return cur
    }

    private static func boxBlurH(_ src: [Float], _ dst: inout [Float], _ w: Int, _ h: Int, _ r: Int) {
        let iarr = 1 / Float(r + r + 1)
        for y in 0..<h {
            let row = y * w
            var acc: Float = 0
            for x in -r...r { acc += src[row + min(w - 1, max(0, x))] }
            for x in 0..<w {
                dst[row + x] = acc * iarr
                let out = row + max(0, x - r), inn = row + min(w - 1, x + r + 1)
                acc += src[inn] - src[out]
            }
        }
    }

    private static func boxBlurV(_ src: [Float], _ dst: inout [Float], _ w: Int, _ h: Int, _ r: Int) {
        let iarr = 1 / Float(r + r + 1)
        for x in 0..<w {
            var acc: Float = 0
            for y in -r...r { acc += src[min(h - 1, max(0, y)) * w + x] }
            for y in 0..<h {
                dst[y * w + x] = acc * iarr
                let out = max(0, y - r) * w + x, inn = min(h - 1, y + r + 1) * w + x
                acc += src[inn] - src[out]
            }
        }
    }
}

// MARK: - Layer

/// Draws one glow frame: the halo and catch-light sprites at the hotspot,
/// tinted, under the theme's blend, inside `mask` (the band at full, the
/// surround at half — or the glyphs with their soft skirt).
struct MetalGlowLayer<Mask: View>: View {
    let frame: MetalGlowFrame
    let halo: MetalGlowSprite
    let extra: MetalGlowSprite
    let theme: MetalResolvedTheme
    let small: Bool
    /// The host box; the layer extends `margin` past it on every side.
    let size: CGSize
    let margin: CGFloat
    /// Drawn in the enlarged frame's coordinates (box origin at `margin`).
    @ViewBuilder let mask: () -> Mask

    var body: some View {
        let tint = Color(red: Double(frame.tint.x), green: Double(frame.tint.y), blue: Double(frame.tint.z))
        let extraTint: Color = theme == .light ? boosted(frame.tint) : .white
        let w = size.width + 2 * margin, h = size.height + 2 * margin
        ZStack(alignment: .topLeading) {
            sprite(halo, at: frame.position)
                .colorMultiply(tint)
                .opacity(frame.haloOpacity)
            sprite(extra, at: frame.extraPosition)
                .colorMultiply(extraTint)
                .opacity(frame.extraOpacity)
        }
        .frame(width: w, height: h, alignment: .topLeading)
        .mask { mask().frame(width: w, height: h, alignment: .topLeading) }
        .modifier(ThemeBlend(theme: theme, small: small))
        .opacity(frame.envelope)
        .frame(width: w, height: h, alignment: .topLeading)
        .offset(x: -margin, y: -margin)
        .allowsHitTesting(false)
    }

    /// The sprite is symmetric: the segment's midpoint is the image centre, so
    /// rotating about the centre and positioning it at the hotspot is exact.
    private func sprite(_ sp: MetalGlowSprite, at p: CGPoint) -> some View {
        Image(decorative: sp.image, scale: sp.scale)
            .frame(width: sp.size.width, height: sp.size.height)
            .rotationEffect(.radians(Double(frame.tangent)))
            .position(x: p.x + margin, y: p.y + margin)
    }

    private func boosted(_ t: SIMD3<Float>) -> Color {
        var hsv = rgbToHsv(t)
        hsv.y = min(1, hsv.y * 2.625)
        hsv.z = max(0.31, hsv.z * 1.008)
        let c = hsvToRgb(hsv)
        return Color(red: Double(c.x), green: Double(c.y), blue: Double(c.z))
    }

    private struct ThemeBlend: ViewModifier {
        let theme: MetalResolvedTheme
        let small: Bool
        func body(content: Content) -> some View {
            if theme == .light {
                content
                    .saturation(small ? 7.5 : 5.355)
                    .brightness(small ? -0.4 : -0.22)
                    .blendMode(.multiply)
                    .opacity(0.2746)
            } else {
                content.opacity(0.7)
            }
        }
    }
}

func rgbToHsv(_ c: SIMD3<Float>) -> SIMD3<Float> {
    let mx = max(c.x, max(c.y, c.z)), mn = min(c.x, min(c.y, c.z))
    let d = mx - mn
    var h: Float = 0
    if d > 0 {
        if mx == c.x { h = (c.y - c.z) / d + (c.y < c.z ? 6 : 0) }
        else if mx == c.y { h = (c.z - c.x) / d + 2 }
        else { h = (c.x - c.y) / d + 4 }
        h /= 6
    }
    return SIMD3<Float>(h, mx > 0 ? d / mx : 0, mx)
}

func hsvToRgb(_ v: SIMD3<Float>) -> SIMD3<Float> {
    let h = v.x * 6, s = v.y, val = v.z
    let i = floor(h), f = h - i
    let p = val * (1 - s), q = val * (1 - s * f), t = val * (1 - s * (1 - f))
    switch Int(i) % 6 {
    case 0: return SIMD3<Float>(val, t, p)
    case 1: return SIMD3<Float>(q, val, p)
    case 2: return SIMD3<Float>(p, val, t)
    case 3: return SIMD3<Float>(p, q, val)
    case 4: return SIMD3<Float>(t, p, val)
    default: return SIMD3<Float>(val, p, q)
    }
}
