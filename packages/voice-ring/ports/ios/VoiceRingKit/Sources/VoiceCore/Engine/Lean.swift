// Lean: the orb answering where a voice comes from — port of
// src/engine/lean.ts. A finished frame is bent in screen space toward the
// side of the sound: it drifts that way, its near side is pulled out
// further than its far side, and the near flank bulges.

import Foundation

/// How strongly the orb leans, each a share of its radius at full pan.
public struct LeanAmounts: Sendable, Equatable {
    public var move: Double
    public var pull: Double
    public var deform: Double
    /// Pressing on at the screen's edge, it squashes against it: 0 never … 1 most.
    public var squash: Double
    /// Pressing on at the edge, it is refracted into it as through glass: 0 none … 1 … 2 most.
    public var lens: Double
    /// The lens draws it out toward the edge (distortion): 0 none … 1 … 2.
    public var stretch: Double
    /// The lens parts red from blue (chromatic aberration): 0 none … 1 … 2.
    public var split: Double
    /// The lens blurs it, more the nearer the edge: 0 none … 1 … 2.
    public var blur: Double
    /// It bounces as it meets the edge: 0 none … 1 … 2.
    public var bounce: Double

    public init(
        move: Double = 2, pull: Double = 0.7, deform: Double = 0.1, squash: Double = 0.5,
        lens: Double = 1, stretch: Double = 1, split: Double = 1, blur: Double = 1, bounce: Double = 1
    ) {
        self.move = move
        self.pull = pull
        self.deform = deform
        self.squash = squash
        self.lens = lens
        self.stretch = stretch
        self.split = split
        self.blur = blur
        self.bounce = bounce
    }
}

/// How far, in points, the lean can carry a mark sideways at full pan — the
/// room a canvas needs either side so a leaning orb is never cut off. The
/// flank's bulge counts double: marks past the radius are pushed furthest.
public func leanReach(_ k: LeanAmounts, size: Double) -> Double {
    let share = abs(k.move) + abs(k.pull) + 2 * abs(k.deform)
    return share == 0 ? 0 : ceil(size * 0.36 * share) + 2
}

/// The bounce as an orb meets the edge — port of lean.ts: a spring chasing
/// how hard it presses there, loose enough to overshoot — it hits, presses
/// in a little too far, comes a touch off the edge and settles. Step it once
/// a frame with the press the last frame reported and hand what it returns
/// to `leanFrame`.
public final class EdgeBounce {
    private var x = 0.0
    private var v = 0.0
    /// Whether the spring has caught up with the press since the orb met the edge.
    private var landed = false

    public init() {}

    /// How far the spring runs ahead of the press (+) or behind it (−). It
    /// lags as the orb arrives, but only a rebound counts as behind: the orb
    /// never backs off the edge before it has pressed into it.
    public func step(press: Double, dt: Double) -> Double {
        let w = 15.0, z = 0.3
        let n = max(1, Int((dt * 240).rounded(.up)))
        let h = dt / Double(n)
        for _ in 0..<n {
            v += (w * w * (press - x) - 2 * z * w * v) * h
            x += v * h
        }
        let ahead = x - press
        if press <= 0 { landed = false } else if ahead >= 0 { landed = true }
        return ahead < 0 && !landed ? 0 : ahead
    }
}

