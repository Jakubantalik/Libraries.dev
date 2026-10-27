# VoiceRingKit

A ring of light that listens: a few glassy rings bundled into one ribbon,
a conic spectrum running round it, bending with the voice and leaning
toward whoever speaks. The `aura` type of Voice orbs, as a library of its
own, in SwiftUI.

iOS 17+ / macOS 14+. Build through Xcode: the edge lens is a Metal shader,
compiled by Xcode's build system. Add `NSMicrophoneUsageDescription` to your
Info.plist. The code is MIT.

```swift
// Package.swift, or Xcode: File › Add Package Dependencies… (Branch: main)
.package(url: "https://github.com/Jakubantalik/Libraries.dev", branch: "main")
.product(name: "VoiceRingKit", package: "Libraries.dev")
```

## Usage

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

- `state`: `.idle`, `.listening` (follows the source), `.speaking`, `.processing`
  (sources ignored; the spectrum spins with its highlight running round).
- `source`: `.meter(meter)`, `.level { yourLevel }` (0–1, read every frame) or `.silence`.
- `style`: a `VoiceStyle` — `speed`, `sensitivity`, `threshold`, `release`,
  `idle`, `theme`, and the ring's own knobs in `opts`: `rings` (6), `lean`
  (0.91), `ringGap` (0.02), `deform` (1.45), `halo` (0.5), `radius` (0.56).
- `mood`: a `VoiceMood` (valence −1…1, arousal 0…1), or `emotion:` `.positive`,
  `.negative`, `.calm`. Shifts the spectrum toward its colour.
- `direction`: −1 left … 1 right. Left nil, the ring follows the meter's own
  stereo estimate while listening.

## Connect a model

**Emotion (emotion2vec+).** `VoiceRingEmotion` reads how the voice feels from
its tone (emotion2vec+ base) and its words (GoEmotions), as VoiceGlow Pro
does, and blends them into one mood:

```swift
import VoiceRingEmotion

@State private var emotion = EmotionListener()

VoiceRing(state: .listening, source: .meter(meter), mood: emotion.mood)
    .task {
        try? await meter.start()
        await emotion.start(meter: meter)
    }
```

The Core ML models are not in this package. They come with Voice Pro
(converted by voice-glow Pro's `swiftui/models/setup.sh`): add
`Emotion2Vec.mlpackage`, and for the words `TextEmotion.mlpackage` and the
`TextEmotionTokenizer` folder, to your app target. The words also need
`NSSpeechRecognitionUsageDescription`. emotion2vec+ is under the FunASR Model
Open Source License, roberta-base-go_emotions under MIT; credit both.

**Direction (Voice direction).** On iPhone the meter records in stereo, and
the Voice direction model (beta) reads which side the voice comes from,
with no calibration. It is trained and tested on an iPhone 15 Pro (upright and
flat on a desk) so far; on other iPhones, calibrate. Download `VoiceDirection.mfxl` from
[libraries.dev/voice-direction](https://libraries.dev/voice-direction.html)
(free account) and add it to your app target, then read the ring's meter
with `VoiceDirection` and pass the side in. Without the file,
`voice.calibrate(_:)` (a few seconds of voice from the left, ahead and the
right) does the same for the pose it was made in.

```swift
import VoiceRingKit
import VoiceDirectionKit

@State private var meter = VoiceMeter()
@State private var voice = VoiceDirection()

VoiceRing(state: .listening, source: .meter(meter), direction: voice.pan)
    .task { try? await voice.start(meter) }   // opens the meter in stereo
// voice.pan (−1…1), voice.side (.left / .ahead / .right), voice.probabilities
```

VoiceRingKit carries no direction code: everything the model needs — the
pose (hand or desk), the voice gate, the model file, the decision and the
calibration — lives in VoiceDirectionKit, which reads the meter's stereo
frames (`VoiceMeter.stereoFrame()`). Without it, `direction:` is whatever
you pass, and nil leans nowhere. Pass it only while listening: while the
assistant speaks, the mics hear the phone's own speaker
(`direction: state == .listening ? voice.pan : nil`).

The model is under the
[Libraries.dev Model License](../../../../../LICENSE-MODEL.md): free for
development, prototypes and non-commercial apps; shipping it in a commercial
app needs Pro or Business. Ship the file inside your app only, never in a
public repository.

## Tests

```bash
swift test
VOICE_DIRECTION_MODEL=/path/to/VoiceDirection.mfxl swift test   # also checks the model against training
```
