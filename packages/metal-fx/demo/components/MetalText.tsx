/**
 * Demo wrapper: the library's MetalText driven by the SHD panel's live
 * badge settings (shader scale / opacity / glow gain).
 */
import React, { useEffect, useState } from 'react';
import { MetalText as LibMetalText } from '../../src';
import { BADGE, subscribeBadge } from '../lib/badge';

type Props = Omit<React.ComponentProps<typeof LibMetalText>, 'metalOpacity' | 'shaderScale' | 'glowGain'>;

export function MetalText(props: Props) {
  const [v, setV] = useState({ shaderScale: BADGE.shaderScale, metalOpacity: BADGE.opacity, glowGain: BADGE.textGlow });
  useEffect(() => subscribeBadge(() => setV({ shaderScale: BADGE.shaderScale, metalOpacity: BADGE.opacity, glowGain: BADGE.textGlow })), []);
  return <LibMetalText {...props} shaderScale={v.shaderScale} metalOpacity={v.metalOpacity} glowGain={v.glowGain} />;
}
