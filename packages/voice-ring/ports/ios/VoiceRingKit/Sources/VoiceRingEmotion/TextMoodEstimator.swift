// Adapted from VoiceGlow Pro (libraries-pro, voice-glow/swiftui/VoiceGlowPro) — the
// same on-device emotion the voice library uses, reading the orbs' VoiceMeter.
// That source is private: check its licence before publishing this module.

import CoreML
import Foundation
import Observation
import VoiceCore

/// The mood of what is said — "I don't like it" reads negative however
/// flatly it is spoken. A text-emotion classifier in Core ML (by default
/// SamLowe/roberta-base-go_emotions, MIT — 28 GoEmotions labels folded onto
/// the voice model's eight; see `ports/ios/emotion2vec/convert_text.py`)
/// scores the live transcript.
///
/// Feed it the current utterance as it grows; it re-scores after the words
/// settle for a moment and drops its confidence when the utterance clears.
/// Blend it with the voice's tone using ``VoiceMood/blend(tone:meaning:)``.
///
/// ```swift
/// .onChange(of: transcriber.words) { _, words in text.update(words.joined(separator: " ")) }
/// VoiceOrb(.swell, source: .meter(meter), mood: .blend(tone: voice.mood, meaning: text.mood))
/// ```
@Observable
@MainActor
public final class TextMoodEstimator {
    public private(set) var mood: VoiceMood = .neutral
    public private(set) var probabilities: [VoiceEmotion: Double] = [:]
    public private(set) var topEmotion: VoiceEmotion?
    public private(set) var isLoaded = false
    /// The text last scored.
    public private(set) var scoredText = ""

    /// Seconds the words must hold still before they are scored — just
    /// enough to coalesce a burst of partial results.
    public var debounce: Double = 0.06
    /// Utterances shorter than this many words are not scored.
    public var minimumWords = 1
    /// Only the latest words are scored, so the newest sentence sets the
    /// mood instead of being averaged into everything said before it.
    public var recentWords = 16

    @ObservationIgnored private var model: MLModel?
    @ObservationIgnored private var tokenizer: RobertaTokenizer?
    @ObservationIgnored private var labels: [VoiceEmotion?] = []
    @ObservationIgnored private var pending: Task<Void, Never>?
    /// The newest text waiting to be scored.
    @ObservationIgnored private var latest: String?

    nonisolated static let maxTokens = 64

    public init() {}

    /// `TextEmotion.mlmodelc` and the `TextEmotionTokenizer` folder in the
    /// main bundle, when the app ships them.
    public static var bundledModelURL: URL? {
        Bundle.main.url(forResource: "TextEmotion", withExtension: "mlmodelc")
    }

    public static var bundledTokenizerURL: URL? {
        Bundle.main.url(forResource: "TextEmotionTokenizer", withExtension: nil)
    }

    /// Loads the model (`.mlmodelc`, or an `.mlpackage` compiled first) and
    /// the tokenizer folder (`vocab.json`, `merges.txt`, `labels.json`).
    /// CPU by default. On an iPhone 15 Pro (iOS 26.5) the Neural Engine never
    /// finished preparing these models (>10 min), and the GPU path aborted
    /// inside Metal under overlapping predictions — while the CPU was the
    /// fastest anyway (tone: 87 ms per 2 s window vs 113 ms on the GPU).
    public func load(modelAt url: URL, tokenizerAt directory: URL, computeUnits: MLComputeUnits = .cpuOnly) async throws {
        tokenizer = try RobertaTokenizer(directory: directory)
        let names = try JSONDecoder().decode([String].self, from: Data(contentsOf: directory.appendingPathComponent("labels.json")))
        labels = names.map(Self.emotion(for:))
        let compiled = url.pathExtension == "mlmodelc" ? url : try await MLModel.compileModel(at: url)
        let config = MLModelConfiguration()
        config.computeUnits = computeUnits
        model = try await MLModel.load(contentsOf: compiled, configuration: config)
        isLoaded = true
    }

