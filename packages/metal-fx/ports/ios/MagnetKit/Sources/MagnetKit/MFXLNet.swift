import Foundation
import Accelerate

/// A small fully connected network stored as MFXL: "MFXL", a little-endian
/// UInt32 header length, a JSON header (`kind`, `layers`: [{in, out, act}],
/// plus whatever the network needs), then each layer's weights (out × in,
/// row-major) and biases as float16. Shared by the magnet networks.
struct MFXLNet {
    private struct Layer { let inN: Int, outN: Int; let w: [Float]; let b: [Float]; let silu: Bool }
    private let layers: [Layer]
    let header: [String: Any]
    var inputs: Int { layers.first?.inN ?? 0 }
    var outputs: Int { layers.last?.outN ?? 0 }

    init?(data: Data, kind: String) {
        guard data.count > 8, data.prefix(4) == Data("MFXL".utf8) else { return nil }
        let hlen = Int(data[4]) | Int(data[5]) << 8 | Int(data[6]) << 16 | Int(data[7]) << 24
        guard data.count >= 8 + hlen,
              let header = try? JSONSerialization.jsonObject(with: data.subdata(in: 8..<(8 + hlen))) as? [String: Any],
              (header["kind"] as? String) == kind,
              let specs = header["layers"] as? [[String: Any]] else { return nil }
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
        guard !parsed.isEmpty else { return nil }
        self.header = header
        layers = parsed
    }

    func forward(_ input: [Float]) -> [Float] {
        var cur = input
        for L in layers {
            var dst = [Float](repeating: 0, count: L.outN)
            L.w.withUnsafeBufferPointer { w in
                cur.withUnsafeBufferPointer { x in
                    dst.withUnsafeMutableBufferPointer { y in
                        vDSP_mmul(w.baseAddress!, 1, x.baseAddress!, 1, y.baseAddress!, 1,
                                  vDSP_Length(L.outN), 1, vDSP_Length(L.inN))
                    }
                }
            }
            vDSP_vadd(dst, 1, L.b, 1, &dst, 1, vDSP_Length(L.outN))
            if L.silu {
                var neg = [Float](repeating: 0, count: L.outN)
                var minus: Float = -1
                vDSP_vsmul(dst, 1, &minus, &neg, 1, vDSP_Length(L.outN))
                var count = Int32(L.outN)
                vvexpf(&neg, neg, &count)
                var one: Float = 1
                vDSP_vsadd(neg, 1, &one, &neg, 1, vDSP_Length(L.outN))
                vDSP_vdiv(neg, 1, dst, 1, &dst, 1, vDSP_Length(L.outN))
            }
            cur = dst
        }
        return cur
    }

    private static func halfToFloat(_ h: UInt16) -> Float {
        let sign = UInt32(h >> 15) << 31
        let exp = Int((h >> 10) & 0x1f)
        let mant = UInt32(h & 0x3ff)
        if exp == 0 {
            if mant == 0 { return Float(bitPattern: sign) }
            let v = Float(mant) * powf(2, -24)
            return sign != 0 ? -v : v
        }
        if exp == 31 { return Float(bitPattern: sign | 0x7f80_0000 | (mant << 13)) }
        return Float(bitPattern: sign | UInt32(exp - 15 + 127) << 23 | mant << 13)
    }
}
