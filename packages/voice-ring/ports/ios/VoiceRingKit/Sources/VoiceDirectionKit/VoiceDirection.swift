// VoiceDirectionKit — where a voice comes from, from the iPhone's built-in
// stereo mics, read by the Voice direction model (`VoiceDirection.mfxl`,
// libraries.dev/voice-direction). Input only: pair it with any view.
//
// Everything that exists for the model lives here: the pose (hand or desk),
// the voice gate, the model and its file, the decision, the calibration.
// VoiceCore only measures the stereo frames; this kit reads them.
//
// The model is not in this package. Add `VoiceDirection.mfxl` to your app
// target and it loads on first use; without it the direction needs a
// calibration (`calibrate(_:)`, a few seconds of voice from each side).

@_exported import VoiceCore
import Foundation
import Observation

/// The voice's side, read about 60 times a second while started.
///
/// ```swift
/// @State private var meter = VoiceMeter()
/// @State private var voice = VoiceDirection()
///
/// VoiceRing(state: .listening, source: .meter(meter), direction: voice.pan)
///     .task { try? await voice.start(meter) }
/// ```
@Observable
@MainActor
public final class VoiceDirection {
    /// −1 left … 1 right: the side it has committed to, eased. nil when
    /// there is no direction to read (mono input, or no model and no
    /// calibration for the pose).
    public private(set) var pan: Double?
    /// The committed side: `.ahead` until a voice keeps reading one way.
    public private(set) var side: DirectionSide?
    /// The moment-to-moment reading behind `pan`, before it commits; nil
    /// when quiet. For a readout.
    public private(set) var reading: Double?
    /// The model's belief — left, ahead, right — while a voice is heard;
    /// nil when quiet or read with a calibration.
    public private(set) var probabilities: SIMD3<Double>?
    /// The broad cues behind it, eased over voiced frames; nil when quiet.
    public private(set) var cues: DirectionCues?
    /// The microphone's RMS level, 0–1.
    public private(set) var level: Double = 0
    /// How the phone sits — in the hand or flat on a desk — from its motion
    /// sensors (or `poseOverride`). Each pose has its own model.
    public var pose: DevicePose { poseOverride ?? sensedPose }
    /// Force a pose instead of sensing it.
    public var poseOverride: DevicePose?

    /// Calibrations made with `calibrate(_:)`, one per pose — optional: a
    /// pose's calibration, once it has the left and the right, replaces the
    /// model for that pose. Codable: keep it and set it again next launch.
    public var calibrations: [DevicePose: DirectionCalibration] = [:]
    /// The calibration for the current pose (empty if none).
    public var calibration: DirectionCalibration { calibrations[pose] ?? DirectionCalibration() }
    /// Read with a pose's calibration when it has one (the default), or
    /// always with the model — calibrations still record.
    public var usesCalibration = true
    /// Flip left and right, if the direction still runs the wrong way.
    public var inverted = false

    /// Whether the model file was found and loaded.
    public var isModelLoaded: Bool { DirectionModel.bundled != nil }
    /// The loaded model's version, e.g. "1.0".
    public var modelVersion: String? { DirectionModel.bundled?.version }

    /// The microphone it reads; nil until started.
    public private(set) var meter: VoiceMeter?

    private var sensedPose: DevicePose = .hand
    @ObservationIgnored private var gate = DirectionGate()
    @ObservationIgnored private var decision = DirectionDecision()
    @ObservationIgnored private var lastTick: Double = 0
    @ObservationIgnored private var ticker: Task<Void, Never>?
    @ObservationIgnored private var ownsMeter = false
    #if os(iOS)
    @ObservationIgnored private let poses = PoseTracker()
    #endif

    public init() {}