    /// The current utterance. Empty clears the mood's confidence (the hue
    /// stays, so the orb eases back to neutral rather than jumping).
    public func update(_ text: String) {
        let words = text.split(whereSeparator: \.isWhitespace)
        let trimmed = words.suffix(recentWords).joined(separator: " ")
        guard words.count >= minimumWords, !trimmed.isEmpty else {
            if words.isEmpty {
                latest = nil
                mood = VoiceMood(valence: mood.valence, arousal: mood.arousal, confidence: 0)
                topEmotion = nil
                scoredText = ""
            }
            return
        }
        latest = trimmed
        guard pending == nil else { return }
        // One run at a time: concurrent predictions on one model crash Core
        // ML's GPU path, and a newer sentence makes an older score moot
        // anyway. When a run finishes, the newest text (if it moved on) goes next.
        pending = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: .seconds(self.debounce))
            while let next = self.latest, next != self.scoredText {
                await self.score(next)
            }
            // The utterance cleared while a score was running: no mood.
            if self.latest == nil {
                self.mood = VoiceMood(valence: self.mood.valence, arousal: self.mood.arousal, confidence: 0)
                self.topEmotion = nil
            }
            self.pending = nil
        }
    }

    /// Scores `text` now and returns the mood (also published on ``mood``).
    @discardableResult
    public func score(_ text: String) async -> VoiceMood? {
        guard let model, let tokenizer else { return nil }
        let labels = self.labels
        let scores: [Float]? = await Task.detached(priority: .userInitiated) {
            try? Self.predict(model, tokenizer.encode(text, maxLength: Self.maxTokens), pad: tokenizer.padID)
        }.value
        guard let scores else {
            scoredText = text  // unscoreable; do not retry it forever
            return nil
        }
        var probs: [VoiceEmotion: Double] = [:]
        for (i, label) in labels.enumerated() where i < scores.count {
            guard let label else { continue }
            probs[label, default: 0] += Double(scores[i])
        }
        probabilities = probs
        scoredText = text
        guard let m = VoiceEmotion.mood(from: probs) else { return nil }
        mood = m
        topEmotion = probs.max { $0.value < $1.value }?.key
        return m
    }

    nonisolated static func predict(_ model: MLModel, _ ids: [Int32], pad: Int32) throws -> [Float] {
        let input = try MLMultiArray(shape: [1, NSNumber(value: maxTokens)], dataType: .int32)
        let mask = try MLMultiArray(shape: [1, NSNumber(value: maxTokens)], dataType: .int32)
        let ip = input.dataPointer.assumingMemoryBound(to: Int32.self)
        let mp = mask.dataPointer.assumingMemoryBound(to: Int32.self)
        for i in 0..<maxTokens {
            ip[i] = i < ids.count ? ids[i] : pad
            mp[i] = i < ids.count ? 1 : 0
        }
        let provider = try MLDictionaryFeatureProvider(dictionary: [
            "input_ids": MLFeatureValue(multiArray: input),
            "attention_mask": MLFeatureValue(multiArray: mask),
        ])
        let out = try model.prediction(from: provider)
        guard let scores = out.featureValue(for: "scores")?.multiArrayValue else { return [] }
        return (0..<scores.count).map { scores[$0].floatValue }
    }

    /// The text model's label names, mapped onto the voice model's.
    /// Covers both the GoEmotions taxonomy (28 labels) and the Ekman-style
    /// sets other classifiers use. Labels that carry no feeling to colour —
    /// curiosity, confusion, realization — count as `other`, which the mood
    /// mapping treats like neutral.
    static func emotion(for label: String) -> VoiceEmotion? {
        switch label.lowercased() {
        case "anger", "angry", "annoyance", "disapproval": return .angry
        case "disgust", "disgusted": return .disgusted
        case "fear", "fearful", "nervousness": return .fearful
        case "joy", "happy", "happiness", "love", "admiration", "amusement", "approval", "caring",
             "desire", "excitement", "gratitude", "optimism", "pride", "relief":
            return .happy
        case "sadness", "sad", "disappointment", "grief", "remorse", "embarrassment": return .sad
        case "surprise", "surprised": return .surprised
        case "neutral": return .neutral
        default: return .other
        }
    }
}
