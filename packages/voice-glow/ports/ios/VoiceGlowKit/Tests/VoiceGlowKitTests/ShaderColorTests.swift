import SwiftUI
import XCTest
@testable import VoiceGlowKit

/// The shader's colours must land on screen as the web's CSS colours do:
/// sRGB values, not values the renderer reinterprets as linear light.
@MainActor
final class ShaderColorTests: XCTestCase {
    func testLobeColourReachesThePixelUnchanged() throws {
        guard VoiceGlowStyle.shadersCompiled else { throw XCTSkip("shaders compile only under xcodebuild") }
        let size = CGSize(width: 40, height: 40)
        // One lobe centred on the view, solid at the centre.
        let lobes: [Float] = [20, 20, 30, 30, 1, 0.2, 0.2, 1]
        let params: [Float] = [2, 0, 1, 1, 28, 9, 0, 0, 0, 0, 1]
        let view = Rectangle().fill(Color.white)
            .colorEffect(ShaderLibrary.bundle(.module).voiceGlowLayer(
                .float2(size), .floatArray(lobes), .floatArray([0]), .floatArray([0]), .floatArray(params)
            ))
            .frame(width: size.width, height: size.height)
        let renderer = ImageRenderer(content: view)
        renderer.scale = 1
        let image = try XCTUnwrap(renderer.cgImage)
        let px = try pixel(image, x: 20, y: 20)
        print("centre pixel", px)
        XCTAssertEqual(Double(px.0), 255, accuracy: 8)
        XCTAssertEqual(Double(px.1), 51, accuracy: 6)
        XCTAssertEqual(Double(px.2), 51, accuracy: 6)
    }

    private func pixel(_ image: CGImage, x: Int, y: Int) throws -> (UInt8, UInt8, UInt8, UInt8) {
        var data = [UInt8](repeating: 0, count: 4)
        let ctx = try XCTUnwrap(CGContext(
            data: &data, width: 1, height: 1, bitsPerComponent: 8, bytesPerRow: 4,
            space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        ctx.draw(image, in: CGRect(x: -x, y: -(image.height - 1 - y), width: image.width, height: image.height))
        return (data[0], data[1], data[2], data[3])
    }
}
