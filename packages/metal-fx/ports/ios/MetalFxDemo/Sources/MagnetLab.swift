import SwiftUI
import MetalFxKit
import simd

// Shared by the magnet demos: persisted settings, direction training, and
// the settings sheet.

/// Trained directions as saved: the spots plus the point their angles are measured from.
struct SavedDirections: Codable, Equatable {
    var origin: CGPoint?
    var templates: [MetalMagnetTemplate]
}

/// What drives the magnet demos' rings.
enum MagnetDrive: String, CaseIterable, Identifiable {
    case magnet = "Magnet", touch = "Touch"
    var id: String { rawValue }
}

/// App-wide magnet settings, persisted in UserDefaults and pushed into
/// `MetalMagnetSource.shared.config` on every change.
final class MagnetSettings: ObservableObject {
    static let shared = MagnetSettings()
    private let d = UserDefaults.standard

    /// µT that reads as full pull.
    @Published var fullScale: Double { didSet { d.set(fullScale, forKey: "ferroFullScale"); apply() } }
    /// Bend strength multiplier.
    @Published var bendStrength: Double { didSet { d.set(bendStrength, forKey: "ferroBend") } }
    @Published var polarity: MetalMagnetPolarity { didSet { d.set(polarity.rawValue, forKey: "ferroPolarity"); apply() } }
    @Published var invert: Bool { didSet { d.set(invert, forKey: "ferroInvert"); apply() } }
    @Published var drive: MagnetDrive { didSet { d.set(drive.rawValue, forKey: "magnetDrive") } }
    @Published private(set) var directions: SavedDirections? {
        didSet {
            if let directions, let data = try? JSONEncoder().encode(directions) { d.set(data, forKey: "ferroDirections") }
            else { d.removeObject(forKey: "ferroDirections") }
            apply()
        }
    }

    private init() {
        let fs = d.double(forKey: "ferroFullScale")
        fullScale = fs > 0 ? fs : 60
        let b = d.double(forKey: "ferroBend")
        bendStrength = b > 0 ? b : 1
        // Attract by default: ferrofluid follows either face, and a magnet
        // turned over by accident shouldn't make the metal recoil.
        if !d.bool(forKey: "ferroPolarityV2") {
            d.set(true, forKey: "ferroPolarityV2")
            d.removeObject(forKey: "ferroPolarity")
        }
        polarity = MetalMagnetPolarity(rawValue: d.string(forKey: "ferroPolarity") ?? "") ?? .attract
        invert = d.bool(forKey: "ferroInvert")
        drive = MagnetDrive(rawValue: d.string(forKey: "magnetDrive") ?? "")
            ?? (MetalMagnetSource.shared.isSensorAvailable ? .magnet : .touch)
        if let data = d.data(forKey: "ferroDirections"), let s = try? JSONDecoder().decode(SavedDirections.self, from: data) {
            directions = s
        } else if let data = d.data(forKey: "ferroTemplates"), let t = try? JSONDecoder().decode([MetalMagnetTemplate].self, from: data), t.count >= 3 {
            directions = SavedDirections(origin: nil, templates: t)   // older, angle-only training
        } else {
            directions = nil
        }
        apply()
    }

    var trainedCount: Int { directions?.templates.count ?? 0 }

    func save(_ templates: [MetalMagnetTemplate], origin: CGPoint) {
        guard templates.count >= 3 else { return }
        directions = SavedDirections(origin: origin, templates: templates)
    }

    func forget() { directions = nil }

    /// Push the settings into the shared magnet source.
    func apply() {
        var cfg = MetalMagnetSource.shared.config
        cfg.fullScale = fullScale
        cfg.polarity = polarity
        cfg.invertPolarity = invert
        cfg.templates = directions?.templates ?? []
        cfg.templateOrigin = directions?.origin
        MetalMagnetSource.shared.config = cfg
    }

    /// The hover bend for a ring `scale` × the web's 40-pt button, at the chosen strength.
    func bendConfig(scale: Double) -> MetalBendConfig {
        var c = MetalBendConfig.default.scaled(scale)
        c.strength = bendStrength
        c.maxDisp *= max(1, bendStrength)
        return c
    }

    /// µT a training spot needs before it is recorded.
    var trainThreshold: Double { max(6, 0.12 * fullScale) }
}

