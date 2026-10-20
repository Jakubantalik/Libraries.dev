import SwiftUI
import MetalFxKit
import MagnetKit
import simd

/// "Magnet follows": a chrome ring that bends toward a real magnet with the
/// desktop hover bend. Lay the phone flat on a table, tap Calibrate with no
/// magnet near, then slide a fridge magnet in from the side. Flip the
/// magnet and the metal recoils. Train directions once for your phone and
/// grip: the bearing is then read off your own measurements.
///
/// Sources: the magnetometer, a finger (the desktop hover bend), or a
/// simulated magnet puck you drag around (the Simulator has no
/// magnetometer; the puck feeds a dipole field through the same pipeline).
///
/// Launch arguments for headless checks:
/// `-focus ferro -source puck -puckX 300 -puckY 300 -puckSouth YES -sensorUp 160`.
struct FerrofluidView: View {
    enum Source: String, CaseIterable, Identifiable {
        case magnet = "Magnet", touch = "Touch", puck = "Puck"
        var id: String { rawValue }
    }

    var onClose: (() -> Void)? = nil

    @State private var source: Source = FerrofluidView.initialSource()
    @State private var preset: MetalPreset = .chromatic
    @State private var ringCenter: CGPoint = .zero
    @State private var puck: CGPoint? = FerrofluidView.initialPuck()
    @State private var puckNorthUp = !UserDefaults.standard.bool(forKey: "puckSouth")
    @State private var dragStart: CGPoint?
    @State private var peak = PeakHold()
    /// Sensitivity, bend, polarity and trained directions, shared with the other magnet demo.
    @ObservedObject private var settings = MagnetSettings.shared
    @State private var training = false
    @ObservedObject private var gestures = MagnetGestureFeed.shared

    private let page = Color(hex: 0x0B0B0B)
    private let card = Color(hex: 0x161616)
    private let chip = Color(hex: 0x262626)
    private let secondary = Color(hex: 0x8E8E8E)
    private let ringSize: CGFloat = 156

    private static func initialSource() -> Source {
        if let s = UserDefaults.standard.string(forKey: "source"), let v = Source(rawValue: s.capitalized) { return v }
        return MagnetSource.shared.isSensorAvailable ? .magnet : .puck
    }

