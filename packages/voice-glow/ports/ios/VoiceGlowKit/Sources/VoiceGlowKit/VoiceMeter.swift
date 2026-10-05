import AVFoundation
import Accelerate
import Observation
import os

/// The microphone, analysed — the native counterpart of the web
/// `useMicrophone()` + `AnalyserNode` pair.
///
/// The audio thread only copies samples into a ring buffer. The glow reads
/// the level and the three voice bands from it once per frame, the way the
/// web driver reads its `AnalyserNode` (the same 1024-sample window,
/// Blackman FFT, 0.5 smoothing and −100…−30 dB byte scale), so the two
/// react alike. Anything else that wants the audio — an emotion model —
/// pulls the recent seconds with ``recentSamples(seconds:)``.
///
/// ```swift
/// @State private var meter = VoiceMeter()
///
/// VoiceGlow(meter: meter) { Composer() }
/// Button(meter.isRunning ? "Stop" : "Listen") {
///     Task { meter.isRunning ? meter.stop() : try? await meter.start() }
/// }
/// ```
@Observable
@MainActor
public final class VoiceMeter {
    public enum MeterError: Error {
        case permissionDenied
        case noInput
    }

    /// True while the microphone is open.
    public private(set) var isRunning = false

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var sink: AVAudioSinkNode?
    /// The node whose output bus 0 carries the handlers' tap.
    @ObservationIgnored private var tapped: AVAudioNode?
    @ObservationIgnored let ring = SampleRing(capacity: 1 << 18)
    @ObservationIgnored private let analyser = SpectrumAnalyser(fftSize: 1024)
    @ObservationIgnored private let handlers = BufferHandlers()

    public init() {}

    /// Hands every microphone buffer (the hardware format, off the main
    /// thread) to `handler` — for a speech recogniser or a recorder sharing
    /// the meter's microphone. Returns a token for ``removeBufferHandler(_:)``.
    @discardableResult
    public func addBufferHandler(_ handler: @escaping @Sendable (AVAudioPCMBuffer) -> Void) -> UUID {
        handlers.add(handler)
    }

    public func removeBufferHandler(_ id: UUID) {
        handlers.remove(id)
    }

    /// The microphone's RMS over the latest 1024 samples, 0 while stopped —
    /// raw, before the glow's gain and gate.
    public nonisolated func currentRMS() -> Double {
        read()?.rms ?? 0
    }

    /// Asks for the microphone (once) and opens it.
    public func start() async throws {
        guard !isRunning else { return }
        guard await Self.requestPermission() else { throw MeterError.permissionDenied }

        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth, .mixWithOthers])
        #if !targetEnvironment(simulator)
        // Small IO buffers so the level follows the voice within a frame.
        // (The simulator's audio bridge overloads and drops input at 10 ms.)
        try? session.setPreferredIOBufferDuration(0.01)
        #endif
        try session.setActive(true)
        #endif

        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw MeterError.noInput }

        let ring = self.ring
        ring.reset(sampleRate: format.sampleRate)
        // The sink runs on the real-time audio thread: copy channel 0 into
        // the ring and nothing else.
        let sink = AVAudioSinkNode { _, frameCount, bufferList -> OSStatus in
            let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: bufferList))
            guard let first = buffers.first, let data = first.mData else { return noErr }
            ring.write(data.assumingMemoryBound(to: Float.self), count: Int(frameCount))
            return noErr
        }
        engine.attach(sink)
        engine.connect(input, to: sink, format: format)
        // Buffer handlers (speech recognition) get the audio through a tap,
        // off the real-time thread.
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.dispatch(buffer)
        }
        try engine.start()

        self.engine = engine
        self.sink = sink
        tapped = input
        isRunning = true
    }

    /// Plays an audio file through the speaker and meters it as if it were
    /// the microphone — the glow, `recentSamples` and the buffer handlers
    /// all see it. For demos, tests and the simulator.
    public func start(playing url: URL, loop: Bool = false) async throws {
        guard !isRunning else { return }
        let file = try AVAudioFile(forReading: url)
        #if os(iOS)
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try session.setActive(true)
        #endif

        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        let format = file.processingFormat
        engine.connect(player, to: engine.mainMixerNode, format: format)
        ring.reset(sampleRate: format.sampleRate)
        let ring = self.ring
        player.installTap(onBus: 0, bufferSize: 512, format: format) { [weak self] buffer, _ in
            if let data = buffer.floatChannelData?[0] {
                ring.write(data, count: Int(buffer.frameLength))
            }
            self?.dispatch(buffer)
        }
        try engine.start()
        func schedule() {
            player.scheduleFile(file, at: nil) { [weak self] in
                Task { @MainActor in
                    guard let self, self.engine === engine else { return }
                    if loop { schedule() } else { self.stop() }
                }
            }
        }
        schedule()
        player.play()

        self.engine = engine
        tapped = player
        isRunning = true
    }

    nonisolated private func dispatch(_ buffer: AVAudioPCMBuffer) {
        handlers.dispatch(buffer)
    }

    /// Closes the microphone.
    public func stop() {
        guard isRunning else { return }
        tapped?.removeTap(onBus: 0)
        tapped = nil
        engine?.stop()
        if let sink { engine?.detach(sink) }
        engine = nil
        sink = nil
        ring.clear()
        isRunning = false
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #endif
    }

    /// The last `seconds` of audio, mono, at the hardware rate (or less while
    /// the buffer is still filling).
    public nonisolated func recentSamples(seconds: Double) -> (samples: [Float], sampleRate: Double) {
        ring.latest(seconds: seconds)
    }

    /// Raw RMS level and three band levels (lows, mids, highs) of the
    /// latest 1024 samples — unshaped, before the glow's gain.
    nonisolated func read() -> (rms: Double, bands: SIMD3<Double>)? {
        let (samples, rate) = ring.latest(count: analyser.fftSize)
        guard samples.count == analyser.fftSize, rate > 0 else { return nil }
        return analyser.analyse(samples, sampleRate: rate)
    }

    private static func requestPermission() async -> Bool {
        #if os(iOS)
        return await AVAudioApplication.requestRecordPermission()
        #else
        return await AVCaptureDevice.requestAccess(for: .audio)
        #endif
    }
}

