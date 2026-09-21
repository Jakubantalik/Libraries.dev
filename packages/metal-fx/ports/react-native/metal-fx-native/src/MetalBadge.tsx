import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { PixelRatio, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Blur, Canvas, Group, Paint, RadialGradient, Rect, RoundedRect, Shader, Text, rect, rrect, vec, LinearGradient } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { liquidMetalEffect, useMetalTime } from './MetalFx';
import { materialUniforms, presetMaterial, sheetMapping, type MetalPreset, type MetalTheme } from './material';
import { useMetalFont } from './MetalText';
import { registerAnchor, registerMeasurer, unregisterAnchor, updateAnchorFrame, updateAnchorLook, type MetalAnchor } from './registry';
import type { BendField } from './bend';

export interface MetalBadgeCore { r: number; blur: number; a: number; size: number }

export interface MetalBadgeProps {
  children?: string;
  preset?: MetalPreset;
  theme?: MetalTheme;
  strength?: number;
  /** Size multiplier on the Figma metrics (45×25, 12.222 pt). */
  scale?: number;
  metalOpacity?: number;
  shaderScale?: number;
  core?: MetalBadgeCore;
  gradient?: number;
  glow?: number;
  textColor?: string;
  paused?: boolean;
  id?: string;
  style?: StyleProp<ViewStyle>;
}

export const METAL_BADGE_DEFAULTS = {
  metalOpacity: 0.8,
  shaderScale: 1.6,
  core: { r: 46, blur: 100, a: 0.94, size: 49 } as MetalBadgeCore,
  gradient: 0,
  glow: 0.41,
};

const W = 45, H = 25, RADIUS = 55.556;

/**
 * The "New" badge (Figma 1458:40880): a white pill with the material over
 * it, a clean white core under the label so the metal lives at the rim, the
 * inset white glows and hairlines, and the label.
 */
export function MetalBadge({
  children: text = 'New', preset = 'chromatic', theme = 'dark', strength = 1, scale = 1,
  metalOpacity = METAL_BADGE_DEFAULTS.metalOpacity, shaderScale = METAL_BADGE_DEFAULTS.shaderScale,
  core = METAL_BADGE_DEFAULTS.core, gradient = METAL_BADGE_DEFAULTS.gradient, glow = METAL_BADGE_DEFAULTS.glow,
  textColor = '#323232', paused = false, id, style,
}: MetalBadgeProps) {
  const w = W * scale, h = H * scale, r = RADIUS * scale;
  const material = useMemo(() => presetMaterial(preset, theme), [preset, theme]);
  const mapping = useMemo(() => sheetMapping(w, h, shaderScale), [w, h, shaderScale]);
  const opacityMul = strength * metalOpacity * material.shaderOpacity;
  const dpr = PixelRatio.get();
  const time = useMetalTime(paused);
  const uniforms = useDerivedValue(() => materialUniforms(material, mapping, time.value, opacityMul, dpr));
  const nullField = useSharedValue<BendField | null>(null);
  const font = useMetalFont(12.222 * scale, '600');
  const tw = font.measureText(text).width;
  const metrics = font.getMetrics();
  const baseline = h / 2 + (-metrics.ascent - metrics.descent) / 2;

  const viewRef = useRef<View>(null);
  const anchorRef = useRef<MetalAnchor | null>(null);
  useEffect(() => {
    if (!id) return;
    const a: MetalAnchor = {
      id, frame: { x: 0, y: 0, width: 0, height: 0 }, width: w, height: h, cornerRadius: r, ringWidth: 0, kind: 'pill',
      material, mapping, opacityMul, isSheet: true, time, field: nullField,
    };
    anchorRef.current = a;
    registerAnchor(a);
    return () => { unregisterAnchor(id, a); anchorRef.current = null; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const a = anchorRef.current; if (a) updateAnchorLook(a, { width: w, height: h, cornerRadius: r, material, mapping, opacityMul, time }); }, [w, h, r, material, mapping, opacityMul, time]);
  const measure = useCallback(() => {
    viewRef.current?.measureInWindow((x, y, ww, hh) => { const a = anchorRef.current; if (a) updateAnchorFrame(a, { x, y, width: ww, height: hh }); });
  }, []);
  const onLayout = (_e: LayoutChangeEvent) => measure();
  useEffect(() => registerMeasurer(measure), [measure]);

  const pill = rrect(rect(0, 0, w, h), r, r);
  const rx = (w * core.size) / 100, ry = (h * core.size) / 100;
  const k = scale;
  return (
    <View ref={viewRef} onLayout={onLayout} style={[{ width: w, height: h }, style]}>
      <Canvas opaque={false} style={{ width: w, height: h }} pointerEvents="none">
        <RoundedRect rect={pill} color="white" />
        <RoundedRect rect={pill}>
          <Shader source={liquidMetalEffect()} uniforms={uniforms} />
        </RoundedRect>
        {/* Clean white core: CSS radial-gradient(ellipse size% size%, white r%, transparent (r+blur)%). */}
        <Group clip={pill} opacity={core.a} transform={[{ translateX: w / 2 }, { translateY: h / 2 }, { scaleY: ry / rx }, { translateX: -w / 2 }, { translateY: -h / 2 }]}>
          <Rect x={-w} y={-h * 4} width={w * 3} height={h * 9}>
            <RadialGradient c={vec(w / 2, h / 2)} r={rx} colors={['white', 'white', 'rgba(255,255,255,0)']} positions={[0, core.r / 100, Math.min(1, (core.r + core.blur) / 100)]} />
          </Rect>
        </Group>
        <RoundedRect rect={pill}>
          <LinearGradient start={vec(0, 0)} end={vec(0, h)} colors={[`rgba(255,255,255,${gradient})`, 'rgba(255,255,255,0)']} />
        </RoundedRect>
        {/* Inset glows: two 8.333-pt white inner glows. */}
        <Group clip={pill}>
          <Group layer={<Paint><Blur blur={8.333 * 0.5 * k} /></Paint>}>
            <RoundedRect rect={pill} style="stroke" strokeWidth={8.333 * 2 * k} color={`rgba(255,255,255,${glow})`} />
            <RoundedRect rect={pill} style="stroke" strokeWidth={8.333 * 2 * k} color={`rgba(255,255,255,${glow})`} />
          </Group>
        </Group>
        {/* Hairline .833 at 50 %, and the top rim .833 at 78 %. */}
        <Group clip={pill}>
          <RoundedRect rect={pill} style="stroke" strokeWidth={0.833 * 2 * k} color="rgba(255,255,255,0.5)" />
          <Group opacity={0.78} layer>
            <RoundedRect rect={pill} color="white" />
            <RoundedRect rect={pill} color="white" blendMode="dstOut" transform={[{ translateY: 0.833 * k }]} />
          </Group>
        </Group>
        <Text x={(w - tw) / 2} y={baseline} text={text} font={font} color={textColor} />
      </Canvas>
    </View>
  );
}
