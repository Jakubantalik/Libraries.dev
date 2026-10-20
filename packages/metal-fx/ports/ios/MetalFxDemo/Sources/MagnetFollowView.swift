import SwiftUI
import MetalFxKit
import MagnetKit
import simd

/// "Follow": a liquid-metal ring that follows a magnet over the screen or
/// around the phone. First the ring waits near the top: hold the magnet over
/// it for a second and it learns which face is toward the screen and roughly
/// how strong the magnet is (`MagnetDipole.learn`). From then on the
/// physics is solved directly (`MagnetDipole.locate`); beside the phone
/// the ring sits on the screen edge facing the magnet and bends toward it.
/// The 9-dot sensor-spot measurement is optional and sharpens it.
///
/// In the Simulator a draggable puck plays a magnet hovering 1.5 cm above the
/// glass. Launch with `-focus follow`.
struct MagnetFollowView: View {
    var onClose: (() -> Void)? = nil

    @ObservedObject private var follow = FollowSettings.shared
    @State private var showSettings = false
    @State private var measuring = false
    @State private var recording: RealDataPass?
    @State private var rootFrame: CGRect = .zero
    @State private var tracker = FollowTracker()
    @State private var driver = MetalMagnetDriver()
    @State private var puck: CGPoint? = nil
    @State private var pulse = false
    @ObservedObject private var gestures = MagnetGestureFeed.shared
    @State private var puckDrag: CGPoint? = nil
    @State private var grab = GrabState()

    private let page = Color(hex: 0x111111)
    private let ringSize: CGFloat = 64
    private var simulated: Bool { !MagnetSource.shared.isSensorAvailable }

