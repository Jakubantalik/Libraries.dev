# Voice

A sound-reactive glow for React (`voice-glow`, component `VoiceBeam`): a colorful beam along the bottom edge of the element it wraps that rises with a voice, then gathers into a travelling beam while the reply is processed.

## When to use

### Where it goes

The author's placement rules. Follow them before the general list below.

- **Anything voice or recording related**: mic buttons, dictation, voice mode, recording chips, call UIs, and the processing step right after speech.

More situations it fits:

- Voice mode in an AI chat composer: the input glows while the user speaks into the mic.
- The bottom of a full-screen voice assistant on a phone (`type="mobile"`).
- "Transcribing…" or "Thinking…" right after the user stops talking: `processing` sweeps a beam side to side.
- Visualising the assistant's own speech (TTS playback) by feeding a level getter.
- A voice or video call UI that should light up with the remote side's voice (any `MediaStream` with an audio track).

### When not to use

- Pure loading states with no voice in the flow. Use a border beam or a thinking indicator instead.
- As the only sign that the mic is live. The glow is decorative; keep a text status and a visible mic button state.
- Inside dense lists or many simultaneous instances. Each instance runs blurred layers and a canvas.
- Precise audio metering (dB, peak hold). The level is gated, saturated and smoothed on purpose.

## Install

```bash
npm install voice-glow
pnpm add voice-glow
yarn add voice-glow
```

```tsx
import { VoiceBeam, useMicrophone } from 'voice-glow';
```

- React component only. No vanilla or custom-element build. Peer deps: `react` and `react-dom` >= 18.
- ESM and CJS builds with types. No runtime dependencies.
- The package has no `"use client"` directive and uses hooks. In the Next.js App Router, import it from a file marked `'use client'`.
- The microphone needs a secure context (`https` or `localhost`) and `mic.start()` called from a user gesture.

## Basic usage

The page's Install & Usage tab:

```tsx
import { VoiceBeam, useMicrophone } from 'voice-glow';

const mic = useMicrophone();

<VoiceBeam stream={mic.stream}>
  <ChatInput />
</VoiceBeam>

<button onClick={mic.start}>Listen</button>
```

The same thing as a complete component, with the start/stop toggle and `processing` from the page's Copy prompt:

```tsx
'use client';
import { VoiceBeam, useMicrophone } from 'voice-glow';

export function VoiceComposer({ thinking }: { thinking: boolean }) {
  const mic = useMicrophone();
  const live = mic.state === 'live';
  return (
    <>
      <VoiceBeam stream={mic.stream} processing={thinking}>
        <div style={{ borderRadius: 20, padding: 24, background: '#1d1d1d' }}>
          <textarea placeholder="Ask anything" />
        </div>
      </VoiceBeam>
      <button onClick={live ? mic.stop : mic.start} aria-pressed={live}>
        {live ? 'Stop' : 'Listen'}
      </button>
    </>
  );
}
```

Playground snippets (what "Copy playground code" produces per Source):

```tsx
// Source: Demo voice (the stage starts paused, so `paused` is included until you press Play)
<VoiceBeam
  level={() => yourLevel}
  paused
>
  <ChatInput />
</VoiceBeam>

// Type: Mobile, Source: Processing
<VoiceBeam
  type="mobile"
  processing
>
  <VoiceScreen />
</VoiceBeam>
```

### How audio input is wired

There are two inputs. `stream` wins when it is usable.

1. `stream={MediaStream}`. The component creates one shared `AudioContext` for the page, one `MediaStreamAudioSourceNode` per stream (reference-counted, so several beams can share one mic) and one `AnalyserNode` per instance. Nothing is connected to the speakers: audio is analysed, never played. Each frame it reads the RMS level and three voice bands (80-300, 300-2000, 2000-6000 Hz).
2. `level={number | () => number}`. Used when there is no `stream`, or when the stream has no audio track or the browser has no Web Audio. Values are clamped to 0-1. A number updates on re-render. A getter is called once per animation frame, with no re-render. Use a getter for anything that changes many times a second.
3. `useMicrophone()` is a convenience that produces the `stream`. It calls `getUserMedia` with echo cancellation, noise suppression and auto gain turned off, so the glow sees the real dynamics of the voice.

`useMicrophone(options?)`:

