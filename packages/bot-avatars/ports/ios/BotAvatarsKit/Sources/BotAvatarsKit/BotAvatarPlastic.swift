import Foundation
import CoreGraphics
import SwiftUI

/* The 'plastic' shading: a glossy toy-plastic material for the front cap,
   lit per texel. A port of the web package's plastic.ts.

   Once per outline (× texture size × depth) the outline is rasterised into
   a small grid and turned into a FORM: a signed distance, a pillow height
   field (the torsion function of the outline), its normals, and baked
   ambient occlusion. Per frame the light and the view are rotated into
   the cap's own frame; a small MATCAP (a lit sphere: one colour per
   normal) is evaluated with the full material — only when the light or
   the view has moved a bin — and the cap's texels are a bilinear lookup
   into it, drawn as an image through the cap's affine under a vector
   clip. The side copies take conic gradients sampled from the same
   matcap, so sides and cap agree. */

/// The texture covers design units [-PAD, 100 + PAD].
public let BOT_AVATAR_PAD = 3.0
public let BOT_AVATAR_SPAN = 100.0 + 2 * BOT_AVATAR_PAD
private let PAD = BOT_AVATAR_PAD, SPAN = BOT_AVATAR_SPAN
/// Matcap side: (nx, ny) ∈ [-1, 1]² in M × M cells.
let MATCAP_M = 64
private let M = MATCAP_M
private let MM = M * M
/// Stops on the conic side gradients.
private let CONIC_STOPS = 24
private let INF: Float = 1e12
/// Light elevation off the screen plane.
private let EL = 48.0 * Double.pi / 180
private let E_XY = cos(EL), E_Z = sin(EL)
let PLASTIC_SLICES = 17
@inline(__always) func pillowProfile(_ z: Double, _ cap: Double) -> Double { cap + (1 - cap) * sqrt(max(0, 1 - z * z)) }

typealias V3 = SIMD3<Double>

/* ── the form: per outline, once ───────────────────────────────────── */

/// The baked form of one outline at one texture size.
public final class BotAvatarForm {
    public let N: Int
    /// bilinear cell in the matcap: index of the top-left cell …
    let i00: [UInt16]
    /// … and the weights inside it, 0–255
    let wx: [UInt8]
    let wy: [UInt8]
    /// baked occlusion × edge darkening, gamma-compensated, 0–255; 0 = not drawn
    let ao: [UInt8]
    init(N: Int, i00: [UInt16], wx: [UInt8], wy: [UInt8], ao: [UInt8]) {
        self.N = N; self.i00 = i00; self.wx = wx; self.wy = wy; self.ao = ao
    }
}

/* Felzenszwalb–Huttenlocher 1-D squared distance transform; s gets the
   index of the nearest site. */
private func edt1d(_ f: UnsafeMutablePointer<Float>, _ n: Int, _ d: UnsafeMutablePointer<Float>, _ s: UnsafeMutablePointer<Int32>, _ v: UnsafeMutablePointer<Int32>, _ z: UnsafeMutablePointer<Float>) {
    var k = 0
    v[0] = 0
    z[0] = -1e30
    z[1] = 1e30
    for q in 1..<n {
        var x: Float = 0
        while true {
            let vk = Int(v[k])
            let fq = Float(q), fvk = Float(vk)
            x = (f[q] + fq * fq - f[vk] - fvk * fvk) / (2 * (fq - fvk))
            if x > z[k] { break }
            k -= 1
        }
        k += 1
        v[k] = Int32(q)
        z[k] = x
        z[k + 1] = 1e30
    }
    k = 0
    for q in 0..<n {
        while z[k + 1] < Float(q) { k += 1 }
        let vk = Int(v[k])
        let dq = Float(q - vk)
        d[q] = dq * dq + f[vk]
        s[q] = Int32(vk)
    }
}

/* Squared texel distance from every texel to the nearest texel whose mask
   equals `site`, and (optionally) that texel's index. */
private func edt2d(_ mask: [UInt8], _ site: UInt8, _ N: Int, _ out: inout [Float], _ near: inout [Int32], wantNear: Bool) {
    var f = [Float](repeating: 0, count: N), d = [Float](repeating: 0, count: N)
    var s = [Int32](repeating: 0, count: N), v = [Int32](repeating: 0, count: N), z = [Float](repeating: 0, count: N + 1)
    var g = [Float](repeating: 0, count: N * N), row = [Int32](repeating: 0, count: N * N)
    f.withUnsafeMutableBufferPointer { fp in d.withUnsafeMutableBufferPointer { dp in s.withUnsafeMutableBufferPointer { sp in v.withUnsafeMutableBufferPointer { vp in z.withUnsafeMutableBufferPointer { zp in
        let f = fp.baseAddress!, d = dp.baseAddress!, s = sp.baseAddress!, v = vp.baseAddress!, z = zp.baseAddress!
        for x in 0..<N {
            for y in 0..<N { f[y] = mask[y * N + x] == site ? 0 : INF }
            edt1d(f, N, d, s, v, z)
            for y in 0..<N {
                g[y * N + x] = d[y]
                row[y * N + x] = s[y]
            }
        }
        for y in 0..<N {
            let o = y * N
            for x in 0..<N { f[x] = g[o + x] }
            edt1d(f, N, d, s, v, z)
            for x in 0..<N {
                out[o + x] = d[x]
                if wantNear { near[o + x] = row[o + Int(s[x])] * Int32(N) + s[x] }
            }
        }
    } } } } }
}

