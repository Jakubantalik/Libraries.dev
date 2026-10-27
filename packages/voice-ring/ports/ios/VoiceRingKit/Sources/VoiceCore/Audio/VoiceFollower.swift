// The voice follower — port of src/voice.ts. Turns raw readings (the
// meter's analysis, or a plain level) into the shaped, smoothed VoiceInput
// every type draws from: gain, noise gate, soft saturation, attack/release;
// three voice bands and a 16-slot spectrum over an adaptive noise floor;
// the slow soft envelopes; the calm waiting pace; processing's eased blend
// and its turn; and the pan toward the voice.

import Foundation

public struct FollowerConfig {
    public var sensitivity: Double
    public var threshold: Double
    public var attack: Double
    public var release: Double
    public var idle: Double
    public var driveGain: Double
    public var calm: Double
    public var rate: Double
    public var processing: Bool
    /// Where the voice comes from, −1 left … 1 right (from VoiceDirectionKit,
    /// or set by the app); nil leans nowhere.
    public var direction: Double?
}

public final class VoiceFollower {
    public static let spectrumCount = 16
    private static let baseGain = 5.0
    private static let bandGain = 2.2
    private static let bands: [(Double, Double)] = [(80, 300), (300, 2000), (2000, 6000)]
    private static let specLo = 90.0, specHi = 7000.0
    private static let softAttack = 0.35, softRelease = 0.9
    private static let spinRate = 2.1, settleMax = 0.3
    /// The lean's spring stiffness: to follow a side (settled in about a
    /// second), to drift home (about three).
    // the lean's spring: settles on a side in about two seconds, home in three
    private static let panIn = 2.5, panOut = 1.6

    /// Real seconds run; the ambient clock; the voice clock (orb seconds).
    public private(set) var clock: Double = 0
    public private(set) var t: Double = 0
    public private(set) var drive: Double = 0

    private var level: Double = 0
    private var bands = SIMD3<Double>(0, 0, 0)
    private var spectrum = [Double](repeating: 0, count: spectrumCount)
    private var floor = [Double](repeating: 1, count: spectrumCount + 3)
    private var heard: Double = 0
    private var proc: Double = 0
    private var spin: Double = 0
    private var pan: Double = 0
    private var panVel: Double = 0
    private var rawLevel: Double = 0
    private var rawBands = SIMD3<Double>(0, 0, 0)
    private var rawSpectrum = [Double](repeating: 0, count: spectrumCount)
    private var out = VoiceInput()

    public init() {}

    private static func clamp01(_ v: Double) -> Double { v < 0 ? 0 : v > 1 ? 1 : v }

    /// Noise gate then soft saturation, so a shout rounds off.
    private static func shape(_ raw: Double, _ threshold: Double) -> Double {
        guard raw > threshold else { return 0 }
        let t = (raw - threshold) / max(0.001, 1 - threshold)
        return clamp01((1 - exp(-3 * t)) / (1 - exp(-3)))
    }

    /// One-pole follower: fast up, slow down.
    private static func follow(_ prev: Double, _ target: Double, _ dt: Double, _ attack: Double, _ release: Double) -> Double {
        let tau = target > prev ? attack : release
        return prev + (target - prev) * (1 - exp(-dt / max(0.001, tau)))
    }

    /// The meter's analysis: loudness, bands, spectrum (each over its
    /// adaptive floor) and, from a stereo input, where the voice is.
    func read(_ m: MeterReading, sensitivity: Double, dt: Double) {
        rawLevel = m.rms * Self.baseGain * sensitivity
        func avg(_ lo: Double, _ hi: Double) -> Double {
            let from = max(0, Int(Foundation.floor(lo / m.binHz)))
            let to = max(from, min(m.bins.count - 1, Int(ceil(hi / m.binHz))))
            var acc: Float = 0
            for i in from...to { acc += m.bins[i] }
            return Double(acc) / Double(to - from + 1)
        }
        func floored(_ slot: Int, _ v: Double) -> Double {
            let f = floor[slot]
            floor[slot] = v < f ? v : f + (v - f) * (1 - exp(-dt / 8))
            return max(0, v - floor[slot]) / max(0.05, 1 - floor[slot])
        }
        for b in 0..<3 {
            rawBands[b] = floored(b, avg(Self.bands[b].0, Self.bands[b].1)) * Self.bandGain * sensitivity
        }
        let ratio = Self.specHi / Self.specLo
        for k in 0..<Self.spectrumCount {
            let lo = Self.specLo * pow(ratio, Double(k) / Double(Self.spectrumCount))
            let hi = Self.specLo * pow(ratio, Double(k + 1) / Double(Self.spectrumCount))
            rawSpectrum[k] = floored(3 + k, avg(lo, hi)) * Self.bandGain * sensitivity
        }
    }

