import SwiftUI
import simd

/// The three bundled looks. Same parameter sets as metal-fx v2 on the web
/// (`src/engine/presets.ts`): one silver material from Paper Shaders'
/// `liquidMetal`, coloured by a colour-burn tint and the R/B dispersion.
public enum MetalPreset: String, CaseIterable, Identifiable, Sendable {
    case chromatic, silver, gold
    public var id: String { rawValue }
}

public enum MetalTheme: Sendable {
    case dark, light
    /// Follows the environment's colour scheme.
    case auto

    func resolved(_ scheme: ColorScheme) -> MetalResolvedTheme {
        switch self {
        case .dark: return .dark
        case .light: return .light
        case .auto: return scheme == .dark ? .dark : .light
        }
    }
}

public enum MetalResolvedTheme: Sendable { case dark, light }

/// Paper `liquidMetal` parameters, plus the per-preset opacity metal-fx
/// applies when it composites the sheet.
public struct MetalMaterial: Equatable, Sendable {
    /// Backdrop RGBA, composited under the material. Transparent for rings.
    public var colorBack: SIMD4<Float>
    /// Tint RGBA applied as colour-burn; `.w` is the blend amount.
    public var colorTint: SIMD4<Float>
    /// Time multiplier.
    public var speed: Float
    /// Stripe density (1..10).
    public var repetition: Float
    /// Stripe transition blur (0..1).
    public var softness: Float
    /// R / B channel dispersion (-1..1).
    public var shiftRed: Float
    public var shiftBlue: Float
    /// Simplex-noise warp over the stripes (0..1).
    public var distortion: Float
    /// Edge-following strength (0..1).
    public var contour: Float
    /// Drift direction, degrees.
    public var angle: Float
    /// Global alpha the sheet is composited at.
    public var shaderOpacity: Float

    public init(colorBack: SIMD4<Float>, colorTint: SIMD4<Float>, speed: Float, repetition: Float, softness: Float,
                shiftRed: Float, shiftBlue: Float, distortion: Float, contour: Float, angle: Float, shaderOpacity: Float) {
        self.colorBack = colorBack; self.colorTint = colorTint; self.speed = speed; self.repetition = repetition
        self.softness = softness; self.shiftRed = shiftRed; self.shiftBlue = shiftBlue; self.distortion = distortion
        self.contour = contour; self.angle = angle; self.shaderOpacity = shaderOpacity
    }

    /// Paper's `fullScreenPreset`, minus its opaque backdrop.
    public static let base = MetalMaterial(
        colorBack: SIMD4<Float>(0, 0, 0, 0), colorTint: SIMD4<Float>(1, 1, 1, 0), speed: 1,
        repetition: 1.5, softness: 0.05, shiftRed: 0.3, shiftBlue: 0.3, distortion: 0.1, contour: 0.4, angle: 90,
        shaderOpacity: 1
    )

    public static func preset(_ preset: MetalPreset, theme: MetalResolvedTheme) -> MetalMaterial {
        var m = MetalMaterial.base
        switch (preset, theme) {
        case (.chromatic, .dark):
            m.colorTint = rgba("#88ccff2e"); m.shiftRed = 0.75; m.shiftBlue = 0.75; m.repetition = 2; m.softness = 0.09
        case (.chromatic, .light):
            m.colorTint = rgba("#66b0ff99"); m.shiftRed = 0.6; m.shiftBlue = 0.6
        case (.silver, .dark):
            m.colorTint = rgba("#ffffff66"); m.shaderOpacity = 0.88
        case (.silver, .light):
            m.colorTint = rgba("#ffffff40")
        case (.gold, .dark):
            m.colorTint = rgba("#ffcc55cc"); m.speed = 0.85; m.shaderOpacity = 0.92
        case (.gold, .light):
            m.colorTint = rgba("#f7d488aa")
        }
        return m
    }

    /// `#rrggbb` or `#rrggbbaa` → 0..1 components.
    public static func rgba(_ hex: String) -> SIMD4<Float> {
        var s = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        if s.count == 6 { s += "ff" }
        guard s.count == 8, let v = UInt32(s, radix: 16) else { return SIMD4<Float>(1, 1, 1, 1) }
        return SIMD4<Float>(Float((v >> 24) & 0xff), Float((v >> 16) & 0xff), Float((v >> 8) & 0xff), Float(v & 0xff)) / 255
    }
}

// MARK: - Sheet mapping

