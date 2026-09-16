export { VoiceBeam } from './VoiceBeam';
export { default } from './VoiceBeam';

export { useMicrophone } from './useMicrophone';
export type { UseMicrophoneOptions, UseMicrophoneResult, MicrophoneState } from './useMicrophone';

export { getAudioContext, isAudioSupported } from './audio';
export { parseRgb } from './color';

export { voiceDefaults, voiceTypePresets, voiceTypeStyle, resolveVoiceDefaults, resolveVoiceStyle } from './presets';
export type { VoiceGeometry, VoiceTypeStyle } from './presets';

export type {
  VoiceBeamProps,
  VoiceBeamType,
  VoiceBeamTheme,
  VoiceBeamColorVariant,
  VoiceBeamLevel,
  VoiceThemeColors,
} from './types';

export { themePresets, voicePalettes, voiceLobes, LOBE_SPACING, LOBE_SPAN } from './styles';
export type { VoiceLobe } from './styles';
