import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { MetalFxInstance } from './engine/renderer/core';
import {
  createInstance,
  destroyInstance,
  registerGlowInstance,
  setGlowCallback,
  setInstanceVisible,
  setSharedPreset,
  unregisterGlowInstance,
  updateInstance,
  refreshInstanceDpr,
} from './engine/renderer/loop';
import { carryGlowState, injectGlow, updateGlow, updateGlowMask, type GlowOptions } from './engine/glow/glow';
import { attachCursorLight, detachCursorLight } from './engine/cursor/light';
import { RIM_DEFAULTS, injectRim, removeRim, updateRim, type RimHandles, type RimOptions } from './engine/rim';
import { subscribeGlowConfig } from './engine/glow/config';
import { addReflectionTarget, removeReflectionTarget } from './engine/reflection/paint';
import { isMetalFxSupported } from './engine/renderer/core';
import { scheduleReflectionPaint } from './engine/reflection/reflectionScheduler';
import { ensureStylesInjected } from './styles';
import type { MetalFxProps, MetalFxTheme } from './types';

// Runs at module scope so styles exist before the first component render,
// even in SSR-hydration scenarios where effects haven't fired yet.
ensureStylesInjected();

// Hoisted to avoid allocating new objects on every render.
const CANVAS_STYLE: CSSProperties = { position: 'absolute', inset: 0, width: '100%', height: '100%' };
const INNER_STYLE: CSSProperties = { position: 'absolute', inset: 3 };
const GLOW_HOST_STYLE: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3, borderRadius: 'inherit' };
// Rim sits above the metal and the glow, below the content.
const RIM_HOST_STYLE: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 4 };

// Maps each live instance to its SVG glow handles and a theme ref.
// Keyed by instance (not component) because the same component can be
// remounted with a new instance after shape/glowEnabled changes.
const glowHandlesMap = new Map<MetalFxInstance, { handles: ReturnType<typeof injectGlow>; themeRef: { current: 'dark' | 'light' } }>();
// Opt-in introspection for the demo's dev tooling: with
// `globalThis.__MFX_DEBUG__ = true` the live instance → glow map is exposed
// as `globalThis.__mfxGlow` on the next mount. Never set in production.
function exposeGlowDebug(): void {
  const g = globalThis as { __MFX_DEBUG__?: boolean; __mfxGlow?: unknown };
  if (g.__MFX_DEBUG__) g.__mfxGlow = glowHandlesMap;
}

// Bridge between the shared animation loop and per-instance glow SVGs.
// The loop module doesn't import glow directly — it invokes this callback
// for one queued instance per frame (round-robin), keeping render work
// proportional to frame budget regardless of instance count.
setGlowCallback((inst, nowMs) => {
  const entry = glowHandlesMap.get(inst);
  if (!entry) return false;
  return updateGlow(entry.handles, inst, nowMs, inst.opacityMul * inst.glowGain, entry.themeRef.current);
});

/**
 * Resolves 'auto' theme to 'dark' | 'light' and keeps it in sync with
 * the OS preference via matchMedia.
 *
 * The useState initialiser runs synchronously so the resolved value is
 * available on the first render (no flash). The useEffect then attaches
 * the MQL listener and calls update() immediately to handle the case
 * where the OS preference changed between SSR and hydration.
 */