    var body: some View {
        ZStack(alignment: .topLeading) {
            page.ignoresSafeArea()
            TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { ctx in
                let now = ctx.date.timeIntervalSinceReferenceDate
                let r = MagnetSource.shared.reading(now: now)
                let s = follow.engine == .off
                    ? tracker.raw(r, frame: rootFrame, face: follow.face, driver: driver)
                    : follow.ready ? tracker.step(r, now: now, driver: driver) : grabStep(r, now: now)
                ZStack(alignment: .topLeading) {
                    if let p = s.position {
                        let local = place(CGPoint(x: p.x - rootFrame.minX, y: p.y - rootFrame.minY))
                        // How sure the network is: a faint circle of one σ.
                        Circle()
                            .stroke(Color.white.opacity(0.08 * s.confidence), lineWidth: 1)
                            .frame(width: max(ringSize, CGFloat(r.screenSpread) * 2), height: max(ringSize, CGFloat(r.screenSpread) * 2))
                            .position(local)
                        MetalFx(variant: .circle, preset: .chromatic, theme: .dark, strength: 0.95, ringWidth: 4, innerShadow: true,
                                source: .manual(driver), bendConfig: MetalBendConfig.default.scaled(1.6), fill: Color(hex: 0x1A1A1A)) {
                            Color.clear.frame(width: ringSize, height: ringSize)
                        }
                        .opacity(0.25 + 0.75 * s.confidence)
                        .scaleEffect(pulse ? 1.18 : (follow.ready ? 1 : 1 + 0.12 * grab.progress))
                        .position(local)
                    }
                    if !follow.ready, let p = s.position {
                        let local = CGPoint(x: p.x - rootFrame.minX, y: p.y - rootFrame.minY)
                        Circle().trim(from: 0, to: grab.progress)
                            .stroke(Color.white.opacity(0.8), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                            .rotationEffect(.degrees(-90))
                            .frame(width: ringSize + 22, height: ringSize + 22)
                            .position(local)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .allowsHitTesting(false)
            }
            .ignoresSafeArea()

            TimelineView(.periodic(from: .now, by: 0.2)) { ctx in
                let r = MagnetSource.shared.reading(now: ctx.date.timeIntervalSinceReferenceDate)
                if r.calibrating {
                    Text("Calibrating — keep the magnet away")
                        .font(.footnote.weight(.medium)).foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(Color.white.opacity(0.14), in: Capsule())
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, 90)
                } else if r.tooClose {
                    TooCloseWarning()
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                        .padding(.bottom, 90)
                }
            }
            if measuring {
                SpotMeasurement(onDone: { measuring = false })
                    .transition(.opacity)
            }
            if let pass = recording {
                Group {
                    if pass == .session {
                        RealDataSession(onDone: { withAnimation { recording = nil } })
                    } else {
                        RealDataRecording(pass: pass, onDone: { withAnimation { recording = nil } })
                    }
                }
                .ignoresSafeArea()
                .transition(.opacity)
            }
            if simulated {
                // Same full-screen space as the follower (rootFrame), not the safe area.
                ZStack(alignment: .topLeading) { puckView }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .ignoresSafeArea()
            }
        }
        .background {
            GeometryReader { g in
                Color.clear.onChange(of: g.frame(in: .global), initial: true) { _, f in rootFrame = f }
            }
            .ignoresSafeArea()
        }
        .overlay(alignment: .top) { topBar }
        .overlay(alignment: .bottom) {
            if follow.stage == 1 && !measuring && recording == nil {
                Button("Skip — my magnet is too weak down here") { follow.skipFar() }
                    .font(.footnote.weight(.medium)).buttonStyle(.bordered).tint(.white)
                    .padding(.bottom, 24)
            }
        }
        .sheet(isPresented: $showSettings) {
            FollowSettingsSheet(onMeasure: {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { withAnimation { measuring = true } }
            }, onRecord: { pass in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) {
                    withAnimation { if pass == .screen { measuring = true } else { recording = pass } }
                }
            })
            .presentationDetents([.medium, .large])
        }
        .onAppear {
            // `-followReset YES`: start fresh (no grab, no measurement).
            if UserDefaults.standard.bool(forKey: "followReset") { follow.forget(); follow.release() }
            grab = follow.grabState()
            MagnetSource.shared.attach()
            follow.apply(on: true); MagnetLogger.shared.start(); if simulated { feedPuck() }
        }
        .onDisappear {
            follow.apply(on: false); MagnetLogger.shared.stop()
            MagnetSource.shared.detach()
            MagnetSource.shared.simulatedField = nil
            MagnetSource.shared.simulatedAmbient = nil
        }
        .onChange(of: puck) { _, _ in feedPuck() }
        .onChange(of: follow.stage) { _, _ in grab = follow.grabState(); feedPuck() }
        .onChange(of: gestures.seq) { _, _ in
            switch gestures.last {
            case .pullAway(let speed)?: tracker.fling(speedCm: speed)
            case .push?:
                withAnimation(.spring(response: 0.2, dampingFraction: 0.5)) { pulse = true }
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { withAnimation(.spring(response: 0.35, dampingFraction: 0.6)) { pulse = false } }
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
            default: break
            }
        }
    }

    private var topBar: some View {
        HStack(alignment: .top) {
            if let onClose {
                Button(action: onClose) { Image(systemName: "xmark") }
                    .accessibilityLabel("Close")
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("Follow").font(.headline).foregroundStyle(.white)
                Text(follow.stage == 0 ? "Hold the magnet over the ring for a second"
                     : follow.stage == 1 ? "Now over the ring at the bottom"
                     : follow.engine == .off ? "Locator off: raw field direction only"
                     : follow.engine == .network ? "Network locator (v5)"
                     : follow.measured ? follow.accuracyLine : "Over the screen or around the phone")
                    .font(.caption).foregroundStyle(.secondary)
                TimelineView(.periodic(from: .now, by: 0.25)) { _ in
                    Text(gestures.label).font(.caption.weight(.semibold)).foregroundStyle(.white)
                }
            }
            .padding(.leading, onClose == nil ? 4 : 8)
            Spacer()
            Button { showSettings = true } label: { Image(systemName: "gearshape") }
                .accessibilityLabel("Settings")
        }
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(.white)
        .buttonStyle(.bordered)
        .buttonBorderShape(.circle)
        .controlSize(.large)
        .tint(.white)
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .opacity(measuring || recording != nil ? 0 : 1)
    }

    // MARK: Placement and grab

    /// Keep the ring on screen: a magnet beside the phone puts it on the
    /// edge facing the magnet, bending toward it (harder the closer it is).
    private func place(_ p: CGPoint) -> CGPoint {
        let w = rootFrame.width, h = rootFrame.height
        guard w > 0, follow.ready, follow.engine != .off else { return p }
        let inset = ringSize / 2 + 10
        let q = CGPoint(x: min(max(p.x, inset), w - inset), y: min(max(p.y, inset + 110), h - inset - 20))   // below the header
        let dx = p.x - q.x, dy = p.y - q.y
        let out = hypot(dx, dy)
        if out > 4 {
            driver.toward = CGVector(dx: dx / out, dy: dy / out)
            // 1 at the edge, fading over ~10 cm away.
            driver.pull = max(0.25, 1 - Double(out) / (10 * 60.4))
        }
        return q
    }

    /// Before tracking: the ring waits at a grab spot. Top spot: the face and
    /// a first strength. Bottom spot (far from the sensor): the strength again,
    /// sturdily, and from both the sensor's real spot.
    private func grabStep(_ r: MagnetReading, now: TimeInterval) -> FollowTracker.State {
        let stage = follow.stage
        let spot = stage == 0 ? FollowSettings.grabSpot(rootFrame) : FollowSettings.farGrabSpot(rootFrame)
        driver.pull = 0
        if let g = grab.tick(r, now: now) {
            let sensor = follow.sensor
            // Screen points -> device axes (portrait): y flips.
            let offset = SIMD2(Double(spot.x - sensor.x) / 60.4, -Double(spot.y - sensor.y) / 60.4)
            if stage == 0, let learned = MagnetDipole.learn(field: g, magnetAt: offset) {
                DispatchQueue.main.async {
                    follow.learn(face: learned.face, strength: learned.strength, topField: g, topSpot: spot)
                    UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                }
            } else if stage == 1 {
                DispatchQueue.main.async {
                    follow.learnFar(field: g, spot: spot)
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                }
            }
        }
        return FollowTracker.State(position: spot, confidence: 0.6 + 0.4 * grab.progress)
    }

    // MARK: Simulator: a magnet hovering 1.5 cm above the glass

    private var puckView: some View {
        let p = puck ?? CGPoint(x: rootFrame.midX - rootFrame.minX, y: rootFrame.midY - rootFrame.minY)
        return Circle()
            .fill(LinearGradient(colors: [Color(hex: 0x5A5A5A), Color(hex: 0x2A2A2A)], startPoint: .top, endPoint: .bottom))
            .overlay(Circle().stroke(Color.white.opacity(0.25)))
            .overlay(Text("N").font(.system(size: 13, weight: .bold, design: .rounded)).foregroundStyle(Color(hex: 0xFF7A7A)))
            .frame(width: 36, height: 36)
            .opacity(0.8)
            .position(p)
            .gesture(DragGesture(minimumDistance: 1).onChanged { v in
                if puckDrag == nil { puckDrag = p }
                let s = puckDrag ?? p
                puck = CGPoint(x: s.x + v.translation.width, y: s.y + v.translation.height)
            }.onEnded { _ in puckDrag = nil })
    }

    private func feedPuck() {
        guard simulated else { return }
        let src = MagnetSource.shared
        src.simulatedAmbient = MagnetSimulator.ambient
        guard let p = puck, rootFrame.width > 0 else { src.simulatedField = MagnetSimulator.ambient; return }
        var global = CGPoint(x: p.x + rootFrame.minX, y: p.y + rootFrame.minY)
        // The simulated phone's "true" sensor spot (the measurement should find it).
        let sensor = FollowSettings.simulatedSensorSpot(rootFrame)
        var depth = -1.9, moment = 6500.0
        // `-simDesk YES`: the puck stands for a magnet beside the phone on a
        // desk — its offset from the screen centre is scaled ×2.5 outward,
        // held `-simDeskHeight` cm (default 3) above the desk.
        let simDesk = UserDefaults.standard.bool(forKey: "simDesk")
        if simDesk { moment = 60000 }
        if simDesk, follow.ready {
            let c = CGPoint(x: rootFrame.midX, y: rootFrame.midY)
            global = CGPoint(x: c.x + (global.x - c.x) * 2.5, y: c.y + (global.y - c.y) * 2.5)
            let h = UserDefaults.standard.object(forKey: "simDeskHeight") as? Double ?? 3.0
            depth = -(h - 0.4)
        }
        let b = MagnetSimulator.field(magnet: global, sensor: sensor, northUp: true, moment: moment, depth: depth)
        src.simulatedField = MagnetSimulator.ambient + b
    }
}

/// Waits for a magnet held still and strong enough; returns its mean field once.
final class GrabState {
    let threshold: Double
    /// Above this the magnet is not at the spot yet (the bottom grab must not
    /// fire while the magnet still sits at the top spot).
    let ceiling: Double
    init(threshold: Double = 8, ceiling: Double = .infinity) { self.threshold = threshold; self.ceiling = ceiling }
    private var buffer: [(t: Double, d: SIMD3<Double>)] = []
    private(set) var progress = 0.0
    private var done = false

