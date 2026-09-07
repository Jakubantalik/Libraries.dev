/**
 * Shared WebGL renderer — one offscreen GL canvas drives all MetalFx instances.
 *
 * Architecture:
 *   1. A single offscreen GL canvas renders the plasma shader.
 *   2. Each instance owns a visible 2D canvas that receives a cropped/scaled
 *      copy of the GL output with an inner "hole punch" mask (ring effect).
 *   3. Glow sampling reads from a shared pixel buffer (gl.readPixels) that is
 *      refreshed at most every 200ms to avoid GPU pipeline flushes on every frame.
 *   4. The animation loop is capped at ~30fps — the blur + slow plasma motion
 *      makes higher rates imperceptible.
 */
import { CANONICAL_GL_SIZE, GL_DPR_CAP } from '../perfConfig';
import { PRESETS, type PresetMode, type PresetName, type PresetTheme } from '../presets';
import { compileShader, FRAG_SHADER_SRC, linkProgram, VERT_SHADER_SRC } from '../shaders';
export const CANONICAL_PILL_W = 140;
export const CANONICAL_PILL_H = 40;
export const PILL_SHADER_SCALE = 1.6;
export const CIRCLE_SHADER_SCALE = 1.3;

export interface ShaderRGB { r: number; g: number; b: number }

/**
 * Vector deformation hook. Maps a point in the instance's CSS-px box (origin
 * top-left, before any overscan) to its displaced position, writing into
 * `out`. When an instance carries one, the ring mask is built from displaced
 * rounded-rect outlines instead of `roundRect`, so stretch stays anti-aliased
 * at any magnitude — unlike a pixel displacement filter.
 */
export type DeformFn = (x: number, y: number, out: { x: number; y: number }) => void;

/**
 * Extra layers drawn into the canvas while deforming — things that live on
 * CSS boxes (root background, `::after` rim, `.metal-fx-inner` hairline) and
 * therefore can't follow a vector deformation on their own.
 */
export interface DeformLayers {
  /** Fill colour behind the ring (the root background), or null. */
  fill?: string | null;
  /** Inset stroke drawn over the ring. `inset` is the band's inner edge from
   *  the outer outline; `width` the band thickness; CSS px. */
  rim?: { inset: number; width: number; color: string } | null;
  /** Thin stroke at `inset` from the outer outline, under the ring. */
  hairline?: { inset: number; width: number; color: string } | null;
}

/**
 * Custom alpha mask. Paints opaque shapes in *device* px onto a context whose
 * origin is the instance's box top-left; the engine keeps the shader only
 * where the mask painted (`destination-in`). Replaces the ring punch — use it
 * for metal-filled text or glyphs.
 */
