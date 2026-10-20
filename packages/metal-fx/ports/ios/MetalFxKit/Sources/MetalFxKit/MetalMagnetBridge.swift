import SwiftUI
import simd
@_exported import MagnetKit

// The magnet lives in MagnetKit, a library of its own (the sensor, the zero,
// the magnet model, gestures). MetalFxKit reads it like any other library
// can: rings with `source: .magnet` take a `MetalMagnetSample` from
// `MagnetSource.shared` every frame.

// MARK: - Names from before MagnetKit

@available(*, deprecated, renamed: "MagnetSource") public typealias MetalMagnetSource = MagnetSource
@available(*, deprecated, renamed: "MagnetConfig") public typealias MetalMagnetConfig = MagnetConfig
@available(*, deprecated, renamed: "MagnetReading") public typealias MetalMagnetReading = MagnetReading
@available(*, deprecated, renamed: "MagnetGesture") public typealias MetalMagnetGesture = MagnetGesture
@available(*, deprecated, renamed: "MagnetPolarity") public typealias MetalMagnetPolarity = MagnetPolarity
@available(*, deprecated, renamed: "MagnetLocatorMode") public typealias MetalMagnetLocatorMode = MagnetLocatorMode
@available(*, deprecated, renamed: "MagnetTemplate") public typealias MetalMagnetTemplate = MagnetTemplate
@available(*, deprecated, renamed: "MagnetSimulator") public typealias MetalMagnetSimulator = MagnetSimulator
@available(*, deprecated, renamed: "MagnetDipole") public typealias MetalMagnetDipole = MagnetDipole

/// MetalFxKit's tilt bend shares MagnetKit's motion manager (one per app).
typealias MetalMotion = MagnetMotion

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

public extension MagnetSource {
    /// What a ring centred at `center` (global points) feels this frame.
    func sample(center: CGPoint, now: TimeInterval) -> MetalMagnetSample {
        let r = reading(now: now)
        guard r.pull > 0, r.toward != .zero else { return MetalMagnetSample(pull: r.pull, toward: r.toward, polarity: r.polarity) }
        var dir = r.toward
        if let p = r.screenPosition, config.locatorEnabled {
            // Located: aim at the magnet itself.
            let vx = Double(p.x - center.x), vy = Double(p.y - center.y)
            let l = hypot(vx, vy)
            if l > 1 { dir = CGVector(dx: vx / l, dy: vy / l) }
        } else if let p = r.position, config.aimRadius > 0 {
            // Near the ring, aim at the magnet; further away, keep the side.
            let vx = Double(p.x - center.x), vy = Double(p.y - center.y)
            let l = hypot(vx, vy)
            if l > 1 {
                let w = 1 - ss(config.aimRadius * 0.5, config.aimRadius * 1.4, l)
                let bx = Double(dir.dx) * (1 - w) + vx / l * w, by = Double(dir.dy) * (1 - w) + vy / l * w
                let bl = hypot(bx, by)
                if bl > 1e-6 { dir = CGVector(dx: bx / bl, dy: by / bl) }
            }
        } else if let s = config.sensorPosition, r.distance.isFinite {
            let d = r.distance * config.pointsPerCm
            let mx = Double(s.x) + Double(dir.dx) * d, my = Double(s.y) + Double(dir.dy) * d
            let vx = mx - Double(center.x), vy = my - Double(center.y)
            let l = hypot(vx, vy)
            if l > 1 { dir = CGVector(dx: vx / l, dy: vy / l) }
        }
        return MetalMagnetSample(pull: r.pull, toward: dir, polarity: r.polarity)
    }
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
