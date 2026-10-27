// Adapted from VoiceGlow Pro (libraries-pro, voice-glow/swiftui/VoiceGlowPro) — the
// same on-device emotion the voice library uses, reading the orbs' VoiceMeter.
// That source is private: check its licence before publishing this module.

import AVFoundation
import Observation
import Speech
import VoiceCore

/// Live speech-to-text on the meter's microphone, for the words mood. Paced like the web demo's
/// transcript: words arrive as they are heard, and after 2.5 s of silence
/// the utterance clears (the prompt comes back) and the next one starts
/// fresh. On-device where the phone supports it.
@Observable
@MainActor
public final class LiveTranscriber {
    public enum Status: Equatable {
        case idle
        case listening
        case denied
        case unavailable(String)
    }

    /// The current utterance, word by word (partial results included).
    public private(set) var words: [String] = []
    public private(set) var status: Status = .idle

    /// Seconds of silence that end an utterance.
    public var clearAfter: Double = 2.5
    /// Raw RMS under which the microphone counts as silent.
    public var silenceRMS: Double = 0.012

    @ObservationIgnored private let recognizer = SFSpeechRecognizer()
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var handler: UUID?
    @ObservationIgnored private var meter: VoiceMeter?
    @ObservationIgnored private var watcher: Task<Void, Never>?
    @ObservationIgnored private var silentSince: Date?
    @ObservationIgnored private var heardSpeech = false

    public init() {}

    /// Asks for speech recognition (once) and transcribes the meter's audio.
    public func start(with meter: VoiceMeter) async {
        guard status != .listening else { return }
        let auth = await withCheckedContinuation { cont in
            SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
        }
        guard auth == .authorized else {
            status = .denied
            return
        }
        guard let recognizer, recognizer.isAvailable else {
            status = .unavailable("Speech recognition is not available for \(Locale.current.identifier).")
            return
        }
        self.meter = meter
        status = .listening
        beginUtterance(recognizer)
        // The tap runs off the main thread; the box hands each buffer to
        // whichever request is live.
        handler = meter.addBufferHandler { buffer in
            RequestBox.shared.append(buffer)
        }
        watcher = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(100))
                self?.watchSilence()
            }
        }
    }

    public func stop() {
        watcher?.cancel()
        watcher = nil
        if let handler, let meter { meter.removeBufferHandler(handler) }
        handler = nil
        endUtterance()
        words = []
        status = .idle
    }

    // MARK: - Utterances

    private func beginUtterance(_ recognizer: SFSpeechRecognizer) {
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        request.taskHint = .dictation
        self.request = request
        RequestBox.shared.set(request)
        heardSpeech = false
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            let text = result?.bestTranscription.formattedString
            let failed = error != nil
            Task { @MainActor in
                guard let self, self.request === request else { return }
                if let text {
                    self.words = text.split(separator: " ").map(String.init)
                }
                // A task ends on its own after a long utterance or an error;
                // start the next one so listening carries on.
                if failed || result?.isFinal == true, self.status == .listening, let recognizer = self.recognizer {
                    self.endUtterance()
                    self.beginUtterance(recognizer)
                }
            }
        }
    }

    private func endUtterance() {
        request?.endAudio()
        task?.cancel()
        RequestBox.shared.set(nil)
        request = nil
        task = nil
    }

    /// 2.5 s of quiet after speech: clear the words and start a fresh request.
    private func watchSilence() {
        guard status == .listening, let meter else { return }
        let quiet = meter.currentRMS() < silenceRMS
        if !quiet {
            silentSince = nil
            heardSpeech = true
            return
        }
        if silentSince == nil { silentSince = Date() }
        guard heardSpeech, let since = silentSince, Date().timeIntervalSince(since) > clearAfter,
              let recognizer else { return }
        endUtterance()
        words = []
        beginUtterance(recognizer)
    }
}

/// The live request, readable from the audio tap's thread.
private final class RequestBox: @unchecked Sendable {
    static let shared = RequestBox()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private let lock = NSLock()

    func set(_ r: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock(); request = r; lock.unlock()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock(); let r = request; lock.unlock()
        r?.append(buffer)
    }
}
