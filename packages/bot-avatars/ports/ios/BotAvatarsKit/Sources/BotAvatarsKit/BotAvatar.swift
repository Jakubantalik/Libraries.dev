import SwiftUI

/// An animated bot avatar: one of eighteen glossy 3D shapes with a living
/// face, in one of three states. The SwiftUI port of the web `<BotAvatar>`:
/// the same rig, renderer and plastic material, drawn into a `Canvas`.
///
/// The view lays out `size` square; its canvas is 1.5× that and pulls
/// itself back, so a hop or a flip is never clipped while the layout stays
/// exactly `size`.
public struct BotAvatar: View {
    /// Body shape. Default `clover`.
    public var type: BotAvatarType = .clover
    /// Face kind. Defaults to the type's own.
    public var face: BotAvatarFace? = nil
    /// What the bot is doing: `default` (idle), `working` (hopping, spinning) or `sleeping`.
    public var state: BotAvatarState = .default
    /// Rendered size in points. Default 64.
    public var size: Double = 64
    /// Body colour. Defaults to the type's palette colour.
    public var color: BotColor? = nil
    /// Face ink. Defaults to dark, or light on a dark body.
    public var ink: BotColor? = nil
    /// Lightness of the body colour: 1 as the palette has it. Default 1.
    public var brightness: Double = 1
    /// Saturation of the body colour: 1 as the palette has it. Default 1.5.
    public var saturation: Double = 1.5
    /// Multiplier on every animation's speed. Default 1.
    public var speed: Double = 1
    /// Freeze every animation on its current frame.
    public var paused: Bool = false
    /// 0–1. Offsets the blink and glance timing. Defaults to a random value per instance.
    public var seed: Double? = nil
    /// How the body is lit. Default `plastic`.
    public var shading: BotAvatarShading = .plastic
    /// Strength of the shadow side, 0–2. Default 0.35.
    public var shadow: Double = 0.35
    /// Strength of the lit side, 0–2. Default 1.3.
    public var highlight: Double = 1.3
    /// Thickness of the body, 0.2–2. Default 0.65.
    public var depth: Double = 0.65
    /// Where the light comes from, in degrees clockwise from the top. Default 265.
    public var light: Double = 265
    /// Width of the lit rim in `crisp`, strength of the Fresnel rim in `plastic`, 0–2. Default 0.5.
    public var rim: Double = 0.5
    /// Reach of the soft shading in `smooth`, width of the highlight in `plastic`, 0.4–2.5. Default 1.55.
    public var spread: Double = 1.55
    /// Touch play: a tap makes the avatar hop and turn right round, and
    /// while a finger drags over it the eyes and head follow the finger (it
    /// stands in for the web's pointer). Default true.
    public var interactive: Bool = true
    /// The surface the avatar sits on; `nil` (auto) reads the colour scheme.
    /// Resolved but unused by the drawing, as on the web.
    public var theme: ColorScheme? = nil
    /// The whirl round a spin. Off by default.
    public var whirl: BotAvatarWhirl = .off
    /// The jump's numbers (an idle flip's and a tap's).
    public var jump: BotAvatarJumpConfig = .defaults

    @State private var model = BotAvatarModel()
    @Environment(\.displayScale) private var displayScale
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(type: BotAvatarType = .clover, face: BotAvatarFace? = nil, state: BotAvatarState = .default, size: Double = 64, color: BotColor? = nil, ink: BotColor? = nil, brightness: Double = 1, saturation: Double = 1.5, speed: Double = 1, paused: Bool = false, seed: Double? = nil, shading: BotAvatarShading = .plastic, shadow: Double = 0.35, highlight: Double = 1.3, depth: Double = 0.65, light: Double = 265, rim: Double = 0.5, spread: Double = 1.55, interactive: Bool = true, theme: ColorScheme? = nil, whirl: BotAvatarWhirl = .off, jump: BotAvatarJumpConfig = .defaults) {
        self.type = type; self.face = face; self.state = state; self.size = size; self.color = color; self.ink = ink
        self.brightness = brightness; self.saturation = saturation; self.speed = speed; self.paused = paused; self.seed = seed
        self.shading = shading; self.shadow = shadow; self.highlight = highlight; self.depth = depth; self.light = light; self.rim = rim; self.spread = spread
        self.interactive = interactive; self.theme = theme; self.whirl = whirl; self.jump = jump
    }

