import Foundation
import Accelerate
import simd

/// Where a magnet is, from one magnetometer reading: a small network
/// (7 → 512 → 512 → 512 → 256 → 6, ~660k weights, 1.3 MB in half precision)
/// trained only on simulated magnet physics — a dipole hovering over a phone
/// at random heights, tilts, faces and strengths, with sensor noise, drift
/// and small distortions. No data from users went into it.
///
/// It answers relative to the magnetometer, in device axes, so any iPhone
/// works once its sensor spot is known (`MagnetConfig.sensorPosition`):
/// one forward pass per reading, run with Accelerate — no Core ML.
///
/// Accuracy is best near the sensor and falls off with distance from it;
/// the network reports its own spread so the UI can soften what it is unsure
/// of. Knowing which face of the magnet points at the screen matters: without
/// it, a magnet beside or above the sensor reads the same as a flipped one on
/// the other side, and the network falls back on "usually below the sensor".
public final class MagnetLocator {
    private struct Layer {
        let inN: Int, outN: Int
        let w: [Float]      // outN × inN, row-major
        let b: [Float]
        let silu: Bool
    }

    private let layers: [Layer]
    private let logbMid: Float, logkMid: Float, logrMid: Float
    private let lvMin: Float, lvMax: Float
    /// Whether this file's network takes the magnet's face (version 3+).
    public let takesFace: Bool
    private var scratchA: [Float] = []
    private var scratchB: [Float] = []

    /// Parse an MFXL file: "MFXL", a little-endian UInt32 header length, a
    /// JSON header, then float16 weights and biases layer by layer.
    public init?(data: Data) {
        guard data.count > 8, data.prefix(4) == Data("MFXL".utf8) else { return nil }
        let hlen = Int(data[4]) | Int(data[5]) << 8 | Int(data[6]) << 16 | Int(data[7]) << 24
        guard data.count >= 8 + hlen,
              let header = try? JSONSerialization.jsonObject(with: data.subdata(in: 8..<(8 + hlen))) as? [String: Any],
              let specs = header["layers"] as? [[String: Any]] else { return nil }
        logbMid = Float(header["logbMid"] as? Double ?? log(40))
        logkMid = Float(header["logkMid"] as? Double ?? log(10000))
        logrMid = Float(header["logrMid"] as? Double ?? log(5))
        guard let version = header["version"] as? Int, version == 2 || version == 3 else { return nil }
        let clamp = header["logvarClamp"] as? [Double] ?? [-10, 4]
        lvMin = Float(clamp.first ?? -10); lvMax = Float(clamp.last ?? 4)

        var offset = 8 + hlen
        func halves(_ count: Int) -> [Float]? {
            let bytes = count * 2
            guard offset + bytes <= data.count else { return nil }
            var out = [Float](repeating: 0, count: count)
            data.withUnsafeBytes { raw in
                let base = raw.baseAddress!.advanced(by: offset)
                for i in 0..<count {
                    let lo = UInt16(base.load(fromByteOffset: i * 2, as: UInt8.self))
                    let hi = UInt16(base.load(fromByteOffset: i * 2 + 1, as: UInt8.self))
                    out[i] = Self.halfToFloat(lo | hi << 8)
                }
            }
            offset += bytes
            return out
        }
        var parsed: [Layer] = []
        for s in specs {
            guard let inN = s["in"] as? Int, let outN = s["out"] as? Int,
                  let w = halves(inN * outN), let b = halves(outN) else { return nil }
            parsed.append(Layer(inN: inN, outN: outN, w: w, b: b, silu: (s["act"] as? String) == "silu"))
        }
        let nIn = version == 3 ? 7 : 6
        guard parsed.first?.inN == nIn, parsed.last?.outN == 6 else { return nil }
        layers = parsed
        takesFace = version == 3
        let widest = parsed.map { max($0.inN, $0.outN) }.max() ?? 6
        scratchA = [Float](repeating: 0, count: widest)
        scratchB = [Float](repeating: 0, count: widest)
    }

