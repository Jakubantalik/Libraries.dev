import {
  forwardRef,
  useId,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type CSSProperties,
  type ForwardedRef,
  type AnimationEvent,
  type MutableRefObject,
} from 'react';
import type { VoiceBeamProps, VoiceBeamTheme } from './types';
import { themePresets, voicePalettes, generateVoiceBeamCSS } from './styles';
import { registerVoiceInstance, releaseVoicePixels, resetVoiceLevel, summonVoicePixels, type VoiceDriverConfig } from './voiceDriver';
import { pixelDomeDefault, pixelDustDefault, pixelGlowDefault, resolveVoiceDefaults, resolveVoiceStyle } from './presets';
import { parseRgb, toTriple } from './color';

/** Band colour defaults per theme, as `r, g, b` triples. */
const BAND_COLORS = {
  dark: { core: '255, 255, 255', above: '255, 70, 80', mid: '90, 255, 150', below: '80, 140, 255' },
  light: { core: '197, 139, 255', above: '255, 122, 182', mid: '126, 196, 255', below: '45, 255, 171' },
} as const;

const BORDER_WIDTH = 1;
const DEFAULT_RADIUS = 16;

/* WebKit (Safari) evaluates SVG filters on HTML content on the CPU every
   paint, which on a phone-sized host drops the frame rate by an order of
   magnitude, so the displacement warp is off there above this host area:
   a chat input (~39k px²) or a pill keeps it, the phone crop (~97k px²)
   and any real screen do not. Its 2D canvas also has no \`filter\`, so the
   band's blur is done in CSS on two canvases instead (the ridge and its
   wider halo), keeping Chromium's look. The half-resolution soft layers
   are explicit (a per-layer factor on every length, not \`zoom\`), so they
   run on every engine; Safari 18 rasters them pre-scale as Chromium does. */
const WEBKIT_WARP_MAX_AREA = 60_000;
// Every iOS browser is WebKit whatever its name (CriOS, FxiOS); only
// desktop Blink carries "Chrome/".
const IS_WEBKIT =
  typeof navigator !== 'undefined' &&
  /AppleWebKit/.test(navigator.userAgent) &&
  !/Chrome\/|Chromium\/|Edg\/|OPR\//.test(navigator.userAgent);
const CANVAS_FILTER = (() => {
  if (typeof document === 'undefined') return true;
  const ctx = document.createElement('canvas').getContext('2d');
  return !!ctx && typeof (ctx as { filter?: unknown }).filter === 'string';
})();

/* Mosaic, dots and lines moved to Libraries Pro in 0.5.0 as look objects;
   their old names draw the glow. Said once per name, not every render. */
const warnedLooks = new Set<string>();
function warnLook(name: string): void {
  if (warnedLooks.has(name) || typeof console === 'undefined') return;
  warnedLooks.add(name);
  console.warn(
    `voice-glow: look="${name}" is not built in; drawing the glow. Built in: "glow", "dither". ` +
      (name === 'mosaic' || name === 'dots' || name === 'lines'
        ? 'Mosaic, dots and lines are Libraries Pro looks since 0.5.0: pass the look object (look={mosaic}).'
        : 'Other looks plug in as objects (VoiceLook).')
  );
}

function useSystemTheme(): 'dark' | 'light' {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light');
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return theme;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  return reduced;
}

function resolveTheme(theme: VoiceBeamTheme, systemTheme: 'dark' | 'light'): 'dark' | 'light' {
  return theme === 'auto' ? systemTheme : theme;
}

/**
 * VoiceBeam component — sound-reactive glow for React
 *
 * A centred, colourful beam along the bottom edge of the wrapped element
 * that rises and blooms with the level of a voice. Feed it a microphone
 * stream, or drive it yourself with `level`.
 *
 * @example
 * ```tsx
 * const mic = useMicrophone();
 *
 * <VoiceBeam stream={mic.stream}>
 *   <ChatInput />
 * </VoiceBeam>
 * ```
 */
