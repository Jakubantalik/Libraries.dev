# Voice ring

A voice-reactive ring of light for AI voice interfaces: a few rings lean off the view axis and bundle into a glassy ribbon, a spectrum runs around it, and the voice bends every ring together. It takes the colour of the voice's emotion and leans toward whoever is speaking.

Voice ring is the two aura types of the voice orbs, as a library of their own: `ring`, the default, and `mono`, two loops of grey tube that a voice opens into a turning globe, an emotion colouring the tube. Choose with `type="mono"` in React and `VoiceRing(.mono, …)` in SwiftUI.

## SwiftUI

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
- **Direction** ([Voice position](https://libraries.dev/voice-position.html), free account): add `VoicePosition.mfxl` to the app target and the ring leans toward the voice from the iPhone's stereo mics, no calibration.

Docs: https://libraries.dev/voice-ring.html

## React

```bash
npm install voice-ring
```

```tsx
import { VoiceRing, useMicrophone } from 'voice-ring';

function VoiceScreen() {
  const mic = useMicrophone();
  return (
    <>
      <VoiceRing size={240} state="listening" stream={mic.stream} />
      <button onClick={mic.start}>Listen</button>
    </>
  );
}

// Drive it yourself instead of the microphone (0–1, read every frame):
<VoiceRing size={240} state="speaking" level={() => player.level} />
```

- `state`: `idle`, `listening`, `speaking`, `processing`.
- `stream` (a `MediaStream`) or `level` (a number, or a getter read every frame).
- `emotion`: `positive`, `negative` or `calm` shifts the spectrum toward its colour.
- `direction`: −1 left … 1 right, a number or a getter. A browser microphone is mono, so the side comes from you: a stereo capture, a diarised speaker, or where that person sits in your UI. The ring barely drifts but leans toward it, and meets the screen's edge through a soft lens; the `direction…` props tune it.
- `hoverBend`: while the ring waits or works (`idle`, `processing`), it bends toward the cursor as it nears the rim, like a membrane, easing in and out. `true` bends at 0.55; a number 0–1 sets the strength. Desktop only (a fine pointer that hovers), and off with reduced motion.
- `sensitivity` (0.85), `speed`, `theme` (`auto`, `dark`, `light`), `paused`.

A 2D canvas with a small WebGL pass for the edge lens; React 18+.

`src/` is also what the libraries.dev preview and Studio draw. The engine is copied from the voice orbs project (`Voice orbs/src`); keep the two in step.

MIT License.
