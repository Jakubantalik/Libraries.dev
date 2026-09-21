import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PixelRatio, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import {
  BlendColor,
  Blur,
  Canvas,
  ColorMatrix,
  Group,
  Image,
  Mask,
  Paint,
  Path,
  Rect,
  Shader,
  Skia,
  useClock,
} from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { LIQUID_METAL_SKSL } from './shader';
import { materialUniforms, presetMaterial, sampleLuminance, sampleMaterial, sheetMapping, type MetalPreset, type MetalTheme } from './material';
import { bandPath, outlinePath, roundRectOutline, rrPerim, shapeKind, shapePerim, type Deform } from './geometry';
import { BEND_DEFAULTS, deformPoint, useBendField, useTilt, type BendConfig } from './bend';
import { GLOW_DEFAULTS, configureGlow, extraSprite, glowTick, haloSprite, initialGlowState, type GlowConfig, type GlowFrame } from './glow';
import { CLOCK_EPOCH, registerAnchor, registerMeasurer, unregisterAnchor, updateAnchorFrame, updateAnchorLook, type MetalAnchor } from './registry';

let effect: ReturnType<typeof Skia.RuntimeEffect.Make> | null = null;
export function liquidMetalEffect() {
  if (!effect) {
    effect = Skia.RuntimeEffect.Make(LIQUID_METAL_SKSL);
    if (!effect) throw new Error('metal-fx-native: the liquid-metal shader failed to compile');
  }
  return effect;
}

/** Material time in seconds, shared across instances, pause-aware. */
export function useMetalTime(paused: boolean): SharedValue<number> {
  const clock = useClock();
  const mountOffset = useMemo(() => Date.now() - CLOCK_EPOCH, []);
  const pause = useSharedValue({ at: -1, total: 0 });
  useEffect(() => {
    const now = clock.value;
    const p = pause.value;
    if (paused && p.at < 0) pause.value = { at: now, total: p.total };
    if (!paused && p.at >= 0) pause.value = { at: -1, total: p.total + (now - p.at) };
  }, [paused, clock, pause]);
  return useDerivedValue(() => {
    const p = pause.value;
    const c = p.at >= 0 ? p.at : clock.value;
    return (c + mountOffset) / 1000 - p.total / 1000;
  });
}

export interface MetalFxProps {
  variant?: 'button' | 'circle';
  preset?: MetalPreset;
  theme?: MetalTheme;
  /** 0..1 — multiplies the material's opacity and the glow. */
  strength?: number;
  /** Defaults to the variant's (button 1.6, circle 1.3). */
  shaderScale?: number;
  /** Band width, pt; defaults to the variant's (button 1, circle 2). */
  ringWidth?: number;
  /** Defaults to fully rounded. */
  cornerRadius?: number;
  /** The Figma inner-shadow hairline along the band's top inside edge. */
  innerShadow?: boolean;
  glow?: boolean;
  glowGain?: number;
  paused?: boolean;
  /** Bend with the phone's tilt. */
  tilt?: boolean;
  bendConfig?: BendConfig;
  glowConfig?: GlowConfig;
  /** Surface colour under the content; defaults to the theme's. */
  fill?: string;
  /** Anchor id for `MetalReflection` / `MetalEdgeHalo`. */
  id?: string;
  /** Manual tilt (x right, y down, in g) for the simulator; null = sensor. */
  tiltOverride?: SharedValue<{ dx: number; dy: number } | null>;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

const GLOW_MARGIN = 48;

/**
 * The liquid-metal ring around any content — metal-fx v2's `<MetalFx>`.
 * Wraps `children` tightly; the band runs along their edge with the glow,
 * rims and inner shadow between the two. The whole animation runs on the UI
 * thread: time, tilt, bend physics, glow and shader uniforms are shared
 * values — React never re-renders per frame.
 */
export function MetalFx({
  variant = 'button', preset = 'chromatic', theme = 'dark', strength = 1, shaderScale, ringWidth, cornerRadius,
  innerShadow = false, glow = true, glowGain = 1, paused = false, tilt = true, bendConfig = BEND_DEFAULTS,
  glowConfig = GLOW_DEFAULTS, fill, id, tiltOverride, style, children,
}: MetalFxProps) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  const viewRef = useRef<View>(null);
  const size = useSharedValue({ width: 0, height: 0 });
  const radiusSV = useSharedValue(0);