// MARK: - Buffer handlers

/// The handlers the audio tap calls, safe to read off the main thread.
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

/// A mono sample ring, written from the audio thread and read anywhere.
/// The lock is held only for a memcpy.
final class SampleRing: @unchecked Sendable {
    private var buffer: [Float]
    private var writeIndex = 0
    private var filled = 0
    private var rate: Double = 0
    private let lock = OSAllocatedUnfairLock()

    init(capacity: Int) {
        buffer = [Float](repeating: 0, count: capacity)
    }

    func reset(sampleRate: Double) {
        lock.withLockUnchecked {
            writeIndex = 0
            filled = 0
            rate = sampleRate
        }
    }

    func clear() {
        lock.withLockUnchecked {
            writeIndex = 0
            filled = 0
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
        }
    }

    func latest(count wanted: Int) -> ([Float], Double) {
        // Bulk copies only: the audio thread waits on this lock.
        lock.withLockUnchecked {
            let n = min(wanted, filled)
            var out = [Float](repeating: 0, count: n)
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

// MARK: - Spectrum

/// The web `AnalyserNode`'s numbers: RMS of the time-domain window, and a
/// Blackman-windowed FFT smoothed over time (τ 0.5) and mapped from
/// −100…−30 dB onto 0–1 — then averaged over the three voice bands.
final class SpectrumAnalyser: @unchecked Sendable {
    let fftSize: Int
    private let log2n: vDSP_Length
    private let setup: FFTSetup
    private let window: [Float]
    private var smoothed: [Float]
    private let lock = OSAllocatedUnfairLock()

    /// Voice bands in Hz: fundamentals and chest, vowels and presence, sibilance.
    static let bands: [(Double, Double)] = [(80, 300), (300, 2000), (2000, 6000)]

    init(fftSize: Int) {
        self.fftSize = fftSize
        log2n = vDSP_Length(log2(Double(fftSize)))
        setup = vDSP_create_fftsetup(log2n, FFTRadix(kFFTRadix2))!
        // The Web Audio Blackman window (α = 0.16).
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

    func analyse(_ samples: [Float], sampleRate: Double) -> (rms: Double, bands: SIMD3<Double>) {
        lock.withLockUnchecked {
            var rms: Float = 0
            vDSP_rmsqv(samples, 1, &rms, vDSP_Length(fftSize))

            var windowed = [Float](repeating: 0, count: fftSize)
            vDSP_vmul(samples, 1, window, 1, &windowed, 1, vDSP_Length(fftSize))

            let half = fftSize / 2
            var real = [Float](repeating: 0, count: half)
            var imag = [Float](repeating: 0, count: half)
            var magnitudes = [Float](repeating: 0, count: half)
            real.withUnsafeMutableBufferPointer { rp in
                imag.withUnsafeMutableBufferPointer { ip in
                    var split = DSPSplitComplex(realp: rp.baseAddress!, imagp: ip.baseAddress!)
                    windowed.withUnsafeBufferPointer { wp in
                        wp.baseAddress!.withMemoryRebound(to: DSPComplex.self, capacity: half) {
                            vDSP_ctoz($0, 2, &split, 1, vDSP_Length(half))
                        }
                    }
                    vDSP_fft_zrip(setup, &split, 1, log2n, FFTDirection(FFT_FORWARD))
                    // zrip packs Nyquist into imag[0]; bin 0 is DC — neither is a voice band.
                    split.imagp[0] = 0
                    vDSP_zvabs(&split, 1, &magnitudes, 1, vDSP_Length(half))
                }
            }
            // zrip's output is 2× the DFT; the analyser divides by N.
            var scale = Float(0.5) / Float(fftSize)
            vDSP_vsmul(magnitudes, 1, &scale, &magnitudes, 1, vDSP_Length(half))

            let binHz = sampleRate / Double(fftSize)
            var out = SIMD3<Double>(0, 0, 0)
            for (b, band) in Self.bands.enumerated() {
                let from = max(0, Int(floor(band.0 / binHz)))
                let to = min(half - 1, Int(ceil(band.1 / binHz)))
                var acc = 0.0
                if to >= from {
                    for i in from...to {
                        smoothed[i] = 0.5 * smoothed[i] + 0.5 * magnitudes[i]
                        let db = 20 * log10(Double(max(smoothed[i], 1e-12)))
                        acc += max(0, min(1, (db + 100) / 70))
                    }
                    out[b] = acc / Double(to - from + 1)
                }
            }
            return (Double(rms), out)
        }
    }
}