/// Bend `frame` toward `pan` (−1 left … 1 right).
///
/// `bounds` is how far past the canvas box, left and right, a mark may land
/// — the room to the edge of the screen. A lean that would carry any mark
/// further is scaled down until the outermost one lands on that edge, so
/// the orb can travel to the edge but never past it. Pressing on, it
/// squashes against the edge (`squash`) — the near side flattens and the
/// orb swells a little taller there — and is refracted into it (`lens`): it
/// rests short of the edge by a gap, and the painter draws its near side
/// out across it, parts its colours and blurs it, more the harder it
/// pushes. `bounce` is what an `EdgeBounce` returned: the press overshoots,
/// and the orb springs back off the edge.
public func leanFrame(
    _ frame: inout OrbFrame, pan: Double, size: Double, amounts k: LeanAmounts,
    bounds: (left: Double, right: Double) = (.infinity, .infinity), bounce: Double = 0
) {
    guard abs(pan) >= 0.002, k.move != 0 || k.pull != 0 || k.deform != 0 else { return }
    let c = size / 2
    let R = size * 0.36
    let side: Double = pan < 0 ? -1 : 1
    let amount = abs(pan)
    func shift(_ x: Double, _ y: Double) -> Double {
        let nx = (x - c) / R
        let ny = (y - c) / R
        let near = clamp01((nx * side + 1) / 2)
        let flank = max(0, nx * side)
        return pan * R * (k.move + k.pull * near * near + k.deform * flank * flank * exp(-ny * ny * 1.5))
    }

    // The lens needs room: against an edge the orb stops short of it by a
    // gap from the start, and pressing on, the lens draws it out across the
    // gap — so it reaches the edge without ever backing off it.
    let lens = max(0, min(2, k.lens))
    let zone = R * 0.9
    let bound = side > 0 ? bounds.right : bounds.left
    let gap = bound.isFinite ? min(zone * 0.45, R * 0.3 * lens * max(0, k.stretch)) : 0

    // the share of the lean that keeps every mark inside the room
    var scale = 1.0
    var edge = Double.infinity
    var biggest = 1.0
    if bound.isFinite {
        edge = side > 0 ? size + bound : -bound
        func fit(_ x: Double, _ y: Double, _ r: Double) {
            biggest = max(biggest, r)
            let dx = shift(x, y) * side
            if dx > 1e-9 { scale = min(scale, max(0, ((edge - x) * side - r - gap) / dx)) }
        }
        for d in frame.dots { fit(d.x, d.y, d.r) }
        for s in frame.strokes {
            var i = 0
            while i < s.pts.count {
                fit(s.pts[i], s.pts[i + 1], 1)
                i += 2
            }
        }
    }

    // At the edge and pushing on, the orb presses on it: how hard grows as
    // the lean it wanted outruns the room. The bounce runs the press past
    // that and back, and on its way back springs the orb off the edge.
    let pressure = scale < 1 ? min(1, (1 - scale) / 0.35) : 0
    let hit = pressure > 0 ? bounce * k.bounce : 0
    let pressed = min(1.4, pressure + max(0, hit))
    let recoil = R * 0.12 * max(0, -hit)
    let wall = edge - side * biggest
    // the squash: a soft zone against where it rests
    let rest = wall - side * gap
    let band = R * 0.55 * pressed * k.squash

    // the stretch of the face that meets the edge, for the painter
    var y0 = Double.infinity, y1 = -Double.infinity, track = true
    func bend(_ x: Double, _ y: Double) -> (Double, Double) {
        let near = clamp01(((x - c) / R * side + 1) / 2)
        let squeeze = 1 - 0.15 * k.deform * amount * scale * near
        var bx = x + shift(x, y) * scale + side * (band * 0.5 - recoil)
        var by = c + (y - c) * squeeze
        if band > 0 {
            // the depth into the soft zone, eased so nothing reaches where it
            // rests — gently enough that the pressed side stays rounded, not cut
            let into = (bx - (rest - side * band)) * side
            if into > 0 {
                let q = into / band
                let flat = band * q / (1 + q * q).squareRoot()
                bx = rest - side * band + side * flat
                by = c + (by - c) * (1 + 0.18 * pressed * k.squash * (flat / band))
            }
        }
        if track, (rest - bx) * side < max(band, zone * 0.3) {
            y0 = min(y0, by)
            y1 = max(y1, by)
        }
        return (bx, by)
    }
    for i in frame.dots.indices {
        let (x, y) = bend(frame.dots[i].x, frame.dots[i].y)
        frame.dots[i].x = x
        frame.dots[i].y = y
    }
    for s in frame.strokes.indices {
        var i = 0
        while i < frame.strokes[s].pts.count {
            let (x, y) = bend(frame.strokes[s].pts[i], frame.strokes[s].pts[i + 1])
            frame.strokes[s].pts[i] = x
            frame.strokes[s].pts[i + 1] = y
            i += 2
        }
    }
    if pressure > 0, y1 > y0 {
        let K = lens * pressed
        frame.contact = OrbContact(
            side: side, x: wall, y0: y0, y1: y1, depth: band, press: pressure,
            lens: K > 0.02
                ? OrbLens(
                    // drawn across the gap as it presses, all the way at full press
                    zone: zone, gap: gap * min(1, pressed), flare: 0.22 * K * max(0, k.stretch),
                    split: zone * 0.1 * K * max(0, k.split), blur: zone * 0.075 * K * max(0, k.blur), cy: c
                )
                : nil
        )
    }
    track = false
    if var light = frame.light {
        (light.cx, light.cy) = bend(light.cx, light.cy)
        for j in light.spec.indices {
            (light.spec[j].x, light.spec[j].y) = bend(light.spec[j].x, light.spec[j].y)
        }
        frame.light = light
    }
}
