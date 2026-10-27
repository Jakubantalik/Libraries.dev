// The web AnalyserNode's numbers — RMS of the window, a Blackman-windowed
// FFT smoothed over time (τ 0.5) and mapped from −100…−30 dB onto 0–1 —
// adapted from VoiceGlowKit, plus the direction cues: the level and phase
// differences between the stereo channels across the voice band.

import Accelerate
import Foundation
import os

final class SpectrumAnalyser: @unchecked Sendable {
    let fftSize: Int
    private let log2n: vDSP_Length
    private let setup: FFTSetup
    private let window: [Float]
    private var smoothed: [Float]
    private let lock = OSAllocatedUnfairLock()

    init(fftSize: Int) {
        self.fftSize = fftSize
        log2n = vDSP_Length(log2(Double(fftSize)))
        setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))!
        // the Web Audio Blackman window (α = 0.16)
        window = (0..<fftSize).map { n in
            let a = 0.16, a0 = (1 - a) / 2, a1 = 0.5, a2 = a / 2
            let x = 2 * Double.pi * Double(n) / Double(fftSize)
            return Float(a0 - a1 * cos(x) + a2 * cos(2 * x))
        }
        smoothed = [Float](repeating: 0, count: fftSize / 2)
    }

    deinit {
        vDSP_destroy_fftsetup(setup)
    }

    /// The spectrum of one windowed frame, bins 0 ..< fftSize / 2 (bin 0's
    /// imaginary slot, where vDSP packs Nyquist, zeroed), on the web's scale.
    private func spectrum(_ samples: [Float]) -> (re: [Float], im: [Float]) {
        var windowed = [Float](repeating: 0, count: fftSize)
        vDSP_vmul(samples, 1, window, 1, &windowed, 1, vDSP_Length(fftSize))
        let half = fftSize / 2
        var real = [Float](repeating: 0, count: half)
        var imag = [Float](repeating: 0, count: half)
        real.withUnsafeMutableBufferPointer { rp in
            imag.withUnsafeMutableBufferPointer { ip in
                var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                windowed.withUnsafeBufferPointer { wp in
                    wp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: half) {
                        vDSP_ctoz($0, 2, &split, 1, vDSP_Length(half))
                    }
                }
                vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                split.imagp[0] = 0
            }
        }
        var scale = Float(0.5) / Float(fftSize)
        vDSP_vsmul(real, 1, &scale, &real, 1, vDSP_Length(half))
        vDSP_vsmul(imag, 1, &scale, &imag, 1, vDSP_Length(half))
        return (real, imag)
    }

    /// Linear magnitudes of one windowed frame.
    private func magnitudes(_ samples: [Float]) -> [Float] {
        var (real, imag) = spectrum(samples)
        var mags = [Float](repeating: 0, count: real.count)
        real.withUnsafeMutableBufferPointer { rp in
            imag.withUnsafeMutableBufferPointer { ip in
                var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                vDSP_zvabs(&split, 1, &mags, 1, vDSP_Length(mags.count))
            }
        }
        return mags
    }

    func analyse(_ samples: [Float], sampleRate: Double) -> MeterReading {
        lock.withLockUnchecked {
            var rms: Float = 0
            vDSP_rmsqv(samples, 1, &rms, vDSP_Length(fftSize))
            let mags = magnitudes(samples)
            var bins = [Float](repeating: 0, count: mags.count)
            for i in 0..<mags.count {
                smoothed[i] = 0.5 * smoothed[i] + 0.5 * mags[i]
                let db = 20 * log10(Double(max(smoothed[i], 1e-12)))
                bins[i] = Float(max(0, min(1, (db + 100) / 70)))
            }
            return MeterReading(rms: Double(rms), bins: bins, binHz: sampleRate / Double(fftSize))
        }
    }

    /// The cues to a voice's side, right channel against left, as the
    /// hardware delivers them (see Stereo.swift):
    /// - cues: the energy difference over 1–4 kHz in dB, and the phase of
    ///   right × conj(left) summed over 200–700 Hz (the strongest bins
    ///   lead) in degrees — what a calibration reads;
    /// - features: the same two kinds in the model's bands, as
    ///   the Voice direction model's training computes them — a level per
    ///   `StereoBands.level` band, (cos, sin) of the phase per `StereoBands.phase` band;
    /// - power: the 300–6000 Hz band in dB, for the voice gate.
    func stereoFrame(left: [Float], right: [Float], sampleRate: Double) -> StereoFrame {
        lock.withLockUnchecked {
            let l = spectrum(left), r = spectrum(right)
            let binHz = sampleRate / Double(fftSize)
            let levelBands = StereoBands.level, phaseBands = StereoBands.phase
            var el = 1e-24, er = 1e-24, power = 1e-24, xr = 0.0, xi = 0.0
            var bandL = [Double](repeating: 1e-24, count: levelBands.count - 1), bandR = bandL
            var bandX = [SIMD2<Double>](repeating: .zero, count: phaseBands.count - 1)
            for i in 1..<l.re.count {
                let hz = Double(i) * binHz
                guard hz < max(levelBands.last ?? 0, 6000) else { break }
                let lr = Double(l.re[i]), li = Double(l.im[i]), rr = Double(r.re[i]), ri = Double(r.im[i])
                let pl = lr * lr + li * li, pr = rr * rr + ri * ri
                // right × conj(left)
                let x = SIMD2(rr * lr + ri * li, ri * lr - rr * li)
                if hz >= 300 && hz <= 6000 { power += pl + pr }
                if hz >= 1000 && hz < 4000 {
                    el += pl
                    er += pr
                }
                if hz >= 200 && hz < 700 {
                    xr += x.x
                    xi += x.y
                }
                if let b = levelBands.indices.dropLast().last(where: { hz >= levelBands[$0] }), hz < levelBands[b + 1] {
                    bandL[b] += pl
                    bandR[b] += pr
                }
                if let b = phaseBands.indices.dropLast().last(where: { hz >= phaseBands[$0] }), hz < phaseBands[b + 1] {
                    bandX[b] += x
                }
            }
            var features = zip(bandR, bandL).map { 10 * log10($0 / $1) }
            for x in bandX {
                let m = (x * x).sum().squareRoot() + 1e-24
                features += [x.x / m, x.y / m]
            }
            return StereoFrame(
                cues: DirectionCues(level: 10 * log10(er / el), phase: atan2(xi, xr) * 180 / .pi),
                features: features,
                power: 10 * log10(power)
            )
        }
    }
}
