import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PixelRatio, View, type GestureResponderEvent } from 'react-native';
import { Canvas, Picture, Skia } from '@shopify/react-native-skia';
import { runOnUI, useDerivedValue, useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { BotAvatarSim, autoInk, botAvatarPresets, restPose, shade, type BotAvatarPose, type BotAvatarShading, type BotAvatarState } from 'bot-avatars';
import { buildDrawConfig, type DrawConfig } from './palette';
import { resourcesFor, type Resources } from './forms';
import { acquireSlot, packPose, packed, pushStill, releaseSlot, subscribe } from './ticker';
import { drawBotAvatarFrame, releaseBotAvatarInstance } from './draw';
import { OVERSCAN, RISE, STRIDE } from './packet';
import type { BotAvatarHandle, BotAvatarProps } from './types';
import { useBotAvatarSheet } from './sheet';

/* A 0–1 seed from the React id, so two avatars side by side never blink
   in step unless asked to. */
function hashSeed(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 1));
const stateLabels: Record<BotAvatarState, string> = { default: 'idle', working: 'working', sleeping: 'sleeping' };
const STATES: BotAvatarState[] = ['default', 'working', 'sleeping'];

/** the device pixel ratio the forms are sized for (capped, as the web caps its dpr) */
export const devicePixelRatio = () => Math.min(3, PixelRatio.get() || 1);

/**
 * The renderer's configuration for a set of props, with the component's
 * defaults: what `BotAvatar` builds for itself, for drawing a pose by hand.
 */
export function resolveBotAvatarConfig(props: BotAvatarProps, dev?: number): DrawConfig {
  const {
    type = 'clover', face, color, ink, brightness = 1, saturation = 1.5, shading = 'plastic', shadow = 0.35, highlight = 1.3, depth = 0.65, light = 265, rim = 0.5, spread = 1.55,
    whirl = 0, whirlSize = 1, whirlWidth = 1, whirlLength = 1, whirlTilt = 1, size = 64, sides = 'auto',
  } = props;
  const preset = botAvatarPresets[type] ?? botAvatarPresets.clover;
  const picked = color ?? preset.color;
  const body = brightness === 1 && saturation === 1 ? picked : shade(picked, (Math.min(2, Math.max(0, brightness)) - 1) * 0.35, (Math.min(2, Math.max(0, saturation)) - 1) * 0.5);
  const shadingMode: BotAvatarShading = shading === true ? 'crisp' : shading === false ? 'flat' : shading;
  return buildDrawConfig({
    type,
    face: face ?? preset.face,
    color: body,
    ink: ink ?? autoInk(body),
    shading: shadingMode,
    shadow: clamp(shadow, 0, 2),
    highlight: clamp(highlight, 0, 2),
    depth: clamp(depth, 0.2, 2),
    light,
    rim: clamp(rim, 0, 2),
    spread: clamp(spread, 0.4, 2.5),
    whirl: { strength: clamp(whirl, 0, 2), size: clamp(whirlSize, 0.6, 1.6), width: clamp(whirlWidth, 0.4, 2), length: clamp(whirlLength, 0.4, 1.6), tilt: clamp(whirlTilt, 0.5, 1.8) },
    dev: dev ?? size * devicePixelRatio(),
    sides,
  });
}

