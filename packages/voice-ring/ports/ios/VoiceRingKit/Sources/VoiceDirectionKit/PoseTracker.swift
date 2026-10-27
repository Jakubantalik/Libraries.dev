// How the phone sits, from its motion sensors — the stereo image of the
// built-in mics differs between a phone in the hand and one lying on a
// desk, so each has its own direction path. Device motion needs no
// permission prompt.

import Foundation

/// How the phone sits while it listens.
public enum DevicePose: String, CaseIterable, Codable, Sendable {
    /// Held in the hand, in front of the user (or anything not flat and still).
    case hand
    /// Lying flat on a desk or table, screen up, bottom edge toward the user.
    case desk
}

#if os(iOS)
import CoreMotion

/// Flat and still for a second and a half reads as the desk; picked up or
/// moving for half a second, as the hand again.
@MainActor
final class PoseTracker {
    private let motion = CMMotionManager()
    private(set) var pose: DevicePose = .hand
    private var flatFor = 0.0, heldFor = 0.0

    static let interval = 0.1, settle = 1.5, lift = 0.5

    func start(_ changed: @escaping @MainActor (DevicePose) -> Void) {
        guard motion.isDeviceMotionAvailable, !motion.isDeviceMotionActive else { return }
        motion.deviceMotionUpdateInterval = Self.interval
        motion.startDeviceMotionUpdates(to: .main) { [weak self] m, _ in
            MainActor.assumeIsolated {
                guard let self, let m else { return }
                let a = m.userAcceleration
                let flat = abs(m.gravity.z) > 0.9
                let still = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot() < 0.03
                if flat && still {
                    self.flatFor += Self.interval
                    self.heldFor = 0
                } else {
                    self.heldFor += Self.interval
                    self.flatFor = 0
                }
                let next: DevicePose = self.pose == .hand
                    ? (self.flatFor >= Self.settle ? .desk : .hand)
                    : (self.heldFor >= Self.lift ? .hand : .desk)
                if next != self.pose {
                    self.pose = next
                    changed(next)
                }
            }
        }
    }

    func stop() {
        motion.stopDeviceMotionUpdates()
    }
}
#endif