    /// Where the magnet is relative to the sensor (cm, device axes: x right,
    /// y toward the top edge, z out of the screen) and the network's 1-σ
    /// spread of that position, cm.
    /// - Parameters:
    ///   - field: change in µT since the baseline, device axes.
    ///   - strength: the magnet's dipole constant in µT·cm³ if known (a 10×8×2 mm
    ///     N52 ring is ~6500), nil if not.
    ///   - face: +1 if the magnet's north pole points out of the screen
    ///     (toward the user), −1 if south, nil if not known.
    public func locate(field raw: SIMD3<Double>, strength: Double?, face: Int? = nil) -> (position: SIMD3<Double>, spread: Double)? {
        let nb = simd_length(raw)
        guard nb > 1e-6 else { return nil }
        let knownFace = takesFace ? face.map { $0 < 0 ? -1.0 : 1.0 } : nil
        // Known face: turn the field to face +1. Unknown: a flipped magnet
        // gives −B at the same spot, so the network sees one face (Bz ≥ 0).
        let field = knownFace.map { raw * $0 } ?? (raw.z < 0 ? -raw : raw)
        var input: [Float] = [
            Float(field.x / nb), Float(field.y / nb), Float(field.z / nb),
            (Float(log(nb)) - logbMid) / 2,
            strength.map { (Float(log(max(1, $0))) - logkMid) / 1.5 } ?? 0,
            strength == nil ? 0 : 1,
        ]
        if takesFace { input.append(knownFace == nil ? 0 : 1) }
        for i in input.indices { scratchA[i] = input[i] }
        var cur = 0   // 0: scratchA holds the activations, 1: scratchB
        for L in layers {
            let src = cur == 0 ? scratchA : scratchB
            var dst = [Float](repeating: 0, count: L.outN)
            L.w.withUnsafeBufferPointer { w in
                src.withUnsafeBufferPointer { x in
                    dst.withUnsafeMutableBufferPointer { y in
                        // y = W · x   (outN×inN · inN×1)
                        vDSP_mmul(w.baseAddress!, 1, x.baseAddress!, 1, y.baseAddress!, 1,
                                  vDSP_Length(L.outN), 1, vDSP_Length(L.inN))
                    }
                }
            }
            vDSP_vadd(dst, 1, L.b, 1, &dst, 1, vDSP_Length(L.outN))
            if L.silu {
                // x · sigmoid(x)
                var neg = [Float](repeating: 0, count: L.outN)
                var minus: Float = -1
                vDSP_vsmul(dst, 1, &minus, &neg, 1, vDSP_Length(L.outN))
                var count = Int32(L.outN)
                vvexpf(&neg, neg, &count)
                var one: Float = 1
                vDSP_vsadd(neg, 1, &one, &neg, 1, vDSP_Length(L.outN))
                vDSP_vdiv(neg, 1, dst, 1, &dst, 1, vDSP_Length(L.outN))
            }
            if cur == 0 {
                for i in 0..<L.outN { scratchB[i] = dst[i] }
                cur = 1
            } else {
                for i in 0..<L.outN { scratchA[i] = dst[i] }
                cur = 0
            }
        }
        let o = cur == 0 ? scratchA : scratchB
        // Direction from the sensor and distance: p = r · û.
        let d = SIMD3(Double(o[0]), Double(o[1]), Double(o[2]))
        let dl = simd_length(d)
        guard dl > 1e-9 else { return nil }
        let r = Double(exp(o[3] + logrMid))
        func sd(_ v: Float) -> Double { Double(exp(0.5 * min(lvMax, max(lvMin, v)))) }
        let spread = r * hypot(sd(o[4]), sd(o[5]))      // radial (relative) and sideways (angle) parts
        return (d / dl * r, spread)
    }

    private static func halfToFloat(_ h: UInt16) -> Float {
        let sign = UInt32(h >> 15) << 31
        let exp = Int((h >> 10) & 0x1f)
        let mant = UInt32(h & 0x3ff)
        if exp == 0 {
            if mant == 0 { return Float(bitPattern: sign) }
            // Subnormal half.
            let v = Float(mant) * powf(2, -24)
            return sign != 0 ? -v : v
        }
        if exp == 31 { return Float(bitPattern: sign | 0x7f80_0000 | (mant << 13)) }
        return Float(bitPattern: sign | UInt32(exp - 15 + 127) << 23 | mant << 13)
    }
}

/// Where an upright magnet is, worked out directly from the physics: no
/// network, exact for a magnet whose axis points roughly at the screen
/// (standing, or held flat-on), anywhere above the sensor's height — over the
/// glass or beside the phone. It needs the magnet's face; the strength only
/// sets the distance (2× off moves the answer by about a quarter).
///
/// For such a magnet the field direction gives the bearing exactly:
/// with u = (sin α cos φ, sin α sin φ, cos α) from the sensor to the magnet,
/// B ∝ face · (3 cos α sin α cos φ, 3 cos α sin α sin φ, 3 cos²α − 1), and
/// |B| = K √(1 + 3 cos²α) / r³.
public enum MagnetDipole {
    /// cos²α from the field's vertical share q = face·Bz/|B| (closed form).
    static func cos2(_ q: Double) -> Double {
        let q = min(1, max(-1, q))
        let u = (q + (q * q + 8).squareRoot()) / 2         // √(1 + 3 cos²α)
        return min(1, max(0, (u * u - 1) / 3))
    }

