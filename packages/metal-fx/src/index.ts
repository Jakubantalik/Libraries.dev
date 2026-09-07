export { MetalFx } from './MetalFx';
export { MetalText, METAL_TEXT_DEFAULTS, type TextInnerShadow } from './MetalText';
export { MetalBadge, METAL_BADGE_DEFAULTS, type MetalBadgeCore } from './MetalBadge';
export { useMetalBend } from './useMetalBend';
export { BEND, BEND_DEFAULTS, setBendConfig, resetBendConfig, type BendConfig } from './engine/bend/config';
export { useMetalTextReflection } from './useMetalTextReflection';
export { paintTextRun, textMaskDataUrl } from './engine/textMask';

export type {
  MetalFxProps,
  MetalFxVariant,
  MetalFxTheme,
  MetalFxPreset,
  MetalFxReflectionTarget,
} from './types';

// Power-user surface: expose the engine primitives so consumers building
// non-React integrations can drive the same renderer.
export {
  PRESETS,
  SHAPE_NONE,
  SHAPE_CIRCLE,
  SHAPE_DAISY,
  SHAPE_DIAMOND,
  SHAPE_METABALLS,
  FIT_NONE,
  FIT_CONTAIN,
  FIT_COVER,
  hexToRgb,
  hexToRgba,
  type Preset,
  type PresetMode,
  type PresetName,
  type PresetTheme,
} from './engine/presets';

export {
  createInstance,
  destroyInstance,
  updateInstance,
  setSharedPreset,
  setSharedPresetMode,
  getSharedPreset,
  setInstanceDeform,
  redrawInstance,
  pauseShared,
  resumeShared,
} from './engine/renderer/loop';

export type { MetalFxInstance, DeformFn, DeformLayers, MaskFn } from './engine/renderer/core';
export { RIM_DEFAULTS, type RimOptions } from './engine/rim';
export { isMetalFxSupported } from './engine/renderer/core';

// Live glow tuning — mutable singleton read by the glow engine every frame.
export {
  GLOW,
  GLOW_DEFAULTS,
  GLOW_MARKUP_KEYS,
  setGlowConfig,
  resetGlowConfig,
  subscribeGlowConfig,
  type GlowConfig,
} from './engine/glow/config';

// Cursor light: glint under the pointer + catch-light facing it.
export {
  CURSOR_LIGHT,
  CURSOR_LIGHT_DEFAULTS,
  setCursorLightConfig,
  resetCursorLightConfig,
  setCursorSprite,
  type CursorLightConfig,
  type CursorSprite,
} from './engine/cursor/light';

// Cursor-as-occluder for proximity reflections.
export {
  REFLECTION_OCCLUDER,
  REFLECTION_OCCLUDER_DEFAULTS,
  setReflectionOccluderConfig,
  resetReflectionOccluderConfig,
  type ReflectionOccluderConfig,
} from './engine/reflection/paint';
