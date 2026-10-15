import SwiftUI
import BotAvatarsKit

/// Three screens: the grid of the eighteen types (tap one to make it
/// jump), the controls for one avatar, and the reference grid used for the
/// visual check against the web renderer.
struct ContentView: View {
    @State private var screen: String = UserDefaults.standard.string(forKey: "screen") ?? "grid"

    var body: some View {
        TabView(selection: $screen) {
            GridScreen().tabItem { Label("Grid", systemImage: "square.grid.3x3") }.tag("grid")
            ControlsScreen().tabItem { Label("Controls", systemImage: "slider.horizontal.3") }.tag("controls")
            ReferenceScreen().tabItem { Label("Reference", systemImage: "photo.on.rectangle") }.tag("reference")
        }
        .background(Color(red: 26 / 255, green: 26 / 255, blue: 26 / 255).ignoresSafeArea())
        .onAppear {
            if UserDefaults.standard.bool(forKey: "renderGrid") {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { ReferenceGrid.export() }
            }
        }
    }
}

let page = Color(red: 26 / 255, green: 26 / 255, blue: 26 / 255)

/* ── the grid ──────────────────────────────────────────────────────── */

struct GridScreen: View {
    @State private var state: BotAvatarState = BotAvatarState(rawValue: UserDefaults.standard.string(forKey: "state") ?? "default") ?? .default
    @State private var face: BotAvatarFace? = UserDefaults.standard.bool(forKey: "mouth") ? .mouth : nil
    @State private var whirl = UserDefaults.standard.bool(forKey: "whirl")
    @State private var report = "measuring…"
    private let columns = Array(repeating: GridItem(.fixed(96), spacing: 14), count: 3)
    /// launch arguments for the perf experiments: `-count 6`, `-shading flat`
    private let count: Int = { let n = UserDefaults.standard.integer(forKey: "count"); return n > 0 ? n : 18 }()
    private let useStage: Bool = UserDefaults.standard.object(forKey: "stage") == nil ? true : UserDefaults.standard.bool(forKey: "stage")
    private let shadingArg: BotAvatarShading = BotAvatarShading(rawValue: UserDefaults.standard.string(forKey: "shading") ?? "plastic") ?? .plastic

    var body: some View {
        VStack(spacing: 10) {
            Text("Bot avatars").font(.system(size: 20, weight: .semibold))
            Text("tap one to make it jump · drag to be looked at").font(.system(size: 12)).foregroundStyle(.secondary)
            Picker("State", selection: $state) {
                ForEach(BotAvatarState.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 24)
            HStack(spacing: 16) {
                Toggle("Mouth", isOn: Binding(get: { face == .mouth }, set: { face = $0 ? .mouth : nil })).fixedSize()
                Toggle("Whirl", isOn: $whirl).fixedSize()
            }
            .font(.system(size: 13))
            ScrollView {
                let grid = LazyVGrid(columns: columns, spacing: 8) {
                    ForEach(Array(BotAvatarType.allCases.prefix(count))) { type in
                        BotAvatar(type: type, face: face, state: state, size: 96, shading: shadingArg, whirl: whirl ? .on : .off)
                            .accessibilityIdentifier("avatar-\(type.rawValue)")
                    }
                }
                .padding(.vertical, 8)
                if useStage { BotAvatarStage { grid } } else { grid }
            }
            .botAvatarPointer()
            Text(report)
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.bottom, 4)
                .accessibilityIdentifier("stats")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(page.ignoresSafeArea())
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in
            report = FrameStats.sample()
        }
    }
}

/// Reads the kit's per-frame CPU counters once a second, shows them and
/// appends them to Documents/stats.txt so a host script can read them.
enum FrameStats {
    static var lines: [String] = []
    static func sample() -> String {
        let clock = BotAvatarClock.shared
        let s = clock.stats
        clock.stats.reset()
        guard s.draws > 0 else { return "idle" }
        let perAvatar = (s.tickSeconds + s.drawSeconds) / Double(s.draws) * 1000
        let perFrame = (s.tickSeconds + s.drawSeconds) * 1000 / max(1, clock.fps)
        let line = String(format: "%.0f fps · %.3f ms CPU / avatar / frame (rig %.3f + canvas %.3f) · %.2f ms / frame for %d avatars", clock.fps, perAvatar, s.tickSeconds / Double(s.draws) * 1000, s.drawSeconds / Double(s.draws) * 1000, perFrame, Int((Double(s.draws) / max(1, clock.fps)).rounded()))
        lines.append(line)
        if lines.count > 30 { lines.removeFirst() }
        if let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first {
            try? lines.joined(separator: "\n").write(to: dir.appendingPathComponent("stats.txt"), atomically: true, encoding: .utf8)
        }
        return line
    }
}

