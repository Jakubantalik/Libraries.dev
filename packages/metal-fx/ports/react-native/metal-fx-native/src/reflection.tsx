import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PixelRatio, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { Blur, Canvas, ColorMatrix, FillType, Group, LinearGradient, Mask, Paint, Path, Rect, Shader, Skia, Text, rect, vec } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { liquidMetalEffect } from './MetalFx';
import { materialUniforms, stretchedMapping } from './material';
import { bandPath, roundRectOutline, type Deform } from './geometry';
import { deformPoint } from './bend';
import { registerMeasurer, useAnchor, type MetalAnchor } from './registry';
import { useMetalFont, measureLabel } from './MetalText';

// Web constants (src/engine/reflection/constants.ts).
const RANGE_PX = 12;
const BASE_ALPHA = 0.55, BOOST_ALPHA = 1.0;
const INTENSITY_MULT = 1.3, GLOBAL_ATTENUATION = 0.7, MAX_ALPHA_STACK = 3.6;
const STROKE_EXTRA_ALPHA = 0.52, BORDER_HILITE_ALPHA = 0.044;
const REF_DRAW_W = 235;
const FILL_EXTRA_ALPHA = 2.535, FILL_OPACITY_MUL = 0.7, FILL_CIRCLE_ATTENUATION = 0.5;
const FILL_BLUR = 4;

