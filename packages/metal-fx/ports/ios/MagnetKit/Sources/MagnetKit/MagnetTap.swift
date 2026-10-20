import Foundation
import simd

/// The air tap: a magnet hovering over the glass, dipped quickly toward the
/// screen (2–3 cm) and brought back.
///
/// The size of the field alone cannot tell a tap from a sweep across the
/// sensor or a flick of the magnet — all of them make it jump and fall. The
/// direction can: in a dip it barely turns, in a sweep it swings round, in a
/// flick it turns without the distance changing. This small network
/// (257 → 256 → 256 → 128 → 1, ~165k weights, trained only on simulated
/// sequences) reads the last 1.28 s of the field and answers how likely it
/// is that a tap has just finished. The distance itself is never known (2×
/// farther with an 8× stronger magnet reads the same), so the dip is judged
/// relative to the height: it has to bring the magnet a good part of the way
/// to the glass.
///
/// `MagnetSource` runs it when `config.tapModel` is on and fires
/// `.tap(at:)` once per tap, at the located point.
public final class MagnetTap {
    private let net: MFXLNet
    /// Input layout (must match training): `window` samples at `hz`.
    public let hz: Double
    public let window: Int

    public init?(data: Data) {
        guard let net = MFXLNet(data: data, kind: "tap") else { return nil }
        hz = net.header["hz"] as? Double ?? 50
        window = net.header["window"] as? Int ?? 64
        guard net.inputs == window * 4 + 1, net.outputs == 1 else { return nil }
        self.net = net
    }

    /// - Parameter history: the field change (µT, device axes, against the
    ///   current zero) sampled at `hz`, oldest first, ending now; the last
    ///   `window` samples are used.
    /// - Returns: the probability that a tap has just finished (0–1).
    public func evaluate(history h: [SIMD3<Double>]) -> Double {
        guard h.count >= window else { return 0 }
        let w = h.suffix(window)
        let mags = w.map { simd_length($0) }
        let S = max(10, mags.sorted()[(window - 1) / 2])   // the lower median, as torch's
        var x = [Float](); x.reserveCapacity(window * 4 + 1)
        for v in w {
            let s = v / S
            x.append(Float(min(8, max(-8, s.x)))); x.append(Float(min(8, max(-8, s.y)))); x.append(Float(min(8, max(-8, s.z))))
        }
        for m in mags { x.append(Float(min(4, max(-4, log(max(m, 1) / S))))) }
        x.append(Float(log1p(S / 10) / 6))
        let o = net.forward(x)
        return 1 / (1 + exp(-Double(o[0])))
    }
}
