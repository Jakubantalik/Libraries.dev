import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  BotAvatar,
  botAvatarPalette,
  botAvatarPresets,
  botAvatarTypes,
  autoInk,
  shade,
  type BotAvatarFace,
  type BotAvatarGlasses,
  type BotAvatarHat,
  type BotAvatarShading,
  type BotAvatarState,
  type BotAvatarType,
} from "bot-avatars";
import { ControlsPanel, PgTabs, PgSlider, PgSwatches, PgToggles, PanelSep, Snippet, num, StageBar, PgGroup } from "./controls";

/* Studio — Bot avatars workbench. Every prop on the component is a knob:
   the type, the face and the state, then the size, the body colour and
   the face ink, the animation speed, the seed that offsets the blinks,
   and the shading. */

const TYPE_OPTIONS = botAvatarTypes.map((t) => ({ value: t, label: botAvatarPresets[t].label }));
const SQUASH_EASE_OPTIONS = [
  { value: "sharp", label: "Sharp" },
  { value: "pulse", label: "Pulse" },
  { value: "soft", label: "Soft" },
  { value: "bouncy", label: "Bouncy" },
] as const;
const SPIN_OPTIONS = [
  { value: "0", label: "None" },
  { value: "1", label: "One turn" },
  { value: "2", label: "Two turns" },
] as const;
const FACE_OPTIONS = [
  { value: "eyes", label: "Eyes" },
  { value: "mouth", label: "Mouth" },
] as const;
const STATE_OPTIONS = [
  { value: "default", label: "Idle" },
  { value: "working", label: "Working" },
  { value: "sleeping", label: "Sleeping" },
] as const;

/* the library's default light per material, in slider units */
const lightDefaults = (shading: BotAvatarShading) =>
  shading === "fabric"
    ? { shadow: 115, highlight: 145, light: 295, rim: 60, spread: 160 }
    : { shadow: 35, highlight: 130, light: 300, rim: 50, spread: 155 };
/* where the library puts the back light when none is given: above the
   toy, toward the side away from the key (degrees clockwise from the top) */
const autoBack = (light: number) => {
  const a = (light * Math.PI) / 180;
  const x = -0.5 * Math.sin(a), y = 0.5 * Math.cos(a) - 0.87;
  return Math.round(((((Math.atan2(x, -y) * 180) / Math.PI) % 360) + 360) % 360 / 5) * 5;
};
const SHADING_OPTIONS = [
  { value: "plastic", label: "Plastic" },
  { value: "fabric", label: "Fabric" },
  { value: "crisp", label: "Crisp" },
  { value: "smooth", label: "Smooth" },
  { value: "flat", label: "Flat" },
] as const;

/* what the bot can wear */
const HAT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "beret", label: "Beret" },
  { value: "beanie", label: "Beanie" },
  { value: "party", label: "Party" },
  { value: "crown", label: "Crown" },
] as const;
const GLASSES_OPTIONS = [
  { value: "none", label: "None" },
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
  { value: "shades", label: "Shades" },
] as const;
const WEAR_COLOR_OPTIONS = [
  { value: "#27272b", label: "Charcoal" },
  { value: "#f4efe6", label: "Cream" },
  { value: "#c8323c", label: "Red" },
  { value: "#2f5fd0", label: "Blue" },
  { value: "#e9a93b", label: "Mustard" },
  { value: "#2e8b57", label: "Green" },
];

const COLOR_OPTIONS = botAvatarTypes
  .map((t) => ({ value: botAvatarPalette[t], label: botAvatarPresets[t].label }))
  .filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i);
const INK_OPTIONS = [
  { value: "#1F1B2E", label: "Dark ink" },
  { value: "#F6F4F0", label: "Light ink" },
  { value: "#35B8FF", label: "Sky" },
  { value: "#DC48FF", label: "Magenta" },
];

