/* The plastic material's forms on Skia: once per outline (× texture tier
   × depth) the outline is rasterised into a raster surface, its coverage
   read back once, and `bakeBotAvatarForm` from the web package turns it
   into the pillow height field's normals and baked occlusion. Those go
   into a half-float RGBA image (nx, ny, ao, 1) the cap shader samples
   per pixel. Bakes run one per timer slot, like the web's idle bakes, so
   a screen full of types never stacks them all into one frame; the
   smooth look stands in until a form lands. */

import { AlphaType, ColorType, Skia, type SkImage, type SkPath, type SkRuntimeEffect } from '@shopify/react-native-skia';
import { bakeBotAvatarForm, botAvatarParts, botAvatarShapes, botAvatarTier, BOT_AVATAR_MATCAP_SIZE, BOT_AVATAR_PAD, BOT_AVATAR_SPAN, type BotAvatarType } from 'bot-avatars';
import { CAP_SKSL } from './light';

export const PAD = BOT_AVATAR_PAD;
export const SPAN = BOT_AVATAR_SPAN;

/** What the renderer holds per avatar besides its configuration. */
export interface Resources {
  path: SkPath;
  parts: SkPath | null;
  /** texture side, in texels */
  N: number;
  /** the body's form and the thin parts', or null while they bake */
  form: SkImage | null;
  partsForm: SkImage | null;
  effect: SkRuntimeEffect | null;
}

const paths = new Map<string, SkPath>();
function pathFor(d: string): SkPath {
  let p = paths.get(d);
  if (!p) {
    p = Skia.Path.MakeFromSVGString(d) ?? Skia.Path.Make();
    paths.set(d, p);
  }
  return p;
}

/** The body outline of a type (or `custom` with an SVG path string). */
export function outlinePath(type: BotAvatarType): SkPath {
  return pathFor(botAvatarShapes[type] ?? botAvatarShapes.clover);
}
export function partsPath(type: BotAvatarType): SkPath | null {
  const d = botAvatarParts[type];
  return d ? pathFor(d) : null;
}

let effect: SkRuntimeEffect | null = null;
export function capEffect(): SkRuntimeEffect {
  if (!effect) {
    effect = Skia.RuntimeEffect.Make(CAP_SKSL);
    if (!effect) throw new Error('bot-avatars-native: the cap shader failed to compile');
  }
  return effect;
}

/** Coverage raster of the outline: N × N over design units [-PAD, 100 + PAD]. */
export function rasterize(path: SkPath, N: number): Uint8ClampedArray | null {
  const surface = Skia.Surface.Make(N, N);
  if (!surface) return null;
  const c = surface.getCanvas();
  c.scale(N / SPAN, N / SPAN);
  c.translate(PAD, PAD);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  paint.setColor(Skia.Color('#fff'));
  c.drawPath(path, paint);
  surface.flush();
  const px = surface.makeImageSnapshot().readPixels(0, 0, { width: N, height: N, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }) as Uint8Array | null;
  if (!px) return null;
  const cov = new Uint8ClampedArray(N * N);
  for (let i = 0; i < N * N; i++) cov[i] = px[i * 4 + 3];
  return cov;
}

/* IEEE half precision, for the normal texture */
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v: number): number {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 127 + 15;
  let mant = x & 0x7fffff;
  if (exp <= 0) {
    if (exp < -10) return sign;
    mant = (mant | 0x800000) >> (1 - exp);
    return sign | ((mant + 0x1000) >> 13);
  }
  if (exp >= 31) return sign | 0x7c00;
  return sign | ((exp << 10) + ((mant + 0x1000) >> 13));
}

/** The raw form of a type at a tier, for inspection: the coverage and what `bakeBotAvatarForm` made of it. */
export function bakeRawForm(type: BotAvatarType, N: number, halfDepth: number) {
  const cov = rasterize(outlinePath(type), N);
  if (!cov) return null;
  const form = bakeBotAvatarForm(cov, N, halfDepth);
  return { N, cov: Array.from(cov), i00: Array.from(form.i00), wx: Array.from(form.wx), wy: Array.from(form.wy), ao: Array.from(form.ao) };
}

/** which texture format the forms use: half floats, or bytes where Skia will not take them */
export let formFormat: 'f16' | 'rgba8' = 'f16';

