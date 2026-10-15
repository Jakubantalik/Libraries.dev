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
            path: "packages/metal-fx/ports/ios/MetalFxKit/Sources/MetalFxKit",
            resources: [.process("MetalFxShaders.metal")]
        ),
    ]
)