/* Separable binomial blur [1 4 6 4 1]/16, edges clamped. */
private func blur5(_ a: inout [Float], _ N: Int, _ tmp: inout [Float]) {
    for y in 0..<N {
        let o = y * N
        for x in 0..<N {
            let x0 = x < 2 ? 0 : x - 2, x1 = x < 1 ? 0 : x - 1, x3 = x > N - 2 ? N - 1 : x + 1, x4 = x > N - 3 ? N - 1 : x + 2
            tmp[o + x] = (a[o + x0] + 4 * a[o + x1] + 6 * a[o + x] + 4 * a[o + x3] + a[o + x4]) * 0.0625
        }
    }
    for x in 0..<N {
        for y in 0..<N {
            let y0 = y < 2 ? 0 : y - 2, y1 = y < 1 ? 0 : y - 1, y3 = y > N - 2 ? N - 1 : y + 1, y4 = y > N - 3 ? N - 1 : y + 2
            a[y * N + x] = (tmp[y0 * N + x] + 4 * tmp[y1 * N + x] + 6 * tmp[y * N + x] + 4 * tmp[y3 * N + x] + tmp[y4 * N + x]) * 0.0625
        }
    }
}

/* Δφ = −1 on the inside texels, φ = 0 outside: Gauss–Seidel with
   over-relaxation, cascaded from a quarter-size grid. */
private func poisson(_ cov: [UInt8], _ N: Int, _ u: Float) -> [Float] {
    struct Level { var n: Int; var mask: [UInt8]; var phi: [Float] }
    var levels: [Level] = []
    var n = N, f = 1
    while (f <= 4 && n % 2 == 0) || f == 1 {
        var mask = [UInt8](repeating: 0, count: n * n)
        for y in 0..<n {
            for x in 0..<n {
                var sum = 0
                for j in 0..<f { for i in 0..<f { sum += Int(cov[(y * f + j) * N + x * f + i]) } }
                mask[y * n + x] = sum >= 128 * f * f ? 1 : 0
            }
        }
        levels.append(Level(n: n, mask: mask, phi: [Float](repeating: 0, count: n * n)))
        if f == 4 { break }
        n >>= 1; f <<= 1
    }
    func sweep(_ L: inout Level, _ s: Float, _ iters: Int, _ om: Float) {
        let n = L.n, s2 = s * s
        L.phi.withUnsafeMutableBufferPointer { pp in
            L.mask.withUnsafeBufferPointer { mp in
                let phi = pp.baseAddress!, mask = mp.baseAddress!
                for _ in 0..<iters {
                    for y in 1..<(n - 1) {
                        let o = y * n
                        for x in 1..<(n - 1) {
                            let i = o + x
                            if mask[i] == 0 { continue }
                            let v = (phi[i - 1] + phi[i + 1] + phi[i - n] + phi[i + n] + s2) * 0.25
                            phi[i] += om * (v - phi[i])
                        }
                    }
                }
            }
        }
    }
    for l in stride(from: levels.count - 1, through: 0, by: -1) {
        let f = Float(1 << l)
        if l < levels.count - 1 {
            /* bilinear prolongation from the coarser level */
            let C = levels[l + 1], n = levels[l].n, cn = C.n
            for y in 0..<n {
                let fy = min(Float(cn - 1), max(0, (Float(y) + 0.5) / 2 - 0.5)), y0 = Int(fy), y1 = min(cn - 1, y0 + 1), ty = fy - Float(y0)
                for x in 0..<n {
                    let i = y * n + x
                    if levels[l].mask[i] == 0 { continue }
                    let fx = min(Float(cn - 1), max(0, (Float(x) + 0.5) / 2 - 0.5)), x0 = Int(fx), x1 = min(cn - 1, x0 + 1), tx = fx - Float(x0)
                    levels[l].phi[i] = (C.phi[y0 * cn + x0] * (1 - tx) + C.phi[y0 * cn + x1] * tx) * (1 - ty) + (C.phi[y1 * cn + x0] * (1 - tx) + C.phi[y1 * cn + x1] * tx) * ty
                }
            }
        }
        let om = min(Float(1.9), 2 / (1 + Float(sin(Double.pi / Double(levels[l].n)))) - 0.05)
        sweep(&levels[l], u * f, 4, 1)
        sweep(&levels[l], u * f, l == 2 ? 100 : l == 1 ? 30 : 16, om)
        sweep(&levels[l], u * f, 8, 1)
    }
    return levels[0].phi
}

private let DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1]
private let DL: [Float] = [1, Float(2.0.squareRoot()), 1, Float(2.0.squareRoot()), 1, Float(2.0.squareRoot()), 1, Float(2.0.squareRoot())]