    private var props: BotAvatarProps {
        BotAvatarProps(type: type, face: face, state: state, size: size, color: color, ink: ink, brightness: brightness, saturation: saturation, speed: speed, paused: paused, seed: seed, shading: shading, shadow: shadow, highlight: highlight, depth: depth, light: light, rim: rim, spread: spread, interactive: interactive, theme: theme ?? colorScheme, whirl: whirl, jump: jump, scale: min(2, displayScale), reduceMotion: reduceMotion)
    }

    public var body: some View {
        BotAvatarBody(model: model, props: props, label: "\(type.preset.label) bot, \(state.label)")
    }
}

/// The view proper: the canvas overlaid on a `size`-square frame, the
/// gestures and the prop sync.
private struct BotAvatarBody: View {
    let model: BotAvatarModel
    let props: BotAvatarProps
    let label: String
    @Environment(\.botAvatarStage) private var stage

    var body: some View {
        let size = props.size
        let full = size * BOT_AVATAR_OVERSCAN
        Color.clear
            .frame(width: size, height: size)
            .overlay {
                /* on a stage the stage's canvas draws this avatar */
                if stage == nil {
                    BotAvatarCanvas(model: model)
                        .frame(width: full, height: full)
                        .offset(y: -BOT_AVATAR_RISE * size)
                        .allowsHitTesting(false)
                }
            }
            .background(GeometryReader { g in
                let global = g.frame(in: .global)
                let local = stage.map { g.frame(in: .named($0.spaceName)) } ?? .zero
                Color.clear
                    .onAppear { model.globalFrame = global; stage?.register(model, frame: local) }
                    .onChange(of: global) { _, f in model.globalFrame = f }
                    .onChange(of: local) { _, f in stage?.register(model, frame: f) }
                    .onDisappear { stage?.unregister(model) }
            })
            .contentShape(Rectangle())
            .onTapGesture { if props.interactive && !props.paused { model.sim.poke() } }
            .simultaneousGesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .global)
                    .onChanged { v in if props.interactive { BotAvatarPointer.shared.location = v.location } }
                    .onEnded { _ in BotAvatarPointer.shared.location = nil }
            )
            .onChange(of: props, initial: true) { _, p in model.apply(p) }
            .onDisappear { model.stop() }
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isImage)
    }
}

/// Everything the view hands its model, compared as a whole.
struct BotAvatarProps: Equatable {
    var type: BotAvatarType
    var face: BotAvatarFace?
    var state: BotAvatarState
    var size: Double
    var color: BotColor?
    var ink: BotColor?
    var brightness: Double
    var saturation: Double
    var speed: Double
    var paused: Bool
    var seed: Double?
    var shading: BotAvatarShading
    var shadow: Double
    var highlight: Double
    var depth: Double
    var light: Double
    var rim: Double
    var spread: Double
    var interactive: Bool
    var theme: ColorScheme
    var whirl: BotAvatarWhirl
    var jump: BotAvatarJumpConfig
    var scale: Double
    var reduceMotion: Bool
}

/// The canvas: observes the shared clock and draws the model's pose.
private struct BotAvatarCanvas: View {
    let model: BotAvatarModel
    var body: some View {
        /* reading the clock's frame here makes the canvas redraw each tick */
        let frame = BotAvatarClock.shared.frame
        Canvas(opaque: false, colorMode: .nonLinear, rendersAsynchronously: false) { ctx, size in
            model.draw(&ctx, size: size, frame: frame)
        }
    }
}

/// How far the pointer's pull reaches, in head widths.
private let REACH = 3.0

@inline(__always) private func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, v.isFinite ? v : 1)) }

/// The state behind one avatar: its rig, its draw config and the material
/// caches. Plain class, not observed: the clock drives the redraws.
final class BotAvatarModel {
    let sim: BotAvatarSim
    var cfg: BotAvatarDrawConfig
    let render = BotAvatarRenderState()
    var props: BotAvatarProps? = nil
    var globalFrame = CGRect.zero
    private var running = false
    private var frozen = false
    private var restOnly = false
    private var lastDrawnFrame = -1
    /// CPU seconds of the last tick and the last draw, for the demo.
    private(set) var lastTick = 0.0
    private(set) var lastDraw = 0.0

    init() {
        sim = BotAvatarSim(seed: Double.random(in: 0..<1))
        cfg = BotAvatarDrawConfig(type: .clover)
    }

