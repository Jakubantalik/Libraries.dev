import SwiftUI
import Observation

/// One canvas for every avatar inside it. A `BotAvatar` on its own draws
/// into a canvas of its own — a layer Core Animation renders separately
/// every frame. On a screen with a roster of them the per-layer cost adds
/// up (on the Simulator's Metal bridge it dominates), so a stage lets the
/// avatars inside keep their layout, gestures and props while a single
/// overlay canvas draws all of them in one pass. Wrap the container:
///
/// ```swift
/// BotAvatarStage {
///     LazyVGrid(columns: columns) { ForEach(agents) { BotAvatar(type: $0.type) } }
/// }
/// ```
public struct BotAvatarStage<Content: View>: View {
    private let content: Content
    @State private var stage = BotAvatarStageModel()

    public init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    public var body: some View {
        content
            .coordinateSpace(name: stage.spaceName)
            .overlay {
                GeometryReader { g in
                    let pad = stage.pad
                    StageCanvas(stage: stage, pad: pad)
                        .frame(width: g.size.width + 2 * pad, height: g.size.height + 2 * pad)
                        .offset(x: -pad, y: -pad)
                        .allowsHitTesting(false)
                }
            }
            .environment(\.botAvatarStage, stage)
    }
}

/// The stage's members, in the order they arrived, with their frames in
/// the stage's coordinate space.
@Observable
final class BotAvatarStageModel {
    let spaceName = "bot-avatar-stage-\(UUID().uuidString)"
    /// how far the canvas reaches beyond the container: a hop needs room
    /// above the box; the overscan takes a quarter of the size each side
    private(set) var pad: Double = 32
    @ObservationIgnored private(set) var members: [(model: BotAvatarModel, frame: CGRect)] = []

    func register(_ model: BotAvatarModel, frame: CGRect) {
        if let i = members.firstIndex(where: { $0.model === model }) {
            members[i].frame = frame
        } else {
            members.append((model, frame))
        }
        let w = Double(frame.width)
        let want = max(32.0, (w * (BOT_AVATAR_OVERSCAN - 1) / 2 + BOT_AVATAR_RISE * w + 8).rounded(.up))
        if want > pad { pad = want }
    }
    func unregister(_ model: BotAvatarModel) {
        members.removeAll { $0.model === model }
    }
}

private struct StageCanvas: View {
    let stage: BotAvatarStageModel
    let pad: Double
    var body: some View {
        let frame = BotAvatarClock.shared.frame
        Canvas(opaque: false, colorMode: .nonLinear, rendersAsynchronously: false) { ctx, _ in
            for m in stage.members {
                let size = Double(m.frame.width)
                let side = size * (BOT_AVATAR_OVERSCAN - 1) / 2
                var c = ctx
                c.translateBy(x: pad + Double(m.frame.minX) - side, y: pad + Double(m.frame.minY) - side - BOT_AVATAR_RISE * size)
                let full = size * BOT_AVATAR_OVERSCAN
                m.model.draw(&c, size: CGSize(width: full, height: full), frame: frame)
            }
        }
    }
}

private struct BotAvatarStageKey: EnvironmentKey {
    static let defaultValue: BotAvatarStageModel? = nil
}
extension EnvironmentValues {
    var botAvatarStage: BotAvatarStageModel? {
        get { self[BotAvatarStageKey.self] }
        set { self[BotAvatarStageKey.self] = newValue }
    }
}