export function AvatarsStudio({ visible = true, theme = "dark" }: { visible?: boolean; theme?: "dark" | "light" }) {
  const [type, setType] = useState<BotAvatarType>("clover");
  /* The face follows the type's own until one is picked; the colour and
     ink likewise follow the palette until touched. */
  const [face, setFace] = useState<BotAvatarFace | null>(null);
  const [state, setState] = useState<BotAvatarState>("default");
  const [size, setSize] = useState(96);
  const [color, setColor] = useState<string | null>(null);
  const [ink, setInk] = useState<string | null>(null);
  /* the type's own brightness and saturation (most use 100% and 150%) */
  const ownLook = (t: BotAvatarType) => ({
    brightness: Math.round((botAvatarPresets[t].brightness ?? 1) * 100),
    saturation: Math.round((botAvatarPresets[t].saturation ?? 1.5) * 100),
  });
  const [brightness, setBrightness] = useState(() => ownLook("clover").brightness);
  const [saturation, setSaturation] = useState(() => ownLook("clover").saturation);
  const [speed, setSpeed] = useState(100);
  const [seed, setSeed] = useState<number | null>(null);
  /* the library's own defaults */
  const [shading, setShading] = useState<BotAvatarShading>("plastic");
  const [shadow, setShadow] = useState(35);
  const [highlight, setHighlight] = useState(130);
  /* fabric has its own default light: switching shading swaps the light
     sliders to the new material's defaults, unless they were moved */
  const lit = lightDefaults(shading);
  const [depth, setDepth] = useState(65);
  const [roundness, setRoundness] = useState(100);
  const [furLength, setFurLength] = useState(100);
  const [furDensity, setFurDensity] = useState(160);
  const [furFuzz, setFurFuzz] = useState(90);
  const [furClumps, setFurClumps] = useState(40);
  const [furCurl, setFurCurl] = useState(70);
  const [furGravity, setFurGravity] = useState(90);
  const [light, setLight] = useState(300);
  const [rim, setRim] = useState(50);
  const [spread, setSpread] = useState(155);
  /* fabric's light rig: where the back light comes from (null follows the
     key), how far round to the front the key sits, and the fibres' shine */
  const [backLight, setBackLight] = useState<number | null>(null);
  const [lightFront, setLightFront] = useState(32);
  const [shine, setShine] = useState(0);
  const [sheen, setSheen] = useState(0);
  const [backSoft, setBackSoft] = useState(100);
  const chooseShading = (next: BotAvatarShading) => {
    const was = lightDefaults(shading), to = lightDefaults(next);
    if (shadow === was.shadow && highlight === was.highlight && light === was.light && rim === was.rim && spread === was.spread) {
      setShadow(to.shadow);
      setHighlight(to.highlight);
      setLight(to.light);
      setRim(to.rim);
      setSpread(to.spread);
    }
    setShading(next);
  };
  const [interactive, setInteractive] = useState(true);
  const [turn, setTurn] = useState(100); // % of the idle side turn (35° either way)
  const [whirl, setWhirl] = useState(0);
  const [paused, setPaused] = useState(false);
  /* Dragging the avatar turns it round by hand, as a 3D viewer does: the
     animation stops and the body follows the pointer (across for the
     turn, up and down for the tilt) and stays where it is let go; Play
     hands it back to the animation. A press that does not move is still a
     click (a hop). */
  const [held, setHeld] = useState<{ yaw: number; pitch: number } | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; yaw: number; pitch: number; moved: boolean } | null>(null);
  const DRAG_TURN = 0.012; // radians per pixel
  const onDragStart = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: held?.yaw ?? 0, pitch: held?.pitch ?? 0, moved: false };
  };
  const onDragMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      d.moved = true;
      setPaused(true);
      /* keep the drag when the pointer leaves the avatar */
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer the browser no longer tracks: the drag still works over the avatar */
      }
    }
    setHeld({ yaw: d.yaw + dx * DRAG_TURN, pitch: Math.max(-1.3, Math.min(1.3, d.pitch - dy * DRAG_TURN)) });
  };
  const onDragEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
  };
  const [hat, setHat] = useState<BotAvatarHat>("none");
  const [glasses, setGlasses] = useState<BotAvatarGlasses>("none");
  const [headphones, setHeadphones] = useState(false);
  const [bowTie, setBowTie] = useState(false);
  const [wearColor, setWearColor] = useState("#27272b");
  /* the jump: an idle flip and a click's; the library's defaults */
  const [jumpHeight, setJumpHeight] = useState(26);
  const [jumpTime, setJumpTime] = useState(68);
  const [jumpStretch, setJumpStretch] = useState(100);
  const [jumpSpin, setJumpSpin] = useState<"0" | "1" | "2">("1");
  const [jumpLean, setJumpLean] = useState(6);
  const [jumpEvery, setJumpEvery] = useState(8);
  const [jumpLand, setJumpLand] = useState(0); // ms round touch-down
  const [jumpSquash, setJumpSquash] = useState(115);
  const [jumpSquashTime, setJumpSquashTime] = useState(370); // ms
  const [jumpSquashEase, setJumpSquashEase] = useState<"sharp" | "pulse" | "soft" | "bouncy">("pulse");
  const [jumpClickSquashTime, setJumpClickSquashTime] = useState(240); // ms
  const [jumpGroundTime, setJumpGroundTime] = useState(110); // ms held at the deepest squash
  const [jumpGroundEase, setJumpGroundEase] = useState<"sharp" | "pulse" | "soft" | "bouncy">("pulse");
  const [jumpRiseTime, setJumpRiseTime] = useState(330); // ms back to shape
  const [jumpRiseEase, setJumpRiseEase] = useState<"sharp" | "pulse" | "soft" | "bouncy">("pulse");

  const preset = botAvatarPresets[type];
  const shownFace = face ?? preset.face;
  const shownColor = color ?? preset.color;
  /* what the library will paint, for the auto ink */
  const own = ownLook(type);
  const litColor = brightness === 100 && saturation === 100 ? shownColor : shade(shownColor, (brightness / 100 - 1) * 0.35, (Math.min(150, saturation) / 100 - 1) * 0.5);
  const shownInk = ink ?? autoInk(litColor);

  /* What was picked for each type is kept while the bench lives, so
     switching away and back does not lose a colour or a face. */
  const perType = useRef<Partial<Record<BotAvatarType, { face: BotAvatarFace | null; color: string | null; ink: string | null }>>>({});
  const chooseType = (next: BotAvatarType) => {
    if (next === type) return;
    perType.current[type] = { face, color, ink };
    const saved = perType.current[next];
    setType(next);
    /* the sliders follow the type's own look unless they were moved */
    const was = ownLook(type), to = ownLook(next);
    if (brightness === was.brightness) setBrightness(to.brightness);
    if (saturation === was.saturation) setSaturation(to.saturation);
    setFace(saved?.face ?? null);
    setColor(saved?.color ?? null);
    setInk(saved?.ink ?? null);
  };

  /* Live snippet: only non-default props survive. */
  const props = [`type="${type}"`];
  if (face && face !== preset.face) props.push(`face="${face}"`);
  if (state !== "default") props.push(`state="${state}"`);
  if (size !== 64) props.push(`size={${size}}`);
  if (color && color !== preset.color) props.push(`color="${color}"`);
  if (ink && ink !== autoInk(litColor)) props.push(`ink="${ink}"`);
  if (brightness !== own.brightness) props.push(`brightness={${num(brightness / 100)}}`);
  if (saturation !== own.saturation) props.push(`saturation={${num(saturation / 100)}}`);
  if (speed !== 100) props.push(`speed={${num(speed / 100)}}`);
  if (seed !== null) props.push(`seed={${num(seed)}}`);
  if (shading !== "plastic") props.push(`shading="${shading}"`);
  if (shading !== "flat") {
    if (shadow !== lit.shadow) props.push(`shadow={${num(shadow / 100)}}`);
    if (highlight !== lit.highlight) props.push(`highlight={${num(highlight / 100)}}`);
    if (light !== lit.light) props.push(`light={${light}}`);
    if (shading !== "smooth" && rim !== lit.rim) props.push(`rim={${num(rim / 100)}}`);
    if (shading !== "crisp" && spread !== lit.spread) props.push(`spread={${num(spread / 100)}}`);
    if (shading === "fabric") {
      if (backLight !== null) props.push(`backLight={${backLight}}`);
      if (lightFront !== 32) props.push(`lightFront={${lightFront}}`);
      if (shine !== 0) props.push(`shine={${num(shine / 100)}}`);
      if (backSoft !== 100) props.push(`backSoftness={${num(backSoft / 100)}}`);
      if (sheen !== 0) props.push(`sheen={${num(sheen / 100)}}`);
    }
  }
  if (depth !== 65) props.push(`depth={${num(depth / 100)}}`);
  if ((shading === "plastic" || shading === "fabric") && roundness !== 100) props.push(`roundness={${num(roundness / 100)}}`);
  if (shading === "fabric") {
    if (furLength !== 100) props.push(`furLength={${num(furLength / 100)}}`);
    if (furDensity !== 160) props.push(`furDensity={${num(furDensity / 100)}}`);
    if (furFuzz !== 90) props.push(`furFuzz={${num(furFuzz / 100)}}`);
    if (furClumps !== 40) props.push(`furClumps={${num(furClumps / 100)}}`);
    if (furCurl !== 70) props.push(`furCurl={${num(furCurl / 100)}}`);
    if (furGravity !== 90) props.push(`furGravity={${num(furGravity / 100)}}`);
  }
  if (!interactive) props.push("interactive={false}");
  if (turn !== 100) props.push(`turn={${num(turn / 100)}}`);
  if (whirl !== 0) props.push(`whirl={${num(whirl / 100)}}`);
  if (hat !== "none") props.push(`hat="${hat}"`);
  if (glasses !== "none") props.push(`glasses="${glasses}"`);
  if (headphones) props.push("headphones");
  if (bowTie) props.push("bowTie");
  if ((hat !== "none" || headphones || bowTie) && wearColor !== "#27272b") props.push(`accessoryColor="${wearColor}"`);
  if (jumpHeight !== 26) props.push(`jumpHeight={${jumpHeight}}`);
  if (jumpTime !== 68) props.push(`jumpTime={${num(jumpTime / 100)}}`);
  if (jumpStretch !== 100) props.push(`jumpStretch={${num(jumpStretch / 100)}}`);
  if (jumpSpin !== "1") props.push(`jumpSpin={${jumpSpin}}`);
  if (jumpLean !== 6) props.push(`jumpLean={${jumpLean}}`);
  if (jumpEvery !== 8) props.push(`jumpEvery={${jumpEvery}}`);
  if (jumpLand !== 0) props.push(`jumpLand={${num(jumpLand / 1000)}}`);
  if (jumpSquash !== 115) props.push(`jumpSquash={${num(jumpSquash / 100)}}`);
  if (jumpSquashTime !== 370) props.push(`jumpSquashTime={${num(jumpSquashTime / 1000)}}`);
  if (jumpSquashEase !== "pulse") props.push(`jumpSquashEase="${jumpSquashEase}"`);
  if (jumpGroundTime !== 110) props.push(`jumpGroundTime={${num(jumpGroundTime / 1000)}}`);
  if (jumpGroundTime > 0 && jumpGroundEase !== "pulse") props.push(`jumpGroundEase="${jumpGroundEase}"`);
  if (jumpRiseTime !== 330) props.push(`jumpRiseTime={${num(jumpRiseTime / 1000)}}`);
  if (jumpRiseEase !== "pulse") props.push(`jumpRiseEase="${jumpRiseEase}"`);
  if (jumpClickSquashTime !== 240) props.push(`jumpClickSquashTime={${num(jumpClickSquashTime / 1000)}}`);
  if (theme === "light") props.push(`theme="light"`);
  if (paused) props.push("paused");
  const snippet = `import { BotAvatar } from 'bot-avatars';\n\n<BotAvatar ${props.join(" ")} />`;

  return (
    <div className="pg">
      <StageBar library="Bot avatars" prompt={{ pkg: "bot-avatars", docsPath: "/bots.html", snippet }} />
      <div className="pg-stage">
        {visible && (
          <BotAvatar
            type={type}
            face={shownFace}
            state={state}
            size={size}
            color={shownColor}
            ink={shownInk}
            brightness={brightness / 100}
            saturation={saturation / 100}
            speed={speed / 100}
            seed={seed ?? undefined}
            shading={shading}
            shadow={shadow / 100}
            highlight={highlight / 100}
            depth={depth / 100}
            roundness={roundness / 100}
            furLength={furLength / 100}
            furDensity={furDensity / 100}
            furFuzz={furFuzz / 100}
            furClumps={furClumps / 100}
            furCurl={furCurl / 100}
            furGravity={furGravity / 100}
            light={light}
            backLight={shading === "fabric" && backLight !== null ? backLight : undefined}
            lightFront={lightFront}
            shine={shine / 100}
            sheen={sheen / 100}
            backSoftness={backSoft / 100}
            rim={rim / 100}
            spread={spread / 100}
            interactive={interactive}
            turn={turn / 100}
            theme={theme}
            whirl={whirl / 100}
            jumpHeight={jumpHeight}
            jumpTime={jumpTime / 100}
            jumpStretch={jumpStretch / 100}
            jumpSpin={Number(jumpSpin)}
            jumpLean={jumpLean}
            jumpEvery={jumpEvery}
            jumpLand={jumpLand / 1000}
            jumpSquash={jumpSquash / 100}
            jumpSquashTime={jumpSquashTime / 1000}
            jumpSquashEase={jumpSquashEase}
            jumpClickSquashTime={jumpClickSquashTime / 1000}
            jumpGroundTime={jumpGroundTime / 1000}
            jumpGroundEase={jumpGroundEase}
            jumpRiseTime={jumpRiseTime / 1000}
            jumpRiseEase={jumpRiseEase}
            hat={hat}
            glasses={glasses}
            headphones={headphones}
            bowTie={bowTie}
            accessoryColor={wearColor}
            paused={paused}
            pose={held ?? undefined}
            onPointerDown={onDragStart}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            style={{ cursor: held ? "grabbing" : "grab", touchAction: "none" }}
          />
        )}
        <button
          type="button"
          className="btn-animate pg-play"
          onClick={() => {
            setPaused((p) => !p);
            setHeld(null);
          }}
          aria-pressed={!paused}
        >
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <ControlsPanel library="Bot avatars">
        <PgTabs label="Type" options={TYPE_OPTIONS} value={type} onChange={chooseType} />
        <PgTabs label="Face" options={FACE_OPTIONS} value={shownFace} onChange={setFace} />
        <PgTabs label="State" options={STATE_OPTIONS} value={state} onChange={setState} />
        <PanelSep />
        <PgGroup label="Look">
          <PgSlider label="Size" value={size} min={16} max={200} step={2} display={`${size}px`} onChange={setSize} />
          <PgSwatches label="Color" options={COLOR_OPTIONS} value={shownColor} onChange={setColor} allowCustom />
          <PgSlider label="Brightness" value={brightness} min={50} max={150} step={1} display={`${brightness}%`} onChange={setBrightness} />
          <PgSlider label="Saturation" value={saturation} min={50} max={250} step={1} display={`${saturation}%`} onChange={setSaturation} />
          <PgSwatches label="Ink" options={INK_OPTIONS} value={shownInk} onChange={setInk} allowCustom />
          <PgTabs label="Shading" options={SHADING_OPTIONS} value={shading} onChange={chooseShading} />
          {shading !== "flat" && (
            <>
              <PgSlider label="Shadow" value={shadow} min={0} max={200} step={5} display={`${shadow}%`} onChange={setShadow} />
              <PgSlider label="Highlight" value={highlight} min={0} max={200} step={5} display={`${highlight}%`} onChange={setHighlight} />
              <PgSlider label="Light angle" value={light} min={0} max={360} step={5} display={`${light}°`} onChange={setLight} />
              {shading === "fabric" && (
                <PgSlider label="Key front" value={lightFront} min={0} max={85} step={1} display={`${lightFront}°`} onChange={setLightFront} />
              )}
              {shading !== "smooth" && (
                <PgSlider label={shading === "fabric" ? "Back light" : "Rim"} value={rim} min={0} max={200} step={5} display={`${rim}%`} onChange={setRim} />
              )}
              {shading === "fabric" && (
                <PgSlider label="Back light softness" value={backSoft} min={0} max={100} step={5} display={`${backSoft}%`} onChange={setBackSoft} />
              )}
              {shading === "fabric" && (
                <PgSlider
                  label="Back light angle"
                  value={backLight ?? autoBack(light)}
                  min={0}
                  max={360}
                  step={5}
                  display={backLight === null ? `${autoBack(light)}° auto` : `${backLight}°`}
                  onChange={setBackLight}
                />
              )}
              {shading === "fabric" && (
                <PgSlider label="Fibre shine" value={shine} min={0} max={200} step={5} display={`${shine}%`} onChange={setShine} />
              )}
              {shading === "fabric" && (
                <PgSlider label="Sheen" value={sheen} min={0} max={200} step={5} display={`${sheen}%`} onChange={setSheen} />
              )}
              {shading !== "crisp" && (
                <PgSlider label="Spread" value={spread} min={40} max={250} step={5} display={`${spread}%`} onChange={setSpread} />
              )}
            </>
          )}
          {/* the thickness shows whenever the head turns */}
          <PgSlider label="Depth" value={depth} min={20} max={200} step={5} display={`${depth}%`} onChange={setDepth} />
          {(shading === "plastic" || shading === "fabric") && (
            <PgSlider label="Roundness" value={roundness} min={0} max={100} step={5} display={`${roundness}%`} onChange={setRoundness} />
          )}
        </PgGroup>
        {/* the plush pile's own style, for fabric */}
        {shading === "fabric" && (
          <>
            <PanelSep />
            <PgGroup label="Fur">
              <PgSlider label="Length" value={furLength} min={30} max={250} step={5} display={`${furLength}%`} onChange={setFurLength} />
              <PgSlider label="Density" value={furDensity} min={30} max={200} step={5} display={`${furDensity}%`} onChange={setFurDensity} />
              <PgSlider label="Edge fuzz" value={furFuzz} min={0} max={100} step={5} display={`${furFuzz}%`} onChange={setFurFuzz} />
              <PgSlider label="Clumps" value={furClumps} min={0} max={100} step={5} display={`${furClumps}%`} onChange={setFurClumps} />
              <PgSlider label="Curl" value={furCurl} min={0} max={100} step={5} display={`${furCurl}%`} onChange={setFurCurl} />
              <PgSlider label="Gravity" value={furGravity} min={0} max={100} step={5} display={`${furGravity}%`} onChange={setFurGravity} />
            </PgGroup>
          </>
        )}
        <PanelSep />
        {/* things to wear, each sitting on the body's own shape and
            turning with the head */}
        <PgGroup label="Wear">
          <PgTabs label="Hat" options={HAT_OPTIONS} value={hat} onChange={setHat} />
          <PgTabs label="Glasses" options={GLASSES_OPTIONS} value={glasses} onChange={setGlasses} />
          <PgToggles
            label="Extras"
            options={[
              { label: "Headphones", active: headphones, onToggle: () => setHeadphones((v) => !v) },
              { label: "Bow tie", active: bowTie, onToggle: () => setBowTie((v) => !v) },
            ]}
          />
          {(hat !== "none" || headphones || bowTie) && (
            <PgSwatches label="Wear color" options={WEAR_COLOR_OPTIONS} value={wearColor} onChange={setWearColor} allowCustom />
          )}
        </PgGroup>
        <PanelSep />
        <PgGroup label="Motion">
          <PgSlider label="Speed" value={speed} min={25} max={300} step={5} display={`${num(speed / 100)}×`} onChange={setSpeed} />
          {/* Where in its blink and glance loops the avatar starts; two
              avatars with the same seed move in step. */}
          <PgSlider label="Seed" value={seed ?? 0} min={0} max={1} step={0.01} display={seed === null ? "auto" : num(seed)} onChange={setSeed} />
          {/* how far the head turns from side to side while idle */}
          <PgSlider label="Side turn" value={turn} min={0} max={200} step={5} display={`${turn}%`} onChange={setTurn} />
          {/* the eyes and head follow a pointer nearby and a click hops and
              flips; the motion ring round a spin; a jump now and then in
              the idle state */}
          <PgToggles
            label="Options"
            options={[
              { label: "Follow pointer", active: interactive, onToggle: () => setInteractive((v) => !v) },
              { label: "Whirl ring", active: whirl > 0, onToggle: () => setWhirl((v) => (v > 0 ? 0 : 100)) },
              { label: "Jump in idle", active: jumpEvery > 0, onToggle: () => setJumpEvery((v) => (v > 0 ? 0 : 8)) },
            ]}
          />
        </PgGroup>
        <PanelSep />
        {/* the jump: an idle flip now and then, and a click's */}
        <PgGroup label="Jump">
          <PgSlider label="Height" value={jumpHeight} min={0} max={50} step={1} display={`${jumpHeight}`} onChange={setJumpHeight} />
          <PgSlider label="Air time" value={jumpTime} min={40} max={140} step={2} display={`${num(jumpTime / 100)} s`} onChange={setJumpTime} />
          <PgSlider label="Stretch" value={jumpStretch} min={0} max={200} step={5} display={`${jumpStretch}%`} onChange={setJumpStretch} />
          <PgTabs label="Spin" options={SPIN_OPTIONS} value={jumpSpin} onChange={setJumpSpin} />
          <PgSlider label="Lean" value={jumpLean} min={0} max={15} step={1} display={`${jumpLean}°`} onChange={setJumpLean} />
          {/* the squash on the ground: how deep, how long, and its shape */}
          <PgSlider label="Squash" value={jumpSquash} min={0} max={200} step={5} display={`${jumpSquash}%`} onChange={setJumpSquash} />
          <PgSlider label="Squash time" value={jumpSquashTime} min={100} max={600} step={10} display={`${jumpSquashTime} ms`} onChange={setJumpSquashTime} />
          {/* how long the deepest squash is held on the ground */}
          <PgSlider label="Ground time" value={jumpGroundTime} min={0} max={600} step={10} display={jumpGroundTime === 0 ? "none" : `${jumpGroundTime} ms`} onChange={setJumpGroundTime} />
          {/* what the body does through that hold */}
          {jumpGroundTime > 0 && (
            <PgTabs label="Ground easing" options={SQUASH_EASE_OPTIONS} value={jumpGroundEase} onChange={setJumpGroundEase} />
          )}
          {/* the way back from the deepest squash to the body's own shape */}
          <PgSlider label="Rise time" value={jumpRiseTime} min={80} max={800} step={10} display={`${jumpRiseTime} ms`} onChange={setJumpRiseTime} />
          <PgTabs label="Rise easing" options={SQUASH_EASE_OPTIONS} value={jumpRiseEase} onChange={setJumpRiseEase} />
          <PgTabs label="Squash easing" options={SQUASH_EASE_OPTIONS} value={jumpSquashEase} onChange={setJumpSquashEase} />
          {/* a click's jump: how long its landing squash takes */}
          <PgSlider label="Click squash time" value={jumpClickSquashTime} min={100} max={1000} step={10} display={`${jumpClickSquashTime} ms`} onChange={setJumpClickSquashTime} />
          {/* when the landing squash begins, round the moment of contact */}
          <PgSlider
            label="Land squash"
            value={jumpLand}
            min={-200}
            max={150}
            step={10}
            display={jumpLand === 0 ? "at contact" : jumpLand < 0 ? `${-jumpLand} ms early` : `${jumpLand} ms late`}
            onChange={setJumpLand}
          />
          <PgSlider label="Every" value={jumpEvery} min={0} max={20} step={1} display={jumpEvery === 0 ? "never" : `${jumpEvery} s`} onChange={setJumpEvery} />
        </PgGroup>
      </ControlsPanel>

      <Snippet code={snippet} />
    </div>
  );
}