    func apply(_ p: BotAvatarProps) {
        let first = props == nil
        let old = props
        props = p
        let preset = p.type.preset
        let picked = p.color ?? preset.color
        let body = p.brightness == 1 && p.saturation == 1
            ? picked
            : picked.shade((min(2, max(0, p.brightness)) - 1) * 0.35, (min(2, max(0, p.saturation)) - 1) * 0.5)
        var c = BotAvatarDrawConfig(type: p.type, face: p.face, color: body, ink: p.ink)
        c.shading = p.shading
        c.shadow = clamp(p.shadow, 0, 2)
        c.highlight = clamp(p.highlight, 0, 2)
        c.depth = clamp(p.depth, 0.2, 2)
        c.light = p.light
        c.rim = clamp(p.rim, 0, 2)
        c.spread = clamp(p.spread, 0.4, 2.5)
        c.theme = p.theme
        c.scale = p.scale
        c.whirl = BotAvatarWhirl(strength: clamp(p.whirl.strength, 0, 2), size: clamp(p.whirl.size, 0.6, 1.6), width: clamp(p.whirl.width, 0.4, 2), length: clamp(p.whirl.length, 0.4, 1.6), tilt: clamp(p.whirl.tilt, 0.5, 1.8))
        frozen = p.paused || !(p.speed > 0)
        restOnly = p.reduceMotion
        c.still = frozen || restOnly
        cfg = c
        if first, let seed = p.seed {
            /* a given seed replaces the random one: rebuild the rig */
            sim.reseed(min(1, max(0, seed)), state: p.state)
        } else if old?.seed != p.seed, let seed = p.seed {
            sim.reseed(min(1, max(0, seed)), state: p.state)
        } else {
            sim.setState(p.state, immediate: first)
        }
        var j = p.jump
        j.time = max(0.2, j.time)
        j.spin = max(0, j.spin.rounded())
        j.squashTime = max(0.05, j.squashTime)
        j.clickSquashTime = max(0.05, j.clickSquashTime)
        sim.setJump(j)
        /* plastic bakes its form per type; start that in the background now */
        if p.shading == .plastic && !c.still {
            warmBotAvatarPlastic(p.type, devicePx: p.size * p.scale, depth: c.depth)
        }
        if frozen || restOnly { stop() } else { start() }
    }

    private func start() {
        if running { return }
        running = true
        BotAvatarClock.shared.subscribe(ObjectIdentifier(self)) { [weak self] dt in self?.tick(dt) }
    }
    func stop() {
        if !running { return }
        running = false
        BotAvatarClock.shared.unsubscribe(ObjectIdentifier(self))
    }

    private func tick(_ dt: Double) {
        guard let p = props else { return }
        let t0 = CFAbsoluteTimeGetCurrent()
        if p.interactive, let ptr = BotAvatarPointer.shared.location, globalFrame.width > 0 {
            let box = globalFrame.width
            let dx = (ptr.x - globalFrame.midX) / box
            let dy = (ptr.y - globalFrame.midY) / box
            let d = (dx * dx + dy * dy).squareRoot()
            /* full pull up close, gone by REACH */
            let strength = d < 1 ? 1 : d > REACH ? 0 : 1 - (d - 1) / (REACH - 1)
            sim.setPointer(x: dx / max(1, d), y: dy / max(1, d), strength: strength)
        } else {
            sim.setPointer(x: 0, y: 0, strength: 0)
        }
        sim.update(dt * p.speed)
        let cost = CFAbsoluteTimeGetCurrent() - t0
        lastTick = cost
        BotAvatarClock.shared.stats.tickSeconds += cost
        BotAvatarClock.shared.stats.ticks += 1
    }

    func draw(_ ctx: inout GraphicsContext, size: CGSize, frame: Int) {
        guard let p = props else { return }
        let t0 = CFAbsoluteTimeGetCurrent()
        let box = size.width / BOT_AVATAR_OVERSCAN
        let pose = restOnly ? BotAvatarPose.rest(p.state) : sim.pose
        drawBotAvatarFrame(&ctx, box: box, pose: pose, cfg: cfg, state: render)
        let cost = CFAbsoluteTimeGetCurrent() - t0
        lastDraw = cost
        if running && frame != lastDrawnFrame {
            BotAvatarClock.shared.stats.drawSeconds += cost
            BotAvatarClock.shared.stats.draws += 1
        }
        lastDrawnFrame = frame
    }
}

/* ── the pointer over a larger surface ─────────────────────────────── */

private struct BotAvatarPointerModifier: ViewModifier {
    func body(content: Content) -> some View {
        content.simultaneousGesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .onChanged { v in BotAvatarPointer.shared.location = v.location }
                .onEnded { _ in BotAvatarPointer.shared.location = nil }
        )
    }
}

public extension View {
    /// While a finger drags over this view, every `interactive` avatar
    /// within three head widths of it follows the finger — the web's
    /// pointer play over a whole page.
    func botAvatarPointer() -> some View { modifier(BotAvatarPointerModifier()) }
}
