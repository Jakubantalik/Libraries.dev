/** Animation loop, per-frame compositing, and instance lifecycle. */
import { hexToRgba } from '../color';
import { FRAME_INTERVAL_MS, GLOW_SKIP_FRAMES } from '../perfConfig';
import { PRESETS, type PresetMode, type PresetName, type PresetTheme } from '../presets';
import {
  SHARED,
  CANONICAL_PILL_W,
  CANONICAL_PILL_H,
  CIRCLE_SHADER_SCALE,
  PILL_SHADER_SCALE,
  ensureSharedRenderer,
  setContextRestoredCallback,
  teardownSharedRenderer,
  type DeformFn,
  type DeformLayers,
  type MaskFn,
  type MetalFxInstance,
} from './core';
import { ensureGlowPixels } from './sampling';
import { createOutlineBuf, roundRectOutline, type OutlineBuf } from './outline';

// Restart the animation loop when the browser restores the GL context.
setContextRestoredCallback(() => {
  if (SHARED && SHARED.instances.size > 0 && SHARED.pausedAtMs === null) {
    startSharedLoop();
  }
});

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!SHARED || SHARED.pausedAtMs !== null || SHARED.contextLost) return;
    if (document.hidden) {
      stopSharedLoop();
    } else if (SHARED.instances.size > 0) {
      startSharedLoop();
    }
  });
}

// ─── Instance lifecycle ───────────────────────────────────────────────────

interface CreateInstanceOptions {
  hostCanvas: HTMLCanvasElement;
  cssWidth: number;
  cssHeight: number;
  cornerRadius: number;
  kind: 'pill' | 'circle';
  shaderScale?: number;
  ringCssPx?: number;
  opacityMul?: number;
  glowGain?: number;
  paused?: boolean;
  scale?: number;
  onAfterFrame?: () => void;
  onComposite?: () => void;
  onFirstCopy?: () => void;
  mask?: MaskFn | null;
}

export function createInstance(opts: CreateInstanceOptions): MetalFxInstance {
  const renderer = ensureSharedRenderer();
  const ctx = opts.hostCanvas.getContext('2d', { alpha: true });
  if (!ctx) throw new Error('metal-fx: canvas 2D context unavailable');

  const scale = opts.scale ?? 1;
  const inst: MetalFxInstance = {
    canvas: opts.hostCanvas, ctx,
    cssWidth: opts.cssWidth, cssHeight: opts.cssHeight,
    cornerRadius: opts.cornerRadius,
    kind: opts.kind,
    ringCssPx: opts.ringCssPx ?? (opts.kind === 'circle' ? 2 : 1) * scale,
    shaderScale: opts.shaderScale ?? (opts.kind === 'circle' ? CIRCLE_SHADER_SCALE : PILL_SHADER_SCALE) * scale,
    opacityMul: opts.opacityMul ?? 1,
    glowGain: opts.glowGain ?? 1,
    visible: true,
    paused: opts.paused ?? false,
    everCopied: false,
    frozen: null,
    dpr: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    scale,
    onAfterFrame: opts.onAfterFrame,
    onComposite: opts.onComposite,
    onFirstCopy: opts.onFirstCopy,
    mask: opts.mask ?? null,
    deform: null,
    deformLayers: null,
    overscan: 0,
    cursorLight: null,
    glowFast: false,
    rawCanvas: null,
    wantRaw: false,
    ringCanvas: null,
    wantRing: false,
  };
  resizeInstanceCanvas(inst);
  renderer.instances.add(inst);
  if (renderer.rafId === 0 && renderer.pausedAtMs === null) startSharedLoop();
  return inst;
}

export function destroyInstance(inst: MetalFxInstance): void {
  if (!SHARED) return;
  SHARED.instances.delete(inst);
  const qi = SHARED.glowQueue.indexOf(inst);
  if (qi !== -1) SHARED.glowQueue.splice(qi, 1);
  if (SHARED.instances.size === 0) { stopSharedLoop(); teardownSharedRenderer(); }
}

