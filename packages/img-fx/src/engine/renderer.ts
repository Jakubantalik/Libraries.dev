/**
 * Shared Three.js renderer driving every <ImageGeneration> on the page.
 *
 * Architecture:
 *   1. One module-scope SharedRenderer is lazily created on first card mount.
 *      It owns a single offscreen <canvas> + THREE.WebGLRenderer + ortho
 *      camera + ShaderMaterial + plane mesh.
 *   2. Each card registers an Instance: a visible 2D canvas + its own
 *      uniform cache + dirty flag + reveal/cycle state. Per frame the loop
 *      sizes the SHARED GL canvas to the largest active card (grow-only —
 *      never shrinks), then for each visible/unpaused instance: sets
 *      u_resolution to the instance's pixel size, sets the GL viewport +
 *      scissor to the bottom-left iw×ih sub-rect (the only sub-rect where
 *      `gl_FragCoord / u_resolution` lands in [0..1]), renders, and copies
 *      that sub-rect into the visible 2D canvas via drawImage.
 *      This avoids reallocating the GL drawing buffer every frame when
 *      multiple cards of different sizes share the renderer — the original
 *      "setSize per instance per frame" churn was exhausting Chrome's GPU
 *      memory budget over the course of a few minutes of continuous
 *      animation and crashing the WebGL context.
 *   3. IntersectionObserver pauses offscreen instances; when no instances
 *      are active the rAF loop is cancelled entirely (re-armed by the next
 *      visibility / pause / size change), so a fully-offscreen page costs
 *      essentially nothing.
 *   4. WebGL context loss is handled: on `webglcontextlost` the rAF is
 *      cancelled and uniforms marked dirty; on `webglcontextrestored` the
 *      renderer recovers and resumes.
 *   5. Last unmount disposes everything (geometry, materials, renderer).
 *   6. Programs are compiled per effect (`specializeEffect`), lazily, so a
 *      page only ever compiles the effects its presets use.
 *   7. Mosaic presets (dotMode 1 / 2) render in two passes: the cell field
 *      (effect colour + highlight, constant per cell) into a tiny
 *      gridX×gridY target, then a cheap per-pixel composite. Same image as
 *      the single pass, a few hundred noise evaluations per frame instead of
 *      several per pixel. Custom fragment shaders keep the single pass.
 *
 * This mirrors the metal-fx shared-renderer pattern but built around Three.js
 * (peer dep) so the GLSL from image.html drops in unchanged.
 */
import * as THREE from 'three';
import { parseCssColor, type EnginePresetMode, type PresetMode } from '../presets';
import { FRAG_SRC, VERT_SRC, specializeEffect } from './shaders';
import type { RevealState } from './reveal';

/** Frame interval (ms). 10 fps cap is the sweet spot for the bundled presets
 *  — they drift at `speed` 0.3-0.9 rad/s, which is a phase delta of just
 *  0.03-0.09 rad per frame at 10 fps (well below the perceptual flicker
 *  threshold for smoothly varying fields). Drops shader + reveal work by
 *  ~33% vs. the previous 15 fps cap; for fast-moving custom presets the
 *  consumer can opt back up via `setFrameRate(15)` or higher. */
let frameIntervalMs = 1000 / 10;
/** Maximum device-pixel-ratio applied to the GL canvas (image.html line 952).
 *  At 1.25 (vs the original 1.5) fragment work drops by ~31% per render
 *  with essentially no visible difference on the cell-quantised mosaic
 *  presets bundled with the library. Mutable via `setMaxDpr()`. */
let maxDpr = 1.25;
/** Maximum device-pixel-ratio applied to the *visible* 2D canvas (the one
 *  the user actually sees) and, by extension, the reveal image drawn into
 *  it. Decoupled from `maxDpr` because:
 *
 *  - GL fragment work scales with `maxDpr²` and is the dominant per-frame
 *    cost — bumping it is expensive.
 *  - The visible canvas only receives ONE hardware-accelerated `drawImage`
 *    per frame (rect copy from the GL framebuffer) plus, briefly during
 *    reveal, the photographic image draw. Both are cheap even at 2× DPR.
 *
 *  Capping the *visible* canvas higher fixes the iOS-Safari / iOS-Firefox
 *  blur that 1.25× produced on `devicePixelRatio: 3` retina screens:
 *  the GL framebuffer (still rendered at `maxDpr`=1.25) is upscaled into
 *  the visible canvas with nearest-neighbour `drawImage`, so the cell
 *  mosaic stays crisp at no extra GL cost, while the reveal image —
 *  which `paintMaskedFrame` always draws with `imageSmoothingEnabled =
 *  true` at full quality — lands at the device's native pixel grid.
 *  2 is the standard "retina2x" cap; going to 3 on iPhone is below visual
 *  acuity for this content and would just chew CPU on the per-frame
 *  drawImage copy. */
const MAX_CANVAS_DPR = 2;

function resolveCanvasDpr(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(window.devicePixelRatio || 1, MAX_CANVAS_DPR);
}

