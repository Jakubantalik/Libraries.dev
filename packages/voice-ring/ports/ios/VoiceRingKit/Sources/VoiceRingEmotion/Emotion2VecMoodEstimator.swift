// Adapted from VoiceGlow Pro (libraries-pro, voice-glow/swiftui/VoiceGlowPro) — the
// same on-device emotion the voice library uses, reading the orbs' VoiceMeter.
// That source is private: check its licence before publishing this module.

import Accelerate
import AVFoundation
import CoreML
import Observation
import VoiceCore

/// One of emotion2vec+'s labels.
public enum VoiceEmotion: String, CaseIterable, Sendable {
    case angry, disgusted, fearful, happy, neutral, other, sad, surprised

    /// Where each label sits on the mood plane (valence −1…1, arousal 0…1),
    /// after Russell's circumplex. The estimate is the probability-weighted
    /// mean of these.
    public var mood: (valence: Double, arousal: Double) {
        switch self {
        case .angry: return (-0.75, 0.85)
        case .disgusted: return (-0.65, 0.5)
        case .fearful: return (-0.6, 0.75)
        case .happy: return (0.8, 0.75)
        case .neutral: return (0, 0.3)
        case .other: return (0, 0.4)
        case .sad: return (-0.7, 0.15)
        case .surprised: return (0.35, 0.85)
        }
    }

    /// Label probabilities to a mood: the probability-weighted position of
    /// the emotional labels on the mood plane, with a confidence that falls
    /// as `neutral` (and `other`) take the mass and as the model hesitates
    /// between emotions. Shared by the voice and the text estimators.
    public static func mood(from probs: [VoiceEmotion: Double], neutralWeight: Double = 1) -> VoiceMood? {
        let total = probs.values.reduce(0, +)
        guard total > 0 else { return nil }
        var valence = 0.0, arousal = 0.0
        for (label, p) in probs {
            valence += p / total * label.mood.valence
            arousal += p / total * label.mood.arousal
        }
        let neutral = ((probs[.neutral] ?? 0) + (probs[.other] ?? 0)) / total
        let emotional = probs.filter { $0.key != .neutral && $0.key != .other }
        let top = emotional.max { $0.value < $1.value }
        let topShare = (top?.value ?? 0) / total / max(1e-6, 1 - neutral)
        // A neutral read (the most likely label is neutral or other) means no
        // mood: the orb stays neutral.
        let mostLikely = probs.max { $0.value < $1.value }?.key
        let isNeutral = mostLikely == .neutral || mostLikely == .other
        let confidence = isNeutral ? 0 : max(0, min(1, (1 - neutral * neutralWeight) * 1.6 - 0.3)) * (0.5 + 0.5 * topShare)
        // Re-centre on the emotional labels alone, so a mostly-neutral
        // estimate still points the right way once it gains confidence.
        if let top, top.value / total > 0.05 {
            let w = emotional.values.reduce(0, +)
            valence = emotional.reduce(0) { $0 + $1.value / w * $1.key.mood.valence }
            arousal = emotional.reduce(0) { $0 + $1.value / w * $1.key.mood.arousal }
        }
        return VoiceMood(valence: valence, arousal: arousal, confidence: confidence)
    }
}

/// Voice emotion on device: emotion2vec+ base in Core ML, scoring the last
/// two seconds of the microphone every quarter second and turning the nine
/// label probabilities into a ``VoiceMood`` for the orbs.
///
/// ```swift
/// @State private var meter = VoiceMeter()
/// @State private var emotion = Emotion2VecMoodEstimator()
///
/// VoiceOrb(.swell, source: .meter(meter), mood: emotion.mood)
///     .task {
///         try? await emotion.load(modelAt: Emotion2VecMoodEstimator.bundledModelURL!)
///         emotion.start(listeningTo: meter)
///     }
/// ```
///
/// The model is not bundled with the package (~94 MB int8). Convert it with
/// `ports/ios/emotion2vec/convert.py` and ship it in the app, or download it
/// on first use and pass the file URL to ``load(modelAt:)``.
@Observable
@MainActor
public final class Emotion2VecMoodEstimator {
    /// The mood for the orb. Confidence is 0 while silent or unsure.
    public private(set) var mood: VoiceMood = .neutral
    /// The latest probabilities, for display.
    public private(set) var probabilities: [VoiceEmotion: Double] = [:]
    /// The most likely label of the latest window, when the voice was loud enough.
    public private(set) var topEmotion: VoiceEmotion?
    /// Milliseconds the last inference took.
    public private(set) var inferenceMilliseconds: Double = 0
    public private(set) var isLoaded = false
    public private(set) var isRunning = false

    /// Seconds between estimates. Each scores the last 2 s, so a change of
    /// tone shows within a beat; the model takes ~50 ms on an M-series Mac.
    public var interval: Double = 0.25
    /// Below this RMS (of the raw window) the voice counts as silence and no
    /// estimate is made.
    public var silenceThreshold: Float = 0.01
    /// How far "neutral" pulls the confidence down: the orb should only take
    /// a colour when the model hears something.
    public var neutralWeight: Double = 1

    @ObservationIgnored private var model: MLModel?
    @ObservationIgnored private var loop: Task<Void, Never>?

    nonisolated static let sampleRate = 16_000.0
    nonisolated static let window = 32_000
    nonisolated static let labels: [VoiceEmotion?] = [.angry, .disgusted, .fearful, .happy, .neutral, .other, .sad, .surprised, nil]

    public init() {}

