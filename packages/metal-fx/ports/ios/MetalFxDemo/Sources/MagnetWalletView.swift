import SwiftUI
import MetalFxKit
import MagnetKit
import simd

/// "Magnetic UI" (Figma Portfolio 1893:17135, a wallet home screen): every
/// element is one particle on an invisible string to its place. A magnet near
/// the phone pulls each one toward it — harder the closer it is — until the
/// screen edge stops it; as the magnet leaves, the strings pull everything
/// back with a little overshoot. Yank the magnet away fast, outward from the
/// phone, and the strings of the pulled elements snap: they fly off past the
/// edge and stay gone until Reset.
///
/// Hover the magnet over "Account 1" or the avatar and dip it quickly toward
/// the glass and back — an air tap (the kit's tap network) — and its native
/// menu opens, as a finger would open it.
///
/// Uses the Follow locator (physics, around the phone), so it needs the grab
/// — done here the first time. Launch with `-focus wallet`.
struct MagnetWalletView: View {
    var onClose: (() -> Void)? = nil

    @ObservedObject private var follow = FollowSettings.shared
    @ObservedObject private var gestures = MagnetGestureFeed.shared
    @State private var field = MagneticField()
    @State private var rootFrame: CGRect = .zero
    @State private var showSettings = false
    @State private var flownAway = false
    /// This demo's own choices: which locator (the v5 network copes better
    /// with a tilted magnet beside the phone) and whether strings can snap.
    @AppStorage("walletEngine") private var engine = FollowEngine.network.rawValue
    @AppStorage("walletFling") private var flingOn = true
    // Simulator: a draggable puck stands in for the magnet.
    @State private var puck: CGPoint?
    @State private var puckDrag: CGPoint?
    /// Simulator: double-tap the puck to play an air tap over it.
    @State private var simTapAt: Double?
    // The two menus an air tap can open, and where the last one landed.
    @State private var account = 1
    /// The open dropdown ("avatar" or "account"), and where it is (global points).
    @State private var openMenu: String?
    @State private var menuFrame: CGRect = .zero
    @Namespace private var glassSpace
    @State private var tapMark: AirTapMark?

