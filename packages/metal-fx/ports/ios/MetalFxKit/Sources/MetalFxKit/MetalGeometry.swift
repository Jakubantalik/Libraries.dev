import SwiftUI

public enum MetalShapeKind: Sendable { case pill, circle }

/// A point displacement — the liquid bend.
public typealias MetalDeform = (CGPoint) -> CGPoint

enum MetalGeometry {
    static let arcN = 14
    static let edgeStep: CGFloat = 1.5

    /// Rounded rect sampled clockwise from the end of the top-left corner:
    /// edges every ~1.5 pt, 14 points per arc — the web's `roundRectOutline`.
    static func roundRectOutline(_ rect: CGRect, radius: CGFloat, deform: MetalDeform?) -> [CGPoint] {
        let x = rect.minX, y = rect.minY, w = rect.width, h = rect.height
        let r = max(0, min(radius, min(w, h) / 2))
        var pts: [CGPoint] = []
        pts.reserveCapacity(4 * (arcN + 1) + Int((2 * (w + h)) / edgeStep) + 8)
        func push(_ px: CGFloat, _ py: CGFloat) {
            let p = CGPoint(x: px, y: py)
            pts.append(deform.map { $0(p) } ?? p)
        }
        func edge(_ x0: CGFloat, _ y0: CGFloat, _ x1: CGFloat, _ y1: CGFloat) {
            let len = hypot(x1 - x0, y1 - y0)
            let k = max(1, Int(ceil(len / edgeStep)))
            for i in 0..<k {
                let t = CGFloat(i) / CGFloat(k)
                push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
            }
        }
        func arc(_ cx: CGFloat, _ cy: CGFloat, _ a0: CGFloat, _ a1: CGFloat) {
            for i in 0...arcN {
                let a = a0 + (a1 - a0) * (CGFloat(i) / CGFloat(arcN))
                push(cx + r * cos(a), cy + r * sin(a))
            }
        }
        edge(x + r, y, x + w - r, y)
        arc(x + w - r, y + r, -.pi / 2, 0)
        edge(x + w, y + r, x + w, y + h - r)
        arc(x + w - r, y + h - r, 0, .pi / 2)
        edge(x + w - r, y + h, x + r, y + h)
        arc(x + r, y + h - r, .pi / 2, .pi)
        edge(x, y + h - r, x, y + r)
        arc(x + r, y + r, .pi, 1.5 * .pi)
        return pts
    }

    static func path(_ pts: [CGPoint]) -> Path {
        var p = Path()
        guard let first = pts.first else { return p }
        p.move(to: first)
        for q in pts.dropFirst() { p.addLine(to: q) }
        p.closeSubpath()
        return p
    }

    /// Outer outline with the inner one punched out (even-odd).
    static func bandPath(outer: [CGPoint], inner: [CGPoint]) -> Path {
        var p = path(outer)
        p.addPath(path(inner))
        return p
    }

    static func kind(size: CGSize, radius: CGFloat) -> MetalShapeKind {
        let m = min(size.width, size.height)
        return abs(size.width - size.height) < 0.5 && radius >= m / 2 - 0.5 ? .circle : .pill
    }

    // MARK: Perimeter (glow hotspot placement)

    static func rrPerim(_ w: CGFloat, _ h: CGFloat, _ r: CGFloat) -> CGFloat {
        let rr = max(0, min(r, min(w, h) / 2))
        return 2 * max(0, w - 2 * rr) + 2 * max(0, h - 2 * rr) + 2 * .pi * rr
    }

    static func shapePerim(_ w: CGFloat, _ h: CGFloat, _ r: CGFloat, _ kind: MetalShapeKind) -> CGFloat {
        if kind == .circle { return 2 * .pi * max(0, min(r, min(w, h) / 2)) }
        return rrPerim(w, h, r)
    }