/// The form of one outline from its coverage raster (N × N, 0–255, over
/// design units [-PAD, 100 + PAD]).
public func bakeBotAvatarForm(_ cov: [UInt8], N: Int, halfDepth: Double) -> BotAvatarForm {
    let u = Float(SPAN) / Float(N), NN = N * N
    var mask = [UInt8](repeating: 0, count: NN)
    for i in 0..<NN { mask[i] = cov[i] >= 128 ? 1 : 0 }

    /* signed distance to the outline, in design units, positive inside;
       antialiased edge texels give the sub-texel offset */
    var dIn = [Float](repeating: 0, count: NN), dOut = [Float](repeating: 0, count: NN), nearIn = [Int32](repeating: 0, count: NN)
    var none: [Int32] = []
    edt2d(mask, 0, N, &dIn, &none, wantNear: false)
    edt2d(mask, 1, N, &dOut, &nearIn, wantNear: true)
    var sd = [Float](repeating: 0, count: NN), tmp = [Float](repeating: 0, count: NN)
    for i in 0..<NN {
        let a = Float(cov[i]) / 255
        sd[i] = u * (a > 0 && a < 1 ? a - 0.5 : mask[i] != 0 ? dIn[i].squareRoot() - 0.5 : 0.5 - dOut[i].squareRoot())
    }
    /* round the medial-axis crease into a ridge (σ ≈ 2.2 texels) */
    blur5(&sd, N, &tmp)
    blur5(&sd, N, &tmp)

    /* the pillow: the torsion function, Δφ = −1 inside and φ = 0 outside */
    let phi = poisson(cov, N, u)
    var phiMax: Float = 0
    for i in 0..<NN where phi[i] > phiMax { phiMax = phi[i] }
    let rIn = 2 * phiMax.squareRoot()
    let hMax = min(0.9 * Float(halfDepth) + 0.12 * rIn, 1.2 * rIn)
    let kh = phiMax > 0 ? hMax / phiMax.squareRoot() : 0
    var h = [Float](repeating: 0, count: NN)
    for i in 0..<NN { h[i] = phi[i] > 0 ? kh * phi[i].squareRoot() : 0 }
    blur5(&h, N, &tmp)

    /* normals, silhouette fix, horizon AO, matcap cells */
    var i00 = [UInt16](repeating: 0, count: NN), wx = [UInt8](repeating: 0, count: NN), wy = [UInt8](repeating: 0, count: NN), ao = [UInt8](repeating: 0, count: NN)
    let STEPS: [Int] = N <= 64 ? [1, 2, 3, 5, 8] : N <= 96 ? [1, 2, 4, 7, 11] : [1, 2, 4, 7, 11, 15]
    let halo: Float = 9 // outside texels within 3 texels borrow their nearest inside texel
    let last = N - 1
    for y in 0..<N {
        for x in 0..<N {
            let i = y * N + x
            let src = mask[i] != 0 ? i : dOut[i] <= halo ? Int(nearIn[i]) : -1
            if src < 0 { continue }
            let sx = src % N, sy = (src - sx) / N
            let xl = sx > 0 ? sx - 1 : 0, xr = sx < last ? sx + 1 : last, yu = sy > 0 ? sy - 1 : 0, yd = sy < last ? sy + 1 : last
            var nx = -(h[sy * N + xr] - h[sy * N + xl]) / (2 * u)
            var ny = -(h[yd * N + sx] - h[yu * N + sx]) / (2 * u)
            var nz: Float = 1
            var len = (nx * nx + ny * ny + 1).squareRoot()
            nx /= len; ny /= len; nz /= len
            let dd = max(0, sd[src])
            if dd < 2 {
                /* toward the in-plane outward direction, so the silhouette grazes */
                var gx = sd[sy * N + xr] - sd[sy * N + xl], gy = sd[yd * N + sx] - sd[yu * N + sx]
                var gl = (gx * gx + gy * gy).squareRoot()
                if gl == 0 { gl = 1 }
                gx /= gl; gy /= gl
                let w = 0.7 * (1 - dd / 2)
                nx += w * (-gx - nx); ny += w * (-gy - ny); nz += w * (0 - nz)
                len = (nx * nx + ny * ny + nz * nz).squareRoot()
                if len == 0 { len = 1 }
                nx /= len; ny /= len; nz /= len
            }
            /* horizon-based occlusion on the height field */
            let h0 = h[src]
            var occ: Float = 0
            for d in 0..<8 {
                var m: Float = 0
                for r in STEPS {
                    var qx = sx + DX[d] * r, qy = sy + DY[d] * r
                    if qx < 0 { qx = 0 } else if qx > last { qx = last }
                    if qy < 0 { qy = 0 } else if qy > last { qy = last }
                    let t = (h[qy * N + qx] - h0) / (Float(r) * u * DL[d])
                    if t > m { m = t }
                }
                occ += m / (1 + m * m).squareRoot()
            }
            let e = 1 - min(1, dd / 3)
            let edge = 1 - 0.2 * e * e
            let aoLin = pow(1 - 0.9 * occ / 8, 1.5) * edge
            ao[i] = UInt8(max(1, (255 * pow(aoLin, 1 / 2.2)).rounded()))
            let fx = (nx * 0.5 + 0.5) * Float(M - 1), fy = (ny * 0.5 + 0.5) * Float(M - 1)
            let cx = min(M - 2, max(0, Int(fx))), cy = min(M - 2, max(0, Int(fy)))
            i00[i] = UInt16(cy * M + cx)
            wx[i] = UInt8((255 * min(1, max(0, fx - Float(cx)))).rounded())
            wy[i] = UInt8((255 * min(1, max(0, fy - Float(cy)))).rounded())
        }
    }
    return BotAvatarForm(N: N, i00: i00, wx: wx, wy: wy, ao: ao)
}

/// Coverage raster of the outline: N × N over design units [-PAD, 100 + PAD].
public func rasterizeBotAvatarOutline(_ path: CGPath, N: Int) -> [UInt8] {
    var cov = [UInt8](repeating: 0, count: N * N)
    guard let g = CGContext(data: nil, width: N, height: N, bitsPerComponent: 8, bytesPerRow: N, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return cov }
    let u = SPAN / Double(N)
    /* a y-down canvas: row 0 of the bitmap is the top */
    g.translateBy(x: 0, y: CGFloat(N))
    g.scaleBy(x: 1, y: -1)
    g.concatenate(CGAffineTransform(a: 1 / u, b: 0, c: 0, d: 1 / u, tx: PAD / u, ty: PAD / u))
    g.setShouldAntialias(true)
    g.setFillColor(gray: 1, alpha: 1)
    g.addPath(path)
    g.fillPath()
    if let data = g.data {
        let p = data.bindMemory(to: UInt8.self, capacity: N * N)
        let stride = g.bytesPerRow
        for y in 0..<N { for x in 0..<N { cov[y * N + x] = p[y * stride + x] } }
    }
    return cov
}