/// How a view maps onto the web's material sheet. The web renders the
/// material onto one square sheet and crops a window per instance sized by
/// the instance's box against a 140×40 canonical pill, divided by
/// `shaderScale`; larger boxes clamp to the whole sheet.
///
///   uv = origin + position * scale
public struct MetalSheetMapping: Equatable, Sendable {
    public var origin: SIMD2<Float>
    public var scale: SIMD2<Float>

    public static let canonicalWidth: Float = 140
    public static let canonicalHeight: Float = 40

    public init(size: CGSize, shaderScale: Float) {
        let w = max(1, Float(size.width)), h = max(1, Float(size.height))
        let fx = min(1, w / (MetalSheetMapping.canonicalWidth * shaderScale))
        let fy = min(1, h / (MetalSheetMapping.canonicalHeight * shaderScale))
        scale = SIMD2<Float>(fx / w, fy / h)
        origin = SIMD2<Float>(0.5 - 0.5 * fx, 0.5 - 0.5 * fy)
    }

    public init(origin: SIMD2<Float>, scale: SIMD2<Float>) { self.origin = origin; self.scale = scale }

    public func uv(_ p: CGPoint) -> SIMD2<Float> {
        origin + SIMD2<Float>(Float(p.x), Float(p.y)) * scale
    }

    /// The same window, drawn into a box of another size, optionally mirrored
    /// on x — what a reflection needs.
    public func stretched(from size: CGSize, to target: CGSize, flipX: Bool, flipY: Bool) -> MetalSheetMapping {
        let sx = Float(size.width) / max(1, Float(target.width))
        let sy = Float(size.height) / max(1, Float(target.height))
        var o = origin, s = scale * SIMD2<Float>(sx, sy)
        if flipX { o.x += scale.x * Float(size.width); s.x = -s.x }
        if flipY { o.y += scale.y * Float(size.height); s.y = -s.y }
        return MetalSheetMapping(origin: o, scale: s)
    }
}

// MARK: - CPU sampler

/// The material evaluated on the CPU at a point of the sheet — the same
/// arithmetic as the shader, minus dithering. Sixteen samples per glow tick
/// replace the web's GPU read-back.
extension MetalMaterial {
    public func sample(uv: SIMD2<Float>, time: Float) -> SIMD3<Float> {
        let t: Float = 0.3 * (time * speed + 2.8)
        let cw = repetition * 2
        let noise = mfxSnoise(uv - SIMD2<Float>(repeating: t))
        let f = mfxField(uv, t, noise, cw)
        let fx = mfxField(uv + SIMD2<Float>(1.0 / 192.0, 0), t, noise, cw)
        let fy = mfxField(uv + SIMD2<Float>(0, 1.0 / 192.0), t, noise, cw)
        let fw = abs(fx.direction - f.direction) + abs(fy.direction - f.direction)

        let uvc = SIMD2<Float>(min(1, max(0, uv.x)), min(1, max(0, uv.y)))
        let mask = SIMD2<Float>(min(uvc.x, 1 - uvc.x), min(uvc.y, 1 - uvc.y))
        let rawEdge = min(1, max(0, 1 - pow(ss(0, 0.5, mask.x), 0.25) * pow(ss(0, 0.5, mask.y), 0.25)))
        var opacity = 1 - ss(0.9 - 0.004, 0.9, rawEdge)

        let color1 = SIMD3<Float>(0.98, 0.98, 1.0)
        let color2 = SIMD3<Float>(0.1, 0.1, 0.1 + 0.1 * ss(0.7, 1.3, f.diagTL))
        let bump = f.bump, edge = f.edge, direction = f.direction
        let thin1 = 0.12 / cw * (1 - 0.4 * bump)
        let thin2 = 0.07 / cw * (1 + 0.4 * bump)
        var w = SIMD3<Float>(cw * thin1, cw * thin2, 1 - thin1 - thin2)

        let colorDispersion = min(1, max(0, 1 - bump))
        var dR = colorDispersion
        dR += 0.03 * bump * noise
        dR += 5 * (ss(-0.1, 0.2, uv.y) * (1 - ss(0.1, 0.5, uv.y))) * (ss(0.4, 0.6, bump) * (1 - ss(0.4, 1.0, bump)))
        dR -= f.diagBL
        var dB = colorDispersion * 1.3
        dB += (ss(0, 0.4, uv.y) * (1 - ss(0.1, 0.8, uv.y))) * (ss(0.4, 0.6, bump) * (1 - ss(0.4, 0.8, bump)))
        dB -= 0.2 * edge
        dR *= shiftRed / 20
        dB *= shiftBlue / 20

        let blur = softness / 15
        w[1] -= 0.02 * ss(0, 1, edge + bump)

        let r = colorChanges(color1.x, color2.x, fract(direction + dR), w, blur + fw, bump, colorTint.x)
        let g = colorChanges(color1.y, color2.y, fract(direction), w, blur + fw, bump, colorTint.y)
        let b = colorChanges(color1.z, color2.z, fract(direction - dB), w, blur + fw, bump, colorTint.z)
        var color = SIMD3<Float>(r, g, b) * opacity
        let bg = SIMD3<Float>(colorBack.x, colorBack.y, colorBack.z) * colorBack.w
        color = color + bg * (1 - opacity)
        opacity = opacity + colorBack.w * (1 - opacity)
        return color
    }

