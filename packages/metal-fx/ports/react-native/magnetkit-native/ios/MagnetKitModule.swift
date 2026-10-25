import ExpoModulesCore
import UIKit

/// MagnetKit for React Native: runs `MagnetSource` (the magnet model) every
/// display frame while JavaScript listens, and sends each reading and each
/// gesture as an event. Positions are window points, as React Native lays
/// out. The model (Magnet.mfxl) comes from the app bundle.
public class MagnetKitModule: Module {
  private var ticker: FrameTicker?
  private var gestureId: UUID?
  private static let magnetKey = "MagnetKitRN.magnet"

  public func definition() -> ModuleDefinition {
    Name("MagnetKit")

    Events("onFrame", "onGesture")

    Function("isAvailable") { MagnetSource.shared.isSensorAvailable }

    Function("hasModel") { MagnetModel.bundled != nil }

    AsyncFunction("start") { self.start() }.runOnQueue(.main)

    AsyncFunction("stop") { self.stop() }.runOnQueue(.main)

    AsyncFunction("zero") { MagnetSource.shared.calibrate() }.runOnQueue(.main)

    AsyncFunction("setMagnet") { (face: Int, strength: Double, x: Double, y: Double) in
      UserDefaults.standard.set([Double(face), strength, x, y], forKey: Self.magnetKey)
      self.applyMagnet()
    }.runOnQueue(.main)

    AsyncFunction("clearMagnet") {
      UserDefaults.standard.removeObject(forKey: Self.magnetKey)
      self.applyMagnet()
    }.runOnQueue(.main)

    Function("getMagnet") { () -> [String: Any]? in
      guard let m = Self.storedMagnet() else { return nil }
      return ["face": m.face, "strength": m.strength, "sensor": ["x": m.sensor.x, "y": m.sensor.y]]
    }

    Function("screen") { () -> [String: Any] in
      let b = UIScreen.main.bounds
      return ["width": b.width, "height": b.height, "pointsPerCm": MagnetSource.shared.config.pointsPerCm]
    }

    OnDestroy {
      DispatchQueue.main.async { self.stop() }
    }
  }

  private static func storedMagnet() -> (face: Int, strength: Double, sensor: CGPoint)? {
    guard let a = UserDefaults.standard.array(forKey: magnetKey) as? [Double], a.count == 4 else { return nil }
    return (a[0] < 0 ? -1 : 1, a[1], CGPoint(x: a[2], y: a[3]))
  }

  /// The calibrated magnet, or a guess (sensor near the top centre, face and
  /// strength unknown) so the locator still answers before a calibration.
  private func applyMagnet() {
    let s = MagnetSource.shared
    if let m = Self.storedMagnet() {
      s.config.magnetFace = m.face
      s.config.magnetStrength = m.strength
      s.config.sensorPosition = m.sensor
    } else {
      s.config.magnetFace = nil
      s.config.magnetStrength = nil
      s.config.sensorPosition = CGPoint(x: UIScreen.main.bounds.midX, y: 1.1 * s.config.pointsPerCm)
    }
    s.config.locatorEnabled = true
  }

  private func start() {
    guard ticker == nil else { return }
    let s = MagnetSource.shared
    applyMagnet()
    s.attach()
    gestureId = s.addGestureHandler { [weak self] g in self?.sendEvent("onGesture", Self.gesture(g)) }
    ticker = FrameTicker { [weak self] now in self?.tick(now) }
  }

  private func stop() {
    guard let t = ticker else { return }
    t.invalidate()
    ticker = nil
    if let id = gestureId { MagnetSource.shared.removeGestureHandler(id) }
    gestureId = nil
    MagnetSource.shared.detach()
  }

  private func tick(_ now: TimeInterval) {
    let s = MagnetSource.shared
    if let scene = UIApplication.shared.connectedScenes.first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene {
      s.orientation = scene.interfaceOrientation
    }
    let r = s.reading(now: now)
    sendEvent("onFrame", [
      "t": now * 1000,
      "pos": r.screenPosition.map { ["x": $0.x, "y": $0.y] },
      "spread": r.screenSpread,
      "height": r.height,
      "presence": r.presence,
      "pull": r.pull,
      "strength": r.strength,
      "delta": [r.delta.x, r.delta.y, r.delta.z],
      "toward": ["x": r.toward.dx, "y": r.toward.dy],
      "polarity": r.polarity,
      "distance": r.distance.isFinite ? r.distance : nil,
      "approachSpeed": r.approachSpeed,
      "tooClose": r.tooClose,
      "calibrating": r.calibrating,
      "zeroed": r.calibrated,
    ])
  }

  private static func gesture(_ g: MagnetGesture) -> [String: Any?] {
    switch g {
    case .tap(let at): return ["g": "tap", "at": at.map { ["x": $0.x, "y": $0.y] }]
    case .push(let speed): return ["g": "push", "speed": speed]
    case .pullAway(let speed): return ["g": "pullAway", "speed": speed]
    case .swipe(let d, let speed): return ["g": "swipe", "dir": ["x": d.dx, "y": d.dy], "speed": speed]
    }
  }
}

/// A display link with a closure (CADisplayLink needs an NSObject target).
private final class FrameTicker: NSObject {
  private var link: CADisplayLink?
  private let onFrame: (TimeInterval) -> Void

  init(_ onFrame: @escaping (TimeInterval) -> Void) {
    self.onFrame = onFrame
    super.init()
    let l = CADisplayLink(target: self, selector: #selector(step))
    l.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
    l.add(to: .main, forMode: .common)
    link = l
  }

  @objc private func step(_ l: CADisplayLink) { onFrame(l.timestamp) }

  func invalidate() {
    link?.invalidate()
    link = nil
  }
}