/// Texture size for an avatar `devicePx` wide (points × the display scale, capped at 2).
public func botAvatarTier(_ devicePx: Double) -> Int {
    devicePx <= 100 ? 64 : devicePx <= 224 ? 96 : 128
}

/* ── the form cache, with background bakes ─────────────────────────── */

private struct FormKey: Hashable { var key: String; var N: Int; var halfDepth: Int }
private var forms: [FormKey: BotAvatarForm] = [:]
private var pending: Set<FormKey> = []
private let formLock = NSLock()
/// bakes run one at a time on a background queue, so a screen full of types
/// never stacks all of them into one frame
private let bakeQueue = DispatchQueue(label: "bot-avatars.plastic.bake", qos: .userInitiated)

/// The form for an outline, built now (`sync`) or in the background (nil until then).
func formFor(key: String, path: CGPath, N: Int, halfDepth: Double, sync: Bool) -> BotAvatarForm? {
    let id = FormKey(key: key, N: N, halfDepth: Int(halfDepth.rounded()))
    formLock.lock()
    if let hit = forms[id] { formLock.unlock(); return hit }
    let build = { () -> BotAvatarForm in
        let cov = rasterizeBotAvatarOutline(path, N: N)
        return bakeBotAvatarForm(cov, N: N, halfDepth: halfDepth)
    }
    if sync {
        formLock.unlock()
        let form = build()
        formLock.lock()
        if forms.count >= 48 { forms.removeAll() }
        forms[id] = form
        formLock.unlock()
        return form
    }
    if !pending.contains(id) {
        pending.insert(id)
        bakeQueue.async {
            let form = build()
            formLock.lock()
            if forms.count >= 48 { forms.removeAll() }
            forms[id] = form
            pending.remove(id)
            formLock.unlock()
        }
    }
    formLock.unlock()
    return nil
}

/// Build a form ahead of time, in the background.
public func warmBotAvatarPlastic(_ type: BotAvatarType, devicePx: Double = 192, depth: Double = 0.65) {
    _ = formFor(key: type.rawValue, path: type.shapeCGPath, N: botAvatarTier(devicePx), halfDepth: 15 * depth, sync: false)
    if let parts = type.partsCGPath {
        _ = formFor(key: type.rawValue + ":parts", path: parts, N: botAvatarTier(devicePx), halfDepth: 15 * depth * 0.4, sync: false)
    }
}

/* ── colour tables ─────────────────────────────────────────────────── */

/* tone map (soft shoulder above 0.75, keeps hue) + sRGB encode, as a table */
private let TONE_N = 2048, TONE_MAX = 2.5, TONE_SCALE = Double(TONE_N) / TONE_MAX
private let toneLut: [Float] = (0..<TONE_N).map { i in
    let v = (Double(i) + 0.5) / TONE_SCALE
    let y = v <= 0.75 ? v : 0.75 + 0.25 * (1 - exp(-(v - 0.75) / 0.25))
    return Float(255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * pow(y, 1 / 2.4) - 0.055))
}
@inline(__always) private func tone(_ v: Double) -> Float {
    toneLut[v <= 0 ? 0 : v >= TONE_MAX ? TONE_N - 1 : Int(v * TONE_SCALE)]
}

/* x^e over x ∈ [0, 1], as a table, cached by exponent */
private let POW_N = 1024
private var powLuts: [Int: [Double]] = [:]
private func powLut(_ e: Int) -> [Double] {
    if let t = powLuts[e] { return t }
    let t = (0...POW_N).map { pow(Double($0) / Double(POW_N), Double(e)) }
    if powLuts.count > 16 { powLuts.removeAll() }
    powLuts[e] = t
    return t
}

/* ── the matcap: the material evaluated for every normal ───────────── */

public struct BotAvatarMaterial: Equatable {
    public var shadow: Double, highlight: Double, spread: Double, rim: Double
}
/// Light and view directions in the cap's own frame.
public struct BotAvatarCapFrame {
    var L: V3, V: V3, H: V3, U: V3, W: V3, A: V3, B: V3
}
private let ENV = V3(0.92, 0.96, 1.0)
private let WARM = V3(1, 0.98, 0.95)
@inline(__always) private func smoothstep(_ a: Double, _ b: Double, _ v: Double) -> Double {
    let t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a)
    return t * t * (3 - 2 * t)
}
/* 1 inside |x| < w, falling to 0 over ±s around it */
@inline(__always) private func soft(_ w: Double, _ s: Double, _ x: Double) -> Double { 1 - smoothstep(w - s, w + s, x) }

