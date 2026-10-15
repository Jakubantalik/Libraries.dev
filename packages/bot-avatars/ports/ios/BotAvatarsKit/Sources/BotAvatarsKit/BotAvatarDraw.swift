import Foundation
import SwiftUI

/* The renderer, a port of the web package's draw.ts onto SwiftUI's
   GraphicsContext. The body is a stack of copies of its outline, spaced
   along a depth axis with a pillow profile; each copy is projected with
   the head's yaw and pitch, so the stack reads as a rounded extruded
   solid that turns, flips and shows its side. The face lives on the
   front cap and follows it. */

/// Everything one frame needs besides the pose.
public struct BotAvatarDrawConfig {
    public var path: Path
    public var cgPath: CGPath
    public var face: BotAvatarFace
    public var faceX: Double
    public var faceY: Double
    public var faceScale: Double
    public var color: BotColor
    public var ink: BotColor
    public var shading: BotAvatarShading = .plastic
    public var shadow = 0.35
    public var highlight = 1.3
    public var depth = 0.65
    /// degrees clockwise from the top, where the light comes from
    public var light = 265.0
    public var rim = 0.5
    public var spread = 1.55
    /// identifies the outline for the material caches (the type name)
    public var typeKey = "custom"
    /// no animation loop follows this draw (paused): build materials now
    /// instead of in the background
    public var still = false
    /// thin parts (antennae) drawn behind the body with `partsDepth` of its depth
    public var parts: Path? = nil
    public var partsCGPath: CGPath? = nil
    public var partsDepth = 0.4
    /// the resolved surface (resolved, unused by the drawing — as on the web)
    public var theme: ColorScheme = .dark
    /// the display scale the canvas renders at, capped at 2 as the web caps
    /// its device pixel ratio; picks the texture tier
    public var scale = 2.0
    /// the whirl's knobs
    public var whirl = BotAvatarWhirl.off
    /// the side slices: each filled on its own (`vector`, the web's look),
    /// or the run of slices sharing a fill merged into one path (`merged`).
    /// `auto` (the default) merges: a path fill is what a frame costs in
    /// RenderBox, and merging takes a body from 17 fills to 4.
    public var sides = BotAvatarSides.auto

    public init(type: BotAvatarType, face: BotAvatarFace? = nil, color: BotColor? = nil, ink: BotColor? = nil) {
        let preset = type.preset
        path = type.shape
        cgPath = type.shapeCGPath
        self.face = face ?? preset.face
        faceX = preset.faceX; faceY = preset.faceY; faceScale = preset.faceScale
        let body = color ?? preset.color
        self.color = body
        self.ink = ink ?? body.autoInk
        typeKey = type.rawValue
        parts = type.parts
        partsCGPath = type.partsCGPath
    }
}

/// How the side slices are filled; see `BotAvatarDrawConfig.sides`.
public enum BotAvatarSides: String, CaseIterable, Sendable {
    case auto, vector, merged
    var merged: Bool { self != .vector }
}

/* The canvas is drawn larger than the avatar's layout box, so a hop or a
   flip can leave the box without being clipped. */
public let BOT_AVATAR_OVERSCAN = 1.5
/// the body's centre sits this fraction of the box below the canvas
/// centre: hops and flips need the room above, not below
public let BOT_AVATAR_RISE = 0.1
private let OVERSCAN = BOT_AVATAR_OVERSCAN, RISE = BOT_AVATAR_RISE

/* Copies through the depth, and the stock half-depth in body units. */
private let SLICES = PLASTIC_SLICES
private let HALF_DEPTH = 15.0
/* Cap scale at the ends of the pillow, at the stock rim width. */
private let CAP = 0.9

/* Big, plain dark eyes: they carry the face at 24px. */
private let EYE_GAP = 25.0
private let EYE_RX = 6.3
private func eyeY(_ face: BotAvatarFace) -> Double { face == .eyes ? 1 : -3.5 }

/* ── the palette ───────────────────────────────────────────────────── */

