import Foundation
import simd

/// Is there really a magnet — or is the phone's own sensor lying?
///
/// A magnet brought within ~2 cm of an iPhone's magnetometer (above
/// ~2,000 µT) magnetises parts near it and leaves an offset of 50–250 µT that
/// lasts minutes; a calibration taken with a magnet nearby leaves one too.
/// One reading of such an offset looks exactly like a magnet. Over time they
/// differ — a hand-held magnet always trembles, a resting one arrived by
/// approaching, a leftover stays behind after a strong reading drops — and
/// this small network (236 → 256 → 256 → 128 → 4, ~160k weights, trained
/// only on simulated sequences) reads the last 15 s of the field to answer:
/// the probability a magnet is present, and the part of the reading that is
/// not a magnet (the offset to subtract).
///
/// `MagnetSource` runs it every frame when `config.presenceModel` is on:
/// readings carry `presence` and `offsetEstimate`, and a confident "no
/// magnet" with a steady field re-zeros the sensor.
public final class MagnetPresence {
    private let net: MFXLNet
    /// Input layout (must match training): `short` samples at `hz` of the
    /// field, `longN` magnitudes every `longStep` samples, 4 context values.
    public let hz: Double
    public let short: Int, longN: Int, longStep: Int
    /// How much history the features look at, seconds.
    public let window: Double
    /// Extra inputs from the kit's memory (v2: overloaded since the last zero,
    /// and how long ago); 0 for v1 networks.
    public let contextInputs: Int

    public init?(data: Data) {
        guard let net = MFXLNet(data: data, kind: "presence") else { return nil }
        let h = net.header
        hz = h["hz"] as? Double ?? 50
        short = h["short"] as? Int ?? 64
        longN = h["longN"] as? Int ?? 40
        longStep = h["longStep"] as? Int ?? 5
        window = h["window"] as? Double ?? 15
        contextInputs = h["context"] as? Int ?? 0
        guard net.inputs == short * 3 + longN + 4 + contextInputs, net.outputs == 4 else { return nil }
        self.net = net
    }

    /// - Parameter history: the field change (µT, device axes, against the
    ///   current zero) sampled at `hz`, oldest first, ending now; at least
    ///   `short` and `longN * longStep` samples (pad the start if needed).
    ///   - overloadedFor: seconds since the phone was last overloaded (a field
    ///     over ~2,000 µT), if it has not been zeroed since — and only while
    ///     the field has just dropped (the magnet moving away), so a magnet
    ///     resting or held still is not mistaken for the leftover. nil: no.
    /// - Returns: magnet present (0–1) and the non-magnet part of the reading now, µT.
    public func evaluate(history h: [SIMD3<Double>], overloadedFor: Double? = nil) -> (presence: Double, offset: SIMD3<Double>) {
        guard let last = h.last, h.count >= max(short, longN * longStep) else { return (1, .zero) }
        let n = h.count
        let S = max(10, simd_length(last))
        var x = [Float](); x.reserveCapacity(short * 3 + longN + 4)
        for i in (n - short)..<n {
            let v = h[i] / S
            x.append(Float(min(6, max(-6, v.x)))); x.append(Float(min(6, max(-6, v.y)))); x.append(Float(min(6, max(-6, v.z))))
        }
        // The long view: every `longStep`-th sample of the last longN·longStep, oldest first.
        var j = n - longN * longStep
        for _ in 0..<longN {
            x.append(Float(log1p(simd_length(h[j]) / 10) / 6))
            j += longStep
        }
        var peak = 0.0, peakAt = 0
        for (i, v) in h.enumerated() { let m = simd_length(v); if m > peak { peak = m; peakAt = i } }
        let since = Double(n - 1 - peakAt) / hz / 15
        x.append(Float(log1p(peak / 100) / 4)); x.append(Float(since))
        x.append(Float(log1p(S / 10) / 6)); x.append(peak > 2000 ? 1 : 0)
        if contextInputs >= 2 {
            x.append(overloadedFor == nil ? 0 : 1)
            x.append(overloadedFor.map { Float(min(1.6, log1p($0 / 10) / log1p(60))) } ?? 0)
        }
        let o = net.forward(x)
        let p = 1 / (1 + exp(-Double(o[0])))
        return (p, SIMD3(Double(o[1]), Double(o[2]), Double(o[3])) * S)
    }
}
