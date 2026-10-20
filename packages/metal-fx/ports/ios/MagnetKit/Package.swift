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
            name: "MagnetKit",
            resources: [
                // The magnet model (MagnetModel): locator, presence and tap in one file, ~2 MB.
                .copy("Magnet.mfxl"),
            ]
        ),
    ]
)
