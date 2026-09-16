/**
 * Web Audio plumbing shared by every VoiceBeam instance.
 *
 * One AudioContext for the page, one MediaStreamAudioSourceNode per stream
 * (reference-counted, so several beams can listen to the same microphone),
 * and one AnalyserNode per instance. Nothing is connected to the
 * destination, so the audio is analysed but never played back.
 */

let context: AudioContext | null = null;

type AudioContextCtor = typeof AudioContext;

function resolveAudioContext(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** True when this browser can analyse audio at all. */
export function isAudioSupported(): boolean {
  return resolveAudioContext() != null;
}

/**
 * The page's shared AudioContext, created on first use. Call it from a
 * user gesture (the microphone button) where you can: Safari only lets a
 * context start inside one. It is resumed on every call, so a context the
 * browser suspended in the background picks up again.
 */
export function getAudioContext(): AudioContext | null {
  const Ctor = resolveAudioContext();
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === 'suspended') {
    context.resume().catch(() => {
      /* A resume outside a gesture may be refused; the next gesture retries. */
    });
  }
  return context;
}

interface SharedSource {
  node: MediaStreamAudioSourceNode;
  refs: number;
}

const sources = new WeakMap<MediaStream, SharedSource>();

export interface AnalyserLease {
  analyser: AnalyserNode;
  release: () => void;
}

/**
 * An AnalyserNode fed by `stream`, plus the function that tears it down.
 * Returns null when the browser has no Web Audio or the stream carries no
 * audio track.
 */
export function acquireAnalyser(stream: MediaStream): AnalyserLease | null {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (stream.getAudioTracks().length === 0) return null;

  let shared = sources.get(stream);
  if (!shared) {
    shared = { node: ctx.createMediaStreamSource(stream), refs: 0 };
    sources.set(stream, shared);
  }
  shared.refs += 1;

  const analyser = ctx.createAnalyser();
  // 1024 bins at 48 kHz is ~47 Hz per bin: fine enough to split the voice
  // bands, cheap enough to read every frame.
  analyser.fftSize = 1024;
  // The driver does its own attack/release, so the analyser's smoothing
  // stays light — just enough to take the flicker off the spectrum.
  analyser.smoothingTimeConstant = 0.5;
  shared.node.connect(analyser);

  let released = false;
  return {
    analyser,
    release: () => {
      if (released) return;
      released = true;
      try {
        shared!.node.disconnect(analyser);
      } catch {
        /* already gone */
      }
      shared!.refs -= 1;
      if (shared!.refs <= 0) {
        try {
          shared!.node.disconnect();
        } catch {
          /* already gone */
        }
        sources.delete(stream);
      }
    },
  };
}
