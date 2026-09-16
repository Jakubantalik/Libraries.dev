import { useCallback, useEffect, useRef, useState } from 'react';
import { getAudioContext } from './audio';

export type MicrophoneState = 'idle' | 'requesting' | 'live' | 'denied' | 'unsupported' | 'error';

export interface UseMicrophoneOptions {
  /**
   * Extra `getUserMedia` audio constraints. The defaults turn the browser's
   * voice processing off (echo cancellation, noise suppression, auto gain)
   * so the beam sees the real dynamics of the voice rather than a levelled
   * signal; pass `{}` to keep the browser defaults.
   */
  constraints?: MediaTrackConstraints;
  /** Ask for the microphone on mount rather than waiting for `start()`. */
  autoStart?: boolean;
}

export interface UseMicrophoneResult {
  /** The live stream to hand to `<VoiceBeam stream={…}>`, or null. */
  stream: MediaStream | null;
  state: MicrophoneState;
  /** The error behind a 'denied' / 'error' state, if any. */
  error: Error | null;
  /** True when this browser can capture audio at all. */
  supported: boolean;
  /** Request the microphone. Call it from a click so Safari lets audio start. */
  start: () => Promise<MediaStream | null>;
  /** Stop every track and drop the stream. */
  stop: () => void;
}

const DEFAULT_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

function isSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices !== 'undefined' &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/**
 * Microphone access for VoiceBeam.
 *
 * ```tsx
 * const mic = useMicrophone();
 * <button onClick={mic.start}>Listen</button>
 * <VoiceBeam stream={mic.stream}>…</VoiceBeam>
 * ```
 *
 * The stream is stopped on unmount, and when the browser ends the track
 * (device unplugged, permission revoked) the state falls back to 'idle'.
 */
export function useMicrophone(options: UseMicrophoneOptions = {}): UseMicrophoneResult {
  const { constraints, autoStart = false } = options;
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<MicrophoneState>(() => (isSupported() ? 'idle' : 'unsupported'));
  const [error, setError] = useState<Error | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const constraintsRef = useRef(constraints);
  constraintsRef.current = constraints;

  const stop = useCallback(() => {
    const current = streamRef.current;
    streamRef.current = null;
    if (current) current.getTracks().forEach((t) => t.stop());
    setStream(null);
    setState(isSupported() ? 'idle' : 'unsupported');
  }, []);

  const start = useCallback(async (): Promise<MediaStream | null> => {
    if (!isSupported()) {
      setState('unsupported');
      return null;
    }
    if (streamRef.current) return streamRef.current;

    // Create (and resume) the shared context inside the gesture that
    // triggered this, while the browser still allows it.
    getAudioContext();

    setState('requesting');
    setError(null);
    try {
      const next = await navigator.mediaDevices.getUserMedia({
        audio: { ...DEFAULT_CONSTRAINTS, ...(constraintsRef.current ?? {}) },
      });
      streamRef.current = next;
      setStream(next);
      setState('live');
      const onEnded = () => {
        if (streamRef.current !== next) return;
        streamRef.current = null;
        setStream(null);
        setState('idle');
      };
      next.getAudioTracks().forEach((t) => t.addEventListener('ended', onEnded));
      return next;
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      setState(err.name === 'NotAllowedError' || err.name === 'SecurityError' ? 'denied' : 'error');
      return null;
    }
  }, []);

  useEffect(() => {
    if (autoStart) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  useEffect(
    () => () => {
      const current = streamRef.current;
      streamRef.current = null;
      if (current) current.getTracks().forEach((t) => t.stop());
    },
    []
  );

  return { stream, state, error, supported: isSupported(), start, stop };
}