| Field | Type | Notes |
|---|---|---|
| `stream` | `MediaStream \| null` | Pass to `<VoiceBeam stream>`. |
| `state` | `'idle' \| 'requesting' \| 'live' \| 'denied' \| 'unsupported' \| 'error'` | `denied` on `NotAllowedError` / `SecurityError`. Falls back to `idle` if the track ends (device unplugged, permission revoked). |
| `error` | `Error \| null` | The error behind `denied` / `error`. |
| `supported` | `boolean` | `navigator.mediaDevices.getUserMedia` exists. |
| `start()` | `() => Promise<MediaStream \| null>` | Call from a click. Also creates and resumes the shared `AudioContext` inside the gesture. |
| `stop()` | `() => void` | Stops every track and drops the stream. |
| `options.constraints` | `MediaTrackConstraints` | Merged over the defaults above. Pass `{}` to keep the browser's own processing. |
| `options.autoStart` | `boolean` | Request on mount. Default `false`. |

The hook stops the tracks on unmount.

## Options (free)

What the detail page's playground exposes:

| Prop | Values | Default | What it does |
|---|---|---|---|
| `type` | `"default"`, `"mobile"` | `"default"` | Host preset. `default` is tuned for a ~350px chat input; `mobile` for the bottom of a phone screen (wider range, taller rise). |
| `stream` | `MediaStream \| null` | `null` | Live audio to react to. Wins over `level`. |
| `level` | `number` 0-1, or `() => number` | `0` | Manual drive when there is no stream. |
| `processing` | `boolean` | `false` | Gathers the glow into one beam that travels the range and back, held lit. Blends in and out smoothly. |
| `paused` | `boolean` | `false` | Freezes the glow, the band and the audio analysis on their last frame, without fading out. |

Tuner to prop mapping:

- **Type**: Chat input = `type="default"` (omitted from the snippet), Mobile = `type="mobile"`. A third tab, Recording pill, is shown locked.
- **Source**: Demo voice = `level={() => yourLevel}`, Microphone = `stream={mic.stream}` plus `useMicrophone()` and a Listen button, Processing = `processing`. Manual drive is shown locked.
- **Play / Pause** = `paused`. The stage starts paused.

The page's Copy prompt also names these props, without values: `type="pill"` (a ~150x44 recording pill), `colorVariant` (`"colorful" | "mono" | "ocean" | "sunset" | "forest" | "candy" | "ice" | "gold"`), `colors` (up to 7 lobe colours), `bandColors` (`{ core, above, mid, below }`), `sensitivity`, `threshold`, `attack`, `release` (the input chain: gain, gate, envelope), `reach`, `spread`, `flow`, `bend`, `idle` (the shape of the reaction), `theme` (`"dark" | "light" | "auto"`), `strength` (0-1 effect opacity), `active`, `paused`, `scale`. Tuning them is a Studio job.

## Recipes

Voice mode in a chat composer: listen, then process.
Use when: a chat input has a mic button and a transcription or model step after it.

```tsx
const mic = useMicrophone();
const [transcribing, setTranscribing] = useState(false);

async function finish() {
  mic.stop();
  setTranscribing(true);
  await sendAudioForTranscription();
  setTranscribing(false);
}

<>
  <VoiceBeam stream={mic.stream} processing={transcribing}>
    <ChatInput />
  </VoiceBeam>
  <button onClick={mic.state === 'live' ? finish : mic.start}>
    {mic.state === 'live' ? 'Done' : 'Speak'}
  </button>
</>
```

Phone voice screen driven by your own meter.
Use when: a full-screen mobile voice assistant already computes a level (a speech SDK volume event, your own analyser).

```tsx
const meter = useRef(0); // write 0-1 into meter.current from your audio code

<VoiceBeam type="mobile" level={() => meter.current}>
  <VoiceScreen />
</VoiceBeam>
```

The assistant's speech (TTS playback).
Use when: the glow should follow the model's audio reply, not the user's mic.

```tsx
import { VoiceBeam, getAudioContext } from 'voice-glow';

const analyserRef = useRef<AnalyserNode | null>(null);
const buf = useRef(new Float32Array(1024));

// Call from a click. createMediaElementSource works once per <audio> element.
function playReply(audio: HTMLAudioElement) {
  const ctx = getAudioContext(); // the page's shared context, exported by voice-glow
  if (!ctx) return;
  const src = ctx.createMediaElementSource(audio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);
  analyser.connect(ctx.destination); // keep it audible
  analyserRef.current = analyser;
  void audio.play();
}

const level = () => {
  const a = analyserRef.current;
  if (!a) return 0;
  a.getFloatTimeDomainData(buf.current);
  let sum = 0;
  for (const v of buf.current) sum += v * v;
  return Math.min(1, Math.sqrt(sum / buf.current.length) * 8);
};

<VoiceBeam level={level}>
  <AssistantCard />
</VoiceBeam>
```

A call with the remote voice.
Use when: a WebRTC call tile should glow when the other side talks.

