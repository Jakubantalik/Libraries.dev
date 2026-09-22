import type { SkCanvas } from '@shopify/react-native-skia';
import type { BotAvatarPose } from 'bot-avatars';
import { drawBotAvatarFrame } from './draw';
import type { Resources } from './forms';
import type { DrawConfig } from './palette';
import { STRIDE } from './packet';
import { packPose } from './ticker';

/**
 * Draw one pose onto a Skia canvas, `box` points square with the overscan
 * (`box × 1.5`, the body's centre `0.1 × box` below its middle): a
 * filmstrip, a sprite sheet, an offscreen surface. JS thread.
 */
export function drawBotAvatarPose(canvas: SkCanvas, box: number, pose: BotAvatarPose, cfg: DrawConfig, res: Resources, key = 'still'): void {
  const buf = new Float32Array(STRIDE);
  packPose(buf, 0, pose, cfg.mode === 0, cfg.halfDepth, cfg.cap, cfg.lx, cfg.ly, cfg.dev);
  drawBotAvatarFrame(canvas, box, buf, 0, cfg, res, key);
}