    public func luminance(uv: SIMD2<Float>, time: Float) -> Float {
        let c = sample(uv: uv, time: time)
        return 0.2126 * c.x + 0.7152 * c.y + 0.0722 * c.z
    }

    private struct Field { var direction: Float; var bump: Float; var edge: Float; var diagBL: Float; var diagTL: Float }

    private func mfxField(_ uv: SIMD2<Float>, _ t: Float, _ noise: Float, _ cw: Float) -> Field {
        let uvc = SIMD2<Float>(min(1, max(0, uv.x)), min(1, max(0, uv.y)))
        let mask = SIMD2<Float>(min(uvc.x, 1 - uvc.x), min(uvc.y, 1 - uvc.y))
        let maskX = pow(ss(0, 0.5, mask.x), 0.25)
        let maskY = pow(ss(0, 0.5, mask.y), 0.25)
        var edge = min(1, max(0, 1 - maskX * maskY))
        let fwE: Float = 0.002
        edge = mix(ss(0.9 - 2 * fwE, 0.9, edge), edge, ss(0, 0.4, contour))
        edge = 1.2 * edge

        var rotatedUV = uv - 0.5
        let a = (-angle + 70) * Float.pi / 180
        let cosA = cos(a), sinA = sin(a)
        rotatedUV = SIMD2<Float>(rotatedUV.x * cosA - rotatedUV.y * sinA, rotatedUV.x * sinA + rotatedUV.y * cosA) + 0.5
        let diagBL = rotatedUV.x - rotatedUV.y
        let diagTL = rotatedUV.x + rotatedUV.y

        var gradUV = uv - 0.5
        let dist = hypot(gradUV.x, gradUV.y + 0.2 * diagBL)
        gradUV = rotate(gradUV, (0.25 - 0.2 * diagBL) * Float.pi)
        var direction = gradUV.x

        let uy = max(uvc.y, 0)
        var bump = 1 - pow(1.8 * dist, 1.2)
        bump *= pow(uy, 0.3)

        edge += (1 - edge) * distortion * noise

        direction += diagBL
        let sE = ss(0, 1, edge)
        direction -= 2 * noise * diagBL * (sE * (1 - sE))
        let c51 = ss(0.5, 1, contour)
        direction *= mix(1, 1 - edge, c51)
        direction -= 1.7 * edge * c51
        direction += 0.2 * pow(contour, 4) * (1 - sE)

        bump *= min(1, max(0.3, pow(uy, 0.1)))
        direction *= (0.1 + (1.1 - edge) * bump)
        direction *= (0.4 + 0.6 * (1 - ss(0.5, 1, edge)))
        direction += 0.18 * (ss(0.1, 0.2, uv.y) * (1 - ss(0.2, 0.4, uv.y)))
        direction += 0.03 * (ss(0.1, 0.2, 1 - uv.y) * (1 - ss(0.2, 0.4, 1 - uv.y)))
        direction *= (0.5 + 0.5 * uv.y * uv.y)
        direction *= cw
        direction -= t
        return Field(direction: direction, bump: bump, edge: edge, diagBL: diagBL, diagTL: diagTL)
    }

