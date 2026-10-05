# VoiceGlowKit

SwiftUI port of [`voice-glow`](../../../README.md): a centred, colourful
glow along the bottom edge of a view that rises and blooms with a voice —
and a `mood` input that tints it with how the voice feels: happy green,
calm teal, and red for anything negative.

iOS 17+ / macOS 14+, rendered with SwiftUI Metal shaders. Free and open
source, like the web library.

> Status: the `glow` look in the three types (`standard`, `pill`, `mobile`) ×
> eight palettes × dark/light, bands, flow, bend and the band line. Not yet
> ported: the distortion warp under the band, and the `dots` / `lines` looks.

**VoiceGlow Pro** ([libraries.dev](https://libraries.dev) Pro and Business)
builds on this package with on-device **emotion detection** (from the tone of
the voice and from the words), the **live transcript** animation, and the
**processing** state.

## Usage

```swift
import VoiceGlowKit

struct VoiceScreen: View {
    @State private var meter = VoiceMeter()

    var body: some View {
        VoiceGlow(type: .mobile, meter: meter, cornerRadius: 55) {
            Conversation()
        }
        .task { try? await meter.start() }   // asks for the microphone
    }
}
```

Drive it yourself instead of the microphone:

```swift
VoiceGlow(level: speaking ? 0.8 : 0) { Card() }
// or every frame without re-rendering your view:
VoiceGlow(levelProvider: { player.meter }) { Card() }
```

`VoiceMeter` reads the microphone the way the web `AnalyserNode` does (the
same window, FFT, smoothing and voice bands), so the two react alike. It can
also loop a file through the glow (`start(playing:)`), hand its buffers to a
speech recogniser (`addBufferHandler`), and give the recent audio to a model
(`recentSamples(seconds:)`).

### Mood

Pass any mood — from a slider, a server, your own model:

```swift
VoiceGlow(meter: meter, mood: VoiceMood(valence: 0.8, arousal: 0.7)) { … }
```

`VoiceMood(valence:arousal:confidence:)` — valence −1…1 (negative…positive),
arousal 0…1 (calm…excited), confidence 0…1. The glow eases into the mood
palette in proportion to the confidence (`options.moodSmoothing`, 0.3 s) and
back to its own palette when the confidence drops (`options.moodRelease`,
0.8 s). Below 15% confidence it keeps its palette.

The colours are four seven-colour palettes at the corners of the mood plane,
blended in OKLab:

```
 arousal 1   angry ──────── happy
               │              │
 arousal 0    sad  ──────── calm
           valence −1     valence +1
```

Anything below −0.35 valence is fully the red side (angry a hot red, sad a
deeper crimson); above +0.35 fully the green / teal side. Replace them with
`options.moodPalette`. The band line's colour fringes take the mood too.

### Motion

`motion:` takes a per-frame `VoiceGlowMotion` — how far the lobes are
gathered into one beam, where it sits, the level it is held at. At rest
(the default) the glow is the voice glow. VoiceGlow Pro's processing state
drives it.

### Options

`VoiceGlowOptions` mirrors the web props: `sensitivity`, `threshold`,
`attack`, `release`, `idle`, `bands`, `scale`, `reach`, `spread`, `flow`,
`bend`, `bandStrength`, `bandWidth`, `brightness`, `saturation`, `strength`,
`hueRange`, `colors`, plus `moodStrength`, `moodSmoothing`, `moodRelease` and
`moodPalette`.

## Building and testing

The `.metal` shader is compiled by Xcode's build system, so test through
`xcodebuild` (no `sudo xcode-select` needed):

```bash
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild test -scheme VoiceGlowKit -destination 'platform=macOS'
```

Snapshots for side-by-side checks against the web version:

```bash
TEST_RUNNER_VOICE_GLOW_SNAPSHOTS=/tmp/shots DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcodebuild test -scheme VoiceGlowKit -destination 'platform=macOS' -only-testing:VoiceGlowKitTests/SnapshotTests
```

## Demo

```bash
../VoiceGlowDemo/run.sh          # simulator
../VoiceGlowDemo/run-device.sh   # a paired iPhone (unlocked, Developer Mode on)
```

A phone voice screen: tap the mic and talk. Until the mic opens, the web
demo's synthetic speech envelope drives the glow. The mood pad shows the
mood colours. Launch arguments: `-mood happy|angry|sad|calm`, `-level 0.8`,
`-theme light`, `-play /path/to/speech.aiff`.