private final class Palette {
    let base: BotColor, far: BotColor, near: BotColor, light: BotColor, dark: BotColor, capTop: BotColor, capBottom: BotColor
    let baseS: GraphicsContext.Shading, nearS: GraphicsContext.Shading
    /** the slice colours by draw order (far → near), crisp and smooth */
    let crispMix: [GraphicsContext.Shading?]
    let smoothMix: [GraphicsContext.Shading]
    /** crisp: the lit side and cap gradients, for a light direction */
    var gradLx = Double.nan, gradLy = Double.nan
    var lit: GraphicsContext.Shading? = nil
    var cap: GraphicsContext.Shading? = nil
    init(color: BotColor, shadow: Double, highlight: Double) {
        base = color
        far = color.shade(-0.3 * shadow, 0.05 * shadow)
        near = color.shade(-0.12 * shadow, 0.03 * shadow)
        var crisp: [GraphicsContext.Shading?] = [], smooth: [GraphicsContext.Shading] = []
        for j in 0..<SLICES {
            let t = Double(j) / Double(SLICES - 1)
            crisp.append(t > 0.6 ? nil : .color(far.mix(near, t / 0.6).color))
            smooth.append(.color(t >= 0.5 ? color.color : far.mix(color, t / 0.5).color))
        }
        crispMix = crisp; smoothMix = smooth
        light = color.shade(0.04 * highlight)
        dark = color.shade(-0.3 * shadow, 0.05 * shadow)
        capTop = color.shade(0.035 * highlight)
        capBottom = color.shade(-0.035 * shadow)
        baseS = .color(color.color); nearS = .color(near.color)
    }
}
private struct PaletteKey: Hashable { var color: BotColor; var shadow: Double; var highlight: Double }
private var paletteCache: [PaletteKey: Palette] = [:]
private func palette(_ color: BotColor, _ shadow: Double, _ highlight: Double) -> Palette {
    let key = PaletteKey(color: color, shadow: shadow, highlight: highlight)
    if let p = paletteCache[key] { return p }
    let p = Palette(color: color, shadow: shadow, highlight: highlight)
    if paletteCache.count > 200 { paletteCache.removeAll() }
    paletteCache[key] = p
    return p
}

/* ── the whirl ─────────────────────────────────────────────────────── */

private let WHIRL_SEGMENTS = 34
private let WHIRL_SPAN = Double.pi * 1.55
private let WHIRL_RX = 57.0
private let WHIRL_RATIO = 0.4
private let WHIRL_TILT = -0.28
private struct WhirlInk { var base: BotColor, light: BotColor, dark: BotColor, halo: BotColor }
private var whirlInkCache: [BotColor: WhirlInk] = [:]
private func whirlInk(_ color: BotColor) -> WhirlInk {
    if let w = whirlInkCache[color] { return w }
    let w = WhirlInk(base: color.shade(0.1, 0.02), light: color.shade(0.3, 0.04), dark: color.shade(-0.22, 0.08), halo: color.shade(0.2))
    if whirlInkCache.count > 200 { whirlInkCache.removeAll() }
    whirlInkCache[color] = w
    return w
}

/* The whirl on iOS: the web strokes every segment of the trail five times
   (halo, underside, body, lit flank, specular ridge), 170 strokes a half —
   and a path stroke is what a frame costs in RenderBox. Here each of those
   five layers is one band along the ring, a polygon between the trail's
   inner and outer edges filled with a conic gradient whose stops carry the
   web's per-segment alpha, so the trail fades the same way with six fills
   a half instead of a stroke per segment. */
private struct WhirlSample { var theta: Double; var width: Double; var fade: Double; var alpha: [Double] }

/// A point on the ellipse (rx, ry) centred on (0, dy), and its unit normal.
@inline(__always) private func onRing(_ rx: Double, _ ry: Double, _ theta: Double, _ dy: Double) -> (CGPoint, CGPoint) {
    let c = cos(theta), s = sin(theta)
    var nx = ry * c, ny = rx * s
    let l = (nx * nx + ny * ny).squareRoot()
    if l > 0 { nx /= l; ny /= l }
    return (CGPoint(x: rx * c, y: ry * s + dy), CGPoint(x: nx, y: ny))
}