/** Instance handle returned by `createInstance`. Each <ImageGeneration> owns one. */
export interface Instance {
  /** Visible 2D canvas painted into the host wrapper. */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** CSS-px size (synced from ResizeObserver). */
  cssWidth: number;
  cssHeight: number;
  /** GL render DPR cached at creation; refreshed on resize. Caps at
   *  `maxDpr` (default 1.25) — this is the cheap-fragment-shader knob. */
  dpr: number;
  /** Display DPR for the visible 2D canvas (and reveal image). Caps at
   *  `MAX_CANVAS_DPR` (default 2). May exceed `dpr`: when it does, the
   *  low-DPR GL framebuffer is upscaled into the visible canvas with
   *  `imageSmoothingEnabled = false` so the cell mosaic stays crisp at
   *  no extra GL cost, while the reveal image — drawn directly into
   *  this canvas with smoothing enabled — gets the device's full pixel
   *  density. Fixes blur on iOS Safari/Firefox where DPR=3. */
  canvasDpr: number;
  /** Active preset mode block (dark or light).
   *
   * Typed as `EnginePresetMode` (the wider engine-internal shape)
   * even though the public `setInstancePreset` accepts a narrower
   * `PresetMode` — the cast is sound because the runtime objects
   * exported via PRESETS always carry the dot-mode fields. */
  preset: EnginePresetMode;
  /** Optional override for `preset.cardBg` (#rrggbb). When set, this color is
   *  used as the shader's `u_cardBg` and forwarded to the reveal helper so
   *  background-derived shader logic stays in sync with the host card color. */
  cardBgOverride: string | null;
  /** Optional per-slot palette override (CSS colors, up to 7 entries). A slot
   *  with a value replaces the preset color verbatim (bypassing the card-bg
   *  linked remap); missing/undefined slots fall back to the preset palette.
   *  Lets consumers re-tint the running effect (e.g. from an image) without
   *  authoring a whole preset. */
  colorsOverride: (string | null | undefined)[] | null;
  /** Strength multiplier 0..1 (drives `canvas.style.opacity`). */
  strength: number;
  /** Animation-clock multiplier on top of the preset's baked speed. Scales
   *  the per-frame time delta, so drift, churn and flicker all speed up or
   *  slow down together. 1 = preset tempo. */
  speedMul: number;
  /** Pixel-cell on-screen size multiplier. 1 = preset default, 0.5 = cells at
   *  half size (finer / zoomed out), 2 = double size (chunkier / zoomed in).
   *  Applied by dividing the shader grid's base cell count so both the shader
   *  mosaic and the reveal dissolve share the same scaled grid. */
  pixelScale: number;
  /** True when in viewport. */
  visible: boolean;
  /** True when the user has paused this instance. */
  paused: boolean;
  /** Dirty flag - true until uniforms have been re-uploaded. */
  uniformsDirty: boolean;
  /** Reveal state (image overlay drawn on top of shader). Null when no overlay. */
  reveal: RevealState | null;
  /** Per-instance accumulated time so each card animates at its own preset.speed. */
  accumulatedTime: number;
  /** When created (ms) — used for first-tick init only. */
  startedAtMs: number;
}

interface SharedRenderer {
  glCanvas: HTMLCanvasElement;
  /** WebGL2 context if available, otherwise WebGL1. */
  gl: WebGLRenderingContext | WebGL2RenderingContext;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  /** Fragment source every program is built from (bundled or custom). */
  fragSrc: string;
  /** Compiled programs, keyed `${pass}:${effect}` — see `getMaterial`. */
  materials: Map<string, THREE.ShaderMaterial>;
  /** Cell-field target of the two-pass mosaic. Grow-only, like the GL
   *  canvas; each paint uses its bottom-left gridX×gridY texels. Null until
   *  the first mosaic paint. */
  fieldTarget: THREE.WebGLRenderTarget | null;
  geometry: THREE.PlaneGeometry;
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  instances: Set<Instance>;
  /** 0 means the rAF loop is currently asleep (no active instances).
   *  The loop is re-armed by `wakeLoop()` whenever an instance becomes
   *  visible/unpaused or its size grows past the current GL canvas. */
  rafId: number;
  lastFrameMs: number;
  lastTickMs: number;
  /** Last instance whose uniforms were uploaded to `uniforms`. Used to skip
   *  re-uploading full uniform blocks when the same clean instance renders
   *  again back-to-back (e.g. single-card page, manual repaint). Null after
   *  destroy or when the next instance can't trust this cache. */
  lastInstance: Instance | null;
  /** WebGL context loss handlers — kept so we can detach on dispose. */
  onContextLost: ((e: Event) => void) | null;
  onContextRestored: (() => void) | null;
  contextLost: boolean;
}

let SHARED: SharedRenderer | null = null;

function createUniforms(): Record<string, THREE.IUniform> {
  return {
    u_resolution: { value: new THREE.Vector2(1, 1) },
    u_dpr: { value: 1 },
    u_time: { value: 0 },
    u_color1: { value: new THREE.Color(0x1a1a1a) },
    u_color2: { value: new THREE.Color(0x808080) },
    u_color3: { value: new THREE.Color(0xd9d9d9) },
    u_color4: { value: new THREE.Color(0x404040) },
    u_color5: { value: new THREE.Color(0xc0c0c0) },
    u_color6: { value: new THREE.Color(0x606060) },
    u_color7: { value: new THREE.Color(0xa0a0a0) },
    u_cardBg: { value: new THREE.Color(0x0f0f0f) },
    u_alpha1: { value: 1 },
    u_alpha2: { value: 1 },
    u_alpha3: { value: 1 },
    u_alpha4: { value: 1 },
    u_alpha5: { value: 1 },
    u_alpha6: { value: 1 },
    u_alpha7: { value: 1 },
    u_speed: { value: 1 },
    u_intensity: { value: 1 },
    u_scale: { value: 1.5 },
    u_direction: { value: 0 },
    u_softness: { value: 0.75 },
    u_distortion: { value: 0.3 },
    u_complexity: { value: 0.2 },
    u_shape: { value: 0.5 },
    u_flicker: { value: 0 },
    u_vignette: { value: 0.25 },
    u_vigOpacity: { value: 1 },
    u_blur: { value: 0 },
    u_highlight: { value: 0.4 },
    u_shaderOpacity: { value: 1 },
    u_cellSize: { value: 0.5 },
    u_gap: { value: 0.3 },
    u_dotSize: { value: 0.8 },
    u_dotSoftness: { value: 0.1 },
    u_dotOpacity: { value: 1 },
    u_hlScale: { value: 0 },
    u_fillOpacity: { value: 0 },
    u_edgeFade: { value: 16 },
    u_fadeStr: { value: 1 },
    u_dotMode: { value: 2 },
    u_effect: { value: 4 },
    u_sweepEase: { value: 0 },
    u_grid: { value: new THREE.Vector2(2, 2) },
    u_fieldSize: { value: new THREE.Vector2(1, 1) },
    u_field: { value: null }
  };
}