/// Fill `out` (M × M × rgb, sRGB 0–255) with the lit sphere for body colour `c` (linear).
func buildMatcap(_ out: inout [Float], _ c: V3, _ f: BotAvatarCapFrame, _ p: BotAvatarMaterial) {
    let L = f.L, V = f.V, H = f.H, U = f.U, W = f.W, A = f.A, B = f.B
    let mx = max(c[0], c[1], c[2], 0.05)
    let tint = V3(c[0] / mx, c[1] / mx, c[2] / mx)
    let amb = max(0.03, 0.30 - 0.15 * p.shadow)
    let wrap = 0.15 + 0.14 * p.spread
    let kd = 0.85
    let e1 = min(90, Int((110 / pow(p.spread, 1.3)).rounded())), e2 = max(2, Int((8 / p.spread).rounded()))
    let lut1 = powLut(e1), lut2 = powLut(e2)
    let ks1 = 0.45 * p.highlight, ks2 = 0.10 * p.highlight, winK = 0.11 * p.highlight, rimK = 0.30 * p.rim
    let ambT = V3(amb * tint[0], amb * tint[1], amb * tint[2])
    out.withUnsafeMutableBufferPointer { op in
        let out = op.baseAddress!
        lut1.withUnsafeBufferPointer { l1p in lut2.withUnsafeBufferPointer { l2p in
            let lut1 = l1p.baseAddress!, lut2 = l2p.baseAddress!
            for j in 0..<M {
                for i in 0..<M {
                    var nx = (Double(i) / Double(M - 1)) * 2 - 1, ny = (Double(j) / Double(M - 1)) * 2 - 1
                    var r2 = nx * nx + ny * ny
                    /* samples lie inside the unit disc and read one cell beyond it at
                       most: the corners are never read */
                    if r2 > 1.14 { continue }
                    if r2 > 1 {
                        let s = 1 / r2.squareRoot()
                        nx *= s; ny *= s; r2 = 1
                    }
                    let nz = (1 - r2).squareRoot()
                    let nl = nx * L[0] + ny * L[1] + nz * L[2]
                    let nv = max(0, nx * V[0] + ny * V[1] + nz * V[2])
                    let nh = max(0, nx * H[0] + ny * H[1] + nz * H[2])
                    let dif = min(1, max(0, (nl + wrap) / (1 + wrap)))
                    let q = 1 - nv, q2 = q * q, f3 = q2 * q, f5 = f3 * q2
                    let ni = Int(nh * Double(POW_N))
                    let spec = (ks1 * lut1[ni] + ks2 * lut2[ni]) * (1 + 3 * f5)
                    /* the mirror direction: sky/floor gradient and the window */
                    let rx = 2 * nv * nx - V[0], ry = 2 * nv * ny - V[1], rz = 2 * nv * nz - V[2]
                    let sky = 0.45 + 0.55 * smoothstep(-0.4, 0.6, rx * U[0] + ry * U[1] + rz * U[2])
                    let rw = rx * W[0] + ry * W[1] + rz * W[2]
                    var win = 0.0
                    if rw > 0.5 {
                        let ra = (rx * A[0] + ry * A[1] + rz * A[2]) / rw, rb = (rx * B[0] + ry * B[1] + rz * B[2]) / rw
                        win = soft(0.34, 0.12, abs(ra)) * soft(0.12, 0.06, abs(rb))
                    }
                    let env = rimK * f3 * sky + winK * win
                    let k = (j * M + i) * 3
                    out[k] = tone(c[0] * (ambT[0] + kd * dif) + spec * WARM[0] + env * ENV[0])
                    out[k + 1] = tone(c[1] * (ambT[1] + kd * dif) + spec * WARM[1] + env * ENV[1])
                    out[k + 2] = tone(c[2] * (ambT[2] + kd * dif) + spec * WARM[2] + env * ENV[2])
                }
            }
        } }
    }
}

/// Bilinear read of the matcap at a normal's (nx, ny).
private func sampleMatcap(_ mc: [Float], _ nx: Double, _ ny: Double) -> V3 {
    let fx = (nx * 0.5 + 0.5) * Double(M - 1), fy = (ny * 0.5 + 0.5) * Double(M - 1)
    let cx = min(M - 2, max(0, Int(fx))), cy = min(M - 2, max(0, Int(fy)))
    let x = fx - Double(cx), y = fy - Double(cy), b = (cy * M + cx) * 3, R = M * 3
    let w00 = (1 - x) * (1 - y), w10 = x * (1 - y), w01 = (1 - x) * y, w11 = x * y
    var out = V3()
    for ch in 0..<3 {
        out[ch] = Double(mc[b + ch]) * w00 + Double(mc[b + 3 + ch]) * w10 + Double(mc[b + R + ch]) * w01 + Double(mc[b + R + 3 + ch]) * w11
    }
    return out
}

/// Per frame: matcap lookup × baked AO into the texture's pixels (premultiplied RGBA).
func shadeTexels(_ form: BotAvatarForm, _ mc: [Float], _ px: UnsafeMutablePointer<UInt8>, _ aoMul: [Float]) {
    let N = form.N
    let R = M * 3
    form.i00.withUnsafeBufferPointer { i00p in form.wx.withUnsafeBufferPointer { wxp in form.wy.withUnsafeBufferPointer { wyp in form.ao.withUnsafeBufferPointer { aop in mc.withUnsafeBufferPointer { mcp in aoMul.withUnsafeBufferPointer { amp in
        let i00 = i00p.baseAddress!, wx = wxp.baseAddress!, wy = wyp.baseAddress!, ao = aop.baseAddress!, mc = mcp.baseAddress!, aoMul = amp.baseAddress!
        var k = 0
        for i in 0..<(N * N) {
            let a = ao[i]
            if a == 0 {
                px[k] = 0; px[k + 1] = 0; px[k + 2] = 0; px[k + 3] = 0
                k += 4
                continue
            }
            let m = aoMul[Int(a)]
            let b = Int(i00[i]) * 3, x = Float(wx[i]) * (1 / 255), y = Float(wy[i]) * (1 / 255)
            let w00 = (1 - x) * (1 - y) * m, w10 = x * (1 - y) * m, w01 = (1 - x) * y * m, w11 = x * y * m
            let r = mc[b] * w00 + mc[b + 3] * w10 + mc[b + R] * w01 + mc[b + R + 3] * w11
            let g = mc[b + 1] * w00 + mc[b + 4] * w10 + mc[b + R + 1] * w01 + mc[b + R + 4] * w11
            let bl = mc[b + 2] * w00 + mc[b + 5] * w10 + mc[b + R + 2] * w01 + mc[b + R + 5] * w11
            px[k] = UInt8(min(255, max(0, r + 0.5)))
            px[k + 1] = UInt8(min(255, max(0, g + 0.5)))
            px[k + 2] = UInt8(min(255, max(0, bl + 0.5)))
            px[k + 3] = 255
            k += 4
        }
    } } } } } }
}