// MARK: - Direction training

/// The guided training session: for each spot, wait for a strong, steady
/// field, average it for 0.8 s, record it, then wait for the magnet to be
/// lifted (or moved well away). Each spot is measured against the field
/// just before the magnet arrived, so slow drift never enters a template.
final class DirectionTrainer: ObservableObject {
    struct Target { let point: CGPoint; let angle: Double; let distance: Double }
    let targets: [Target]
    @Published private(set) var step = 0
    @Published private(set) var recorded: [MetalMagnetTemplate] = []
    @Published private(set) var progress = 0.0
    @Published private(set) var needsMove = false
    @Published private(set) var strength = 0.0
    /// False while the field is strong but its sideways part is too weak to read a direction.
    @Published private(set) var readable = true
    private var buffer: [(t: Double, raw: SIMD3<Double>, az: SIMD2<Double>)] = []
    private var ambient: SIMD3<Double>?
    private var lastAz: SIMD2<Double>?
    private var lastStrength = 0.0
    private var lastT = 0.0

    init(targets: [Target]) { self.targets = targets }

    var done: Bool { step >= targets.count }
    var current: Target? { done ? nil : targets[step] }

    func skip() {
        guard !done else { return }
        step += 1
        buffer = []
        progress = 0
    }

    /// Returns true when a spot was recorded this tick.
    func tick(_ r: MetalMagnetReading, now: Double, threshold: Double) -> Bool {
        let dt = lastT > 0 ? min(0.2, now - lastT) : 1.0 / 30.0
        lastT = now
        if abs(strength - r.strength) > 0.5 { strength = r.strength }
        guard !done else { return false }
        // The field with the magnet away, tracked whenever it is weak.
        if r.strength < threshold * 0.5 {
            ambient = ambient.map { $0 + (r.raw - $0) * (1 - exp(-dt / 0.3)) } ?? r.raw
        }
        let strong = r.strength >= threshold
        let field = ambient.map { r.raw - $0 } ?? r.delta
        let ip = hypot(field.x, field.y)
        let az: SIMD2<Double>? = ip > max(0.6, 0.03 * simd_length(field)) ? SIMD2(field.x / ip, field.y / ip) : nil
        if readable != (az != nil || !strong) { readable = az != nil || !strong }
        if needsMove {
            // Lifted (well weaker) or moved ~20° around.
            let lifted = r.strength < max(threshold * 0.7, lastStrength * 0.45)
            let moved = az.map { a in lastAz.map { simd_dot(a, $0) < 0.94 } ?? false } ?? false
            if lifted || moved { needsMove = false; buffer = [] }
            if progress != 0 { progress = 0 }
            return false
        }
        guard strong, let a = az else {
            buffer = []
            if progress != 0 { progress = 0 }
            return false
        }
        buffer.append((now, r.raw, a))
        buffer.removeAll { now - $0.t > 1.0 }
        var sumAz = SIMD2<Double>(0, 0)
        for b in buffer { sumAz += b.az }
        let meanAz = simd_normalize(sumAz)
        if !buffer.allSatisfy({ simd_dot($0.az, meanAz) > 0.96 }) {
            buffer = [(now, r.raw, a)]
            if progress != 0 { progress = 0 }
            return false
        }
        let held = now - (buffer.first?.t ?? now)
        progress = min(1, held / 0.8)
        guard held >= 0.8 else { return false }
        var sum = SIMD3<Double>(0, 0, 0)
        for b in buffer { sum += b.raw }
        let mean = sum / Double(buffer.count) - (ambient ?? (sum / Double(buffer.count) - r.delta))
        let t = targets[step]
        recorded.append(MetalMagnetTemplate(angle: t.angle, field: mean, distance: t.distance, strength: simd_length(mean)))
        lastAz = meanAz
        lastStrength = simd_length(mean)
        step += 1
        needsMove = true
        buffer = []
        progress = 0
        return true
    }
}

/// Where the training markers go.
enum MagnetTrainingLayout {
    /// Eight spots around the screen's edges; angles from the screen's centre.
    case screen
    /// Spots around one ring at a global point, weighted toward the edges
    /// nearest to it. Each spot stands for a side of the phone: the right
    /// edge means "bend right", the bottom edge "bend down", the corner
    /// between — what a magnet "on the right" means to the person holding it.
    case around(CGPoint)
}

