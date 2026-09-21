import SwiftUI

/// The inner-shadow hairline (Figma: white 90 %, offset 0/1, blur 0.5): the
/// silhouette minus itself shifted down, blurred, clipped back inside the
/// silhouette. Works on any white silhouette — a ring band, a glyph run.
public struct MetalRimOptions: Equatable, Sendable {
    public var offsetY: Double = 1
    public var blur: Double = 0.5
    public var alpha: Double = 0.9
    public var color: Color = .white
    public init() {}
    public static let `default` = MetalRimOptions()
}

struct MetalRimLayer<Silhouette: View>: View {
    let options: MetalRimOptions
    @ViewBuilder let silhouette: () -> Silhouette

    var body: some View {
        ZStack {
            silhouette()
            silhouette()
                .offset(y: options.offsetY)
                .blendMode(.destinationOut)
        }
        .compositingGroup()
        .blur(radius: options.blur)
        .mask { silhouette() }
        .foregroundStyle(options.color)
        .opacity(options.alpha)
        .allowsHitTesting(false)
    }
}