export interface MetalReflectionProps {
  /** The anchor's id. */
  of: string;
  /** Alpha multiplier (1 = canonical; the demo's "Plan" uses 0.64). */
  strength?: number;
  /** This view's corner radius; defaults to fully rounded. */
  cornerRadius?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

interface Layout {
  horiz: boolean;
  draw: { x: number; y: number; w: number; h: number };
  flipX: boolean; flipY: boolean;
  g0: { x: number; y: number }; g1: { x: number; y: number };
  reflectionAlpha: number;
}

function layoutFor(a: MetalAnchor, tr: { x: number; y: number; width: number; height: number }, strength: number, glyph: boolean): Layout | null {
  const af = a.frame;
  const tW = tr.width, tH = tr.height;
  if (af.width < 4 || af.height < 4 || tW < 1 || tH < 1) return null;
  const aMinX = af.x, aMaxX = af.x + af.width, aMinY = af.y, aMaxY = af.y + af.height;
  const tMinX = tr.x, tMaxX = tr.x + tW, tMinY = tr.y, tMaxY = tr.y + tH;
  const dx = (aMinX + aMaxX) / 2 - (tMinX + tMaxX) / 2, dy = (aMinY + aMaxY) / 2 - (tMinY + tMaxY) / 2;
  const edgeGapH = Math.max(aMinX - tMaxX, tMinX - aMaxX, 0);
  const edgeGapV = Math.max(aMinY - tMaxY, tMinY - aMaxY, 0);
  const horiz = edgeGapH >= edgeGapV;
  const dist = Math.hypot(edgeGapH, edgeGapV);
  let proximity = 1 - Math.min(1, dist / RANGE_PX);
  proximity = proximity * proximity * (3 - 2 * proximity);
  const intensity = BASE_ALPHA + (BOOST_ALPHA - BASE_ALPHA) * proximity;
  const reflectionAlpha = Math.min(MAX_ALPHA_STACK, intensity * INTENSITY_MULT * GLOBAL_ATTENUATION) * strength;
  const band = Math.min(glyph ? RANGE_PX * 1.5 : RANGE_PX, Math.max(tW, tH));
  const refW = glyph ? Math.max(1, Math.min(horiz ? tW : tH, horiz ? af.width : af.height)) : Math.max(1, REF_DRAW_W * Math.max(0.1, af.width / 140));
  if (horiz) {
    const top = Math.max(aMinY, tMinY), bot = Math.min(aMaxY, tMaxY);
    return {
      horiz, draw: { x: dx > 0 ? tW - refW : 0, y: top - tMinY, w: refW, h: Math.max(1, bot - top) }, flipX: true, flipY: false,
      g0: { x: dx > 0 ? tW : 0, y: tH / 2 }, g1: { x: dx > 0 ? tW - band : band, y: tH / 2 }, reflectionAlpha,
    };
  }
  const left = Math.max(aMinX, tMinX), right = Math.min(aMaxX, tMaxX);
  return {
    horiz, draw: { x: left - tMinX, y: dy > 0 ? tH - refW : 0, w: Math.max(1, right - left), h: refW }, flipX: false, flipY: true,
    g0: { x: tW / 2, y: dy > 0 ? tH : 0 }, g1: { x: tW / 2, y: dy > 0 ? tH - band : band }, reflectionAlpha,
  };
}

/** CSS saturate(s) brightness(b) as a colour matrix. */
function saturateBrighten(s: number, b: number): number[] {
  const lr = 0.2126, lg = 0.7152, lb = 0.0722;
  return [
    (lr + (1 - lr) * s) * b, (lg - lg * s) * b, (lb - lb * s) * b, 0, 0,
    (lr - lr * s) * b, (lg + (1 - lg) * s) * b, (lb - lb * s) * b, 0, 0,
    (lr - lr * s) * b, (lg - lg * s) * b, (lb + (1 - lb) * s) * b, 0, 0,
    0, 0, 0, 1, 0,
  ];
}

/** The anchor's band (or whole sheet), stretched and mirrored into `draw`. */
function useSource(a: MetalAnchor, L: Layout | null) {
  const dpr = PixelRatio.get();
  const path = useDerivedValue(() => {
    if (!L) return Skia.Path.Make();
    const f = a.field.value;
    const deform: Deform = f ? (x, y) => deformPoint(f, x, y) : null;
    const p = a.isSheet
      ? (() => { const q = Skia.Path.Make(); q.addRect(rect(0, 0, a.width, a.height)); return q; })()
      : bandPath(
        roundRectOutline(0, 0, a.width, a.height, a.cornerRadius, deform),
        roundRectOutline(a.ringWidth, a.ringWidth, a.width - 2 * a.ringWidth, a.height - 2 * a.ringWidth, Math.max(0, a.cornerRadius - a.ringWidth), deform)
      );
    const sx = (L.draw.w / Math.max(1, a.width)) * (L.flipX ? -1 : 1);
    const sy = (L.draw.h / Math.max(1, a.height)) * (L.flipY ? -1 : 1);
    const m = Skia.Matrix();
    m.translate(L.draw.x + (L.flipX ? L.draw.w : 0), L.draw.y + (L.flipY ? L.draw.h : 0));
    m.scale(sx, sy);
    p.transform(m);
    return p;
  });
  const uniforms = useDerivedValue(() => {
    if (!L) return materialUniforms(a.material, a.mapping, 0, 0, dpr);
    const m = stretchedMapping(a.mapping, a.width, a.height, L.draw.w, L.draw.h, L.flipX, L.flipY);
    m.ox -= m.sx * L.draw.x; m.oy -= m.sy * L.draw.y;
    return materialUniforms(a.material, m, a.time.value, a.opacityMul, dpr);
  });
  return { path, uniforms };
}

function Passes({ total, path, uniforms }: { total: number; path: ReturnType<typeof useSource>['path']; uniforms: ReturnType<typeof useSource>['uniforms'] }) {
  const a0 = Math.min(1, Math.max(0, total)), a1 = Math.min(1, Math.max(0, total - 1)), a2 = Math.min(1, Math.max(0, total - 2));
  return (
    <>
      <Path path={path} opacity={a0}><Shader source={liquidMetalEffect()} uniforms={uniforms} /></Path>
      {a1 > 1e-4 && <Path path={path} opacity={a1} blendMode="plus"><Shader source={liquidMetalEffect()} uniforms={uniforms} /></Path>}
      {a2 > 1e-4 && <Path path={path} opacity={a2} blendMode="plus"><Shader source={liquidMetalEffect()} uniforms={uniforms} /></Path>}
    </>
  );
}

/**
 * Reflect the metal of anchor `of` onto this view's facing edge — metal-fx
 * v2's `reflectionTargets`. Wraps `children`; the reflection is a Skia
 * overlay on top of them, clipped to the view's rounded rect.
 */
export function MetalReflection({ of, strength = 1, cornerRadius, style, children }: MetalReflectionProps) {
  const anchor = useAnchor(of);
  const ref = useRef<View>(null);
  const [frame, setFrame] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => setFrame((f) => (Math.abs(f.x - x) > 0.5 || Math.abs(f.y - y) > 0.5 || f.width !== width || f.height !== height ? { x, y, width, height } : f)));
  }, []);
  const onLayout = useCallback((_e: LayoutChangeEvent) => measure(), [measure]);
  useEffect(() => registerMeasurer(measure), [measure]);
  return (
    <View ref={ref} onLayout={onLayout} style={style}>
      {children}
      {anchor && frame.width > 0 && <SurfaceLayer anchor={anchor} frame={frame} strength={strength} cornerRadius={cornerRadius ?? Math.min(frame.width, frame.height) / 2} />}
    </View>
  );
}