  const ring = ringWidth ?? (variant === 'circle' ? 2 : 1);
  const scale = shaderScale ?? (variant === 'circle' ? 1.3 : 1.6);
  const radius = Math.min(cornerRadius ?? Infinity, Math.min(box.width, box.height) / 2);
  const kind = shapeKind(box.width, box.height, radius);
  const material = useMemo(() => presetMaterial(preset, theme), [preset, theme]);
  const opacityMul = strength * material.shaderOpacity;
  const mapping = useMemo(() => sheetMapping(box.width, box.height, scale), [box.width, box.height, scale]);
  const dpr = PixelRatio.get();

  const time = useMetalTime(paused);
  const tiltV = useTilt(tilt, tiltOverride);
  const field = useBendField(tiltV, size, radiusSV, bendConfig, tilt);

  useEffect(() => { size.value = box; radiusSV.value = radius; }, [box, radius, size, radiusSV]);

  // Anchor registration for reflections / the edge halo.
  const anchorRef = useRef<MetalAnchor | null>(null);
  useEffect(() => {
    if (!id) return;
    const a: MetalAnchor = {
      id, frame: { x: 0, y: 0, width: 0, height: 0 }, width: box.width, height: box.height, cornerRadius: radius, ringWidth: ring,
      kind, material, mapping, opacityMul, isSheet: false, time, field,
    };
    anchorRef.current = a;
    registerAnchor(a);
    return () => { unregisterAnchor(id, a); anchorRef.current = null; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const a = anchorRef.current;
    if (a) updateAnchorLook(a, { width: box.width, height: box.height, cornerRadius: radius, ringWidth: ring, kind, material, mapping, opacityMul, time, field });
  }, [box, radius, ring, kind, material, mapping, opacityMul, time, field]);

  const measure = useCallback(() => {
    viewRef.current?.measureInWindow((x, y, w, h) => {
      const a = anchorRef.current;
      if (a) updateAnchorFrame(a, { x, y, width: w, height: h });
    });
  }, []);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ width, height });
    measure();
  }, [measure]);
  useEffect(() => registerMeasurer(measure), [measure]);

  // Geometry for this frame: outlines displaced by the bend field.
  const paths = useDerivedValue(() => {
    const { width: W, height: H } = size.value;
    const R = radiusSV.value;
    const f = field.value;
    const deform: Deform = f ? (x, y) => deformPoint(f, x, y) : null;
    const outer = roundRectOutline(0, 0, W, H, R, deform);
    const inner = roundRectOutline(ring, ring, W - 2 * ring, H - 2 * ring, Math.max(0, R - ring), deform);
    const rimW = variant === 'circle' ? 2 : 1;
    const rimInner = roundRectOutline(rimW, rimW, W - 2 * rimW, H - 2 * rimW, Math.max(0, R - rimW), deform);
    const hair = roundRectOutline(-0.5, -0.5, W + 1, H + 1, R + 0.5, deform);
    return { fill: outlinePath(outer), band: bandPath(outer, inner), rim: bandPath(outer, rimInner), hair: outlinePath(hair) };
  });
  const fillPath = useDerivedValue(() => paths.value.fill);
  const band = useDerivedValue(() => paths.value.band);
  const rimPath = useDerivedValue(() => paths.value.rim);
  const hairPath = useDerivedValue(() => paths.value.hair);

  const uniforms = useDerivedValue(() => materialUniforms(material, mapping, time.value, opacityMul, dpr));

  // Glow: the state machine steps with the clock, on the UI thread.
  const glowState = useSharedValue(initialGlowState());
  const glowFrame = useDerivedValue<GlowFrame | null>(() => {
    if (!glow) return null;
    const { width: W, height: H } = size.value;
    if (W < 1) return null;
    const s = glowState.value;
    configureGlow(s, W, H, radiusSV.value, kind, glowConfig, null);
    const t = time.value;
    const f = field.value;
    const deform = f ? (x: number, y: number) => deformPoint(f, x, y) : null;
    const lum = (x: number, y: number) => sampleLuminance(material, mapping.ox + x * mapping.sx, mapping.oy + y * mapping.sy, t);
    const rgb = (x: number, y: number) => sampleMaterial(material, mapping.ox + x * mapping.sx, mapping.oy + y * mapping.sy, t);
    return glowTick(s, Date.now(), lum, rgb, strength * glowGain, theme === 'light', deform, glowConfig);
  });

  const ratio = shapePerim(box.width, box.height, radius, kind) / rrPerim(140, 40, 20);
  const halo = useMemo(() => (box.width > 0 ? haloSprite(Math.max(1, glowConfig.haloHalfLen * ratio), 1, dpr, glowConfig) : null), [box.width, ratio, dpr, glowConfig]);
  const extra = useMemo(() => (box.width > 0 ? extraSprite(Math.max(0.6, glowConfig.extraHalfLen * ratio), 1, dpr, glowConfig) : null), [box.width, ratio, dpr, glowConfig]);

  const surface = fill ?? (theme === 'dark' ? '#272727' : '#ffffff');
  const rimColor = theme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)';
  const m = GLOW_MARGIN;
  const cw = box.width + 2 * m, ch = box.height + 2 * m;

  return (
    <View ref={viewRef} onLayout={onLayout} style={[{ alignSelf: 'flex-start' }, style]}>
      {box.width > 0 && (
        <Canvas opaque={false} style={{ position: 'absolute', left: -m, top: -m, width: cw, height: ch }} pointerEvents="none">
          <Group transform={[{ translateX: m }, { translateY: m }]}>
            <Path path={fillPath} color={surface} />
            <Path path={band}>
              <Shader source={liquidMetalEffect()} uniforms={uniforms} />
            </Path>
            {variant === 'circle' && theme === 'dark' && (
              <Path path={hairPath} style="stroke" strokeWidth={1} color="rgba(0,0,0,0.45)" />
            )}
            <Path path={rimPath} color={rimColor} />
            {glow && halo && extra && (
              <GlowLayer frame={glowFrame} halo={halo} extra={extra} band={band} width={box.width} height={box.height} margin={m} theme={theme} small={kind === 'circle' && Math.min(box.width, box.height) <= 44} />
            )}
            {innerShadow && <InnerShadow band={band} />}
          </Group>
        </Canvas>
      )}
      {children}
    </View>
  );
}

