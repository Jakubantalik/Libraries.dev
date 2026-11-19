export { VoiceBeam } from './VoiceBeam';
export { default } from './VoiceBeam';

export { useMicrophone } from './useMicrophone';
export type { UseMicrophoneOptions, UseMicrophoneResult, MicrophoneState } from './useMicrophone';

export { getAudioContext, isAudioSupported } from './audio';
export { parseRgb } from './color';

export { voiceDefaults, voiceTypePresets, voiceTypeStyle, resolveVoiceDefaults, resolveVoiceStyle, pixelGlowDefault, pixelDustDefault, pixelDomeDefault } from './presets';
export type { VoiceGeometry, VoiceTypeStyle } from './presets';

export type {
  VoiceBeamProps,
  VoiceBeamType,
  VoiceBeamTheme,
  VoiceBeamLook,
  VoiceBeamDotShape,
  VoiceBeamLinePattern,
  VoiceBeamColorVariant,
  VoiceBeamLevel,
  VoiceBeamMotion,
  VoiceThemeColors,
} from './types';

/* Looks that plug in as objects (Libraries Pro's mosaic, dots and lines). */
export type { VoiceLook, VoicePixelLook, VoicePixelKit, VoiceSurfaceLook, VoiceSurfaceFrame, VoiceLookConfig } from './look';

export { themePresets, voicePalettes, voiceLobes, LOBE_SPACING, LOBE_SPAN } from './styles';
export type { VoiceLobe } from './styles';