export function registerGlowInstance(inst: MetalFxInstance): void {
  if (!SHARED) return;
  if (!SHARED.glowQueue.includes(inst)) SHARED.glowQueue.push(inst);
}

export function unregisterGlowInstance(inst: MetalFxInstance): void {
  if (!SHARED) return;
  const i = SHARED.glowQueue.indexOf(inst);
  if (i !== -1) SHARED.glowQueue.splice(i, 1);
}

export function updateInstance(
  inst: MetalFxInstance,
  patch: Partial<Pick<MetalFxInstance, 'cssWidth' | 'cssHeight' | 'cornerRadius' | 'kind' | 'shaderScale' | 'ringCssPx' | 'opacityMul' | 'glowGain' | 'paused' | 'scale' | 'mask'>>
): void {
  let dirty = false;
  if (patch.mask !== undefined) inst.mask = patch.mask;
  if (patch.cssWidth !== undefined && patch.cssWidth !== inst.cssWidth) { inst.cssWidth = patch.cssWidth; dirty = true; }
  if (patch.cssHeight !== undefined && patch.cssHeight !== inst.cssHeight) { inst.cssHeight = patch.cssHeight; dirty = true; }
  if (patch.cornerRadius !== undefined) inst.cornerRadius = patch.cornerRadius;
  if (patch.scale !== undefined) inst.scale = patch.scale;
  if (patch.kind !== undefined && patch.kind !== inst.kind) {
    inst.kind = patch.kind;
    if (patch.shaderScale === undefined) inst.shaderScale = (patch.kind === 'circle' ? CIRCLE_SHADER_SCALE : PILL_SHADER_SCALE) * inst.scale;
    if (patch.ringCssPx === undefined) inst.ringCssPx = (patch.kind === 'circle' ? 2 : 1) * inst.scale;
  }
  if (patch.shaderScale !== undefined) inst.shaderScale = patch.shaderScale;
  if (patch.ringCssPx !== undefined) inst.ringCssPx = patch.ringCssPx;
  if (patch.opacityMul !== undefined) inst.opacityMul = patch.opacityMul;
  if (patch.glowGain !== undefined) inst.glowGain = patch.glowGain;
  if (patch.paused !== undefined && patch.paused !== inst.paused) {
    inst.paused = patch.paused;
    // Freeze on the frame the instance is showing right now; drop the copy
    // on unpause so composites go back to the live frame.
    if (patch.paused) freezeFrame(inst); else inst.frozen = null;
    // Unpausing should kick the loop if it had idled because every visible
    // instance was paused.
    if (!patch.paused && SHARED && SHARED.rafId === 0 && SHARED.pausedAtMs === null && !SHARED.contextLost) {
      startSharedLoop();
    }
  }
  if (dirty) resizeInstanceCanvas(inst);
}

export function setInstanceVisible(inst: MetalFxInstance, visible: boolean): void {
  inst.visible = visible;
  if (visible && SHARED && SHARED.rafId === 0 && SHARED.pausedAtMs === null && !SHARED.contextLost) {
    startSharedLoop();
  }
}

/**
 * Attach (or clear) a vector deformation to the instance that owns `canvas`.
 * `overscan` grows the canvas by that many CSS px on every side so outward
 * bulges aren't clipped. Redraws immediately so a paused instance updates.
 */
export function setInstanceDeform(
  canvas: HTMLCanvasElement,
  deform: DeformFn | null,
  layers: DeformLayers | null = null,
  overscan = 0
): boolean {
  const inst = findInstance(canvas);
  if (!inst) return false;
  inst.deform = deform;
  inst.deformLayers = deform ? layers : null;
  const o = deform ? Math.max(0, Math.round(overscan)) : 0;
  if (o !== inst.overscan) { inst.overscan = o; resizeInstanceCanvas(inst); }
  copyShaderToInstance(inst);
  return true;
}

/** Re-rasterise an instance after the devicePixelRatio changed (browser
 *  zoom, a display switch). The CSS box is unchanged, so no ResizeObserver
 *  fires; without this the canvas stays at the old backing resolution. */
