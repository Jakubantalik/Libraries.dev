// The tube painter — port of src/engine/tube.ts: a line drawn as a lit,
// solid tube. The line is cut into short runs and the runs drawn far → near,
// so where it passes in front of itself the near side covers the far one, a
// clear gap cut round it. Each run is one gradient from its first point's
// light to its last's, with a thin highlight laid along it toward the light.
// Each run starts a segment back into the run before it, with butt caps, so
// the runs meet with no seam whichever is drawn last.

import SwiftUI

/// Segments per run: short enough that a crossing sorts cleanly, long
/// enough that a loop is a few dozen strokes.
private let run = 6

/// The brightness `look` gives a glow's colour: its emotion's own, or for a
/// colour between emotions (a crossfade, a detected mood) a blend of theirs,
/// each weighted by how near the colour is to it.
private func emotionBrightness(_ look: FrameTube, _ c: RGB) -> Double {
    let own: [(RGB, Double)] = [
        (VoiceOrbEmotion.positive.color, look.positiveBrightness),
        (VoiceOrbEmotion.negative.color, look.negativeBrightness),
        (VoiceOrbEmotion.calm.color, look.calmBrightness),
    ]
    var sum = 0.0, weight = 0.0
    for (e, b) in own {
        let d = (c.r - e.r) * (c.r - e.r) + (c.g - e.g) * (c.g - e.g) + (c.b - e.b) * (c.b - e.b)
        let w = exp(-d / 6000)
        sum += w * b
        weight += w
    }
    return weight > 1e-6 ? sum / weight : 1
}

/// The colour for a light value: grey; with an emotion, the emotion's own
/// colour takes the tube over by `share` (0 the neutral grey … 1 all
/// colour), lit like the grey was — deep in the shadows, vivid in the light,
/// toward white only at the very brightest.
private func tubeColor(_ s: Double, dark: Bool, look: FrameTube, glow: (color: RGB, amount: Double)?, share: Double) -> Color {
    // on dark, lit parts read pale; on paper, as darker ink
    let g = dark ? 255 * (0.16 + 0.84 * s) : 255 * (0.1 + 0.6 * (1 - s))
    var r = g, gr = g, b = g
    if let glow {
        let bright = look.colorBrightness * emotionBrightness(look, glow.color)
        func vivid(_ c: Double) -> Double {
            dark ? min(255, c * (0.3 + 0.9 * s) * bright + 90 * pow(s, 4)) : min(255, c * (0.45 + 0.55 * (1 - s)) * bright)
        }
        let k = glow.amount * share
        r += (vivid(glow.color.r) - r) * k
        gr += (vivid(glow.color.g) - gr) * k
        b += (vivid(glow.color.b) - b) * k
        // saturation: toward the grey below 1, past the colour above it
        let sat = look.saturation
        if sat != 1 {
            let m = (r + gr + b) / 3
            r = m + (r - m) * sat
            gr = m + (gr - m) * sat
            b = m + (b - m) * sat
        }
    }
    func c(_ v: Double) -> Double { max(0, min(255, v)) / 255 }
    return Color(.sRGB, red: c(r), green: c(gr), blue: c(b))
}