private func drawWhirl(_ ctx: inout GraphicsContext, _ pose: BotAvatarPose, _ color: BotColor, _ lx: Double, _ ly: Double, _ near: Bool, _ knobs: BotAvatarWhirl, _ body: CGAffineTransform) {
    let k = min(1, pose.whirl * knobs.strength)
    if k <= 0.01 { return }
    let span = WHIRL_SPAN * knobs.length
    let ink = whirlInk(color)
    /* the ring runs the way the body's near face moves: to the right */
    let head = -pose.whirlAngle
    let rx = WHIRL_RX * knobs.size
    let ry = rx * WHIRL_RATIO * knobs.tilt * (near ? 1.14 : 0.86)
    /* where round the ring the light falls, in the ring's own frame */
    let lightA = atan2(ly, lx) - WHIRL_TILT
    var c = ctx
    c.transform = CGAffineTransform(translationX: 0, y: 5).concatenating(CGAffineTransform(rotationAngle: WHIRL_TILT)).concatenating(body)
    let N = WHIRL_SEGMENTS
    /* the layers: width and offset as multiples of the segment's width, a
       base colour, and the alpha's factor; the shadow is the near half's own */
    let layerW = [2.6, 0.8, 1.0, 0.62, 0.24], layerDy = [0.0, 0.32, 0.0, -0.16, -0.3]
    let layerColor: [BotColor?] = [ink.halo, ink.dark, ink.base, ink.light, nil]
    let white = BotColor(r: 255, g: 255, b: 255), black = BotColor(r: 0, g: 0, b: 0)
    /* the trail's segments, split into runs on this half of the ring */
    var i = 0
    while i < N {
        /* the trail lies at the angles the head has already passed */
        func mid(_ i: Int) -> Double { head + (Double(i) / Double(N)) * span + (span / Double(N) + 0.012) / 2 }
        if (sin(mid(i)) > 0) != near { i += 1; continue }
        var end = i
        while end + 1 < N && (sin(mid(end + 1)) > 0) == near { end += 1 }
        /* one sample per segment start, and the run's end */
        var samples: [WhirlSample] = []
        samples.reserveCapacity(end - i + 2)
        for s in i...(end + 1) {
            let seg = min(s, end)
            let f = Double(seg) / Double(N)
            let a1 = head + f * span
            let theta = s <= end ? a1 : a1 + span / Double(N) + 0.012
            let m = mid(seg)
            /* perspective and depth: the nearest point of the ring is fullest */
            let depth = 0.6 + 0.4 * sin(m)
            let fade = pow(1 - f, 1.3)
            /* a gentle puff along the trail */
            let puff = 1 + 0.18 * sin(f * 9 + 1.2)
            let width = (2 + 8 * fade) * depth * knobs.width * puff
            let a = k * (0.3 + 0.7 * fade) * depth
            /* how much this stretch of the ring faces the light */
            let facing = 0.5 + 0.5 * cos(m - lightA)
            let alphas = [a * 0.2, a * 0.45, a * 0.72, a * 0.78 * (0.4 + 0.6 * facing), a * 0.9 * (0.15 + 0.85 * facing * facing), 0.2 * k * fade]
            samples.append(WhirlSample(theta: theta, width: width, fade: fade, alpha: alphas))
        }
        /* one band: the trail's edges at each sample, the alpha as stops of
           a conic gradient turning clockwise from the run's first angle */
        func band(_ layer: Int, color: BotColor, width: (WhirlSample) -> Double, dy: (WhirlSample) -> Double) {
            var p = Path()
            var stops: [Gradient.Stop] = []
            stops.reserveCapacity(samples.count)
            var inner: [CGPoint] = []
            inner.reserveCapacity(samples.count)
            let first = samples[0]
            let (p0, _) = onRing(rx, ry, first.theta, 0)
            let phi0 = atan2(p0.y, p0.x)
            let centreDy = dy(samples[samples.count / 2])
            var lastLoc = -1.0
            for s in samples {
                let w = width(s)
                let (pt, n) = onRing(rx, ry, s.theta, dy(s))
                let o = CGPoint(x: pt.x + n.x * w / 2, y: pt.y + n.y * w / 2)
                if p.isEmpty { p.move(to: o) } else { p.addLine(to: o) }
                inner.append(CGPoint(x: pt.x - n.x * w / 2, y: pt.y - n.y * w / 2))
                var phi = atan2(pt.y - centreDy, pt.x) - phi0
                phi = (phi.truncatingRemainder(dividingBy: 2 * .pi) + 2 * .pi).truncatingRemainder(dividingBy: 2 * .pi)
                var loc = phi / (2 * .pi)
                if loc <= lastLoc { loc = min(1, lastLoc + 1e-4) }
                lastLoc = loc
                stops.append(Gradient.Stop(color: color.withAlpha(s.alpha[layer]), location: loc))
            }
            for q in inner.reversed() { p.addLine(to: q) }
            p.closeSubpath()
            c.fill(p, with: .conicGradient(Gradient(stops: stops), center: CGPoint(x: 0, y: centreDy), angle: .radians(phi0)))
        }
        /* the near half casts a soft shadow on the body it crosses */
        if near {
            band(5, color: black, width: { (2 + 8 * $0.fade) * 1.5 * knobs.width }, dy: { _ in 3.5 })
        }
        /* halo, underside, body, lit flank, specular ridge: a plastic tube */
        for layer in 0..<5 {
            let wk = layerW[layer], dk = layerDy[layer]
            band(layer, color: layerColor[layer] ?? white, width: { $0.width * wk }, dy: { $0.width * dk })
        }
        i = end + 1
    }
}