/* ── the controls ──────────────────────────────────────────────────── */

struct ControlsScreen: View {
    @State private var type: BotAvatarType = .clover
    @State private var face: BotAvatarFace = .eyes
    @State private var state: BotAvatarState = .default
    @State private var size = 160.0
    @State private var shading: BotAvatarShading = .plastic
    @State private var shadow = 0.35
    @State private var highlight = 1.3
    @State private var depth = 0.65
    @State private var light = 265.0
    @State private var rim = 0.5
    @State private var spread = 1.55
    @State private var brightness = 1.0
    @State private var saturation = 1.5
    @State private var speed = 1.0
    @State private var paused = false
    @State private var whirl = BotAvatarWhirl.off
    @State private var jump = BotAvatarJumpConfig.defaults

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                BotAvatar(type: type, face: face, state: state, size: size, brightness: brightness, saturation: saturation, speed: speed, paused: paused, shading: shading, shadow: shadow, highlight: highlight, depth: depth, light: light, rim: rim, spread: spread, whirl: whirl, jump: jump)
                    .padding(.vertical, 40)
                    .frame(maxWidth: .infinity)
                    .botAvatarPointer()

                group("Avatar") {
                    Picker("Type", selection: $type) { ForEach(BotAvatarType.allCases) { Text($0.preset.label).tag($0) } }
                    Picker("Face", selection: $face) { ForEach(BotAvatarFace.allCases) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented)
                    Picker("State", selection: $state) { ForEach(BotAvatarState.allCases) { Text($0.label).tag($0) } }.pickerStyle(.segmented)
                    slider("Size", $size, 24...240, "%.0f")
                    slider("Speed", $speed, 0...3, "%.2f")
                    Toggle("Paused", isOn: $paused)
                }
                group("Shading") {
                    Picker("Shading", selection: $shading) { ForEach(BotAvatarShading.allCases) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented)
                    slider("Shadow", $shadow, 0...2, "%.2f")
                    slider("Highlight", $highlight, 0...2, "%.2f")
                    slider("Light", $light, 0...360, "%.0f°")
                    slider("Depth", $depth, 0.2...2, "%.2f")
                    slider("Rim", $rim, 0...2, "%.2f")
                    slider("Spread", $spread, 0.4...2.5, "%.2f")
                    slider("Brightness", $brightness, 0.5...1.5, "%.2f")
                    slider("Saturation", $saturation, 0.5...1.5, "%.2f")
                }
                group("Jump") {
                    slider("Height", $jump.height, 0...60, "%.0f")
                    slider("Air time", $jump.time, 0.2...1.6, "%.2f s")
                    slider("Stretch", $jump.stretch, 0...2, "%.2f")
                    slider("Squash", $jump.squash, 0...2, "%.2f")
                    slider("Squash time", $jump.squashTime, 0.05...1.2, "%.2f s")
                    Picker("Easing", selection: $jump.squashEase) { ForEach(BotAvatarSquashEase.allCases) { Text($0.rawValue).tag($0) } }.pickerStyle(.segmented)
                    slider("Click squash time", $jump.clickSquashTime, 0.05...1.2, "%.2f s")
                    slider("Land squash", $jump.land, -0.2...0.2, "%.2f s")
                    slider("Every", $jump.every, 0...20, "%.1f s")
                    slider("Lean", $jump.lean, 0...30, "%.0f°")
                    slider("Spin", $jump.spin, 0...2, "%.0f")
                }
                group("Whirl") {
                    slider("Strength", $whirl.strength, 0...2, "%.2f")
                    slider("Size", $whirl.size, 0.6...1.6, "%.2f")
                    slider("Width", $whirl.width, 0.4...2, "%.2f")
                    slider("Length", $whirl.length, 0.4...1.6, "%.2f")
                    slider("Tilt", $whirl.tilt, 0.5...1.8, "%.2f")
                }
                Spacer(minLength: 24)
            }
            .padding(.horizontal, 16)
        }
        .background(page.ignoresSafeArea())
    }

    private func group<V: View>(_ title: String, @ViewBuilder _ content: () -> V) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary)
            content()
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
    }

    private func slider(_ label: String, _ value: Binding<Double>, _ range: ClosedRange<Double>, _ fmt: String) -> some View {
        HStack(spacing: 10) {
            Text(label).font(.system(size: 13)).frame(width: 118, alignment: .leading)
            Slider(value: value, in: range)
            Text(String(format: fmt, value.wrappedValue)).font(.system(size: 12, design: .monospaced)).frame(width: 52, alignment: .trailing)
        }
    }
}