function ensureShared(): SharedRenderer {
  if (SHARED) return SHARED;

  const glCanvas = document.createElement('canvas');
  glCanvas.width = 8;
  glCanvas.height = 8;

  // `preserveDrawingBuffer: false` is the default and the right choice here:
  // we drawImage() the GL canvas into the visible 2D canvas IMMEDIATELY after
  // every renderer.render() in the same JS tick, so we never need the swap
  // chain to preserve back-buffer contents between frames. Preserving it was
  // forcing extra GPU memory retention which compounded the GL-buffer churn
  // issue and contributed to multi-minute crashes in Chrome.
  const renderer = new THREE.WebGLRenderer({
    canvas: glCanvas,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
    antialias: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, maxDpr));
  renderer.setClearColor(0x000000, 0);
  renderer.autoClear = true;

  const gl = renderer.getContext();

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = createUniforms();
  const geometry = new THREE.PlaneGeometry(2, 2);
  // The material is picked per draw (`drawShader`); none is built up front.
  const mesh = new THREE.Mesh(geometry);
  scene.add(mesh);

  SHARED = {
    glCanvas,
    gl,
    renderer,
    scene,
    camera,
    fragSrc: FRAG_SRC,
    materials: new Map(),
    fieldTarget: null,
    geometry,
    mesh,
    uniforms,
    instances: new Set(),
    rafId: 0,
    lastFrameMs: 0,
    lastTickMs: performance.now(),
    lastInstance: null,
    onContextLost: null,
    onContextRestored: null,
    contextLost: false
  };

  // WebGL context loss recovery. Without this, a transient GPU hiccup (driver
  // reset, tab backgrounded too long, GPU OOM, etc.) would permanently freeze
  // every <ImageGeneration> on the page. `preventDefault()` on `lost` tells
  // the browser we'd like a restored context; on `restored` we re-arm the
  // loop and force every instance to re-upload its uniforms.
  const onLost = (e: Event): void => {
    e.preventDefault();
    if (!SHARED) return;
    SHARED.contextLost = true;
    if (SHARED.rafId !== 0) {
      cancelAnimationFrame(SHARED.rafId);
      SHARED.rafId = 0;
    }
  };
  const onRestored = (): void => {
    if (!SHARED) return;
    SHARED.contextLost = false;
    SHARED.lastInstance = null;
    for (const inst of SHARED.instances) inst.uniformsDirty = true;
    wakeLoop();
  };
  glCanvas.addEventListener('webglcontextlost', onLost as EventListener, false);
  glCanvas.addEventListener('webglcontextrestored', onRestored, false);
  SHARED.onContextLost = onLost;
  SHARED.onContextRestored = onRestored;

  wakeLoop();
  return SHARED;
}

function destroyShared(): void {
  if (!SHARED) return;
  if (SHARED.rafId !== 0) cancelAnimationFrame(SHARED.rafId);
  if (SHARED.onContextLost) {
    SHARED.glCanvas.removeEventListener('webglcontextlost', SHARED.onContextLost as EventListener, false);
  }
  if (SHARED.onContextRestored) {
    SHARED.glCanvas.removeEventListener('webglcontextrestored', SHARED.onContextRestored, false);
  }
  SHARED.geometry.dispose();
  for (const m of SHARED.materials.values()) m.dispose();
  SHARED.materials.clear();
  SHARED.fieldTarget?.dispose();
  SHARED.renderer.dispose();
  SHARED = null;
}