    /// `Emotion2Vec.mlmodelc` in the main bundle, when the app ships one
    /// (Xcode compiles an `.mlpackage` resource into it).
    public static var bundledModelURL: URL? {
        Bundle.main.url(forResource: "Emotion2Vec", withExtension: "mlmodelc")
    }

    /// Loads a compiled model (`.mlmodelc`) or compiles an `.mlpackage` first.
    /// CPU by default. On an iPhone 15 Pro (iOS 26.5) the Neural Engine never
    /// finished preparing these models (>10 min), and the GPU path aborted
    /// inside Metal under overlapping predictions — while the CPU was the
    /// fastest anyway (tone: 87 ms per 2 s window vs 113 ms on the GPU).
    public func load(modelAt url: URL, computeUnits: MLComputeUnits = .cpuOnly) async throws {
        let compiled = url.pathExtension == "mlmodelc" ? url : try await MLModel.compileModel(at: url)
        let config = MLModelConfiguration()
        config.computeUnits = computeUnits
        model = try await MLModel.load(contentsOf: compiled, configuration: config)
        isLoaded = true
    }

    /// Starts estimating from the meter's audio. The meter must be running
    /// for anything to be heard; while it is stopped the mood fades out.
    public func start(listeningTo meter: VoiceMeter) {
        guard loop == nil else { return }
        isRunning = true
        loop = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                await self.tick(meter)
                try? await Task.sleep(for: .seconds(self.interval))
            }
        }
    }

    public func stop() {
        loop?.cancel()
        loop = nil
        isRunning = false
        mood = .neutral
        topEmotion = nil
    }

    private func tick(_ meter: VoiceMeter) async {
        guard let model, meter.isRunning else {
            settle()
            return
        }
        let (raw, rate) = meter.recentSamples(seconds: Double(Self.window) / Self.sampleRate)
        guard rate > 0, Double(raw.count) >= rate * 1.0 else {
            settle()
            return
        }
        // Silence carries no emotion — and emotion2vec calls it "neutral"
        // with full confidence, which would wash the colour out mid-sentence.
        // Gate on the most recent half second.
        let tail = raw.suffix(Int(rate * 0.5))
        var rms: Float = 0
        tail.withContiguousStorageIfAvailable { vDSP_rmsqv($0.baseAddress!, 1, &rms, vDSP_Length($0.count)) }
        guard rms >= silenceThreshold else {
            settle()
            return
        }

        let started = CFAbsoluteTimeGetCurrent()
        let result: [Float]? = await Task.detached(priority: .userInitiated) {
            let window = Self.resample(raw, from: rate)
            return try? Self.predict(model, window)
        }.value
        inferenceMilliseconds = (CFAbsoluteTimeGetCurrent() - started) * 1000
        guard let scores = result else { return }
        apply(scores)
    }

    /// Silence or no model: hold the hue, drop the confidence.
    private func settle() {
        mood = VoiceMood(valence: mood.valence, arousal: mood.arousal, confidence: 0)
        topEmotion = nil
    }

    private func apply(_ scores: [Float]) {
        var probs: [VoiceEmotion: Double] = [:]
        for (i, label) in Self.labels.enumerated() {
            guard let label, i < scores.count else { continue }
            probs[label] = Double(scores[i])
        }
        probabilities = probs
        guard let m = VoiceEmotion.mood(from: probs, neutralWeight: neutralWeight) else { return }
        mood = m
        topEmotion = probs.max { $0.value < $1.value }?.key
    }

    // MARK: - Audio and model

    /// The last two seconds at 16 kHz, zero-padded at the front while the
    /// buffer is still filling.
    nonisolated static func resample(_ samples: [Float], from rate: Double) -> [Float] {
        var out = [Float](repeating: 0, count: window)
        guard !samples.isEmpty else { return out }
        let step = rate / sampleRate
        let produced = min(window, Int(Double(samples.count) / step))
        // Linear interpolation; the source is ≥ 16 kHz, so average the span
        // first to keep aliasing out of the band the model listens to.
        let span = max(1, Int(step.rounded(.down)))
        var smoothed = samples
        if span > 1 {
            var kernel = [Float](repeating: 1 / Float(span), count: span)
            var tmp = [Float](repeating: 0, count: samples.count - span + 1)
            vDSP_conv(samples, 1, &kernel, 1, &tmp, 1, vDSP_Length(tmp.count), vDSP_Length(span))
            smoothed = tmp
        }
        let offset = window - produced
        let last = Double(smoothed.count - 1)
        for i in 0..<produced {
            let src = last - Double(produced - 1 - i) * step
            let i0 = max(0, Int(src.rounded(.down)))
            let i1 = min(smoothed.count - 1, i0 + 1)
            let f = Float(src - Double(i0))
            out[offset + i] = smoothed[i0] * (1 - f) + smoothed[i1] * f
        }
        return out
    }

    /// Runs the model on one 2 s, 16 kHz window; the nine label probabilities.
    public nonisolated static func predict(_ model: MLModel, _ window: [Float]) throws -> [Float] {
        let input = try MLMultiArray(shape: [1, NSNumber(value: Self.window)], dataType: .float32)
        window.withUnsafeBufferPointer { src in
            input.dataPointer.assumingMemoryBound(to: Float.self).update(from: src.baseAddress!, count: Self.window)
        }
        let provider = try MLDictionaryFeatureProvider(dictionary: ["audio": MLFeatureValue(multiArray: input)])
        let out = try model.prediction(from: provider)
        guard let scores = out.featureValue(for: "scores")?.multiArrayValue else { return [] }
        return (0..<scores.count).map { scores[$0].floatValue }
    }
}