/// Full-screen training overlay. Angles and distances are measured from the
/// layout's origin (global points) and saved with it.
struct MagnetTrainingOverlay: View {
    var layout: MagnetTrainingLayout = .screen
    let onDone: () -> Void
    @State private var trainer: DirectionTrainer?
    @State private var origin: CGPoint = .zero

    var body: some View {
        GeometryReader { g in
            let frame = g.frame(in: .global)
            ZStack {
                if let trainer {
                    TrainingCard(trainer: trainer, frame: frame,
                                 onFinish: { finish(trainer) }, onCancel: onDone)
                }
            }
            .frame(width: frame.width, height: frame.height)
            .onAppear { start(frame) }
        }
        .ignoresSafeArea()
        .onAppear { MetalMagnetSource.shared.holdBaseline = true }
        .onDisappear { MetalMagnetSource.shared.holdBaseline = false }
    }

    private func start(_ frame: CGRect) {
        guard trainer == nil else { return }
        let w = frame.width, h = frame.height, m: CGFloat = 26
        let o: CGPoint
        let local: [CGPoint]
        var sides: [Double]? = nil
        switch layout {
        case .screen:
            o = CGPoint(x: frame.midX, y: frame.midY)
            local = [
                CGPoint(x: w - m, y: h / 2), CGPoint(x: w - m, y: h - m - 24),
                CGPoint(x: w / 2, y: h - m - 24), CGPoint(x: m, y: h - m - 24),
                CGPoint(x: m, y: h / 2), CGPoint(x: m, y: m + 56),
                CGPoint(x: w / 2, y: m + 56), CGPoint(x: w - m, y: m + 56),
            ]
        case .around(let ring):
            o = ring
            let rx = ring.x - frame.minX, ry = ring.y - frame.minY
            let bottom = h - m, right = w - m
            // Beside it on the right, the corner, below it, then further round.
            local = [
                CGPoint(x: right, y: ry),
                CGPoint(x: right, y: bottom),
                CGPoint(x: rx, y: bottom),
                CGPoint(x: max(m, rx - 170), y: bottom),
                CGPoint(x: m, y: h / 2),
                CGPoint(x: w / 2, y: m + 56),
                CGPoint(x: right, y: max(m + 56, ry - 190)),
            ]
            sides = [0, .pi / 4, .pi / 2, .pi / 2, .pi, -.pi / 2, 0]
        }
        origin = o
        trainer = DirectionTrainer(targets: local.enumerated().map { i, p in
            let gx = Double(frame.minX + p.x - o.x), gy = Double(frame.minY + p.y - o.y)
            // The magnet itself sits a little past the phone's edge.
            return .init(point: p, angle: sides?[i] ?? atan2(gy, gx), distance: hypot(gx, gy) + 48)
        })
    }

    private func finish(_ t: DirectionTrainer) {
        MagnetSettings.shared.save(t.recorded, origin: origin)
        onDone()
    }
}

private struct TrainingCard: View {
    @ObservedObject var trainer: DirectionTrainer
    let frame: CGRect
    let onFinish: () -> Void
    let onCancel: () -> Void

    @State private var pulse = false
    @State private var finished = false
    private let timer = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()
    private let haptic = UINotificationFeedbackGenerator()