function uploadInstanceUniforms(s: SharedRenderer, inst: Instance): void {
  const p = inst.preset;
  const u = s.uniforms;
  u.u_effect.value = p.effectIndex;
  u.u_speed.value = p.speed;
  // Strength above 1 boosts the shader's palette intensity and highlight
  // (canvas opacity is already at 1 there), so the top of the strength
  // range reads as a markedly more prominent effect rather than saturating
  // early. The 2.2 slope makes strength=2 roughly a 3× intensity push.
  const boost = 1 + Math.max(0, inst.strength - 1) * 2.2;
  u.u_intensity.value = p.intensity * boost;
  u.u_scale.value = p.scale;
  u.u_direction.value = (p.direction * Math.PI) / 180;
  u.u_softness.value = p.softness;
  u.u_distortion.value = p.distortion;
  u.u_complexity.value = p.complexity;
  u.u_shape.value = p.shape;
  u.u_flicker.value = p.flicker ?? 0;
  u.u_vignette.value = p.vignette;
  u.u_vigOpacity.value = p.vigOpacity;
  u.u_blur.value = p.blur;
  u.u_highlight.value = p.highlight * boost;
  u.u_shaderOpacity.value = p.shaderOpacity;
  u.u_dotMode.value = p.dotMode;
  u.u_sweepEase.value = p.sweepEase != null ? Math.floor(p.sweepEase) : 0;

  const mosaic = p.dotMode === 1 ? p.pixelConfig : p.dotConfig;
  u.u_cellSize.value = effectiveCellSize(mosaic.cellSize, inst.pixelScale);
  u.u_gap.value = mosaic.gap;
  u.u_dotSize.value = mosaic.dotSize;
  u.u_dotSoftness.value = mosaic.dotSoftness;
  u.u_dotOpacity.value = mosaic.dotOpacity;
  u.u_hlScale.value = mosaic.hlScale;
  u.u_fillOpacity.value = mosaic.fillOpacity;
  u.u_edgeFade.value = mosaic.edgeFade;
  u.u_fadeStr.value = mosaic.fadeStr;

  // `cardBgOverride` comes straight from the consumer's `cardBg` prop and is
  // documented as accepting any CSS colour, so route through parseCssColor
  // (alpha is dropped — see the parseCssColor JSDoc for why). The bundled
  // preset's own `cardBg` is always hex and hits the fast path.
  const [br, bg, bb] = parseCssColor(inst.cardBgOverride ?? p.cardBg);

  for (let i = 0; i < 7; i++) {
    const override = inst.colorsOverride?.[i];
    const [r, g, b] = override != null ? parseCssColor(override) : effectivePaletteColor(inst, i);
    (u[`u_color${i + 1}`].value as THREE.Color).setRGB(r, g, b);
    u[`u_alpha${i + 1}`].value = p.alphas[i];
  }
  (u.u_cardBg.value as THREE.Color).setRGB(br, bg, bb);

  inst.uniformsDirty = false;
}

/** Hex (#rrggbb) currently in effect for this instance, accounting for override. */
export function effectiveCardBg(inst: Instance): string {
  return inst.cardBgOverride ?? inst.preset.cardBg;
}

/**
 * Palette colour `index` (0–6) as [r,g,b] in 0–1, after the card-linked remap
 * (port of image.html's card-variable behaviour).
 *
 * Any preset colour authored to equal the preset's OWN canonical `cardBg` is
 * treated as a "card variable": when the consumer overrides `cardBg`, those
 * colours follow the new surface instead of staying at the preset default
 * (otherwise e.g. sweep-gradient's #0f0f0f swatches read as dark blocks on a
 * #1B1B1B demo card). With no override the effective bg equals the preset bg,
 * so the comparison is a no-op and the raw colour is returned unchanged.
 *
 * Shared by the shader uniform upload and the reveal mask so the effect and
 * its reveal silhouette stay in lockstep.
 */
export function effectivePaletteColor(inst: Instance, index: number): [number, number, number] {
  const p = inst.preset;
  const [r, g, b] = parseCssColor(p.colors[index]);
  if (inst.cardBgOverride == null) return [r, g, b];
  const [pbr, pbg, pbb] = parseCssColor(p.cardBg);
  const chan = (v: number): number => Math.round(v * 255);
  if (chan(r) === chan(pbr) && chan(g) === chan(pbg) && chan(b) === chan(pbb)) {
    return parseCssColor(inst.cardBgOverride);
  }
  return [r, g, b];
}

/** Compute the pixel-space size an instance currently needs from the GL
 *  framebuffer (CSS px × DPR, floored, min 1). Used by both the grow-only
 *  canvas sizer and per-paint viewport setup so the two stay in lockstep. */
function instancePixelSize(inst: Instance): { iw: number; ih: number } {
  return {
    iw: Math.max(1, Math.floor(inst.cssWidth * inst.dpr)),
    ih: Math.max(1, Math.floor(inst.cssHeight * inst.dpr))
  };
}

/** Grow the shared GL canvas if any active instance now needs more pixels
 *  than it currently provides. NEVER SHRINKS — frequent shrink/grow cycles
 *  reallocate the GL drawing buffer (each call is 1-10 MB of GPU memory
 *  churn) and that was the primary cause of multi-minute Chrome crashes.
 *
 *  Called once at the top of each frame (before iterating instances) so the
 *  canvas size is stable for the entire tick. */
function maybeGrowGlCanvas(s: SharedRenderer): void {
  let needCssW = 0;
  let needCssH = 0;
  for (const inst of s.instances) {
    if (!inst.visible || inst.paused) continue;
    if (inst.cssWidth > needCssW) needCssW = inst.cssWidth;
    if (inst.cssHeight > needCssH) needCssH = inst.cssHeight;
  }
  if (needCssW <= 0 || needCssH <= 0) return;
  const dpr = s.renderer.getPixelRatio();
  const needPxW = Math.max(1, Math.floor(needCssW * dpr));
  const needPxH = Math.max(1, Math.floor(needCssH * dpr));
  const curW = s.glCanvas.width;
  const curH = s.glCanvas.height;
  if (needPxW <= curW && needPxH <= curH) return;
  // Pass CSS px (setSize multiplies by pixel ratio internally). Pick the max
  // of the current and required dimensions so neither axis ever contracts.
  const targetCssW = Math.max(needCssW, curW / Math.max(dpr, 0.0001));
  const targetCssH = Math.max(needCssH, curH / Math.max(dpr, 0.0001));
  s.renderer.setSize(targetCssW, targetCssH, false);
}

/** Debug switch for the two-pass mosaic (see `setTwoPassMosaic`). */
let twoPassMosaic = true;

/** Reference card edge (CSS px) of the shader's `gridCounts`. */
const REF_DIM = 320;

/**
 * Program for `effect` at `pass` (0 = single pass, 1 = cell field,
 * 2 = composite), built on first use. All materials share the one uniform
 * block, so switching program never needs a re-upload.
 */
