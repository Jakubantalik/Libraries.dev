import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, useWindowDimensions, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import { allAnchors, registerMeasurer, useAnchorsVersion, type EdgeLens, type MetalAnchor } from './registry';

export interface MetalEdgeHaloProps {
  /** Distance from a screen edge within which a ring lights it, pt. */
  reach?: number;
  /** Strip thickness, pt. */
  depth?: number;
  intensity?: number;
  /** Peak pull of the ring toward the edge, pt. */
  displacement?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

interface Frame { x: number; y: number; width: number; height: number }

/**
 * The screen-edge halo. Wrap the view that touches the display's edge and
 * contains a ring with an `id` (a card, a bar). When that ring sits within
 * `reach` of the screen's edge, the side of it facing the edge is pulled
 * toward it like liquid glass — a slow undulation with a slight chromatic
 * split and a faint tint in the metal's colour — by a lens filter on the
 * ring's own canvas (a Skia overlay cannot sample React Native views, so
 * the surrounding content stays put).
 */
export function MetalEdgeHalo({ reach = 72, depth = 40, intensity = 1, displacement = 12, style, children }: MetalEdgeHaloProps) {
  const { width: SW, height: SH } = useWindowDimensions();
  const version = useAnchorsVersion();
  const ref = useRef<View>(null);
  const [frame, setFrame] = useState<Frame>({ x: 0, y: 0, width: 0, height: 0 });
  const stable = useRef<{ key: string; value: { anchor: MetalAnchor; lens: EdgeLens } } | null>(null);

  const measure = useCallback(() => {
    ref.current?.measureInWindow((x, y, width, height) => setFrame((f) => (Math.abs(f.x - x) > 0.5 || Math.abs(f.y - y) > 0.5 || f.width !== width || f.height !== height ? { x, y, width, height } : f)));
  }, []);
  const onLayout = useCallback((_e: LayoutChangeEvent) => measure(), [measure]);
  useEffect(() => registerMeasurer(measure), [measure]);

  const cand = useMemo<{ anchor: MetalAnchor; lens: EdgeLens } | null>(() => {
    if (frame.width <= 0) return null;
    let best: { anchor: MetalAnchor; lens: EdgeLens; proximity: number } | null = null;
    for (const a of allAnchors()) {
      const f = a.frame;
      if (f.width <= 0 || !a.lens || !a.setLensActive) continue;
      // Only rings inside this host, with their centre on screen.
      const cx = f.x + f.width / 2, cy = f.y + f.height / 2;
      if (cx < frame.x - 8 || cx > frame.x + frame.width + 8 || cy < frame.y - 8 || cy > frame.y + frame.height + 8) continue;
      if (cx < 0 || cx > SW || cy < 0 || cy > SH) continue;
      const d: [number, number][] = [[0, f.x], [1, SW - (f.x + f.width)], [2, f.y], [3, SH - (f.y + f.height)]];
      d.sort((p, q) => p[1] - q[1]);
      const [edge, dist] = d[0];
      const p = 1 - Math.min(1, Math.max(0, dist / reach));
      const prox = p * p * (3 - 2 * p);
      if (prox <= 0.001) continue;
      if (!best || prox > best.proximity) {
        // Ring-local coordinates: where the screen's edge is, and the strip's centre along it.
        const edgeCoord = edge === 0 ? -f.x : edge === 1 ? SW - f.x : edge === 2 ? -f.y : SH - f.y;
        const centerAlong = edge < 2 ? f.height / 2 : f.width / 2;
        best = {
          anchor: a, proximity: prox,
          lens: { edge, edgeCoord, centerAlong, halfLen: Math.max(f.width, f.height) * 1.6 + 24, depth: depth + 12 * prox, intensity: prox * intensity * Math.min(1, a.opacityMul + 0.35), displacement },
        };
      }
    }
    if (!best) return null;
    // Same ring and (rounded) numbers as last time: keep the object so the effect below does not churn on every scroll frame.
    const r = (v: number) => Math.round(v * 4) / 4;
    const L = best.lens;
    const key = `${best.anchor.id}|${L.edge}|${r(L.edgeCoord)}|${r(L.centerAlong)}|${r(L.halfLen)}|${r(L.depth)}|${Math.round(L.intensity * 100)}|${L.displacement}`;
    const prev = stable.current;
    if (prev && prev.key === key && prev.value.anchor === best.anchor) return prev.value;
    const value = { anchor: best.anchor, lens: { ...L, edgeCoord: r(L.edgeCoord), centerAlong: r(L.centerAlong), halfLen: r(L.halfLen), depth: r(L.depth), intensity: Math.round(L.intensity * 100) / 100 } };
    stable.current = { key, value };
    return value;
  }, [SW, SH, reach, depth, intensity, displacement, version, frame]);

  // Hand the lens to the ring; take it back when it leaves the edge.
  useEffect(() => {
    if (!cand) return;
    const a = cand.anchor;
    a.lens!.value = cand.lens;
    a.setLensActive!(true);
    return () => {
      if (a.lens!.value === cand.lens) { a.lens!.value = null; a.setLensActive!(false); }
    };
  }, [cand]);

  return (
    <View ref={ref} onLayout={onLayout} style={style}>
      {children}
    </View>
  );
}