/* ── the cap's frame: light and view in the cap's own space ────────── */

/// The rig's numbers the material needs for one frame.
struct PlasticRig {
    /** the rig's (floored) cos/sin of yaw and pitch, as used by the slice affines */
    var cy: Double, sy: Double, cp: Double, sp: Double
    /** cos(yaw)·cos(pitch), unfloored: the front cap faces the viewer while positive */
    var facing: Double
    var roll: Double
    var halfDepth: Double
    var cap: Double
    /** unit vector toward the light on screen */
    var lx: Double, ly: Double
    /** the avatar box in device pixels (points × scale) */
    var dev: Double
    /** the transform for body space */
    var ctm: CGAffineTransform
    /** no animation loop will follow: build the form now rather than in the background */
    var still: Bool
}

@inline(__always) private func norm3(_ v: V3) -> V3 {
    var l = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).squareRoot()
    if l == 0 { l = 1 }
    return v / l
}

/// Screen-space vectors into the cap's frame: un-roll, then the transpose
/// of the rig's rotation; the back cap is the front mirrored in z.
func capFrame(_ r: PlasticRig) -> BotAvatarCapFrame {
    let cr = cos(r.roll), sr = sin(r.roll)
    let lx = cr * r.lx + sr * r.ly, ly = -sr * r.lx + cr * r.ly
    let mirror: Double = r.facing < 0 ? -1 : 1
    /* the flip passes through edge-on: fade the mirrored component so the
       light does not pop from one side of the sliver to the other */
    let zf = mirror * min(1, abs(r.facing) / 0.16)
    let cy = r.cy, sy = r.sy, cp = r.cp, sp = r.sp
    func local(_ x: Double, _ y: Double, _ z: Double, _ zk: Double) -> V3 {
        norm3(V3(cy * x + sy * sp * y - sy * cp * z, cp * y + sp * z, zk * (sy * x - cy * sp * y + cy * cp * z)))
    }
    let L = local(E_XY * lx, E_XY * ly, E_Z, zf)
    let V = local(0, 0, 1, mirror)
    let H = norm3(L + V)
    let U = local(lx, ly, 0, mirror)
    /* the window: 80° round from the light, 34° off the view axis */
    let cw = cos(80 * Double.pi / 180), sw = sin(80 * Double.pi / 180)
    let wx = cw * lx - sw * ly, wy = sw * lx + cw * ly
    let Ws = norm3(V3(0.55 * wx, 0.55 * wy, 0.83))
    let As = norm3(V3(Ws[1], -Ws[0], 0))
    let Bs = V3(Ws[1] * As[2] - Ws[2] * As[1], Ws[2] * As[0] - Ws[0] * As[2], Ws[0] * As[1] - Ws[1] * As[0])
    let W = local(Ws[0], Ws[1], Ws[2], mirror), A = local(As[0], As[1], As[2], mirror), B = local(Bs[0], Bs[1], Bs[2], mirror)
    return BotAvatarCapFrame(L: L, V: V, H: H, U: U, W: W, A: A, B: B)
}

/* ── per-instance state, one per outline ───────────────────────────── */

/// The plastic material's per-avatar, per-outline state: the matcap it
/// holds, the cross-fade, the texels as an image, the side gradients.
final class PlasticState {
    var N = 0
    var mc = [Float](repeating: 0, count: MM * 3)
    /** what the matcap holds: the light and view directions, the light on
        screen, the colour and the material; rebuilt when any moves */
    var L: V3? = nil
    var V: V3? = nil
    var lx = Double.nan, ly = Double.nan
    var base: BotColor? = nil
    var shadow = Double.nan, highlight = Double.nan, spread = Double.nan, rim = Double.nan
    /** bumped on every matcap rebuild */
    var version = 0
    /** the matcap the texels show: the last one cross-faded into the new
        one over as many frames as the last bin took */
    var mcPrev = [Float](repeating: 0, count: MM * 3)
    var mcMix = [Float](repeating: 0, count: MM * 3)
    var mixVersion = 0
    var blendT = 1.0
    var blendFrames = 1
    var sinceBuild = 0
    var imgVersion = -1
    var imgAoK = Double.nan
    var imgForm: BotAvatarForm? = nil
    var aoK = -1.0
    var aoMul = [Float](repeating: 0, count: 256)
    /** the texels: a bitmap context whose data is rewritten, and the
        image made from it when the texels change */
    var texelCtx: CGContext? = nil
    var image: Image? = nil
    /** side gradients sampled from the matcap: the near shoulder, the rim, the far shoulder */
    var near: GraphicsContext.Shading? = nil
    var rimG: GraphicsContext.Shading? = nil
    var far: GraphicsContext.Shading? = nil
    /** how many frames the plastic drew (for the demo's counters) */
    var texelUpdates = 0
    var matcapBuilds = 0
}

