// The microphone, analysed — adapted from VoiceGlowKit's VoiceMeter. On
// iPhone it records in stereo from the built-in mics (iOS 14+, where the
// model supports it) and measures how the two channels differ
// (`stereoFrame()`), which VoiceDirectionKit reads into a side; elsewhere
// it falls back to mono.
//
// The real-time audio thread only copies samples into two ring buffers.
// The orb reads the analysis once per frame: RMS, the spectrum on the web
// AnalyserNode's scale, and a left/right estimate from the level and phase
// differences between the channels, taken from voiced frames only and seen
// from the user, looking at the screen (see Stereo.swift).

import Accelerate
import AVFoundation
import Observation
import os

@Observable
@MainActor
public final class VoiceMeter {
    public enum MeterError: Error {
        case permissionDenied
        case noInput
    }

    /// True while the microphone is open.
    public private(set) var isRunning = false
    /// True when the input really is two channels (built-in stereo capture).
    public private(set) var isStereo = false

    /// The stereo input in use, for a readout ("Front · Stereo · portrait").
    public private(set) var stereoInput: String?

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var sink: AVAudioSinkNode?
    @ObservationIgnored private var tapped: AVAudioNode?
    @ObservationIgnored let left = SampleRing(capacity: 1 << 18)
    @ObservationIgnored let right = SampleRing(capacity: 1 << 18)
    @ObservationIgnored private let analyser = SpectrumAnalyser(fftSize: 1024)
    @ObservationIgnored private let handlers = BufferHandlers()
    @ObservationIgnored private var stereoFlag = false
    /// −1 when the input's stereo image is mirrored to the user.
    @ObservationIgnored private var channelSign: Double = 1
    public init() {}

    /// Every microphone buffer, off the main thread — for a speech
    /// recogniser sharing this microphone. Returns a token for removal.
    @discardableResult
    public func addBufferHandler(_ handler: @escaping @Sendable (AVAudioPCMBuffer) -> Void) -> UUID {
        handlers.add(handler)
    }

    public func removeBufferHandler(_ id: UUID) {
        handlers.remove(id)
    }

