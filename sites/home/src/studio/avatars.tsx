import { useRef, useState } from "react";
import {
  BotAvatar,
  botAvatarPalette,
  botAvatarPresets,
  botAvatarTypes,
  autoInk,
  shade,
  type BotAvatarFace,
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

const SHADING_OPTIONS = [
  { value: "plastic", label: "Plastic" },
  { value: "crisp", label: "Crisp" },
  { value: "smooth", label: "Smooth" },
  { value: "flat", label: "Flat" },
] as const;

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
  const [brightness, setBrightness] = useState(100);
  const [saturation, setSaturation] = useState(150);
  const [speed, setSpeed] = useState(100);
  const [seed, setSeed] = useState<number | null>(null);
  /* the library's own defaults */
  const [shading, setShading] = useState<BotAvatarShading>("plastic");
  const [shadow, setShadow] = useState(35);
  const [highlight, setHighlight] = useState(130);
  const [depth, setDepth] = useState(65);
  const [light, setLight] = useState(265);
  const [rim, setRim] = useState(50);
  const [spread, setSpread] = useState(155);
  const [interactive, setInteractive] = useState(true);
  const [turn, setTurn] = useState(100); // % of the idle side turn (35° either way)
  const [whirl, setWhirl] = useState(0);
  const [paused, setPaused] = useState(false);
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
  const litColor = brightness === 100 && saturation === 150 ? shownColor : shade(shownColor, (brightness / 100 - 1) * 0.35, (saturation / 100 - 1) * 0.5);
  const shownInk = ink ?? autoInk(litColor);

  /* What was picked for each type is kept while the bench lives, so
     switching away and back does not lose a colour or a face. */
  const perType = useRef<Partial<Record<BotAvatarType, { face: BotAvatarFace | null; color: string | null; ink: string | null }>>>({});
  const chooseType = (next: BotAvatarType) => {
    if (next === type) return;
    perType.current[type] = { face, color, ink };
    const saved = perType.current[next];
    setType(next);
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
  if (brightness !== 100) props.push(`brightness={${num(brightness / 100)}}`);
  if (saturation !== 150) props.push(`saturation={${num(saturation / 100)}}`);
  if (speed !== 100) props.push(`speed={${num(speed / 100)}}`);
  if (seed !== null) props.push(`seed={${num(seed)}}`);
  if (shading !== "plastic") props.push(`shading="${shading}"`);
  if (shading !== "flat") {
    if (shadow !== 35) props.push(`shadow={${num(shadow / 100)}}`);
    if (highlight !== 130) props.push(`highlight={${num(highlight / 100)}}`);
    if (light !== 265) props.push(`light={${light}}`);
    if (shading !== "smooth" && rim !== 50) props.push(`rim={${num(rim / 100)}}`);
    if (shading !== "crisp" && spread !== 155) props.push(`spread={${num(spread / 100)}}`);
  }
  if (depth !== 65) props.push(`depth={${num(depth / 100)}}`);
  if (!interactive) props.push("interactive={false}");
  if (turn !== 100) props.push(`turn={${num(turn / 100)}}`);
  if (whirl !== 0) props.push(`whirl={${num(whirl / 100)}}`);
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
            light={light}
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
            paused={paused}
          />
        )}
        <button
          type="button"
          className="btn-animate pg-play"
          onClick={() => setPaused((p) => !p)}
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
          <PgSlider label="Saturation" value={saturation} min={50} max={150} step={1} display={`${saturation}%`} onChange={setSaturation} />
          <PgSwatches label="Ink" options={INK_OPTIONS} value={shownInk} onChange={setInk} allowCustom />
          <PgTabs label="Shading" options={SHADING_OPTIONS} value={shading} onChange={setShading} />
          {shading !== "flat" && (
            <>
              <PgSlider label="Shadow" value={shadow} min={0} max={200} step={5} display={`${shadow}%`} onChange={setShadow} />
              <PgSlider label="Highlight" value={highlight} min={0} max={200} step={5} display={`${highlight}%`} onChange={setHighlight} />
              <PgSlider label="Light angle" value={light} min={0} max={360} step={5} display={`${light}°`} onChange={setLight} />
              {shading !== "smooth" && (
                <PgSlider label="Rim" value={rim} min={0} max={200} step={5} display={`${rim}%`} onChange={setRim} />
              )}
              {shading !== "crisp" && (
                <PgSlider label="Spread" value={spread} min={40} max={250} step={5} display={`${spread}%`} onChange={setSpread} />
              )}
            </>
          )}
          {/* the thickness shows whenever the head turns */}
          <PgSlider label="Depth" value={depth} min={20} max={200} step={5} display={`${depth}%`} onChange={setDepth} />
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
