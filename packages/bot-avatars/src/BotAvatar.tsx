import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type MouseEvent } from 'react';
import type { BotAvatarProps, BotAvatarShading, BotAvatarState } from './types';
import { botAvatarPresets, stateLabels } from './presets';
import { SHAPE_PATHS, SHAPE_PARTS } from './shapes';
import { autoInk, shade } from './color';
import { Sim, restPose } from './engine';
import { draw, OVERSCAN, type DrawConfig } from './draw';
import { warmPlastic } from './plastic';
import { subscribe, pointer } from './ticker';

/* A 0–1 seed from the React id, so two avatars side by side never blink
   in step unless asked to. */
function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 1));

const pathCache = new Map<string, Path2D>();
function bodyPath(d: string): Path2D {
  let p = pathCache.get(d);
  if (!p) {
    p = new Path2D(d);
    pathCache.set(d, p);
  }
  return p;
}

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const BotAvatar = forwardRef<HTMLCanvasElement, BotAvatarProps>(function BotAvatar(
  {
    type = 'clover',
    face,
    state = 'default',
    size = 64,
    color,
    ink,
    brightness = 1,
    saturation = 1,
    speed = 1,
    paused = false,
    seed,
    shading = 'plastic',
    shadow = 0.35,
    highlight = 1.3,
    depth = 0.65,
    light = 265,
    rim = 0.5,
    spread = 1.55,
    interactive = true,
    theme = 'auto',
    className,
    style,
    'aria-label': ariaLabel,
    ...rest
  },
  ref
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useImperativeHandle(ref, () => canvasRef.current as HTMLCanvasElement);
  const reactId = useId();
  const preset = botAvatarPresets[type] ?? botAvatarPresets.clover;
  const faceKind = face ?? preset.face;
  const picked = color ?? preset.color;
  const body =
    brightness === 1 && saturation === 1
      ? picked
      : shade(picked, (Math.min(2, Math.max(0, brightness)) - 1) * 0.35, (Math.min(2, Math.max(0, saturation)) - 1) * 0.5);
  const inkColor = ink ?? autoInk(body);
  const seedValue = Math.min(1, Math.max(0, seed ?? hashSeed(reactId)));
  const stateKey: BotAvatarState = state in stateLabels ? state : 'default';
  const frozen = paused || !(speed > 0);
  const shadingMode: BotAvatarShading = shading === true ? 'crisp' : shading === false ? 'flat' : shading;

  /* the sim lives across renders; props reach it through refs */
  const sim = useRef<Sim | null>(null);
  const cfg = useRef<DrawConfig | null>(null);
  const cssSize = useRef(0);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  cfg.current = {
    path: typeof Path2D === 'undefined' ? (null as unknown as Path2D) : bodyPath(SHAPE_PATHS[type] ?? SHAPE_PATHS.clover),
    face: faceKind,
    faceX: preset.faceX,
    faceY: preset.faceY,
    faceScale: preset.faceScale,
    color: body,
    ink: inkColor,
    shading: shadingMode,
    shadow: clamp(shadow, 0, 2),
    highlight: clamp(highlight, 0, 2),
    depth: clamp(depth, 0.2, 2),
    light,
    rim: clamp(rim, 0, 2),
    spread: clamp(spread, 0.4, 2.5),
    typeKey: type,
    still: frozen || reducedMotion(),
    parts: typeof Path2D !== 'undefined' && SHAPE_PARTS[type] ? bodyPath(SHAPE_PARTS[type] as string) : undefined,
  };

  /* the surface: an ancestor's say, else the system's */
  const resolveTheme = (el: HTMLElement | null): 'dark' | 'light' => {
    if (theme !== 'auto') return theme;
    const host = el?.closest('[data-theme], .dark, .light') as HTMLElement | null;
    if (host) {
      const v = host.getAttribute('data-theme');
      if (v === 'dark' || v === 'light') return v;
      if (host.classList.contains('dark')) return 'dark';
      if (host.classList.contains('light')) return 'light';
    }
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  };

  /* paint the current pose, sizing the backing store to the element */
  const paint = () => {
    const canvas = canvasRef.current;
    const c = cfg.current;
    if (!canvas || !c || !c.path) return;
    c.theme = resolveTheme(canvas);
    /* a hidden ancestor measures 0: keep the last size rather than
       wiping the backing store */
    const px = canvas.clientWidth / OVERSCAN || cssSize.current || (typeof size === 'number' ? size : 64);
    if (!px) return;
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const want = Math.round(px * OVERSCAN * dpr);
    if (canvas.width !== want || canvas.height !== want) {
      canvas.width = want;
      canvas.height = want;
    }
    cssSize.current = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pose = sim.current ? sim.current.pose : restPose(stateKey);
    draw(ctx, px, pose, c);
  };

  /* first paint before the browser shows the frame */
  useLayoutEffect(() => {
    if (!sim.current) sim.current = new Sim(seedValue, stateKey);
    else sim.current.setState(stateKey);
    if (reducedMotion()) {
      /* the still pose of the state, no loop */
      const canvas = canvasRef.current;
      if (canvas && cfg.current && cfg.current.path) {
        const px = canvas.clientWidth / OVERSCAN || cssSize.current || (typeof size === 'number' ? size : 64);
        if (!px) return;
        cssSize.current = px;
        const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
        canvas.width = canvas.height = Math.round(px * OVERSCAN * dpr);
        const ctx = canvas.getContext('2d');
        if (ctx) {
          cfg.current.theme = resolveTheme(canvas);
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          draw(ctx, px, restPose(stateKey), cfg.current);
        }
      }
      return;
    }
    paint();
  });

  /* plastic bakes its form per type; start that on idle time at mount so
     the first frames do not stand in with the smooth look for long */
  useEffect(() => {
    if (shadingMode !== 'plastic' || !cfg.current?.path) return;
    const path = cfg.current.path;
    const dev = (typeof size === 'number' ? size : 64) * Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const ric = (typeof requestIdleCallback === 'function' ? requestIdleCallback : (fn: () => void) => setTimeout(fn, 1)) as (fn: () => void) => number;
    const id = ric(() => warmPlastic(type, path, dev, depth));
    return () => {
      if (typeof cancelIdleCallback === 'function') cancelIdleCallback(id);
      else clearTimeout(id);
    };
  }, [shadingMode, type, size, depth]);

  /* the loop: only while visible, animated and not reduced */
  useEffect(() => {
    if (frozen || reducedMotion()) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    let onScreen = true;
    let unsub: (() => void) | null = null;
    /* how far the pointer's pull reaches, in head widths */
    const REACH = 3;
    const tick = (dt: number) => {
      const s = sim.current;
      if (!s) return;
      if (interactiveRef.current && !Number.isNaN(pointer.x)) {
        const r = canvas.getBoundingClientRect();
        const box = r.width / OVERSCAN || 1;
        const dx = (pointer.x - (r.left + r.width / 2)) / box;
        const dy = (pointer.y - (r.top + r.height / 2)) / box;
        const d = Math.hypot(dx, dy);
        /* full pull up close, gone by REACH */
        const strength = d < 1 ? 1 : d > REACH ? 0 : 1 - (d - 1) / (REACH - 1);
        s.setPointer(dx / Math.max(1, d), dy / Math.max(1, d), strength);
      } else s.setPointer(0, 0, 0);
      s.update(dt * speedRef.current);
      paint();
    };
    const run = () => {
      if (!unsub) unsub = subscribe(tick);
    };
    const stop = () => {
      if (unsub) unsub();
      unsub = null;
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
        if (onScreen) run();
        else stop();
      });
      io.observe(canvas);
    } else run();
    return () => {
      stop();
      if (io) io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frozen]);

  /* The canvas overscans its box (see draw.ts) and pulls itself back in
     with negative margins, so it lays out at `size` and still has room
     to hop and flip. */
  const dim = typeof size === 'number' ? `${size * OVERSCAN}px` : `calc(${size} * ${OVERSCAN})`;
  const pull = typeof size === 'number' ? `${(-size * (OVERSCAN - 1)) / 2}px` : `calc(${size} * ${-(OVERSCAN - 1) / 2})`;
  const css: CSSProperties = { display: 'inline-block', verticalAlign: 'middle', width: dim, height: dim, margin: pull, flex: 'none', ...style };

  const onClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (interactive && !frozen) sim.current?.poke();
    rest.onClick?.(e);
  };

  return (
    <canvas
      ref={canvasRef}
      className={className ? `ba ${className}` : 'ba'}
      data-bot-avatar={type}
      data-face={faceKind}
      data-state={stateKey}
      role="img"
      aria-label={ariaLabel ?? `${preset.label} bot, ${stateLabels[stateKey]}`}
      style={css}
      {...rest}
      onClick={onClick}
    />
  );
});

export default BotAvatar;