export type MaskFn = (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => void;

export interface MetalFxInstance {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  cssWidth: number;
  cssHeight: number;
  cornerRadius: number;
  kind: 'pill' | 'circle';
  ringCssPx: number;
  shaderScale: number;
  opacityMul: number;
  /** Extra multiplier on the glow only (halo + catch-light), default 1. Lets
   *  a dim shader (low `opacityMul`) still carry a visible glow. */
  glowGain: number;
  visible: boolean;
  /** Per-instance freeze flag. When true the instance's 2D canvas keeps the
   *  last copied frame; the shared GL loop continues for any other unpaused
   *  instance. */
  paused: boolean;
  /** Set to true after the first successful copyShaderToInstance — so an
   *  instance that mounts already paused still gets one frame painted before
   *  it freezes (otherwise it would render a blank canvas). */
  everCopied: boolean;
  /** The shader frame this instance froze on when paused. While paused every
   *  composite (a bend redraw, a resize) draws from this copy, so the ring
   *  keeps its still texture while the shared loop runs on for others. */
  frozen: HTMLCanvasElement | null;
  dpr: number;
  /** Master scale multiplier for absolute-pixel internals (glow stroke
   *  widths/blurs, reflection stroke band, etc.). 1 is the baseline. Set to
   *  2 for a CSS-zoomed 2× hero so glow + reflection grow with the layout. */
  scale: number;
  onAfterFrame?: () => void;
  /** Fired after every composite, synchronously — for layers that must track
   *  the ring exactly (the glow's mask while deforming). */
  onComposite?: () => void;
  /** One-shot callback fired after the very first copyShaderToInstance.
   *  Auto-cleared by the loop so it never fires twice. */
  onFirstCopy?: () => void;
  /** See `MaskFn`. Takes precedence over the ring punch and over `deform`. */
  mask: MaskFn | null;
  /** Unmasked copy of the metal sheet for masked instances — what a mirror
   *  facing the glyphs would see (the stripes, not three thin letters).
   *  Allocated on demand when a glyph reflection target asks for it. */
  rawCanvas: HTMLCanvasElement | null;
  wantRaw: boolean;
  /** Ring-only copy while a deform is active. The bend draws the host's
   *  fill / rim / hairline into the main canvas so they bend along; a
   *  reflection that mirrored that would jump from "ring" to "filled disc"
   *  the moment the bend starts. Allocated on demand by reflection targets. */
  ringCanvas: HTMLCanvasElement | null;
  wantRing: boolean;
  /** See `DeformFn`. Null = rigid rounded-rect mask. */
  deform: DeformFn | null;
  deformLayers: DeformLayers | null;
  /** Canvas margin beyond the CSS box, CSS px, so displaced geometry that
   *  bulges outward isn't clipped. 0 unless deforming. */
  overscan: number;
  /** Pointer acting as a light source: the outline point nearest the cursor
   *  (box-local CSS px) and a 0..1 proximity weight. Set by the cursor-light
   *  tracker; the glow's hotspot faces it. Null when the pointer is away. */
  cursorLight: { x: number; y: number; w: number } | null;
  /** Set by the glow callback when its envelope is mid-fade: the loop then
   *  ticks the glow every animation frame instead of every shader frame, so
   *  a 300 ms fade gets ~20 steps rather than 4. */
  glowFast: boolean;
}

export interface SharedRenderer {
  glCanvas: HTMLCanvasElement | OffscreenCanvas;
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  uniforms: Record<string, WebGLUniformLocation | null>;
  /** 1×1 placeholder bound to `u_image`; see buildGLPipeline. */
  dummyTexture: WebGLTexture | null;
  preset: PresetMode;
  presetDirty: boolean;
  contextLost: boolean;
  useOffscreen: boolean;
  frameBitmap: ImageBitmap | null;
  startMs: number;
  pausedMs: number;
  pausedAtMs: number | null;
  rafId: number;
  dpr: number;
  instances: Set<MetalFxInstance>;
  frameCount: number;
  glowQueue: MetalFxInstance[];
  glowIdx: number;
  glowSkip: number;
  glowPixels: Uint8Array;
  glowPixelsW: number;
  glowPixelsH: number;
}

export let SHARED: SharedRenderer | null = null;

let _supported: boolean | null = null;
/**
 * Whether this browser can run the engine (WebGL2). Cached after the first
 * call. Consumers get this for free through `<MetalFx>`, which renders its
 * children plain when unsupported instead of throwing.
 */
export function isMetalFxSupported(): boolean {
  if (_supported !== null) return _supported;
  if (typeof document === 'undefined') return (_supported = false);
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') as WebGL2RenderingContext | null;
    _supported = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    _supported = false;
  }
  return _supported;
}

// Called by ensureSharedRenderer on first init and by the contextrestored
// listener to rebuild GL state after the browser reclaims the context.
let _onContextRestored: (() => void) | null = null;
export function setContextRestoredCallback(cb: (() => void) | null): void {
  _onContextRestored = cb;
}

const UNIFORM_NAMES = [
  // Fragment stage (Paper liquidMetal)
  'u_resolution', 'u_time', 'u_pixelRatio',
  'u_colorBack', 'u_colorTint',
  'u_repetition', 'u_softness', 'u_shiftRed', 'u_shiftBlue',
  'u_distortion', 'u_contour', 'u_angle', 'u_shape', 'u_isImage', 'u_image',
  // Vertex stage (Paper sizing)
  'u_originX', 'u_originY', 'u_worldWidth', 'u_worldHeight',
  'u_fit', 'u_scale', 'u_rotation', 'u_offsetX', 'u_offsetY',
  'u_imageAspectRatio',
];

/**
 * Paper's shader writes premultiplied color (`color *= opacity` before the
 * backdrop composite), so the blend func has to be ONE / 1-SRC_ALPHA. Pairing
 * premultiplied output with the classic SRC_ALPHA factor double-darkens every
 * partially-transparent pixel — which on a 1px ring is the whole thing.
 */
