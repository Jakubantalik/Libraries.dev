// The ThinkingOrb component. One shared clock (performance.now) keeps
// every mounted orb in phase; each instance runs its own rAF loop but
// pauses automatically while offscreen (IntersectionObserver) or when
// the tab is hidden (visibilitychange). Reduced-motion users get a
// static representative frame that still follows the live theme.

import { useEffect, useRef } from 'react';
import { paintFrame, type OrbTint } from './engine/core';
import { scaleCounts, scaleRadii } from './engine/profiles';
import { MODE_FRAMES } from './engine/registry';
import { resolvePreset } from './presets';
import { useReducedMotion, useResolvedDark } from './theme';
import { attachGravity } from './gravity';
import type { ThinkingOrbProps } from './types';

/** Parse a CSS color into an RGB triple for the tinted ink painter.
 *  Supports #rgb, #rrggbb and rgb()/rgba(); anything else -> no tint. */
function parseTint(color: string | undefined): OrbTint | undefined {
  if (!color) return undefined;
  const hex = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.replace(/./g, (c) => c + c);
    const n = parseInt(h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const fn = color.trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
  if (fn) return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]) };
  return undefined;
}

const LABELS: Record<string, string> = {
  working: 'Working…',
  searching: 'Searching…',
  solving: 'Solving…',
  listening: 'Listening…',
  connecting: 'Connecting…',
  weaving: 'Weaving…',
  composing: 'Composing…',
  breathing: 'Thinking…',
  shaping: 'Shaping…'
};

export function ThinkingOrb({
  state = 'working',
  size = 64,
  theme = 'auto',
  speed = 1,
  paused = false,
  color,
  dots = 1,
  dotSize = 1,
  opts: optsOverride,
  frame: customFrame,
  gravity,
  style,
  'aria-label': ariaLabel,
  ...rest
}: ThinkingOrbProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const optsKey = optsOverride ? JSON.stringify(optsOverride) : '';
  const dark = useResolvedDark(theme, ref);

  // Gravity attaches the canvas to the document-level tracker; compared by
  // content so an inline options literal does not re-attach every render.
  const gravityKey = gravity ? JSON.stringify(gravity) : '';
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !gravity) return;
    return attachGravity(canvas, gravity === true ? true : gravity);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gravityKey]);
  const reduced = useReducedMotion();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { mode, speed: baseSpeed, opts: presetOpts } = resolvePreset(state, size);
    // `dots` rescales every count knob of the resolved preset with the same
    // sqrt-paired scaler the presets themselves use, so density changes keep
    // the mode's balance. resolvePreset caches — never mutate its result.
    let opts = dots !== 1 ? scaleCounts(presetOpts, Math.max(0.1, dots)) : presetOpts;
    if (dotSize !== 1) opts = scaleRadii(opts, Math.max(0.1, dotSize));
    // raw overrides land last, over everything the preset and multipliers set
    if (optsOverride) opts = { ...opts, ...optsOverride };
    const frameFn = customFrame ?? MODE_FRAMES[mode];
    const tint = parseTint(color);
    const effSpeed = baseSpeed * speed;

    const frame = (tSec: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      paintFrame(ctx, frameFn(size, tSec, opts), dark, tint);
    };

    // reduced motion → one static, deterministic frame
    if (reduced) {
      frame(0.6);
      return;
    }

    let raf = 0;
    let running = false;
    const loop = () => {
      frame((performance.now() / 1000) * effSpeed);
      if (running) raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || paused) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    // draw at least one frame even when paused/offscreen
    frame((performance.now() / 1000) * effSpeed);

    // pause offscreen + on hidden tabs — free when not visible
    let visible = true;
    const io =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver(([entry]) => {
            visible = entry.isIntersecting;
            if (visible && document.visibilityState !== 'hidden') start();
            else stop();
          })
        : null;
    io?.observe(canvas);
    const onVis = () => {
      if (document.visibilityState === 'hidden') stop();
      else if (visible) start();
    };
    document.addEventListener('visibilitychange', onVis);
    if (!io) start();

    return () => {
      stop();
      io?.disconnect();
      document.removeEventListener('visibilitychange', onVis);
    };
    // the override object is compared by content, so an inline literal
    // does not restart the loop every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, size, dark, speed, paused, reduced, color, dots, dotSize, optsKey, customFrame]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? LABELS[state]}
      style={{ width: size, height: size, display: 'block', ...style }}
      {...rest}
    />
  );
}
