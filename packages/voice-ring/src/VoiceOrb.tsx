// The VoiceOrb component. Each instance runs its own rAF loop (capped near
// 60 fps), paused while offscreen or on a hidden tab. Every frame the
// follower reads the voice source — a stream, an AnalyserNode or a level —
// shapes and smooths it, and the type's geometry is painted with the shared
// depth-shaded painter. Sources are read through refs, so a new level
// getter or sensitivity never restarts the loop or resets the envelope.

import { useEffect, useRef, useState } from 'react';
import { acquireAnalyser } from './audio';
import { ACCENT_COLORS, EMOTION_COLORS, GlowFollower } from './emotion';
import { EdgeBounce, LEAN_DEFAULTS, leanFrame, leanReach } from './engine/lean';
import { paintFrame, type OrbGlow, type OrbTint } from './engine/paint';
import type { VoiceInput } from './engine/types';
import { PRESETS, resolvePreset } from './presets';
import { useReducedMotion, useResolvedDark } from './theme';
import type { VoiceOrbProps } from './types';
import { VoiceFollower } from './voice';

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
  idle: 'Waiting',
  listening: 'Listening',
  speaking: 'Speaking',
  processing: 'Thinking'
};

// 120 Hz displays would double the paint work for no visible gain.
const FRAME_MS = 1000 / 62;