    private var simulated: Bool { !MagnetSource.shared.isSensorAvailable }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { ctx in
                let now = ctx.date.timeIntervalSinceReferenceDate
                let r = MagnetSource.shared.reading(now: now)
                let _ = field.flingEnabled = flingOn
                let _ = follow.ready ? field.step(r, now: now, screen: rootFrame, face: follow.face ?? 1) : field.relax(now: now)
                let _ = field.consumeFling() ? flung() : ()
                let _ = simTapAt.map { playSimTap(since: $0, now: now) }
                ZStack(alignment: .topLeading) {
                    screen
                    menuLayer
                }
            }
            bottomFade
            if let m = tapMark {
                AirTapRipple(hit: m.hit)
                    .position(x: m.p.x - rootFrame.minX, y: m.p.y - rootFrame.minY)
                    .id(m.id)
                    .ignoresSafeArea()
                    .allowsHitTesting(false)
            }
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
                        .transition(.opacity)
                }
            }
            if !follow.ready {
                MagnetGrabOverlay()
                    .transition(.opacity)
            }
            if simulated { puckLayer }
        }
        .background {
            GeometryReader { g in
                Color.clear.onChange(of: g.frame(in: .global), initial: true) { _, f in rootFrame = f }
            }
            .ignoresSafeArea()
        }
        .overlay(alignment: .bottom) {
            VStack(spacing: 14) {
                if flownAway {
                    Button { field.reset(); withAnimation { flownAway = false } } label: {
                        Label("Bring them back", systemImage: "arrow.uturn.backward")
                    }
                    .buttonStyle(.bordered).tint(.white).controlSize(.large)
                    .transition(.opacity)
                }
                Button { showSettings = true } label: {
                    Label("Demo settings", systemImage: "slider.horizontal.3")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color(hex: 0xC1C1C1))
                        .padding(.horizontal, 18)
                        .frame(height: 40)
                        .background(Color.white.opacity(0.08), in: Capsule())
                        .overlay { GlassRim(shape: Capsule()) }
                }
                .buttonStyle(.plain)
            }
            .padding(.bottom, 10)
        }
        .sheet(isPresented: $showSettings) {
            WalletSettingsSheet(engine: $engine, flingOn: $flingOn, onReset: { field.reset(); flownAway = false }, onClose: onClose)
                .presentationDetents([.medium, .large])
        }
        .onChange(of: gestures.seq) { _, _ in
            guard follow.ready else { return }
            switch gestures.last {
            case .pullAway(let speed)?:
                field.armFling(speedCm: speed, now: Date().timeIntervalSinceReferenceDate, screen: rootFrame)
            case .tap(let at)?:
                airTap(at)
            default:
                break
            }
        }
        .onChange(of: follow.ready) { _, _ in feedPuck(); applyEngine() }
        .onChange(of: engine) { _, _ in applyEngine() }
        .onChange(of: puck) { _, _ in feedPuck() }
        .onAppear {
            if UserDefaults.standard.bool(forKey: "followReset") { follow.forget(); follow.release() }
            MagnetSource.shared.attach()
            follow.apply(on: true); applyEngine(); if simulated { feedPuck() }
            MagnetLogger.shared.start()
            // Simulator testing: play an air tap over the puck every N seconds.
            let every = UserDefaults.standard.double(forKey: "simTapEvery")
            if simulated, every > 0 {
                Timer.scheduledTimer(withTimeInterval: every, repeats: true) { _ in simTapAt = Date().timeIntervalSinceReferenceDate }
            }
        }
        .onDisappear {
            MagnetLogger.shared.stop()
            follow.apply(on: false)
            MagnetSource.shared.detach()
            MagnetSource.shared.simulatedField = nil
            MagnetSource.shared.simulatedAmbient = nil
        }
        .preferredColorScheme(.dark)
    }

    /// Follow's settings, with this demo's locator on top.
    private func applyEngine() {
        var cfg = MagnetSource.shared.config
        cfg.locatorEnabled = true
        cfg.steadyRezero = true
        cfg.locatorMode = engine == FollowEngine.physics.rawValue ? .dipole : .network
        MagnetSource.shared.config = cfg
    }

    /// An air tap at `at` (global points): opens the menu of the nearest of
    /// "Account 1" and the avatar, if it landed within reach of it (the
    /// located point is good to ~1–2 cm over the glass, so reach is generous).
    private func airTap(_ at: CGPoint?) {
        guard let p = at else { return }
        // A menu is open: a tap on its element or anywhere outside the menu
        // closes it; one deep in the menu, far from its element, leaves it
        // open. "On its element" allows for the locator's 1–2 cm.
        if let open = openMenu {
            let onSource = field.frame(open).map { Self.distance(p, $0) <= 160 } ?? false
            let closes = onSource || !menuFrame.contains(p)
            tapMark = AirTapMark(p: p, hit: closes, id: (tapMark?.id ?? 0) + 1)
            if closes { setMenu(nil) }
            return
        }
        let reach = 110.0
        let hit = ["account", "avatar"]
            .compactMap { id in field.frame(id).map { (id: id, d: Self.distance(p, $0)) } }
            .filter { $0.d <= reach }
            .min { $0.d < $1.d }
        tapMark = AirTapMark(p: p, hit: hit != nil, id: (tapMark?.id ?? 0) + 1)
        UIImpactFeedbackGenerator(style: hit != nil ? .medium : .light).impactOccurred()
        if let id = hit?.id { setMenu(id) }
    }

    private func setMenu(_ id: String?) {
        guard id != openMenu else { return }
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        withAnimation(.bouncy(duration: 0.4, extraBounce: 0.04)) { openMenu = id }
    }

    private static func distance(_ p: CGPoint, _ r: CGRect) -> Double {
        hypot(max(r.minX - p.x, 0, p.x - r.maxX), max(r.minY - p.y, 0, p.y - r.maxY))
    }

    private var accountItems: [[WalletMenuItem]] {
        [
            (1...3).map { i in
                WalletMenuItem(title: "Account \(i)", subtitle: ["$28.54", "$1,204.10", "$0.00"][i - 1], checked: account == i) { account = i }
            },
            [WalletMenuItem(title: "Add account", symbol: "plus") {}],
        ]
    }

    private var avatarItems: [[WalletMenuItem]] {
        [
            [
                WalletMenuItem(title: "Profile", symbol: "person.crop.circle") {},
                WalletMenuItem(title: "Address book", symbol: "book.closed") {},
                WalletMenuItem(title: "Demo settings", symbol: "slider.horizontal.3") { showSettings = true },
            ],
            [WalletMenuItem(title: "Lock wallet", symbol: "lock") {}],
        ]
    }

    /// The avatar and the dropdowns, drawn above the screen in one Liquid
    /// Glass container: the avatar's glass circle morphs into its menu and
    /// back (glassEffectID), and follows the avatar's particle. While a menu is
    /// open a tap anywhere else closes it.
    private var menuLayer: some View {
        let o = rootFrame.origin
        let local = { (f: CGRect) in f.offsetBy(dx: -o.x, dy: -o.y) }
        let menuWidth = 250.0
        return ZStack(alignment: .topLeading) {
            if openMenu != nil {
                Color.black.opacity(0.001)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onTapGesture { setMenu(nil) }
            }
            LiquidGlassGroup {
                ZStack(alignment: .topLeading) {
                    if let f = field.drawFrame("avatar").map(local) {
                        if openMenu == "avatar" {
                            GlassMenuPanel(sections: avatarItems, width: menuWidth, onPick: pick)
                                .liquidGlass(RoundedRectangle(cornerRadius: 30, style: .continuous), id: "avatar", in: glassSpace)
                                .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .global) }) { menuFrame = $0 }
                                .offset(x: f.maxX - menuWidth, y: f.minY)
                        } else {
                            Text("J")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.6))
                                .frame(width: 40, height: 40)
                                .contentShape(Circle())
                                .liquidGlass(Circle(), id: "avatar", in: glassSpace, interactive: true)
                                .rotationEffect(.radians(field.angle("avatar")))
                                .offset(x: f.minX, y: f.minY)
                                .onTapGesture { setMenu("avatar") }
                                .accessibilityLabel("Profile")
                                .accessibilityAddTraits(.isButton)
                        }
                    }
                    if openMenu == "account", let f = field.drawFrame("account").map(local) {
                        GlassMenuPanel(sections: accountItems, width: menuWidth, onPick: pick)
                            .liquidGlass(RoundedRectangle(cornerRadius: 30, style: .continuous), id: "account", in: glassSpace)
                            .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .global) }) { menuFrame = $0 }
                            .offset(x: f.minX - 14, y: f.minY - 10)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
    }

    private func pick(_ item: WalletMenuItem) {
        setMenu(nil)
        item.action()
    }

    /// The strings just snapped (called from the render loop, so defer state changes).
    private func flung() {
        DispatchQueue.main.async {
            UIImpactFeedbackGenerator(style: .heavy).impactOccurred()
            withAnimation(.easeOut(duration: 0.3).delay(0.6)) { flownAway = true }
        }
    }

    // MARK: Screen (Figma 1893:17135)

    private var screen: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 8) {
                navPill("Home", width: 80, selected: true).magnetParticle("home", field, corner: 20)
                navPill("Explore", width: 88).magnetParticle("explore", field, corner: 20)
                navPill("Trade", width: 80).magnetParticle("trade", field, corner: 20)
                Spacer(minLength: 0)
                // The avatar's place; it is drawn (in glass) by the menu layer.
                Color.clear
                    .frame(width: 40, height: 40)
                    .magnetParticle("avatar", field, corner: 20)
            }
            .padding(.top, 10)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("Account \(account)").font(.system(size: 16, weight: .medium)).foregroundStyle(Color(hex: 0x9A9A9A))
                    Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(Color(hex: 0x9A9A9A))
                }
                .contentShape(Rectangle().inset(by: -8))
                .onTapGesture { setMenu("account") }
                .accessibilityAddTraits(.isButton)
                .magnetParticle("account", field)
                // The balance comes apart under the magnet: "$28", ".", "54".
                HStack(spacing: 0) {
                    Text("$28").magnetParticle("balance", field)
                    Text(".").magnetParticle("balance-dot", field)
                    Text("54").magnetParticle("balance-cents", field)
                }
                .font(.system(size: 34, weight: .medium)).tracking(-0.34).foregroundStyle(.white)
                .frame(height: 45, alignment: .leading)
            }
            .padding(.top, 39)

            HStack(spacing: 9) {
                actionButton("Deposit", symbol: "plus", leading: 20).magnetParticle("deposit", field, corner: 25)
                actionButton("Receive", symbol: "arrow.down", leading: 16).magnetParticle("receive", field, corner: 25)
            }
            .padding(.top, 13)

            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 16) {
                    Text("Tokens").foregroundStyle(.white).magnetParticle("tokens", field)
                    Text("Collectibles").foregroundStyle(.white.opacity(0.5)).magnetParticle("collectibles", field)
                }
                .font(.system(size: 18, weight: .medium)).tracking(-0.09)
                .frame(height: 32)
                VStack(spacing: 8) {
                    tokenRow(icon: "TokenUSDC", name: "USDC", amount: "18.38004 USDC", value: "$16.35", change: "+$0.01", up: true)
                        .magnetParticle("usdc", field, corner: 22)
                    tokenRow(icon: "TokenSHIB", name: "Shiba Inu", amount: "296,120 SHIB", value: "$3.47", change: "-$0.04", up: false)
                        .magnetParticle("shib", field, corner: 22)
                }
            }
            .padding(.top, 36)
            Spacer(minLength: 0)
        }
        .padding(.leading, 20)
        .padding(.trailing, 18)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func navPill(_ title: String, width: CGFloat, selected: Bool = false) -> some View {
        Text(title)
            .font(.system(size: 16, weight: .medium))
            .foregroundStyle(selected ? Color(hex: 0x252525) : Color(hex: 0xC1C1C1))
            .frame(width: width, height: 40)
            .background(Color.white.opacity(selected ? 0.88 : 0.08), in: Capsule())
            .overlay { GlassRim(shape: Capsule()) }
    }

    private func actionButton(_ title: String, symbol: String, leading: CGFloat) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol).font(.system(size: 17, weight: .regular))
            Text(title).font(.system(size: 17, weight: .medium))
        }
        .foregroundStyle(Color(hex: 0xE6E6E6))
        .frame(maxWidth: .infinity)
        .frame(height: 50)
        .background(Color.white.opacity(0.12), in: Capsule())
        .overlay { GlassRim(shape: Capsule()) }
    }

    private func tokenRow(icon: String, name: String, amount: String, value: String, change: String, up: Bool) -> some View {
        HStack(spacing: 13) {
            Image(icon).resizable().frame(width: 40, height: 40)
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.system(size: 16, weight: .medium)).foregroundStyle(.white)
                Text(amount).font(.system(size: 15)).foregroundStyle(Color(hex: 0xA6A6A6))
            }
            Spacer(minLength: 0)
            VStack(alignment: .trailing, spacing: 1) {
                Text(value).font(.system(size: 16, weight: .medium)).foregroundStyle(.white)
                Text(change).font(.system(size: 15)).foregroundStyle(Color(hex: up ? 0x2FD65A : 0xF0182E))
            }
        }
        .lineLimit(1)
        .padding(.leading, 16).padding(.trailing, 20)
        .frame(height: 70)
        .background(Color(hex: 0x171717), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var bottomFade: some View {
        VStack {
            Spacer()
            LinearGradient(stops: [
                .init(color: .black.opacity(0), location: 0),
                .init(color: .black.opacity(0.85), location: 0.45),
                .init(color: .black, location: 1),
            ], startPoint: .top, endPoint: .bottom)
            .frame(height: 150)
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }

    // MARK: Simulator: the puck stands for a magnet held 3 cm above the desk,
    // its offset from the screen centre scaled ×2.5 outward (so the screen
    // edge is ~2.5× farther: drag near an edge to put the magnet beside the phone).

    private var puckLayer: some View {
        let p = puck ?? CGPoint(x: rootFrame.width / 2, y: rootFrame.height * 0.75)
        return ZStack(alignment: .topLeading) {
            Circle()
                .fill(LinearGradient(colors: [Color(hex: 0x5A5A5A), Color(hex: 0x2A2A2A)], startPoint: .top, endPoint: .bottom))
                .overlay(Circle().stroke(Color.white.opacity(0.25)))
                .overlay(Text("N").font(.system(size: 13, weight: .bold, design: .rounded)).foregroundStyle(Color(hex: 0xFF7A7A)))
                .frame(width: 36, height: 36)
                .opacity(0.8)
                .position(p)
                .onTapGesture(count: 2) { simTapAt = Date().timeIntervalSinceReferenceDate }
                .gesture(DragGesture(minimumDistance: 1).onChanged { v in
                    if puckDrag == nil { puckDrag = p }
                    let s = puckDrag ?? p
                    puck = CGPoint(x: s.x + v.translation.width, y: s.y + v.translation.height)
                }.onEnded { _ in puckDrag = nil })
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .ignoresSafeArea()
    }

    /// Simulator air tap over the puck: hover 6 cm over the glass for a
    /// second, dip to 3.6 cm and back within ~0.4 s, and keep hovering (until
    /// the puck is moved).
    private func playSimTap(since t0: Double, now: Double) {
        let t = now - t0
        guard simulated, let p = puck, t < 2.4 else {
            // Stay hovering: jumping back to the puck's field would read as a move.
            DispatchQueue.main.async { simTapAt = nil }
            return
        }
        let ease = { (x: Double) -> Double in let c = min(1, max(0, x)); return c * c * (3 - 2 * c) }
        let depth = -6.0 + 2.4 * (ease((t - 1.0) / 0.15) - ease((t - 1.2) / 0.22))
        let global = CGPoint(x: p.x + rootFrame.minX, y: p.y + rootFrame.minY)
        let b = MagnetSimulator.field(magnet: global, sensor: FollowSettings.simulatedSensorSpot(rootFrame),
                                           northUp: true, moment: 60000, depth: depth)
        MagnetSource.shared.simulatedField = MagnetSimulator.ambient + b
    }

    private func feedPuck() {
        guard simulated else { return }
        let src = MagnetSource.shared
        src.simulatedAmbient = MagnetSimulator.ambient
        guard let p = puck, rootFrame.width > 0 else { src.simulatedField = MagnetSimulator.ambient; return }
        var global = CGPoint(x: p.x + rootFrame.minX, y: p.y + rootFrame.minY)
        var depth = -1.9
        if follow.ready {
            let c = CGPoint(x: rootFrame.midX, y: rootFrame.midY)
            global = CGPoint(x: c.x + (global.x - c.x) * 2.5, y: c.y + (global.y - c.y) * 2.5)
            depth = -2.6
        }
        let b = MagnetSimulator.field(magnet: global, sensor: FollowSettings.simulatedSensorSpot(rootFrame),
                                           northUp: true, moment: 60000, depth: depth)
        src.simulatedField = MagnetSimulator.ambient + b
    }
}

// MARK: - Physics

/// The particles: one per UI element, a small rigid body (a rounded box with
/// mass by its area) on a stiff damped spring — its "string" — to its place.
///
/// - A magnet beside the phone (not over the glass) pulls each body by its
///   nearest point, so it also tilts; the pull falls off as 1/d³ and is capped.
/// - Bodies collide: they cannot overlap, they push and bounce off each other.
/// - The screen is the room: its rounded corners included.
/// - A fast yank outward from beside the phone snaps the strings of what the
///   magnet was holding.
final class MagneticField {
    struct Particle {
        var home: CGRect = .zero
        var corner: Double = 8          // the element's own corner radius
        var off = CGVector.zero
        var vel = CGVector.zero
        var angle = 0.0
        var spin = 0.0
        var detached = false
        var returning = false
        var atEdge = false
        var mass: Double { max(1, Double(home.width * home.height) / 1000) }
        var inertia: Double { mass * Double(home.width * home.width + home.height * home.height) / 12 }
    }

    private(set) var parts: [String: Particle] = [:]
    private var order: [String] = []
    private var lastT = 0.0
    private(set) var magnet: CGPoint?
    private var gate = 0.0
    private var lostAt = 0.0
    /// Recent field strengths: the pull fades as the field falls well below
    /// its peak of the last half second (the magnet leaving).
    private var strengths: [(t: Double, s: Double)] = []
    /// When the magnet last pulled clearly (gate above 0.3): a yank is judged
    /// against that, since letting go switches the pull off at the same moment.
    private var pulledAt = -10.0
    /// The magnet is over the glass (not around the phone): no pull at all.
    private(set) var overGlass = false
    private var history: [(t: Double, p: CGPoint?, e: Double)] = []
    private var armedAt: Double?
    private var armedSpeed = 0.0
    private var lastSnap = -10.0
    private var didFling = false
    private var lastHaptic = 0.0
    private let tap = UIImpactFeedbackGenerator(style: .light)

    /// The phone's display corner radius, points (iPhone 14 Pro – 16 Pro ≈ 55).
    var screenCorner = 55.0
    // The string: stiff (~2 Hz) and close to critically damped — home in
    // about a quarter of a second, with no more than a hint of overshoot.
    var stiffness = 150.0
    var damping = 21.0
    // The magnet: `force` at `reach` points, falling as 1/d³, never above `maxForce`.
    var force = 30000.0
    var reach = 150.0
    var maxForce = 26000.0
    /// The pull point sits this far outside the nearest edge; distances get
    /// `softening` added so a touching body is not infinitely pulled.
    var standoff = 40.0
    var softening = 40.0
    var nearBand = 90.0
    var farBand = 320.0
    // Tilt.
    var tiltGain = 0.5
    var maxTilt = 0.1
    var spinStiffness = 80.0
    var spinDamping = 12.0
    // Bounces: off each other and off the screen edge.
    var restitution = 0.3
    var wallRestitution = 0.25
    /// Slower than this, points/s, bodies pressed together don't bounce.
    var restingSpeed = 250.0
    /// Friction against the screen edge while held there.
    var wallFriction = 0.35
    var flingEnabled = true

    func setHome(_ id: String, _ f: CGRect, corner: Double) {
        if parts[id] == nil { order.append(id) }
        parts[id, default: Particle()].home = f
        parts[id]?.corner = corner
    }
    func offset(_ id: String) -> CGSize {
        let o = parts[id]?.off ?? .zero
        return CGSize(width: o.dx, height: o.dy)
    }
    func angle(_ id: String) -> Double { parts[id]?.angle ?? 0 }
    /// Where an element is now (its place moved by the string), global points.
    func frame(_ id: String) -> CGRect? {
        guard let p = parts[id], p.home.width > 0, !p.detached else { return nil }
        return p.home.offsetBy(dx: p.off.dx, dy: p.off.dy)
    }
    /// Where an element is drawn now, global points (also once flown off).
    func drawFrame(_ id: String) -> CGRect? {
        guard let p = parts[id], p.home.width > 0 else { return nil }
        return p.home.offsetBy(dx: p.off.dx, dy: p.off.dy)
    }

    func relax(now: Double) { simulate(now: now, screen: nil) }

    func step(_ r: MagnetReading, now: Double, screen: CGRect, face: Int) {
        let dt = lastT > 0 ? min(1.0 / 30, max(1.0 / 240, now - lastT)) : 1.0 / 60
        if r.strength > 4, let p = r.screenPosition {
            if let m = magnet {
                let jump = hypot(p.x - m.x, p.y - m.y)
                let k = 1 - exp(-dt / (jump > 200 ? 0.4 : 0.08))
                magnet = CGPoint(x: m.x + (p.x - m.x) * k, y: m.y + (p.y - m.y) * k)
            } else {
                magnet = p
            }
            lostAt = now
        } else if now - lostAt > 0.15 {
            magnet = nil
        }
        // Leaving? A magnet taken away drops the field to a sixth of its peak
        // within half a second: let go as it does. A hand's wobble at the
        // edge (the field halving and coming back, ~once a second in the
        // logs) leaves the pull alone, so what it holds stays still.
        strengths.append((now, r.strength))
        strengths.removeAll { now - $0.t > 0.5 }
        let recentMax = strengths.map(\.s).max() ?? 0
        let leaving = recentMax > 25 ? min(1, max(0, (r.strength / recentMax - 0.15) / 0.3)) : 1
        // Over the glass or around the phone? Above the phone near the
        // sensor the field points along the magnet's face (within ~55° of
        // straight above the sensor); beside the phone, at its height, it
        // points against it. Farther out over the glass the direction cannot
        // tell, so there the locator decides: well inside the screen and
        // above the glass. Over the glass nothing moves at all.
        let along = Double(face < 0 ? -1 : 1) * r.delta.z / max(1e-6, r.strength)
        var inside = false
        if let m = magnet, screen.width > 0 { inside = outside(m, screen) < -25 && (r.height ?? 0) > 0.8 }
        if r.strength > 4 {
            if along > 0.2 || inside { overGlass = true } else if along < 0 { overGlass = false }
        }
        // How much the magnet counts: only around the phone, only while the
        // field is clearly there, and not while letting go.
        var target = 0.0
        if magnet != nil, screen.width > 0, !overGlass {
            let field = min(1, max(0, (r.strength - 10) / 25))
            // The presence network: a leftover offset in the sensor is not a magnet.
            let real = min(1, max(0, (r.presence - 0.2) / 0.4))
            target = field * real * leaving
        }
        // Rises in ~0.08 s, falls in ~0.04 s (quick, without one-frame dips).
        gate += (target - gate) * (1 - exp(-dt / (target > gate ? 0.08 : 0.04)))
        if gate > 0.3 { pulledAt = now }
        if r.strength > 3 {
            history.append((now, magnet, Double(face < 0 ? -1 : 1) * r.delta.z / max(1e-6, r.strength)))
        }
        history.removeAll { now - $0.t > 0.8 }
        simulate(now: now, screen: screen)
        if let t0 = armedAt, now - t0 >= 0.18 || (r.strength <= 3 && now - t0 >= 0.06) {
            armedAt = nil
            if snap(t0: t0, screen: screen) { didFling = true; lastSnap = now }
        }
    }

    /// Where the pull comes from: the located point moved onto a line
    /// `standoff` outside the nearest edge. The locator's distance from the
    /// edge is biased differently on each side (near the sensor it lands on
    /// the edge, far from it well outside), so only the place along the edge
    /// is taken from it; how near the magnet is comes from `proximity`.
    private func pullPoint(_ m: CGPoint, _ s: CGRect) -> CGPoint {
        var q = CGPoint(x: min(max(m.x, s.minX), s.maxX), y: min(max(m.y, s.minY), s.maxY))
        var n = CGVector(dx: m.x - q.x, dy: m.y - q.y)
        if hypot(n.dx, n.dy) < 1 {
            let dl = m.x - s.minX, dr = s.maxX - m.x, dt = m.y - s.minY, db = s.maxY - m.y
            let mn = min(dl, dr, dt, db)
            if mn == dl { q.x = s.minX; n = CGVector(dx: -1, dy: 0) }
            else if mn == dr { q.x = s.maxX; n = CGVector(dx: 1, dy: 0) }
            else if mn == dt { q.y = s.minY; n = CGVector(dx: 0, dy: -1) }
            else { q.y = s.maxY; n = CGVector(dx: 0, dy: 1) }
        }
        let l = max(1e-6, hypot(n.dx, n.dy))
        return CGPoint(x: q.x + n.dx / l * standoff, y: q.y + n.dy / l * standoff)
    }

    /// 1 for a magnet at the phone (up to `nearBand` outside an edge), fading
    /// to 0 by `farBand`.
    private func proximity(_ m: CGPoint, _ s: CGRect) -> Double {
        min(1, max(0, 1 - (outside(m, s) - nearBand) / (farBand - nearBand)))
    }

    /// Signed distance of `p` outside the screen rectangle (negative inside).
    private func outside(_ p: CGPoint, _ s: CGRect) -> Double {
        let dx = max(s.minX - p.x, p.x - s.maxX), dy = max(s.minY - p.y, p.y - s.maxY)
        if dx > 0 || dy > 0 { return hypot(max(0, dx), max(0, dy)) }
        return max(dx, dy)
    }

    /// The pull is mostly "out through the nearest edge" (things slide to it
    /// rather than onto one point), plus some straight at the magnet.
    private func direction(from c: CGPoint, to m: CGPoint, screen: CGRect) -> CGVector {
        var radial = CGVector(dx: m.x - c.x, dy: m.y - c.y)
        let rl = max(1e-6, hypot(radial.dx, radial.dy)); radial = CGVector(dx: radial.dx / rl, dy: radial.dy / rl)
        let q = CGPoint(x: min(max(m.x, screen.minX), screen.maxX), y: min(max(m.y, screen.minY), screen.maxY))
        var edge = CGVector(dx: m.x - q.x, dy: m.y - q.y)
        if hypot(edge.dx, edge.dy) < 1 {
            // Just inside: the nearest edge's outward normal.
            let dl = m.x - screen.minX, dr = screen.maxX - m.x, dt = m.y - screen.minY, db = screen.maxY - m.y
            let mn = min(dl, dr, dt, db)
            edge = mn == dl ? CGVector(dx: -1, dy: 0) : mn == dr ? CGVector(dx: 1, dy: 0) : mn == dt ? CGVector(dx: 0, dy: -1) : CGVector(dx: 0, dy: 1)
        }
        let el = max(1e-6, hypot(edge.dx, edge.dy))
        edge = CGVector(dx: edge.dx / el, dy: edge.dy / el)
        let w = 0.65
        var d = CGVector(dx: edge.dx * w + radial.dx * (1 - w), dy: edge.dy * w + radial.dy * (1 - w))
        let dl = max(1e-6, hypot(d.dx, d.dy)); d = CGVector(dx: d.dx / dl, dy: d.dy / dl)
        return d
    }

    private func center(_ p: Particle) -> CGPoint { CGPoint(x: p.home.midX + p.off.dx, y: p.home.midY + p.off.dy) }

    private func simulate(now: Double, screen: CGRect?) {
        let dt = lastT > 0 ? min(1.0 / 30, max(1.0 / 240, now - lastT)) : 1.0 / 60
        lastT = now
        // 1. Forces: string, magnet (with its torque), tilt spring.
        for id in order {
            guard var p = parts[id], p.home.width > 0 else { continue }
            if p.detached {
                p.vel.dx -= 0.35 * p.vel.dx * dt; p.vel.dy -= 0.35 * p.vel.dy * dt
                p.spin *= exp(-dt * 0.8)
                p.angle += p.spin * dt
                p.off.dx += p.vel.dx * dt; p.off.dy += p.vel.dy * dt
                parts[id] = p
                continue
            }
            var a = CGVector(dx: -stiffness * p.off.dx - damping * p.vel.dx, dy: -stiffness * p.off.dy - damping * p.vel.dy)
            var torque = 0.0
            if let raw = magnet, let s = screen, gate > 0.01 {
                let m = pullPoint(raw, s)
                let c = center(p)
                let w = Double(p.home.width), h = Double(p.home.height)
                // Distance to the body's nearest point, so wide rows and small
                // pills near the same edge feel the same magnet alike.
                let box = p.home.offsetBy(dx: p.off.dx, dy: p.off.dy)
                let q = CGPoint(x: min(max(m.x, box.minX), box.maxX), y: min(max(m.y, box.minY), box.maxY))
                let dist = hypot(m.x - q.x, m.y - q.y) + softening
                let f = min(maxForce, force * pow(reach / dist, 3)) * gate * proximity(raw, s)
                let u = direction(from: c, to: m, screen: s)
                a.dx += f * u.dx; a.dy += f * u.dy
                // Gripped by its nearest point: an off-centre pull turns it.
                let rot = CGAffineTransform(rotationAngle: CGFloat(p.angle))
                let local = CGPoint(x: m.x - c.x, y: m.y - c.y).applying(rot.inverted())
                let near = CGPoint(x: min(max(local.x, -w / 2), w / 2), y: min(max(local.y, -h / 2), h / 2)).applying(rot)
                torque = tiltGain * (Double(near.x) * f * u.dy - Double(near.y) * f * u.dx) / ((w * w + h * h) / 12)
                // Held against the edge, the edge carries most of the twist.
                if p.atEdge { torque *= 0.4 }
            }
            p.vel.dx += a.dx * dt; p.vel.dy += a.dy * dt
            let v = hypot(p.vel.dx, p.vel.dy)
            if v > 2600 { p.vel = CGVector(dx: p.vel.dx / v * 2600, dy: p.vel.dy / v * 2600) }
            p.off.dx += p.vel.dx * dt; p.off.dy += p.vel.dy * dt
            p.spin += (torque - spinStiffness * p.angle - spinDamping * p.spin) * dt
            p.angle += p.spin * dt
            if abs(p.angle) > maxTilt { p.angle = max(-maxTilt, min(maxTilt, p.angle)); p.spin *= 0.4 }
            parts[id] = p
        }
        // 2. Contacts: bodies against each other and against the screen.
        guard let s = screen, s.width > 0 else { return }
        var hitHard = 0.0
        for _ in 0..<4 {
            for i in 0..<order.count {
                for j in (i + 1)..<order.count {
                    collide(order[i], order[j])
                }
            }
            for id in order { hitHard = max(hitHard, contain(id, in: s)) }
        }
        for id in order {
            guard var p = parts[id] else { continue }
            if p.angle.magnitude > maxTilt { p.angle = max(-maxTilt, min(maxTilt, p.angle)) }
            parts[id] = p
        }
        if hitHard > 250, now - lastHaptic > 0.07 {
            tap.impactOccurred(intensity: min(1, hitHard / 1500)); lastHaptic = now
        }
    }

    /// Two boxes (separating-axis test): push apart by mass, bounce a little,
    /// and a little spin from where they touch.
    private func collide(_ ia: String, _ ib: String) {
        guard var a = parts[ia], var b = parts[ib], !a.detached, !b.detached, !a.returning, !b.returning,
              a.home.width > 0, b.home.width > 0 else { return }
        let ca = center(a), cb = center(b)
        let ha = CGSize(width: a.home.width / 2, height: a.home.height / 2), hb = CGSize(width: b.home.width / 2, height: b.home.height / 2)
        // Quick reject.
        if abs(cb.x - ca.x) > ha.width + hb.width + 20 || abs(cb.y - ca.y) > ha.height + hb.height + 20 { return }
        let axA = [CGVector(dx: cos(a.angle), dy: sin(a.angle)), CGVector(dx: -sin(a.angle), dy: cos(a.angle))]
        let axB = [CGVector(dx: cos(b.angle), dy: sin(b.angle)), CGVector(dx: -sin(b.angle), dy: cos(b.angle))]
        let d = CGVector(dx: cb.x - ca.x, dy: cb.y - ca.y)
        var best = Double.infinity, normal = CGVector.zero
        for n in axA + axB {
            let ra = Double(ha.width) * abs(Double(axA[0].dx * n.dx + axA[0].dy * n.dy)) + Double(ha.height) * abs(Double(axA[1].dx * n.dx + axA[1].dy * n.dy))
            let rb = Double(hb.width) * abs(Double(axB[0].dx * n.dx + axB[0].dy * n.dy)) + Double(hb.height) * abs(Double(axB[1].dx * n.dx + axB[1].dy * n.dy))
            let dist = Double(d.dx * n.dx + d.dy * n.dy)
            let overlap = ra + rb - abs(dist)
            if overlap <= 0 { return }
            if overlap < best { best = overlap; normal = dist < 0 ? CGVector(dx: -n.dx, dy: -n.dy) : n }
        }
        let wa = 1 / a.mass, wb = 1 / b.mass
        let k = best / (wa + wb)
        a.off.dx -= normal.dx * k * wa; a.off.dy -= normal.dy * k * wa
        b.off.dx += normal.dx * k * wb; b.off.dy += normal.dy * k * wb
        let vn = Double((b.vel.dx - a.vel.dx) * normal.dx + (b.vel.dy - a.vel.dy) * normal.dy)
        if vn < 0 {
            // Bodies resting on each other (pressed together by the magnet)
            // just stop; only a real knock bounces and spins them.
            let knock = -vn > restingSpeed
            let j = -(1 + (knock ? restitution : 0)) * vn / (wa + wb)
            a.vel.dx -= normal.dx * j * wa; a.vel.dy -= normal.dy * j * wa
            b.vel.dx += normal.dx * j * wb; b.vel.dy += normal.dy * j * wb
            guard knock else { parts[ia] = a; parts[ib] = b; return }
            // Where they touch: midway along the normal between the two faces.
            let pc = CGPoint(x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2)
            let rA = CGVector(dx: pc.x - ca.x, dy: pc.y - ca.y), rB = CGVector(dx: pc.x - cb.x, dy: pc.y - cb.y)
            let crossA = Double(rA.dx * normal.dy - rA.dy * normal.dx), crossB = Double(rB.dx * normal.dy - rB.dy * normal.dx)
            a.spin -= 0.5 * crossA * j / a.inertia
            b.spin += 0.5 * crossB * j / b.inertia
        }
        parts[ia] = a; parts[ib] = b
    }

    /// Keep a body inside the screen's rounded rectangle (its own rounded
    /// corners included). Returns how hard it hit, points/s.
    private func contain(_ id: String, in s: CGRect) -> Double {
        guard var p = parts[id], !p.detached, p.home.width > 0 else { return 0 }
        let c = center(p)
        let hw = Double(p.home.width) / 2, hh = Double(p.home.height) / 2
        let r = min(p.corner, min(hw, hh))
        let inner = s.insetBy(dx: r, dy: r)
        let rr = max(0, screenCorner - r)
        let cosA = cos(p.angle), sinA = sin(p.angle)
        // The corners of the body's core (the box minus its corner radius).
        var worst = CGVector.zero, worstLen = 0.0, worstPoint = c
        for (sx, sy) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
            let lx = sx * (hw - r), ly = sy * (hh - r)
            let q = CGPoint(x: c.x + lx * cosA - ly * sinA, y: c.y + lx * sinA + ly * cosA)
            let corr = pushInside(q, inner, rr)
            let len = hypot(corr.dx, corr.dy)
            if len > worstLen { worstLen = len; worst = corr; worstPoint = q }
        }
        let inside = worstLen < 0.5
        if p.returning {
            if inside { p.returning = false }
            parts[id] = p
            return 0
        }
        guard !inside else { p.atEdge = false; parts[id] = p; return 0 }
        let wasAtEdge = p.atEdge
        p.atEdge = true
        p.off.dx += worst.dx; p.off.dy += worst.dy
        let n = CGVector(dx: worst.dx / worstLen, dy: worst.dy / worstLen)    // points inward
        let vn = Double(p.vel.dx * n.dx + p.vel.dy * n.dy)
        var hit = 0.0
        if vn < 0 {
            // Held against the edge (in contact last frame too, pressed by the
            // magnet): it just stops there — no bounce, no kick, friction holds
            // it against small wobbles of the pull. A real hit bounces a little.
            let resting = wasAtEdge && -vn < 900
            hit = resting ? 0 : -vn
            let e = resting ? 0 : wallRestitution
            p.vel.dx -= (1 + e) * vn * n.dx; p.vel.dy -= (1 + e) * vn * n.dy
            let vn2 = Double(p.vel.dx * n.dx + p.vel.dy * n.dy)
            let vt = CGVector(dx: p.vel.dx - vn2 * n.dx, dy: p.vel.dy - vn2 * n.dy)
            let vtLen = hypot(vt.dx, vt.dy)
            if vtLen > 1e-6 {
                let drop = resting ? min(vtLen, wallFriction * -vn) / vtLen : 0.15
                p.vel.dx -= vt.dx * drop; p.vel.dy -= vt.dy * drop
            }
            if resting {
                p.spin *= 0.7
            } else {
                // Hitting with a corner turns it a little.
                let rA = CGVector(dx: worstPoint.x - c.x, dy: worstPoint.y - c.y)
                let cross = Double(rA.dx * n.dy - rA.dy * n.dx)
                p.spin += 0.5 * cross * hit * p.mass / p.inertia
            }
        }
        parts[id] = p
        return hit
    }

    /// The smallest move that brings `q` inside a rounded rectangle.
    private func pushInside(_ q: CGPoint, _ rect: CGRect, _ radius: Double) -> CGVector {
        let cxs: CGFloat? = q.x < rect.minX + radius ? rect.minX + radius : (q.x > rect.maxX - radius ? rect.maxX - radius : nil)
        let cys: CGFloat? = q.y < rect.minY + radius ? rect.minY + radius : (q.y > rect.maxY - radius ? rect.maxY - radius : nil)
        if let cx = cxs, let cy = cys, radius > 0 {
            let d = hypot(q.x - cx, q.y - cy)
            guard d > radius else { return .zero }
            return CGVector(dx: (cx - q.x) * (d - radius) / d, dy: (cy - q.y) * (d - radius) / d)
        }
        var v = CGVector.zero
        if q.x < rect.minX { v.dx = rect.minX - q.x } else if q.x > rect.maxX { v.dx = rect.maxX - q.x }
        if q.y < rect.minY { v.dy = rect.minY - q.y } else if q.y > rect.maxY { v.dy = rect.maxY - q.y }
        return v
    }

    /// A pull-away was seen. Only a clear one counts: fast, the magnet was
    /// beside the phone holding things, and not right after another snap.
    func armFling(speedCm: Double, now: Double, screen: CGRect) {
        guard flingEnabled, armedAt == nil, now - lastSnap > 2.5, speedCm >= 12, now - pulledAt < 0.5,
              let m = magnet, screen.width > 0, outside(m, screen) > 0,
              parts.values.contains(where: { !$0.detached && ($0.atEdge || hypot($0.off.dx, $0.off.dy) > 50) }) else { return }
        armedAt = now; armedSpeed = speedCm
    }

    func consumeFling() -> Bool {
        defer { didFling = false }
        return didFling
    }

    private func snap(t0: Double, screen: CGRect) -> Bool {
        guard screen.width > 0,
              let before = history.last(where: { $0.t <= t0 - 0.08 && $0.p != nil }),
              let after = history.last(where: { $0.p != nil }), after.t > before.t + 0.03,
              let p0 = before.p, let p1 = after.p else { return false }
        let q = CGPoint(x: min(max(p0.x, screen.minX), screen.maxX), y: min(max(p0.y, screen.minY), screen.maxY))
        var out = CGVector(dx: p0.x - q.x, dy: p0.y - q.y)
        if hypot(out.dx, out.dy) < 1 { out = CGVector(dx: p0.x - screen.midX, dy: p0.y - screen.midY) }
        let n = hypot(out.dx, out.dy)
        guard n > 1 else { return false }
        out = CGVector(dx: out.dx / n, dy: out.dy / n)
        let moved = (p1.x - p0.x) * out.dx + (p1.y - p0.y) * out.dy
        let eBefore = history.filter { $0.t <= t0 - 0.03 && $0.t >= t0 - 0.3 }.map(\.e)
        let eAfter = history.filter { $0.t >= t0 }.map(\.e)
        let lifted = !eBefore.isEmpty && !eAfter.isEmpty
            && (eAfter.reduce(0, +) / Double(eAfter.count)) - (eBefore.reduce(0, +) / Double(eBefore.count)) > 0.15
        guard moved > 50, !lifted else { return false }
        let outward = moved / max(0.05, after.t - before.t)
        var any = false
        let speed = 1300 + min(2000, outward * 0.6 + armedSpeed * 20)
        for id in order {
            guard var p = parts[id], !p.detached else { continue }
            let pulled = hypot(p.off.dx, p.off.dy)
            guard pulled > 50 || (p.atEdge && pulled > 12) else { continue }
            var dir = CGVector(dx: out.dx * 0.75 + p.off.dx / max(1, pulled) * 0.25, dy: out.dy * 0.75 + p.off.dy / max(1, pulled) * 0.25)
            let dl = max(1e-6, hypot(dir.dx, dir.dy)); dir = CGVector(dx: dir.dx / dl, dy: dir.dy / dl)
            let s = speed * (0.85 + 0.3 * min(1, pulled / 200))
            p.vel = CGVector(dx: dir.dx * s, dy: dir.dy * s)
            p.spin = (dir.dx >= 0 ? 1 : -1) * (2 + 2 * min(1, pulled / 200))
            p.detached = true
            parts[id] = p
            any = true
        }
        return any
    }

    func reset() {
        for id in order {
            guard var p = parts[id] else { continue }
            if p.detached {
                p.detached = false; p.returning = true
                let d = hypot(p.off.dx, p.off.dy)
                if d > 600 { p.off = CGVector(dx: p.off.dx / d * 600, dy: p.off.dy / d * 600) }
                p.vel = .zero; p.spin = 0; p.angle = 0
            }
            parts[id] = p
        }
        lastSnap = lastT
    }
}

private struct MagnetParticle: ViewModifier {
    let id: String
    let field: MagneticField
    let corner: Double
    /// This frame's offset and tilt, passed by value so SwiftUI redraws.
    let off: CGSize
    let angle: Double
    func body(content: Content) -> some View {
        content
            .rotationEffect(.radians(angle))
            .offset(off)
            .background {
                GeometryReader { g in
                    Color.clear.onChange(of: g.frame(in: .global), initial: true) { _, f in field.setHome(id, f, corner: corner) }
                }
            }
    }
}

extension View {
    /// One particle of the magnetic field, tied to this element's place.
    /// `corner`: the element's own corner radius (it meets the screen's rounded corners with it).
    fileprivate func magnetParticle(_ id: String, _ field: MagneticField, corner: Double = 6) -> some View {
        modifier(MagnetParticle(id: id, field: field, corner: corner, off: field.offset(id), angle: field.angle(id)))
    }
}

/// Shown while the magnet is close enough to the sensor to magnetise the phone.
struct TooCloseWarning: View {
    var body: some View {
        Label("Too close to the sensor — keep the magnet 2 cm+ from the top of the phone", systemImage: "exclamationmark.triangle.fill")
            .font(.footnote.weight(.medium))
            .foregroundStyle(.black)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(Color(hex: 0xFFB340), in: Capsule())
            .padding(.horizontal, 20)
            .allowsHitTesting(false)
    }
}

/// The pills' and buttons' glassy inner rim: light at the top and bottom edges.
private struct GlassRim<S: InsettableShape>: View {
    let shape: S
    var body: some View {
        shape.strokeBorder(
            LinearGradient(stops: [
                .init(color: .white.opacity(0.24), location: 0),
                .init(color: .white.opacity(0.02), location: 0.3),
                .init(color: .white.opacity(0.02), location: 0.7),
                .init(color: .white.opacity(0.16), location: 1),
            ], startPoint: .top, endPoint: .bottom),
            lineWidth: 0.75
        )
        .allowsHitTesting(false)
    }
}

// MARK: - Grab (shared with Follow's flow)

/// Before the locator can work it needs the magnet's face and strength: the
/// same two one-second grabs as Follow (top ring, then bottom ring).
struct MagnetGrabOverlay: View {
    @ObservedObject private var follow = FollowSettings.shared
    @State private var grab = GrabState()
    @State private var driver = MetalMagnetDriver()
    @State private var frame: CGRect = .zero

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.opacity(0.55)
            TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { ctx in
                let now = ctx.date.timeIntervalSinceReferenceDate
                let spot = tick(MagnetSource.shared.reading(now: now), now: now)
                let local = CGPoint(x: spot.x - frame.minX, y: spot.y - frame.minY)
                ZStack(alignment: .topLeading) {
                    MetalFx(variant: .circle, preset: .chromatic, theme: .dark, strength: 0.95, ringWidth: 4, innerShadow: true,
                            source: .manual(driver), fill: Color(hex: 0x1A1A1A)) {
                        Color.clear.frame(width: 64, height: 64)
                    }
                    .scaleEffect(1 + 0.12 * grab.progress)
                    .position(local)
                    Circle().trim(from: 0, to: grab.progress)
                        .stroke(Color.white.opacity(0.85), style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .frame(width: 86, height: 86)
                        .position(local)
                }
            }
            VStack(spacing: 8) {
                Text(follow.stage == 0 ? "Hold the magnet over the ring" : "Now over the ring at the bottom")
                    .font(.headline).foregroundStyle(.white)
                Text("A second each: it learns your magnet so the UI can feel it around the phone.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                if follow.stage == 1 {
                    Button("Skip — too weak down here") { follow.skipFar() }
                        .font(.footnote.weight(.medium)).buttonStyle(.bordered).tint(.white)
                }
            }
            .padding(18)
            .frame(maxWidth: 320)
            .background(Color(white: 0.09), in: RoundedRectangle(cornerRadius: 20))
            .position(x: frame.width / 2, y: frame.height * 0.5)
        }
        .ignoresSafeArea()
        .background {
            GeometryReader { g in Color.clear.onChange(of: g.frame(in: .global), initial: true) { _, f in frame = f } }
                .ignoresSafeArea()
        }
        .onAppear { grab = follow.grabState() }
        .onChange(of: follow.stage) { _, _ in grab = follow.grabState() }
    }

    private func tick(_ r: MagnetReading, now: TimeInterval) -> CGPoint {
        let stage = follow.stage
        let spot = stage == 0 ? FollowSettings.grabSpot(frame) : FollowSettings.farGrabSpot(frame)
        if let g = grab.tick(r, now: now) {
            let sensor = follow.sensor
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
        return spot
    }
}

// MARK: - Settings

private struct WalletSettingsSheet: View {
    @ObservedObject var follow = FollowSettings.shared
    @Binding var engine: String
    @Binding var flingOn: Bool
    let onReset: () -> Void
    let onClose: (() -> Void)?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TimelineView(.periodic(from: .now, by: 0.1)) { ctx in
                        let r = MagnetSource.shared.reading(now: ctx.date.timeIntervalSinceReferenceDate)
                        HStack(alignment: .firstTextBaseline) {
                            Text("\(Int(r.strength.rounded()))").font(.title.weight(.semibold)).monospacedDigit()
                            Text("µT").foregroundStyle(.secondary)
                            Spacer()
                            if let p = r.screenPosition {
                                Text("magnet at \(Int(p.x)), \(Int(p.y))").font(.footnote.monospaced()).foregroundStyle(.secondary)
                            }
                        }
                    }
                } header: { Text("Sensor") }
                Section {
                    Button("Bring everything back", systemImage: "arrow.uturn.backward") { onReset(); dismiss() }
                    Button("Calibrate", systemImage: "scope") { MagnetSource.shared.calibrate() }
                    Button("Grab the magnet again", systemImage: "hand.raised") { follow.release(); dismiss() }
                    Picker("Locator", selection: $engine) {
                        Text(FollowEngine.network.rawValue).tag(FollowEngine.network.rawValue)
                        Text(FollowEngine.physics.rawValue).tag(FollowEngine.physics.rawValue)
                    }
                    Toggle("Strings snap on a fast yank", isOn: $flingOn)
                } footer: {
                    Text("Every element is a small body on a string. A magnet beside the phone pulls the near ones to the edge and tilts them a little; far ones only lean. Yank it away fast, outward, and the strings of what it held snap.\n\nAir tap: hover the magnet over \"Account 1\" or the avatar and dip it quickly toward the glass and back — its menu opens.")
                }
                if let onClose {
                    Section { Button("Close demo", systemImage: "xmark", role: .destructive) { dismiss(); onClose() } }
                }
            }
            .navigationTitle("Magnetic UI")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button { dismiss() } label: { Image(systemName: "checkmark") } }
            }
        }
    }
}