    func tick(_ r: MagnetReading, now: Double) -> SIMD3<Double>? {
        guard !done else { return nil }
        guard r.strength > threshold, r.strength < ceiling, !r.calibrating else { buffer = []; progress = 0; return nil }
        buffer.append((now, r.delta))
        buffer.removeAll { now - $0.t > 0.8 }
        var mean = SIMD3<Double>(0, 0, 0)
        for b in buffer { mean += b.d }
        mean /= Double(buffer.count)
        let spread = buffer.map { simd_length($0.d - mean) }.max() ?? 0
        if spread > max(2, 0.1 * simd_length(mean)) { buffer = [(now, r.delta)]; progress = 0; return nil }
        let held = now - (buffer.first?.t ?? now)
        progress = min(1, held / 0.6)
        guard held >= 0.6 else { return nil }
        done = true
        return mean
    }
}

/// Per-frame follower state: smoothed position, speed-driven liquid bend, confidence.
final class FollowTracker {
    private var last: CGPoint?
    private var lastT: TimeInterval = 0
    private var vel = CGVector.zero
    private var conf = 0.0
    private var flingUntil: TimeInterval = 0

    /// Pulled away fast. If the magnet is gone right after, the ring flies
    /// on along its last motion; if it is still there, nothing happens (a
    /// fast move far from the sensor can look like a pull-away).
    func fling(speedCm: Double, now: TimeInterval = Date().timeIntervalSinceReferenceDate) {
        flingUntil = now + 0.5
        let boost = 1 + min(2, speedCm / 20)
        vel = CGVector(dx: vel.dx * boost, dy: vel.dy * boost)
    }

    struct State { var position: CGPoint?; var confidence: Double }

