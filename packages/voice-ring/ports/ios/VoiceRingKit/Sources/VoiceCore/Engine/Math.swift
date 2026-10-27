// Shared primitives, ported from src/engine/core.ts — same hashes, same
// noise, same projection — so a type ported to Swift draws the same orb.

import Foundation

public let TAU = Double.pi * 2

@inlinable public func lerp(_ a: Double, _ b: Double, _ f: Double) -> Double { a + (b - a) * f }

@inlinable public func clamp01(_ v: Double) -> Double { v < 0 ? 0 : v > 1 ? 1 : v }

@inlinable public func smoothstep(_ e0: Double, _ e1: Double, _ x: Double) -> Double {
    let t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)
}

@inlinable public func frac(_ x: Double) -> Double { x - floor(x) }

/// Deterministic hash in [0, 1).
@inlinable public func hashD(_ a: Double, _ b: Double) -> Double {
    let h = sin(a * 12.9898 + b * 78.233) * 43758.5453
    return h - floor(h)
}

@inlinable func hash3(_ x: Double, _ y: Double, _ z: Double) -> Double {
    let h = sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453
    return h - floor(h)
}

/// Value noise on a 3D lattice, in [0, 1].
public func vnoise3(_ x: Double, _ y: Double, _ z: Double) -> Double {
    let xi = floor(x), yi = floor(y), zi = floor(z)
    var fx = x - xi, fy = y - yi, fz = z - zi
    fx = fx * fx * (3 - 2 * fx)
    fy = fy * fy * (3 - 2 * fy)
    fz = fz * fz * (3 - 2 * fz)
    let x00 = lerp(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), fx)
    let x10 = lerp(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), fx)
    let x01 = lerp(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), fx)
    let x11 = lerp(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), fx)
    return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz)
}

/// Stable directions on a unit sphere (Fibonacci lattice).
public func fibDir(_ i: Int, _ n: Int) -> SIMD3<Double> {
    let golden = Double.pi * (3 - sqrt(5))
    let y = 1 - (2 * (Double(i) + 0.5)) / Double(n)
    let rad = sqrt(max(0, 1 - y * y))
    let a = Double(i) * golden
    return SIMD3(rad * cos(a), y, rad * sin(a))
}

/// Spin + tilt + orthographic projection. +z faces the viewer.
public struct Projector: Sendable {
    @usableFromInline let st: Double, ct: Double, sy: Double, cyw: Double
    @usableFromInline let cx: Double, cy: Double, scale: Double

    public init(yaw: Double, tilt: Double, cx: Double, cy: Double, scale: Double) {
        st = sin(tilt)
        ct = cos(tilt)
        sy = sin(yaw)
        cyw = cos(yaw)
        self.cx = cx
        self.cy = cy
        self.scale = scale
    }

    @inlinable public func callAsFunction(_ x: Double, _ y: Double, _ z: Double) -> (Double, Double, Double) {
        let x1 = x * cyw + z * sy
        let z1 = -x * sy + z * cyw
        let y1 = y * ct - z1 * st
        let z2 = y * st + z1 * ct
        return (cx + x1 * scale, cy - y1 * scale, z2)
    }
}

/// Marks are tuned for a 200pt orb; sub-linear so small orbs stay legible.
@inlinable public func radiusScale(_ size: Double, _ pow: Double = 0.6) -> Double {
    Foundation.pow(size / 200, pow)
}

@inlinable func sinc(_ a: Double) -> Double { a < 1e-6 ? 1 : sin(a) / a }

private let kLobe1 = hypot(2.1, 1.3)
private let kLobe2 = hypot(1.9, 1.7)
private let kFineDiff = sqrt(pow(4.3 - 2.9, 2) + 3.7 * 3.7 + 3.1 * 3.1)
private let kFineSum = sqrt(pow(4.3 + 2.9, 2) + 3.7 * 3.7 + 3.1 * 3.1)

/// The skin field shared by the line types, average over the sphere taken
/// out so it only ever reshapes. `radius` sets the size of its bulges.
public func skinField(_ aLobe: Double, _ aFine: Double, _ T: Double, radius: Double = 1) -> @Sendable (Double, Double, Double) -> Double {
    let k = 1 / max(0.05, radius)
    let p1 = 0.9 * T, p2 = -0.7 * T + 1.3, p3 = 2.1 * T, p4 = -1.6 * T
    let mean = aLobe * (0.55 * sin(p1) * sinc(kLobe1 * k) + 0.45 * sin(p2) * sinc(kLobe2 * k))
        + aFine * 0.5 * (cos(p3 - p4) * sinc(kFineDiff * k) - cos(p3 + p4) * sinc(kFineSum * k))
    return { x0, y0, z0 in
        let x = x0 * k, y = y0 * k, z = z0 * k
        return aLobe * (0.55 * sin(2.1 * x + 1.3 * y + p1) + 0.45 * sin(1.7 * z - 1.9 * y + p2))
            + aFine * sin(4.3 * x - 3.1 * z + p3) * sin(3.7 * y + 2.9 * x + p4)
            - mean
    }
}

/// Drop invisible dots, clamp radii, z-sort far → near.
public func finalizeFrame(_ dots: [Dot], _ strokes: [Stroke], rMin: Double = 0.3) -> OrbFrame {
    var visible: [Dot] = []
    visible.reserveCapacity(dots.count)
    for var d in dots where d.a >= 0.02 {
        d.r = max(rMin, d.r)
        visible.append(d)
    }
    visible.sort { $0.z < $1.z }
    return OrbFrame(dots: visible, strokes: strokes)
}
