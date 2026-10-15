/**
 * "New" badge — Figma: Portfolio › tab 3 (1458:40880), applied verbatim.
 *
 *   45×25, pill r 55.556. Layers bottom→top:
 *     1. white fill
 *     2. metal texture (a static PNG in Figma — here the live shader, via a
 *        full-pill mask so it covers the fill)
 *     3. gradient rgba(255,255,255,.6) → 0, top→bottom
 *     3b. clean white core under the label — transitions.dev get-pro-button
 *         mechanism inverted: radial ellipse 46%, solid to `core`, ramp over
 *         `coreBlur`, so the text sits on white and metal creeps in at the rim
 *     4. text: Inter Semi Bold 12.222/1.4 #323232, box 26.667×13.333
 *     5. inset shadows: 0 0 8.333 #fff ×2, 0 0 0 0.833 rgba(255,255,255,.5),
 *        0 0.833 0 rgba(255,255,255,.78)
 *
 * The gradient AND the inset shadows have to sit above the metal canvas
 * (z 0) and below the text (content z 5) — on the root they'd be painted
 * under the opaque metal and vanish. Both live on one overlay inside the
 * content layer, one level down: MetalFx normalises the *direct* child's
 * background/box-shadow to transparent/none, so the overlay is nested under
 * a plain wrapper to keep them.
 */
import React, { useCallback, useRef } from 'react';
import { MetalFx } from './MetalFx';
import type { MetalFxReflectionTarget, MetalFxTheme } from './types';
import type { MaskFn } from './engine/renderer/core';

const RADIUS = 55.556;
const W = 45, H = 25;
const TEXT_W = 26.667, TEXT_H = 13.333;
const PAD_X = (W - TEXT_W) / 2;

const LAYER: React.CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };

/** `glow` scales the two soft inner glows; the hairline rims stay as designed. */
const shadowFor = (k: number, glow: number) =>
  `inset 0px 0px ${8.333 * k}px 0px rgba(255,255,255,${glow}), ` +
  `inset 0px 0px ${8.333 * k}px 0px rgba(255,255,255,${glow}), ` +
  `inset 0px 0px 0px ${0.833 * k}px rgba(255,255,255,0.5), ` +
  `inset 0px ${0.833 * k}px 0px 0px rgba(255,255,255,0.78)`;

/** Tuned on the demo's "Live mode · New" card. */
export const METAL_BADGE_DEFAULTS = Object.freeze({
  metalOpacity: 0.8,
  shaderScale: 1.6,
  /** White core under the label: solid radius (% of ellipse), ramp width, opacity, ellipse size (% of box). */
  core: Object.freeze({ r: 46, blur: 100, a: 0.94, size: 49 }),
  gradient: 0,
  glow: 0.41,
});

export interface MetalBadgeCore { r: number; blur: number; a: number; size: number }

export function MetalBadge({
  children = 'New',
  strength = 1,
  theme,
  scale = 1,
  reflectionTargets,
  metalOpacity = METAL_BADGE_DEFAULTS.metalOpacity,
  shaderScale = METAL_BADGE_DEFAULTS.shaderScale,
  core = METAL_BADGE_DEFAULTS.core,
  gradient = METAL_BADGE_DEFAULTS.gradient,
  glow = METAL_BADGE_DEFAULTS.glow,
  textColor = '#323232',
}: {
  children?: string;
  strength?: number;
  theme?: MetalFxTheme;
  /** Size multiplier on the Figma metrics (45×25, 12.222px). */
  scale?: number;
  reflectionTargets?: ReadonlyArray<MetalFxReflectionTarget>;
  /** How much metal shows over the white fill (0..1), multiplied with `strength`. */
  metalOpacity?: number;
  shaderScale?: number;
  core?: MetalBadgeCore;
  /** Top→bottom white wash strength (0..1). */
  gradient?: number;
  /** Inner white glow strength (0..1). */
  glow?: number;
  textColor?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const opacity = metalOpacity;

  // Full-fill mask: the pill itself.
  const mask = useCallback<MaskFn>((ctx, w, h, dpr) => {
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, RADIUS * dpr);
    ctx.fill();
  }, []);

  return (
    <MetalFx
      ref={rootRef}
      preset="chromatic"
      theme={theme}
      strength={strength * opacity}
      shaderScale={shaderScale}
      mask={mask}
      glowMode="ring"
      reflectionTargets={reflectionTargets}
      borderRadius={RADIUS * scale}
      style={{ background: '#ffffff', borderRadius: RADIUS * scale }}
    >
      {/* Inline layout only — no utility classes, so the badge renders the
          same with or without a CSS framework on the host page. */}
      <div style={{ position: 'relative', width: W * scale, height: H * scale, borderRadius: RADIUS * scale }}>
        {/* layer 3b — clean white core under the label (rim-only metal) */}
        <div
          aria-hidden="true"
          style={{
            ...LAYER,
            borderRadius: RADIUS * scale,
            // Stops are relative to the ellipse radius, so 100% = its edge.
            background: `radial-gradient(ellipse ${core.size}% ${core.size}% at 50% 50%, rgba(255,255,255,1) ${core.r}%, rgba(255,255,255,0) ${Math.min(100, core.r + core.blur)}%)`,
            opacity: core.a,
          }}
        />
        {/* layers 3 + 5 — white gradient and inset rims, over the metal */}
        <div
          aria-hidden="true"
          style={{
            ...LAYER,
            borderRadius: RADIUS * scale,
            background: `linear-gradient(to bottom, rgba(255,255,255,${gradient}), rgba(255,255,255,0))`,
            boxShadow: shadowFor(scale, glow),
          }}
        />
        <span
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxSizing: 'border-box',
            width: W * scale,
            height: H * scale,
            paddingLeft: PAD_X * scale,
            paddingRight: PAD_X * scale,
            font: `600 ${12.222 * scale}px/1.4 Inter, sans-serif`,
            color: textColor,
            letterSpacing: 0,
            whiteSpace: 'nowrap',
          }}
          aria-label={children}
        >
          {children}
        </span>
      </div>
    </MetalFx>
  );
}
