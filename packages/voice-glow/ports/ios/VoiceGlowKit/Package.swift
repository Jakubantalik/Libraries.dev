// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "VoiceGlowKit",
    platforms: [
        .iOS(.v17),
        // macOS 14 ships the same SwiftUI Shader APIs; kept so the package can
        // be type-checked and previewed on Mac during development.
        .macOS(.v14),
    ],
    products: [
        // The glow, the microphone meter and the mood colouring. Emotion
        // detection, the live transcript and the processing state are
        // VoiceGlow Pro (libraries.dev Pro), built on this package.
        .library(name: "VoiceGlowKit", targets: ["VoiceGlowKit"]),
    ],
    targets: [
        .target(
            name: "VoiceGlowKit",
            resources: [
                // Compiled into the bundle's default.metallib by Xcode's build
                // system (SwiftPM alone leaves it uncompiled — build the
                // package via Xcode for the shaders to work).
                .process("VoiceGlowShaders.metal"),
            ]
        ),
        .testTarget(
            name: "VoiceGlowKitTests",
            dependencies: ["VoiceGlowKit"]
        ),
    ]
)