    /// Asks for the microphone (once) and opens it, in stereo where possible.
    public func start(stereo: Bool = true) async throws {
        guard !isRunning else { return }
        guard await Self.requestPermission() else { throw MeterError.permissionDenied }

        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        // A2DP only: Bluetooth headphones play the assistant while the
        // phone's own mics keep listening (HFP would move the input to the
        // headset and lose the stereo).
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothA2DP, .mixWithOthers])
        #if !targetEnvironment(simulator)
        try? session.setPreferredIOBufferDuration(0.01)
        #endif
        try session.setActive(true)
        if stereo { Self.preferStereo(session) }
        #endif

        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw MeterError.noInput }
        let twoChannels = format.channelCount >= 2

        left.reset(sampleRate: format.sampleRate)
        right.reset(sampleRate: format.sampleRate)
        let l = left, r = right
        // Real-time thread: copy each channel into its ring, nothing else.
        let sink = AVAudioSinkNode { _, frameCount, bufferList -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: bufferList))
            guard let first = buffers.first?.mData else { return noErr }
            let count = Int(frameCount)
            l.write(first.assumingMemoryBound(to: Float.self), count: count)
            if buffers.count > 1, let second = buffers[1].mData {
                r.write(second.assumingMemoryBound(to: Float.self), count: count)
            } else {
                r.write(first.assumingMemoryBound(to: Float.self), count: count)
            }
            return noErr
        }
        engine.attach(sink)
        engine.connect(input, to: sink, format: format)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.dispatch(buffer)
        }
        try engine.start()

        self.engine = engine
        self.sink = sink
        tapped = input
        isStereo = twoChannels
        stereoFlag = twoChannels
        channelSign = 1
        stereoInput = nil
        #if os(iOS)
        if twoChannels, let source = session.inputDataSource {
            // The front mics' stereo image is the front camera's: its left
            // is the edge with the side button, the user's right as they
            // look at the screen (WWDC20, "Record stereo audio with
            // AVAudioSession"). Mirror it so left is the user's left.
            channelSign = source.orientation == .front ? -1 : 1
            stereoInput = [source.dataSourceName, source.selectedPolarPattern?.rawValue, session.inputOrientation.label]
                .compactMap { $0 }.joined(separator: " · ")
        }
        #endif
        isRunning = true
    }

    public func stop() {
        guard isRunning else { return }
        tapped?.removeTap(onBus: 0)
        tapped = nil
        engine?.stop()
        if let sink { engine?.detach(sink) }
        engine = nil
        sink = nil
        left.clear()
        right.clear()
        isRunning = false
        isStereo = false
        stereoFlag = false
        stereoInput = nil
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    nonisolated private func dispatch(_ buffer: AVAudioPCMBuffer) {
        handlers.dispatch(buffer)
    }

    /// The latest raw RMS (left channel), 0 while stopped.
    public nonisolated func currentRMS() -> Double {
        let (s, _) = left.latest(count: 1024)
        guard !s.isEmpty else { return 0 }
        var rms: Float = 0
        vDSP_rmsqv(s, 1, &rms, vDSP_Length(s.count))
        return Double(rms)
    }

    /// The last `seconds` of audio (left channel) at the hardware rate.
    public nonisolated func recentSamples(seconds: Double) -> (samples: [Float], sampleRate: Double) {
        left.latest(seconds: seconds)
    }

    /// The last `seconds` of both channels, sample-aligned, at the hardware
    /// rate and as the hardware delivers them (not mirrored) — for recording
    /// or studying the stereo image. Empty until that much has been heard.
    public nonisolated func recentStereo(seconds: Double) -> (left: [Float], right: [Float], sampleRate: Double) {
        let rate = left.sampleRate
        let end = min(left.written, right.written)
        let count = Int(seconds * rate)
        guard count > 0, let l = left.latest(count: count, endingAt: end), let r = right.latest(count: count, endingAt: end) else {
            return ([], [], rate)
        }
        return (l, r, rate)
    }

    /// Reads the latest audio once, as a voice view does every frame, and
    /// returns its RMS level. Only with nothing on screen reading the same
    /// meter: each call steps the spectrum's smoothing. Beside a voice view,
    /// use `currentRMS()`.
    @discardableResult
    public func update() -> Double { read()?.rms ?? 0 }

    /// One analysis of the latest 1024 samples.
    func read() -> MeterReading? {
        let (l, rate) = left.latest(count: analyser.fftSize)
        guard l.count == analyser.fftSize, rate > 0 else { return nil }
        return analyser.analyse(l, sampleRate: rate)
    }

    /// How the two channels differ over the latest 1024 samples, seen from
    /// the user's side; nil without a stereo input. Voiced or not: telling a
    /// voice from the room is up to the reader (VoiceDirectionKit).
    public func stereoFrame() -> StereoFrame? {
        guard stereoFlag else { return nil }
        let rate = left.sampleRate
        let end = min(left.written, right.written)
        guard rate > 0, let l = left.latest(count: analyser.fftSize, endingAt: end),
              let r = right.latest(count: analyser.fftSize, endingAt: end) else { return nil }
        var frame = analyser.stereoFrame(left: l, right: r, sampleRate: rate)
        if channelSign < 0 { frame.mirror() }
        return frame
    }

    #if os(iOS)
    /// Built-in stereo capture: the built-in mic, a data source that offers
    /// the stereo polar pattern — the front one where there is one, facing
    /// whoever holds the phone — and the stereo image matched to portrait.
    private static func preferStereo(_ session: AVAudioSession) {
        guard let builtIn = session.availableInputs?.first(where: { $0.portType == .builtInMic }) else { return }
        try? session.setPreferredInput(builtIn)
        let stereo = builtIn.dataSources?.filter { $0.supportedPolarPatterns?.contains(.stereo) == true } ?? []
        guard let source = stereo.first(where: { $0.orientation == .front }) ?? stereo.first else { return }
        try? source.setPreferredPolarPattern(.stereo)
        try? builtIn.setPreferredDataSource(source)
        try? session.setPreferredInputOrientation(.portrait)
    }
    #endif

    private static func requestPermission() async -> Bool {
        #if os(iOS)
        return await AVAudioApplication.requestRecordPermission()
        #else
        return await AVCaptureDevice.requestAccess(for: .audio)
        #endif
    }
}

#if os(iOS)
private extension AVAudioSession.StereoOrientation {
    var label: String? {
        switch self {
        case .portrait: return "portrait"
        case .portraitUpsideDown: return "upside down"
        case .landscapeLeft: return "landscape left"
        case .landscapeRight: return "landscape right"
        default: return nil
        }
    }
}
#endif