// MARK: - Air tap

private struct AirTapMark { let p: CGPoint; let hit: Bool; let id: Int }

/// Where an air tap landed: a ring that grows and fades.
private struct AirTapRipple: View {
    let hit: Bool
    @State private var on = false
    var body: some View {
        Circle()
            .stroke(Color.white.opacity(hit ? 0.8 : 0.4), lineWidth: 2)
            .frame(width: 56, height: 56)
            .scaleEffect(on ? 1.5 : 0.4)
            .opacity(on ? 0 : 1)
            .onAppear { withAnimation(.easeOut(duration: 0.55)) { on = true } }
    }
}

/// One row of a wallet dropdown.
private struct WalletMenuItem: Identifiable {
    var id: String { title }
    let title: String
    var subtitle: String? = nil
    var symbol: String? = nil
    var checked = false
    let action: () -> Void
}

/// A dropdown's content, laid out like an iOS 26 menu but with white text.
private struct GlassMenuPanel: View {
    let sections: [[WalletMenuItem]]
    let width: Double
    let onPick: (WalletMenuItem) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(sections.indices, id: \.self) { i in
                if i > 0 {
                    Rectangle().fill(Color.white.opacity(0.14)).frame(height: 0.5)
                        .padding(.horizontal, 20).padding(.vertical, 6)
                }
                ForEach(sections[i]) { item in
                    Button { onPick(item) } label: { row(item) }.buttonStyle(.plain)
                }
            }
        }
        .padding(.vertical, 10)
        .frame(width: width, alignment: .leading)
    }

    private func row(_ item: WalletMenuItem) -> some View {
        HStack(spacing: 12) {
            Image(systemName: item.checked ? "checkmark" : item.symbol ?? "circle")
                .font(.system(size: 17, weight: item.checked ? .semibold : .regular))
                .frame(width: 24)
                .opacity(item.checked || item.symbol != nil ? 1 : 0)
            VStack(alignment: .leading, spacing: 1) {
                Text(item.title).font(.system(size: 17))
                if let sub = item.subtitle {
                    Text(sub).font(.system(size: 15)).foregroundStyle(.white.opacity(0.55))
                }
            }
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 18)
        .padding(.vertical, item.subtitle == nil ? 0 : 6)
        .frame(minHeight: 46)
        .contentShape(Rectangle())
    }
}

/// Liquid Glass on iOS 26 (shapes in one group morph into each other by id);
/// a material before it.
private struct LiquidGlassGroup<Content: View>: View {
    @ViewBuilder var content: Content
    var body: some View {
        if #available(iOS 26.0, *) { GlassEffectContainer { content } } else { content }
    }
}

private extension View {
    @ViewBuilder
    func liquidGlass<S: Shape>(_ shape: S, id: String, in space: Namespace.ID, interactive: Bool = false) -> some View {
        if #available(iOS 26.0, *) {
            glassEffect(interactive ? .regular.interactive() : .regular, in: shape).glassEffectID(id, in: space)
        } else {
            background(.ultraThinMaterial, in: shape)
        }
    }
}
