import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { WaveController, type PlayOptions, type WaveOptions } from "./controller";

export interface DistortionWaveProps extends WaveOptions, Omit<HTMLAttributes<HTMLDivElement>, keyof WaveOptions | "children"> {
  /** What the wave passes over: the view that shows first. Give it an
      opaque background, or one behind the whole element. */
  children?: ReactNode;
  /** The view the wave leaves behind it. Without one the wave passes over
      `children` and leaves them as they were. */
  revealedContent?: ReactNode;
  /** What stays above the wave, as it is: the button that starts it, a
      close control. The wave neither bends nor colours it, and it shows over
      both views. Its own children take clicks; the rest of it lets them
      through to the view below. */
  overlay?: ReactNode;
}

export interface DistortionWaveHandle {
  /** Runs the wave from the start. */
  play(options?: PlayOptions): void;
  /** Runs it back to the first view. */
  reverse(): void;
  /** Straight back to the first view, with no wave. */
  reset(): void;
  /** Pictures the element now, so the next wave starts with its lens. */
  prepare(): Promise<void>;
  /** The wave's element. */
  readonly element: HTMLDivElement | null;
  /** The engine behind it, for benches. */
  readonly controller: WaveController | null;
}

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

/* The two views share one grid cell. These objects never change, so React
   never writes over what the controller sets on the layers as it runs. */
const LAYER: CSSProperties = { gridArea: "1 / 1", minWidth: 0, minHeight: 0, isolation: "isolate" };
const LAYER_HIDDEN: CSSProperties = { ...LAYER, opacity: 0, pointerEvents: "none" };
/* Over the canvas, which is at 1. It covers the whole element, so it takes
   no clicks itself; the rule below gives them back to what is put in it. */
const OVERLAY: CSSProperties = { gridArea: "1 / 1", minWidth: 0, minHeight: 0, position: "relative", zIndex: 2, pointerEvents: "none" };
const OVERLAY_RULE = ':where([data-dw-layer="overlay"])>*{pointer-events:auto}';

/**
 * A wave that leaves a button, an edge or a point and crosses the element,
 * bending what is there and carrying one view into another.
 *
 * ```tsx
 * <DistortionWave revealed={sent} revealedContent={<Receipt />}>
 *   <Review onSend={() => setSent(true)} />
 * </DistortionWave>
 * ```
 */
export const DistortionWave = forwardRef<DistortionWaveHandle, DistortionWaveProps>(function DistortionWave(props, ref) {
  const {
    children,
    revealedContent,
    overlay,
    revealed,
    type,
    source,
    focus,
    waveStyle,
    palette,
    scale,
    cornerRadius,
    scrub,
    capture,
    live,
    prewarm,
    resolution,
    reducedMotion,
    onFinish,
    style,
    ...rest
  } = props;

  const root = useRef<HTMLDivElement>(null);
  const first = useRef<HTMLDivElement>(null);
  const second = useRef<HTMLDivElement>(null);
  const controller = useRef<WaveController | null>(null);
  // Which view the markup starts on. After that the controller decides.
  const [startRevealed] = useState(() => !!revealed);
  const two = revealedContent !== undefined && revealedContent !== null && revealedContent !== false;

  useIsomorphicLayoutEffect(() => {
    const made = new WaveController(root.current!, first.current!, second.current);
    controller.current = made;
    return () => {
      made.destroy();
      controller.current = null;
    };
  }, []);

  useIsomorphicLayoutEffect(() => {
    const c = controller.current;
    if (!c) return;
    c.setRevealedLayer(second.current);
    c.update({ revealed, type, source, focus, waveStyle, palette, scale, cornerRadius, scrub, capture, live, prewarm, resolution, reducedMotion, onFinish });
  });

  useImperativeHandle(
    ref,
    () => ({
      play: (options) => controller.current?.play(options),
      reverse: () => controller.current?.reverse(),
      reset: () => controller.current?.reset(),
      prepare: () => controller.current?.prepare() ?? Promise.resolve(),
      get element() {
        return root.current;
      },
      get controller() {
        return controller.current;
      },
    }),
    [],
  );

  return (
    <div ref={root} data-distortion-wave="" {...rest} style={{ display: "grid", isolation: "isolate", ...style }}>
      <div ref={first} data-dw-layer="content" style={two && startRevealed ? LAYER_HIDDEN : LAYER}>
        {children}
      </div>
      {two ? (
        <div ref={second} data-dw-layer="revealed" style={startRevealed ? LAYER : LAYER_HIDDEN}>
          {revealedContent}
        </div>
      ) : null}
      {overlay !== undefined && overlay !== null && overlay !== false ? (
        <div data-dw-layer="overlay" data-dw-skip="" style={OVERLAY}>
          <style data-dw-skip="">{OVERLAY_RULE}</style>
          {overlay}
        </div>
      ) : null}
    </div>
  );
});
