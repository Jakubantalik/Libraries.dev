# Voice ring

A voice-reactive ring of light for AI voice interfaces: a few rings lean off the view axis and bundle into a glassy ribbon, a spectrum runs around it, and the voice bends every ring together. It takes the colour of the voice's emotion and leans toward whoever is speaking.

Voice ring is the `aura` type of the voice orbs, as a library of its own.

## SwiftUI (shipped)

The port lives in [`ports/ios/VoiceRingKit`](ports/ios/VoiceRingKit) and installs from the repository root with Swift Package Manager (iOS 17+ / macOS 14+, build through Xcode):

```swift
.package(url: "https://github.com/Jakubantalik/Libraries.dev", branch: "main")
.product(name: "VoiceRingKit", package: "Libraries.dev")
```

```swift
import VoiceRingKit

struct VoiceScreen: View {
    @State private var meter = VoiceMeter()

    var body: some View {
        VoiceRing(state: .listening, source: .meter(meter), size: 240)
            .task { try? await meter.start() }   // asks for the microphone
    }
}
```

Two models plug in:

- **Emotion** (`VoiceRingEmotion`, Pro): emotion2vec+ reads the tone of the voice, GoEmotions its words; pass `mood: emotion.mood`.
- **Direction** ([Voice direction](https://libraries.dev/voice-direction.html), free account): add `VoiceDirection.mfxl` to the app target and the ring leans toward the voice from the iPhone's stereo mics, no calibration.

Docs: https://libraries.dev/voice-ring.html

## Web (preview only)

`src/` is the web engine (plain 2D canvas, no WebGL) behind the site's preview and the Studio bench. It is a workspace package (`voice-ring`, private) consumed from source; the React package is not published yet.

```tsx
import { VoiceRing } from 'voice-ring';

<VoiceRing size={240} state="listening" level={() => meter.current} direction={0.4} emotion="calm" />
```

The engine is copied from the voice orbs project (`Voice orbs/src`); keep the two in step.

MIT License.
