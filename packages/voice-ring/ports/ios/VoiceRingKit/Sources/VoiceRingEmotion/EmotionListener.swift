// The voice library's emotion, wired in one object: the tone of the voice
// (emotion2vec+ on the last two seconds) and the meaning of its words
// (GoEmotions on the live transcript), blended into one mood for the orb.
// Either half works alone — the words need speech recognition and the
// text model; without them the tone speaks for both.

import CoreML
import Foundation
import Observation
import VoiceCore

@Observable
@MainActor
public final class EmotionListener {
    public let tone = Emotion2VecMoodEstimator()
    public let words = TextMoodEstimator()
    public let transcriber = LiveTranscriber()

    /// The blended mood for `VoiceOrb(mood:)` / `VoiceSphere(mood:)`.
    public var mood: VoiceMood { .blend(tone: tone.isLoaded ? tone.mood : nil, meaning: words.isLoaded ? words.mood : nil) }
    public private(set) var status = "Off"

    @ObservationIgnored private var feed: Task<Void, Never>?

    public init() {}

    /// Loads whichever models the app ships (see the README for converting
    /// them) and starts listening to `meter`. Missing models are skipped;
    /// nil URLs look in the main bundle.
    public func start(meter: VoiceMeter, toneModel: URL? = nil, textModel: URL? = nil, tokenizer: URL? = nil) async {
        let toneModel = toneModel ?? Emotion2VecMoodEstimator.bundledModelURL
        let textModel = textModel ?? TextMoodEstimator.bundledModelURL
        let tokenizer = tokenizer ?? TextMoodEstimator.bundledTokenizerURL
        var parts: [String] = []
        if let toneModel {
            do {
                try await tone.load(modelAt: toneModel)
                tone.start(listeningTo: meter)
                parts.append("tone")
            } catch {
                parts.append("tone failed")
            }
        }
        if let textModel, let tokenizer {
            do {
                try await words.load(modelAt: textModel, tokenizerAt: tokenizer)
                await transcriber.start(with: meter)
                parts.append("words")
                // the transcript feeds the words model as it grows
                feed = Task { [weak self] in
                    var last: [String] = []
                    while !Task.isCancelled {
                        try? await Task.sleep(for: .milliseconds(120))
                        guard let self else { return }
                        let now = self.transcriber.words
                        if now != last {
                            last = now
                            self.words.update(now.joined(separator: " "))
                        }
                    }
                }
            } catch {
                parts.append("words failed")
            }
        }
        status = parts.isEmpty ? "No models in the app" : parts.joined(separator: " + ")
    }

    public func stop() {
        feed?.cancel()
        feed = nil
        tone.stop()
        transcriber.stop()
        words.update("")
        status = "Off"
    }
}