    func step(_ r: MagnetReading, now: TimeInterval, driver: MetalMagnetDriver) -> State {
        let dt = lastT > 0 ? min(0.1, max(0.001, now - lastT)) : 1.0 / 60
        lastT = now
        guard let p = r.screenPosition, r.presence > 0.3 else {
            // Lost: drift on with friction (after a fling, faster) while fading.
            let flying = now < flingUntil + 0.6
            if flying, let l = last, hypot(vel.dx, vel.dy) > 30 {
                last = CGPoint(x: l.x + vel.dx * dt, y: l.y + vel.dy * dt)
                vel = CGVector(dx: vel.dx * exp(-dt / 0.45), dy: vel.dy * exp(-dt / 0.45))
            }
            conf += (0 - conf) * (1 - exp(-dt / (flying ? 0.5 : 0.25)))
            driver.pull = flying ? min(1, hypot(vel.dx, vel.dy) / 600) : 0
            return State(position: conf > 0.02 ? last : nil, confidence: conf)
        }
        if let l = last {
            let a = 1 - exp(-dt / 0.06)
            vel = CGVector(dx: vel.dx + ((p.x - l.x) / dt - vel.dx) * a, dy: vel.dy + ((p.y - l.y) / dt - vel.dy) * a)
        }
        last = p
        // Sure when the spread is small next to the ring.
        let target = 1 - min(1, max(0, (r.screenSpread - 60) / 240))
        conf += (target - conf) * (1 - exp(-dt / 0.15))
        // The liquid stretches along the motion.
        let speed = hypot(vel.dx, vel.dy)
        driver.pull = min(1, speed / 600)
        if speed > 5 { driver.toward = CGVector(dx: vel.dx / speed, dy: vel.dy / speed) }
        return State(position: p, confidence: conf)
    }

    /// No locator ("Off"): the ring moves from the screen centre the way the
    /// raw field points, as far as the field is strong — no physics, no model.
    func raw(_ r: MagnetReading, frame: CGRect, face: Int?, driver: MetalMagnetDriver) -> State {
        guard r.strength > 2.5 else {
            conf += (0 - conf) * 0.15
            driver.pull = 0
            return State(position: conf > 0.02 ? last : nil, confidence: conf)
        }
        // Device axes -> screen (portrait: y flips); a south-up magnet points the other way.
        let f: Double = (face ?? 1) < 0 ? -1 : 1
        var dx = r.delta.x * f, dy = -r.delta.y * f
        let n = hypot(dx, dy)
        if n > 1e-6 { dx /= n; dy /= n }
        let reach = Double(min(frame.width, frame.height)) * 0.45 * r.pull
        let p = CGPoint(x: frame.midX + dx * reach, y: frame.midY + dy * reach)
        if let l = last { last = CGPoint(x: l.x + (p.x - l.x) * 0.25, y: l.y + (p.y - l.y) * 0.25) } else { last = p }
        conf += (1 - conf) * 0.15
        driver.pull = r.pull
        driver.toward = CGVector(dx: dx, dy: dy)
        return State(position: last, confidence: conf)
    }
}

// MARK: - Settings

/// How Follow finds the magnet.
enum FollowEngine: String, CaseIterable, Identifiable {
    case physics = "Physics", network = "Network", off = "Off (raw field)"
    var id: String { rawValue }
    var note: String {
        switch self {
        case .physics: return "Solves the magnet's field directly. Needs the grab (face and strength). Over the screen and around the phone."
        case .network: return "The trained locator (v5, simulated physics). Over the screen and around the phone; uses the grab's face and strength. Copes better than Physics with a tilted magnet."
        case .off: return "No locator: the ring moves from the centre the way the raw field points, as far as it is strong. What the sensor gives without any model."
        }
    }
}

/// Which magnet: a known profile makes the locator sharper.
enum MagnetProfile: String, CaseIterable, Identifiable {
    case ring10x8x2 = "10×8×2 ring", disc10x3 = "10×3 disc", disc12x5 = "12×5 disc", unknown = "Unknown"
    var id: String { rawValue }
    /// Dipole constant, µT·cm³ (N52: Br·V/4π).
    var strength: Double? {
        switch self {
        case .ring10x8x2: return 6500
        case .disc10x3: return 27000
        case .disc12x5: return 65000
        case .unknown: return nil
        }
    }
}

final class FollowSettings: ObservableObject {
    static let shared = FollowSettings()
    private let d = UserDefaults.standard

    @Published var profile: MagnetProfile { didSet { d.set(profile.rawValue, forKey: "followProfileV2"); apply(on: active) } }
    @Published var engine: FollowEngine { didSet { d.set(engine.rawValue, forKey: "followEngine"); apply(on: active) } }
    /// Fitted by the measurement (global points), and the strength it found.
    @Published private(set) var sensorSpot: CGPoint?
    @Published private(set) var fittedStrength: Double?
    /// Which face the measurement found pointing at the screen (+1 north, −1 south).
    @Published private(set) var face: Int?
    /// Leave-one-out error per screen third, cm.
    @Published private(set) var accuracy: [Double]?
    private var active = false

    private init() {
        // Unknown by default: the grab learns the strength of whatever magnet you hold.
        profile = MagnetProfile(rawValue: d.string(forKey: "followProfileV2") ?? "") ?? .unknown
        engine = FollowEngine(rawValue: d.string(forKey: "followEngine") ?? "") ?? .physics
        if let a = d.array(forKey: "followSensorSpot") as? [Double], a.count == 2 { sensorSpot = CGPoint(x: a[0], y: a[1]) }
        if d.object(forKey: "followStrength") != nil { fittedStrength = d.double(forKey: "followStrength") }
        if d.object(forKey: "followFace") != nil { face = d.integer(forKey: "followFace") }
        farDone = d.bool(forKey: "followFarDone")
        if let a = d.array(forKey: "followGrabSensor") as? [Double], a.count == 2 { grabSensorSpot = CGPoint(x: a[0], y: a[1]) }
        accuracy = d.array(forKey: "followAccuracy") as? [Double]
    }