/* ── the frame ─────────────────────────────────────────────────────── */

/// The per-avatar state the renderer keeps between frames: the plastic
/// material's matcap, texels and gradients for the body and the parts.
public final class BotAvatarRenderState {
    var body = PlasticState()
    var parts = PlasticState()
    var bodyKey = "", partsKey = ""
    public init() {}
    /// the demo's counters
    public var matcapBuilds: Int { body.matcapBuilds + parts.matcapBuilds }
    public var texelUpdates: Int { body.texelUpdates + parts.texelUpdates }
}

/// Draw one frame into a canvas `box × OVERSCAN` square, the body's centre
/// `RISE × box` below its middle.
public func drawBotAvatarFrame(_ ctx: inout GraphicsContext, box: Double, pose: BotAvatarPose, cfg: BotAvatarDrawConfig, state: BotAvatarRenderState) {
    let full = box * OVERSCAN
    let S = box / 100
    let shadow = cfg.shadow, highlight = cfg.highlight
    let halfDepth = HALF_DEPTH * cfg.depth
    let cap = 1 - (1 - CAP) * cfg.rim
    let spread = cfg.spread
    /* the light's direction on screen: a unit vector toward the source */
    let la = cfg.light * Double.pi / 180
    let lx = sin(la), ly = -cos(la)
    let pal = palette(cfg.color, shadow, highlight)

    let cy0 = cos(pose.yaw), sy = sin(pose.yaw)
    let cp0 = cos(pose.pitch), sp = sin(pose.pitch)
    /* which cap faces the viewer: the front while this is positive */
    let facing = cy0 * cp0
    /* edge-on, every slice would thin to a line and the stack would show
       gaps; a floor on the foreshortening keeps it a solid */
    func floorK(_ v: Double) -> Double { abs(v) < 0.22 ? (v < 0 ? -0.22 : 0.22) : v }
    let cy = floorK(cy0), cp = floorK(cp0)

    /* body space: the box centre plus the pose's offset, its roll and
       squash. The squash and stretch scale about the body's base (y = 50). */
    let cr = cos(pose.roll), sr = sin(pose.roll), kx = pose.sx * S, ky = pose.sy * S
    let lift = 50 * (1 - pose.sy) * S
    /* the context's transform as given (a stage's placement, a scale) is
       the base of every transform set here */
    let base = ctx.transform
    let body = CGAffineTransform(a: cr * kx, b: sr * kx, c: -sr * ky, d: cr * ky, tx: full / 2 + pose.x * S - sr * lift, ty: full / 2 + RISE * box + pose.y * S + cr * lift).concatenating(base)
    ctx.transform = body

    let mode = cfg.shading
    let dev = box * cfg.scale

    /* one solid: the slice stack (or the plastic material) for an outline
       at a depth */
    func drawSolid(_ ctx: inout GraphicsContext, _ path: Path, _ cgPath: CGPath, _ key: String, _ st: PlasticState, _ halfDepth: Double) -> Bool {
        var lit: GraphicsContext.Shading = pal.nearS
        var capFill: GraphicsContext.Shading = pal.baseS
        if mode == .crisp {
            if pal.lit == nil || pal.gradLx != lx || pal.gradLy != ly {
                pal.lit = .linearGradient(Gradient(stops: [.init(color: pal.light.color, location: 0), .init(color: pal.near.color, location: 0.45), .init(color: pal.dark.color, location: 1)]), startPoint: CGPoint(x: lx * 56, y: ly * 56), endPoint: CGPoint(x: -lx * 56, y: -ly * 56))
                pal.cap = .linearGradient(Gradient(stops: [.init(color: pal.capTop.color, location: 0), .init(color: pal.capBottom.color, location: 1)]), startPoint: CGPoint(x: lx * 46, y: ly * 46), endPoint: CGPoint(x: -lx * 46, y: -ly * 46))
                pal.gradLx = lx; pal.gradLy = ly
            }
            lit = pal.lit!
            capFill = pal.cap!
        }

        var plasticDone = false
        if mode == .plastic {
            let rig = PlasticRig(cy: cy, sy: sy, cp: cp, sp: sp, facing: facing, roll: pose.roll, halfDepth: halfDepth, cap: cap, lx: lx, ly: ly, dev: dev, ctm: body, still: cfg.still)
            plasticDone = drawPlasticCap(&ctx, path: path, cgPath: cgPath, key: key, rig: rig, st: st, base: pal.base, mat: BotAvatarMaterial(shadow: shadow, highlight: highlight, spread: spread, rim: cfg.rim), merged: cfg.sides.merged)
        }
        if plasticDone { return true }
        let mode2: BotAvatarShading = mode == .plastic ? .smooth : mode
        let soft = mode2 == .smooth
        var union: Path? = soft ? Path() : nil
        /* slices, far to near */
        let order: Double = facing >= 0 ? 1 : -1
        func slice(_ j: Int) -> CGAffineTransform {
            let k = order > 0 ? j : SLICES - 1 - j
            let z = -1 + (2 * Double(k)) / Double(SLICES - 1)
            let s = pillowProfile(z, cap)
            let m0 = cy * s, m1 = sy * sp * s, m3 = cp * s
            let e = z * sy * halfDepth - 50 * m0, fo = -z * cy * sp * halfDepth - 50 * m1 - 50 * m3
            return CGAffineTransform(a: m0, b: m1, c: 0, d: m3, tx: e, ty: fo)
        }
        /* a slice's fill, and the run it belongs to: slices whose fill is
           the same are merged into one path (see `sides`) */
        func style(_ j: Int) -> (GraphicsContext.Shading, run: Int) {
            let near = Double(j) / Double(SLICES - 1)
            /* smooth: one colour ramp through the depth to the front, no edge at the cap */
            if soft { return (pal.smoothMix[j], near >= 0.5 ? 100 : j) }
            if j == SLICES - 1 { return (capFill, j) }
            if near > 0.6 { return (lit, 200) }
            return (pal.crispMix[j] ?? lit, j)
        }
        var j = 0
        while j < SLICES {
            let (fill, run) = style(j)
            var end = j
            if cfg.sides.merged { while end + 1 < SLICES && style(end + 1).run == run { end += 1 } }
            if end == j {
                let t = slice(j)
                ctx.transform = t.concatenating(body)
                ctx.fill(path, with: fill)
                if union != nil { union!.addPath(path, transform: t) }
            } else {
                let mid = slice((j + end) / 2), inv = mid.inverted()
                var u = Path()
                for i in j...end {
                    let t = slice(i)
                    u.addPath(path, transform: t.concatenating(inv))
                    if union != nil { union!.addPath(path, transform: t) }
                }
                ctx.transform = mid.concatenating(body)
                ctx.fill(u, with: fill)
            }
            j = end + 1
        }
        ctx.transform = body

        /* smooth: a soft shadow from the lower right and a light from the upper
           left, laid over the whole form so nothing has an edge */
        if let union = union, mode2 == .smooth {
            var c = ctx
            c.clip(to: union)
            let sa = min(1, 0.34 * shadow)
            let sg = Gradient(stops: [.init(color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: sa), location: 0), .init(color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: sa * 0.35), location: 0.5), .init(color: Color(.sRGB, red: 0, green: 0, blue: 0, opacity: 0), location: 1)])
            c.blendMode = .multiply
            c.fill(Path(CGRect(x: -120, y: -120, width: 240, height: 240)), with: .radialGradient(sg, center: CGPoint(x: -lx * 45, y: -ly * 45), startRadius: 4 * spread, endRadius: 84 * spread))
            c.blendMode = .normal
            let ha = min(1, 0.22 * highlight)
            let hg = Gradient(stops: [.init(color: Color(.sRGB, red: 1, green: 1, blue: 1, opacity: ha), location: 0), .init(color: Color(.sRGB, red: 1, green: 1, blue: 1, opacity: ha * 0.23), location: 0.6), .init(color: Color(.sRGB, red: 1, green: 1, blue: 1, opacity: 0), location: 1)])
            c.fill(Path(CGRect(x: -120, y: -120, width: 240, height: 240)), with: .radialGradient(hg, center: CGPoint(x: lx * 37, y: ly * 37), startRadius: 0, endRadius: 62 * spread))
        }
        return false
    }

    /* the far half of the whirl sits behind everything */
    drawWhirl(&ctx, pose, cfg.color, lx, ly, false, cfg.whirl, body)

    if let parts = cfg.parts, let partsCG = cfg.partsCGPath {
        _ = drawSolid(&ctx, parts, partsCG, "\(cfg.typeKey):parts", state.parts, halfDepth * cfg.partsDepth)
    }
    let plasticDone = drawSolid(&ctx, cfg.path, cfg.cgPath, cfg.typeKey, state.body, halfDepth)

    /* the face: each feature sits on a sphere behind the front cap, so a
       turn slides it round the head */
    if facing > -0.2 {
        var c = ctx
        c.transform = CGAffineTransform(a: cfg.faceScale, b: 0, c: 0, d: cfg.faceScale, tx: cfg.faceX - 50, ty: cfg.faceY - 50).concatenating(body)
        /* under a clear coat the print shows the gloss faintly through it */
        if plasticDone { c.opacity = 0.93 }
        drawFace(&c, pose, cfg)
    }
    /* the near half of the whirl passes in front of the face */
    drawWhirl(&ctx, pose, cfg.color, lx, ly, true, cfg.whirl, body)
}