/// Paint `strokes` as lit tubes: each stroke's `a` is its light, `z` its depth.
func paintTube(_ context: inout GraphicsContext, _ strokes: [Stroke], _ look: FrameTube, dark: Bool, glow: (color: RGB, amount: Double)?) {
    func light(_ s: Stroke, _ i: Int) -> Double { clamp01(0.5 + (s.a[i] - 0.5) * look.contrast) }

    struct Run { let s: Int; let from: Int; let to: Int; let z: Double }
    var runs: [Run] = []
    for (si, s) in strokes.enumerated() {
        let n = s.pts.count / 2
        guard n > 1 else { continue }
        let segs = s.closed ? n : n - 1
        var i0 = 0
        while i0 < segs {
            let i1 = min(segs, i0 + run)
            var z = 0.0
            for i in i0...i1 { z += s.z?[i % n] ?? 0 }
            // a segment back into the run before, so the two overlap
            let from = s.closed ? i0 - 1 : max(0, i0 - 1)
            runs.append(Run(s: si, from: from, to: i1, z: z / Double(i1 - i0 + 1)))
            i0 += run
        }
    }
    runs.sort { $0.z < $1.z }

    // With an emotion, its colour fades round the orb into the neutral grey:
    // each point's share of it is set by its angle round the orb's centre,
    // full on one side, grey on the other as far as `gradient` says.
    let emo = glow.flatMap { $0.amount > 0.005 ? $0 : nil }
    var cx = 0.0, cy = 0.0
    if emo != nil {
        var count = 0
        for s in strokes {
            var i = 0
            while i < s.pts.count {
                cx += s.pts[i]
                cy += s.pts[i + 1]
                count += 1
                i += 2
            }
        }
        cx /= Double(max(1, count))
        cy /= Double(max(1, count))
    }
    let phase = (look.gradientAngle + look.gradientSpin * look.t) * Double.pi / 180
    let fade = clamp01(look.gradient)
    func share(_ s: Stroke, _ i: Int) -> Double {
        guard emo != nil else { return 1 }
        let side = (sin(atan2(s.pts[2 * i + 1] - cy, s.pts[2 * i] - cx) + phase) + 1) / 2
        return 1 - fade * (1 - smoothstep(0, 1, side))
    }

    for r in runs {
        let s = strokes[r.s]
        let n = s.pts.count / 2
        func at(_ i: Int) -> Int { ((i % n) + n) % n }
        var path = Path()
        for i in r.from...r.to {
            let k = at(i)
            let p = CGPoint(x: s.pts[2 * k], y: s.pts[2 * k + 1])
            if i == r.from { path.move(to: p) } else { path.addLine(to: p) }
        }
        let a = at(r.from), b = at(r.to)
        let d = look.depth
        let w = s.w * (1 - d + d * r.z)

        // the gap: whatever it passes in front of is cut back round it. Cut
        // rather than shaded, so overlapping runs never darken twice
        var cut = context
        cut.blendMode = .destinationOut
        cut.stroke(path, with: .color(.black), style: StrokeStyle(lineWidth: w * 1.35, lineCap: .butt, lineJoin: .round))

        // the body, its light running from one end of the run to the other
        let p0 = CGPoint(x: s.pts[2 * a], y: s.pts[2 * a + 1])
        let p1 = CGPoint(x: s.pts[2 * b], y: s.pts[2 * b + 1])
        let c0 = tubeColor(light(s, a), dark: dark, look: look, glow: emo, share: share(s, a))
        let shading: GraphicsContext.Shading
        if hypot(p1.x - p0.x, p1.y - p0.y) > 0.5 {
            let c1 = tubeColor(light(s, b), dark: dark, look: look, glow: emo, share: share(s, b))
            shading = .linearGradient(Gradient(colors: [c0, c1]), startPoint: p0, endPoint: p1)
        } else {
            shading = .color(c0)
        }
        context.stroke(path, with: shading, style: StrokeStyle(lineWidth: w, lineCap: .butt, lineJoin: .round))

        // the highlight, set toward the light (up and to the left), strongest
        // where the run is brightest
        var lit = 0.0
        for i in r.from...r.to { lit += light(s, at(i)) }
        lit /= Double(r.to - r.from + 1)
        let alpha = clamp01(look.shine * (dark ? 0.6 : 0.45) * lit * lit)
        if alpha > 0.01 {
            var hi = context
            hi.translateBy(x: -0.17 * w, y: -0.19 * w)
            hi.stroke(path, with: .color(.white.opacity(alpha)), style: StrokeStyle(lineWidth: w * 0.32, lineCap: .butt, lineJoin: .round))
        }
    }
}