function SurfaceLayer({ anchor, frame, strength, cornerRadius }: { anchor: MetalAnchor; frame: { x: number; y: number; width: number; height: number }; strength: number; cornerRadius: number }) {
  const L = useMemo(() => layoutFor(anchor, frame, strength, false), [anchor, anchor.frame, frame, strength]);
  const { path, uniforms } = useSource(anchor, L);
  const tW = frame.width, tH = frame.height;
  const shape = useMemo(() => { const p = Skia.Path.Make(); p.addRRect(Skia.RRectXY(rect(0, 0, tW, tH), cornerRadius, cornerRadius)); return p; }, [tW, tH, cornerRadius]);
  const edgeBand = useCallback((width: number) => {
    const p = Skia.Path.Make();
    p.addRRect(Skia.RRectXY(rect(0, 0, tW, tH), cornerRadius, cornerRadius));
    p.addRRect(Skia.RRectXY(rect(width, width, tW - 2 * width, tH - 2 * width), Math.max(0, cornerRadius - width), Math.max(0, cornerRadius - width)));
    p.setFillType(FillType.EvenOdd);
    return p;
  }, [tW, tH, cornerRadius]);
  if (!L) return null;
  const fillAlpha = Math.min(MAX_ALPHA_STACK, L.reflectionAlpha * FILL_EXTRA_ALPHA * FILL_OPACITY_MUL * FILL_CIRCLE_ATTENUATION);
  const gradient = (
    <Rect x={0} y={0} width={tW} height={tH}>
      <LinearGradient start={vec(L.g0.x, L.g0.y)} end={vec(L.g1.x, L.g1.y)} colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0)']} positions={[0, 0.5, 1]} />
    </Rect>
  );
  return (
    <Canvas opaque={false} style={{ position: 'absolute', left: 0, top: 0, width: tW, height: tH }} pointerEvents="none">
      <Group clip={shape}>
        {/* Fill: the mirrored band in the edge strip, blurred and lifted. */}
        <Group clip={edgeBand(RANGE_PX + FILL_BLUR * 3)} layer={<Paint><Blur blur={FILL_BLUR} /><ColorMatrix matrix={saturateBrighten(1.2, 1.58)} /></Paint>}>
          <Mask mode="alpha" mask={gradient}><Passes total={fillAlpha} path={path} uniforms={uniforms} /></Mask>
        </Group>
        {/* Stroke: a hairline of it just inside the edge. */}
        <Group clip={edgeBand(1)} layer={<Paint><ColorMatrix matrix={saturateBrighten(1.35, 1.75)} /></Paint>}>
          <Mask mode="alpha" mask={gradient}><Passes total={L.reflectionAlpha * STROKE_EXTRA_ALPHA} path={path} uniforms={uniforms} /></Mask>
        </Group>
        {/* Border highlight. */}
        <Mask mode="alpha" mask={gradient}>
          <Path path={edgeBand(1)} color="white" opacity={Math.min(0.85, BORDER_HILITE_ALPHA * L.reflectionAlpha)} />
        </Mask>
      </Group>
    </Canvas>
  );
}

export interface MetalReflectionTextProps {
  of: string;
  children: string;
  fontSize?: number;
  fontWeight?: '400' | '500' | '600' | '700' | 'normal' | 'bold';
  fontFamily?: string;
  color?: string;
  strength?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * A word that catches the metal on its letterforms (the demo's "Plan").
 * Drawn in Skia so the glyphs can mask the mirrored sheet.
 */
export function MetalReflectionText({ of, children: text, fontSize = 24, fontWeight = '500', fontFamily, color = 'rgba(153,153,153,0.6)', strength = 0.64, style }: MetalReflectionTextProps) {
  const anchor = useAnchor(of);
  const font = useMetalFont(fontSize, fontWeight, fontFamily);
  const { width, height, baseline } = useMemo(() => measureLabel(font, text), [font, text]);
  const ref = useRef<View>(null);
  const [frame, setFrame] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, w, h) => setFrame((f) => (Math.abs(f.x - x) > 0.5 || Math.abs(f.y - y) > 0.5 || f.width !== w || f.height !== h ? { x, y, width: w, height: h } : f)));
  }, []);
  const onLayout = useCallback((_e: LayoutChangeEvent) => measure(), [measure]);
  useEffect(() => registerMeasurer(measure), [measure]);
  return (
    <View ref={ref} onLayout={onLayout} style={[{ width, height }, style]}>
      <Canvas opaque={false} style={{ width, height }} pointerEvents="none">
        <Text x={0} y={baseline} text={text} font={font} color={color} />
        {anchor && frame.width > 0 && (
          <Mask mode="alpha" mask={<Text x={0} y={baseline} text={text} font={font} color="white" />}>
            <GlyphLayer anchor={anchor} frame={frame} strength={strength} />
          </Mask>
        )}
      </Canvas>
    </View>
  );
}

function GlyphLayer({ anchor, frame, strength }: { anchor: MetalAnchor; frame: { x: number; y: number; width: number; height: number }; strength: number }) {
  const L = useMemo(() => layoutFor(anchor, frame, strength, true), [anchor, anchor.frame, frame, strength]);
  const { path, uniforms } = useSource(anchor, L);
  if (!L) return null;
  const alpha = Math.min(1, L.reflectionAlpha * FILL_OPACITY_MUL);
  return (
    <Group layer={<Paint><Blur blur={0.4} /><ColorMatrix matrix={saturateBrighten(1.35, 1.2)} /></Paint>}>
      <Mask mode="alpha" mask={
        <Rect x={0} y={0} width={frame.width} height={frame.height}>
          <LinearGradient start={vec(L.g0.x, L.g0.y)} end={vec(L.g1.x, L.g1.y)} colors={['rgba(0,0,0,1)', 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0)']} positions={[0, 0.5, 1]} />
        </Rect>
      }>
        <Path path={path} opacity={alpha}><Shader source={liquidMetalEffect()} uniforms={uniforms} /></Path>
      </Mask>
    </Group>
  );
}
