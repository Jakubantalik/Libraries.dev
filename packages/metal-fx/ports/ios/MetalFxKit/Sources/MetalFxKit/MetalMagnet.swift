import CoreMotion
import SwiftUI

// MARK: - Motion

/// The motion manager the tilt bend reads, running only while a ring needs it.
final class MetalMotion {
    static let shared = MetalMotion()
    let manager = CMMotionManager()
    private var users = 0

    private init() {}

    func retainDeviceMotion() {
        users += 1
        guard users == 1, manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 60.0
        manager.startDeviceMotionUpdates()
    }

    func releaseDeviceMotion() {
        users = max(0, users - 1)
        if users == 0, manager.isDeviceMotionActive { manager.stopDeviceMotionUpdates() }
    }
}

// MARK: - What a ring feels

/// What a ring feels from a magnet (or a finger, or any driver).
public struct MetalMagnetSample: Equatable, Sendable {
    /// 0…1.
    public var pull: Double
    /// Unit vector in screen axes from the ring toward the magnet.
    public var toward: CGVector
    /// +1 attracts, −1 repels.
    public var polarity: Double

    public init(pull: Double, toward: CGVector, polarity: Double = 1) {
        self.pull = pull; self.toward = toward; self.polarity = polarity
    }

    public static let none = MetalMagnetSample(pull: 0, toward: .zero, polarity: 1)
}

// MARK: - The magnet

/// Where rings with `source: .magnet` read the magnet. MetalFxKit has no magnet
/// code of its own: MagnetKit (libraries.dev/magnetic, a separate download)
/// comes with the file that makes it the provider. Any other source works too.
public protocol MetalMagnetProvider: AnyObject {
    /// A ring started / stopped reading: run the sensor while any ring does.
    func attach()
    func detach()
    /// What a ring centred at `center` (global points) feels this frame.
    func sample(center: CGPoint, now: TimeInterval) -> MetalMagnetSample
}

public enum MetalMagnet {
    /// Set once, before the first `source: .magnet` ring appears (your App's
    /// init). Without one those rings hold their shape.
    public static var provider: (any MetalMagnetProvider)?
}

// MARK: - Manual and pointer drivers

/// Drive the metal with any field — audio bass, a game, a recorded trace.
/// Set the values from anywhere on the main thread; rings read them every frame.
public final class MetalMagnetDriver {
    public var pull: Double = 0
    /// Unit vector in screen axes toward the "magnet".
    public var toward: CGVector = CGVector(dx: 0, dy: -1)
    public var polarity: Double = 1

    public init() {}
    public var sample: MetalMagnetSample { MetalMagnetSample(pull: pull, toward: toward, polarity: polarity) }
}

/// A finger as the desktop cursor. Install `.metalPointerTracking()` on a
/// root view; rings with `source: .pointer` then bend toward the touch
/// exactly as the web's hover bend does toward the mouse.
public final class MetalPointerSource {
    public static let shared = MetalPointerSource()
    /// Global (window) location of the touch, or nil.
    public var location: CGPoint?
    private init() {}
}

struct MetalPointerTracking: ViewModifier {
    func body(content: Content) -> some View {
        content.simultaneousGesture(
            DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .onChanged { MetalPointerSource.shared.location = $0.location }
                .onEnded { _ in MetalPointerSource.shared.location = nil }
        )
    }
}

public extension View {
    /// Track touches anywhere in this view for rings with `source: .pointer`.
    func metalPointerTracking() -> some View { modifier(MetalPointerTracking()) }
}