/* the matcap is rebuilt once a direction has moved a bin (1/48) from the
   one it was built for */
private let BIN = 1.0 / 48
@inline(__always) private func moved(_ a: V3, _ b: V3?) -> Bool {
    guard let b = b else { return true }
    return abs(a[0] - b[0]) >= BIN || abs(a[1] - b[1]) >= BIN || abs(a[2] - b[2]) >= BIN
}

private func sideGradient(_ mc: [Float], _ nz: Double, _ dark: Double) -> GraphicsContext.Shading {
    let rr = (1 - nz * nz).squareRoot(), k = 1 - dark
    var stops: [Gradient.Stop] = []
    stops.reserveCapacity(CONIC_STOPS + 1)
    for s in 0...CONIC_STOPS {
        let phi = (Double(s) / Double(CONIC_STOPS)) * Double.pi * 2
        let c = sampleMatcap(mc, rr * cos(phi), rr * sin(phi))
        stops.append(Gradient.Stop(color: Color(.sRGB, red: floor(c[0] * k) / 255, green: floor(c[1] * k) / 255, blue: floor(c[2] * k) / 255, opacity: 1), location: Double(s) / Double(CONIC_STOPS)))
    }
    return .conicGradient(Gradient(stops: stops), center: CGPoint(x: 50, y: 50), angle: .zero)
}

private let sRGBSpace = CGColorSpace(name: CGColorSpace.sRGB)!