function getMaterial(s: SharedRenderer, effect: number, pass: 0 | 1 | 2): THREE.ShaderMaterial {
  const key = `${pass}:${effect}`;
  let m = s.materials.get(key);
  if (m) return m;
  const field = pass === 1;
  m = new THREE.ShaderMaterial({
    vertexShader: VERT_SRC,
    fragmentShader: specializeEffect(s.fragSrc, effect),
    defines: { IMGFX_PASS: pass },
    uniforms: s.uniforms,
    // The field pass writes raw colour + highlight weight; blending would
    // fold the weight (in alpha) into the colour.
    transparent: !field,
    depthTest: false,
    depthWrite: false,
    blending: field ? THREE.NoBlending : THREE.NormalBlending
  });
  s.materials.set(key, m);
  return m;
}

/** Mosaic grid for the uploaded uniforms. Mirrors the shader's
 *  `imgfx_mosaicGrid` in float32 so both passes agree with the single one. */
function mosaicGrid(u: Record<string, THREE.IUniform>): { gx: number; gy: number } {
  const f = Math.fround;
  const res = u.u_resolution.value as THREE.Vector2;
  const dpr = f(Math.max(u.u_dpr.value as number, 0.0001));
  const base = f(6 + f(f(u.u_cellSize.value as number) * 74));
  let gx = Math.max(2, Math.floor(f(f(base * f(f(res.x) / dpr)) / REF_DIM)));
  let gy = Math.max(2, Math.floor(f(f(base * f(f(res.y) / dpr)) / REF_DIM)));
  if ((u.u_dotMode.value as number) > 1.5) {
    const k = f(1 - f(f(u.u_gap.value as number) * 0.8));
    gx = Math.max(2, Math.floor(f(gx * k)));
    gy = Math.max(2, Math.floor(f(gy * k)));
  }
  return { gx, gy };
}

function createFieldTarget(s: SharedRenderer, w: number, h: number, type: THREE.TextureDataType): THREE.WebGLRenderTarget | null {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: false,
    stencilBuffer: false
  });
  // Float colour attachments need extensions some devices lack; check the
  // framebuffer so the caller can fall back to a narrower type.
  s.renderer.setRenderTarget(rt);
  const gl = s.gl;
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  s.renderer.setRenderTarget(null);
  if (ok) return rt;
  rt.dispose();
  return null;
}

/** Field target with room for a gx×gy grid. Grow-only. A float target keeps
 *  the cell colour and highlight weight exact, so the composite matches the
 *  single pass bit for bit; half float, then 8-bit (within ~1/255 in
 *  practice), are the fallbacks. */
function ensureFieldTarget(s: SharedRenderer, gx: number, gy: number): THREE.WebGLRenderTarget | null {
  const cur = s.fieldTarget;
  if (cur && cur.width >= gx && cur.height >= gy) return cur;
  const w = Math.max(gx, cur?.width ?? 64);
  const h = Math.max(gy, cur?.height ?? 64);
  if (cur) {
    cur.setSize(w, h);
    return cur;
  }
  s.fieldTarget =
    createFieldTarget(s, w, h, THREE.FloatType) ??
    createFieldTarget(s, w, h, THREE.HalfFloatType) ??
    createFieldTarget(s, w, h, THREE.UnsignedByteType);
  return s.fieldTarget;
}

/**
 * Draw the shader for the uploaded uniforms into the renderer's current
 * viewport. Mosaic modes (`u_dotMode` > 0.5) of the bundled shader take the
 * two-pass path; raw mode and custom shaders draw in a single pass.
 * Also used by the reveal sampler, which re-draws with patched uniforms.
 */
export function drawShader(s: SharedRenderer): void {
  const u = s.uniforms;
  const effect = u.u_effect.value as number;
  const mosaic = (u.u_dotMode.value as number) > 0.5;
  const rt = twoPassMosaic && mosaic && s.fragSrc === FRAG_SRC ? fieldTargetFor(s) : null;
  if (!rt) {
    s.mesh.material = getMaterial(s, effect, 0);
    s.renderer.render(s.scene, s.camera);
    return;
  }
  const grid = u.u_grid.value as THREE.Vector2;
  rt.viewport.set(0, 0, grid.x, grid.y);
  s.mesh.material = getMaterial(s, effect, 1);
  s.renderer.setRenderTarget(rt);
  s.renderer.render(s.scene, s.camera);
  // Back to the canvas: the renderer restores its own viewport + scissor.
  s.renderer.setRenderTarget(null);
  (u.u_fieldSize.value as THREE.Vector2).set(rt.width, rt.height);
  u.u_field.value = rt.texture;
  s.mesh.material = getMaterial(s, effect, 2);
  s.renderer.render(s.scene, s.camera);
}

/** Sets `u_grid` for the current uniforms and returns a field target big
 *  enough for it (null if none could be created). */
function fieldTargetFor(s: SharedRenderer): THREE.WebGLRenderTarget | null {
  const { gx, gy } = mosaicGrid(s.uniforms);
  (s.uniforms.u_grid.value as THREE.Vector2).set(gx, gy);
  return ensureFieldTarget(s, gx, gy);
}

/** Debug: turn the two-pass mosaic off to compare against the single pass.
 *  Both draw the same image. */
export function setTwoPassMosaic(enabled: boolean): void {
  twoPassMosaic = enabled;
}

