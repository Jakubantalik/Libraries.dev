# Voice ring

A voice-reactive ring of light for AI voice interfaces (`voice-ring`, component `VoiceRing`): a few rings lean off the view axis and bundle into a glassy ribbon, a spectrum runs around it, and the voice bends every ring together. It takes the colour of the voice's emotion and leans toward whoever is speaking. Two types: `ring` (the default) and `mono`, two loops of grey tube that a voice opens into a turning globe. React and SwiftUI.

## When to use

### Where it goes

- **The centre of a voice screen**: a full-screen or sheet voice mode where the ring is the main thing on screen while the assistant listens, thinks and speaks.
- **An assistant's presence**: the ring stands for the voice agent, idle until spoken to.

More situations it fits:

- A voice call with an AI, with `state` following the conversation: `listening` while the user talks, `processing` while the reply is made, `speaking` while it plays.
- Visualising the assistant's own speech by feeding a level getter from the audio player.
- A room with several speakers, where the ring leans toward the one talking (`direction`).

### When not to use

- A glow along a chat input or the bottom of a screen. That is **Voice** (`voice-glow`).
- Small inline indicators or lists of many instances. It is a centrepiece; each instance draws a canvas.
- Loading states with no voice in the flow. Use **Thinking orbs**.

## Install

```bash
npm install voice-ring
```

```tsx
import { VoiceRing, useMicrophone } from 'voice-ring';
```

- React 18+. A 2D canvas with a small WebGL pass for the edge lens.
- SwiftUI (iOS 17+ / macOS 14+), Swift Package Manager: `.package(url: "https://github.com/Jakubantalik/Libraries.dev", branch: "main")` and `.product(name: "VoiceRingKit", package: "Libraries.dev")`.

## Basic usage

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

## Options (free)

| Prop | Values | Notes |
|---|---|---|
| `type` | `ring` (default), `mono` | `VoiceRing(.mono, …)` in SwiftUI. |
| `state` | `idle`, `listening`, `speaking`, `processing` | Wire it to the conversation's real status. |
| `stream` | `MediaStream` | The microphone, or any stream with an audio track. |
| `level` | number 0–1, or a getter read every frame | Instead of `stream`, for example TTS playback. |
| `emotion` | `positive`, `negative`, `calm` | Shifts the spectrum toward its colour. |
| `direction` | −1 left … 1 right, a number or a getter | A browser microphone is mono, so the side comes from you: a stereo capture, a diarised speaker, or where that person sits in your UI. On iPhone, the **Voice position** model supplies it. |
| `hoverBend` | `true` (0.55) or 0–1 | While `idle` or `processing`, the ring bends toward a nearby cursor. Desktop only; off with reduced motion. |
| `sensitivity` | number, default 0.85 | How strongly the voice bends the rings. |
| `speed`, `theme` (`auto`, `dark`, `light`), `paused` | | |

## Accessibility & performance

- Decorative: keep a text status ("Listening…") and a visible microphone control.
- Pause it (`paused`) when its screen is hidden; one instance per screen.
- Reduced motion turns `hoverBend` off.

## Common mistakes

- Using it as a composer glow. That is Voice (`voice-glow`).
- Hard-coding `state="listening"`. Follow the real conversation state.
- Expecting `direction` from a browser microphone alone; browsers record in mono.

## Detecting a fit in a codebase

| Signal to grep for | Suggest |
|---|---|
| Full-screen voice routes: `/voice`, `VoiceMode`, `VoiceScreen`, `CallScreen` | `<VoiceRing>` as the screen's centrepiece, `state` from the call. |
| Realtime voice SDKs: `openai` realtime, `@livekit`, `vapi`, `retell`, `elevenlabs` conversational | `listening` / `processing` / `speaking` from the SDK's events. |
| An orb or blob standing for the assistant (`AssistantOrb`, `AgentBlob`, Lottie "siri" animations) | Replace it with `VoiceRing`. |
| TTS playback (`speechSynthesis`, an `<audio>` element for replies) | `state="speaking"` with `level` from the player. |

## Go further (Pro)

- The emotion model for SwiftUI (`VoiceRingEmotion`): the tone of the voice and its words colour the ring.
- Every ring, ribbon, spectrum and lens setting in the Studio at https://libraries.dev/studio, or the Pro skill.
