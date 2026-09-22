import SwiftUI
import MetalFxKit

/// The metal-fx v2 demo page's cards, on the phone: the composer with its
/// send button (reflecting onto the Auto chip), "Plan Pro", "Live mode · New",
/// and a button parked at the screen edge for the edge halo. Tilt the phone
/// to bend the rings; in the Simulator, drag the tilt pad.
struct ContentView: View {
    @State private var strength = 0.9
    @State private var preset: MetalPreset = .chromatic
    @State private var pad: CGVector = .zero
    @State private var holdTilt = false
    @State private var glowGain = 1.0
    /// Launch arguments for headless checks: `-focus edge -holdTilt YES -glowGain 2`.
    @State private var focus = UserDefaults.standard.string(forKey: "focus") ?? "all"

    private let page = Color(hex: 0x0F0F0F)
    private let card = Color(hex: 0x171717)
    private let composer = Color(hex: 0x1D1D1D)
    private let chip = Color(hex: 0x262626)
    private let secondary = Color(hex: 0x999999)

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if focus == "edge" {
                    edgeCard
                    controls
                } else if focus == "composer" {
                    composerCard
                    controls
                } else {
                    header
                    composerCard
                    planProCard
                    liveModeCard
                    edgeCard
                    controls
                }
                Spacer(minLength: 24)
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
        }
        .background(page.ignoresSafeArea())
        .onAppear {
            let d = UserDefaults.standard
            if d.object(forKey: "glowGain") != nil { glowGain = d.double(forKey: "glowGain") }
            if d.bool(forKey: "holdTilt") { holdTilt = true; MetalTiltSource.shared.override = CGVector(dx: 0.45, dy: 0.3) }
            if d.bool(forKey: "haloDebug") { MetalEdgeHaloDebug.enabled = true }
        }
    }

    private var header: some View {
        VStack(spacing: 6) {
            Text("Liquid metal").font(.system(size: 28, weight: .semibold)).foregroundStyle(.white)
            Text("metal-fx v2 · SwiftUI").font(.system(size: 15)).foregroundStyle(secondary)
        }
        .padding(.vertical, 24)
    }

    private var composerCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Build anything...")
                .font(.system(size: 14))
                .foregroundStyle(Color(hex: 0x6B6B6B))
                .padding(.bottom, 16)
            HStack(spacing: 12) {
                Circle().fill(chip).frame(width: 36, height: 36)
                    .overlay { Image(systemName: "plus").font(.system(size: 14, weight: .medium)).foregroundStyle(.white) }
                Spacer()
                chipView("Agent")
                chipView("Auto")
                    .metalReflection(of: "send")
                MetalFx(variant: .circle, preset: preset, theme: .dark, strength: strength, innerShadow: true, glowGain: glowGain, id: "send") {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(Color(hex: 0xF8F8F8))
                        .frame(width: 40, height: 40)
                }
            }
        }
        .padding(EdgeInsets(top: 20, leading: 16, bottom: 16, trailing: 16))
        .background(composer, in: RoundedRectangle(cornerRadius: 20))
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
        .frame(height: 260)
        .background(card, in: RoundedRectangle(cornerRadius: 30))
    }

    private func chipView(_ label: String) -> some View {
        HStack(spacing: 4) {
            Text(label).font(.system(size: 12)).foregroundStyle(Color(hex: 0xF8F8F8))
            Image(systemName: "chevron.down").font(.system(size: 9, weight: .semibold)).foregroundStyle(Color(hex: 0x8A8A8A))
        }
        .padding(.leading, 14).padding(.trailing, 10)
        .frame(height: 36)
        .background(chip, in: Capsule())
    }

    private var planProCard: some View {
        HStack(alignment: .lastTextBaseline, spacing: 6) {
            Text("Plan")
                .font(.system(size: 24, weight: .medium))
                .foregroundStyle(secondary.opacity(0.6))
                .metalReflection(of: "pro", strength: 0.64, style: .glyphs)
            MetalText("Pro", font: .system(size: 24, weight: .medium), preset: preset, theme: .dark, strength: strength, id: "pro")
        }
        .frame(maxWidth: .infinity)
        .frame(height: 170)
        .background(card, in: RoundedRectangle(cornerRadius: 36))
    }

    private var liveModeCard: some View {
        HStack(spacing: 12) {
            Text("Live mode").font(.system(size: 20)).foregroundStyle(secondary)
            MetalBadge("New", preset: preset, theme: .dark, strength: strength)
        }
        .frame(maxWidth: .infinity)
        .frame(height: 170)
        .background(card, in: RoundedRectangle(cornerRadius: 36))
    }

    /// A ring parked against the right edge of the screen.
    private var edgeCard: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Edge halo").font(.system(size: 17, weight: .medium)).foregroundStyle(.white)
                Text("Light leaves through the glass edge").font(.system(size: 13)).foregroundStyle(secondary)
            }
            Spacer()
            MetalFx(variant: .circle, preset: preset, theme: .dark, strength: strength, innerShadow: true, id: "edge") {
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(Color(hex: 0xF8F8F8))
                    .frame(width: 40, height: 40)
            }
            .padding(.trailing, -4)
        }
        .padding(.leading, 24)
        .frame(maxWidth: .infinity)
        .frame(height: 120)
        .background(card, in: RoundedRectangle(cornerRadius: 30))
        .padding(.trailing, -12)
        // The card touches the screen edge, so it hosts the halo.
        .metalEdgeHalo()
    }

    private var controls: some View {
        VStack(spacing: 14) {
            HStack(spacing: 12) {
                Text("Button").font(.system(size: 13)).foregroundStyle(secondary)
                Spacer()
                MetalFx(variant: .button, preset: preset, theme: .dark, strength: strength * 0.7, id: "pill") {
                    Text("Upgrade to Pro")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color(hex: 0xF8F8F8))
                        .padding(.horizontal, 18)
                        .frame(height: 40)
                }
            }
            Picker("Color", selection: $preset) {
                ForEach(MetalPreset.allCases) { p in Text(p.rawValue.capitalized).tag(p) }
            }
            .pickerStyle(.segmented)
            HStack {
                Text("Strength").font(.system(size: 13)).foregroundStyle(secondary)
                Slider(value: $strength, in: 0...1)
                Text("\(Int(strength * 100))%").font(.system(size: 13, design: .monospaced)).foregroundStyle(secondary).frame(width: 44)
            }
            HStack {
                Text("Glow").font(.system(size: 13)).foregroundStyle(secondary)
                Slider(value: $glowGain, in: 0...4)
                Text(String(format: "%.1f×", glowGain)).font(.system(size: 13, design: .monospaced)).foregroundStyle(secondary).frame(width: 44)
            }
            Toggle(isOn: $holdTilt) {
                Text("Hold a tilt (simulator)").font(.system(size: 13)).foregroundStyle(secondary)
            }
            .onChange(of: holdTilt) { _, on in MetalTiltSource.shared.override = on ? CGVector(dx: 0.45, dy: 0.3) : nil }
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Tilt pad").font(.system(size: 13)).foregroundStyle(.white)
                    Text("Drag to bend the rings by hand (the phone's tilt drives it otherwise).")
                        .font(.system(size: 12)).foregroundStyle(secondary)
                }
                Spacer()
                tiltPad
            }
        }
        .padding(16)
        .background(card, in: RoundedRectangle(cornerRadius: 20))
    }

    private var tiltPad: some View {
        let size: CGFloat = 96
        return ZStack {
            Circle().fill(chip)
            Circle().stroke(Color.white.opacity(0.08))
            Circle().fill(.white.opacity(0.8)).frame(width: 14, height: 14)
                .offset(x: pad.dx * size / 2, y: pad.dy * size / 2)
        }
        .frame(width: size, height: size)
        .gesture(
            DragGesture(minimumDistance: 0)
                .onChanged { v in
                    let dx = max(-1, min(1, v.location.x / size * 2 - 1))
                    let dy = max(-1, min(1, v.location.y / size * 2 - 1))
                    pad = CGVector(dx: dx, dy: dy)
                    MetalTiltSource.shared.override = CGVector(dx: dx * 0.6, dy: dy * 0.6)
                }
                .onEnded { _ in
                    pad = .zero
                    MetalTiltSource.shared.override = holdTilt ? CGVector(dx: 0.45, dy: 0.3) : nil
                }
        )
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 0xff) / 255, green: Double((hex >> 8) & 0xff) / 255, blue: Double(hex & 0xff) / 255)
    }
}
