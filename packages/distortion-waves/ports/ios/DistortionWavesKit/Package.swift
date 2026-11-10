// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "DistortionWavesKit",
    platforms: [
        .iOS(.v17),
        // macOS 14 ships the same SwiftUI Shader APIs; kept so the package can
        // be type-checked and tested on Mac during development.
        .macOS(.v14),
    ],
    products: [
        .library(name: "DistortionWavesKit", targets: ["DistortionWavesKit"]),
    ],
    targets: [
        .target(
            name: "DistortionWavesKit",
            resources: [
                // Compiled into the bundle's default.metallib by Xcode's build
                // system (SwiftPM alone leaves it uncompiled — build through
                // Xcode for the shaders to work).
                .process("DistortionWaveShaders.metal"),
            ]
        ),
        .testTarget(
            name: "DistortionWavesKitTests",
            dependencies: ["DistortionWavesKit"]
        ),
    ]
)
