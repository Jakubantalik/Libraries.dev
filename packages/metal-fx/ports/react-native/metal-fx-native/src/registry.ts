/**
 * On-screen anchors by id — what `MetalReflection` and `MetalEdgeHalo` look
 * up. Frames are in window coordinates; the per-frame bits (time, bend
 * field) live on shared values so consumers read them on the UI thread.
 */
import { useSyncExternalStore } from 'react';
import type { SharedValue } from 'react-native-reanimated';
import type { MetalMaterial, SheetMapping } from './material';
import type { ShapeKind } from './geometry';
import type { BendField } from './bend';

export interface AnchorFrame { x: number; y: number; width: number; height: number }

/** The screen-edge lens a `MetalEdgeHalo` puts on a ring; distances in pt,
 *  coordinates local to the ring's box (`edge` 0 left, 1 right, 2 top, 3 bottom). */
export interface EdgeLens {
  edge: number;
  edgeCoord: number;
  centerAlong: number;
  halfLen: number;
  depth: number;
  intensity: number;
  displacement: number;
}

export interface MetalAnchor {
  id: string;
  frame: AnchorFrame;
  width: number;
  height: number;
  cornerRadius: number;
  ringWidth: number;
  kind: ShapeKind;
  material: MetalMaterial;
  mapping: SheetMapping;
  opacityMul: number;
  /** Text / badge: the whole box is metal (a masked sheet), not a band. */
  isSheet: boolean;
  /** Material time, seconds (pause-aware), on the UI thread. */
  time: SharedValue<number>;
  /** The bend field for this frame, or null when idle. */
  field: SharedValue<BendField | null>;
  /** Rings only: the edge lens (see `MetalEdgeHalo`), on the UI thread. */
  lens?: SharedValue<EdgeLens | null>;
  /** Rings only: switch the lens filter on or off (a React re-render). */
  setLensActive?: (on: boolean) => void;
}

const anchors = new Map<string, MetalAnchor>();
const listeners = new Set<() => void>();
let version = 0;

/** Re-measure hooks: every anchor and reflection target registers one. */
const measurers = new Set<() => void>();
export function registerMeasurer(fn: () => void): () => void {
  measurers.add(fn);
  return () => { measurers.delete(fn); };
}

/**
 * Re-measure every anchor and reflection target in window coordinates.
 * Frames are otherwise read on layout only, so call this from a ScrollView's
 * `onScroll` (with `scrollEventThrottle`) or after any move without a layout.
 */
export function refreshMetalFrames(): void {
  measurers.forEach((m) => m());
}

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function registerAnchor(a: MetalAnchor): void {
  anchors.set(a.id, a);
  emit();
}

export function unregisterAnchor(id: string, a: MetalAnchor): void {
  if (anchors.get(id) === a) { anchors.delete(id); emit(); }
}

/** Frames change rarely; publish only real moves. */
export function updateAnchorFrame(a: MetalAnchor, f: AnchorFrame): void {
  const p = a.frame;
  a.frame = f;
  if (Math.abs(p.x - f.x) > 0.5 || Math.abs(p.y - f.y) > 0.5 || Math.abs(p.width - f.width) > 0.5 || Math.abs(p.height - f.height) > 0.5) emit();
}

export function updateAnchorLook(a: MetalAnchor, patch: Partial<MetalAnchor>): void {
  Object.assign(a, patch);
  emit();
}

export function getAnchor(id: string): MetalAnchor | undefined {
  return anchors.get(id);
}

export function allAnchors(): MetalAnchor[] {
  return [...anchors.values()];
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** Re-render when any anchor registers, moves or changes its look. */
export function useAnchorsVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}

export function useAnchor(id: string): MetalAnchor | undefined {
  useAnchorsVersion();
  return anchors.get(id);
}

/** One time base for every instance. */
export const CLOCK_EPOCH = Date.now();
