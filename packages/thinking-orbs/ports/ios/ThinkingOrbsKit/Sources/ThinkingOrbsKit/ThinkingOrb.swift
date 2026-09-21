// The SwiftUI ThinkingOrb.
//
// TimelineView(.animation) drives the clock and Canvas does the drawing —
// no timers, no Metal, no CADisplayLink to tear down. SwiftUI stops
// servicing a TimelineView that is off-screen, which is the equivalent of
// the web build's IntersectionObserver pause and comes for free.

import SwiftUI

/// Theme mode. `.auto` follows the environment's colour scheme.
public enum OrbTheme: Sendable {
    case auto, dark, light
}

@available(iOS 15.0, macOS 12.0, *)
public struct ThinkingOrb: View {
    private let state: OrbState
    private let size: OrbSize
    private let theme: OrbTheme
    private let speed: Double
    private let paused: Bool
    private let displaySize: Double?

    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    // ImageRenderer never advances a TimelineView, so snapshot.sh injects a
    // fixed instant here to capture a deterministic frame.
    @Environment(\.orbFrozenTime) private var frozenTime

    /// `displaySize` renders the orb at an arbitrary point size while keeping
    /// the tuned `size` preset's geometry — the drawing is scaled inside the
    /// Canvas, so it stays vector-crisp at any factor (a `scaleEffect` would
    /// rasterise the layer first). Mirrors the React Native port's prop.
    public init(
        state: OrbState = .working,
        size: OrbSize = .px64,
        theme: OrbTheme = .auto,
        speed: Double = 1,
        paused: Bool = false,
        displaySize: Double? = nil
    ) {
        self.state = state
        self.size = size
        self.theme = theme
        self.speed = speed
        self.paused = paused
        self.displaySize = displaySize
    }

    private var isDark: Bool {
        switch theme {
        case .dark: return true
        case .light: return false
        case .auto: return colorScheme == .dark
        }
    }

    public var body: some View {
        let preset = resolvePreset(state, size)
        let effSpeed = preset.speed * speed
        let side = displaySize ?? size.value

        Group {
            if let frozenTime {
                // Raw engine time, NOT scaled by speed: the golden vectors and
                // the web parity harness both evaluate the engine at this t
                // directly, so applying the preset speed here would compare
                // two different instants and report a false mismatch.
                canvas(preset: preset, t: frozenTime)
            } else if reduceMotion || paused {
                // one static, deterministic frame — same instant as the web
                canvas(preset: preset, t: OrbSpec.reducedMotionT)
            } else {
                TimelineView(.animation(paused: paused)) { timeline in
                    // One shared clock, so several orbs on screen stay in
                    // phase exactly as they do on the web.
                    let t = timeline.date.timeIntervalSinceReferenceDate * effSpeed
                    canvas(preset: preset, t: t)
                }
            }
        }
        .frame(width: side, height: side)
        .accessibilityElement()
        .accessibilityLabel(state.label)
        .accessibilityAddTraits(.isImage)
    }

    @ViewBuilder
    private func canvas(preset: ResolvedPreset, t: Double) -> some View {
        Canvas(rendersAsynchronously: false) { context, _ in
            var context = context
            let zoom = (displaySize ?? size.value) / size.value
            if zoom != 1 { context.scaleBy(x: zoom, y: zoom) }
            let frame = orbFrame(preset, size: size.value, t: t)
            // lines first, so nodes sit on top of their edges
            for l in frame.lines {
                var path = Path()
                path.move(to: CGPoint(x: l.x1, y: l.y1))
                path.addLine(to: CGPoint(x: l.x2, y: l.y2))
                context.stroke(
                    path,
                    with: .color(ink(l.white, l.a)),
                    lineWidth: l.w
                )
            }
            // dots are already z-sorted into draw order by the engine
            for d in frame.dots {
                let rect = CGRect(x: d.x - d.r, y: d.y - d.r, width: d.r * 2, height: d.r * 2)
                context.fill(Path(ellipseIn: rect), with: .color(ink(d.white, d.a)))
            }
        }
    }

    /// Quantise to 8-bit exactly as the canvas painter does, so the platforms
    /// land on identical greys rather than merely close ones.
    private func ink(_ white: Double, _ alpha: Double) -> Color {
        let w = Swift.min(1, Swift.max(0, white))
        let g = ((isDark ? 1 - w : w) * 255).rounded(.toNearestOrAwayFromZero) / 255
        return Color(.sRGB, red: g, green: g, blue: g, opacity: alpha)
    }
}

// MARK: - Frozen time (snapshot testing)

private struct OrbFrozenTimeKey: EnvironmentKey {
    static let defaultValue: Double? = nil
}

extension EnvironmentValues {
    /// Pins the animation to a fixed instant. Used by the snapshot harness;
    /// `ImageRenderer` does not fire `onAppear` or advance `TimelineView`,
    /// so without this every capture would render the same t=0 frame.
    var orbFrozenTime: Double? {
        get { self[OrbFrozenTimeKey.self] }
        set { self[OrbFrozenTimeKey.self] = newValue }
    }
}

@available(iOS 15.0, macOS 12.0, *)
extension View {
    /// Freeze every ThinkingOrb below this view at `t` seconds.
    public func orbFrozenTime(_ t: Double?) -> some View {
        environment(\.orbFrozenTime, t)
    }
}