    var body: some View {
        let t = trainer
        let threshold = MagnetSettings.shared.trainThreshold
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.6)
            if let target = t.current {
                ZStack {
                    Circle().fill(Color.white.opacity(0.12)).frame(width: 64, height: 64)
                        .scaleEffect(pulse ? 1.15 : 0.95)
                    Circle().trim(from: 0, to: t.progress).stroke(Color.white, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90)).frame(width: 46, height: 46)
                    Image(systemName: "arrow.up").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .rotationEffect(.radians(target.angle + .pi / 2))
                }
                .position(target.point)
            }
            VStack(spacing: 10) {
                Text("Train directions · \(min(t.step + 1, t.targets.count))/\(t.targets.count)")
                    .font(.headline).foregroundStyle(.white)
                Text(t.needsMove ? "Got it. Lift the magnet and place it by the next marker."
                     : !t.readable ? "Strong but no direction here: hold the magnet a little lower or higher than the phone."
                     : "Lay the magnet flat on the table just past the phone's edge, by the marker. Keep it still.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                Text("\(Int(t.strength.rounded())) µT  ·  needs \(Int(threshold))  ·  \(t.recorded.count) recorded")
                    .font(.caption.monospaced())
                    .foregroundStyle(t.strength >= threshold ? .primary : .secondary)
                HStack(spacing: 10) {
                    Button("Cancel", action: onCancel)
                    Button("Skip spot") { t.skip(); finishIfDone() }
                    if t.recorded.count >= 3 { Button("Done", action: finishOnce) }
                }
                .font(.footnote.weight(.medium))
                .buttonStyle(.bordered)
            }
            .padding(18)
            .frame(maxWidth: 300)
            .background(Color(white: 0.09), in: RoundedRectangle(cornerRadius: 20))
            .position(x: frame.width / 2, y: frame.height / 2)
        }
        .onAppear {
            haptic.prepare()
            withAnimation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true)) { pulse = true }
        }
        .onReceive(timer) { date in
            let now = date.timeIntervalSinceReferenceDate
            let r = MetalMagnetSource.shared.reading(now: now)
            if t.tick(r, now: now, threshold: threshold) { haptic.notificationOccurred(.success) }
            finishIfDone()
        }
    }

    private func finishIfDone() { if trainer.done { finishOnce() } }

    private func finishOnce() {
        guard !finished else { return }
        finished = true
        onFinish()
    }
}

// MARK: - Settings sheet

/// Calibration, training and tuning, for the sheet behind the gear button.
struct MagnetSettingsSheet: View {
    @ObservedObject var settings = MagnetSettings.shared
    /// Close the sheet and run the training on the screen behind it.
    let onTrain: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TimelineView(.periodic(from: .now, by: 0.1)) { ctx in
                        let r = MetalMagnetSource.shared.reading(now: ctx.date.timeIntervalSinceReferenceDate)
                        VStack(alignment: .leading, spacing: 6) {
                            HStack(alignment: .firstTextBaseline) {
                                Text("\(Int(r.strength.rounded()))").font(.title.weight(.semibold)).monospacedDigit()
                                Text("µT").foregroundStyle(.secondary)
                                Spacer()
                                Text("pull \(Int((r.pull * 100).rounded()))%").font(.footnote.monospaced()).foregroundStyle(.secondary)
                            }
                            ProgressView(value: r.pull)
                            Text(status(r)).font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                } header: {
                    Text("Sensor")
                }

                Section {
                    Button("Calibrate", systemImage: "scope") { MetalMagnetSource.shared.calibrate() }
                    Button(settings.trainedCount > 0 ? "Retrain directions" : "Train directions", systemImage: "location.north.circle") {
                        dismiss()
                        onTrain()
                    }
                    .disabled(settings.drive == .touch)
                    if settings.trainedCount > 0 {
                        LabeledContent("Directions", value: "Trained (\(settings.trainedCount))")
                        Button("Forget directions", role: .destructive) { settings.forget() }
                    }
                } footer: {
                    Text("Calibrate with the phone flat on a table and no magnet near. To train, lay the magnet flat by each marker around the phone.")
                }

                Section("Response") {
                    VStack(alignment: .leading) {
                        LabeledContent("Full pull at", value: "\(Int(settings.fullScale)) µT")
                        Slider(value: Binding(get: { log10(settings.fullScale) },
                                              set: { settings.fullScale = (pow(10, $0) / 5).rounded() * 5 }),
                               in: log10(15)...log10(2000))
                    }
                    VStack(alignment: .leading) {
                        LabeledContent("Bend", value: String(format: "%.1f×", settings.bendStrength))
                        Slider(value: $settings.bendStrength, in: 0.3...2.5)
                    }
                }

                Section("Polarity") {
                    Picker("Polarity", selection: $settings.polarity) {
                        ForEach(MetalMagnetPolarity.allCases) { p in Text(p.rawValue.capitalized).tag(p) }
                    }
                    .pickerStyle(.segmented)
                    Toggle("Flip faces", isOn: $settings.invert)
                }

                Section {
                    Picker("Drive", selection: $settings.drive) {
                        ForEach(MagnetDrive.allCases) { s in Text(s.rawValue).tag(s) }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Source")
                } footer: {
                    Text(MetalMagnetSource.shared.isSensorAvailable
                         ? "Touch makes your finger the cursor — the desktop hover bend."
                         : "No magnetometer here (Simulator): Touch drives the bend instead.")
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button { dismiss() } label: { Image(systemName: "checkmark") }
                }
            }
        }
    }

    private func status(_ r: MetalMagnetReading) -> String {
        if !r.available { return "No magnetometer on this device." }
        if r.calibrating { return "Calibrating — keep magnets away." }
        if r.moving { return "Phone moved — re-zeroing when still." }
        if r.pull <= 0 { return "Calibrated. Bring a magnet close." }
        let deg = r.toward == .zero ? "—" : "\(Int((atan2(r.toward.dy, r.toward.dx) * 180 / .pi).rounded()))°"
        return (r.polarity >= 0 ? "Attracting" : "Repelling") + " · \(deg)" + (r.trained ? " · trained" : "")
    }
}