/** Inner render — assumes the caller has already gated on visibility / size /
 *  pause where appropriate AND has called `maybeGrowGlCanvas` for the frame.
 *
 *  Renders the instance into the BOTTOM-LEFT iw×ih sub-rect of the shared GL
 *  canvas. That sub-rect is the only one where the shader's
 *  `uv = gl_FragCoord.xy / u_resolution` lands in `[0..1]² ` (because
 *  gl_FragCoord is window-relative in WebGL with origin at the bottom-left,
 *  and we set u_resolution to the instance's pixel size). After rendering,
 *  we drawImage() that sub-rect into the visible 2D canvas — the source
 *  rect's image-space y is `glCanvas.height - ih` because image-space coords
 *  have origin at the top-left while the framebuffer's origin is at the
 *  bottom-left.
 *
 *  Uniform block re-upload is skipped when the same clean instance just
 *  rendered AND its `uniformsDirty` flag is clear (only `u_time` and
 *  `u_resolution` need refreshing in that case). For multi-card pages
 *  instances rotate so this always re-uploads, but it removes the cost
 *  for single-card pages, manual `renderInstanceOnce` repaints, and
 *  reveal sampling re-renders that don't switch instance. */
function paintInstance(s: SharedRenderer, inst: Instance, nowMs: number): void {
  if (s.contextLost) return;
  const { iw, ih } = instancePixelSize(inst);

  // Constrain rendering to the instance-sized bottom-left sub-rect. setViewport
  // and setScissor on the WebGLRenderer accept CSS pixels and multiply by the
  // renderer's pixel ratio internally, so pass the CSS dims to keep math simple.
  const cssW = Math.max(1, inst.cssWidth);
  const cssH = Math.max(1, inst.cssHeight);
  s.renderer.setViewport(0, 0, cssW, cssH);
  s.renderer.setScissor(0, 0, cssW, cssH);
  s.renderer.setScissorTest(true);

  // u_resolution drives the shader's cell sizes, vignette, edge fade etc.
  // It MUST match the viewport size so `gl_FragCoord / u_resolution` produces
  // sensible UVs inside the rendered sub-rect.
  (s.uniforms.u_resolution.value as THREE.Vector2).set(iw, ih);
  s.uniforms.u_dpr.value = inst.dpr || 1;

  // Reuse uniforms when the same clean instance is rendering again.
  const canReuseUniforms = s.lastInstance === inst && !inst.uniformsDirty;
  if (!canReuseUniforms) {
    uploadInstanceUniforms(s, inst);
    s.lastInstance = inst;
  }
  s.uniforms.u_time.value = inst.accumulatedTime;

  drawShader(s);

  // Resize the visible canvas to the instance's pixel size — at the
  // *display* DPR cap (`canvasDpr`, default 2), not the GL DPR (`dpr`,
  // default 1.25). Sizing this canvas higher than the GL framebuffer is
  // what gives iOS Safari/Firefox a sharp reveal image: `paintMaskedFrame`
  // draws the photograph directly into this canvas with
  // `imageSmoothingEnabled = true`, so the image lands at the device's
  // native pixel grid (DPR 3 on iPhone, DPR 2 on iPad) instead of getting
  // CSS-upscaled from 1.25× by the browser.
  //
  // The reallocation cost is the same as before — the canvas only
  // triggers a buffer alloc when the instance itself resizes — and the
  // per-frame compositing cost adds one hardware-accelerated rect copy
  // at (`dispW × dispH`) which is sub-ms on any GPU-backed 2D context.
  const dispW = Math.max(1, Math.floor(inst.cssWidth * inst.canvasDpr));
  const dispH = Math.max(1, Math.floor(inst.cssHeight * inst.canvasDpr));
  if (inst.canvas.width !== dispW || inst.canvas.height !== dispH) {
    inst.canvas.width = dispW;
    inst.canvas.height = dispH;
  }
  inst.ctx.clearRect(0, 0, dispW, dispH);
  // Source rect is the bottom-left iw×ih of the framebuffer. In image-space
  // (top-left origin) that lives at sy = glCanvas.height - ih.
  const sy = s.glCanvas.height - ih;
  // Disable smoothing for the GL → visible upscale: the shader output is a
  // sharp cell mosaic and nearest-neighbour preserves block edges (bilinear
  // would melt them into a mushy gradient — the exact iOS blur we're
  // fixing for the reveal image, but inverted for the shader). The reveal
  // pipeline (`paintMaskedFrame` and friends) explicitly re-enables
  // smoothing before drawing the photographic image, so this setting only
  // affects this single drawImage call.
  inst.ctx.imageSmoothingEnabled = false;
  inst.ctx.drawImage(s.glCanvas, 0, sy, iw, ih, 0, 0, dispW, dispH);

  // Reveal pipeline (defined in reveal.ts) — paints overlay image into its
  // own mask canvas; we just notify it that the shader frame just finished.
  // Sampling inside `afterShaderFrame` mutates u_dotMode/u_fillOpacity, so
  // invalidate the uniform cache after the hook runs.
  inst.reveal?.afterShaderFrame(s, inst, nowMs);
  if (inst.reveal && inst.reveal.isActive()) {
    s.lastInstance = null;
  }
}

/** Render a single instance into its visible canvas (rAF tick path).
 *  Skips paused / offscreen / zero-size instances so the loop stays cheap. */
function renderInstance(s: SharedRenderer, inst: Instance, nowMs: number): void {
  if (!inst.visible || inst.paused) return;
  if (inst.cssWidth < 1 || inst.cssHeight < 1) return;
  paintInstance(s, inst, nowMs);
}

/**
 * Force a single repaint of an instance regardless of its pause state.
 * Used by React sync effects (preset / cardBg changes etc.) so paused cards
 * still reflect prop edits live in the playground without resuming the
 * animation loop. Skips if the instance is offscreen or zero-sized.
 */