export const BotAvatar = forwardRef<BotAvatarHandle, BotAvatarProps>(function BotAvatar(props, ref) {
  const {
    type = 'clover',
    state = 'default',
    size = 64,
    speed = 1,
    paused = false,
    seed,
    depth = 0.65,
    interactive = true,
    jumpHeight = 26,
    jumpTime = 0.68,
    jumpStretch = 1,
    jumpSpin = 1,
    jumpLean = 6,
    jumpEvery = 8,
    jumpLand = 0,
    jumpSquash = 1.15,
    jumpSquashTime = 0.37,
    jumpSquashEase = 'pulse',
    jumpClickSquashTime = 0.24,
    onPress,
    style,
    accessibilityLabel,
    testID,
  } = props;
  const key = useId();
  const preset = botAvatarPresets[type] ?? botAvatarPresets.clover;
  const seedValue = Math.min(1, Math.max(0, seed ?? hashSeed(key)));
  const stateKey: BotAvatarState = STATES.includes(state) ? state : 'default';
  const reduced = useReducedMotion();
  const frozen = paused || !(speed > 0);
  const still = frozen || reduced;
  const dev = size * devicePixelRatio();

  const cfg = useMemo(
    () => resolveBotAvatarConfig(props, dev),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, props.face, props.color, props.ink, props.brightness, props.saturation, props.shading, props.shadow, props.highlight, depth, props.light, props.rim, props.spread, props.whirl, props.whirlSize, props.whirlWidth, props.whirlLength, props.whirlTilt, props.sides, dev]
  );
  const plastic = cfg.mode === 0;
  const depthC = clamp(depth, 0.2, 2);

  /* the forms: baked on timer slots while animating (the smooth look
     stands in), now for a still avatar; a landed bake re-renders once */
  const [bakes, setBakes] = useState(0);
  const res = useMemo(
    () => resourcesFor(type, dev, depthC, plastic, still, () => setBakes((b) => b + 1)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [type, dev, depthC, plastic, bakes]
  );

  /* what crosses to the UI thread: the configuration and resources as
     shared values (set on change), the pose through the shared frame array */
  const cfgSV = useSharedValue<DrawConfig>(cfg);
  const resSV = useSharedValue<Resources>(res);
  useEffect(() => {
    cfgSV.value = cfg;
  }, [cfg, cfgSV]);
  useEffect(() => {
    resSV.value = res;
  }, [res, resSV]);

  /* the sim lives across renders; props reach it through refs */
  const slot = useMemo(() => acquireSlot(), []);
  const sim = useMemo(() => new BotAvatarSim(seedValue, stateKey), []); // eslint-disable-line react-hooks/exhaustive-deps
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  const pack = (buf: Float32Array, off: number, pose: BotAvatarPose) => {
    const c = cfgRef.current;
    packPose(buf, off, pose, c.mode === 0, c.halfDepth, c.cap, c.lx, c.ly, c.dev);
  };
  /* the first packet, before the first picture is recorded below */
  useMemo(() => pushStill(slot, (buf, off) => pack(buf, off, restPose(stateKey))), []); // eslint-disable-line react-hooks/exhaustive-deps

  const rect = useMemo(() => ({ x: 0, y: 0, width: size * OVERSCAN, height: size * OVERSCAN }), [size]);
  const picture = useDerivedValue(() => {
    const pk = new Float32Array(packed.value);
    const off = slot * STRIDE;
    const rec = Skia.PictureRecorder();
    const c = rec.beginRecording(rect);
    if (pk.length >= off + STRIDE) drawBotAvatarFrame(c, size, pk, off, cfgSV.value, resSV.value, key);
    return rec.finishRecordingAsPicture();
  }, [slot, size, key, rect]);

  useLayoutEffect(() => {
    sim.setState(stateKey);
    sim.setJump({ height: jumpHeight, time: Math.max(0.2, jumpTime), stretch: jumpStretch, spin: Math.max(0, Math.round(jumpSpin)), lean: jumpLean, every: jumpEvery, land: jumpLand, squash: jumpSquash, squashTime: Math.max(0.05, jumpSquashTime), squashEase: jumpSquashEase, clickSquashTime: Math.max(0.05, jumpClickSquashTime) });
  });

  /* still: the pose of the state, repacked when the configuration changes
     (the lighting frame in the packet follows the light) */
  useLayoutEffect(() => {
    if (!still) return;
    pushStill(slot, (buf, off) => pack(buf, off, reduced ? restPose(stateKey) : sim.pose));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, reduced, stateKey, cfg, slot]);

  /* the loop: only while animated and not reduced */
  useEffect(() => {
    if (still) return;
    return subscribe(slot, (dt, buf, off) => {
      sim.update(dt * speedRef.current);
      pack(buf, off, sim.pose);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, slot]);

  useEffect(
    () => () => {
      releaseSlot(slot);
      runOnUI(releaseBotAvatarInstance)(key);
    },
    [slot, key]
  );

  /* inside a sheet the picture goes onto the sheet's canvas, at the
     avatar's position measured against it */
  const sheet = useBotAvatarSheet();
  useEffect(() => {
    if (!sheet) return;
    sheet.register(key, picture, size);
    return () => sheet.unregister(key);
  }, [sheet, key, picture, size]);

  /* touch play: a finger on the avatar is the pointer; a tap is a poke */
  const viewRef = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });
  const touch = useRef({ x: 0, y: 0, t: 0, moved: false });
  const REACH = 3;
  const pointerAt = (dx: number, dy: number) => {
    const d = Math.hypot(dx, dy);
    const strength = d < 1 ? 1 : d > REACH ? 0 : 1 - (d - 1) / (REACH - 1);
    sim.setPointer(dx / Math.max(1, d), dy / Math.max(1, d), strength);
  };
  const pointerFromEvent = (e: GestureResponderEvent) => {
    /* the body's centre sits at the view's centre */
    pointerAt((e.nativeEvent.locationX - size / 2) / size, (e.nativeEvent.locationY - size / 2) / size);
  };
  const measure = () => {
    viewRef.current?.measureInWindow((x, y) => (origin.current = { x, y }));
    const host = sheet?.ref.current;
    if (sheet && host && viewRef.current) viewRef.current.measureLayout(host, (x, y) => sheet.place(key, x, y));
  };

  useImperativeHandle(
    ref,
    () => ({
      poke: () => sim.poke(),
      setPointer: (x, y, strength) => sim.setPointer(x, y, strength),
      lookAt: (x: number | null, y?: number) => {
        if (x === null || y === undefined) sim.setPointer(0, 0, 0);
        else pointerAt((x - origin.current.x - size / 2) / size, (y - origin.current.y - size / 2) / size);
      },
    }),
    [sim, size]
  );

  const full = size * OVERSCAN;
  const side = ((OVERSCAN - 1) / 2) * size;
  return (
    <View
      ref={viewRef}
      style={[{ width: size, height: size }, style]}
      onLayout={measure}
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel ?? `${preset.label} bot, ${stateLabels[stateKey]}`}
      testID={testID}
      onStartShouldSetResponder={() => (interactiveRef.current && !frozenRef.current) || !!onPress}
      onResponderGrant={(e) => {
        touch.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now(), moved: false };
        if (interactiveRef.current && !frozenRef.current) pointerFromEvent(e);
      }}
      onResponderMove={(e) => {
        if (Math.hypot(e.nativeEvent.pageX - touch.current.x, e.nativeEvent.pageY - touch.current.y) > 8) touch.current.moved = true;
        if (interactiveRef.current && !frozenRef.current) pointerFromEvent(e);
      }}
      onResponderRelease={() => {
        const tap = !touch.current.moved && Date.now() - touch.current.t < 400;
        sim.setPointer(0, 0, 0);
        if (tap) {
          if (interactiveRef.current && !frozenRef.current) sim.poke();
          onPress?.();
        }
      }}
      onResponderTerminate={() => sim.setPointer(0, 0, 0)}
    >
      {!sheet && (
        <Canvas style={{ position: 'absolute', left: -side, top: -(side + RISE * size), width: full, height: full }} pointerEvents="none" opaque={false}>
          <Picture picture={picture} />
        </Canvas>
      )}
    </View>
  );
});

export default BotAvatar;