/// One frame's analysis.
struct MeterReading {
    var rms: Double
    /// Smoothed spectrum, 0–1 per bin on the AnalyserNode's −100…−30 dB scale.
    var bins: [Float]
    var binHz: Double
}

// MARK: - Buffer handlers

final class BufferHandlers: @unchecked Sendable {
    private var handlers: [UUID: @Sendable (AVAudioPCMBuffer) -> Void] = [:]
    private let lock = OSAllocatedUnfairLock()

    func add(_ handler: @escaping @Sendable (AVAudioPCMBuffer) -> Void) -> UUID {
        let id = UUID()
        lock.withLockUnchecked { handlers[id] = handler }
        return id
    }

    func remove(_ id: UUID) {
        lock.withLockUnchecked { _ = handlers.removeValue(forKey: id) }
    }

    func dispatch(_ buffer: AVAudioPCMBuffer) {
        let current = lock.withLockUnchecked { Array(handlers.values) }
        for handler in current { handler(buffer) }
    }
}

// MARK: - Ring buffer

/// A mono sample ring, written from the audio thread, read anywhere.
final class SampleRing: @unchecked Sendable {
    private var buffer: [Float]
    private var writeIndex = 0
    private var filled = 0
    private var total = 0
    private var rate: Double = 0
    private let lock = OSAllocatedUnfairLock()

    init(capacity: Int) {
        buffer = [Float](repeating: 0, count: capacity)
    }

    /// Samples written since the reset — the clock that keeps two rings aligned.
    var written: Int { lock.withLockUnchecked { total } }
    var sampleRate: Double { lock.withLockUnchecked { rate } }

    func reset(sampleRate: Double) {
        lock.withLockUnchecked {
            writeIndex = 0
            filled = 0
            total = 0
            rate = sampleRate
        }
    }

    func clear() {
        lock.withLockUnchecked {
            writeIndex = 0
            filled = 0
            total = 0
        }
    }

    /// The `count` samples ending at sample `end` of `written`, so two rings
    /// read at the same `end` line up even if a write lands between the
    /// reads. nil if they have left the ring, or not arrived.
    func latest(count wanted: Int, endingAt end: Int) -> [Float]? {
        lock.withLockUnchecked {
            let after = total - end
            guard wanted > 0, after >= 0, wanted + after <= filled else { return nil }
            let cap = buffer.count
            let start = ((writeIndex - after - wanted) % cap + cap) % cap
            let first = min(wanted, cap - start)
            var out = [Float](repeating: 0, count: wanted)
            buffer.withUnsafeBufferPointer { src in
                out.withUnsafeMutableBufferPointer { dst in
                    dst.baseAddress!.update(from: src.baseAddress! + start, count: first)
                    if wanted > first { (dst.baseAddress! + first).update(from: src.baseAddress!, count: wanted - first) }
                }
            }
            return out
        }
    }

    func write(_ src: UnsafePointer<Float>, count: Int) {
        lock.withLockUnchecked {
            let cap = buffer.count
            var n = min(count, cap)
            var from = src + (count - n)
            buffer.withUnsafeMutableBufferPointer { dst in
                while n > 0 {
                    let run = min(n, cap - writeIndex)
                    (dst.baseAddress! + writeIndex).update(from: from, count: run)
                    writeIndex = (writeIndex + run) % cap
                    from += run
                    n -= run
                }
            }
            filled = min(cap, filled + count)
            total += count
        }
    }

    func latest(count wanted: Int) -> ([Float], Double) {
        lock.withLockUnchecked {
            let n = min(wanted, filled)
            var out = [Float](repeating: 0, count: n)
            guard n > 0 else { return (out, rate) }
            let cap = buffer.count
            let start = (writeIndex - n + cap) % cap
            let first = min(n, cap - start)
            buffer.withUnsafeBufferPointer { src in
                out.withUnsafeMutableBufferPointer { dst in
                    dst.baseAddress!.update(from: src.baseAddress! + start, count: first)
                    if n > first { (dst.baseAddress! + first).update(from: src.baseAddress!, count: n - first) }
                }
            }
            return (out, rate)
        }
    }

    func latest(seconds: Double) -> (samples: [Float], sampleRate: Double) {
        let rate = lock.withLockUnchecked { self.rate }
        guard rate > 0 else { return ([], 0) }
        let (s, r) = latest(count: Int(seconds * rate))
        return (s, r)
    }
}
