import SwiftUI
import VoiceGlowKit

/// The web demo's phone voice screen (sites/home voice page, Figma
/// 1561:44294): tap the mic and talk, and the glow follows your voice.
/// Agent (auto) opens the settings — the mood pad, palette and theme.
struct ContentView: View {
    // Launch arguments preset the screen for screenshots:
    // -mood happy|angry|sad|calm  -theme dark|light
    // -level 0.8 (hold the glow at a level instead of the demo voice)
    // -play /path/to/speech.aiff (loop a recording through the glow, as if spoken)
    private static let defaults = UserDefaults.standard
    private static let heldLevel = defaults.string(forKey: "level").flatMap(Double.init)

    @State private var meter = VoiceMeter()
    @State private var moodOn = defaults.string(forKey: "mood") != nil
    @State private var padMood: VoiceMood = {
        switch defaults.string(forKey: "mood") {
        case "angry": return .angry
        case "sad": return .sad
        case "calm": return .calm
        default: return .happy
        }
    }()
    @State private var variant: VoiceGlowColorVariant = .colorful
    @State private var theme = VoiceGlowTheme(rawValue: defaults.string(forKey: "theme") ?? "dark") ?? .dark
    @State private var micError: String?
    @State private var showSettings = false

    private var isDark: Bool { theme != .light }

    var body: some View {
        VoiceGlow(
            type: .mobile,
            meter: meter,
            // Until the microphone opens, the web demo's synthetic speech
            // envelope drives the glow, so it can be judged without talking.
            levelProvider: { Self.heldLevel ?? demoLevel(Date().timeIntervalSinceReferenceDate) },
            mood: moodOn ? padMood : nil,
            colorVariant: variant,
            theme: theme,
            cornerRadius: 55
        ) {
            PhoneScreen(
                dark: isDark,
                listening: meter.isRunning,
                status: micError,
                onAgent: { showSettings = true },
                onMic: toggleListening,
                onClose: { meter.stop() }
            )
        }
        .ignoresSafeArea()
        .preferredColorScheme(isDark ? .dark : .light)
        .task {
            if let path = Self.defaults.string(forKey: "play") {
                try? await meter.start(playing: URL(fileURLWithPath: path), loop: true)
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsSheet(moodOn: $moodOn, padMood: $padMood, variant: $variant, theme: $theme)
                .presentationDetents([.medium, .large])
                .presentationBackground(.thinMaterial)
        }
    }

    private func toggleListening() {
        if meter.isRunning {
            meter.stop()
            return
        }
        Task {
            do {
                try await meter.start()
                micError = nil
            } catch {
                micError = "The microphone is off — allow it in Settings."
            }
        }
    }
}

// MARK: - Phone screen

/// The web phone mock at 402×874: the prompt 194 pt above the bottom, the
/// Agent / mic / close row 49 pt above it.
private struct PhoneScreen: View {
    let dark: Bool
    let listening: Bool
    let status: String?
    let onAgent: () -> Void
    let onMic: () -> Void
    let onClose: () -> Void

    private var ink: Color { dark ? .white : .black }

    var body: some View {
        ZStack(alignment: .bottom) {
            (dark ? Color(white: 0x11 / 255) : Color.white).ignoresSafeArea()

            Text("How can I help you?")
                .font(.system(size: 21))
                .foregroundStyle(dark ? Color(white: 0xB2 / 255) : Color(white: 0x6B / 255))
                .multilineTextAlignment(.center)
                .padding(.horizontal, 36)
                .padding(.bottom, 194)

            if let status {
                Text(status)
                    .font(.footnote)
                    .foregroundStyle(ink.opacity(0.5))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 40)
                    .padding(.bottom, 120)
            }

            HStack {
                Button(action: onAgent) {
                    HStack(spacing: 4) {
                        Text("Agent (auto)").font(.system(size: 14, weight: .medium))
                        Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).opacity(0.4)
                    }
                    .foregroundStyle(ink.opacity(0.9))
                    .padding(.leading, 20).padding(.trailing, 16)
                    .frame(height: 44)
                    .background(ink.opacity(dark ? 0.08 : 0.05), in: Capsule())
                }
                Spacer()
                HStack(spacing: 18) {
                    CircleButton(systemName: listening ? "mic.fill" : "mic", active: listening, dark: dark, action: onMic)
                    CircleButton(systemName: "xmark", active: false, dark: dark, action: onClose)
                }
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 32)
            .padding(.bottom, 49)
        }
    }
}

private struct CircleButton: View {
    let systemName: String
    let active: Bool
    let dark: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(dark ? Color(white: 0xEF / 255) : Color(white: 0x20 / 255))
                .frame(width: 44, height: 44)
                .background((dark ? Color.white : Color.black).opacity(active ? 0.2 : (dark ? 0.08 : 0.05)), in: Circle())
                .contentTransition(.symbolEffect(.replace))
        }
    }
}

// MARK: - Settings

private struct SettingsSheet: View {
    @Binding var moodOn: Bool
    @Binding var padMood: VoiceMood
    @Binding var variant: VoiceGlowColorVariant
    @Binding var theme: VoiceGlowTheme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Toggle("Mood colour", isOn: $moodOn).font(.headline)
                if moodOn {
                    MoodPad(mood: $padMood)
                }
                Text("Emotion detection, the live transcript and the processing state are VoiceGlow Pro.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Divider()
                HStack {
                    Text("Palette")
                    Spacer()
                    Picker("Palette", selection: $variant) {
                        ForEach(VoiceGlowColorVariant.allCases, id: \.self) { Text($0.rawValue.capitalized).tag($0) }
                    }
                }
                Picker("Theme", selection: $theme) {
                    Text("Dark").tag(VoiceGlowTheme.dark)
                    Text("Light").tag(VoiceGlowTheme.light)
                }
                .pickerStyle(.segmented)
            }
            .padding(24)
        }
    }
}

/// The mood plane: drag to set valence (→) and arousal (↑).
private struct MoodPad: View {
    @Binding var mood: VoiceMood

    var body: some View {
        GeometryReader { geo in
            let s = geo.size
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(.quaternary.opacity(0.5))
                corner("Angry", .topLeading)
                corner("Happy", .topTrailing)
                corner("Sad", .bottomLeading)
                corner("Calm", .bottomTrailing)
                Circle()
                    .fill(.primary)
                    .frame(width: 22, height: 22)
                    .position(x: (mood.valence + 1) / 2 * s.width, y: (1 - mood.arousal) * s.height)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { g in
                mood = VoiceMood(
                    valence: Double(g.location.x / s.width) * 2 - 1,
                    arousal: 1 - Double(g.location.y / s.height),
                    confidence: 1
                )
            })
        }
        .aspectRatio(1.3, contentMode: .fit)
    }

    private func corner(_ text: String, _ alignment: Alignment) -> some View {
        Text(text).font(.caption.weight(.medium)).foregroundStyle(.secondary)
            .padding(12)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: alignment)
    }
}

/// The web demo's speech envelope (sites/home/src/examples/voice-mocks.tsx):
/// syllables riding words, a pause every nine seconds.
private func demoLevel(_ t: Double) -> Double {
    let phrase = t.truncatingRemainder(dividingBy: 9)
    if phrase > 6.6 { return 0 }
    let syllable = 0.5 + 0.5 * sin(t * .pi * 2 * 3.1)
    let word = 0.5 + 0.5 * sin(t * .pi * 2 * 0.55 + 1)
    let rough = 0.86 + 0.14 * sin(t * 23.7)
    return min(1, pow(syllable, 1.6) * (0.5 + 0.5 * word) * rough * 1.05)
}