/** The form as a texture: nx, ny in [0, 1], the baked AO, 1. */
export function formImage(cov: Uint8ClampedArray, N: number, halfDepth: number): SkImage | null {
  const form = bakeBotAvatarForm(cov, N, halfDepth);
  const M = BOT_AVATAR_MATCAP_SIZE;
  const NN = N * N;
  if (formFormat === 'f16') {
    const data = new Uint16Array(NN * 4);
    for (let i = 0; i < NN; i++) {
      const a = form.ao[i];
      const cell = form.i00[i], cx = cell % M, cy = (cell - cx) / M;
      const fx = a ? (cx + form.wx[i] / 255) / (M - 1) : 0.5, fy = a ? (cy + form.wy[i] / 255) / (M - 1) : 0.5;
      const k = i * 4;
      data[k] = toHalf(fx);
      data[k + 1] = toHalf(fy);
      data[k + 2] = toHalf(a / 255);
      data[k + 3] = 0x3c00;
    }
    const img = Skia.Image.MakeImage({ width: N, height: N, colorType: ColorType.RGBA_F16, alphaType: AlphaType.Opaque }, Skia.Data.fromBytes(new Uint8Array(data.buffer)), N * 8);
    if (img) return img;
    formFormat = 'rgba8';
  }
  const data = new Uint8Array(NN * 4);
  for (let i = 0; i < NN; i++) {
    const a = form.ao[i];
    const cell = form.i00[i], cx = cell % M, cy = (cell - cx) / M;
    const k = i * 4;
    data[k] = a ? Math.round((255 * (cx + form.wx[i] / 255)) / (M - 1)) : 128;
    data[k + 1] = a ? Math.round((255 * (cy + form.wy[i] / 255)) / (M - 1)) : 128;
    data[k + 2] = a;
    data[k + 3] = 255;
  }
  return Skia.Image.MakeImage({ width: N, height: N, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Opaque }, Skia.Data.fromBytes(data), N * 4);
}

/* ── the form cache, with deferred builds ──────────────────────────── */

const forms = new Map<string, SkImage>();
const pending = new Map<string, Set<() => void>>();
const queue: (() => void)[] = [];
let scheduled = false;
/** milliseconds the last bakes took, for the example's readout */
export const bakeLog: { key: string; ms: number }[] = [];

function pump() {
  scheduled = false;
  const fn = queue.shift();
  if (fn) fn();
  if (queue.length) schedule();
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(pump, 16);
}

function bake(id: string, path: SkPath, N: number, halfDepth: number): SkImage | null {
  const t0 = Date.now();
  const cov = rasterize(path, N);
  const img = cov && formImage(cov, N, halfDepth);
  if (img) forms.set(id, img);
  bakeLog.push({ key: id, ms: Date.now() - t0 });
  if (bakeLog.length > 64) bakeLog.shift();
  return img;
}

/**
 * The form image for an outline, built now (`sync`) or on a timer slot;
 * `onReady` runs once a deferred build lands.
 */
export function formFor(key: string, path: SkPath, N: number, halfDepth: number, sync: boolean, onReady?: () => void): SkImage | null {
  const id = `${key}|${N}|${Math.round(halfDepth)}`;
  const hit = forms.get(id);
  if (hit) return hit;
  if (sync) {
    if (forms.size >= 48) forms.clear();
    return bake(id, path, N, halfDepth);
  }
  let waiters = pending.get(id);
  if (!waiters) {
    waiters = new Set();
    pending.set(id, waiters);
    queue.push(() => {
      const ws = pending.get(id);
      pending.delete(id);
      if (!forms.has(id)) {
        if (forms.size >= 48) forms.clear();
        bake(id, path, N, halfDepth);
      }
      ws?.forEach((fn) => fn());
    });
    schedule();
  }
  if (onReady) waiters.add(onReady);
  return null;
}

/** Texture tier for an avatar `devicePx` wide (points × pixel ratio). */
export const tierFor = botAvatarTier;

/**
 * The resources of a type at a device size: outline, parts, and the forms
 * when `plastic` is on — baked now with `sync`, else on timer slots with
 * `onReady` called as each lands.
 */
export function resourcesFor(type: BotAvatarType, devicePx: number, depth: number, plastic: boolean, sync: boolean, onReady?: () => void): Resources {
  const path = outlinePath(type);
  const parts = partsPath(type);
  const N = tierFor(devicePx);
  const halfDepth = 15 * depth;
  if (!plastic) return { path, parts, N, form: null, partsForm: null, effect: null };
  return {
    path,
    parts,
    N,
    form: formFor(type, path, N, halfDepth, sync, onReady),
    partsForm: parts ? formFor(`${type}:parts`, parts, N, halfDepth * 0.4, sync, onReady) : null,
    effect: capEffect(),
  };
}