```tsx
const [remote, setRemote] = useState<MediaStream | null>(null);
useEffect(() => {
  pc.ontrack = (e) => setRemote(e.streams[0] ?? null);
}, [pc]);

<VoiceBeam stream={remote}>
  <CallTile />
</VoiceBeam>
```

Freeze while a modal covers the composer.
Use when: the voice UI is visible but not the focus.

```tsx
<VoiceBeam stream={mic.stream} paused={settingsOpen}>
  <ChatInput />
</VoiceBeam>
```

## Accessibility & performance

- The glow layers are `pointer-events: none`. The band canvases are `aria-hidden`. The glow adds no roles or labels. Screen readers get nothing from it.
- Give the mic button `aria-pressed` and an accessible name, and announce the state in text (`role="status"`), for example from `mic.state`: "Waiting for permission…", "Listening.", "Microphone blocked".
- `prefers-reduced-motion: reduce` stops the idle breathing, the sideways colour flow, the hue drift, the distortion warp and the processing sweep (the beam stays centred). The reaction to sound stays, since it is a meter.
- One shared `requestAnimationFrame` loop drives every instance, capped at about 60 fps. On a device that cannot hold 60 it drops to every other frame and probes full rate again every 4 s.
- An instance scrolled offscreen (IntersectionObserver, 256px margin) unregisters from the loop and releases its analyser.
- The soft layers render at half resolution and are scaled up. The distortion warp is an SVG filter; on Safari/WebKit it is switched off automatically for hosts larger than about 60,000 px² (a phone screen), and it is always dropped while `processing`.
- SSR: the component renders on the server, but two things can differ on the client. Safari renders an extra halo canvas, and `theme="auto"` starts as dark on the server. If you see hydration warnings, mount it client-only.

## Common mistakes

- Calling `mic.start()` outside a click, or relying on `autoStart`. Browsers only grant the mic inside a user gesture, and Safari only starts the `AudioContext` inside one.
- Passing a new number to `level` from React state 60 times a second. Pass a getter instead: `level={() => meter.current}`.
- Expecting `level` to work while `stream` is set. A stream with an audio track always wins.
- Wrapping something without its own radius. The wrapper reads the first child's `border-top-left-radius` (16px if none) and clips with `overflow: hidden`. Wrap exactly one element that carries the radius. Popovers or menus inside that element get clipped too, so portal them out.
- Content hidden under the bloom. The glow layers stack at `z-index` 1-4 above plain children. Put text and controls that must stay crisp at `position: relative; z-index: 5`, as the libraries.dev mocks do.
- Using the chat-input tuning on a much bigger or smaller host. The glow is authored in px for ~350px. The page shrinks it on narrow screens with `scale={Math.min(1, width / 371)}`, and uses `type="mobile"` for a phone screen.
- Leaving the mic open. The hook only stops tracks on unmount; call `mic.stop()` when the voice UI closes.
- Styling the wrapper's `::before` / `::after`. The effect uses them.

## Detecting a fit in a codebase

| Signal to grep for | Suggest |
|---|---|
| `getUserMedia`, `MediaRecorder`, `new AudioContext`, `createAnalyser` | Wrap the recording UI in `<VoiceBeam stream={stream}>`. |
| `SpeechRecognition`, `webkitSpeechRecognition`, `isListening`, `isRecording` | Voice-mode composer recipe; `useMicrophone` for the stream. |
| Speech SDKs: `@deepgram`, `assemblyai`, `openai` realtime / `gpt-4o-transcribe`, `whisper`, `elevenlabs`, `@livekit`, `vapi`, `retell` | Glow on the input while listening, `processing` while transcribing. |
| Copy like "Listening…", "Recording", "Tap to speak", "Hold to talk", "Transcribing…" | `stream` while listening, `processing` after. |
| Mic icons: `Mic`, `MicOff` (lucide), `MicrophoneIcon` next to a chat `<textarea>` | Wrap the composer; keep the button as the control. |
| Waveform or bar visualizers (`wavesurfer`, `react-audio-visualizer`, custom `<canvas>` meters) | Replace or pair with the glow, driven by the same level getter. |
| `RTCPeerConnection`, `ontrack`, call tiles | `stream={remoteStream}` on the tile. |
| Full-screen voice route on mobile (`/voice`, `VoiceMode`, `VoiceScreen`) | `type="mobile"` on the screen container. |

## Go further (Pro)

- Palettes and per-lobe colours, band colours, and a light theme tuning.
- The input chain (sensitivity, noise gate, attack, release) and the reaction's shape (reach, spread, flow, bend, idle breathing).
- The band, the distortion warp, the glow's geometry, and the processing sweep's timing.
- The recording-pill host, and rebuilding the effect's stylesheet with the Studio agent.

Tune it visually in the Studio at https://libraries.dev/studio, or install the Pro skill.