/** The Figma inner shadow: the band minus itself shifted down — done with
 *  clips, not a blurred layer with `dstOut`: a second image-filter layer in
 *  the same canvas made Skia apply the filter to everything drawn before it. */
export function InnerShadow({ band, offsetY = 1, alpha = 0.9 }: { band: SharedValue<ReturnType<typeof Skia.Path.Make>>; offsetY?: number; alpha?: number }) {
  const shifted = useDerivedValue(() => {
    const p = band.value.copy();
    p.offset(0, offsetY);
    return p;
  });
  return (
    <Group clip={band}>
      <Group clip={shifted} invertClip>
        <Path path={band} color="white" opacity={alpha} />
      </Group>
    </Group>
  );
}

function GlowLayer({ frame, halo, extra, band, width, height, margin, theme, small }: {
  frame: SharedValue<GlowFrame | null>;
  halo: ReturnType<typeof haloSprite>;
  extra: ReturnType<typeof extraSprite>;
  band: SharedValue<ReturnType<typeof Skia.Path.Make>>;
  width: number; height: number; margin: number;
  theme: MetalTheme; small: boolean;
}) {
  const haloXf = useDerivedValue(() => { const f = frame.value; return f ? [{ translateX: f.x }, { translateY: f.y }, { rotate: f.tangent }] : [{ translateX: -1e4 }]; });
  const extraXf = useDerivedValue(() => { const f = frame.value; return f ? [{ translateX: f.ex }, { translateY: f.ey }, { rotate: f.tangent }] : [{ translateX: -1e4 }]; });
  const haloOp = useDerivedValue(() => frame.value?.haloOp ?? 0);
  const extraOp = useDerivedValue(() => frame.value?.extraOp ?? 0);
  const env = useDerivedValue(() => (frame.value?.env ?? 0) * (theme === 'light' ? 0.2746 : 0.7));
  const tint = useDerivedValue(() => {
    const t = frame.value?.tint ?? [1, 1, 1];
    return `rgb(${Math.round(t[0] * 255)},${Math.round(t[1] * 255)},${Math.round(t[2] * 255)})`;
  });
  const extraTint = useDerivedValue(() => {
    if (theme !== 'light') return 'white';
    const t = frame.value?.tint ?? [1, 1, 1];
    const mx = Math.max(t[0], t[1], t[2]), mn = Math.min(t[0], t[1], t[2]);
    const d = mx - mn;
    let h = 0;
    if (d > 0) { if (mx === t[0]) h = (t[1] - t[2]) / d + (t[1] < t[2] ? 6 : 0); else if (mx === t[1]) h = (t[2] - t[0]) / d + 2; else h = (t[0] - t[1]) / d + 4; h /= 6; }
    const s = Math.min(1, (mx > 0 ? d / mx : 0) * 2.625), v = Math.max(0.31, mx * 1.008);
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - s * f), tt = v * (1 - s * (1 - f));
    const rgb = [[v, tt, p], [q, v, p], [p, v, tt], [p, q, v], [tt, p, v], [v, p, q]][i % 6];
    return `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`;
  });
  const sat = small ? 7.5 : 5.355;
  const br = small ? 0.6 : 0.78;
  // Saturation matrix scaled by brightness — CSS saturate() brightness().
  const lightMatrix = useMemo(() => {
    const lr = 0.2126, lg = 0.7152, lb = 0.0722, s = sat, b = br;
    return [
      (lr + (1 - lr) * s) * b, (lg - lg * s) * b, (lb - lb * s) * b, 0, 0,
      (lr - lr * s) * b, (lg + (1 - lg) * s) * b, (lb - lb * s) * b, 0, 0,
      (lr - lr * s) * b, (lg - lg * s) * b, (lb + (1 - lb) * s) * b, 0, 0,
      0, 0, 0, 1, 0,
    ];
  }, [sat, br]);
  return (
    <Group opacity={env} blendMode={theme === 'light' ? 'multiply' : undefined} layer={theme === 'light' ? <Paint><ColorMatrix matrix={lightMatrix} /></Paint> : undefined}>
      <Mask mode="alpha" mask={
        <Group>
          <Rect x={-margin} y={-margin} width={width + 2 * margin} height={height + 2 * margin} color="rgba(255,255,255,0.5)" />
          <Path path={band} color="white" />
        </Group>
      }>
        <Group transform={haloXf} opacity={haloOp}>
          <Image image={halo.image} x={-halo.w / 2} y={-halo.h / 2} width={halo.w} height={halo.h}>
            <BlendColor color={tint} mode="modulate" />
          </Image>
        </Group>
        <Group transform={extraXf} opacity={extraOp}>
          <Image image={extra.image} x={-extra.w / 2} y={-extra.h / 2} width={extra.w} height={extra.h}>
            <BlendColor color={extraTint} mode="modulate" />
          </Image>
        </Group>
      </Mask>
    </Group>
  );
}