export function refreshInstanceDpr(inst: MetalFxInstance): boolean {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  if (dpr === inst.dpr) return false;
  resizeInstanceCanvas(inst);
  copyShaderToInstance(inst);
  return true;
}

/** Re-composite one instance now — for callers driving `deform` per frame at
 *  a higher rate than the shared 15 fps loop. */
export function redrawInstance(canvas: HTMLCanvasElement): void {
  const inst = findInstance(canvas);
  if (inst) copyShaderToInstance(inst);
}

function findInstance(canvas: HTMLCanvasElement): MetalFxInstance | null {
  if (!SHARED) return null;
  for (const inst of SHARED.instances) if (inst.canvas === canvas) return inst;
  return null;
}

/** Set by `setSharedPresetMode`. While non-null it wins over the named
 *  presets, so a live tuning surface isn't fighting every `<MetalFx preset>`
 *  effect that re-runs on a theme toggle. */
let presetOverride: PresetMode | null = null;

export function setSharedPreset(name: PresetName, theme: PresetTheme): void {
  const s = ensureSharedRenderer();
  s.preset = presetOverride ?? PRESETS[name].modes[theme];
  s.presetDirty = true;
}

/**
 * Push raw Paper liquidMetal parameters into the shared renderer, bypassing
 * the named presets. Pass `null` to hand control back to `preset` / `theme`.
 *
 * This exists for the playground: every instance shares one GL program, so
 * tuning is necessarily global rather than per-instance.
 */
export function setSharedPresetMode(mode: PresetMode | null): void {
  const s = ensureSharedRenderer();
  presetOverride = mode;
  if (mode) {
    s.preset = mode;
    s.presetDirty = true;
  }
}

/** The preset the shared renderer is currently drawing with, or null before
 *  any instance has mounted. Read-only snapshot — mutate via the setters. */
export function getSharedPreset(): PresetMode | null {
  return SHARED ? { ...SHARED.preset } : null;
}

export function pauseShared(): void {
  if (!SHARED || SHARED.pausedAtMs !== null) return;
  SHARED.pausedAtMs = performance.now();
  stopSharedLoop();
}

export function resumeShared(): void {
  if (!SHARED || SHARED.pausedAtMs === null) return;
  SHARED.pausedMs += performance.now() - SHARED.pausedAtMs;
  SHARED.pausedAtMs = null;
  if (SHARED.instances.size > 0) startSharedLoop();
}

export function getSharedFrameCount(): number {
  return SHARED?.frameCount ?? 0;
}

// ─── Glow callback ────────────────────────────────────────────────────────

/** Returns true when the glow wants per-frame ticks (mid-fade). */
export type GlowCallback = (inst: MetalFxInstance, nowMs: number) => boolean | void;
let _glowCallback: GlowCallback | null = null;

export function setGlowCallback(cb: GlowCallback | null): void {
  _glowCallback = cb;
}

/** Run one glow update for an instance now — for drivers (cursor light) that
 *  need the hotspot to move at pointer rate rather than the shared 15 fps. */
export function tickInstanceGlow(inst: MetalFxInstance, nowMs: number): void {
  if (!_glowCallback || !SHARED || !inst.visible || inst.paused) return;
  if (!SHARED.glowQueue.includes(inst)) return;
  inst.glowFast = !!_glowCallback(inst, nowMs);
}

// ─── Internal rendering ───────────────────────────────────────────────────

function resizeInstanceCanvas(inst: MetalFxInstance): void {
  inst.dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const o = inst.overscan;
  const w = Math.max(1, Math.round((inst.cssWidth + 2 * o) * inst.dpr));
  const h = Math.max(1, Math.round((inst.cssHeight + 2 * o) * inst.dpr));
  if (inst.canvas.width !== w) inst.canvas.width = w;
  if (inst.canvas.height !== h) inst.canvas.height = h;
  // Overscan: grow the element past its box and drop the CSS radius clip so
  // displaced geometry outside the rounded box is visible.
  const st = inst.canvas.style;
  if (o > 0) {
    st.left = `${-o}px`; st.top = `${-o}px`;
    st.width = `calc(100% + ${2 * o}px)`; st.height = `calc(100% + ${2 * o}px)`;
    st.borderRadius = '0';
  } else if (st.left !== '') {
    st.left = ''; st.top = ''; st.width = '100%'; st.height = '100%'; st.borderRadius = '';
  }
}

