// Aura mono — the ring's mono type, ported from Voice orbs' web engine
// (auraMono.ts): the aura's rings as two loops of solid tube, in greys. Waiting, they lie almost face-on, a few degrees
// apart, so the orb reads as one round loop, barely bent. A voice opens them
// out into a globe, each loop leaning away from the other like two great
// circles of a sphere, and sets them warping — a saddle out of the plane, an
// oval and a three-lobed wobble in it — while the voice clock spins
// everything much faster. Every motion is a sum of slow, incommensurate
// sines on that clock, and the voice comes in on the slow envelope only, so
// it morphs, never jumps.
//
// Waiting, it never quite rests: on the type's own slow clock the loops sway
// apart and back, swell gently out of round and drift a little off centre,
// all of it handing over to the voice's motion as someone speaks.
//
// The loops are drawn as lit tubes (`paintTube`): brightest where a tube
// faces the light, the near side over the far one where they cross.
// Processing contracts it a touch and spins the loops round.

import Foundation
import VoiceCore

// The light: from the upper left, a little in front.
private let LX = -0.45
private let LY = 0.55
private let LZ = 0.7
private let LN = (LX * LX + LY * LY + LZ * LZ).squareRoot()

let frameAuraMono: TypeFrame = auraMonoFrame

private func auraMonoFrame(_ size: Double, _ t: Double, _ v: VoiceInput, _ o: TypeOpts) -> OrbFrame {
    let half = size / 2
    let P = v.processing
    // the slow envelope only: the shape breathes with speech, it doesn't pump
    let voice = v.soft
    let mids = v.softBands[1]
    // the loops reach out to ~1.25 R at the most: 0.44 × 1.08 × 1.25 ≈ 0.6
    let R = half * o.v("radius", 0.44) * (1 + o.v("zoom", 0.08) * voice) * (1 - 0.06 * P)
    let deform = o.v("deform", 1.85)
    let rings = max(1, Int(o.v("rings", 2).rounded()))
    let segs = max(48, Int(o.v("segs", 180).rounded()))
    let lw = max(0.5, o.v("lineW", 1.7) * radiusScale(size, 0.6))
    // how far the loops lean off the view axis: a few degrees waiting, a
    // globe while someone speaks
    let lean = o.v("tilt", 0.22) + o.v("open", 0.75) * voice
    // how bent they are: all but round waiting, warped while someone speaks
    let rest = clamp01(o.v("restBend", 0.12))
    let bend = rest + (1 - rest) * clamp01(voice * deform)
    let twist = o.v("twist", 1.69) * bend
    let wobble = o.v("wobble", 0.31) * bend

    // the voice clock, which runs much faster while someone speaks
    let u = v.drive * o.v("pace", 2.1)
    // no perspective by default, the loops drawn flat on; `persp` puts the
    // eye at 1 / persp radii, so the near side reads larger
    let D = 1 / max(0.02, o.v("persp", 0))

    // the waiting motion, gone once the voice has the orb
    let calm = 1 - smoothstep(0.1, 0.5, voice)
    let sway = o.v("idleSway", 0.18) * calm
    let swell = o.v("idleDeform", 0.05) * calm
    let drift = o.v("idleDrift", 0.03) * calm
    let cx = half + R * drift * sin(0.9 * t + 0.6)
    let cy = half + R * drift * sin(0.7 * t + 2.1)

    var strokes: [Stroke] = []
    for k in 0..<rings {
        let kd = Double(k)
        // each loop on its own phases, a golden turn apart, so they never
        // move in step
        let ph = kd * 2.399
        // its lean: the loops tip opposite ways, so they cross like the lines
        // of a globe, and wander round as they turn
        let tip = lean * (1 + 0.25 * sin(0.17 * u + ph)) + sway * sin(1.3 * t + 1.3 * ph)
        let dir = kd * TAU / Double(rings) + 0.23 * u * (k % 2 == 1 ? -1 : 1) + 0.4 * sin(0.11 * u + ph) + v.spin
        let nx = sin(tip) * cos(dir), ny = sin(tip) * sin(dir), nz = cos(tip)
        // the loop's plane: u ⟂ n with no y component, v = n × u
        let ul = hypot(nx, nz) > 0 ? hypot(nx, nz) : 1
        let ux = nz / ul, uz = -nx / ul
        let vx = ny * uz, vy = nz * ux - nx * uz, vz = -ny * ux

        // out of the plane: a saddle and a gentler three-fold
        let b2 = 0.2 * twist * sin(0.29 * u + 1.3 + ph)
        let p2 = 0.37 * u + ph
        let b3 = 0.07 * twist * sin(0.23 * u + 0.4 + ph)
        let p3 = -0.31 * u + 2.1 + ph
        // in the plane: an oval and a three-lobed wobble; the mids add a
        // four-fold swell
        let a2 = 0.07 * wobble * sin(0.33 * u + 0.4 + ph)
        let q2 = 0.41 * u + ph
        let a3 = 0.04 * wobble * sin(0.27 * u + 1 + ph)
        let q3 = -0.35 * u + 0.8 + ph
        let a4 = 0.04 * deform * mids
        let q4 = 0.5 * u + ph
        // waiting: a slow oval and three-lobed swell, turning round the loop
        let s2 = swell * sin(1.1 * t + 0.7 + ph)
        let r2 = 0.7 * t + ph
        let s3 = 0.6 * swell * sin(1.5 * t + 1.9 + ph)
        let r3 = -0.5 * t + ph
        // each a hair smaller than the last, so where they meet they part
        let rk = 1 - o.v("ringGap", 0.035) * kd

        var xs = [Double](repeating: 0, count: segs)
        var ys = xs, zs = xs
        for i in 0..<segs {
            let th = Double(i) / Double(segs) * TAU
            let c = cos(th), s = sin(th)
            let r = rk * (1 + a2 * cos(2 * th + q2) + a3 * cos(3 * th + q3) + a4 * cos(4 * th + q4)
                + s2 * cos(2 * th + r2) + s3 * cos(3 * th + r3))
            let h = rk * (b2 * sin(2 * th + p2) + b3 * sin(3 * th + p3))
            xs[i] = (ux * c + vx * s) * r + nx * h
            ys[i] = vy * s * r + ny * h
            zs[i] = (uz * c + vz * s) * r + nz * h
        }

        var pts: [Double] = []
        pts.reserveCapacity(segs * 2)
        var shade: [Double] = []
        shade.reserveCapacity(segs)
        var depth: [Double] = []
        depth.reserveCapacity(segs)
        for i in 0..<segs {
            let f = D / (D - zs[i])
            pts.append(cx + xs[i] * R * f)
            pts.append(cy - ys[i] * R * f)
            // a tube is brightest across the light, darkest along it: the
            // tangent against the light tells how much of its round face catches it
            let j = (i + 1) % segs, m = (i + segs - 1) % segs
            let tx = xs[j] - xs[m], ty = ys[j] - ys[m], tz = zs[j] - zs[m]
            let tl = max(1e-9, (tx * tx + ty * ty + tz * tz).squareRoot())
            let along = (tx * LX + ty * LY + tz * LZ) / (tl * LN)
            let lit = max(0, 1 - along * along).squareRoot()
            let near = clamp01((zs[i] + 1) / 2)
            shade.append(clamp01(0.12 + 0.6 * lit * (0.55 + 0.45 * near) + 0.28 * near + 0.08 * voice))
            depth.append(near * 2 - 1)
        }
        strokes.append(Stroke(pts: pts, a: shade, white: 0, w: lw, closed: true, z: depth))
    }

    return OrbFrame(
        strokes: strokes,
        tube: FrameTube(
            shine: o.v("shine", 1),
            // one even grey all round: the highlight alone gives it its roundness
            contrast: o.v("contrast", 0),
            depth: o.v("depthWidth", 0),
            // an emotion's colour as deep as it goes, a touch dark, fading
            // most of the way into the grey on one side of the orb, the fade
            // holding still; green a shade darker than the others
            saturation: o.v("colorSaturation", 2),
            gradient: o.v("colorGradient", 0.69),
            gradientAngle: o.v("gradientAngle", 0),
            gradientSpin: o.v("gradientSpin", 0),
            colorBrightness: o.v("colorBrightness", 0.9),
            positiveBrightness: o.v("positiveBrightness", 0.93),
            negativeBrightness: o.v("negativeBrightness", 1),
            calmBrightness: o.v("calmBrightness", 1),
            t: t
        )
    )
}
