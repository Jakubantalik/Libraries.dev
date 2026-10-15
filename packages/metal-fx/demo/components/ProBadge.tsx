/**
 * "Pro" badge with metal-filled text. Figma: Portfolio › tab 1 (1458:40868).
 *
 *   50×30, pill (r 66.667), fill rgba(42,42,42,.5), Inter Medium 14.667px,
 *   text box 24×16 at x 13, drop shadow 0 1.333 4 rgba(0,0,0,.04), inset rims: top
 *   1px rgba(255,255,255,.08), 1.333px rgba(255,255,255,.04), bottom
 *   -1.333px rgba(0,0,0,.06).
 *
 * The metal lives *in the glyphs*: MetalFx's `mask` paints the word with the
 * same font and metrics as the live text, so layout, wrapping and hit-testing
 * stay DOM. The live text is white (Figma: #fff) and the
 * metal canvas is lifted above the content layer, so shader opacity blends
 * metal *over white* rather than revealing the badge fill.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MetalFx, type MaskFn, type MetalFxReflectionTarget, type MetalFxTheme } from '../../src';
import { BADGE, subscribeBadge } from '../lib/badge';
import { paintTextRun } from '../lib/textMask';

const BADGE_FILL = 'rgba(42,42,42,0.5)';
const BADGE_SHADOW =
  '0px 1.333px 4px 0px rgba(0,0,0,0.04), ' +
  'inset 0px 1px 0px 0px rgba(255,255,255,0.08), ' +
  'inset 0px 0px 0px 1.333px rgba(255,255,255,0.04), ' +
  'inset 0px -1.333px 0px 0px rgba(0,0,0,0.06)';

export function ProBadge({
  strength = 1,
  theme,
  reflectionTargets,
}: {
  strength?: number;
  /** Pass the page theme explicitly — reflections only render in dark, and
   *  `auto` follows the OS, not the demo's toggle. */
  theme?: MetalFxTheme;
  reflectionTargets?: ReadonlyArray<MetalFxReflectionTarget>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  // Own shader scale, tunable from the SHD panel, independent of the rings.
  const [shaderScale, setShaderScale] = useState(BADGE.shaderScale);
  const [opacity, setOpacity] = useState(BADGE.opacity);
  useEffect(() => subscribeBadge(() => { setShaderScale(BADGE.shaderScale); setOpacity(BADGE.opacity); }), []);
  // Canvas normally sits under the content (z 0 vs 5). For metal-over-text
  // it has to be on top; it's pointer-events:none so hit-testing is unchanged.
  useEffect(() => {
    const cv = rootRef.current?.querySelector<HTMLCanvasElement>('canvas.metal-fx-canvas');
    if (cv) cv.style.zIndex = '6';
    // Glow is clipped to the glyphs; lift it above the metal so it lands on it.
    const host = rootRef.current?.querySelector<HTMLElement>('.metal-fx-glow-svg')?.parentElement;
    if (host) host.style.zIndex = '7';
  }, []);

  // Paint the word exactly where the DOM lays it out. Baseline is derived
  // from the font's bounding-box ascent/descent centred in the text box —
  // the same rule the line box uses — so the canvas glyphs sit on the DOM
  // glyphs to within a device pixel.
  const mask = useCallback<MaskFn>((ctx, _w, _h, dpr) => {
    const root = rootRef.current, t = textRef.current;
    if (root && t) paintTextRun(ctx, root, t, dpr);
  }, []);

  return (
    <MetalFx
      ref={rootRef}
      preset="chromatic"
      theme={theme}
      strength={strength * opacity}
      mask={mask}
      reflectionTargets={reflectionTargets}
      shaderScale={shaderScale}
      borderRadius={66.667}
      style={{ background: BADGE_FILL, boxShadow: BADGE_SHADOW, borderRadius: 66.667 }}
    >
      <span
        ref={textRef}
        className="flex h-[30px] w-[50px] items-center justify-center rounded-[66.667px] px-[13px]"
        style={{ font: '500 14.667px/1.4 Inter, sans-serif', color: '#ffffff', letterSpacing: 0 }}
        aria-label="Pro"
      >
        Pro
      </span>
    </MetalFx>
  );
}