    var measured: Bool { sensorSpot != nil }
    /// The far (bottom) grab is done or skipped.
    @Published private(set) var farDone: Bool
    /// The sensor's spot as the two grabs put it (global points).
    @Published private(set) var grabSensorSpot: CGPoint?
    private var topField: SIMD3<Double>?
    private var topSpot: CGPoint?

    /// 0: waiting for the top grab, 1: for the bottom grab, 2: following.
    var stage: Int { engine == .off ? 2 : (face == nil ? 0 : (farDone ? 2 : 1)) }
    var ready: Bool { stage == 2 }
    /// The sensor spot in use: measured (9 dots), else from the grabs, else a guess.
    var sensor: CGPoint { sensorSpot ?? grabSensorSpot ?? Self.guessSpot() }

    /// Top grab: which face is toward the screen and a first strength.
    func learn(face: Int, strength: Double, topField: SIMD3<Double>, topSpot: CGPoint) {
        self.face = face; fittedStrength = strength
        self.topField = topField; self.topSpot = topSpot
        d.set(face, forKey: "followFace"); d.set(strength, forKey: "followStrength")
        farDone = false; d.set(false, forKey: "followFarDone")
        apply(on: active)
    }

    /// Bottom grab: the sturdy strength (far away the distance hardly
    /// depends on height or tilt); the top grab, re-solved with it, says where
    /// the sensor really sits; a few rounds settle both.
    func learnFar(field: SIMD3<Double>, spot: CGPoint) {
        func offset(_ p: CGPoint, _ s: CGPoint) -> SIMD2<Double> {
            SIMD2(Double(p.x - s.x) / 60.4, -Double(p.y - s.y) / 60.4)
        }
        var s = sensor
        guard var k = MagnetDipole.strength(field: field, magnetAt: offset(spot, s)) else { skipFar(); return }
        if sensorSpot == nil, let f = face, let top = topField, let tspot = topSpot {
            let b = UIScreen.main.bounds
            for _ in 0..<4 {
                guard let r = MagnetDipole.locate(field: top, face: f, strength: k, maxHeight: 4) else { break }
                let n = CGPoint(x: tspot.x - r.position.x * 60.4, y: tspot.y + r.position.y * 60.4)
                // Only where a magnetometer can be: the top part of the phone.
                guard n.x > b.minX - 20, n.x < b.maxX + 20, n.y > -40, n.y < b.height * 0.45 else { break }
                s = n
                guard let k2 = MagnetDipole.strength(field: field, magnetAt: offset(spot, s)) else { break }
                k = k2
            }
            if s != sensor { grabSensorSpot = s; d.set([s.x, s.y], forKey: "followGrabSensor") }
        }
        fittedStrength = k; d.set(k, forKey: "followStrength")
        farDone = true; d.set(true, forKey: "followFarDone")
        apply(on: active)
    }

    /// What the next grab waits for. The bottom spot is ~3× farther from the
    /// sensor than the top one, so its field is a few % of the top reading:
    /// anything above 40 % means the magnet has not moved down yet.
    func grabState() -> GrabState {
        if stage == 1, let t = topField { return GrabState(threshold: 4, ceiling: 0.4 * simd_length(t)) }
        return GrabState(threshold: stage == 1 ? 4 : 8)
    }

    func skipFar() { farDone = true; d.set(true, forKey: "followFarDone"); apply(on: active) }

    /// Let go: the ring waits for a new grab.
    func release() {
        face = nil; farDone = false; grabSensorSpot = nil
        for k in ["followFace", "followFarDone", "followGrabSensor"] { d.removeObject(forKey: k) }
        apply(on: active)
    }

    /// Where the ring waits for the top grab: centred, ~5 cm below the sensor
    /// (closer, a strong magnet overloads the sensor and magnetises the phone).
    static func grabSpot(_ frame: CGRect) -> CGPoint {
        let s = FollowSettings.shared.sensor
        return CGPoint(x: frame.midX, y: s.y + 5.0 * 60.4)
    }

    /// The bottom grab: centred, 80 % of the way down.
    static func farGrabSpot(_ frame: CGRect) -> CGPoint {
        CGPoint(x: frame.midX, y: frame.minY + frame.height * 0.8)
    }

    var accuracyLine: String {
        guard let a = accuracy, a.count == 3 else { return "Sensor spot measured" }
        return String(format: "Measured here: top %.1f · mid %.1f · bottom %.1f cm", a[0], a[1], a[2])
    }

    func save(spot: CGPoint, strength: Double?, face: Int?, accuracy: [Double]) {
        sensorSpot = spot; fittedStrength = strength; self.face = face; self.accuracy = accuracy
        d.set([spot.x, spot.y], forKey: "followSensorSpot")
        if let strength { d.set(strength, forKey: "followStrength") } else { d.removeObject(forKey: "followStrength") }
        if let face { d.set(face, forKey: "followFace") } else { d.removeObject(forKey: "followFace") }
        d.set(accuracy, forKey: "followAccuracy")
        apply(on: active)
    }

    func forget() {
        sensorSpot = nil; fittedStrength = nil; face = nil; accuracy = nil
        for k in ["followSensorSpot", "followStrength", "followFace", "followAccuracy"] { d.removeObject(forKey: k) }
        apply(on: active)
    }