    /// The magnet's position relative to the sensor (cm, device axes: x right,
    /// y toward the top edge, z out of the screen), and how much of the field
    /// lies in the screen's plane (0–1: small means the bearing is fragile —
    /// a magnet resting at the sensor's own height).
    /// - Parameters:
    ///   - field: change since the baseline, µT, device axes.
    ///   - face: +1 north toward the user, −1 south.
    ///   - strength: dipole constant, µT·cm³.
    ///   - maxHeight: cap on the height above the sensor, cm. Far from the
    ///     sensor a hand's tilt makes the magnet look higher than it is, which
    ///     pulls it in toward the sensor; a cap keeps the distance honest.
    public static func locate(field b: SIMD3<Double>, face: Int, strength: Double, maxHeight: Double? = nil) -> (position: SIMD3<Double>, inPlane: Double)? {
        let nb = simd_length(b)
        guard nb > 1e-6, strength > 0 else { return nil }
        let f: Double = face < 0 ? -1 : 1
        let c2 = cos2(f * b.z / nb)
        let c = c2.squareRoot(), s = max(0, 1 - c2).squareRoot()
        var phi = atan2(b.y, b.x)
        if f < 0 { phi += .pi }
        let r = pow(strength * (1 + 3 * c2).squareRoot() / nb, 1.0 / 3.0)
        let inPlane = (b.x * b.x + b.y * b.y).squareRoot() / nb
        var h = r * c, lateral = r * s
        if let cap = maxHeight, h > cap { h = cap; lateral = max(0, r * r - h * h).squareRoot() }
        return (SIMD3(lateral * cos(phi), lateral * sin(phi), h), inPlane)
    }

    /// Learn the face and strength from one reading with the magnet held over
    /// a known spot (`offset`: from the sensor, cm, device axes, in the screen
    /// plane). Each face, at heights from 0.6 to 3.6 cm above the sensor,
    /// predicts a direction for the field; the face and height that match the
    /// reading best win, and the strength follows from the size of the field
    /// there. The whole direction counts: a few cm to the side of the sensor
    /// the field is mostly vertical (its sign alone gives the face), while the
    /// sideways part that carries the bearing is small and swings with the
    /// magnet's tilt in the fingers — judged by the bearing alone, 1 grab in 9
    /// hovering under 2 cm got the face wrong (simulated, tilts up to 35°).
    /// Best with the spot 2–5 cm from the sensor.
    public static func learn(field b: SIMD3<Double>, magnetAt offset: SIMD2<Double>) -> (face: Int, strength: Double)? {
        let nb = simd_length(b), lateral = simd_length(offset)
        guard nb > 1e-6, lateral > 0.5 else { return nil }
        let u = b / nb
        var best: (score: Double, face: Int, strength: Double)?
        for face in [1, -1] {
            let m = SIMD3<Double>(0, 0, Double(face))
            for h in stride(from: 0.6, through: 3.6, by: 0.2) {
                // The magnet at (offset, h) from the sensor; r̂ points from it to the sensor.
                let p = SIMD3(offset.x, offset.y, h)
                let r = simd_length(p)
                let rh = -p / r
                let dir = 3 * simd_dot(m, rh) * rh - m
                let score = simd_dot(u, dir / simd_length(dir))
                if best == nil || score > best!.score { best = (score, face, nb * r * r * r / simd_length(dir)) }
            }
        }
        guard let b = best, b.score > 0.6 else { return nil }
        return (b.face, b.strength)
    }

    /// The strength from a magnet held over a spot far from the sensor
    /// (`offset`, cm, device axes; 6 cm or more is best) at roughly `height`
    /// cm above the sensor. Far away the distance barely depends on the
    /// height or the hand's tilt, so this is the sturdy way to get the scale.
    public static func strength(field b: SIMD3<Double>, magnetAt offset: SIMD2<Double>, height: Double = 2.4) -> Double? {
        let nb = simd_length(b), lateral = simd_length(offset)
        guard nb > 1e-6, lateral > 0.5 else { return nil }
        let r = (lateral * lateral + height * height).squareRoot()
        let c = height / r
        return nb * r * r * r / (1 + 3 * c * c).squareRoot()
    }
}
