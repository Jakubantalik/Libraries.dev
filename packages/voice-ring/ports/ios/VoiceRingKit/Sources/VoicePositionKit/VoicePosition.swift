// VoicePositionKit — where a voice is, from the iPhone's built-in stereo mics:
// which side it comes from and how far off it is, read by the Voice position
// model (`VoicePosition.mfxl`, libraries.dev/voice-position). Input only: pair
// it with any view.
//
// Everything that exists for the model lives here: the pose (hand or desk),
// the voice gates, the model and its file, the decisions, the calibration.
// VoiceCore only measures the stereo frames; this kit reads them.
//
// The model is not in this package. Add `VoicePosition.mfxl` to your app
// target and it loads on first use; without it the side needs a calibration
// (`calibrate(_:)`, a few seconds of voice from each side) and the distance
// reads nil.

@_exported import VoiceCore
import Foundation
import Observation

/// The voice's side and distance, read about 60 times a second while started.
///
/// ```swift
/// @State private var meter = VoiceMeter()
/// @State private var voice = VoicePosition()
///
/// VoiceRing(state: .listening, source: .meter(meter), direction: voice.pan)
///     .task { try? await voice.start(meter) }
/// ```
@Observable
@MainActor
public final class VoicePosition {
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
    /// How far the voice is: `.small`, the phone within reach, or `.large`,
    /// further off. nil without a stereo input or a distance model for this
    /// pose (the model has none for the hand yet).
    public private(set) var distance: VoiceDistance?
    /// The belief behind `distance`, 0 small … 1 large; nil as for `distance`.
    public private(set) var distanceBelief: Double?
    /// The voice may be further off: `distance` is large, or the belief in it
    /// has begun to build. Changes rarely, so a view can follow it.
    public private(set) var soundsFar = false
    /// Whether the distance follows what the mics hear. Set it false while the
    /// app's own voice plays: they would hear the phone's speaker, not the user,
    /// and the distance holds until it's true again.
    public var readsDistance = true
    /// Whether a distance model reads the current pose.
    public var hasDistanceModel: Bool { DistanceModel.current(pose) != nil }
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
    public var isModelLoaded: Bool { PositionModelFile.bundled != nil }
    /// The loaded model's version, e.g. "2.0".
    public var modelVersion: String? { PositionModelFile.bundled?.version }

    /// The microphone it reads; nil until started.
    public private(set) var meter: VoiceMeter?

    private var sensedPose: DevicePose = .hand
    @ObservationIgnored private var gate = DirectionGate()
    @ObservationIgnored private var decision = DirectionDecision()
    @ObservationIgnored private var distanceGate = DistanceGate()
    @ObservationIgnored private var distanceDecision = DistanceDecision()
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
        distanceGate = DistanceGate()
        distanceDecision = DistanceDecision()
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
        distance = nil
        distanceBelief = nil
        soundsFar = false
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
            distance = nil
            distanceBelief = nil
            soundsFar = false
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

        if let model = DistanceModel.current(pose) {
            if readsDistance {
                distanceGate.step(frame, dt: dt)
                distanceDecision.step(distanceGate.features.map(model.large), dt: dt)
            }
            distanceBelief = distanceDecision.belief
            // read rarely, so a view can follow it without redrawing every frame
            if distance != distanceDecision.distance { distance = distanceDecision.distance }
            let far = distanceDecision.distance == .large || distanceDecision.belief > DistanceDecision.toSmall
            if soundsFar != far { soundsFar = far }
        } else if distance != nil {
            distance = nil
            distanceBelief = nil
            soundsFar = false
        }
    }
}