function buildGLPipeline(gl: WebGL2RenderingContext): {
  program: WebGLProgram;
  buffer: WebGLBuffer;
  uniforms: Record<string, WebGLUniformLocation | null>;
  dummyTexture: WebGLTexture | null;
} {
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const vert = compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER_SRC);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER_SRC);
  const program = linkProgram(gl, vert, frag);
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL method, not a React hook
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  if (!buffer) throw new Error('metal-fx: gl.createBuffer returned null');
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const posLoc = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(posLoc);
  // Paper declares `a_position` as vec4; feeding 2 floats leaves z=0, w=1,
  // which is exactly the full-screen quad the shader expects.
  gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

  const uniforms: Record<string, WebGLUniformLocation | null> = {};
  for (const n of UNIFORM_NAMES) uniforms[n] = gl.getUniformLocation(program, n);

  // `u_image` is dead at u_isImage=false, but an unbound sampler2D is
  // undefined behaviour and renders black on some drivers. Bind 1×1 opaque
  // black to texture unit 0 and leave it there for the life of the program.
  const dummyTexture = gl.createTexture();
  if (dummyTexture) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, dummyTexture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([0, 0, 0, 255])
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (uniforms.u_image) gl.uniform1i(uniforms.u_image, 0);
  }

  return { program, buffer, uniforms, dummyTexture };
}

export function ensureSharedRenderer(): SharedRenderer {
  if (SHARED) return SHARED;

  const dpr = Math.min(GL_DPR_CAP, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const size = Math.round(CANONICAL_GL_SIZE * dpr);
  const useOffscreen = typeof OffscreenCanvas !== 'undefined';

  let glCanvas: HTMLCanvasElement | OffscreenCanvas;
  let gl: WebGL2RenderingContext | null;

  // WebGL2 is required, not preferred: Paper's shaders are `#version 300 es`
  // and use textureSize/fwidth/textureGrad. There is no WebGL1 fallback path.
  if (useOffscreen) {
    glCanvas = new OffscreenCanvas(size, size);
    gl = glCanvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false,
    }) as WebGL2RenderingContext | null;
  } else {
    const htmlCanvas = document.createElement('canvas');
    htmlCanvas.width = size;
    htmlCanvas.height = size;
    gl = htmlCanvas.getContext('webgl2', {
      alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null;
    glCanvas = htmlCanvas;
  }
  if (!gl) throw new Error('metal-fx: WebGL2 not supported');

  const { program, buffer, uniforms, dummyTexture } = buildGLPipeline(gl);

  const onContextLost = (e: Event) => { e.preventDefault(); if (SHARED) SHARED.contextLost = true; };
  const onContextRestored = () => {
    if (!SHARED) return;
    const rebuilt = buildGLPipeline(SHARED.gl);
    SHARED.program = rebuilt.program;
    SHARED.buffer = rebuilt.buffer;
    SHARED.uniforms = rebuilt.uniforms;
    SHARED.dummyTexture = rebuilt.dummyTexture;
    SHARED.presetDirty = true;
    SHARED.contextLost = false;
    _onContextRestored?.();
  };
  glCanvas.addEventListener('webglcontextlost', onContextLost as EventListener, false);
  glCanvas.addEventListener('webglcontextrestored', onContextRestored as EventListener, false);

  SHARED = {
    glCanvas, gl, program, buffer, uniforms, dummyTexture,
    preset: PRESETS.chromatic.modes.dark, presetDirty: true,
    contextLost: false, useOffscreen, frameBitmap: null,
    startMs: performance.now(), pausedMs: 0, pausedAtMs: null,
    rafId: 0, dpr, instances: new Set(), frameCount: 0,
    glowQueue: [], glowIdx: 0, glowSkip: 0,
    glowPixels: new Uint8Array(size * size * 4),
    glowPixelsW: size, glowPixelsH: size,
  };
  return SHARED;
}

export function teardownSharedRenderer(): void {
  if (!SHARED) return;
  const { gl, program, buffer, frameBitmap, dummyTexture } = SHARED;
  try {
    frameBitmap?.close();
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    if (dummyTexture) gl.deleteTexture(dummyTexture);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* swallow */ }
  SHARED = null;
}
