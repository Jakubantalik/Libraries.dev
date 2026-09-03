// Pins the reduced-motion / paused static frame to the same instant the
// frozen-time path renders.
//
// Both paths claim to render OrbSpec.reducedMotionT. The frozen-time branch
// passes it through raw; the static branch multiplies it by effSpeed. Since
// engine time already has preset speed folded in (spec.paint.clock), only one
// of them can be right -- and the web reference (src/ThinkingOrb.tsx) renders
// a bare frame(0.6), so it is the frozen-time branch.
//
// Rendering both through the real SwiftUI Canvas and comparing rasters means
// this test fails on the actual painted output, not on a recomputed number.

import XCTest
import SwiftUI
@testable import ThinkingOrbsKit

@available(iOS 16.0, macOS 13.0, *)
final class ReducedMotionParityTests: XCTestCase {

    /// Rasterise a view to straight RGBA8 through a context we control, so the
    /// comparison never depends on whatever backing format ImageRenderer picked.
    @MainActor
    private func raster<V: View>(_ view: V, scale: Double) -> (w: Int, h: Int, px: [UInt8])? {
        let renderer = ImageRenderer(content: view)
        renderer.scale = scale
        renderer.isOpaque = false
        guard let cg = renderer.cgImage else { return nil }
        let w = cg.width, h = cg.height
        var px = [UInt8](repeating: 0, count: w * h * 4)
        let ok: Bool = px.withUnsafeMutableBytes { raw -> Bool in
            guard let ctx = CGContext(
                data: raw.baseAddress,
                width: w, height: h,
                bitsPerComponent: 8, bytesPerRow: w * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        return ok ? (w, h, px) : nil
    }

    @MainActor
    private func png<V: View>(_ view: V, scale: Double) -> Data? {
        let renderer = ImageRenderer(content: view)
        renderer.scale = scale
        renderer.isOpaque = false
        #if canImport(AppKit)
        guard let image = renderer.nsImage,
              let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
        #else
        return renderer.uiImage?.pngData()
        #endif
    }

    /// The frozen-time branch at reducedMotionT -- the documented-correct instant.
    private func reference(_ state: OrbState, _ size: OrbSize) -> some View {
        ThinkingOrb(state: state, size: size, theme: .light)
            .orbFrozenTime(OrbSpec.reducedMotionT)
            .frame(width: size.value, height: size.value)
    }

    /// The static branch. `paused` reaches the identical line as reduceMotion,
    /// without having to fake an accessibility environment.
    private func subject(_ state: OrbState, _ size: OrbSize) -> some View {
        ThinkingOrb(state: state, size: size, theme: .light, paused: true)
            .frame(width: size.value, height: size.value)
    }

    @MainActor
    func testStaticFrameRendersTheSameInstantAsFrozenTime() throws {
        var mismatches: [String] = []
        var report: [String] = []

        for state in OrbState.allCases {
            for size in OrbSize.allCases {
                let key = "\(state.rawValue)@\(size.rawValue)"
                guard let a = raster(reference(state, size), scale: 2),
                      let b = raster(subject(state, size), scale: 2) else {
                    XCTFail("render failed: \(key)"); continue
                }
                XCTAssertEqual(a.w, b.w); XCTAssertEqual(a.h, b.h)

                var differing = 0
                var maxDelta = 0
                for i in stride(from: 0, to: a.px.count, by: 4) {
                    var worst = 0
                    for c in 0..<4 {
                        worst = max(worst, abs(Int(a.px[i + c]) - Int(b.px[i + c])))
                    }
                    if worst > 1 { differing += 1 }
                    maxDelta = max(maxDelta, worst)
                }
                let total = a.w * a.h
                let pct = Double(differing) / Double(total) * 100
                let effSpeed = resolvePreset(state, size).speed
                report.append(String(
                    format: "  %-14@ speed %.3f  static t=%.3f  differing %5.2f%%  maxΔ %3d",
                    key as NSString, effSpeed,
                    OrbSpec.reducedMotionT * effSpeed, pct, maxDelta
                ))
                if differing > 0 {
                    mismatches.append(String(format: "%@ (%.2f%% of pixels, maxΔ %d)", key, pct, maxDelta))
                }
            }
        }

        print("reduced-motion vs frozen-time @ t=\(OrbSpec.reducedMotionT):")
        report.forEach { print($0) }

        XCTAssertTrue(
            mismatches.isEmpty,
            "\(mismatches.count)/18 (state × size) pairs render a different frame "
            + "from the static path than from frozen time:\n" + mismatches.joined(separator: "\n")
        )
    }

    /// Writes the before/after images for a bug report. Opt-in.
    @MainActor
    func testWriteReproImages() throws {
        guard let outDir = ProcessInfo.processInfo.environment["ORB_REPRO_DIR"] else {
            throw XCTSkip("set ORB_REPRO_DIR to capture")
        }
        let dir = URL(fileURLWithPath: outDir)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        var n = 0
        for state in OrbState.allCases {
            for size in OrbSize.allCases where size == .px64 {
                let key = "\(state.rawValue)-\(size.rawValue)"
                if let d = png(reference(state, size), scale: 8) {
                    try d.write(to: dir.appendingPathComponent("\(key)-expected.png")); n += 1
                }
                if let d = png(subject(state, size), scale: 8) {
                    try d.write(to: dir.appendingPathComponent("\(key)-actual.png")); n += 1
                }
            }
        }
        print("wrote \(n) repro images to \(outDir)")
    }
}