    private static func initialPuck() -> CGPoint? {
        let d = UserDefaults.standard
        guard d.object(forKey: "puckX") != nil else { return nil }
        return CGPoint(x: d.double(forKey: "puckX"), y: d.double(forKey: "puckY"))
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            page.ignoresSafeArea()
            VStack(spacing: 14) {
                header
                Spacer(minLength: 0)
                hero
                Spacer(minLength: 0)
                hud
                controls
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 8)

            if training { MagnetTrainingOverlay(onDone: { training = false }) }
            if source == .puck { puckView }
        }
        .coordinateSpace(name: "ferro")
        .modifier(TouchTracking(on: source == .touch))
        .onAppear { apply(); MagnetLogger.shared.start() }
        .onDisappear {
            MagnetLogger.shared.stop()
            MagnetSource.shared.simulatedField = nil
            MagnetSource.shared.simulatedAmbient = nil
            MetalPointerSource.shared.location = nil
        }
        .onChange(of: source) { old, new in
            if old == .puck || new == .puck {
                MagnetSource.shared.simulatedField = new == .puck ? MagnetSimulator.ambient : nil
                MagnetSource.shared.simulatedAmbient = new == .puck ? MagnetSimulator.ambient : nil
                MagnetSource.shared.calibrate()
            }
            apply()
        }
        .onChange(of: puck) { _, _ in feedPuck() }
        .onChange(of: puckNorthUp) { _, _ in feedPuck() }
        .onChange(of: ringCenter) { _, _ in feedPuck() }
    }

    // MARK: Layout

    private var header: some View {
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 3) {
                Text("Ferrofluid").font(.system(size: 22, weight: .semibold)).foregroundStyle(.white)
                Text(subtitle).font(.system(size: 13)).foregroundStyle(secondary)
            }
            Spacer()
            if let onClose {
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(.white)
                        .frame(width: 32, height: 32).background(chip, in: Circle())
                }
            }
        }
        .padding(.top, 8)
    }

    private var subtitle: String {
        switch source {
        case .magnet: return "Phone flat on a table. Slide a magnet in from the side."
        case .touch: return "Your finger is the cursor: the desktop hover bend."
        case .puck: return "Drag the magnet. Tap it to flip its face."
        }
    }

    private var hero: some View {
        MetalFx(variant: .circle, preset: preset, theme: .dark, strength: 0.95, ringWidth: 5, innerShadow: true,
                source: source == .touch ? .pointer : .magnet,
                bendConfig: bendConfig,
                fill: Color(hex: 0x121212)) {
            Color.clear.frame(width: ringSize, height: ringSize)
        }
        .background {
            GeometryReader { g in
                Color.clear.onChange(of: g.frame(in: .named("ferro")), initial: true) { _, f in
                    ringCenter = CGPoint(x: f.midX, y: f.midY)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: ringSize + 80)
    }

    private var bendConfig: MetalBendConfig { settings.bendConfig(scale: 2.4) }

    // MARK: Sensor HUD (the iPhone sensor test: strength, bearing, face)

    private var hud: some View {
        TimelineView(.periodic(from: .now, by: 1.0 / 15.0)) { ctx in
            let r = MagnetSource.shared.reading(now: ctx.date.timeIntervalSinceReferenceDate)
            let pk = peak.update(r.strength)
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline) {
                    Text(source == .touch ? "—" : "\(Int(r.strength.rounded()))")
                        .font(.system(size: 34, weight: .semibold, design: .rounded)).monospacedDigit()
                        .foregroundStyle(.white)
                    Text("µT").font(.system(size: 15, weight: .medium)).foregroundStyle(secondary)
                    Spacer()
                    Button { peak.reset() } label: {
                        Text("peak \(Int(pk.rounded())) µT").font(.system(size: 12, design: .monospaced)).foregroundStyle(secondary)
                    }
                }
                HStack(spacing: 14) {
                    compass(r)
                    VStack(alignment: .leading, spacing: 8) {
                        pullBar(r.pull)
                        Text(details(r)).font(.system(size: 11, design: .monospaced)).foregroundStyle(secondary)
                        Text(status(r)).font(.system(size: 12, weight: .medium)).foregroundStyle(statusColor(r))
                    }
                }
            }
            .padding(14)
            .background(card, in: RoundedRectangle(cornerRadius: 20))
        }
    }

    private func compass(_ r: MagnetReading) -> some View {
        let has = r.toward != .zero && r.pull > 0
        let angle = atan2(r.toward.dy, r.toward.dx)
        return ZStack {
            Circle().fill(chip)
            Circle().stroke(Color.white.opacity(0.08))
            if has {
                Capsule().fill(r.polarity >= 0 ? Color.white : Color(hex: 0xFF6B6B))
                    .frame(width: 22, height: 3)
                    .offset(x: 11)
                    .rotationEffect(.radians(angle))
                Circle().fill(.white).frame(width: 5, height: 5)
            }
            Text(r.polarity >= 0 ? "N" : "S").font(.system(size: 9, weight: .bold)).foregroundStyle(secondary)
                .offset(y: 20)
        }
        .frame(width: 60, height: 60)
    }

    private func pullBar(_ pull: Double) -> some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(chip)
                Capsule().fill(Color.white).frame(width: max(6, g.size.width * pull))
            }
        }
        .frame(height: 6)
    }

    private func details(_ r: MagnetReading) -> String {
        let d = r.delta
        let deg = r.toward == .zero ? "—" : "\(Int((atan2(r.toward.dy, r.toward.dx) * 180 / .pi).rounded()))°"
        let dist = r.distance.isFinite && r.pull > 0 ? String(format: "~%.1f cm", r.distance) : "—"
        let motion = abs(r.approachSpeed) > 1 ? String(format: "  ·  %@%.0f cm/s", r.approachSpeed > 0 ? "→" : "←", abs(r.approachSpeed)) : ""
        let g = gestures.label.isEmpty ? "" : "  ·  " + gestures.label
        return String(format: "Δ %+.0f %+.0f %+.0f µT", d.x, d.y, d.z) + "  ·  \(deg)  ·  \(dist)  ·  pull \(Int((r.pull * 100).rounded()))%" + motion + g
    }

    private func status(_ r: MagnetReading) -> String {
        if source == .touch { return "Touch near the ring; the finger pulls like a magnet." }
        if !r.available { return "No magnetometer here — use Puck." }
        if r.calibrating { return "Calibrating — keep magnets away" }
        if r.moving { return "Phone moved — re-zeroing when still" }
        if r.pull <= 0 { return "Calibrated. Bring a magnet close." }
        return r.polarity >= 0 ? "Attracting" : "Repelling"
    }

    private func statusColor(_ r: MagnetReading) -> Color {
        if r.calibrating || r.moving { return Color(hex: 0xF5C451) }
        return r.pull > 0 && r.polarity < 0 ? Color(hex: 0xFF8A8A) : .white
    }

    // MARK: Controls

    private var controls: some View {
        VStack(spacing: 12) {
            Picker("Source", selection: $source) {
                ForEach(Source.allCases) { s in Text(s.rawValue).tag(s) }
            }
            .pickerStyle(.segmented)
            HStack(spacing: 10) {
                Text("Full at").font(.system(size: 13)).foregroundStyle(secondary).frame(width: 52, alignment: .leading)
                Slider(value: Binding(get: { log10(settings.fullScale) }, set: { settings.fullScale = (pow(10, $0) / 5).rounded() * 5 }), in: log10(15)...log10(2000))
                Text("\(Int(settings.fullScale)) µT").font(.system(size: 12, design: .monospaced)).foregroundStyle(secondary).frame(width: 64, alignment: .trailing)
            }
            HStack(spacing: 10) {
                Text("Bend").font(.system(size: 13)).foregroundStyle(secondary).frame(width: 52, alignment: .leading)
                Slider(value: $settings.bendStrength, in: 0.3...2.5)
                Text(String(format: "%.1f×", settings.bendStrength)).font(.system(size: 12, design: .monospaced)).foregroundStyle(secondary).frame(width: 64, alignment: .trailing)
            }
            Picker("Polarity", selection: $settings.polarity) {
                ForEach(MagnetPolarity.allCases) { p in Text(p.rawValue.capitalized).tag(p) }
            }
            .pickerStyle(.segmented)
            HStack(spacing: 10) {
                Button { MagnetSource.shared.calibrate(); peak.reset() } label: {
                    Label("Calibrate", systemImage: "scope").font(.system(size: 13, weight: .medium))
                        .frame(maxWidth: .infinity).frame(height: 36)
                        .background(chip, in: Capsule())
                }
                Button { training = true } label: {
                    Label(settings.trainedCount == 0 ? "Train directions" : "Retrain", systemImage: "location.north.circle")
                        .font(.system(size: 13, weight: .medium))
                        .frame(maxWidth: .infinity).frame(height: 36)
                        .background(chip, in: Capsule())
                }
                .disabled(source == .touch)
            }
            .foregroundStyle(.white)
            HStack {
                Text(settings.trainedCount == 0 ? "Directions: not trained" : "Directions: trained (\(settings.trainedCount))")
                    .font(.system(size: 12)).foregroundStyle(secondary)
                if settings.trainedCount > 0 {
                    Button("Forget") { settings.forget() }.font(.system(size: 12, weight: .medium)).foregroundStyle(.white)
                }
                Spacer()
                Toggle(isOn: $settings.invert) { Text("Flip faces").font(.system(size: 13)).foregroundStyle(secondary) }
                    .frame(maxWidth: 150)
            }
        }
        .padding(14)
        .background(card, in: RoundedRectangle(cornerRadius: 20))
    }

    // MARK: Simulated magnet

    private var puckDock: CGPoint { CGPoint(x: ringCenter.x + ringSize / 2 + 70, y: ringCenter.y + ringSize / 2 + 26) }

    private var puckView: some View {
        let p = puck ?? puckDock
        return ZStack {
            Circle().fill(LinearGradient(colors: [Color(hex: 0x5A5A5A), Color(hex: 0x2A2A2A)], startPoint: .top, endPoint: .bottom))
            Circle().stroke(Color.white.opacity(0.25), lineWidth: 1)
            Text(puckNorthUp ? "N" : "S").font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(puckNorthUp ? Color(hex: 0xFF7A7A) : Color(hex: 0x7AB8FF))
        }
        .frame(width: 44, height: 44)
        .opacity(puck == nil ? 0.6 : 1)
        .shadow(color: .black.opacity(0.5), radius: 8, y: 4)
        .position(p)
        .gesture(
            DragGesture(minimumDistance: 2, coordinateSpace: .named("ferro"))
                .onChanged { v in
                    if dragStart == nil { dragStart = p }
                    let s = dragStart ?? p
                    puck = CGPoint(x: s.x + v.translation.width, y: s.y + v.translation.height)
                }
                .onEnded { _ in dragStart = nil }
        )
        .simultaneousGesture(TapGesture().onEnded { puckNorthUp.toggle() })
    }

    // MARK: Plumbing

    private func apply() {
        settings.apply()
        if source == .puck { feedPuck() }
    }

    private func feedPuck() {
        guard source == .puck else { return }
        MagnetSource.shared.simulatedAmbient = MagnetSimulator.ambient
        guard let p = puck, ringCenter != .zero else {
            MagnetSource.shared.simulatedField = MagnetSimulator.ambient
            return
        }
        // The ring's centre plays the sensor (so the bearing is exact), unless
        // `-sensorUp N` moves it N pt up, as on a real phone.
        let sensor = CGPoint(x: ringCenter.x, y: ringCenter.y - UserDefaults.standard.double(forKey: "sensorUp"))
        let b = MagnetSimulator.field(magnet: p, sensor: sensor, northUp: puckNorthUp)
        MagnetSource.shared.simulatedField = MagnetSimulator.ambient + b
    }
}

/// Peak-hold for the HUD (a reference so the timeline can update it).
final class PeakHold {
    private(set) var value = 0.0
    func update(_ v: Double) -> Double { value = max(value, v); return value }
    func reset() { value = 0 }
}

private struct TouchTracking: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.metalPointerTracking() } else { content }
    }
}
