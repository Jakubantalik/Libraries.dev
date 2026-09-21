import Foundation

/// One time base for every instance, so rings, reflections and halos on the
/// same screen show the same frame of the material.
enum MetalClock {
    static let start = Date().timeIntervalSinceReferenceDate
    static func seconds(_ now: TimeInterval) -> Double { now - start }
}

/// Per-instance pause: freezes the material on the frame it was paused on and
/// resumes from there.
final class MetalInstanceClock {
    private var pausedAt: TimeInterval?
    private var pausedTotal: TimeInterval = 0

    func setPaused(_ paused: Bool, now: TimeInterval) {
        if paused, pausedAt == nil { pausedAt = now }
        if !paused, let p = pausedAt { pausedTotal += now - p; pausedAt = nil }
    }

    /// Material time in seconds (before the preset's speed multiplier).
    func time(now: TimeInterval) -> Double {
        let effective = pausedAt ?? now
        return MetalClock.seconds(effective) - pausedTotal
    }
}
