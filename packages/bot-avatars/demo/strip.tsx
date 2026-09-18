import { useEffect, useRef } from 'react';
import {
  BotAvatarSim,
  drawBotAvatarFrame,
  botAvatarPresets,
  botAvatarShapes,
  botAvatarParts,
  autoInk,
  BOT_AVATAR_OVERSCAN,
  type BotAvatarState,
  type BotAvatarType,
  type BotAvatarFace,
} from '../src';

/* A filmstrip: one sim stepped at 60 fps, a canvas painted every `every`
   seconds, so the motion can be judged from stills. */
export function Strip({
  type,
  face,
  state,
  from,
  every = 0.3,
  frames = 14,
  warm = 2,
  size = 96,
  seed = 0.42,
}: {
  type: BotAvatarType;
  face?: BotAvatarFace;
  state: BotAvatarState;
  from?: BotAvatarState;
  every?: number;
  frames?: number;
  warm?: number;
  size?: number;
  seed?: number;
}) {
  const refs = useRef<Array<HTMLCanvasElement | null>>([]);
  useEffect(() => {
    const preset = botAvatarPresets[type];
    const cfg = {
      path: new Path2D(botAvatarShapes[type]),
      face: face ?? preset.face,
      faceX: preset.faceX,
      faceY: preset.faceY,
      faceScale: preset.faceScale,
      color: preset.color,
      ink: autoInk(preset.color),
      shading: 'plastic' as const,
      typeKey: type,
      still: true,
      parts: botAvatarParts[type] ? new Path2D(botAvatarParts[type] as string) : undefined,
    };
    const sim = new BotAvatarSim(seed, from ?? state);
    const step = 1 / 60;
    for (let t = 0; t < warm; t += step) sim.update(step);
    if (from) sim.setState(state);
    const dpr = 2;
    for (let k = 0; k < frames; k++) {
      if (k > 0) for (let t = 0; t < every; t += step) sim.update(step);
      const c = refs.current[k];
      if (!c) continue;
      c.width = c.height = size * BOT_AVATAR_OVERSCAN * dpr;
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawBotAvatarFrame(ctx, size, sim.pose, cfg);
    }
  }, [type, face, state, from, every, frames, warm, size, seed]);
  return (
    <div className="strip">
      {Array.from({ length: frames }, (_, k) => (
        <canvas key={k} ref={(el) => (refs.current[k] = el)} style={{ width: size * BOT_AVATAR_OVERSCAN, height: size * BOT_AVATAR_OVERSCAN, margin: (-size * (BOT_AVATAR_OVERSCAN - 1)) / 2 }} />
      ))}
    </div>
  );
}
