// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MagnetKit",
    platforms: [
        .iOS(.v17),
    ],
    products: [
        .library(name: "MagnetKit", targets: ["MagnetKit"])
    ],
    targets: [
        .target(
            // The magnet model (Magnet.mfxl) is not in this package: it is licensed
            // separately (LICENSE-MODEL.md) and loaded from the host app's bundle.
            name: "MagnetKit"
        ),
    ]
)
