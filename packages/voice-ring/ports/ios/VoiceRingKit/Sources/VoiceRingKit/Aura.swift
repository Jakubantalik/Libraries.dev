// Aura — the Voice ring, ported from Voice orbs' web engine (aura.ts):
// signal's rings drawn in light. A few rings lean off the view axis and
// bundle into a glassy ribbon; a conic spectrum runs around it; the voice
// bends every ring together exactly as it bends signal (size and the
// ring's drift taken out, so it only bends).
import Foundation
import VoiceCore

private let spectrum: [FrameLight.Stop] = {
    let rows: [[Double]] = [
        [0, 255, 150, 90], [0.12, 255, 110, 120], [0.24, 255, 80, 170], [0.4, 190, 80, 255],
        [0.58, 90, 92, 255], [0.74, 60, 132, 255],
        // violet warms through magenta into the gold at the top, so the gold
        // fades in rather than meeting the violet at an edge
        [0.84, 170, 90, 255], [0.93, 240, 104, 165], [1, 255, 150, 90],
    ]
    return rows.map { FrameLight.Stop($0[0], $0[1], $0[2], $0[3]) }
}()

let frameAura: TypeFrame = auraFrame

private func auraFrame(_ size: Double, _ t: Double, _ v: VoiceInput, _ o: TypeOpts) -> OrbFrame {
    let half = size / 2
    let L = v.level
    let lo = v.softBands[0], mid = v.softBands[1], hi = v.bands[2]
    let T = v.drive
    let P = v.processing
    let voice = 0.5 * L + 0.5 * v.soft
    let R = half * o.v("radius", 0.56) * (1 + o.v("zoom", 0.17) * v.soft) * (1 - 0.06 * P)
    let deform = o.v("deform", 1.45)
    let field = skinField(0.02 + (0.14 * lo + 0.06 * L) * deform, 0.01 + (0.07 * mid + 0.03 * hi) * deform, T,
                          radius: o.v("deformRadius", 1.75))
    let lw = max(0.6, o.v("lineW", 1.85) * radiusScale(size, 0.5))
    let rings = max(1, Int(o.v("rings", 6).rounded()))
    let segs = max(24, Int(o.v("segs", 140).rounded()))
    let spread = o.v("lean", 0.91)
    // how far apart the rings sit, each a step larger than the last
    let gap = o.v("ringGap", 0.02)

    struct Ring { var dirs: [Double]; var f: [Double]; var a: [Double]; var rk: Double }
    var built: [Ring] = []
    var sum = 0.0
    var count = 0
    for k in 0..<rings {
        let kd = Double(k)
        let spin = 0.16 * (0.5 + hashD(kd, 2.1)) * (k % 2 == 1 ? 1 : -1)
        let lean = max(0.02, spread * (0.2 + 0.8 * hashD(kd, 3.1)) + 0.03 * sin(t * 0.27 + kd * 1.3) + 0.08 * sin(T * 0.35 + kd * 1.7))
        let dir = hashD(kd, 7.7) * TAU + t * 0.05 * (k % 2 == 1 ? 1 : -1) + T * spin
        let nx = sin(lean) * cos(dir), ny = sin(lean) * sin(dir), nz = cos(lean)
        let ul = hypot(nx, nz)
        let ux = nz / ul, uz = -nx / ul
        let vx = ny * uz, vy = nz * ux - nx * uz, vz = -ny * ux
        // concentric spread: a hair of it bundles the rings into one glassy
        // tube, parted only by their leans; more sets each on its own circle
        let rk = R * (1 + gap * (kd - Double(rings - 1) / 2))
        let sl = sin(lean)
        var ring = Ring(dirs: [], f: [], a: [], rk: rk)
        ring.dirs.reserveCapacity(segs * 2)
        for i in 0..<segs {
            let th = Double(i) / Double(segs) * TAU
            let c = cos(th), s = sin(th)
            let x = ux * c + vx * s, y = vy * s, z = uz * c + vz * s
            let fi = field(x, y, z)
            ring.dirs.append(x)
            ring.dirs.append(y)
            ring.f.append(fi)
            sum += fi
            count += 1
            ring.a.append(0.62 + 0.38 * clamp01((z / sl + 1) / 2))
        }
        built.append(ring)
    }
    // take out the average (size) and the first harmonic (a slide): bends only
    let mean = count > 0 ? sum / Double(count) : 0
    var c1 = 0.0, s1 = 0.0
    for ring in built {
        for i in ring.f.indices {
            let x = ring.dirs[2 * i], y = ring.dirs[2 * i + 1]
            let l = max(1e-9, hypot(x, y))
            c1 += (ring.f[i] - mean) * (x / l)
            s1 += (ring.f[i] - mean) * (y / l)
        }
    }
    if count > 0 {
        c1 = 2 * c1 / Double(count)
        s1 = 2 * s1 / Double(count)
    }
    let strokes: [Stroke] = built.map { ring in
        var pts: [Double] = []
        pts.reserveCapacity(ring.f.count * 2)
        for i in ring.f.indices {
            let x = ring.dirs[2 * i], y = ring.dirs[2 * i + 1]
            let l = max(1e-9, hypot(x, y))
            let r = ring.rk * (1 + ring.f[i] - mean - c1 * (x / l) - s1 * (y / l))
            pts.append(half + x * r)
            pts.append(half - y * r)
        }
        return Stroke(pts: pts, a: ring.a, white: 0, w: lw, closed: true)
    }

    let specAt = 2.3 + 0.25 * sin(t * 0.21) + 2 * v.spin
    var frame = finalizeFrame([], strokes)
    frame.light = FrameLight(
        cx: half, cy: half, r: R,
        stops: spectrum,
        angle: -Double.pi / 2 - 0.35 + 0.5 * sin(t * 0.07) + 0.4 * sin(T * 0.2) + v.spin,
        intensity: 0.62 + 0.55 * voice + 0.5 * P,
        halo: o.v("halo", 0.5) * (1 + 0.6 * P),
        spec: [FrameLight.Spec(x: half + cos(specAt) * R, y: half + sin(specAt) * R, r: R * (0.5 + 0.25 * P), a: 0.5 + 0.35 * voice + 0.4 * P)],
        fringe: 0.016 + 0.012 * voice
    )
    return frame
}
