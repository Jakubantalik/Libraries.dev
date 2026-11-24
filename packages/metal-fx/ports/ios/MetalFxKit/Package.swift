// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MetalFxKit",
    platforms: [
        .iOS(.v17),
    ],
    products: [
        .library(name: "MetalFxKit", targets: ["MetalFxKit"])
    ],
    targets: [
        .target(
            name: "MetalFxKit",
            resources: [
                // Compiled into the bundle's default.metallib by Xcode's build
                // system (SwiftPM alone leaves it uncompiled — build the
                // package via Xcode / xcodebuild for the shaders to work).
                .process("MetalFxShaders.metal"),
            ]
        ),
    ]
)