    /// Point at arc length `s` along the outline, inset by `inset` and pushed
    /// out by `outward`.
    static func sampleAtArc(_ sIn: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat, inset: CGFloat, outward: CGFloat, _ kind: MetalShapeKind) -> CGPoint {
        let rr = max(0, min(r, min(w, h) / 2))
        if kind == .circle {
            let perim = 2 * .pi * rr
            if perim <= 0.0001 { return CGPoint(x: w / 2, y: h / 2) }
            let s = ((sIn.truncatingRemainder(dividingBy: perim)) + perim).truncatingRemainder(dividingBy: perim)
            let theta = -.pi / 2 + (s / perim) * .pi * 2
            let rad = max(0, rr - inset + outward)
            return CGPoint(x: w / 2 + rad * cos(theta), y: h / 2 + rad * sin(theta))
        }
        let topLen = max(0, w - 2 * rr), sideLen = max(0, h - 2 * rr)
        let arcLen = (.pi * rr) / 2
        let perim = 2 * (topLen + sideLen) + 4 * arcLen
        var d = ((sIn.truncatingRemainder(dividingBy: perim)) + perim).truncatingRemainder(dividingBy: perim)
        let rad = max(0, rr - inset + outward)
        if d < topLen { return CGPoint(x: rr + d, y: inset - outward) }
        d -= topLen
        if d < arcLen {
            let theta = -.pi / 2 + (arcLen > 0 ? d / arcLen : 0) * (.pi / 2)
            return CGPoint(x: (w - rr) + rad * cos(theta), y: rr + rad * sin(theta))
        }
        d -= arcLen
        if d < sideLen { return CGPoint(x: w - inset + outward, y: rr + d) }
        d -= sideLen
        if d < arcLen {
            let theta = (arcLen > 0 ? d / arcLen : 0) * (.pi / 2)
            return CGPoint(x: (w - rr) + rad * cos(theta), y: (h - rr) + rad * sin(theta))
        }
        d -= arcLen
        if d < topLen { return CGPoint(x: w - rr - d, y: h - inset + outward) }
        d -= topLen
        if d < arcLen {
            let theta = .pi / 2 + (arcLen > 0 ? d / arcLen : 0) * (.pi / 2)
            return CGPoint(x: rr + rad * cos(theta), y: (h - rr) + rad * sin(theta))
        }
        d -= arcLen
        if d < sideLen { return CGPoint(x: inset - outward, y: h - rr - d) }
        d -= sideLen
        let theta = .pi + (arcLen > 0 ? d / arcLen : 0) * (.pi / 2)
        return CGPoint(x: rr + rad * cos(theta), y: rr + rad * sin(theta))
    }

    static func tangentAngleAtArc(_ s: CGFloat, _ w: CGFloat, _ h: CGFloat, _ r: CGFloat, inset: CGFloat, _ kind: MetalShapeKind) -> CGFloat {
        let a = sampleAtArc(s - 0.5, w, h, r, inset: inset, outward: 0, kind)
        let b = sampleAtArc(s + 0.5, w, h, r, inset: inset, outward: 0, kind)
        return atan2(b.y - a.y, b.x - a.x)
    }

    /// Where a ray from the centre in `dir` leaves the rounded rect.
    static func boundaryPoint(size: CGSize, radius: CGFloat, dir: CGVector) -> CGPoint {
        let hw = size.width / 2, hh = size.height / 2
        let r = max(0, min(radius, min(hw, hh)))
        let ux = dir.dx, uy = dir.dy
        let len = hypot(ux, uy)
        guard len > 1e-6 else { return CGPoint(x: hw, y: hh) }
        let nx = ux / len, ny = uy / len
        let tx = abs(nx) > 1e-6 ? hw / abs(nx) : .infinity
        let ty = abs(ny) > 1e-6 ? hh / abs(ny) : .infinity
        var t = min(tx, ty)
        let px = nx * t, py = ny * t
        if abs(px) > hw - r && abs(py) > hh - r && r > 0 {
            // Corner: intersect the ray with that corner's circle.
            let cx = (px < 0 ? -1 : 1) * (hw - r), cy = (py < 0 ? -1 : 1) * (hh - r)
            let b = -2 * (nx * cx + ny * cy)
            let c = cx * cx + cy * cy - r * r
            let disc = b * b - 4 * c
            if disc >= 0 { t = (-b + sqrt(disc)) / 2 }
        }
        return CGPoint(x: hw + nx * t, y: hh + ny * t)
    }
}

extension CGRect {
    var mfxCenter: CGPoint { CGPoint(x: midX, y: midY) }
}
