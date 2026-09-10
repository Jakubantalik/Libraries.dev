/**
 * Demo wrapper: the library's MetalBadge driven by the SHD panel's live
 * "New badge" settings.
 */
import React, { useEffect, useState } from 'react';
import { MetalBadge, type MetalFxReflectionTarget, type MetalFxTheme } from '../../src';
import { BADGE, subscribeBadge } from '../lib/badge';

const read = () => ({
  metalOpacity: BADGE.newOpacity,
  shaderScale: BADGE.newShaderScale,
  core: { r: BADGE.newCore, blur: BADGE.newCoreBlur, a: BADGE.newCoreStrength, size: BADGE.newCoreSize },
  gradient: BADGE.newGradient,
  glow: BADGE.newGlow,
});

export function NewBadge({ strength = 1, theme, scale = 1, reflectionTargets }: {
  strength?: number; theme?: MetalFxTheme; scale?: number; reflectionTargets?: ReadonlyArray<MetalFxReflectionTarget>;
}) {
  const [v, setV] = useState(read);
  useEffect(() => subscribeBadge(() => setV(read())), []);
  return <MetalBadge strength={strength} theme={theme} scale={scale} reflectionTargets={reflectionTargets} {...v}>New</MetalBadge>;
}