export function VoiceOrb({
  type = 'orbit',
  state = 'listening',
  size = 160,
  stream,
  analyser,
  level,
  sensitivity = 1,
  threshold = 0.04,
  attack,
  release = 0.32,
  idle = 0.1,
  calm = 0.4,
  voiceSpeed: voiceSpeedProp,
  emotion = null,
  emotionColors,
  saturation = 2,
  accent = null,
  gradientAngle = 99,
  gradientSpin = 12,
  neutral = 1,
  colorBrightness = 1.02,
  colorHue = 0,
  gradientStart = 0.1,
  gradientWidth = 0.6,
  direction,
  directionMove,
  directionPull,
  directionDeform,
  directionSquash,
  directionLens,
  directionStretch,
  directionSplit,
  directionBlur,
  directionBounce,
  directionMargin: marginProp,
  directionBounds,
  theme = 'auto',
  speed = 1,
  paused = false,
  color,
  dots = 1,
  dotSize: dotSizeProp,
  opts: optsOverride,
  frame: customFrame,
  onLevel,
  style,
  'aria-label': ariaLabel,
  ...rest
}: VoiceOrbProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const dark = useResolvedDark(theme, ref);
  const reduced = useReducedMotion();
  const optsKey = optsOverride ? JSON.stringify(optsOverride) : '';
  // processing moves on its own, so it needs the loop even with no source
  const hasSource = Boolean(stream || analyser || level != null || state === 'processing');

  // The follower outlives re-renders and prop changes, so the envelope
  // never drops to silence mid-sentence when a prop moves.
  const followerRef = useRef<VoiceFollower | null>(null);
  if (!followerRef.current) followerRef.current = new VoiceFollower();
  const glowRef = useRef<GlowFollower | null>(null);
  if (!glowRef.current) glowRef.current = new GlowFollower();
  const emotionTint = emotion ? (emotionColors?.[emotion] ?? EMOTION_COLORS[emotion]) : null;

  // Live inputs, read by the loop every frame.
  // saturation past 1 is vividness: the colour itself purer and deeper
  const colors = {
    saturation: Math.min(1, saturation),
    vivid: Math.max(0, Math.min(1, saturation - 1)),
    brightness: colorBrightness,
    hue: colorHue,
    start: gradientStart,
    width: gradientWidth,
    accent: accent ? ACCENT_COLORS[accent] : null,
    angle: gradientAngle,
    spin: gradientSpin,
    neutral,
    size
  };
  const dotSize = dotSizeProp ?? PRESETS[type in PRESETS ? type : 'orbit'].dotSize ?? 1;
  const typeLean = PRESETS[type in PRESETS ? type : 'orbit'].lean ?? {};
  // how far short of the screen's edge the lean stops: the prop, else the type's own
  const directionMargin = marginProp ?? PRESETS[type in PRESETS ? type : 'orbit'].margin ?? 32;
  const inputs = {
    state,
    level,
    analyser,
    sensitivity,
    threshold,
    attack: attack ?? PRESETS[type in PRESETS ? type : 'orbit'].attack ?? 0.06,
    release,
    idle,
    calm,
    voiceSpeed: voiceSpeedProp ?? PRESETS[type in PRESETS ? type : 'orbit'].voiceSpeed ?? 1,
    onLevel,
    emotionTint,
    colors,
    direction,
    bounds: directionBounds,
    // each amount: the prop, else the type's own, else the shared default
    lean: {
      move: directionMove ?? typeLean.move ?? LEAN_DEFAULTS.move,
      pull: directionPull ?? typeLean.pull ?? LEAN_DEFAULTS.pull,
      deform: directionDeform ?? typeLean.deform ?? LEAN_DEFAULTS.deform,
      squash: directionSquash ?? typeLean.squash ?? LEAN_DEFAULTS.squash,
      lens: directionLens ?? typeLean.lens ?? LEAN_DEFAULTS.lens,
      stretch: directionStretch ?? typeLean.stretch ?? LEAN_DEFAULTS.stretch,
      split: directionSplit ?? typeLean.split ?? LEAN_DEFAULTS.split,
      blur: directionBlur ?? typeLean.blur ?? LEAN_DEFAULTS.blur,
      bounce: directionBounce ?? typeLean.bounce ?? LEAN_DEFAULTS.bounce
    }
  };
  const live = useRef(inputs);
  live.current = inputs;
  // The canvas reaches past the orb's box by as far as the lean can carry
  // it — but no further than the edge of the screen, where the lean stops —
  // so a leaning orb is never cut off and never overflows; negative margins
  // keep the layout at `size`. No direction, no lean, no reach.
  const reach = direction == null ? 0 : leanReach(inputs.lean, size);
  const [room, setRoom] = useState<[number, number]>([Infinity, Infinity]);
  // the lean's bounds: up to the margin short of the screen's edge…
  const left = Math.min(reach, room[0]);
  const right = Math.min(reach, room[1]);
  // …but the canvas reaches on into the margin, so a glow or a squashed
  // side fades out there instead of being cut at the bound
  const padL = reach ? left + directionMargin : 0;
  const padR = reach ? right + directionMargin : 0;

  // A stream gets its own analyser, released when the stream goes.
  const ownAnalyser = useRef<AnalyserNode | null>(null);
  useEffect(() => {
    if (!stream) return;
    const lease = acquireAnalyser(stream);
    ownAnalyser.current = lease?.analyser ?? null;
    return () => {
      ownAnalyser.current = null;
      lease?.release();
    };
  }, [stream]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    canvas.width = Math.round((size + padL + padR) * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const preset = resolvePreset(type, size, dots, dotSize);
    // raw overrides land last, over everything the preset and multipliers set
    const opts = optsOverride ? { ...preset.opts, ...optsOverride } : preset.opts;
    const frameFn = customFrame ?? preset.frame;
    const tint = parseTint(color);
    const follower = followerRef.current!;
    const glower = glowRef.current!;

    // the bounce off the edge chases how hard the last frame pressed on it
    const bounce = new EdgeBounce();
    let press = 0;

    const draw = (voice: VoiceInput, glow: OrbGlow, dt: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, padL * dpr, 0);
      ctx.clearRect(-padL, 0, size + padL + padR, size);
      // lean toward where the voice comes from, after the geometry
      const hit = paused || reduced ? 0 : bounce.step(press, dt);
      const frame = leanFrame(frameFn(size, follower.t, voice, opts), voice.pan, size, live.current.lean, [left, right], hit);
      press = frame.contact?.press ?? 0;
      // On the ink types the emotion *is* the colour: the gradient runs from
      // the neutral ink into the emotion's hue, fading in and crossfading as
      // the glow follower eases. A fixed accent, if set, holds the colour
      // without one. With neither, the orb stays neutral. The gradient turns
      // slowly on the orb's own clock, so it never jumps.
      const c = live.current.colors;
      const e = glow.amount;
      const base = c.accent;
      const hue = base
        ? { r: base.r + (glow.r - base.r) * e, g: base.g + (glow.g - base.g) * e, b: base.b + (glow.b - base.b) * e }
        : { r: glow.r, g: glow.g, b: glow.b };
      const colors = {
        ...c,
        accent: hue,
        saturation: c.saturation * (base ? 1 : e),
        angle: c.angle + c.spin * follower.clock
      };
      // luminous frames keep the emotion as a shift of their own spectrum
      paintFrame(ctx, frame, dark, tint, frame.light ? glow : undefined, colors);
    };

    // the room from the orb's box to the edges of the viewport, checked every
    // half second; a change re-sizes the canvas
    let lastMeasure = -Infinity;
    const measure = (now: number) => {
      if (!reach || now - lastMeasure < 500) return;
      lastMeasure = now;
      const box = canvas.getBoundingClientRect().left + padL;
      // the screen's edges, or the bounding element's
      const within = live.current.bounds?.current?.getBoundingClientRect();
      const lo = within ? within.left : 0;
      const hi = within ? within.right : document.documentElement.clientWidth;
      // the lean stops short of those edges by the margin
      const next: [number, number] = [
        Math.max(0, Math.floor(box - lo - directionMargin)),
        Math.max(0, Math.floor(hi - box - size - directionMargin))
      ];
      setRoom((was) => (Math.abs(was[0] - next[0]) > 1 || Math.abs(was[1] - next[1]) > 1 ? next : was));
    };

    let lastStep = 0;
    const step = (now: number) => {
      measure(now);
      const dt = lastStep ? Math.min(0.05, (now - lastStep) / 1000) : 1 / 60;
      lastStep = now;
      const src = live.current;
      // waiting and processing do not listen, whatever is attached
      const hears = src.state === 'listening' || src.state === 'speaking';
      const node = ownAnalyser.current ?? src.analyser ?? null;
      if (!hears) follower.readSilence();
      else if (node) follower.readAnalyser(node, src.sensitivity * preset.gain, dt);
      else if (src.level != null) {
        follower.readLevel(typeof src.level === 'function' ? src.level() : src.level, src.sensitivity * preset.gain);
      } else follower.readSilence();
      const voice = follower.step(
        dt,
        {
          sensitivity: src.sensitivity,
          threshold: src.threshold,
          attack: src.attack,
          release: src.release,
          idle: src.idle,
          driveGain: preset.driveGain * src.voiceSpeed,
          calm: src.calm,
          rate: preset.speed * speed,
          processing: src.state === 'processing',
          direction: typeof src.direction === 'function' ? src.direction() : (src.direction ?? 0)
        },
        reduced
      );
      src.onLevel?.(voice.level);
      // a still orb (paused, or reduced motion) shows the emotion at once
      const glow = glower.step(dt, src.emotionTint, follower.clock, size, paused || reduced);
      draw(voice, glow, dt);
    };

    // paused, or reduced motion with nothing to listen to: one still frame
    step(performance.now());
    if (paused || (reduced && !hasSource)) return;

    let raf = 0;
    let running = false;
    let lastPaint = 0;
    const loop = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      if (now - lastPaint < FRAME_MS) return;
      lastPaint = now;
      step(now);
    };
    const start = () => {
      if (running) return;
      running = true;
      // the gap while stopped is not time the orb lived through
      lastStep = 0;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

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
    // The override object is compared by content, so an inline literal
    // does not restart the loop every render. The emotion and the colours
    // are dependencies only while the orb is still, so a still frame
    // repaints with them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    type,
    size,
    reach,
    left,
    right,
    padL,
    padR,
    directionMargin,
    dark,
    speed,
    paused,
    reduced,
    hasSource,
    color,
    dots,
    dotSize,
    optsKey,
    customFrame,
    paused || reduced ? emotion : null,
    paused || reduced ? `${saturation}|${accent}|${gradientAngle}|${gradientSpin}|${neutral}|${colorBrightness}|${colorHue}|${gradientStart}|${gradientWidth}` : null
  ]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={ariaLabel ?? LABELS[state]}
      style={{ width: size + padL + padR, height: size, display: 'block', marginLeft: -padL, marginRight: -padR, ...style }}
      {...rest}
    />
  );
}
