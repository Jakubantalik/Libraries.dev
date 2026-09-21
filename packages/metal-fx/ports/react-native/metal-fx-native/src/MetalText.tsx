import React, { useEffect, useMemo, useRef } from 'react';
import { PixelRatio, Platform, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Blur, Canvas, Group, Mask, Paint, Shader, Skia, Text, matchFont, type SkFont } from '@shopify/react-native-skia';
import { useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { liquidMetalEffect, useMetalTime } from './MetalFx';
import { materialUniforms, presetMaterial, sampleLuminance, sampleMaterial, sheetMapping, type MetalPreset, type MetalTheme } from './material';
import { rrPerim } from './geometry';
import { GLOW_DEFAULTS, configureGlow, extraSprite, glowTick, haloSprite, initialGlowState, type GlowConfig } from './glow';
import { registerAnchor, unregisterAnchor, updateAnchorFrame, updateAnchorLook, type MetalAnchor } from './registry';
import type { BendField } from './bend';
import { AlphaType, BlendColor, ColorType, Image } from '@shopify/react-native-skia';

export interface MetalTextProps {
  children: string;
  fontSize?: number;
  fontWeight?: '400' | '500' | '600' | '700' | 'normal' | 'bold';
  fontFamily?: string;
  /** Base colour under the metal. */
  color?: string;
  preset?: MetalPreset;
  theme?: MetalTheme;
  strength?: number;
  metalOpacity?: number;
  shaderScale?: number;
  innerShadow?: boolean;
  glow?: boolean;
  glowGain?: number;
  paused?: boolean;
  glowConfig?: GlowConfig;
  id?: string;
  style?: StyleProp<ViewStyle>;
}

export function useMetalFont(fontSize: number, fontWeight: MetalTextProps['fontWeight'], fontFamily?: string): SkFont {
  return useMemo(() => matchFont({
    fontFamily: fontFamily ?? Platform.select({ ios: 'Helvetica Neue', android: 'sans-serif', default: 'sans-serif' }),
    fontSize,
    fontWeight: fontWeight ?? '500',
    fontStyle: 'normal',
  }), [fontSize, fontWeight, fontFamily]);
}

/** Text metrics: width, and the baseline / box height from the font. */
export function measureLabel(font: SkFont, text: string) {
  const w = font.measureText(text).width;
  const metrics = font.getMetrics();
  const ascent = -metrics.ascent, descent = metrics.descent;
  return { width: Math.ceil(w), height: Math.ceil(ascent + descent), baseline: ascent };
}

/** Points inside the glyphs on a ~2 pt grid, for the glint. */
function glyphPoints(font: SkFont, text: string, width: number, height: number, baseline: number): { x: number; y: number }[] {
  const surface = Skia.Surface.MakeOffscreen(Math.max(1, width), Math.max(1, height));
  if (!surface) return [];
  const canvas = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color('white'));
  canvas.drawText(text, 0, baseline, paint, font);
  surface.flush();
  const img = surface.makeImageSnapshot();
  const px = img.readPixels(0, 0, { width, height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array | null;
  if (!px) return [];
  const pts: { x: number; y: number }[] = [];
  for (let y = 1; y < height; y += 2) for (let x = 1; x < width; x += 2) if (px[(y * width + x) * 4 + 3] > 128) pts.push({ x, y });
  return pts;
}

/**
 * Metal inside the glyphs of a word — metal-fx v2's `<MetalText>`. Drawn
 * entirely in Skia so the letterforms, the material and the inner shadow
 * share one raster.
 */
export function MetalText({
  children: text, fontSize = 24, fontWeight = '500', fontFamily, color = '#E2E2E2', preset = 'chromatic', theme = 'dark',
  strength = 1, metalOpacity = 0.62, shaderScale = 2.8, innerShadow = true, glow = false, glowGain = 2.5, paused = false,
  glowConfig = GLOW_DEFAULTS, id, style,
}: MetalTextProps) {
  const font = useMetalFont(fontSize, fontWeight, fontFamily);
  const { width, height, baseline } = useMemo(() => measureLabel(font, text), [font, text]);
  const material = useMemo(() => presetMaterial(preset, theme), [preset, theme]);
  const mapping = useMemo(() => sheetMapping(width, height, shaderScale), [width, height, shaderScale]);
  const opacityMul = strength * metalOpacity * material.shaderOpacity;
  const dpr = PixelRatio.get();
  const time = useMetalTime(paused);
  const uniforms = useDerivedValue(() => materialUniforms(material, mapping, time.value, opacityMul, dpr));
  const nullField = useSharedValue<BendField | null>(null);

  const viewRef = useRef<View>(null);
  const anchorRef = useRef<MetalAnchor | null>(null);
  useEffect(() => {
    if (!id) return;
    const a: MetalAnchor = {
      id, frame: { x: 0, y: 0, width: 0, height: 0 }, width, height, cornerRadius: 4, ringWidth: 0, kind: 'pill',
      material, mapping, opacityMul, isSheet: true, time, field: nullField,
    };
    anchorRef.current = a;
    registerAnchor(a);
    return () => { unregisterAnchor(id, a); anchorRef.current = null; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const a = anchorRef.current; if (a) updateAnchorLook(a, { width, height, material, mapping, opacityMul, time }); }, [width, height, material, mapping, opacityMul, time]);
  const onLayout = (_e: LayoutChangeEvent) => {
    viewRef.current?.measureInWindow((x, y, w, h) => { const a = anchorRef.current; if (a) updateAnchorFrame(a, { x, y, width: w, height: h }); });
  };

  const points = useMemo(() => (glow ? glyphPoints(font, text, width, height, baseline) : []), [glow, font, text, width, height, baseline]);
  const glowState = useSharedValue(initialGlowState());
  const glowFrame = useDerivedValue(() => {
    if (!glow || points.length === 0) return null;
    const s = glowState.value;
    configureGlow(s, width, height, 4, 'pill', glowConfig, points);
    const t = time.value;
    const lum = (x: number, y: number) => sampleLuminance(material, mapping.ox + x * mapping.sx, mapping.oy + y * mapping.sy, t);
    const rgb = (x: number, y: number) => sampleMaterial(material, mapping.ox + x * mapping.sx, mapping.oy + y * mapping.sy, t);
    return glowTick(s, Date.now(), lum, rgb, strength * glowGain, theme === 'light', null, glowConfig);
  });
  const ratio = rrPerim(width, height, 4) / rrPerim(140, 40, 20);
  const halo = useMemo(() => (glow ? haloSprite(Math.max(1, glowConfig.haloHalfLen * ratio), 1, dpr, glowConfig) : null), [glow, ratio, dpr, glowConfig]);
  const extra = useMemo(() => (glow ? extraSprite(Math.max(0.6, glowConfig.extraHalfLen * ratio), 1, dpr, glowConfig) : null), [glow, ratio, dpr, glowConfig]);
  const haloXf = useDerivedValue(() => { const f = glowFrame.value; return f ? [{ translateX: f.x }, { translateY: f.y }] : [{ translateX: -1e4 }]; });
  const haloOp = useDerivedValue(() => glowFrame.value?.haloOp ?? 0);
  const extraOp = useDerivedValue(() => glowFrame.value?.extraOp ?? 0);
  const env = useDerivedValue(() => (glowFrame.value?.env ?? 0) * 0.7);
  const tint = useDerivedValue(() => { const t = glowFrame.value?.tint ?? [1, 1, 1]; return `rgb(${Math.round(t[0] * 255)},${Math.round(t[1] * 255)},${Math.round(t[2] * 255)})`; });

  const m = 48;
  return (
    <View ref={viewRef} onLayout={onLayout} style={[{ width, height }, style]}>
      <Canvas style={{ position: 'absolute', left: -m, top: -m, width: width + 2 * m, height: height + 2 * m }} pointerEvents="none">
        <Group transform={[{ translateX: m }, { translateY: m }]}>
          <Text x={0} y={baseline} text={text} font={font} color={color} />
          <Text x={0} y={baseline} text={text} font={font}>
            <Shader source={liquidMetalEffect()} uniforms={uniforms} />
          </Text>
          {glow && halo && extra && (
            <Group opacity={env}>
              <Mask mode="alpha" mask={
                <Group>
                  <Group layer={<Paint><Blur blur={3.5} /></Paint>} opacity={0.5}>
                    <Text x={0} y={baseline} text={text} font={font} color="white" />
                  </Group>
                  <Text x={0} y={baseline} text={text} font={font} color="white" />
                </Group>
              }>
                <Group transform={haloXf} opacity={haloOp}>
                  <Image image={halo.image} x={-halo.w / 2} y={-halo.h / 2} width={halo.w} height={halo.h}>
                    <BlendColor color={tint} mode="modulate" />
                  </Image>
                </Group>
                <Group transform={haloXf} opacity={extraOp}>
                  <Image image={extra.image} x={-extra.w / 2} y={-extra.h / 2} width={extra.w} height={extra.h} />
                </Group>
              </Mask>
            </Group>
          )}
          {innerShadow && (
            <Mask mode="alpha" mask={<Text x={0} y={baseline} text={text} font={font} color="white" />}>
              <Group opacity={0.9} layer={<Paint><Blur blur={0.5} /></Paint>}>
                <Text x={0} y={baseline} text={text} font={font} color="white" />
                <Text x={0} y={baseline + 1} text={text} font={font} color="white" blendMode="dstOut" />
              </Group>
            </Mask>
          )}
        </Group>
      </Canvas>
    </View>
  );
}