function useResolvedTheme(theme: MetalFxTheme): 'dark' | 'light' {
  const [resolved, setResolved] = useState<'dark' | 'light'>(() => {
    if (theme !== 'auto') return theme;
    if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    if (theme !== 'auto') { setResolved(theme); return; }
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setResolved(mql.matches ? 'dark' : 'light');
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, [theme]);

  return resolved;
}

/**
 * Wraps any element with an animated metallic ring effect driven by a
 * single shared WebGL renderer. All visible MetalFx instances on the page
 * share one offscreen GL canvas; each instance composites a cropped/scaled
 * copy of it onto its own 2D canvas with a rounded hole punched through the
 * centre.
 */
export const MetalFx = forwardRef<HTMLDivElement, MetalFxProps>(function MetalFx(
  {
    children,
    variant = 'button',
    preset = 'chromatic',
    theme = 'auto',
    strength = 1,
    glowGain = 1,
    paused = false,
    borderRadius,
    normalizeHostStyles = true,
    reflectionTargets,
    disableGlow = false,
    innerShadow,
    shaderScale,
    ringCssPx,
    scale = 1,
    mask,
    glowMode = 'mask',
    className,
    style,
    ...rest
  },
  forwardedRef
) {
  // DOM refs — rootRef/canvasRef/glowHostRef/contentRef are for direct DOM access.
  // instanceRef/glowHandlesRef hold engine objects that survive React re-renders.
  // themeRef lets the glow callback read the current theme without a closure
  // over a stale value — mutated during render, never triggers a re-render.
  // initialWrapperRadiusRef caches the CSS border-radius read at mount time so
  // measure() can fall back to it when no explicit borderRadius prop is given.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glowHostRef = useRef<HTMLDivElement | null>(null);
  const rimHostRef = useRef<HTMLDivElement | null>(null);
  const rimHandlesRef = useRef<RimHandles | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<MetalFxInstance | null>(null);
  const glowHandlesRef = useRef<ReturnType<typeof injectGlow> | null>(null);
  const themeRef = useRef<'dark' | 'light'>('dark');
  const initialWrapperRadiusRef = useRef<number>(0);

  const [ready, setReady] = useState(false);
  const resolvedTheme = useResolvedTheme(theme);
  // No WebGL2 → no engine. Every effect below bails on this, and the render
  // falls through to the plain child so the button is never lost.
  const supported = useMemo(() => isMetalFxSupported(), []);
  // Write during render (not in an effect) so the glow callback always sees
  // the up-to-date theme on the very next tick.
  themeRef.current = resolvedTheme;
  const shape: 'pill' | 'circle' = variant === 'circle' ? 'circle' : 'pill';
  const glowEnabled = !disableGlow;

  useImperativeHandle(forwardedRef, () => rootRef.current as HTMLDivElement, []);

  const resolveRadius = (w: number, h: number) => {
    // variant='circle' is the user's explicit promise that the wrapped
    // element should render as a circle. Always pick min(w,h)/2 so the
    // engine produces a true circle even when the child's CSS border-radius
    // is read in a different coordinate space than the bounding rect (the
    // exact failure mode under CSS `zoom: 2`, where getComputedStyle
    // returns source pixels but getBoundingClientRect returns zoomed ones).
    if (shape === 'circle') return Math.min(w, h) / 2;

    const raw = typeof borderRadius === 'number'
      ? borderRadius
      : (() => {
          const childEl = contentRef.current?.firstElementChild as HTMLElement | null;
          if (childEl) {
            const parsed = parseFloat(getComputedStyle(childEl).borderTopLeftRadius);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
          }
          return initialWrapperRadiusRef.current;
        })();
    return Math.min(raw, Math.min(w, h) / 2);
  };

  useEffect(() => { if (supported) setSharedPreset(preset, resolvedTheme); }, [preset, resolvedTheme, supported]);
  useEffect(() => {
    const inst = instanceRef.current;
    if (inst) updateInstance(inst, { mask: mask ?? null });
  }, [mask]);
  // `paused` is per-instance: it freezes only this instance's 2D canvas while
  // the shared GL loop keeps running for any other unpaused instance.
  useEffect(() => {
    const inst = instanceRef.current;
    if (!inst) return;
    updateInstance(inst, { paused });
  }, [paused]);

  // Re-sync optional shader/ring/scale overrides if they change at runtime.
  useEffect(() => {
    const inst = instanceRef.current;
    if (!inst) return;
    const patch: Partial<Parameters<typeof updateInstance>[1]> = {};
    if (shaderScale !== undefined) patch.shaderScale = shaderScale;
    if (ringCssPx !== undefined) patch.ringCssPx = ringCssPx;
    if (scale !== undefined) patch.scale = scale;
    if (Object.keys(patch).length > 0) updateInstance(inst, patch);
  }, [shaderScale, ringCssPx, scale]);

  // useLayoutEffect (not useEffect) so the instance is created and the canvas
  // is sized synchronously before the browser paints — avoids a one-frame
  // flash of the unsized canvas.
  // biome-ignore lint/correctness/useExhaustiveDependencies: borderRadius changes handled by separate effect
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const root = rootRef.current;
    const glowHost = glowHostRef.current;
    if (!canvas || !root || !supported) return;

    {
      const computed = getComputedStyle(root);
      const parsed = parseFloat(computed.borderTopLeftRadius);
      initialWrapperRadiusRef.current = Number.isFinite(parsed) ? parsed : 0;
    }

    const measure = () => {
      const rect = root.getBoundingClientRect();
      const cssWidth = Math.max(1, Math.round(rect.width));
      const cssHeight = Math.max(1, Math.round(rect.height));
      return { cssWidth, cssHeight, cornerRadius: resolveRadius(cssWidth, cssHeight) };
    };

    const initial = measure();
    instanceRef.current = createInstance({
      onComposite: () => {
        const inst = instanceRef.current;
        const h = glowHandlesRef.current;
        if (inst && h) updateGlowMask(h, inst.deform);
        const r = rimHandlesRef.current;
        if (inst && r) updateRim(r, inst.deform);
      },
      hostCanvas: canvas,
      cssWidth: initial.cssWidth,
      cssHeight: initial.cssHeight,
      cornerRadius: initial.cornerRadius,
      kind: shape,
      paused,
      shaderScale,
      ringCssPx,
      scale,
      mask: mask ?? null,
      onFirstCopy: () => setReady(true),
    });
    root.style.setProperty('--mfx-radius', `${initial.cornerRadius}px`);
    root.style.borderRadius = `${initial.cornerRadius}px`;

    // Custom-mask instances feed the glow a point set inside the glyphs and
    // the mask itself as an image, so the halo sits *on the metal* and is
    // clipped to it — not to a ring band that doesn't exist.
    const glowMaskData = (w: number, h: number): Pick<GlowOptions, 'samplePoints' | 'maskDataUrl'> => {
      if (!mask || glowMode === 'ring') return {};
      const dpr = window.devicePixelRatio || 1;
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr));
      const g = c.getContext('2d');
      if (!g) return {};
      g.fillStyle = '#fff';
      mask(g, c.width, c.height, dpr);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      const pts: Array<{ x: number; y: number }> = [];
      const step = Math.max(1, Math.round(2 * dpr)); // ~2 CSS px grid
      for (let y = step >> 1; y < c.height; y += step) {
        for (let x = step >> 1; x < c.width; x += step) {
          if (d[(y * c.width + x) * 4 + 3] > 128) pts.push({ x: x / dpr, y: y / dpr });
        }
      }
      return { samplePoints: pts, maskDataUrl: c.toDataURL('image/png') };
    };

    if (glowHost) {
      glowHandlesRef.current = injectGlow(glowHost, {
        width: initial.cssWidth,
        height: initial.cssHeight,
        cornerRadius: initial.cornerRadius,
        kind: shape,
        scale,
        ...glowMaskData(initial.cssWidth, initial.cssHeight),
      });
    }

    const rebuildGlow = (dims: { cssWidth: number; cssHeight: number; cornerRadius: number }) => {
      if (!glowHost) return;
      const prev = glowHandlesRef.current;
      glowHost.innerHTML = '';
      glowHandlesRef.current = injectGlow(glowHost, {
        width: dims.cssWidth, height: dims.cssHeight, cornerRadius: dims.cornerRadius, kind: shape, scale,
        ...glowMaskData(dims.cssWidth, dims.cssHeight),
      });
      // A rebuild is a fresh, invisible glow. Carry the old one's state over so
      // a resize doesn't read as "the glow vanished, then came back elsewhere".
      if (prev) carryGlowState(prev, glowHandlesRef.current);
      const inst = instanceRef.current;
      if (inst && glowHandlesRef.current) {
        glowHandlesMap.set(inst, { handles: glowHandlesRef.current, themeRef });
      }
    };

    const rimOpts = (): RimOptions | null => {
      if (!innerShadow) return null;
      return innerShadow === true ? RIM_DEFAULTS : { ...RIM_DEFAULTS, ...innerShadow };
    };
    const rebuildRim = (dims: { cssWidth: number; cssHeight: number; cornerRadius: number }) => {
      const host = rimHostRef.current;
      const inst = instanceRef.current;
      removeRim(rimHandlesRef.current);
      rimHandlesRef.current = null;
      const o = rimOpts();
      if (!host || !inst || !o) return;
      rimHandlesRef.current = injectRim(host, { width: dims.cssWidth, height: dims.cssHeight, cornerRadius: dims.cornerRadius, kind: shape, ring: inst.ringCssPx }, o);
    };
    rebuildRim(initial);

    let resizeRaf = 0;
    // Last dimensions the glow was built for. ResizeObserver fires on any box
    // change — including ones that leave the size identical (re-layout, font
    // load, a parent's transform) — and rebuilding the glow for those restarts
    // it from invisible, which reads as the halo blinking out with no fade.
    let builtW = initial.cssWidth, builtH = initial.cssHeight, builtR = initial.cornerRadius;
    const ro = new ResizeObserver(() => {
      if (resizeRaf !== 0) return;
      // RAF-debounce: coalesce multiple resize events within the same frame and
      // skip any that fire while a frame is already queued.
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
        const next = measure();
        const inst = instanceRef.current;
        if (!inst) return;
        const same = Math.abs(next.cssWidth - builtW) < 0.5 && Math.abs(next.cssHeight - builtH) < 0.5
          && Math.abs(next.cornerRadius - builtR) < 0.5;
        if (same) return;
        builtW = next.cssWidth; builtH = next.cssHeight; builtR = next.cornerRadius;
        updateInstance(inst, { cssWidth: next.cssWidth, cssHeight: next.cssHeight, cornerRadius: next.cornerRadius });
        root.style.setProperty('--mfx-radius', `${next.cornerRadius}px`);
        root.style.borderRadius = `${next.cornerRadius}px`;
        rebuildGlow(next);
        rebuildRim(next);
      });
    });
    ro.observe(root);

    // Browser zoom changes the DPR but not the CSS box, so the observer above
    // stays quiet and every raster (metal, glow, rim) would stay at the old
    // resolution. A resolution query fires once per DPR change; re-arm it
    // for the new value each time.
    let dprMql: MediaQueryList | null = null;
    const onDpr = () => {
      const inst = instanceRef.current;
      if (inst && refreshInstanceDpr(inst)) { const next = measure(); rebuildGlow(next); rebuildRim(next); }
      watchDpr();
    };
    const watchDpr = () => {
      dprMql?.removeEventListener('change', onDpr);
      dprMql = typeof window.matchMedia === 'function' ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`) : null;
      dprMql?.addEventListener('change', onDpr);
    };
    watchDpr();

    // Glow markup params (stroke widths, blurs, blob lengths) are baked into
    // the SVG, so a live config change to one of them means a rebuild. Runtime
    // params are read per-frame and need nothing here.
    const unsubGlow = subscribeGlowConfig((markupChanged) => {
      if (markupChanged && instanceRef.current) rebuildGlow(measure());
    });

    // Skip GL compositing for off-screen instances — the loop checks inst.visible
    // before copyShaderToInstance, so hidden instances cost nothing per frame.
    // rootMargin: 64px starts rendering slightly before the element scrolls into view.
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(
        (entries) => { const inst = instanceRef.current; if (!inst) return; for (const e of entries) setInstanceVisible(inst, e.isIntersecting); },
        { rootMargin: '64px' }
      );
      io.observe(root);
    }

    if (instanceRef.current && glowHandlesRef.current) {
      glowHandlesMap.set(instanceRef.current, { handles: glowHandlesRef.current, themeRef });
      registerGlowInstance(instanceRef.current);
    }
    attachCursorLight();
    exposeGlowDebug();

    return () => {
      detachCursorLight();
      removeRim(rimHandlesRef.current);
      rimHandlesRef.current = null;
      ro.disconnect();
      dprMql?.removeEventListener('change', onDpr);
      io?.disconnect();
      unsubGlow();
      if (resizeRaf !== 0) cancelAnimationFrame(resizeRaf);
      const inst = instanceRef.current;
      if (inst) {
        glowHandlesMap.delete(inst);
        unregisterGlowInstance(inst);
        destroyInstance(inst);
      }
      instanceRef.current = null;
      glowHandlesRef.current = null;
      if (glowHost) glowHost.innerHTML = '';
    };
  }, [shape]);

  // strength=1 maps directly to a full-opacity composite (opacityMul=1) for
  // every variant. Per-preset toning lives in `shaderOpacity` inside each
  // PresetMode, not here, so buttons and circles share the same headroom.
  useEffect(() => {
    const inst = instanceRef.current;
    if (!inst) return;
    updateInstance(inst, { opacityMul: Math.max(0, Math.min(1, strength)), glowGain: Math.max(0, glowGain) });
  }, [strength, glowGain, variant]);

  // onAfterFrame is wired here rather than at createInstance time so instances
  // without reflectionTargets never schedule the reflection RAF.
  // Reflections are dark-mode only — no DOM work in light mode.
  useEffect(() => {
    const inst = instanceRef.current;
    const root = rootRef.current;
    if (!inst || !root || !reflectionTargets || resolvedTheme !== 'dark') return;
    inst.onAfterFrame = scheduleReflectionPaint;
    const live = reflectionTargets.flatMap((r) => {
      const ref = 'current' in r ? r : r.ref;
      const strength = 'current' in r ? 1 : (r.strength ?? 1);
      return ref.current ? [{ el: ref.current, strength }] : [];
    });
    for (const { el, strength } of live) addReflectionTarget(el, inst, root, strength);
    return () => {
      inst.onAfterFrame = undefined;
      for (const { el } of live) removeReflectionTarget(el);
    };
  }, [reflectionTargets, resolvedTheme]);

  // Separate from the main lifecycle effect so borderRadius / variant / theme
  // changes re-sync the radius without destroying and recreating the instance.
  // biome-ignore covers shape, which is derived from variant and identical to
  // inst.kind — adding it would be correct but redundant.
  // biome-ignore lint/correctness/useExhaustiveDependencies: trigger deps for radius re-sync
  useEffect(() => {
    const root = rootRef.current;
    const inst = instanceRef.current;
    if (!root || !inst) return;
    const cornerRadius = resolveRadius(inst.cssWidth, inst.cssHeight);
    updateInstance(inst, { cornerRadius });
    root.style.setProperty('--mfx-radius', `${cornerRadius}px`);
    root.style.borderRadius = `${cornerRadius}px`;
  }, [borderRadius, resolvedTheme, variant, shape]);

  // --mfx-strength is consumed by downstream CSS (e.g. content opacity rules).
  // Spread style last so consumer inline styles can still override other props.
  const wrapperStyle = useMemo<CSSProperties>(
    () => ({
      ...style,
      ['--mfx-strength' as string]: String(Math.min(1, Math.max(0, strength))),
      opacity: ready ? 1 : 0,
      visibility: ready ? 'visible' : 'hidden',
      transition: ready ? 'opacity 0.15s ease-out' : 'none',
    }),
    [style, strength, ready]
  );

  if (!supported) {
    // Graceful degradation: the wrapped element with its own styling intact —
    // no normalisation, no canvas, no glow. Consumers can style
    // `[data-metal-fx-unsupported]` if they want a static stand-in ring.
    return (
      <div
        {...rest}
        ref={rootRef}
        className={className ? `metal-fx-fallback ${className}` : 'metal-fx-fallback'}
        data-metal-fx-unsupported=""
        style={{ display: 'inline-flex', ...style }}
      >
        {children}
      </div>
    );
  }

  return (
    <div
      {...rest}
      ref={rootRef}
      className={className ? `metal-fx-root ${className}` : 'metal-fx-root'}
      data-variant={variant}
      data-shape={shape}
      data-theme={resolvedTheme}
      data-paused={paused ? 'true' : undefined}
      data-normalize={normalizeHostStyles ? 'true' : 'false'}
      style={wrapperStyle}
    >
      <canvas ref={canvasRef} className="metal-fx-canvas" style={CANVAS_STYLE} />
      <div className="metal-fx-inner" aria-hidden="true" style={INNER_STYLE} />
      <div ref={glowHostRef} aria-hidden="true" style={{ ...GLOW_HOST_STYLE, display: glowEnabled ? undefined : 'none' }} />
      {innerShadow ? <div ref={rimHostRef} aria-hidden="true" style={RIM_HOST_STYLE} /> : null}
      <div ref={contentRef} className="metal-fx-content">{children}</div>
    </div>
  );
});

MetalFx.displayName = 'MetalFx';