function punchInnerHole(inst: MetalFxInstance): void {
  const { ctx, dpr, canvas } = inst;
  const stroke = inst.ringCssPx * dpr;
  const w = canvas.width, h = canvas.height;
  const innerR = Math.max(0, (inst.cornerRadius - inst.ringCssPx) * dpr);
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.roundRect(stroke, stroke, w - 2 * stroke, h - 2 * stroke, innerR);
  ctx.fill();
  ctx.restore();
}

const _outline: OutlineBuf = createOutlineBuf();

/** Trace a (possibly deformed) rounded rect into the ctx, in device px. */
function traceDeformedRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
  deform: DeformFn, dpr: number
): void {
  const { xy, n } = roundRectOutline(x, y, w, h, r, deform, _outline);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    if (i === 0) ctx.moveTo(xy[0] * dpr, xy[1] * dpr);
    else ctx.lineTo(xy[i * 2] * dpr, xy[i * 2 + 1] * dpr);
  }
  ctx.closePath();
}

/** Copy the current shared frame into the instance's own still. */
function freezeFrame(inst: MetalFxInstance): HTMLCanvasElement | null {
  if (!SHARED) return null;
  const live: CanvasImageSource = SHARED.frameBitmap ?? SHARED.glCanvas;
  const w = SHARED.glCanvas.width, h = SHARED.glCanvas.height;
  if (w < 1 || h < 1) return null;
  let fc = inst.frozen;
  if (!fc) { fc = document.createElement('canvas'); inst.frozen = fc; }
  if (fc.width !== w || fc.height !== h) { fc.width = w; fc.height = h; }
  const g = fc.getContext('2d');
  if (!g) { inst.frozen = null; return null; }
  g.clearRect(0, 0, w, h);
  g.drawImage(live, 0, 0);
  return fc;
}

