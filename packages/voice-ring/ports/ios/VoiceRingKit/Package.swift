// swift-tools-version: 5.9
import PackageDescription

// The SwiftUI port of Voice ring, and the kits around it:
//
// - VoiceRingKit      — the ring (`VoiceRing`), with the meter and moods.
// - VoiceRingEmotion  — on-device emotion: the voice's tone (emotion2vec+)
//   and its words (GoEmotions), as in VoiceGlow Pro. Models from the app.
// - VoiceDirectionKit — where the voice comes from, read by the directional
//   voice model (VoiceDirection.mfxl, licensed separately, from the app).
//
// VoiceCore holds what they share — the engine, the painters, the stereo
// microphone, the voice follower, mood colours — and is re-exported by each.
// The repository's root Package.swift points at these same sources; keep
// the two in step.
let package = Package(
    name: "VoiceRingKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "VoiceRingKit", targets: ["VoiceRingKit"]),
        .library(name: "VoiceRingEmotion", targets: ["VoiceRingEmotion"]),
        .library(name: "VoiceDirectionKit", targets: ["VoiceDirectionKit"]),
    ],
    targets: [
        // the edge refraction is a Metal shader, compiled into the bundle
        .target(name: "VoiceCore", resources: [.process("Render/Refract.metal")]),
        .target(name: "VoiceRingKit", dependencies: ["VoiceCore"]),
        .target(name: "VoiceRingEmotion", dependencies: ["VoiceCore"]),
        .target(name: "VoiceDirectionKit", dependencies: ["VoiceCore"]),
        .testTarget(name: "VoiceRingKitTests", dependencies: ["VoiceCore", "VoiceRingKit", "VoiceDirectionKit"],
                    resources: [.copy("Fixtures")]),
    ]
)