/// Draw the plastic body: the side copies (far → near) with gradients from
/// the matcap, then the front cap as a lit texture under a vector clip.
/// Call inside the body transform. Returns false when the form is not
/// built yet (it is being built in the background): draw the stock slices
/// that frame.
func drawPlasticCap(_ ctx: inout GraphicsContext, path: Path, cgPath: CGPath, key: String, rig: PlasticRig, st: PlasticState, base: BotColor, mat: BotAvatarMaterial, merged: Bool) -> Bool {
    let N = botAvatarTier(rig.dev)
    guard let form = formFor(key: key, path: cgPath, N: N, halfDepth: rig.halfDepth, sync: rig.still) else { return false }
    let f = capFrame(rig)
    let l = (f.L[0] * f.L[0] + f.L[1] * f.L[1]).squareRoot()
    let lxy: (Double, Double) = l < 0.05 ? (0, -1) : (f.L[0] / l, f.L[1] / l)
    if moved(f.L, st.L) || moved(f.V, st.V) || rig.lx != st.lx || rig.ly != st.ly || base != st.base ||
        mat.shadow != st.shadow || mat.highlight != st.highlight || mat.spread != st.spread || mat.rim != st.rim {
        /* the fade starts from what is showing now, so a rebuild during a
           fade does not jump */
        if st.version > 0 { st.mcPrev = st.mcMix }
        buildMatcap(&st.mc, base.linear, f, mat)
        st.matcapBuilds += 1
        if st.version == 0 {
            st.mcMix = st.mc
            st.blendT = 1
        } else {
            st.blendFrames = min(10, max(1, st.sinceBuild))
            st.blendT = 0
        }
        st.sinceBuild = 0
        st.mixVersion += 1
        st.L = f.L
        st.V = f.V
        st.lx = rig.lx
        st.ly = rig.ly
        st.base = base
        st.shadow = mat.shadow
        st.highlight = mat.highlight
        st.spread = mat.spread
        st.rim = mat.rim
        st.version += 1
        st.near = nil; st.rimG = nil; st.far = nil
    }
    st.sinceBuild += 1
    if st.blendT < 1 {
        st.blendT = min(1, st.blendT + 1 / Double(st.blendFrames))
        let e = Float(st.blendT >= 1 ? 1 : st.blendT * st.blendT * (3 - 2 * st.blendT))
        st.mcPrev.withUnsafeBufferPointer { ap in st.mc.withUnsafeBufferPointer { bp in st.mcMix.withUnsafeMutableBufferPointer { op in
            let a = ap.baseAddress!, b = bp.baseAddress!, o = op.baseAddress!
            for i in 0..<(MM * 3) { o[i] = a[i] + (b[i] - a[i]) * e }
        } } }
        st.mixVersion += 1
    }
    /* the occlusion strength follows `shadow` */
    let aoK = min(1.3, 1.2 * mat.shadow)
    if aoK != st.aoK {
        for a in 0..<256 { st.aoMul[a] = Float(max(0, 1 - aoK * (1 - Double(a) / 255))) }
        st.aoK = aoK
    }
    if st.texelCtx == nil || st.N != N {
        st.texelCtx = CGContext(data: nil, width: N, height: N, bitsPerComponent: 8, bytesPerRow: N * 4, space: sRGBSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        st.N = N
        st.imgVersion = -1
    }
    guard let tc = st.texelCtx, let data = tc.data else { return false }
    if st.imgVersion != st.mixVersion || st.imgAoK != aoK || st.imgForm !== form {
        shadeTexels(form, st.mcMix, data.bindMemory(to: UInt8.self, capacity: N * N * 4), st.aoMul)
        st.imgVersion = st.mixVersion
        st.imgAoK = aoK
        st.imgForm = form
        if let cg = tc.makeImage() {
            st.image = Image(decorative: cg, scale: 1).interpolation(.high)
        }
        st.texelUpdates += 1
    }
    guard let image = st.image else { return false }

    if st.near == nil {
        st.near = sideGradient(st.mc, 0.55, 0)
        st.rimG = sideGradient(st.mc, 0, 0)
        st.far = sideGradient(st.mc, 0, min(0.6, 0.25 * mat.shadow))
    }
    let near = st.near!, rimG = st.rimG!, far = st.far!

    /* 1. the side copies, far → near, without the nearest (the texture is
       the whole front); the shoulder nearest the cap reads the matcap at a
       57° tilt, the equator its rim, the far half its rim in shade */
    let cy = rig.cy, sy = rig.sy, cp = rig.cp, sp = rig.sp, halfDepth = rig.halfDepth, cap = rig.cap
    let order: Double = rig.facing >= 0 ? 1 : -1
    let ctm = rig.ctm
    /* yaw about Y then pitch about X, orthographic: an affine per slice,
       then the path's own origin at its centre */
    func sliceAffine(_ j: Int) -> (CGAffineTransform, Int) {
        let k = order > 0 ? j : PLASTIC_SLICES - 1 - j
        let z = -1 + (2 * Double(k)) / Double(PLASTIC_SLICES - 1)
        let s = pillowProfile(z, cap)
        let zn = z * order // toward the viewer
        let m0 = cy * s, m1 = sy * sp * s, m3 = cp * s
        let e = z * sy * halfDepth - 50 * m0, fo = -z * cy * sp * halfDepth - 50 * m1 - 50 * m3
        return (CGAffineTransform(a: m0, b: m1, c: 0, d: m3, tx: e, ty: fo), zn > 0.4 ? 0 : zn >= 0 ? 1 : 2)
    }
    if merged {
        /* the slices of a kind (far → near: the far shoulder, the rim, the
           near shoulder) as one union path, filled once with that kind's
           gradient centred on the run's middle slice: three path fills
           instead of sixteen. The gradient's centre is off by at most a
           few body units on the outer slices, where only a sliver shows. */
        var j = 0
        while j < PLASTIC_SLICES - 1 {
            let (_, kind) = sliceAffine(j)
            var end = j
            while end + 1 < PLASTIC_SLICES - 1 && sliceAffine(end + 1).1 == kind { end += 1 }
            let (mid, _) = sliceAffine((j + end) / 2)
            let inv = mid.inverted()
            var u = Path()
            for i in j...end {
                let (t, _) = sliceAffine(i)
                u.addPath(path, transform: t.concatenating(inv))
            }
            ctx.transform = mid.concatenating(ctm)
            ctx.fill(u, with: kind == 0 ? near : kind == 1 ? rimG : far)
            j = end + 1
        }
    } else {
        for j in 0..<(PLASTIC_SLICES - 1) {
            let (t, kind) = sliceAffine(j)
            ctx.transform = t.concatenating(ctm)
            ctx.fill(path, with: kind == 0 ? near : kind == 1 ? rimG : far)
        }
    }
    ctx.transform = ctm

    /* 2. the cap. The texture is the front surface seen head-on: its outer
       units are the rounded shoulder. Turned, the front's projection runs
       from the equator on the trailing side to the shoulder's silhouette on
       the leading side, so the texture is stretched along the turn to span
       exactly that (no stretch head-on). */
    let inv = 1 / (cy * cp)
    let dx = sy * halfDepth / cy, dy = -sp * halfDepth * inv // the depth axis, in the equator's own units
    let dl = (dx * dx + dy * dy).squareRoot()
    let ex = dl > 1e-6 ? (order * dx) / dl : 1, ey = dl > 1e-6 ? (order * dy) / dl : 0
    let lead = 50 * cap + ((50 * (1 - cap)) * (50 * (1 - cap)) + dl * dl).squareRoot()
    let stretch = (lead + 50) / 100, shift = (lead - 50) / 2
    let a = 1 + (stretch - 1) * ex * ex, b = (stretch - 1) * ex * ey, d = 1 + (stretch - 1) * ey * ey
    let capM = CGAffineTransform(a: a, b: b, c: b, d: d, tx: shift * ex - 50 * a - 50 * b, ty: shift * ey - 50 * b - 50 * d)
        .concatenating(CGAffineTransform(a: cy, b: sy * sp, c: 0, d: cp, tx: 0, ty: 0))
        .concatenating(ctm)
    /* the texels as a fill of the outline: one primitive, no clip pass */
    ctx.transform = capM
    ctx.fill(path, with: .tiledImage(image, origin: CGPoint(x: -PAD, y: -PAD), scale: SPAN / Double(N)))
    ctx.transform = ctm

    /* 3. large avatars: the texture is upscaled 2–3×, so a crisp hairline of
       the environment along the lit side of the silhouette */
    if rig.dev >= 256 && mat.rim > 0 && mat.highlight > 0 {
        var c = ctx
        c.transform = capM
        c.clip(to: path)
        let al = min(0.5, 0.3 * mat.rim * min(1.4, mat.highlight))
        let g = Gradient(stops: [
            .init(color: Color(.sRGB, red: 235 / 255, green: 244 / 255, blue: 1, opacity: al), location: 0),
            .init(color: Color(.sRGB, red: 235 / 255, green: 244 / 255, blue: 1, opacity: 0.35 * al), location: 0.45),
            .init(color: Color(.sRGB, red: 235 / 255, green: 244 / 255, blue: 1, opacity: 0), location: 0.75),
        ])
        c.stroke(path, with: .linearGradient(g, startPoint: CGPoint(x: 50 + lxy.0 * 50, y: 50 + lxy.1 * 50), endPoint: CGPoint(x: 50 - lxy.0 * 50, y: 50 - lxy.1 * 50)), style: StrokeStyle(lineWidth: 1.3, lineJoin: .round))
    }
    return true
}