export const VoiceBeam = forwardRef<HTMLDivElement, VoiceBeamProps>(
  function VoiceBeam(
    {
      children,
      type = 'default',
      look: lookProp = 'glow',
      pixelSize: pixelSizeProp,
      pixelGlow: pixelGlowProp,
      pixelDust: pixelDustProp,
      pixelDome: pixelDomeProp,
      pixelMagnet: pixelMagnetProp,
      pixelExitTarget,
      dotSize = 1,
      dotGap = 1,
      dotShape = 'round',
      lineWidth = 1,
      lineGap = 1,
      linePattern = 'rows',
      seeThrough = false,
      texture = 0.6,
      gravity = 1,
      surfaceHeight = 1,
      surfaceCurve = 1,
      surfaceTail = 0,
      surfaceTailPosition = 0.6,
      surfaceTailCurve = 2.4,
      surfaceFade = 0.2,
      scale: scaleProp,
      stream = null,
      level = 0,
      sensitivity = 3.1,
      threshold = 0.015,
      attack = 0.325,
      release = 0.86,
      idle: idleProp,
      breatheDuration = 5.2,
      reach: reachProp,
      spread: spreadProp,
      bands = true,
      flow: flowProp,
      motion = null,
      colorVariant = 'colorful',
      colors,
      tint,
      tintAmount = 1,
      bandColors,
      theme = 'dark',
      staticColors = false,
      hueRange: hueRangeProp,
      hueDuration: hueDurationProp,
      active = true,
      paused = false,
      borderRadius: customBorderRadius,
      brightness: brightnessProp,
      saturation: saturationProp,
      glowSize: glowSizeProp,
      strokeOpacity: strokeOpacityProp,
      innerOpacity: innerOpacityProp,
      bloomOpacity: bloomOpacityProp,
      bend: bendProp,
      bandStrength: bandStrengthProp,
      bandWidth: bandWidthProp,
      bandPosition: bandPositionProp,
      bandCurve: bandCurveProp,
      bandSpread: bandSpreadProp,
      bandSkew: bandSkewProp,
      bandOffset: bandOffsetProp,
      bandTail: bandTailProp,
      bandTailPosition: bandTailPositionProp,
      bandTailCurve: bandTailCurveProp,
      bandTailOverflow: bandTailOverflowProp,
      bandAberration: bandAberrationProp,
      distortion: distortionProp,
      distortionDetail: distortionDetailProp,
      glowWidth: glowWidthProp,
      glowHeight: glowHeightProp,
      lobeSpacing: lobeSpacingProp,
      rangeWidth: rangeWidthProp,
      rangeHeight: rangeHeightProp,
      softness: softnessProp,
      coreSize: coreSizeProp,
      coreLight: coreLightProp,
      coreLightWidth: coreLightWidthProp,
      coreLightHeight: coreLightHeightProp,
      strokeScale: strokeScaleProp,
      innerScale: innerScaleProp,
      innerHeight: innerHeightProp,
      bloomScale: bloomScaleProp,
      bloomHeight: bloomHeightProp,
      strength: strengthProp,
      className,
      style,
      css: extraCss,
      onLevel,
      onActivate,
      onDeactivate,
      onAnimationEnd: consumerOnAnimationEnd,
      ...props
    }: VoiceBeamProps,
    ref: ForwardedRef<HTMLDivElement>
  ) {
    const baseId = useId();
    const id = baseId.replace(/:/g, '-');

    const systemTheme = useSystemTheme();
    const resolvedTheme = resolveTheme(theme, systemTheme);

    // Custom colours are compared by value, so a fresh array literal each
    // render does not rebuild the stylesheet or re-register the driver.
    const colorsKey = colors ? colors.join('|') : '';
    const bandColorsKey = bandColors ? [bandColors.core, bandColors.above, bandColors.mid, bandColors.below].join('|') : '';

    // The type preset supplies the geometry defaults; an explicit prop
    // wins; `scale` then multiplies every pixel dimension as one.
    // The pixel looks carry their own tuning on top of the type's.
    // A look plugs in as an object (look.ts); the built-in ones are names,
    // and a name this build does not have is the glow.
    const lookPlugin = typeof lookProp === 'object' && lookProp !== null ? lookProp : null;
    const look = lookPlugin ? lookPlugin.name : lookProp === 'dither' ? 'dither' : 'glow';
    if (!lookPlugin && lookProp !== look) warnLook(String(lookProp));
    const d = resolveVoiceDefaults(type, resolvedTheme, lookPlugin ?? look);
    const sc = Math.max(0.05, scaleProp ?? d.scale);
    const glowSize = glowSizeProp ?? d.glowSize;
    const pixelSize = pixelSizeProp ?? d.pixelSize;
    const pixelMagnet = pixelMagnetProp ?? (lookPlugin?.kind === 'pixel' ? lookPlugin.magnet ?? 0.7 : 0.7);
    const pixelGlow = pixelGlowProp ?? pixelGlowDefault(type, look);
    const pixelDust = pixelDustProp ?? pixelDustDefault(type);
    const pixelDome = pixelDomeProp ?? pixelDomeDefault(type);
    const strokeOpacityMul = strokeOpacityProp ?? d.strokeOpacity;
    const innerOpacityMul = innerOpacityProp ?? d.innerOpacity;
    const bloomOpacityMul = bloomOpacityProp ?? d.bloomOpacity;
    const idle = idleProp ?? d.idle;
    const reach = reachProp ?? d.reach;
    const spread = spreadProp ?? d.spread;
    const flow = (flowProp ?? d.flow) * sc;
    const bend = (bendProp ?? d.bend) * sc;
    const bandStrength = bandStrengthProp ?? d.bandStrength;
    const bandWidth = (bandWidthProp ?? d.bandWidth) * sc;
    const bandPosition = bandPositionProp ?? d.bandPosition;
    const bandCurve = bandCurveProp ?? d.bandCurve;
    const bandSpread = bandSpreadProp ?? d.bandSpread;
    const bandSkew = bandSkewProp ?? d.bandSkew;
    const bandOffset = (bandOffsetProp ?? d.bandOffset) * sc;
    const bandTail = bandTailProp ?? d.bandTail;
    const bandTailPosition = bandTailPositionProp ?? d.bandTailPosition;
    const bandTailCurve = bandTailCurveProp ?? d.bandTailCurve;
    const bandTailOverflow = (bandTailOverflowProp ?? d.bandTailOverflow) * sc;
    const bandAberration = bandAberrationProp ?? d.bandAberration;
    const distortionBase = distortionProp ?? d.distortion;
    const distortionDetail = (distortionDetailProp ?? d.distortionDetail) / sc;
    const glowWidth = (glowWidthProp ?? d.glowWidth) * sc;
    const glowHeight = (glowHeightProp ?? d.glowHeight) * sc;
    const lobeSpacing = (lobeSpacingProp ?? d.lobeSpacing) * sc;
    const rangeWidth = (rangeWidthProp ?? d.rangeWidth) * sc;
    const rangeHeight = (rangeHeightProp ?? d.rangeHeight) * sc;
    const softness = softnessProp ?? d.softness;
    const coreSize = (coreSizeProp ?? d.coreSize) * sc;
    const coreLight = Math.max(0, Math.min(3, coreLightProp ?? d.coreLight));
    const coreLightWidth = coreLightWidthProp ?? d.coreLightWidth;
    const coreLightHeight = coreLightHeightProp ?? d.coreLightHeight;
    const strokeScale = strokeScaleProp ?? d.strokeScale;
    const innerScale = innerScaleProp ?? d.innerScale;
    const innerHeight = innerHeightProp ?? d.innerHeight;
    const bloomScale = bloomScaleProp ?? d.bloomScale;
    const bloomHeight = bloomHeightProp ?? d.bloomHeight;
    const reducedMotion = useReducedMotion();
    const internalRef = useRef<HTMLDivElement>(null);

    const [isActive, setIsActive] = useState(active);
    const [isFading, setIsFading] = useState(false);
    const [isVisible, setIsVisible] = useState(true);
    const [detectedRadius, setDetectedRadius] = useState<number | null>(null);
    /* The host's area, measured on WebKit only, to keep the warp off large hosts there. */
    const [hostArea, setHostArea] = useState(0);
    useEffect(() => {
      if (!IS_WEBKIT) return;
      const el = internalRef.current;
      if (!el) return;
      const measure = () => setHostArea(el.clientWidth * el.clientHeight);
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, []);
    // A surface look paints its own canvas instead of the glow's layers.
    const isSurface = lookPlugin?.kind === 'surface';
    // The dither and the plugged-in pixel looks: the glow itself, sampled onto the same canvas.
    const isPixel = look === 'dither' || lookPlugin?.kind === 'pixel';
    const onCanvas = isSurface || isPixel;
    const engine = isPixel ? 'pixel' : isSurface ? 'surface' : 'glow';
    // The WebKit gate is about the SVG warp's cost; the surface has no warp.
    const distortion = onCanvas ? 0 : IS_WEBKIT && hostArea > WEBKIT_WARP_MAX_AREA ? 0 : distortionBase;

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
        if (!isNaN(raw) && raw > 0) setDetectedRadius(raw);
      };

      detect();
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

    // The pixel looks: as the effect closes, a few pixels fly into the
    // element that closed it; as it opens again, a few fly out of it to
    // their places. A layout effect, so a close runs while the driver still
    // has this instance — before any passive effect's cleanup.
    const wasActive = useRef(active);
    useLayoutEffect(() => {
      const closing = wasActive.current && !active;
      const opening = !wasActive.current && active;
      wasActive.current = active;
      const el = internalRef.current;
      if (opening && el) resetVoiceLevel(el);
      if (!(closing || opening) || !isPixel || !el || !pixelExitTarget) return;
      const host = el.getBoundingClientRect();
      const t = pixelExitTarget.getBoundingClientRect();
      const point = { x: t.left + t.width / 2 - host.left, y: t.top + t.height / 2 - host.top, w: t.width, h: t.height };
      if (closing) releaseVoicePixels(el, point);
      else if (!reducedMotion) {
        summonVoicePixels(el, point);
        // The wave holds back a beat so the pixels lead (see the stylesheet).
        el.setAttribute('data-arriving', '');
        window.setTimeout(() => el.removeAttribute('data-arriving'), 1200);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active]);

    // Stop the per-frame work while the element is scrolled offscreen.
    useEffect(() => {
      const el = internalRef.current;
      if (!el || typeof IntersectionObserver === 'undefined') return;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) setIsVisible(entry.isIntersecting);
        },
        { rootMargin: '256px' }
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, []);

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

    const preset = themePresets[resolvedTheme];
    const finalBorderRadius = customBorderRadius ?? detectedRadius ?? DEFAULT_RADIUS;
    const typeStyle = resolveVoiceStyle(type, resolvedTheme);
    const strength = strengthProp ?? typeStyle.strength ?? preset.strength ?? 1;
    const hueRange = hueRangeProp ?? preset.hueRange ?? 24;
    const hueDuration = hueDurationProp ?? preset.hueDuration ?? 12;
    const finalBrightness = brightnessProp ?? typeStyle.brightness ?? preset.brightness;
    const finalSaturation = saturationProp ?? typeStyle.saturation ?? preset.saturation;

    const cssStyles = useMemo(
      () =>
        generateVoiceBeamCSS({
          id,
          borderRadius: finalBorderRadius,
          borderWidth: BORDER_WIDTH,
          strokeOpacity: preset.strokeOpacity * strokeOpacityMul,
          innerOpacity: preset.innerOpacity * innerOpacityMul,
          bloomOpacity: preset.bloomOpacity * bloomOpacityMul,
          innerShadow: preset.innerShadow,
          colorVariant,
          colors,
          brightness: finalBrightness,
          saturation: finalSaturation,
          theme: resolvedTheme,
          hueBase: preset.hueBase ?? 0,
          glowSize: glowSize * sc,
          glowWidth,
          glowHeight,
          strokeScale,
          innerScale,
          innerHeight,
          bloomScale,
          bloomHeight,
          coreSize,
          coreLight,
          coreLightWidth,
          coreLightHeight,
          rangeWidth,
          rangeHeight,
          softness,
          distortion: distortion > 0,
          scale: sc,
          look: engine,
        }),
      [
        id,
        finalBorderRadius,
        preset,
        colorVariant,
        colorsKey,
        finalBrightness,
        finalSaturation,
        resolvedTheme,
        d,
        glowSize,
        strokeOpacityMul,
        innerOpacityMul,
        bloomOpacityMul,
        sc,
        glowWidth,
        glowHeight,
        strokeScale,
        innerScale,
        innerHeight,
        bloomScale,
        bloomHeight,
        coreSize,
        coreLight,
        coreLightWidth,
        coreLightHeight,
        rangeWidth,
        rangeHeight,
        softness,
        distortion > 0,
        engine,
      ]
    );

    // Runtime config for the shared driver. Numbers only, so a re-render
    // with the same knobs does not re-register the instance.
    const driverConfig = useMemo<VoiceDriverConfig>(
      () => ({
        id,
        sensitivity: Math.max(0, sensitivity),
        threshold: Math.max(0, Math.min(0.95, threshold)),
        attack: Math.max(0, attack),
        release: Math.max(0, release),
        idle: Math.max(0, Math.min(1, idle)),
        breatheDuration: Math.max(0.2, breatheDuration),
        reach: Math.max(0, reach),
        spread: Math.max(0, spread),
        bands,
        flow,
        lobeSpacing: Math.max(0.1, lobeSpacing),
        bend: Math.max(0, bend),
        bandStrength: Math.max(0, bandStrength),
        bandWidth: Math.max(0, bandWidth),
        bandPosition: Math.max(0, bandPosition),
        bandCurve: Math.max(0.3, bandCurve),
        bandSpread: Math.max(0.05, bandSpread),
        bandSkew: Math.max(-0.9, Math.min(0.9, bandSkew)),
        bandOffset,
        bandTail: Math.max(0, Math.min(1.5, bandTail)),
        bandTailPosition: Math.max(0, Math.min(0.98, bandTailPosition)),
        bandTailCurve: Math.max(0.5, bandTailCurve),
        bandTailOverflow: Math.max(0, bandTailOverflow),
        bandAberration: Math.max(0, Math.min(1, bandAberration)),
        rangeWidth,
        rangeHeight,
        theme: resolvedTheme,
        tint: (tint && parseRgb(tint)) || null,
        tintAmount: Math.max(0, Math.min(1, tintAmount)),
        bandColors: {
          core: (bandColors?.core && toTriple(bandColors.core)) || BAND_COLORS[resolvedTheme].core,
          above: (bandColors?.above && toTriple(bandColors.above)) || BAND_COLORS[resolvedTheme].above,
          mid: (bandColors?.mid && toTriple(bandColors.mid)) || BAND_COLORS[resolvedTheme].mid,
          below: (bandColors?.below && toTriple(bandColors.below)) || BAND_COLORS[resolvedTheme].below,
        },
        distortion: Math.max(0, Math.min(1, distortion)),
        coreLight,
        scale: sc,
        radius: finalBorderRadius,
        hueRange: Math.max(0, hueRange),
        hueDuration: Math.max(0.5, hueDuration),
        staticColors: colorVariant === 'mono' ? true : staticColors,
        reducedMotion,
        paused,
        look,
        lookPlugin,
        // The pixel looks paint the palette themselves: the variant's
        // colours with any custom ones in their slots, as the stylesheet has.
        palette: voicePalettes[colorVariant][resolvedTheme].map((c, i) => {
          const custom = colors?.[i];
          return (custom && parseRgb(custom)) || parseRgb(c) || [255, 255, 255];
        }),
        saturation: finalSaturation,
        hueBase: preset.hueBase ?? 0,
        pixelSize: Math.max(0.3, pixelSize),
        pixelGlow: Math.max(0, Math.min(1, pixelGlow)),
        pixelDust: Math.max(0, pixelDust),
        pixelDome: Math.max(0, pixelDome),
        pixelMagnet: Math.max(0, Math.min(1, pixelMagnet)),
        dotSize: Math.max(0.1, dotSize),
        dotGap: Math.max(0.3, dotGap),
        dotShape: dotShape === 'square' ? 'square' : 'round',
        lineWidth: Math.max(0.05, lineWidth),
        lineGap: Math.max(0.3, lineGap),
        linePattern: linePattern === 'columns' || linePattern === 'grid' ? linePattern : 'rows',
        seeThrough,
        texture: Math.max(0, Math.min(1, texture)),
        gravity: Math.max(0.05, gravity),
        surfaceHeight: Math.max(0.1, surfaceHeight),
        surfaceCurve: Math.max(-3, Math.min(5, surfaceCurve)),
        surfaceTail: Math.max(-2, Math.min(3, surfaceTail)),
        surfaceTailPosition: Math.max(0, Math.min(0.98, surfaceTailPosition)),
        surfaceTailCurve: Math.max(0.5, surfaceTailCurve),
        surfaceFade: Math.max(0, Math.min(1, surfaceFade)),
        layers: {
          glowWidth,
          glowHeight,
          innerScale,
          innerHeight,
          bloomScale,
          bloomHeight,
          strokeScale,
          softness,
          coreSize,
          innerOpacity: innerOpacityMul,
          bloomOpacity: bloomOpacityMul,
          strokeOpacity: strokeOpacityMul,
          brightness: finalBrightness,
        },
      }),
      [
        id,
        sensitivity,
        threshold,
        attack,
        release,
        idle,
        breatheDuration,
        reach,
        spread,
        bands,
        flow,
        lobeSpacing,
        bend,
        bandStrength,
        bandWidth,
        bandPosition,
        bandCurve,
        bandSpread,
        bandSkew,
        bandOffset,
        bandTail,
        bandTailPosition,
        bandTailCurve,
        bandTailOverflow,
        bandAberration,
        rangeWidth,
        rangeHeight,
        resolvedTheme,
        tint,
        tintAmount,
        bandColorsKey,
        distortion,
        coreLight,
        sc,
        finalBorderRadius,
        hueRange,
        hueDuration,
        staticColors,
        colorVariant,
        reducedMotion,
        paused,
        look,
        lookPlugin,
        pixelSize,
        pixelGlow,
        pixelDust,
        pixelDome,
        pixelMagnet,
        colorsKey,
        finalSaturation,
        preset,
        dotSize,
        dotGap,
        dotShape,
        lineWidth,
        lineGap,
        linePattern,
        seeThrough,
        texture,
        gravity,
        surfaceHeight,
        surfaceCurve,
        surfaceTail,
        surfaceTailPosition,
        surfaceTailCurve,
        surfaceFade,
        glowWidth,
        glowHeight,
        innerScale,
        innerHeight,
        bloomScale,
        bloomHeight,
        strokeScale,
        softness,
        coreSize,
        innerOpacityMul,
        bloomOpacityMul,
        strokeOpacityMul,
        finalBrightness,
      ]
    );

    // The manual level and the onLevel callback are read through refs so a
    // changing value does not tear the driver down and up every render.
    const levelRef = useRef(level);
    levelRef.current = level;
    const onLevelRef = useRef(onLevel);
    onLevelRef.current = onLevel;
    const motionRef = useRef(motion);
    motionRef.current = motion;

    useEffect(() => {
      if (!(isActive || isFading) || !isVisible) return;
      const el = internalRef.current;
      if (!el) return;

      const getLevel = () => {
        const current = levelRef.current;
        return typeof current === 'function' ? current() : current;
      };
      const report = (value: number) => onLevelRef.current?.(value);
      const getMotion = () => {
        const current = motionRef.current;
        return typeof current === 'function' ? current() : current;
      };

      return registerVoiceInstance(el, driverConfig, { stream, getLevel, getMotion }, report);
    }, [driverConfig, stream, isActive, isFading, isVisible]);

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
      '--voice-strength': Math.max(0, Math.min(1, strength)),
    } as CSSProperties;

    return (
      <>
        <style>{extraCss ? `${cssStyles}\n${extraCss.split('{id}').join(id)}` : cssStyles}</style>
        <div
          {...props}
          ref={setRefs}
          data-voice-beam={id}
          data-voice-type={type}
          data-voice-look={look}
          data-voice-halfres=""
          data-active={isActive && !isFading ? '' : undefined}
          data-fading={isFading ? '' : undefined}
          data-paused={isActive && !isFading && (!isVisible || paused) ? '' : undefined}
          data-listening={stream ? '' : undefined}
          className={className}
          style={mergedStyle}
          onAnimationEnd={handleAnimationEnd}
        >
          {children}
          {isPixel && <canvas data-voice-beam-pixel-glow aria-hidden="true" />}
          {onCanvas && <canvas data-voice-beam-surface aria-hidden="true" />}
          {isPixel && <canvas data-voice-beam-flyers aria-hidden="true" />}
          {!onCanvas && <div data-voice-beam-bloom />}
          {!onCanvas && distortion > 0 && (
            <>
              {/* Mirrors of the inner light and bloom, clipped to below the
                  band line and carrying the displacement filter. */}
              <div data-voice-beam-warp="inner" />
              <div data-voice-beam-warp="bloom" />
            </>
          )}
          {!onCanvas && !CANVAS_FILTER && <canvas data-voice-beam-band-halo aria-hidden="true" />}
          {!onCanvas && <canvas data-voice-beam-band aria-hidden="true" />}
          {/* After the band canvases, so the wash sits over the band's halo
              under the line (it is clipped to below the line, so the ridge
              itself stays) while the host's own content stays above it. */}
          {!onCanvas && coreLight > 0 && (
            <div data-voice-beam-core>
              <div />
            </div>
          )}
          {!onCanvas && distortion > 0 && (
            /* The distortion filter: drifting fractal noise, its green
               channel pinned to 0.5 so only x displaces, driven per frame by
               the driver (scale and offset), which also narrows the region
               to the strip under the band line once it runs — the full box
               here is only the first frame. Zero-sized, so it takes no room. */
            <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
              <filter
                id={`vb-distort-${id}`}
                x="-20%"
                y="-20%"
                width="140%"
                height="140%"
                colorInterpolationFilters="sRGB"
              >
                <feTurbulence
                  type="fractalNoise"
                  baseFrequency={`${(0.012 * distortionDetail).toFixed(4)} ${(0.05 * distortionDetail).toFixed(4)}`}
                  numOctaves={2}
                  seed={7}
                  result="noise"
                />
                <feOffset in="noise" dx="0" dy="0" result="moved" />
                <feColorMatrix
                  in="moved"
                  type="matrix"
                  values="1 0 0 0 0  0 0 0 0 0.5  0 0 0 0 0  0 0 0 0 1"
                  result="map"
                />
                <feDisplacementMap in="SourceGraphic" in2="map" scale={0} xChannelSelector="R" yChannelSelector="G" />
              </filter>
            </svg>
          )}
        </div>
      </>
    );
  }
);

export default VoiceBeam;
