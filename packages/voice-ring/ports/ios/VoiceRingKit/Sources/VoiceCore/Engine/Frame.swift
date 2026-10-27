// The engine's contracts, ported one to one from the web build
// (src/engine/core.ts, types.ts): a frame is a finished list of draw
// instructions — strokes first, then z-sorted dots — and a type is a pure
// function of (size, t, voice, opts). Nothing here touches SwiftUI.

import Foundation

/// One dot, in points. `white` is the paper-theme ink (0 darkest); dark
/// substrates mirror it so near dots read bright.
public struct Dot: Sendable {
    public var x: Double
    public var y: Double
    public var z: Double
    public var r: Double
    public var white: Double
    public var a: Double

    public init(x: Double, y: Double, z: Double, r: Double, white: Double, a: Double = 1) {
        self.x = x
        self.y = y
        self.z = z
        self.r = r
        self.white = white
        self.a = a
    }
}

/// A polyline whose opacity varies point to point (depth fades the far side).
public struct Stroke: Sendable {
    /// Flat `[x0, y0, x1, y1, …]` in points.
    public var pts: [Double]
    /// Opacity per point.
    public var a: [Double]
    public var white: Double
    public var w: Double
    public var closed: Bool

    public init(pts: [Double], a: [Double], white: Double, w: Double, closed: Bool) {
        self.pts = pts
        self.a = a
        self.white = white
        self.w = w
        self.closed = closed
    }
}

/// How a luminous frame is lit — see `FrameLight` in the web core.
public struct FrameLight: Sendable {
    public struct Stop: Sendable {
        public var offset: Double
        public var r: Double
        public var g: Double
        public var b: Double

        public init(_ offset: Double, _ r: Double, _ g: Double, _ b: Double) {
            self.offset = offset
            self.r = r
            self.g = g
            self.b = b
        }
    }

    public struct Spec: Sendable {
        public var x: Double
        public var y: Double
        public var r: Double
        public var a: Double

        public init(x: Double, y: Double, r: Double, a: Double) {
            self.x = x
            self.y = y
            self.r = r
            self.a = a
        }
    }

    public var cx: Double
    public var cy: Double
    public var r: Double
    public var stops: [Stop]
    /// Radians clockwise from +x where the spectrum starts.
    public var angle: Double
    public var intensity: Double
    public var halo: Double
    public var spec: [Spec]
    public var fringe: Double

    public init(
        cx: Double, cy: Double, r: Double, stops: [Stop], angle: Double,
        intensity: Double, halo: Double, spec: [Spec], fringe: Double
    ) {
        self.cx = cx
        self.cy = cy
        self.r = r
        self.stops = stops
        self.angle = angle
        self.intensity = intensity
        self.halo = halo
        self.spec = spec
        self.fringe = fringe
    }
}

/// Where a leaning orb meets the screen's edge, and how hard it presses.
public struct OrbContact: Sendable {
    /// -1 the left edge, 1 the right.
    public var side: Double
    /// The edge: marks stop here.
    public var x: Double
    /// The stretch of the face that meets it, top and bottom.
    public var y0: Double
    public var y1: Double
    /// How deep into the orb the squash reaches.
    public var depth: Double
    /// 0 just touching … 1 pressing hard.
    public var press: Double
    /// The refraction into the edge, for the painter; none when it is off.
    public var lens: OrbLens?
}

/// The lens a pressing orb is refracted through, in points. A zone back
/// from the edge it begins; toward the edge it draws the image out across
/// the gap the orb rests short by, opens it taller by `flare`, parts red
/// from blue by `split` and blurs it by `blur`, each full at the edge.
public struct OrbLens: Sendable {
    public var zone: Double
    public var gap: Double
    public var flare: Double
    public var split: Double
    public var blur: Double
    /// The height the flare opens from.
    public var cy: Double
}

/// One rendered instant.
public struct OrbFrame: Sendable {
    public var dots: [Dot]
    public var strokes: [Stroke]
    public var light: FrameLight?
    /// Paint the dots as squares, `r` their half side: pixels, not points.
    public var square: Bool
    /// Set by the lean while the orb presses on the screen's edge.
    public var contact: OrbContact?

    public init(dots: [Dot] = [], strokes: [Stroke] = [], light: FrameLight? = nil, square: Bool = false) {
        self.dots = dots
        self.strokes = strokes
        self.light = light
        self.square = square
    }
}

/// Type knobs, numbers only, keyed as on the web (`radius`, `deform`, …).
public typealias TypeOpts = [String: Double]

extension Dictionary where Key == String, Value == Double {
    /// The knob `key`, or `fallback` when unset.
    @inlinable public func v(_ key: String, _ fallback: Double) -> Double { self[key] ?? fallback }
}

/// What the voice is doing at one instant, shaped and smoothed.
public struct VoiceInput: Sendable {
    public var level: Double = 0
    public var bands = SIMD3<Double>(0, 0, 0)
    public var soft: Double = 0
    public var softBands = SIMD3<Double>(0, 0, 0)
    public var spectrum = [Double](repeating: 0, count: VoiceFollower.spectrumCount)
    public var drive: Double = 0
    public var processing: Double = 0
    public var spin: Double = 0
    /// −1 left … 1 right, smoothed and gated by voice.
    public var pan: Double = 0

    public init() {}

    public static let silence = VoiceInput()
}

/// Geometry for one instant: `(size, t, voice, opts) → frame`.
public typealias TypeFrame = @Sendable (Double, Double, VoiceInput, TypeOpts) -> OrbFrame