// MARK: - Direction circle

/// The small direction circle from the Ferrofluid HUD: a needle toward the
/// magnet (white attracting, red repelling), the field in µT under it.
struct MagnetCompass: View {
    var size: CGFloat = 44

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1.0 / 15.0)) { ctx in
            let r = MetalMagnetSource.shared.reading(now: ctx.date.timeIntervalSinceReferenceDate)
            let has = r.toward != .zero && r.pull > 0
            VStack(spacing: 4) {
                ZStack {
                    Circle().fill(Color.white.opacity(0.08))
                    Circle().stroke(Color.white.opacity(0.1))
                    if has {
                        Capsule().fill(r.polarity >= 0 ? Color.white : Color(hex: 0xFF6B6B))
                            .frame(width: size * 0.36, height: 2.5)
                            .offset(x: size * 0.18)
                            .rotationEffect(.radians(atan2(r.toward.dy, r.toward.dx)))
                            .animation(.smooth(duration: 0.15), value: atan2(r.toward.dy, r.toward.dx))
                    }
                    Circle().fill(Color.white.opacity(has ? 1 : 0.35)).frame(width: 4, height: 4)
                }
                .frame(width: size, height: size)
                Text(r.available ? "\(Int(r.strength.rounded())) µT" : "—")
                    .font(.caption2.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(has ? "Magnet at \(Int((atan2(r.toward.dy, r.toward.dx) * 180 / .pi).rounded())) degrees" : "No magnet")
        }
    }
}

// MARK: - Reading log

/// Records magnet readings at 10 Hz while a magnet demo is on screen and
/// keeps the last two minutes in `Documents/magnet-log.json` (pull it with
/// `xcrun devicectl device copy from --domain-type appDataContainer …`), so
/// a direction that looks wrong on the phone can be checked against the
/// actual field.
final class MagnetLogger {
    static let shared = MagnetLogger()
    private var timer: Timer?
    private var rows: [[String: Double]] = []
    private var users = 0
    private var lastWrite = 0.0

    private var url: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?.appendingPathComponent("magnet-log.json")
    }

    func start() {
        users += 1
        guard users == 1 else { return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in self?.tick() }
    }

    func stop() {
        users = max(0, users - 1)
        guard users == 0 else { return }
        timer?.invalidate(); timer = nil
        write()
    }

    private func tick() {
        let now = Date().timeIntervalSinceReferenceDate
        let r = MetalMagnetSource.shared.reading(now: now)
        guard r.available else { return }
        rows.append([
            "t": now,
            "rx": r.raw.x, "ry": r.raw.y, "rz": r.raw.z,
            "dx": r.delta.x, "dy": r.delta.y, "dz": r.delta.z,
            "strength": r.strength, "pull": r.pull,
            "angle": r.toward == .zero ? 999 : atan2(r.toward.dy, r.toward.dx) * 180 / .pi,
            "polarity": r.polarity, "trained": r.trained ? 1 : 0,
            "calibrating": r.calibrating ? 1 : 0, "moving": r.moving ? 1 : 0,
        ])
        if rows.count > 1200 { rows.removeFirst(rows.count - 1200) }
        if now - lastWrite > 2 { write(); lastWrite = now }
    }

    private func write() {
        guard let url, let data = try? JSONSerialization.data(withJSONObject: rows) else { return }
        try? data.write(to: url, options: .atomic)
    }
}