function copyShaderToInstance(inst: MetalFxInstance): void {
  if (!SHARED) return;
  // A paused instance composites from its frozen frame — a bend or a resize
  // must not pull in the live shader, or the "paused" ring plays on hover.
  const src: CanvasImageSource = (inst.paused ? (inst.frozen ?? freezeFrame(inst)) : null) ?? SHARED.frameBitmap ?? SHARED.glCanvas;
  const dpr = inst.dpr;
  const dw = inst.canvas.width, dh = inst.canvas.height;
  if (dw < 1 || dh < 1) return;
  // Box = the element's own CSS box in device px; the canvas may be larger
  // by `overscan` on every side while deforming.
  const bw = Math.max(1, Math.round(inst.cssWidth * dpr));
  const bh = Math.max(1, Math.round(inst.cssHeight * dpr));
  const od = inst.overscan * dpr;

  const cw = (src as { width: number }).width, ch = (src as { height: number }).height;
  const bdW = CANONICAL_PILL_W * dpr, bdH = CANONICAL_PILL_H * dpr;
  let srcW = (bw * (cw / bdW)) / inst.shaderScale;
  let srcH = (bh * (ch / bdH)) / inst.shaderScale;
  if (srcW > cw) srcW = cw;
  if (srcH > ch) srcH = ch;
  const sx = Math.max(0, (cw - srcW) / 2);
  const sy = Math.max(0, (ch - srcH) / 2);

  // Paper's shader has no `u_shaderOpacity` equivalent, so the preset-level
  // opacity rides along with the per-instance `strength` multiplier here
  // instead of being applied on the GPU.
  const alpha = inst.opacityMul * SHARED.preset.shaderOpacity;
  const ctx = inst.ctx;

  ctx.clearRect(0, 0, dw, dh);

  const deform = inst.deform;
  if (inst.mask) {
    // ── Custom mask (metal text / glyph) ─────────────────────────────
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(src, sx, sy, srcW, srcH, 0, 0, dw, dh);
    if (alpha < 1) ctx.globalAlpha = 1;
    if (inst.wantRaw) {
      // Keep the sheet before it is cut to the glyphs, for reflections.
      let rc = inst.rawCanvas;
      if (!rc) { rc = document.createElement('canvas'); inst.rawCanvas = rc; }
      if (rc.width !== dw || rc.height !== dh) { rc.width = dw; rc.height = dh; }
      const rg = rc.getContext('2d');
      if (rg) { rg.clearRect(0, 0, dw, dh); rg.drawImage(inst.canvas, 0, 0); }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = '#000';
    inst.mask(ctx, dw, dh, dpr);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  } else if (!deform) {
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(src, sx, sy, srcW, srcH, 0, 0, dw, dh);
    if (alpha < 1) ctx.globalAlpha = 1;
    punchInnerHole(inst);
  } else {
    // ── Vector-deformed ring ──────────────────────────────────────────
    // The shader texture is laid down over the (overscanned) canvas, then
    // masked to a displaced outer outline minus a displaced inner outline.
    // Because the mask is geometry, stretched regions stay crisp.
    const W = inst.cssWidth, H = inst.cssHeight;
    const R = inst.cornerRadius, ring = inst.ringCssPx;
    const layers = inst.deformLayers;
    ctx.save();
    ctx.translate(od, od);

    // Texture: over the box plus the overscan margin, so an outward bulge
    // still has shader pixels under it. The source crop grows by the same
    // ratio so the mapping *inside the box* is identical to the rigid path —
    // otherwise the pattern jumps scale the moment a bend starts or ends.
    // If the enlarged crop would exceed the GL buffer, shrink the *destination*
    // instead of the crop's scale — a scale change is a visible texture jump.
    const scX = bw / srcW, scY = bh / srcH;          // dest px per source px
    const esW = Math.min(cw, srcW * (bw + 2 * od) / bw);
    const esH = Math.min(ch, srcH * (bh + 2 * od) / bh);
    const esx = Math.max(0, (cw - esW) / 2);
    const esy = Math.max(0, (ch - esH) / 2);
    const dW = esW * scX, dH = esH * scY;
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(src, esx, esy, esW, esH, bw / 2 - dW / 2, bh / 2 - dH / 2, dW, dH);
    if (alpha < 1) ctx.globalAlpha = 1;

    ctx.globalCompositeOperation = 'destination-in';
    traceDeformedRoundRect(ctx, 0, 0, W, H, R, deform, dpr);
    ctx.fillStyle = '#000';
    ctx.fill();

    ctx.globalCompositeOperation = 'destination-out';
    traceDeformedRoundRect(ctx, ring, ring, W - 2 * ring, H - 2 * ring, Math.max(0, R - ring), deform, dpr);
    ctx.fill();

    if (inst.wantRing) {
      // For reflections: the same thing the rigid path produces — the full
      // texture with the (deformed) inner hole punched, no outer mask. The
      // rigid canvas is never outer-masked either (CSS border-radius clips
      // it on screen), so mirroring a masked ring here would dim the
      // reflection the moment a bend starts.
      let rc = inst.ringCanvas;
      if (!rc) { rc = document.createElement('canvas'); inst.ringCanvas = rc; }
      if (rc.width !== dw || rc.height !== dh) { rc.width = dw; rc.height = dh; }
      const rg = rc.getContext('2d');
      if (rg) {
        rg.setTransform(1, 0, 0, 1, 0, 0);
        rg.globalCompositeOperation = 'source-over';
        rg.clearRect(0, 0, dw, dh);
        rg.translate(od, od);
        if (alpha < 1) rg.globalAlpha = alpha;
        rg.drawImage(src, esx, esy, esW, esH, bw / 2 - dW / 2, bh / 2 - dH / 2, dW, dH);
        rg.globalAlpha = 1;
        rg.globalCompositeOperation = 'destination-out';
        traceDeformedRoundRect(rg, ring, ring, W - 2 * ring, H - 2 * ring, Math.max(0, R - ring), deform, dpr);
        rg.fillStyle = '#000';
        rg.fill();
        rg.globalCompositeOperation = 'source-over';
        rg.setTransform(1, 0, 0, 1, 0, 0);
      }
    }

    if (layers?.hairline) {
      const hl = layers.hairline;
      ctx.globalCompositeOperation = 'destination-over';
      traceDeformedRoundRect(ctx, hl.inset, hl.inset, W - 2 * hl.inset, H - 2 * hl.inset, Math.max(0, R - hl.inset), deform, dpr);
      ctx.lineWidth = hl.width * dpr;
      ctx.strokeStyle = hl.color;
      ctx.stroke();
    }
    if (layers?.fill) {
      ctx.globalCompositeOperation = 'destination-over';
      traceDeformedRoundRect(ctx, 0, 0, W, H, R, deform, dpr);
      ctx.fillStyle = layers.fill;
      ctx.fill();
    }
    if (layers?.rim) {
      const rim = layers.rim;
      ctx.globalCompositeOperation = 'source-over';
      // Inset band of `width` starting `inset` in from the outline: stroke
      // its centre line, then clip to the outline so nothing spills out.
      ctx.save();
      traceDeformedRoundRect(ctx, 0, 0, W, H, R, deform, dpr);
      ctx.clip();
      const c = rim.inset + rim.width / 2;
      traceDeformedRoundRect(ctx, c, c, W - 2 * c, H - 2 * c, Math.max(0, R - c), deform, dpr);
      ctx.lineWidth = rim.width * dpr;
      ctx.strokeStyle = rim.color;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  }

  inst.onComposite?.();
  if (inst.onFirstCopy) { const cb = inst.onFirstCopy; inst.onFirstCopy = undefined; cb(); }
  inst.onAfterFrame?.();
}

function uploadPresetUniforms(): void {
  if (!SHARED) return;
  const { gl, uniforms, preset, glCanvas, dpr } = SHARED;

  // Shared by both stages.
  if (uniforms.u_resolution) gl.uniform2f(uniforms.u_resolution, glCanvas.width, glCanvas.height);
  // Paper's vertex stage divides the world box by this; leaving it at the
  // default 0 collapses the box and the shader renders nothing.
  if (uniforms.u_pixelRatio) gl.uniform1f(uniforms.u_pixelRatio, dpr);

  // Fragment — material.
  if (uniforms.u_colorBack) gl.uniform4fv(uniforms.u_colorBack, hexToRgba(preset.colorBack));
  if (uniforms.u_colorTint) gl.uniform4fv(uniforms.u_colorTint, hexToRgba(preset.colorTint));
  if (uniforms.u_repetition) gl.uniform1f(uniforms.u_repetition, preset.repetition);
  if (uniforms.u_softness) gl.uniform1f(uniforms.u_softness, preset.softness);
  if (uniforms.u_shiftRed) gl.uniform1f(uniforms.u_shiftRed, preset.shiftRed);
  if (uniforms.u_shiftBlue) gl.uniform1f(uniforms.u_shiftBlue, preset.shiftBlue);
  if (uniforms.u_distortion) gl.uniform1f(uniforms.u_distortion, preset.distortion);
  if (uniforms.u_contour) gl.uniform1f(uniforms.u_contour, preset.contour);
  if (uniforms.u_angle) gl.uniform1f(uniforms.u_angle, preset.angle);
  if (uniforms.u_shape) gl.uniform1f(uniforms.u_shape, preset.shape);
  // Procedural only — metal-fx never feeds a logo through the effect.
  if (uniforms.u_isImage) gl.uniform1i(uniforms.u_isImage, 0);
  if (uniforms.u_imageAspectRatio) gl.uniform1f(uniforms.u_imageAspectRatio, 1);

  // Vertex — sizing.
  if (uniforms.u_originX) gl.uniform1f(uniforms.u_originX, preset.originX);
  if (uniforms.u_originY) gl.uniform1f(uniforms.u_originY, preset.originY);
  if (uniforms.u_worldWidth) gl.uniform1f(uniforms.u_worldWidth, preset.worldWidth);
  if (uniforms.u_worldHeight) gl.uniform1f(uniforms.u_worldHeight, preset.worldHeight);
  if (uniforms.u_fit) gl.uniform1f(uniforms.u_fit, preset.fit);
  if (uniforms.u_scale) gl.uniform1f(uniforms.u_scale, preset.scale);
  if (uniforms.u_rotation) gl.uniform1f(uniforms.u_rotation, preset.rotation);
  if (uniforms.u_offsetX) gl.uniform1f(uniforms.u_offsetX, preset.offsetX);
  if (uniforms.u_offsetY) gl.uniform1f(uniforms.u_offsetY, preset.offsetY);

  SHARED.presetDirty = false;
}

function renderSharedFrame(now: number): void {
  if (!SHARED) return;
  const { gl, uniforms, preset, glCanvas } = SHARED;
  const t = ((now - SHARED.startMs - SHARED.pausedMs) / 1000) * preset.speed;

  gl.viewport(0, 0, glCanvas.width, glCanvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  if (SHARED.presetDirty) uploadPresetUniforms();
  if (uniforms.u_time) gl.uniform1f(uniforms.u_time, t);

  gl.drawArrays(gl.TRIANGLES, 0, 6);
  SHARED.frameCount++;
}

let lastFrameMs = 0;

function tick(now: number): void {
  if (!SHARED) return;
  if (SHARED.contextLost) { SHARED.rafId = 0; return; }

  // Loop stays alive while at least one visible instance still has work to do
  // — i.e. it's either unpaused (needs a fresh copy each frame) or paused but
  // hasn't yet painted its first frame (initial-mount-paused case).
  let anyWork = false;
  for (const inst of SHARED.instances) {
    if (inst.visible && (!inst.paused || !inst.everCopied)) { anyWork = true; break; }
  }
  if (!anyWork) { SHARED.rafId = 0; return; }

  SHARED.rafId = requestAnimationFrame(tick);
  if (now - lastFrameMs < FRAME_INTERVAL_MS) {
    // Between shader frames, keep fading glows moving at display rate.
    if (_glowCallback) {
      for (const inst of SHARED.glowQueue) {
        if (inst.glowFast && inst.visible && !inst.paused) inst.glowFast = !!_glowCallback(inst, now);
      }
    }
    return;
  }
  lastFrameMs = now;

  renderSharedFrame(now);

  // The only readback: after the draw, before the frame is transferred away.
  ensureGlowPixels();
  if (SHARED.useOffscreen) {
    SHARED.frameBitmap?.close();
    SHARED.frameBitmap = (SHARED.glCanvas as OffscreenCanvas).transferToImageBitmap();
  }

  for (const inst of SHARED.instances) {
    if (!inst.visible) continue;
    if (inst.paused && inst.everCopied) continue;
    copyShaderToInstance(inst);
    inst.everCopied = true;
  }

  // Every visible glow instance, every Nth tick. Round-robin (one instance
  // per tick) made each halo's update rate depend on how many rings were on
  // the page — five rings meant ~330 ms between updates, so a 300 ms fade
  // landed in a single step and read as a flash. updateGlow costs ~0.05 ms.
  if (_glowCallback && SHARED.glowQueue.length > 0 && ++SHARED.glowSkip % GLOW_SKIP_FRAMES === 0) {
    for (const inst of SHARED.glowQueue) {
      // Skip paused instances so their halo also freezes (otherwise the
      // catch-light would keep travelling on a frozen ring).
      if (inst.visible && !inst.paused) inst.glowFast = !!_glowCallback(inst, now);
    }
  }
}

function startSharedLoop(): void {
  if (!SHARED || SHARED.rafId !== 0) return;
  SHARED.rafId = requestAnimationFrame(tick);
}

function stopSharedLoop(): void {
  if (!SHARED) return;
  if (SHARED.rafId !== 0) cancelAnimationFrame(SHARED.rafId);
  SHARED.rafId = 0;
}
