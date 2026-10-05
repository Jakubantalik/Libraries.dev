import SwiftUI
import XCTest
@testable import VoiceGlowKit

/// Renders the glow at a held level for side-by-side checks against the web
/// version. Writes PNGs only when VOICE_GLOW_SNAPSHOTS names a folder:
///
///     TEST_RUNNER_VOICE_GLOW_SNAPSHOTS=/tmp/shots xcodebuild test -scheme VoiceGlowKit \
///       -destination 'platform=macOS' -only-testing:VoiceGlowKitTests/SnapshotTests
@MainActor
final class SnapshotTests: XCTestCase {
    struct Shot {
        let name: String
        let type: VoiceGlowType
        let size: CGSize
        let dark: Bool
        let level: Double
        var mood: VoiceMood? = nil
        var motion = VoiceGlowMotion.rest
        var radius: Double = 0
    }

    func testSnapshots() throws {
        guard let dir = ProcessInfo.processInfo.environment["VOICE_GLOW_SNAPSHOTS"] else {
            throw XCTSkip("set VOICE_GLOW_SNAPSHOTS to write snapshots")
        }
        let phone = CGSize(width: 402, height: 874)
        let chat = CGSize(width: 350, height: 120)
        let shots = [
            Shot(name: "mobile-dark", type: .mobile, size: phone, dark: true, level: 0.803),
            Shot(name: "mobile-light", type: .mobile, size: phone, dark: false, level: 0.803),
            Shot(name: "mobile-happy", type: .mobile, size: phone, dark: true, level: 0.803, mood: .happy),
            Shot(name: "mobile-angry", type: .mobile, size: phone, dark: true, level: 0.803, mood: .angry),
            Shot(name: "mobile-sad", type: .mobile, size: phone, dark: true, level: 0.803, mood: .sad),
            Shot(name: "mobile-calm", type: .mobile, size: phone, dark: true, level: 0.803, mood: .calm),
            Shot(name: "mobile-gathered", type: .mobile, size: phone, dark: true, level: 0, motion: VoiceGlowMotion(gather: 1, offset: 0.4, stretch: 1, heldLevel: 0.35, cornerFollow: 0.4)),
            Shot(name: "chat-dark", type: .standard, size: chat, dark: true, level: 0.6, radius: 20),
            Shot(name: "chat-light", type: .standard, size: chat, dark: false, level: 0.6, radius: 20),
        ]
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        for shot in shots {
            var options = VoiceGlowOptions()
            options.hueRange = 0
            let config = VoiceGlowConfig(
                type: shot.type, options: options, dark: shot.dark, colorVariant: .colorful,
                cornerRadius: shot.radius, reducedMotion: false
            )
            let engine = VoiceGlowEngine()
            var frame = VoiceGlowFrame()
            for i in 0..<(60 * 10) {
                frame = engine.step(
                    time: Double(i) / 60,
                    input: VoiceGlowInput(level: shot.level, bands: nil, motion: shot.motion, active: true, mood: shot.mood),
                    config: config, size: shot.size
                )
            }
            let view = ZStack {
                (shot.dark ? Color.black : Color.white)
                VoiceGlowLayers(frame: frame, config: config, size: shot.size)
            }
            .frame(width: shot.size.width, height: shot.size.height)
            .environment(\.colorScheme, shot.dark ? .dark : .light)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 2
            let image = try XCTUnwrap(renderer.cgImage)
            let url = URL(fileURLWithPath: dir).appendingPathComponent("\(shot.name).png")
            let dest = try XCTUnwrap(CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil))
            CGImageDestinationAddImage(dest, image, nil)
            XCTAssertTrue(CGImageDestinationFinalize(dest))
        }
    }
}
