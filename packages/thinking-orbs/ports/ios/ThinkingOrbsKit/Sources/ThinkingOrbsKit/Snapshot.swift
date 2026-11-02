// Headless frame capture for parity testing.
//
// ImageRenderer runs the real SwiftUI Canvas pipeline without a simulator,
// window or screen-recording permission — but it never fires onAppear and
// never advances a TimelineView, so every capture would otherwise render the
// same t=0 frame. `.orbFrozenTime(_:)` is what makes a capture deterministic
// and comparable against the web at the same instant.

#if canImport(SwiftUI) && !os(watchOS)
import SwiftUI

#if os(macOS)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

@available(iOS 16.0, macOS 13.0, *)
public enum OrbSnapshot {
    /// Render one orb at a fixed instant. `scale` mirrors the web harness's
    /// device pixel ratio, so the two rasters are the same size.
    @MainActor
    public static func png(
        state: OrbState,
        size: OrbSize,
        dark: Bool,
        t: Double,
        scale: Double = 2
    ) -> Data? {
        let view = ThinkingOrb(state: state, size: size, theme: dark ? .dark : .light)
            .orbFrozenTime(t)
            .frame(width: size.value, height: size.value)

        let renderer = ImageRenderer(content: view)
        renderer.scale = scale
        // transparent background, exactly like the web canvas
        renderer.isOpaque = false

        #if os(macOS)
        guard let image = renderer.nsImage,
              let tiff = image.tiffRepresentation,
              let rep = NSBitmapImageRep(data: tiff) else { return nil }
        return rep.representation(using: .png, properties: [:])
        #elseif canImport(UIKit)
        return renderer.uiImage?.pngData()
        #else
        return nil
        #endif
    }
}
#endif