/* ── the reference grid ────────────────────────────────────────────── */

struct ReferenceScreen: View {
    @State private var exported = ""
    var body: some View {
        VStack(spacing: 8) {
            Text("Reference grid").font(.system(size: 20, weight: .semibold)).padding(.top, 8)
            Text("18 types × 5 fixed poses, as the web reference").font(.system(size: 13)).foregroundStyle(.secondary)
            ScrollView([.horizontal, .vertical]) {
                ReferenceGrid()
            }
            Button("Export at 2× to Documents/grid.png") {
                exported = ReferenceGrid.export()
            }
            .buttonStyle(.bordered)
            Text(exported).font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary).lineLimit(2)
            Spacer(minLength: 8)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(page.ignoresSafeArea())
    }
}

/// The web reference grid: 18 columns (the types in order) × 5 rows of
/// 144-pt tiles (box 96, canvas 144): idle rest with eyes; yaw 0.6 pitch
/// 0.2; yaw −0.9 pitch −0.25 roll 0.1 with the mouth; sleeping rest with
/// the mouth; working rest with yaw 0.3 and the mouth.
struct ReferenceGrid: View {
    static let box = 96.0
    static let tile = box * BOT_AVATAR_OVERSCAN

    struct Row { var state: BotAvatarState; var yaw: Double; var pitch: Double; var roll: Double; var face: BotAvatarFace }
    static let rows: [Row] = [
        Row(state: .default, yaw: 0, pitch: 0, roll: 0, face: .eyes),
        Row(state: .default, yaw: 0.6, pitch: 0.2, roll: 0, face: .eyes),
        Row(state: .default, yaw: -0.9, pitch: -0.25, roll: 0.1, face: .mouth),
        Row(state: .sleeping, yaw: 0, pitch: 0, roll: 0, face: .mouth),
        Row(state: .working, yaw: 0.3, pitch: 0, roll: 0, face: .mouth),
    ]

    /// the web component's default look: saturation 1.5 → shade(color, 0, 0.25)
    static func config(_ type: BotAvatarType, face: BotAvatarFace, scale: Double) -> BotAvatarDrawConfig {
        var c = BotAvatarDrawConfig(type: type, face: face, color: type.preset.color.shade(0, 0.25))
        c.still = true
        c.scale = scale
        return c
    }
    static func pose(_ r: Row) -> BotAvatarPose {
        var p = BotAvatarPose.rest(r.state)
        p.yaw = r.yaw
        p.pitch += r.pitch
        p.roll += r.roll
        return p
    }

    /// The material caches per tile, kept so the on-screen grid does not rebake.
    static var states: [String: BotAvatarRenderState] = [:]
    static func state(_ key: String) -> BotAvatarRenderState {
        if let s = states[key] { return s }
        let s = BotAvatarRenderState(); states[key] = s; return s
    }

    var scale: Double = 2

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(Self.rows.enumerated()), id: \.offset) { ri, row in
                HStack(spacing: 0) {
                    ForEach(BotAvatarType.allCases) { type in
                        Canvas(opaque: true, colorMode: .nonLinear, rendersAsynchronously: false) { ctx, size in
                            ctx.fill(Path(CGRect(origin: .zero, size: size)), with: .color(page))
                            let cfg = Self.config(type, face: row.face, scale: scale)
                            drawBotAvatarFrame(&ctx, box: Self.box, pose: Self.pose(row), cfg: cfg, state: Self.state("\(type.rawValue)-\(ri)-\(scale)"))
                        }
                        .frame(width: Self.tile, height: Self.tile)
                    }
                }
            }
        }
        .background(page)
    }

    /// Render the grid at 2× (the web reference's device pixel ratio) and
    /// write it to Documents/grid.png. Returns a report line.
    @MainActor @discardableResult
    static func export() -> String {
        let renderer = ImageRenderer(content: ReferenceGrid(scale: 2))
        renderer.scale = 2
        renderer.isOpaque = true
        guard let cg = renderer.cgImage else { return "render failed" }
        let data = UIImage(cgImage: cg).pngData()
        guard let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else { return "no documents dir" }
        let url = dir.appendingPathComponent("grid.png")
        do {
            try data?.write(to: url)
            let line = "wrote \(cg.width)×\(cg.height) to \(url.path)"
            print(line)
            return line
        } catch {
            return "write failed: \(error)"
        }
    }
}
