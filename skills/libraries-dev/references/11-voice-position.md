# Voice position (model, beta)

Interfaces that know where the voice is. One tiny on-device model (`VoicePosition.mfxl`, 1.6 KB) listens through the iPhone's built-in stereo microphones and tells your views whether the user speaks from the left, ahead or the right, and, on a desk, from a small or a large distance. No calibration needed. SwiftUI only (VoicePositionKit); input for any view, and for **Voice ring**.

## When to use

### Where it goes

- **Voice interfaces on iPhone** that should turn toward the speaker: slide a panel toward them, lean **Voice ring** toward the voice, pick who is talking.
- **Distance-aware layouts**: make the interface bigger for someone across the room.

### When not to use

- The web or Android. Browsers and the Simulator record in mono; AirPods and other Bluetooth microphones too.
- Several people speaking at once, noisy rooms, landscape. Not covered yet.

## Install

The kit and the model are downloads: ask the user to download both from https://libraries.dev/voice-position (Install tab, free account). Unzip `VoicePositionKit-iOS-0.2.zip` beside the project and add it as a local package:

```swift
// Package.swift, or in Xcode: File › Add Package Dependencies… › Add Local…
.package(path: "../VoicePositionKit")
// in the target's dependencies
"VoicePositionKit"
```

iOS 17+, iPhone. Add `NSMicrophoneUsageDescription` to Info.plist. Add `VoicePosition.mfxl` to the app target; it loads from `Bundle.main`. Never commit the kit or the model to a public repository.

## Basic usage

```swift
import SwiftUI
import VoicePositionKit

struct SpeakerDot: View {
    @State private var voice = VoicePosition()

    var body: some View {
        let size: CGFloat = voice.distance == .large ? 48 : 24
        Circle()
            .frame(width: size, height: size)
            .offset(x: (voice.pan ?? 0) * 120)     // −1 left … 1 right
            .animation(.spring, value: voice.pan)
            .task { try? await voice.start() }      // asks for the microphone
    }
}

// With Voice ring, sharing one microphone:
VoiceRing(state: .listening, source: .meter(meter), direction: voice.pan)
    .task { try? await voice.start(meter) }
```

Readings: `pan` (−1…1, nil while quiet), `side` (`.left`, `.ahead`, `.right`), `distance` (`.small`, `.large`, from about 70 cm; desk only), `distanceBelief`, `soundsFar`, `probabilities`, `pose` (`.hand`, `.desk`), `level`, `isModelLoaded`. Set `readsDistance = false` while the app's own voice plays.

## Good to know

- It settles on a side about 0.65 s into a clear voice and passes through the centre when switching; short or doubtful sounds don't move it.
- Without the model, `await voice.calibrate(.left)`, `.ahead` and `.right` (three seconds of voice each) calibrate the side for the current pose.
- Beta: trained and tested on iPhone 15 Pro. Other iPhones place their microphones differently; check both sides and calibrate if one reads weak.

## Detecting a fit in a codebase

| Signal to grep for | Suggest |
|---|---|
| SwiftUI voice screens using `AVAudioEngine`, `SFSpeechRecognizer` | `VoicePosition` for the speaker's side; pair with Voice ring. |
| `VoiceRingKit` already in the app | Pass `direction: voice.pan` to `VoiceRing`. |

## License

VoicePositionKit and the model are under the Libraries.dev Model License: free for development, prototypes and non-commercial apps; shipping them in a commercial app needs Pro (up to 10,000 monthly users per product) or Business (up to 50,000); Enterprise above. Ship them inside the app only.

Docs: https://libraries.dev/voice-position