export function renderInstanceOnce(inst: Instance): void {
  if (!SHARED) return;
  if (SHARED.contextLost) return;
  if (!inst.visible) return;
  if (inst.cssWidth < 1 || inst.cssHeight < 1) return;
  // Make sure the GL canvas is big enough for this one-shot repaint even if
  // the loop is currently asleep (no auto-render instance is keeping it
  // sized).
  maybeGrowGlCanvas(SHARED);
  paintInstance(SHARED, inst, performance.now());
}

let onAfterTick: (() => void) | null = null;
/** Hook for cycle scheduler so it can advance phase timers in lockstep. */
export function setAfterTick(cb: (() => void) | null): void {
  onAfterTick = cb;
}

/** Quick check: is at least one instance currently animating (visible &
 *  unpaused)? Used to decide whether the rAF loop should sleep. */
function hasActiveInstances(s: SharedRenderer): boolean {
  for (const inst of s.instances) {
    if (inst.visible && !inst.paused) return true;
  }
  return false;
}

const tick = (now: number): void => {
  if (!SHARED) return;
  if (SHARED.contextLost) {
    SHARED.rafId = 0;
    return;
  }

  // Sleep the rAF loop when nothing is animating. The loop re-arms via
  // `wakeLoop()` when visibility / pause / size next changes — so a fully
  // offscreen or fully-paused page costs essentially zero CPU.
  if (!hasActiveInstances(SHARED)) {
    SHARED.rafId = 0;
    onAfterTick?.();
    return;
  }

  SHARED.rafId = requestAnimationFrame(tick);

  const elapsed = now - SHARED.lastFrameMs;
  if (elapsed < frameIntervalMs) return;
  SHARED.lastFrameMs = now - (elapsed % frameIntervalMs);

  const deltaSec = (now - SHARED.lastTickMs) / 1000;
  SHARED.lastTickMs = now;

  for (const inst of SHARED.instances) {
    if (inst.visible && !inst.paused) {
      inst.accumulatedTime += deltaSec * inst.speedMul;
    }
  }

  // Grow-only resize ONCE per frame (not per instance) so the GL drawing
  // buffer is reallocated at most a handful of times across the lifetime of
  // the page rather than tens of thousands of times per minute.
  maybeGrowGlCanvas(SHARED);

  for (const inst of SHARED.instances) {
    renderInstance(SHARED, inst, now);
  }

  onAfterTick?.();
};

/** Arm the rAF loop if it's currently asleep. Safe to call repeatedly. */
function wakeLoop(): void {
  if (!SHARED) return;
  if (SHARED.contextLost) return;
  if (SHARED.rafId !== 0) return;
  SHARED.lastTickMs = performance.now();
  SHARED.lastFrameMs = SHARED.lastTickMs;
  SHARED.rafId = requestAnimationFrame(tick);
}

/** Public API */

export interface CreateInstanceOptions {
  canvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
  preset: PresetMode;
  strength?: number;
  /** Animation-clock multiplier (see `Instance.speedMul`). @default 1 */
  speed?: number;
  cardBg?: string | null;
  /** Pixel-cell size multiplier (see `Instance.pixelScale`). @default 1 */
  pixelScale?: number;
}

/**
 * Resolve the effective `cellSize` (0..1 preset value) for an instance's
 * `pixelScale`. The shader derives the mosaic grid from
 * `gridCounts(6 + cellSize * 74)`, so scaling the on-screen cell *size* by
 * `pixelScale` means dividing that base count by `pixelScale` (smaller cells
 * = more of them). Returning a re-derived `cellSize` keeps the shader and the
 * reveal dissolve — which both compute `6 + cellSize * 74` independently —
 * perfectly in lockstep without threading an extra uniform.
 *
 * The result can fall below 0 (very chunky) or above 1 (very fine); the
 * shader's `gridCounts` floor of 2 cells keeps that safe.
 */
export function effectiveCellSize(cellSize: number, pixelScale: number): number {
  if (!(pixelScale > 0) || pixelScale === 1) return cellSize;
  const baseCount = (6 + cellSize * 74) / pixelScale;
  return (baseCount - 6) / 74;
}

export function createInstance(opts: CreateInstanceOptions): Instance {
  const s = ensureShared();
  const ctx = opts.canvas.getContext('2d');
  if (!ctx) throw new Error('img-fx: 2D context unavailable');
  const inst: Instance = {
    canvas: opts.canvas,
    ctx,
    cssWidth: opts.cssWidth,
    cssHeight: opts.cssHeight,
    dpr: Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, maxDpr),
    canvasDpr: resolveCanvasDpr(),
    // Public `PresetMode` widens to `EnginePresetMode` at the
    // boundary — see `Instance.preset` for the rationale.
    preset: opts.preset as EnginePresetMode,
    cardBgOverride: opts.cardBg ?? null,
    colorsOverride: null,
    strength: Math.max(0, Math.min(2, opts.strength ?? 1)),
    speedMul: opts.speed != null && opts.speed > 0 ? opts.speed : 1,
    pixelScale: opts.pixelScale != null && opts.pixelScale > 0 ? opts.pixelScale : 1,
    visible: true,
    paused: false,
    uniformsDirty: true,
    reveal: null,
    accumulatedTime: Math.random() * 1000,
    startedAtMs: performance.now()
  };
  s.instances.add(inst);
  wakeLoop();
  return inst;
}

