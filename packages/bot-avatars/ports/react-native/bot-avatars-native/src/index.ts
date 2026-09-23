export { BotAvatar, resolveBotAvatarConfig, devicePixelRatio } from './BotAvatar';
export { default } from './BotAvatar';
export type { BotAvatarProps, BotAvatarHandle, BotAvatarSquashEase } from './types';
export { BotAvatarSheet, useBotAvatarSheet, type BotAvatarSheetProps } from './sheet';

/* the rig, palette and presets straight from the web package */
export {
  BotAvatarSim,
  restPose,
  botAvatarPresets,
  botAvatarPalette,
  botAvatarTypes,
  botAvatarFaces,
  botAvatarStates,
  botAvatarShapes,
  botAvatarParts,
  botAvatarJumpDefaults,
  autoInk,
  luminance,
  parseColor,
  shade,
  BOT_AVATAR_OVERSCAN,
  BOT_AVATAR_RISE,
} from 'bot-avatars';
export type { BotAvatarType, BotAvatarFace, BotAvatarState, BotAvatarShading, BotAvatarPreset, BotAvatarPose, BotAvatarJumpConfig } from 'bot-avatars';

/* drawing it yourself: a pose onto any Skia canvas */
export { drawBotAvatarFrame, readBotAvatarUiStats, releaseBotAvatarInstance } from './draw';
export { drawBotAvatarPose } from './still';
export { buildDrawConfig, type DrawConfig, type DrawOptions } from './palette';
export { resourcesFor, outlinePath, partsPath, tierFor, bakeLog, formFormat, bakeRawForm, type Resources } from './forms';
export { packPose, jsStats, packed } from './ticker';
export { STRIDE, PK } from './packet';
export { lightNormal, lightRing, lightConstants, CAP_SKSL, type LightFrame, type LightConstants } from './light';