    /// A plain level, with the bands and spectrum given a little life.
    public func readLevel(_ level: Double, sensitivity: Double) {
        let raw = Self.clamp01(level) * sensitivity
        let t = clock
        rawLevel = raw
        rawBands = SIMD3(raw, raw * (0.72 + 0.28 * sin(t * 2.3)), raw * (0.6 + 0.4 * sin(t * 3.7 + 2)))
        let c1 = 0.28 + 0.1 * sin(t * 2.3) + 0.05 * sin(t * 5.1)
        let c2 = 0.64 + 0.1 * sin(t * 1.7 + 1)
        for k in 0..<Self.spectrumCount {
            let f = Double(k) / Double(Self.spectrumCount - 1)
            let hump = exp(-pow(f - c1, 2) / 0.012) + 0.6 * exp(-pow(f - c2, 2) / 0.008)
            rawSpectrum[k] = raw * (0.25 + 0.75 * hump) * (1 - 0.4 * f)
        }
    }

    /// Nothing to read: let every envelope settle.
    public func readSilence() {
        rawLevel = 0
        rawBands = .zero
        rawSpectrum = [Double](repeating: 0, count: Self.spectrumCount)
    }

    /// Advance by `dt` real seconds; `still` (reduced motion) holds the clocks.
    public func step(dt: Double, _ cfg: FollowerConfig, still: Bool) -> VoiceInput {
        proc = Self.follow(proc, cfg.processing ? 1 : 0, dt, 0.35, 0.5)
        let p = proc
        let pace = cfg.calm + (1 - cfg.calm) * min(1, max(heard * 2.5, p))
        if !still {
            clock += dt
            t += dt * cfg.rate * pace * (1 + 0.5 * p)
        }
        let target = Self.shape(rawLevel, cfg.threshold)
        level = Self.follow(level, target, dt, cfg.attack, cfg.release)
        heard = Self.follow(heard, level, dt, Self.softAttack, Self.softRelease)
        for b in 0..<3 {
            bands[b] = Self.follow(bands[b], Self.shape(rawBands[b], cfg.threshold * 0.6), dt, cfg.attack, cfg.release * 1.15)
        }
        for k in 0..<Self.spectrumCount {
            spectrum[k] = Self.follow(spectrum[k], Self.shape(rawSpectrum[k], cfg.threshold * 0.6), dt, cfg.attack, cfg.release)
        }

        // idle breathing folded under the voice, gone while processing
        let breathe = still ? 0.5 : 0.5 + 0.5 * sin(TAU * clock / 6)
        let lift = cfg.idle * breathe * (1 - p)
        out.level = level + (1 - level) * lift
        for b in 0..<3 { out.bands[b] = bands[b] + (1 - bands[b]) * lift * 0.6 }
        out.soft = Self.follow(out.soft, out.level, dt, Self.softAttack, Self.softRelease)
        for b in 0..<3 { out.softBands[b] = Self.follow(out.softBands[b], out.bands[b], dt, Self.softAttack, Self.softRelease) }
        out.spectrum = spectrum
        if !still { drive += dt * cfg.rate * (pace + cfg.driveGain * level + 1.3 * p) }
        out.drive = drive
        out.processing = p

        // processing's turn: winds up and down with the blend, then coasts
        // forward to the next whole turn
        if !still {
            let home = ceil(spin / TAU - 1e-6) * TAU
            let settle = min(Self.settleMax, (home - spin) * 0.6)
            spin += dt * (Self.spinRate * cfg.rate * p + settle * (1 - p))
        }
        out.spin = spin

        // the lean: follows the source while a voice is heard, drifts home after
        let raw = max(-1, min(1, cfg.direction ?? 0))
        let goal = heard > 0.06 && !cfg.processing ? raw : 0
        // a critically damped spring: it eases in and out — sets off gently,
        // speeds up, settles without overshooting
        let w = abs(goal) > abs(pan) ? Self.panIn : Self.panOut
        panVel += (w * w * (goal - pan) - 2 * w * panVel) * dt
        pan += panVel * dt
        out.pan = pan
        return out
    }
}