    private func colorChanges(_ c1: Float, _ c2: Float, _ p: Float, _ w: SIMD3<Float>, _ blurIn: Float, _ bump: Float, _ tint: Float) -> Float {
        let blur = max(blurIn, 1e-5)
        var ch = mix(c2, c1, ss(0, 2 * blur, p))
        var border = w[0]
        ch = mix(ch, c2, ss(border, border + 2 * blur, p))
        border = w[0] + 0.4 * (1 - bump) * w[1]
        ch = mix(ch, c1, ss(border, border + 2 * blur, p))
        border = w[0] + 0.5 * (1 - bump) * w[1]
        ch = mix(ch, c2, ss(border, border + 2 * blur, p))
        border = w[0] + w[1]
        ch = mix(ch, c1, ss(border, border + 2 * blur, p))
        let gt = (p - w[0] - w[1]) / w[2]
        let gradient = mix(c1, c2, ss(0, 1, gt))
        ch = mix(ch, gradient, ss(border, border + 0.5 * blur, p))
        ch = mix(ch, 1 - min(1, (1 - ch) / max(tint, 0.0001)), colorTint.w)
        return ch
    }
}

// MARK: - Shader-equivalent helpers (Float)

@inline(__always) func ss(_ e0: Float, _ e1: Float, _ x: Float) -> Float {
    let e1c = max(e1, e0 + 1e-6)
    let t = min(1, max(0, (x - e0) / (e1c - e0)))
    return t * t * (3 - 2 * t)
}

@inline(__always) func mix(_ a: Float, _ b: Float, _ t: Float) -> Float { a + (b - a) * t }
@inline(__always) func fract(_ x: Float) -> Float { x - floor(x) }
@inline(__always) func glslMod(_ x: Float, _ y: Float) -> Float { x - y * floor(x / y) }
@inline(__always) func vfloor(_ x: SIMD2<Float>) -> SIMD2<Float> { SIMD2<Float>(floor(x.x), floor(x.y)) }
@inline(__always) func vfloor(_ x: SIMD3<Float>) -> SIMD3<Float> { SIMD3<Float>(floor(x.x), floor(x.y), floor(x.z)) }
@inline(__always) func glslMod(_ x: SIMD2<Float>, _ y: Float) -> SIMD2<Float> { x - y * vfloor(x / y) }
@inline(__always) func glslMod(_ x: SIMD3<Float>, _ y: Float) -> SIMD3<Float> { x - y * vfloor(x / y) }

@inline(__always) func rotate(_ uv: SIMD2<Float>, _ th: Float) -> SIMD2<Float> {
    let c = cos(th), s = sin(th)
    return SIMD2<Float>(c * uv.x - s * uv.y, s * uv.x + c * uv.y)
}

private func permute(_ x: SIMD3<Float>) -> SIMD3<Float> { glslMod(((x * 34) + 1) * x, 289) }

func mfxSnoise(_ v: SIMD2<Float>) -> Float {
    let Cx: Float = 0.211324865405187, Cy: Float = 0.366025403784439
    let Cz: Float = -0.577350269189626, Cw: Float = 0.024390243902439
    var i = vfloor(v + SIMD2<Float>(repeating: (v.x + v.y) * Cy))
    let x0 = v - i + SIMD2<Float>(repeating: (i.x + i.y) * Cx)
    let i1: SIMD2<Float> = (x0.x > x0.y) ? SIMD2<Float>(1, 0) : SIMD2<Float>(0, 1)
    let x1 = SIMD2<Float>(x0.x + Cx - i1.x, x0.y + Cx - i1.y)
    let x2 = SIMD2<Float>(x0.x + Cz, x0.y + Cz)
    i = glslMod(i, 289)
    let p = permute(permute(SIMD3<Float>(i.y, i.y + i1.y, i.y + 1)) + SIMD3<Float>(i.x, i.x + i1.x, i.x + 1))
    let d0 = x0.x * x0.x + x0.y * x0.y
    let d1 = x1.x * x1.x + x1.y * x1.y
    let d2 = x2.x * x2.x + x2.y * x2.y
    var m = SIMD3<Float>(max(0.5 - d0, 0), max(0.5 - d1, 0), max(0.5 - d2, 0))
    m = m * m
    m = m * m
    let pc = p * Cw
    let x = 2 * (pc - vfloor(pc)) - 1
    let h = SIMD3<Float>(abs(x.x), abs(x.y), abs(x.z)) - 0.5
    let ox = vfloor(x + 0.5)
    let a0 = x - ox
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h)
    let gx = a0.x * x0.x + h.x * x0.y
    let gy = a0.y * x1.x + h.y * x1.y
    let gz = a0.z * x2.x + h.z * x2.y
    return 130 * (m.x * gx + m.y * gy + m.z * gz)
}