export function destroyInstance(inst: Instance): void {
  if (!SHARED) return;
  SHARED.instances.delete(inst);
  // Drop the uniform-cache pointer if it referenced the dead instance, so the
  // next render of any other instance won't trust stale per-instance uniforms.
  if (SHARED.lastInstance === inst) SHARED.lastInstance = null;
  inst.reveal?.dispose();
  inst.reveal = null;
  if (SHARED.instances.size === 0) destroyShared();
}

export function updateInstanceSize(inst: Instance, cssWidth: number, cssHeight: number): void {
  inst.cssWidth = cssWidth;
  inst.cssHeight = cssHeight;
  if (typeof window !== 'undefined') {
    inst.dpr = Math.min(window.devicePixelRatio, maxDpr);
    // Refresh visible-canvas DPR too — covers monitor swaps and OS
    // zoom changes that move `devicePixelRatio` while the page is open.
    inst.canvasDpr = resolveCanvasDpr();
  }
}

export function setInstancePreset(inst: Instance, preset: PresetMode): void {
  // Same widening cast as `createInstance` — see `Instance.preset`.
  inst.preset = preset as EnginePresetMode;
  inst.uniformsDirty = true;
}

export function setInstanceCardBg(inst: Instance, cardBg: string | null): void {
  inst.cardBgOverride = cardBg;
  inst.uniformsDirty = true;
}

/** Per-slot palette override (see `Instance.colorsOverride`). Pass null to
 *  restore the preset palette. */
export function setInstanceColors(inst: Instance, colors: (string | null | undefined)[] | null): void {
  inst.colorsOverride = colors && colors.length > 0 ? colors.slice(0, 7) : null;
  inst.uniformsDirty = true;
}

export function setInstanceVisible(inst: Instance, visible: boolean): void {
  inst.visible = visible;
  if (visible) wakeLoop();
}

export function setInstancePaused(inst: Instance, paused: boolean): void {
  inst.paused = paused;
  if (!paused) wakeLoop();
}

export function setInstanceStrength(inst: Instance, strength: number): void {
  inst.strength = Math.max(0, Math.min(2, strength));
  // The boost region (>1) feeds u_intensity, which is baked into the cached
  // uniform block — invalidate so the change paints on the next frame.
  inst.uniformsDirty = true;
}

export function setInstanceSpeed(inst: Instance, speed: number): void {
  inst.speedMul = speed > 0 ? speed : 1;
}

export function setInstancePixelScale(inst: Instance, pixelScale: number): void {
  inst.pixelScale = pixelScale > 0 ? pixelScale : 1;
  // Cell count is derived from pixelScale at uniform-upload time, so a change
  // must invalidate the cached uniform block.
  inst.uniformsDirty = true;
}

/**
 * Cap the rAF tick rate (frames per second). Applies globally to every
 * instance sharing the renderer. Values are clamped to a sensible range so
 * a callsite can't accidentally starve the loop or burn CPU at >60.
 *
 * @example setFrameRate(10) // default — best for slow-drift presets
 * @example setFrameRate(15) // smoother for faster custom presets
 * @example setFrameRate(30) // restore the original cap
 */
export function setFrameRate(fps: number): void {
  const safe = Math.max(1, Math.min(60, fps));
  frameIntervalMs = 1000 / safe;
}

/**
 * Cap the device-pixel-ratio used by the GL canvas. Lower values mean
 * fewer fragments to shade per frame (~quadratic GPU saving). Updates the
 * shared `THREE.WebGLRenderer.setPixelRatio` AND every live instance's
 * cached `inst.dpr` so the next render uses the new ratio. Existing
 * instances are forced to re-upload uniforms because the change invalidates
 * the per-instance `u_dpr` value used by the shader's CSS-px calculations.
 *
 * Values are clamped to [1, 4]. Pass `1` for the strongest GPU saving on
 * retina displays; the default is `1.25`.
 */
export function setMaxDpr(dpr: number): void {
  maxDpr = Math.max(1, Math.min(4, dpr));
  if (!SHARED) return;
  const next = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio : 1, maxDpr);
  SHARED.renderer.setPixelRatio(next);
  // Force every instance to re-pick its DPR + re-upload uniforms next paint
  // so `u_dpr`, `u_resolution`, and the GL canvas size all stay coherent.
  for (const inst of SHARED.instances) {
    inst.dpr = next;
    inst.uniformsDirty = true;
  }
  // Invalidate the uniform cache so the next paint re-uploads rather than
  // rolling forward with stale per-instance values.
  SHARED.lastInstance = null;
}

/** Read the current cap (frames per second). */
export function getFrameRate(): number {
  return 1000 / frameIntervalMs;
}

/** Read the current MAX_DPR cap. */
export function getMaxDpr(): number {
  return maxDpr;
}

/** Internal helper for the reveal sampler — exposes the shared renderer to
 *  reveal.ts so it can momentarily re-render with a different dotMode and read
 *  pixels back via gl.readPixels. */
/** Swap the fragment stage every instance renders with, or `null` for the
 *  bundled one. The programs are shared, so this is page-wide. Compile
 *  errors surface from three.js on the next render — validate the source
 *  on a scratch context first if it comes from somewhere untrusted. */
export function setSharedFragmentShader(src: string | null): void {
  const s = ensureShared();
  const next = src ?? FRAG_SRC;
  if (s.fragSrc === next) return;
  s.fragSrc = next;
  // Programs are rebuilt lazily from the new source on the next draw.
  for (const m of s.materials.values()) m.dispose();
  s.materials.clear();
  for (const inst of s.instances) inst.uniformsDirty = true;
  wakeLoop();
}

export function withSharedRenderer<T>(fn: (s: SharedRenderer) => T): T {
  return fn(ensureShared());
}

export type { SharedRenderer };
