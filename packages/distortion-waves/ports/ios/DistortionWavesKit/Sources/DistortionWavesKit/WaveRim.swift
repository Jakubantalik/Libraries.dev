import CoreGraphics
import Foundation

/// The lumps that make the colour on the screen's edges uneven, as BorderBeamKit's
/// glow is: seven of them round the perimeter, each with its own length and depth,
/// drifting along the edge and breathing. Worked out once a frame here rather than
/// for every pixel in the shader.
enum WaveRim {
    static let count = 7

    /// Centre along the perimeter (pt, clockwise from the top centre), length (pt)
    /// and depth (a share of the rim's width) of each lump, flattened. `pulse`,
    /// 0–1, makes them drift faster and breathe deeper.
    static func lumps(time: Double, size: CGSize, cornerRadius: Double, pulse: Double = 0) -> [Float] {
        let ex = max(Double(size.width) / 2 - cornerRadius, 0)
        let ey = max(Double(size.height) / 2 - cornerRadius, 0)
        let perimeter = 4 * (ex + ey + 0.5 * .pi * cornerRadius)
        let n = Double(count)
        var out: [Float] = []
        out.reserveCapacity(count * 3)
        for i in 0..<count {
            let fi = Double(i)
            // Fixed per lump, so the pattern is the same on every run.
            let a = hash(fi, 12.9898, 1.3)
            let b = hash(fi, 78.233, 4.1)
            let c = hash(fi, 39.425, 2.7)
            let centre = perimeter * (fi + 0.35 * a) / n + time * (-22 + 44 * b) * (1 + 2 * pulse)
            let length = perimeter / n * (0.2 + 0.25 * c)
            let breath = (0.25 + 0.3 * pulse) * sin(time * (1.1 + 1.2 * a) * (1 + pulse) + fi * 2.4)
            let depth = (0.2 + 2.6 * b) * (1 + breath)
            out += [Float(centre), Float(length), Float(depth)]
        }
        return out
    }

    private static func hash(_ i: Double, _ a: Double, _ b: Double) -> Double {
        let x = sin(i * a + b) * 43758.5453
        return x - x.rounded(.down)
    }
}
