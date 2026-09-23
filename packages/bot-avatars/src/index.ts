export { BotAvatar } from './BotAvatar';
export { default } from './BotAvatar';

export {
  botAvatarPresets,
  botAvatarPalette,
  botAvatarTypes,
  botAvatarFaces,
  botAvatarStates,
} from './presets';
export { SHAPE_PATHS as botAvatarShapes, SHAPE_PARTS as botAvatarParts } from './shapes';
export { autoInk, luminance, parseColor, shade } from './color';
export { Sim as BotAvatarSim, restPose } from './engine';
export { draw as drawBotAvatarFrame, OVERSCAN as BOT_AVATAR_OVERSCAN, RISE as BOT_AVATAR_RISE } from './draw';
export { warmPlastic as warmBotAvatarPlastic } from './plastic';
/* the plastic material's building blocks, for renderers on other canvases
   (the React Native port bakes forms with them and lights them in a shader) */
export { buildForm as bakeBotAvatarForm, buildMatcap as buildBotAvatarMatcap, shadeTexels as shadeBotAvatarTexels, capFrame as botAvatarCapFrame, tierFor as botAvatarTier, PAD as BOT_AVATAR_PAD, SPAN as BOT_AVATAR_SPAN, MATCAP_SIZE as BOT_AVATAR_MATCAP_SIZE } from './plastic';
export type { Form as BotAvatarForm, Frame as BotAvatarFrame, Material as BotAvatarMaterial, Rig as BotAvatarRig } from './plastic';
export { JUMP_DEFAULTS as botAvatarJumpDefaults } from './engine';
export type { JumpConfig as BotAvatarJumpConfig } from './engine';
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