/* Radius of the sphere the face is drawn on, in body units. */
private let FACE_R = 30.0

/* A feature's place on the sphere: longitude and latitude from its
   design position, turned by the head. */
private struct OnSphere { var x: Double, y: Double, sx: Double, sy: Double, z: Double }
private func onSphere(_ x: Double, _ y: Double, _ yaw: Double, _ pitch: Double) -> OnSphere {
    let lon = asin(max(-1, min(1, x / FACE_R))) + yaw
    let lat = asin(max(-1, min(1, -y / FACE_R))) + pitch
    let cl = cos(lat)
    return OnSphere(x: FACE_R * sin(lon) * cl, y: -FACE_R * sin(lat), sx: cos(lon), sy: cl, z: cos(lon) * cl)
}

/* An eye's curve as a short polyline with round joins, cached by its numbers. */
private let EYE_STEPS = 8
private var eyePaths: [Int: Path] = [:]
private func eyePath(_ x0: Double, _ y0: Double, _ cy: Double) -> Path {
    let qx = Int((x0 * 50).rounded()), qy = Int((y0 * 50).rounded()), qc = Int((cy * 50).rounded())
    let key = qx + 2000 * qy + 4_000_000 * qc
    if let p = eyePaths[key] { return p }
    let ax = Double(qx) / 50, ay = Double(qy) / 50, ac = Double(qc) / 50
    var p = Path()
    p.move(to: CGPoint(x: -ax, y: ay))
    for i in 1...EYE_STEPS {
        let t = Double(i) / Double(EYE_STEPS), mt = 1 - t
        let px = ((mt * mt * -ax + t * t * ax) * 1000).rounded() / 1000
        let py = (((mt * mt + t * t) * ay + 2 * mt * t * ac) * 1000).rounded() / 1000
        p.addLine(to: CGPoint(x: px, y: py))
    }
    if eyePaths.count > 256 { eyePaths.removeAll() }
    eyePaths[key] = p
    return p
}

