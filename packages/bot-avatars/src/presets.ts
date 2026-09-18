import type { BotAvatarFace, BotAvatarPreset, BotAvatarState, BotAvatarType } from './types';

/**
 * The nine types: each body has its own colour and says where on it the
 * face sits. Every type wears the eyes alone by default.
 */
export const botAvatarPresets: Record<BotAvatarType, BotAvatarPreset> = {
  clover: { label: 'Clover', color: '#35B8FF', face: 'eyes', faceX: 50, faceY: 50, faceScale: 1 },
  flower: { label: 'Flower', color: '#FF7AB8', face: 'eyes', faceX: 50, faceY: 51, faceScale: 0.95 },
  triangle: { label: 'Triangle', color: '#DC48FF', face: 'eyes', faceX: 50, faceY: 61, faceScale: 0.9 },
  square: { label: 'Square', color: '#35B8FF', face: 'eyes', faceX: 50, faceY: 50, faceScale: 1 },
  blob: { label: 'Blob', color: '#2FCB7A', face: 'eyes', faceX: 49.5, faceY: 50, faceScale: 1 },
  ghost: { label: 'Ghost', color: '#F4F2FA', face: 'eyes', faceX: 50, faceY: 48, faceScale: 0.95 },
  circle: { label: 'Circle', color: '#9A62FF', face: 'eyes', faceX: 50, faceY: 50, faceScale: 1 },
  drop: { label: 'Drop', color: '#1ED3C6', face: 'eyes', faceX: 50, faceY: 62, faceScale: 0.9 },
  star: { label: 'Star', color: '#FFD32B', face: 'eyes', faceX: 50, faceY: 52, faceScale: 0.82 },
};

export const botAvatarTypes = Object.keys(botAvatarPresets) as BotAvatarType[];
export const botAvatarFaces: BotAvatarFace[] = ['eyes', 'mouth'];
export const botAvatarStates: BotAvatarState[] = ['default', 'thinking', 'happy', 'sleeping'];

/** Body colour by type — the palette on its own. */
export const botAvatarPalette: Record<BotAvatarType, string> = Object.fromEntries(
  botAvatarTypes.map((t) => [t, botAvatarPresets[t].color])
) as Record<BotAvatarType, string>;

export const stateLabels: Record<BotAvatarState, string> = {
  default: 'idle',
  thinking: 'thinking',
  happy: 'happy',
  sleeping: 'sleeping',
};
