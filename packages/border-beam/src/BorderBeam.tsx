import {
  forwardRef,
  useId,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type CSSProperties,
  type ForwardedRef,
  type AnimationEvent,
  type MutableRefObject,
} from 'react';
import type { BorderBeamProps, BorderBeamTheme } from './types';
import { sizePresets, sizeThemePresets, generateBeamCSS, getPulseDriverConfig } from './styles';
import { registerPulseInstance } from './pulseDriver';

function useSystemTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return theme;
}

function resolveTheme(theme: BorderBeamTheme, systemTheme: 'dark' | 'light'): 'dark' | 'light' {
  return theme === 'auto' ? systemTheme : theme;
}

/**
 * BorderBeam component - Animated border beam effect for React
 *
 * @example
 * ```tsx
 * <BorderBeam>
 *   <Card>Content</Card>
 * </BorderBeam>
 * ```
 */
export const BorderBeam = forwardRef<HTMLDivElement, BorderBeamProps>(
  function BorderBeam(
    {
      children,
      size = 'md',
      colorVariant = 'colorful',
      theme = 'dark',
      staticColors = false,
      duration,
      active = true,
      borderRadius: customBorderRadius,
      brightness: brightnessProp,
      saturation,
      hueRange = 30,
      glowSize = 1,
      strength = 1,
      className,
      style,
      css: extraCss,
      onActivate,
      onDeactivate,
      onAnimationEnd: consumerOnAnimationEnd,
      ...props
    }: BorderBeamProps,
    ref: ForwardedRef<HTMLDivElement>
  ) {
    const baseId = useId();
    const id = baseId.replace(/:/g, '-');
    const systemTheme = useSystemTheme();
    const internalRef = useRef<HTMLDivElement>(null);

    const [isActive, setIsActive] = useState(active);
    const [isFading, setIsFading] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [detectedRadius, setDetectedRadius] = useState<number | null>(null);
    const [pulseGlowScale, setPulseGlowScale] = useState<{ x: number; y: number }>({ x: 1, y: 1 });

    // Auto-detect child border radius when no explicit value is provided
    useEffect(() => {
      if (customBorderRadius != null) return;
      const el = internalRef.current;
      if (!el) return;

      const detect = () => {
        const child = el.firstElementChild as HTMLElement | null;
        if (!child) return;
        const computed = getComputedStyle(child);
        const raw = parseFloat(computed.borderTopLeftRadius);
        if (!isNaN(raw) && raw > 0) {
          setDetectedRadius(raw);
        }
      };

      detect();

      // Re-detect if child layout changes (e.g. CSS loaded late)
      const observer = new MutationObserver(detect);
      observer.observe(el, { childList: true, subtree: false });
      return () => observer.disconnect();
    }, [customBorderRadius, children]);

    useEffect(() => {
      if (active && !isActive && !isFading) {
        setIsActive(true);
      } else if (!active && isActive && !isFading) {
        setIsFading(true);
      }
    }, [active, isActive, isFading]);

    // Pause the (paint-heavy) animations while the element is scrolled offscreen.
    // This stops per-frame painting entirely for hidden instances without changing
    // their logical active/fading state, so it never fires onActivate/onDeactivate.
    useEffect(() => {
      const el = internalRef.current;
      if (!el || typeof IntersectionObserver === 'undefined') return;

      const observer = new IntersectionObserver(
        entries => {
          for (const entry of entries) setIsVisible(entry.isIntersecting);
        },
        // Start animating slightly before the element scrolls into view.
        { rootMargin: '256px' }
      );

      observer.observe(el);
      return () => observer.disconnect();
    }, []);

    // Pulse Outside glow geometry is authored in fixed pixels for a reference
    // element (~350x140). Measure the actual wrapped element and scale the glow
    // per-axis so the halo grows/shrinks to fit any component it's applied to.
    useEffect(() => {
      if (size !== 'pulse-outside') {
        setPulseGlowScale(prev => (prev.x === 1 && prev.y === 1 ? prev : { x: 1, y: 1 }));
        return;
      }

      const el = internalRef.current;
      if (!el) return;

      const REF_WIDTH = 350;
      const REF_HEIGHT = 140;
      // Allow the glow to both shrink (small buttons) and grow (large cards),
      // with generous bounds to avoid degenerate geometry at the extremes.
      const MIN_SCALE = 0.35;
      const MAX_SCALE = 4;
      const clamp = (value: number) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, value));

      const measure = () => {
        const child = el.firstElementChild as HTMLElement | null;
        if (!child) return;
        const rect = child.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const x = +clamp(rect.width / REF_WIDTH).toFixed(3);
        const y = +clamp(rect.height / REF_HEIGHT).toFixed(3);
        setPulseGlowScale(prev => (prev.x === x && prev.y === y ? prev : { x, y }));
      };

      measure();
      if (typeof ResizeObserver === 'undefined') return;

      const child = el.firstElementChild as HTMLElement | null;
      if (!child) return;

      const resizeObserver = new ResizeObserver(measure);
      resizeObserver.observe(child);
      return () => resizeObserver.disconnect();
    }, [size, children]);

    const handleAnimationEnd = useCallback(
      (e: AnimationEvent<HTMLDivElement>) => {
        const animationName = e.animationName;

        if (animationName.includes('fade-out')) {
          setIsActive(false);
          setIsFading(false);
          onDeactivate?.();
        } else if (animationName.includes('fade-in')) {
          onActivate?.();
        }

        consumerOnAnimationEnd?.(e);
      },
      [onActivate, onDeactivate, consumerOnAnimationEnd]
    );

    const resolvedTheme = resolveTheme(theme, systemTheme);
    const themeConfig = sizeThemePresets[size][resolvedTheme];
    const sizeConfig = sizePresets[size];

    const isPulse = size === 'pulse-inner' || size === 'pulse-outside';

    const finalBorderRadius = customBorderRadius ?? detectedRadius ?? sizeConfig.borderRadius;
    const finalDuration = duration ?? (size === 'line' ? 3.1 : isPulse ? 2.3 : 1.96);
    const finalSaturation = saturation ?? themeConfig.saturation;
    const finalBrightness = brightnessProp ?? themeConfig.brightness ?? 1.3;
    const finalHueRange = size === 'line' ? Math.min(hueRange, 13) : hueRange;
    const finalStaticColors = colorVariant === 'mono' ? true : staticColors;

    const cssStyles = useMemo(
      () =>
        generateBeamCSS({
          id,
          borderRadius: finalBorderRadius,
          borderWidth: sizeConfig.borderWidth,
          duration: finalDuration,
          strokeOpacity: themeConfig.strokeOpacity,
          innerOpacity: themeConfig.innerOpacity,
          bloomOpacity: themeConfig.bloomOpacity,
          innerShadow: themeConfig.innerShadow,
          size,
          colorVariant,
          staticColors: finalStaticColors,
          brightness: finalBrightness,
          saturation: finalSaturation,
          hueRange: finalHueRange,
          theme: resolvedTheme,
          hairlineOpacity: themeConfig.hairlineOpacity,
          glowSize,
        }),
      [
        id,
        finalBorderRadius,
        sizeConfig.borderWidth,
        finalDuration,
        themeConfig.strokeOpacity,
        themeConfig.innerOpacity,
        themeConfig.bloomOpacity,
        themeConfig.innerShadow,
        themeConfig.hairlineOpacity,
        size,
        colorVariant,
        finalStaticColors,
        finalBrightness,
        finalSaturation,
        finalHueRange,
        glowSize,
        resolvedTheme,
      ]
    );

    // Runtime config for the JS breathing driver (null for non-pulse sizes).
    const driverConfig = useMemo(
      () =>
        isPulse
          ? getPulseDriverConfig(size, resolvedTheme, finalDuration, finalHueRange, finalStaticColors, id)
          : null,
      [isPulse, size, resolvedTheme, finalDuration, finalHueRange, finalStaticColors, id]
    );

    // Drive the Pulse breathing from the shared, fps-capped rAF loop while the
    // instance is on, onscreen, and the user hasn't requested reduced motion.
    useEffect(() => {
      if (!driverConfig) return;
      if (!(isActive || isFading) || !isVisible) return;

      const el = internalRef.current;
      if (!el) return;

      if (
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ) {
        return;
      }

      return registerPulseInstance(el, driverConfig);
    }, [driverConfig, isActive, isFading, isVisible]);

    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        (internalRef as MutableRefObject<HTMLDivElement | null>).current = node;
        if (typeof ref === 'function') {
          ref(node);
        } else if (ref) {
          (ref as MutableRefObject<HTMLDivElement | null>).current = node;
        }
      },
      [ref]
    );

    const mergedStyle = {
      ...(style ?? {}),
      '--beam-strength': Math.max(0, Math.min(1, strength)),
      ...(size === 'pulse-outside'
        ? { '--pulse-glow-sx': pulseGlowScale.x, '--pulse-glow-sy': pulseGlowScale.y }
        : {}),
    } as CSSProperties;

    return (
      <>
        <style>{extraCss ? `${cssStyles}\n${extraCss.split('{id}').join(id)}` : cssStyles}</style>
        <div
          {...props}
          ref={setRefs}
          data-beam={id}
          data-active={isActive && !isFading ? '' : undefined}
          data-fading={isFading ? '' : undefined}
          data-paused={isActive && !isFading && !isVisible ? '' : undefined}
          className={className}
          style={mergedStyle}
          onAnimationEnd={handleAnimationEnd}
        >
          {children}
          <div data-beam-bloom />
        </div>
      </>
    );
  }
);

export default BorderBeam;