/* The mouth's outline as a path, cached by its numbers: corners at ±hw on
   y = 0, a top edge from the left corner to the right with its controls
   a·hw in from the corners at depth yt, a bottom edge back at depth yb
   with controls ab·hw in, and round caps of radius t0 round each corner. */
private struct Mouth: Hashable { var hw: Double, t0: Double, a: Double, yt: Double, ab: Double, yb: Double }
private let MOUTH_SIN = sin(0.684), MOUTH_COS = cos(0.684)
private var mouthPaths: [Mouth: Path] = [:]
private func mouthPath(_ m0: Mouth) -> Path {
    func q(_ v: Double) -> Double { (v * 50).rounded() / 50 }
    let m = Mouth(hw: q(m0.hw), t0: q(m0.t0), a: q(m0.a), yt: q(m0.yt), ab: q(m0.ab), yb: q(m0.yb))
    if let p = mouthPaths[m] { return p }
    let hw = m.hw, t0 = m.t0, a = m.a, yt = m.yt, ab = m.ab, yb = m.yb
    func f(_ v: Double) -> Double { (v * 1000).rounded() / 1000 }
    /* the corners, offset along the end normal for the caps */
    let nx = t0 * MOUTH_SIN, ny = t0 * MOUTH_COS
    let ltx = -hw + nx, lty = -ny, rtx = hw - nx, rty = -ny
    let lbx = -hw - nx, lby = ny, rbx = hw + nx, rby = ny
    /* the caps bulge outward along the end tangents */
    let cx = (4.0 / 3) * t0 * MOUTH_COS, cy = (4.0 / 3) * t0 * MOUTH_SIN
    var p = Path()
    p.move(to: CGPoint(x: f(ltx), y: f(lty)))
    p.addCurve(to: CGPoint(x: f(rtx), y: f(rty)), control1: CGPoint(x: f(-hw + a * hw), y: f(yt - t0)), control2: CGPoint(x: f(hw - a * hw), y: f(yt - t0)))
    p.addCurve(to: CGPoint(x: f(rbx), y: f(rby)), control1: CGPoint(x: f(rtx + cx), y: f(rty - cy)), control2: CGPoint(x: f(rbx + cx), y: f(rby - cy)))
    p.addCurve(to: CGPoint(x: f(lbx), y: f(lby)), control1: CGPoint(x: f(hw - ab * hw), y: f(yb + t0)), control2: CGPoint(x: f(-hw + ab * hw), y: f(yb + t0)))
    p.addCurve(to: CGPoint(x: f(ltx), y: f(lty)), control1: CGPoint(x: f(lbx - cx), y: f(lby - cy)), control2: CGPoint(x: f(ltx - cx), y: f(lty - cy)))
    p.closeSubpath()
    if mouthPaths.count > 256 { mouthPaths.removeAll() }
    mouthPaths[m] = p
    return p
}