    /// The magnet was turned over since the measurement.
    func flipFace() {
        guard let f = face else { return }
        face = -f; d.set(-f, forKey: "followFace")
        apply(on: active)
    }

    var faceLabel: String {
        switch face { case 1?: return "North toward you"; case (-1)?: return "South toward you"; default: return "Not grabbed yet" }
    }

    /// Before measuring: the top centre, where most iPhones keep the magnetometer.
    static func guessSpot() -> CGPoint {
        let b = UIScreen.main.bounds
        return CGPoint(x: b.midX, y: 70)
    }

    /// The Simulator's pretend sensor spot (off-centre on purpose).
    static func simulatedSensorSpot(_ frame: CGRect) -> CGPoint {
        let b = UIScreen.main.bounds
        return CGPoint(x: b.width * 0.68, y: 64)
    }

    func apply(on: Bool) {
        active = on
        var cfg = MagnetSource.shared.config
        cfg.locatorEnabled = on && engine != .off
        cfg.sensorPosition = on ? sensor : nil
        cfg.magnetStrength = profile == .unknown ? fittedStrength : profile.strength
        cfg.magnetFace = face
        cfg.locatorMode = engine == .network ? .network : .dipole
        cfg.pointsPerCm = 60.4
        // A magnet held still at the far end of the screen reads ~5 µT: keep
        // it rather than easing the baseline onto it as drift.
        cfg.driftThreshold = on ? 2.5 : nil
        MagnetSource.shared.config = cfg
    }
}

struct FollowSettingsSheet: View {
    @ObservedObject var follow = FollowSettings.shared
    let onMeasure: () -> Void
    var onRecord: (RealDataPass) -> Void = { _ in }
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TimelineView(.periodic(from: .now, by: 0.1)) { ctx in
                        let r = MagnetSource.shared.reading(now: ctx.date.timeIntervalSinceReferenceDate)
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline) {
                                Text("\(Int(r.strength.rounded()))").font(.title.weight(.semibold)).monospacedDigit()
                                Text("µT").foregroundStyle(.secondary)
                                Spacer()
                                if let h = r.height {
                                    Text(String(format: "height %.1f cm · ±%.1f cm", h, r.screenSpread / 60.4))
                                        .font(.footnote.monospaced()).foregroundStyle(.secondary)
                                }
                            }
                            Text(r.available ? (r.calibrating ? "Calibrating — keep magnets away." : "Hover the magnet over the screen.") : "No magnetometer here — drag the puck.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                } header: { Text("Sensor") }

                Section {
                    Button("Calibrate", systemImage: "scope") { MagnetSource.shared.calibrate() }
                    if follow.stage > 0 {
                        Button("Grab the magnet again", systemImage: "hand.raised") { follow.release(); dismiss() }
                    }
                    Button(follow.measured ? "Measure again" : "Measure sensor spot (optional)", systemImage: "dot.viewfinder") {
                        dismiss(); onMeasure()
                    }
                    LabeledContent("Magnet face", value: follow.faceLabel)
                    if follow.face != nil {
                        Button("I turned the magnet over", systemImage: "arrow.triangle.2.circlepath") { follow.flipFace() }
                    }
                    if follow.measured {
                        LabeledContent("Accuracy", value: follow.accuracyLine.replacingOccurrences(of: "Measured here: ", with: ""))
                        Button("Forget measurement", role: .destructive) { follow.forget() }
                    }
                } footer: {
                    Text("Calibrate with no magnet near. The grab (hold the magnet over the ring) learns the magnet's face and strength. Around the phone, hold the magnet a little above the desk rather than resting it flat: lying at the sensor's height it barely shows which side it is on. Measuring the sensor spot (9 dots) is optional and sharpens the position.")
                }

                Section {
                    Picker("Locator", selection: $follow.engine) {
                        ForEach(FollowEngine.allCases) { e in Text(e.rawValue).tag(e) }
                    }
                } header: { Text("Locator") } footer: { Text(follow.engine.note) }

                Section {
                    NavigationLink {
                        RealDataSetup(onStart: { pass in dismiss(); onRecord(pass) })
                    } label: { Label("Record real data", systemImage: "square.grid.3x3.topleft.filled") }
                } footer: { Text("Known positions on a printed mat: measures the real accuracy and is what a fine-tuned model learns from.") }

                Section("Magnet") {
                    Picker("Magnet", selection: $follow.profile) {
                        ForEach(MagnetProfile.allCases) { p in Text(p.rawValue).tag(p) }
                    }
                }
            }
            .navigationTitle("Follow")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { dismiss() } label: { Image(systemName: "checkmark") }
                }
            }
        }
    }
}

// MARK: - Sensor-spot measurement

/// Nine dots over the screen. Each records the field with the magnet hovering
/// over it; then the sensor spot is the offset that best lines the network's
/// answers up with the dots, the strength is picked from a short list, and
/// the accuracy is the leave-one-out error per screen third.
final class SpotRecorder: ObservableObject {
    /// A dot: the mean field held there, and every reading of that second.
    struct Sample { let dot: CGPoint; let field: SIMD3<Double>; var readings: [SIMD3<Double>] = [] }
    let dots: [CGPoint]
    @Published private(set) var step = 0
    @Published private(set) var progress = 0.0
    @Published private(set) var needsLift = false
    @Published private(set) var strength = 0.0
    private(set) var samples: [Sample] = []
    private var buffer: [(t: Double, raw: SIMD3<Double>)] = []
    private var ambient: SIMD3<Double>?
    private var lastStrength = 0.0
    private var lastRaw: SIMD3<Double>?
    private var smooth: SIMD3<Double>?
    private var lastT = 0.0
    /// Weakest field a dot records at, µT. A 10×8×2 ring 1.5 cm over the
    /// bottom row reads only ~5 µT on a phone with its sensor at the top.
    static let threshold = 4.0

