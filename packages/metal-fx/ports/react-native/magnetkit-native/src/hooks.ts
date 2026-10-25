import { useEffect, useRef, useState } from "react";
import { Magnet } from "./magnet";
import type { NativeMagnetFrame, NativeMagnetGesture } from "./MagnetKitModule";

/** Every reading, without re-rendering (once per display frame). */
export function useMagnetFrame(cb: (f: NativeMagnetFrame) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => Magnet.addFrameListener((f) => ref.current(f)), []);
}

/** The latest reading as state, at most one render per animation frame. */
export function useMagnet(): NativeMagnetFrame | null {
  const [frame, setFrame] = useState<NativeMagnetFrame | null>(Magnet.frame);
  useEffect(() => {
    let raf = 0;
    let pending: NativeMagnetFrame | null = null;
    const off = Magnet.addFrameListener((f) => {
      pending = f;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; setFrame(pending); });
    });
    return () => { off(); cancelAnimationFrame(raf); };
  }, []);
  return frame;
}

/** Air taps, pushes, pull-aways and swipes. */
export function useMagnetGestures(cb: (g: NativeMagnetGesture) => void) {
  const ref = useRef(cb);
  ref.current = cb;
  useEffect(() => Magnet.addGestureListener((g) => ref.current(g)), []);
}
