import SwiftUI
import MetalFxKit
import MagnetKit

/// The Continue button demo (Figma Portfolio "iPhone 16 & 17 Pro - 13"): an email
/// pill and a round arrow button at the bottom of a dark page. The arrow
/// button is a metal-fx ring that bends toward a magnet near the phone (or
/// a finger), with the desktop hover bend. Settings and calibration live
/// behind the gear at the top right.
///
/// Launch with `-focus email`.
struct MagnetEmailView: View {
    var onClose: (() -> Void)? = nil

    @ObservedObject private var settings = MagnetSettings.shared
    @State private var email = ""
    @State private var showSettings = false
    @State private var training = false
    @State private var sent = false
    @State private var pressed = false
    @ObservedObject private var gestures = MagnetGestureFeed.shared
    /// The arrow's centre in global points — training is laid out around it.
    @State private var arrowCenter: CGPoint = .zero
    @FocusState private var emailFocused: Bool

    private let page = Color(hex: 0x191919)
    /// rgba(255,255,255,0.08) over the page.
    private let surface = Color(hex: 0x2B2B2B)
    private let placeholder = Color(hex: 0xCACCD2)

    var body: some View {
        // Every metal ring in here reflects onto the surfaces around it.
        MetalReflectionScope(strength: 1.8) {
            ZStack {
                page.ignoresSafeArea()
                    .onTapGesture { emailFocused = false }
                VStack {
                    Spacer()
                    HStack(spacing: 16) {
                        emailField
                        arrowButton
                    }
                    .padding(.horizontal, 30)
                    .padding(.bottom, 8)
                }
            }
        }
        .overlay {
            if training {
                MagnetTrainingOverlay(layout: arrowCenter == .zero ? .screen : .around(arrowCenter), onDone: { training = false })
                    .transition(.opacity)
            }
        }
        .overlay(alignment: .top) { topBar }
        .modifier(PointerTracking(on: settings.drive == .touch))
        .sheet(isPresented: $showSettings) {
            MagnetSettingsSheet(onTrain: {
                // Let the sheet go before the markers appear.
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.45) { withAnimation { training = true } }
            })
            .presentationDetents([.medium, .large])
        }
        .onChange(of: gestures.seq) { _, _ in react(gestures.last) }
        .onAppear {
            settings.apply(); MagnetLogger.shared.start()
            if UserDefaults.standard.bool(forKey: "reflDebug") { MetalReflectionDebug.enabled = true }
        }
        .onDisappear { MetalPointerSource.shared.location = nil; MagnetLogger.shared.stop() }
    }

    private var topBar: some View {
        HStack(alignment: .top) {
            if let onClose {
                Button(action: onClose) { Image(systemName: "xmark") }
                    .accessibilityLabel("Close")
            }
            MagnetCompass()
            Spacer()
            Button { showSettings = true } label: { Image(systemName: "gearshape") }
                .accessibilityLabel("Settings")
        }
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(.white)
        .buttonStyle(.bordered)
        .buttonBorderShape(.circle)
        .controlSize(.large)
        .tint(.white)
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .opacity(training ? 0 : 1)
    }

    private var emailField: some View {
        // Figma: Inter Regular 15, #CACCD2 at 50 % (system font here).
        TextField("", text: $email, prompt: Text("Your email").foregroundStyle(placeholder.opacity(0.5)))
            .font(.system(size: 15))
            .foregroundStyle(.white)
            .keyboardType(.emailAddress)
            .textContentType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.send)
            .focused($emailFocused)
            .onSubmit(send)
            .padding(.leading, 20)
            .padding(.trailing, 16)
            .frame(height: 52)
            .frame(maxWidth: .infinity)
            .background(surface, in: Capsule())
            .overlay { GlassEdge() }
            .shadow(color: .black.opacity(0.04), radius: 3, y: 2)
    }

    private var arrowButton: some View {
        Button(action: send) {
            MetalFx(variant: .circle, preset: .chromatic, theme: .dark, strength: 0.9, innerShadow: true,
                    source: settings.drive == .touch ? .pointer : .magnet,
                    bendConfig: settings.bendConfig(scale: 1.3),
                    fill: surface, id: "email-arrow") {
                Image(systemName: sent ? "checkmark" : "arrow.right")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(.white)
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 52, height: 52)
            }
        }
        .buttonStyle(.plain)
        .scaleEffect(pressed ? 0.88 : 1)
        .animation(.spring(response: 0.22, dampingFraction: 0.55), value: pressed)
        .accessibilityLabel("Continue")
        .background {
            GeometryReader { g in
                Color.clear.onChange(of: g.frame(in: .global), initial: true) { _, f in
                    arrowCenter = CGPoint(x: f.midX, y: f.midY)
                }
            }
        }
    }

    /// Quick magnet moves: a push presses the arrow, a tap "sends", a pull-away lets go.
    private func react(_ g: MagnetGesture?) {
        guard let g else { return }
        switch g {
        case .push:
            pressed = true
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) { pressed = false }
        case .tap:
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            withAnimation { sent = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) { withAnimation { sent = false } }
        case .pullAway:
            pressed = false
            UIImpactFeedbackGenerator(style: .soft).impactOccurred(intensity: 0.6)
        case .swipe:
            break
        }
    }

    private func send() {
        emailFocused = false
        guard !email.isEmpty else { return }
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        withAnimation { sent = true }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { withAnimation { sent = false } }
    }
}

/// The pill's glassy inner edge: a hairline of light along the top and bottom.
private struct GlassEdge: View {
    var body: some View {
        Capsule()
            .strokeBorder(
                LinearGradient(stops: [
                    .init(color: .white.opacity(0.22), location: 0),
                    .init(color: .white.opacity(0.02), location: 0.35),
                    .init(color: .white.opacity(0.02), location: 0.65),
                    .init(color: .white.opacity(0.14), location: 1),
                ], startPoint: .top, endPoint: .bottom),
                lineWidth: 1
            )
            .allowsHitTesting(false)
    }
}

private struct PointerTracking: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.metalPointerTracking() } else { content }
    }
}
