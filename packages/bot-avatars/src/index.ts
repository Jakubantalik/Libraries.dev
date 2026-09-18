export { BotAvatar } from './BotAvatar';
export { default } from './BotAvatar';

export {
  botAvatarPresets,
  botAvatarPalette,
  botAvatarTypes,
  botAvatarFaces,
  botAvatarStates,
} from './presets';
export { SHAPE_PATHS as botAvatarShapes } from './shapes';
export { autoInk, luminance, parseColor, shade } from './color';
export { Sim as BotAvatarSim, restPose } from './engine';
export { draw as drawBotAvatarFrame, OVERSCAN as BOT_AVATAR_OVERSCAN } from './draw';
export { warmPlastic as warmBotAvatarPlastic } from './plastic';
export type { DrawConfig as BotAvatarDrawConfig } from './draw';
export type { Pose as BotAvatarPose } from './engine';

export type {
  BotAvatarProps,
  BotAvatarType,
  BotAvatarFace,
  BotAvatarState,
  BotAvatarShading,
  BotAvatarPreset,
} from './types';