    init(dots: [CGPoint]) { self.dots = dots }
    var done: Bool { step >= dots.count }
    var current: CGPoint? { done ? nil : dots[step] }

    func skip() { if !done { step += 1; buffer = []; progress = 0 } }

    /// Go round the dots again (the other face of the magnet); the magnet has
    /// to leave the last dot first.
    func restart() { step = 0; samples = []; buffer = []; progress = 0; needsLift = true }

    func tick(_ r: MagnetReading, now: Double) -> Bool {
        let dt = lastT > 0 ? min(0.2, now - lastT) : 1.0 / 30
        lastT = now
        if abs(strength - r.strength) > 0.5 { strength = r.strength }
        guard !done else { return false }
        let threshold = Self.threshold
        smooth = smooth.map { $0 + (r.raw - $0) * (1 - exp(-dt / 0.1)) } ?? r.raw
        if r.strength < threshold * 0.5 {
            ambient = ambient.map { $0 + (r.raw - $0) * (1 - exp(-dt / 0.3)) } ?? r.raw
        }
        if needsLift {
            // Lifted, or moved on: far from the sensor lifting barely changes
            // the field, so a clear change from the recorded one counts too.
            let lifted = r.strength < max(threshold * 0.7, lastStrength * 0.35)
            let moved = lastRaw.map { l in smooth.map { simd_length($0 - l) > max(1.0, 0.2 * lastStrength) } ?? false } ?? false
            if lifted || moved { needsLift = false; buffer = [] }
            progress = 0
            return false
        }
        guard r.strength >= threshold else { buffer = []; progress = 0; return false }
        buffer.append((now, r.raw))
        buffer.removeAll { now - $0.t > 1.0 }
        var mean = SIMD3<Double>(0, 0, 0)
        for b in buffer { mean += b.raw }
        mean /= Double(buffer.count)
        let spread = buffer.map { simd_length($0.raw - mean) }.max() ?? 0
        if spread > max(1.5, 0.06 * r.strength) { buffer = [(now, r.raw)]; progress = 0; return false }
        let held = now - (buffer.first?.t ?? now)
        progress = min(1, held / 0.8)
        guard held >= 0.8 else { return false }
        let zero = ambient ?? (mean - r.delta)
        let field = mean - zero
        samples.append(Sample(dot: dots[step], field: field, readings: buffer.map { $0.raw - zero }))
        lastStrength = simd_length(field)
        lastRaw = mean
        step += 1; needsLift = true; buffer = []; progress = 0
        return true
    }

    /// Fit the sensor spot (and the strength if unknown); leave-one-out error per third.
    static func fit(_ samples: [Sample], strengths: [Double?], ppcm: Double, screen: CGRect) -> (spot: CGPoint, strength: Double?, face: Int?, accuracy: [Double])? {
        guard samples.count >= 4, let loc = MagnetModel.bundled?.locator else { return nil }
        var best: (score: Double, spot: CGPoint, strength: Double?, face: Int?, offsets: [CGPoint])?
        // Each face and strength: the one whose answers line up best with the dots.
        let faces: [Int?] = loc.takesFace ? [1, -1] : [nil]
        for face in faces { for k in strengths {
            var offs: [CGPoint] = []
            for s in samples {
                guard let r = loc.locate(field: s.field, strength: k, face: face) else { continue }
                // Screen offset of the magnet from the sensor.
                offs.append(CGPoint(x: r.position.x * ppcm, y: -r.position.y * ppcm))
            }
            guard offs.count == samples.count else { continue }
            let spot = medianSpot(samples.map(\.dot), offs)
            let errs = zip(samples, offs).map { hypot($0.dot.x - (spot.x + $1.x), $0.dot.y - (spot.y + $1.y)) }
            let score = Double(errs.sorted()[errs.count / 2])
            if best == nil || score < best!.score { best = (score: score, spot: spot, strength: k, face: face, offsets: offs) }
        } }
        guard let b = best else { return nil }
        // Leave-one-out: fit the spot without each dot, measure that dot.
        var perThird: [[Double]] = [[], [], []]
        for i in samples.indices {
            var dots = samples.map(\.dot), offs = b.offsets
            let dot = dots.remove(at: i), off = offs.remove(at: i)
            let spot = medianSpot(dots, offs)
            let e = hypot(dot.x - (spot.x + off.x), dot.y - (spot.y + off.y)) / ppcm
            let third = min(2, max(0, Int((dot.y - screen.minY) / (screen.height / 3))))
            perThird[third].append(e)
        }
        let acc = perThird.map { $0.isEmpty ? .nan : $0.sorted()[$0.count / 2] }
        return (b.spot, b.strength, b.face, acc)
    }

