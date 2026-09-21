import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import { Canvas, Fill, Shader, Skia, useClock } from '@shopify/react-native-skia';
import { useDerivedValue } from 'react-native-reanimated';
import { EDGE_HALO_SKSL } from './shader';
import { sampleMaterial } from './material';
import { allAnchors, useAnchorsVersion, type MetalAnchor } from './registry';

let effect: ReturnType<typeof Skia.RuntimeEffect.Make> | null = null;
function haloEffect() {
  if (!effect) {
    effect = Skia.RuntimeEffect.Make(EDGE_HALO_SKSL);
    if (!effect) throw new Error('metal-fx-native: the edge-halo shader failed to compile');
  }
  return effect;
}

export interface MetalEdgeHaloProps {
  /** Distance from a screen edge within which a ring lights it, pt. */
  reach?: number;
  /** Strip thickness, pt. */
  depth?: number;
  intensity?: number;
}

interface Candidate { edge: number; proximity: number; edgeCoord: number; along: number; halfLen: number; anchor: MetalAnchor; facing: { x: number; y: number } }

/**
 * The screen-edge halo: when a ring with an `id` sits within `reach` of a
 * screen edge, a strip along that edge blooms in the metal's colour — light
 * from the ring leaving through the glass edge of the display. Mount once
 * near the root; it is a full-screen, non-interactive overlay drawn
 * additively. (Refracting the app's own views is not possible from a Skia
 * overlay, so unlike the SwiftUI port this is light only.)
 */
export function MetalEdgeHalo({ reach = 72, depth = 34, intensity = 1 }: MetalEdgeHaloProps) {
  const { width: SW, height: SH } = useWindowDimensions();
  useAnchorsVersion();
  const cand = useMemo<Candidate | null>(() => {
    let best: Candidate | null = null;
    for (const a of allAnchors()) {
      const f = a.frame;
      if (f.width <= 0) continue;
      const d: [number, number][] = [[0, f.x], [1, SW - (f.x + f.width)], [2, f.y], [3, SH - (f.y + f.height)]];
      d.sort((p, q) => p[1] - q[1]);
      const [edge, dist] = d[0];
      if (dist <= -f.width) continue;
      const p = 1 - Math.min(1, Math.max(0, dist / reach));
      const prox = p * p * (3 - 2 * p);
      if (prox <= 0.001) continue;
      if (!best || prox > best.proximity) {
        const along = edge < 2 ? f.y + f.height / 2 : f.x + f.width / 2;
        const edgeCoord = edge === 0 ? 0 : edge === 1 ? SW : edge === 2 ? 0 : SH;
        const facing = edge === 0 ? { x: 0, y: f.height / 2 } : edge === 1 ? { x: f.width, y: f.height / 2 } : edge === 2 ? { x: f.width / 2, y: 0 } : { x: f.width / 2, y: f.height };
        best = { edge, proximity: prox, edgeCoord, along, halfLen: Math.max(f.width, f.height) * 1.6 + 24, anchor: a, facing };
      }
    }
    return best;
  }, [SW, SH, reach]); // eslint-disable-line react-hooks/exhaustive-deps
  const clock = useClock();
  const uniforms = useDerivedValue(() => {
    if (!cand) return { edge: 0, edgeCoord: 0, centerAlong: 0, halfLen: 0, depth: 0, intensity: 0, tint: [0, 0, 0], time: 0 };
    const a = cand.anchor;
    const t = a.time.value;
    // The most saturated colour along the facing edge.
    let tint: [number, number, number] = [1, 1, 1], best = -1;
    for (let i = 0; i < 9; i++) {
      const k = i / 8;
      const px = cand.edge < 2 ? cand.facing.x : a.width * (0.1 + 0.8 * k);
      const py = cand.edge < 2 ? a.height * (0.1 + 0.8 * k) : cand.facing.y;
      const s = sampleMaterial(a.material, a.mapping.ox + px * a.mapping.sx, a.mapping.oy + py * a.mapping.sy, t);
      const mx = Math.max(s[0], s[1], s[2]), mn = Math.min(s[0], s[1], s[2]);
      const sat = mx > 0 ? (mx - mn) / mx : 0;
      const score = sat * (0.35 + 0.65 * mx);
      if (score > best) { best = score; tint = s; }
    }
    const peak = Math.max(tint[0], tint[1], tint[2]);
    if (peak > 0) tint = [tint[0] / peak, tint[1] / peak, tint[2] / peak];
    return {
      edge: cand.edge, edgeCoord: cand.edgeCoord, centerAlong: cand.along, halfLen: cand.halfLen,
      depth: depth + 12 * cand.proximity, intensity: cand.proximity * intensity * Math.min(1, a.opacityMul + 0.35),
      tint, time: clock.value / 1000,
    };
  });
  if (!cand) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Fill blendMode="plus">
        <Shader source={haloEffect()} uniforms={uniforms} />
      </Fill>
    </Canvas>
  );
}