    /// Starts reading `meter` (a voice view may share it), or a microphone of
    /// its own. Opens the meter in stereo if it isn't running; asks for the
    /// microphone then, so the app needs `NSMicrophoneUsageDescription`.
    public func start(_ meter: VoiceMeter? = nil) async throws {
        let meter = meter ?? self.meter ?? VoiceMeter()
        ownsMeter = self.meter == nil && !meter.isRunning
        self.meter = meter
        if !meter.isRunning { try await meter.start(stereo: true) }
        gate = DirectionGate()
        decision = DirectionDecision()
        lastTick = 0
        #if os(iOS)
        poses.start { [weak self] pose in self?.sensedPose = pose }
        #endif
        ticker?.cancel()
        ticker = Task { [weak self] in
            while !Task.isCancelled {
                self?.tick()
                try? await Task.sleep(for: .milliseconds(16))
            }
        }
    }

    /// Stops reading, and stops the meter if it opened it.
    public func stop() {
        ticker?.cancel()
        ticker = nil
        #if os(iOS)
        poses.stop()
        #endif
        if ownsMeter { meter?.stop() }
        pan = nil
        side = nil
        reading = nil
        probabilities = nil
        cues = nil
        level = 0
    }

    /// Fits the direction to this phone, held the way it will be used. Call
    /// it once per side — `.left`, `.ahead`, `.right` — while someone keeps
    /// talking from there: it waits for the voice, takes `voiceSeconds` of
    /// it (or whatever it heard in `timeout`), and adds the cues to the
    /// current pose's calibration; check `calibration.issue` once all three
    /// are in. Returns the cues, or nil if it heard too little voice.
    @discardableResult
    public func calibrate(_ side: DirectionSide, voiceSeconds: Double = 3, timeout: Double = 12) async -> DirectionCues? {
        guard let meter, meter.isStereo else { return nil }
        let pose = self.pose
        var frames: [StereoFrame] = []
        var quietest = Double.infinity, voiced = 0
        let end = ProcessInfo.processInfo.systemUptime + timeout
        while ProcessInfo.processInfo.systemUptime < end, Double(voiced) < voiceSeconds * 50 {
            try? await Task.sleep(for: .milliseconds(20))
            guard let frame = meter.stereoFrame() else { continue }
            frames.append(frame)
            quietest = min(quietest, frame.power)
            if frame.power > quietest + 20 { voiced += 1 }
        }
        guard let measured = DirectionCalibration.measure(frames) else { return nil }
        calibrations[pose, default: DirectionCalibration()].add(side, cues: measured.cues, spread: measured.spread)
        return measured.cues
    }

    /// Forgets every pose's calibration (back to the model) and the inversion.
    public func resetCalibration() {
        calibrations = [:]
        inverted = false
    }

    private func tick() {
        // the plain RMS, not update(): a voice view reading the same meter
        // steps its analyser once a frame, and a second step would halve
        // the spectrum's smoothing
        level = min(1, meter?.currentRMS() ?? 0)
        guard let frame = meter?.stereoFrame() else {
            pan = nil
            side = nil
            return
        }
        let now = ProcessInfo.processInfo.systemUptime
        let dt = lastTick == 0 ? 1.0 / 60 : min(0.1, now - lastTick)
        lastTick = now
        gate.step(frame, dt: dt)
        cues = gate.cues
        let flip = inverted ? -1.0 : 1.0
        let readable: Bool
        if usesCalibration, calibration.isReady {
            let path = calibration
            readable = true
            probabilities = nil
            reading = gate.cues.map { flip * (path.pan($0) ?? 0) }
        } else if let model = DirectionModel.current(pose) {
            readable = true
            probabilities = gate.features.map(model.probabilities)
            reading = probabilities.map { flip * ($0.z - $0.x) }
        } else {
            // no model in the app and no calibration: no direction
            readable = false
            probabilities = nil
            reading = nil
        }
        decision.step(reading, dt: dt)
        pan = readable ? decision.pan : nil
        side = readable ? (decision.side < 0 ? .left : decision.side > 0 ? .right : .ahead) : nil
    }
}
