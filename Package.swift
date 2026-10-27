// swift-tools-version: 5.9
import PackageDescription

// The SwiftUI ports of the libraries, installable straight from GitHub:
//
//   .package(url: "https://github.com/Jakubantalik/Libraries.dev", branch: "main")
//   .product(name: "VoiceGlowKit", package: "Libraries.dev")
//
// SwiftPM can't depend on a subfolder of a repository, so this root manifest
// points one target at each port's sources. Each port keeps its own
// Package.swift (with its tests) for local work; keep the targets here in
// step with them. Track the branch, not a version: the repo's older semver
// tags predate this manifest.
//
// iOS 17 / macOS 14 is the floor for the set (ThinkingOrbsKit alone runs on
// iOS 15 when added locally). The `.metal` shaders are compiled into each
// bundle's default.metallib by Xcode's build system, so build through Xcode.

let package = Package(
    name: "Libraries.dev",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "BorderBeamKit", targets: ["BorderBeamKit"]),
        .library(name: "ThinkingOrbsKit", targets: ["ThinkingOrbsKit"]),
        .library(name: "VoiceGlowKit", targets: ["VoiceGlowKit"]),
        .library(name: "BotAvatarsKit", targets: ["BotAvatarsKit"]),
        .library(name: "MetalFxKit", targets: ["MetalFxKit"]),
        .library(name: "MagnetKit", targets: ["MagnetKit"]),
        .library(name: "VoiceRingKit", targets: ["VoiceRingKit"]),
        .library(name: "VoiceRingEmotion", targets: ["VoiceRingEmotion"]),
        .library(name: "VoiceDirectionKit", targets: ["VoiceDirectionKit"]),
    ],
    targets: [
        .target(
            name: "BorderBeamKit",
            path: "packages/border-beam/ports/ios/BorderBeamKit/Sources/BorderBeamKit",
            resources: [
                .copy("Resources/beam-spec.json"),
                .process("BeamShaders.metal"),
            ]
        ),
        .target(
            name: "ThinkingOrbsKit",
            path: "packages/thinking-orbs/ports/ios/ThinkingOrbsKit/Sources/ThinkingOrbsKit"
        ),
        .target(
            name: "VoiceGlowKit",
            path: "packages/voice-glow/ports/ios/VoiceGlowKit/Sources/VoiceGlowKit",
            resources: [.process("VoiceGlowShaders.metal")]
        ),
        // The local manifest adds -Ounchecked in release; unsafe flags are
        // refused in remote dependencies, so this one builds with plain -O.
        .target(
            name: "BotAvatarsKit",
            path: "packages/bot-avatars/ports/ios/BotAvatarsKit/Sources/BotAvatarsKit"
        ),
        .target(
            name: "MetalFxKit",
            dependencies: ["MagnetKit"],
            path: "packages/metal-fx/ports/ios/MetalFxKit/Sources/MetalFxKit",
            resources: [.process("MetalFxShaders.metal")]
        ),
        // The sensor around the magnet model (Magnetic UI), a library of its own;
        // MetalFxKit's `source: .magnet` rings read it. The model itself
        // (Magnet.mfxl) is licensed separately and loaded from the host app.
        .target(
            name: "MagnetKit",
            path: "packages/metal-fx/ports/ios/MagnetKit/Sources/MagnetKit"
        ),
        // Voice ring: the ring, and the kits around it, on one shared core
        // (the engine, the stereo meter, moods). The Voice direction model
        // (VoiceDirection.mfxl) is licensed separately and loaded from the
        // host app; the emotion models come from the app too.
        .target(
            name: "VoiceCore",
            path: "packages/voice-ring/ports/ios/VoiceRingKit/Sources/VoiceCore",
            resources: [.process("Render/Refract.metal")]
        ),
        .target(
            name: "VoiceRingKit",
            dependencies: ["VoiceCore"],
            path: "packages/voice-ring/ports/ios/VoiceRingKit/Sources/VoiceRingKit"
        ),
        .target(
            name: "VoiceRingEmotion",
            dependencies: ["VoiceCore"],
            path: "packages/voice-ring/ports/ios/VoiceRingKit/Sources/VoiceRingEmotion"
        ),
        .target(
            name: "VoiceDirectionKit",
            dependencies: ["VoiceCore"],
            path: "packages/voice-ring/ports/ios/VoiceRingKit/Sources/VoiceDirectionKit"
        ),
    ]
)