private func drawFace(_ ctx: inout GraphicsContext, _ pose: BotAvatarPose, _ cfg: BotAvatarDrawConfig) {
    let wd = pose.w[0], ww = pose.w[1], ws = pose.w[2]
    let ink = GraphicsContext.Shading.color(cfg.ink.color)
    let ey = eyeY(cfg.face)
    let half = EYE_GAP / 2
    let lx = pose.lookX, ly = pose.lookY
    let yaw = pose.yaw, pitch = pose.pitch
    let faceT = ctx.transform
    let baseOpacity = ctx.opacity

    /* place a feature: skip it once it has gone round the side */
    func at(_ x: Double, _ y: Double, _ alpha: Double = 1, _ fn: (inout GraphicsContext) -> Void) {
        let q = onSphere(x, y, yaw, pitch)
        if q.z <= 0.02 || alpha <= 0.01 { return }
        var c = ctx
        c.opacity = baseOpacity * alpha * min(1, q.z * 5)
        c.transform = CGAffineTransform(a: max(0.02, q.sx), b: 0, c: 0, d: max(0.02, q.sy), tx: q.x, ty: q.y).concatenating(faceT)
        fn(&c)
    }

    /* Each eye is one stroked curve, so every look is the same shape with
       different numbers, and a blend of the numbers is a real morph */
    let open = wd + ww * (1 - pose.laugh)
    let laugh = ww * pose.laugh
    let lift = max(0, -pose.y) / 26
    let sag = 0.5 + 0.5 * pose.breath
    for side in [-1.0, 1.0] {
        let lid = side < 0 ? pose.blinkL : pose.blinkR
        let e = max(0, min(1, pose.eyeOpen * (1 - lid)))
        let kOpen = open * e, kShut = open * (1 - e), kLaugh = laugh, kSleep = ws
        let x0 = kOpen * 0.01 + kShut * 5.4 + kLaugh * 6.2 + kSleep * 6
        let y0 = kOpen * 1.1 + kShut * 0.6 + kLaugh * (2.2 - lift * 1.5) + kSleep * (-1.4 + sag)
        let cy = kOpen * -3.3 + kShut * 0.6 + kLaugh * (-11.4 - 4 * lift) + kSleep * (5.4 + 2 * sag)
        let w = kOpen * EYE_RX * 2 + kShut * 2.8 + kLaugh * 4.4 + kSleep * 4
        /* the eyes drift toward the look when open, less so when shut */
        let dx = lx * (kOpen + 0.5 * (kShut + kLaugh)), dy = ly * (kOpen + 0.5 * kShut)
        at(side * half + dx, ey + dy) { c in
            c.stroke(eyePath(x0, y0, cy), with: ink, style: StrokeStyle(lineWidth: w, lineCap: .round, lineJoin: .round))
        }
    }

    if cfg.face == .mouth {
        let mx = lx * 0.35
        /* One mouth for every state, so a switch morphs it rather than fading
           one shape into another; every number a blend of the three states'. */
        let kd = (0.6 + 0.4 * wd) * (1 + 0.06 * pose.breath)
        let kw = (0.6 + 0.4 * ww) * (1 + (0.25 * max(0, -pose.y)) / 26)
        let r = 2.7 * ws * (1 + 0.25 * pose.breath)
        func b(_ d: Double, _ w: Double, _ s: Double) -> Double { wd * d + ww * w + ws * s }
        let m = Mouth(
            hw: b(6.5 * kd, 9.5 * kw, r),
            t0: b(1.9, 0, 0),
            a: b(2.0 / 3, 2.0 / 3, 0),
            yt: b(3.53 * kd, 1.6 * kw, (-4 * r) / 3),
            ab: b(2.0 / 3, 0, 0),
            yb: b(3.53 * kd, 17.3 * kw, (4 * r) / 3)
        )
        at(mx, b(12.5, 11.6, 15.5)) { c in
            c.fill(mouthPath(m), with: ink)
        }
    }
}