    private static func medianSpot(_ dots: [CGPoint], _ offs: [CGPoint]) -> CGPoint {
        let xs = zip(dots, offs).map { $0.x - $1.x }.sorted(), ys = zip(dots, offs).map { $0.y - $1.y }.sorted()
        return CGPoint(x: xs[xs.count / 2], y: ys[ys.count / 2])
    }
}

private struct SpotMeasurement: View {
    let onDone: () -> Void
    @State private var recorder: SpotRecorder?
    @State private var result: String?

    var body: some View {
        GeometryReader { g in
            let frame = g.frame(in: .global)
            ZStack {
                if let recorder {
                    SpotCard(recorder: recorder, frame: frame, result: result,
                             onFinish: { finish(recorder, frame) }, onCancel: onDone)
                }
            }
            .frame(width: frame.width, height: frame.height)
            .onAppear {
                guard recorder == nil else { return }
                var dots: [CGPoint] = []
                for fy in [0.2, 0.5, 0.8] { for fx in [0.2, 0.5, 0.8] { dots.append(CGPoint(x: frame.minX + frame.width * fx, y: frame.minY + frame.height * fy)) } }
                recorder = SpotRecorder(dots: dots)
                MagnetSource.shared.holdBaseline = true
            }
            .onDisappear { MagnetSource.shared.holdBaseline = false }
        }
        .ignoresSafeArea()
    }

    private func finish(_ r: SpotRecorder, _ frame: CGRect) {
        RealDataStore.save(pass: .screen, samples: r.samples.map { s in
            RealDataSample(dot: (r.dots.firstIndex(of: s.dot) ?? -1) + 1, mm: RealDataStore.mm(fromScreen: s.dot),
                           field: s.field, readings: s.readings, lap: 1, face: FollowSettings.shared.face)
        })
        let follow = FollowSettings.shared
        let strengths: [Double?] = follow.profile == .unknown ? [nil, 2000, 4000, 6500, 12000, 27000, 45000, 65000] : [follow.profile.strength]
        if let fit = SpotRecorder.fit(r.samples, strengths: strengths, ppcm: 60.4, screen: frame) {
            follow.save(spot: fit.spot, strength: fit.strength, face: fit.face, accuracy: fit.accuracy)
            result = follow.accuracyLine
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { onDone() }
        } else {
            result = "Not enough dots — record at least 4."
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { onDone() }
        }
    }
}

private struct SpotCard: View {
    @ObservedObject var recorder: SpotRecorder
    let frame: CGRect
    let result: String?
    let onFinish: () -> Void
    let onCancel: () -> Void
    @State private var finished = false
    @State private var pulse = false
    private let timer = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()
    private let haptic = UINotificationFeedbackGenerator()

    var body: some View {
        let r = recorder
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.65)
            ForEach(Array(r.dots.enumerated()), id: \.offset) { i, d in
                Circle().fill(i < r.step ? Color.white.opacity(0.35) : Color.white.opacity(0.08))
                    .frame(width: 10, height: 10)
                    .position(x: d.x - frame.minX, y: d.y - frame.minY)
            }
            if let d = r.current {
                ZStack {
                    Circle().fill(Color.white.opacity(0.12)).frame(width: 60, height: 60).scaleEffect(pulse ? 1.15 : 0.95)
                    Circle().trim(from: 0, to: r.progress).stroke(Color.white, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90)).frame(width: 44, height: 44)
                    Circle().fill(.white).frame(width: 8, height: 8)
                }
                .position(x: d.x - frame.minX, y: d.y - frame.minY)
            }
            VStack(spacing: 10) {
                Text(result ?? "Measure sensor spot · \(min(r.step + 1, r.dots.count))/\(r.dots.count)")
                    .font(.headline).foregroundStyle(.white).multilineTextAlignment(.center)
                if result == nil {
                    Text(r.needsLift ? "Got it. Lift the magnet and move to the next dot."
                         : "Hover the magnet about 1–2 cm over the dot and hold still.")
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                    Text("\(Int(r.strength.rounded())) µT  ·  needs \(Int(SpotRecorder.threshold))  ·  \(r.samples.count) recorded")
                        .font(.caption.monospaced()).foregroundStyle(r.strength >= SpotRecorder.threshold ? .primary : .secondary)
                    HStack(spacing: 10) {
                        Button("Cancel", action: onCancel)
                        Button("Skip dot") { r.skip(); finishIfDone() }
                        if r.samples.count >= 4 { Button("Done", action: finishOnce) }
                    }
                    .font(.footnote.weight(.medium)).buttonStyle(.bordered)
                }
            }
            .padding(18)
            .frame(maxWidth: 300)
            .background(Color(white: 0.09), in: RoundedRectangle(cornerRadius: 20))
            .position(x: frame.width / 2, y: frame.height * 0.35)
        }
        .onAppear {
            haptic.prepare()
            withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) { pulse = true }
        }
        .onReceive(timer) { date in
            let now = date.timeIntervalSinceReferenceDate
            if r.tick(MagnetSource.shared.reading(now: now), now: now) { haptic.notificationOccurred(.success) }
            finishIfDone()
        }
    }

    private func finishIfDone() { if recorder.done { finishOnce() } }
    private func finishOnce() {
        guard !finished else { return }
        finished = true
        onFinish()
    }
}
