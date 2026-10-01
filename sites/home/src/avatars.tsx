import { StrictMode, useRef, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  BotAvatar,
  botAvatarPresets,
  botAvatarTypes,
  type BotAvatarShading,
  type BotAvatarState,
  type BotAvatarType,
} from "bot-avatars";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser } from "./examples/StudioTeaser";
import { BotRoster, BotChat } from "./examples/avatars-mocks";
import { PgTabs } from "./examples/PgTabs";
import { DemoDevPanel } from "./examples/DemoDevPanel";
import { useDemoFlag, useDemoReset } from "./examples/demoFlags";

/* Bot avatars detail page — one React island rendering the examples, the
   playground (stage + controls) and the live-updating snippet below it.
   Controls are the Studio's first knobs — type, state — plus the size and
   the shading, fabric (the default) or plastic with the other three shown
   but locked, then its wear rows, every hat and pair of glasses shown in
   the row but locked. The face, colour, ink, light, fur and
   motion live in the Studio. */

/* What a locked choice says on hover: the note PgTabs gives the choices
   past `open`. */
const PRO_NOTE = "Available with Pro plan";

const STATE_OPTIONS = [
  { value: "default", label: "Idle" },
  { value: "working", label: "Working" },
  /* Sleeping ships with the paid plan, so the tab is here but locked. */
  { value: "sleeping", label: "Sleeping", locked: PRO_NOTE },
] as const;

/* Fabric, the plush fur, is the library's default and plastic the glossy
   look of 0.1; the other three are the Studio's, locked in the row. */
const SHADING_OPTIONS = [
  { value: "fabric", label: "Fabric" },
  { value: "plastic", label: "Plastic" },
  { value: "crisp", label: "Crisp", locked: PRO_NOTE },
  { value: "smooth", label: "Smooth", locked: PRO_NOTE },
  { value: "flat", label: "Flat", locked: PRO_NOTE },
] as const;

/* Things to wear are the Studio's too: every choice shows in its row,
   locked, and None is the only one open — so the rows always read None
   and change nothing on the stage. */
const HAT_OPTIONS = [
  { value: "none", label: "None" },
  { value: "beret", label: "Beret", locked: PRO_NOTE },
  { value: "beanie", label: "Beanie", locked: PRO_NOTE },
  { value: "party", label: "Party", locked: PRO_NOTE },
  { value: "crown", label: "Crown", locked: PRO_NOTE },
] as const;
const GLASSES_OPTIONS = [
  { value: "none", label: "None" },
  { value: "round", label: "Round", locked: PRO_NOTE },
  { value: "square", label: "Square", locked: PRO_NOTE },
] as const;
/* None is already picked, so a click on it has nothing to change. */
const keepNone = () => {};

/* The Studio's colour row opens on the palette's own colours, in type
   order, so the teaser's does too: clover's first. */
const TEASER_COLORS = botAvatarTypes
  .map((t) => botAvatarPresets[t].color)
  .filter((c, i, all) => all.indexOf(c) === i)
  .slice(0, 5);

const SIZE_OPTIONS = [
  { value: "96", label: "96px" },
  { value: "64", label: "64px" },
  { value: "32", label: "32px" },
] as const;
type Size = (typeof SIZE_OPTIONS)[number]["value"];

/* The eight the playground opens; the other ten sit behind the paywall,
   shown but locked under a fade. */
const TEAM: BotAvatarType[] = ["clover", "flower", "star", "ghost", "mech", "circle", "hexagon", "square"];

/* The team row at the top: five of them, large, idle, and pleased to be
   hovered. */
const ROW: BotAvatarType[] = ["clover", "flower", "star", "ghost", "square"];
/* the square wears the palette's pink here, so the row has one blue */
const ROW_COLOR: Partial<Record<BotAvatarType, string>> = { square: botAvatarPresets.puddle.color };

const TYPE_OPTIONS = [...TEAM, ...botAvatarTypes.filter((t) => !TEAM.includes(t))].map((t) => ({
  value: t,
  label: botAvatarPresets[t].label,
}));


type Offset = { x: number; y: number };

function Team() {
  const [hot, setHot] = useState<BotAvatarType | null>(null);
  /* Dev only: with Arrange on, a seat can be dragged anywhere in the row
     for a shot. The offsets are a transform on top of the layout, so
     nothing reflows and Reset drops them. */
  const arrange = useDemoFlag("arrange");
  const resets = useDemoReset();
  const [moved, setMoved] = useState<Partial<Record<BotAvatarType, Offset>>>({});
  const grab = useRef<{ type: BotAvatarType; x: number; y: number; from: Offset } | null>(null);

  useEffect(() => {
    setMoved({});
  }, [resets]);

  return (
    <div className="ex-avatars-team" data-arrange={arrange ? "true" : undefined}>
      {ROW.map((t) => {
        const at = moved[t] ?? { x: 0, y: 0 };
        return (
          <span
            className="ex-avatars-seat"
            key={t}
            style={at.x || at.y ? { transform: `translate(${at.x}px, ${at.y}px)` } : undefined}
            onPointerEnter={() => !arrange && setHot(t)}
            onPointerLeave={() => setHot((h) => (h === t ? null : h))}
            onPointerDown={(e) => {
              if (!arrange) return;
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              grab.current = { type: t, x: e.clientX, y: e.clientY, from: at };
            }}
            onPointerMove={(e) => {
              const g = grab.current;
              if (!g || g.type !== t) return;
              const x = g.from.x + (e.clientX - g.x);
              const y = g.from.y + (e.clientY - g.y);
              setMoved((m) => ({ ...m, [t]: { x, y } }));
            }}
            onPointerUp={(e) => {
              if (grab.current?.type !== t) return;
              e.currentTarget.releasePointerCapture(e.pointerId);
              grab.current = null;
            }}
            onPointerCancel={() => {
              grab.current = null;
            }}
          >
            <BotAvatar
              type={t}
              color={ROW_COLOR[t]}
              state={hot === t ? "working" : "default"}
              size={96}
              interactive={!arrange}
            />
            <span className="ex-avatars-name">{botAvatarPresets[t].label}</span>
          </span>
        );
      })}
    </div>
  );
}

function AvatarsPlayground() {
  const [type, setType] = useState<BotAvatarType>("clover");
  const [state, setState] = useState<BotAvatarState>("default");
  const [size, setSize] = useState<Size>("96");
  const [shading, setShading] = useState<BotAvatarShading>("fabric");
  /* Paused on arrival, like every other library's stage: the pose shows,
     the motion waits for Play. The examples above run on their own. */
  const [paused, setPaused] = useState(true);

  /* Live snippet: only non-default props survive. */
  const props = [`type="${type}"`];
  if (state !== "default") props.push(`state="${state}"`);
  if (size !== "64") props.push(`size={${size}}`);
  if (shading !== "fabric") props.push(`shading="${shading}"`);
  if (paused) props.push("paused");
  const snippet = `import { BotAvatar } from 'bot-avatars';\n\n<BotAvatar ${props.join(" ")} />`;

  return (
    <>
      {/* The library introducing itself first: the whole team, then the
          avatars at work in real UI, before any knobs. */}
      <div className="detail-examples">
        <div className="example-row-full example-row-full--team">
          <Team />
        </div>
        <div className="example-row-split example-row-split--avatars">
          <div className="example-cell">
            <BotRoster />
          </div>
          <div className="example-cell">
            <BotChat />
          </div>
        </div>
      </div>

      <p className="detail-playground-label">Playground</p>

      <div className="pg">
        <div className="pg-stage" id="playground-stage">
          <BotAvatar type={type} state={state} size={Number(size)} shading={shading} paused={paused} />
          <button
            type="button"
            className="btn-animate pg-play"
            onClick={() => setPaused((p) => !p)}
            aria-pressed={!paused}
          >
            {paused ? "Play" : "Pause"}
          </button>
        </div>

        <div className="pg-controls" id="playground-controls">
          <PgTabs label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} open={TEAM.length} />
          <PgTabs label="State" options={STATE_OPTIONS} value={state} onChange={setState} />
          <PgTabs label="Size" options={SIZE_OPTIONS} value={size} onChange={setSize} />
          <PgTabs label="Shading" options={SHADING_OPTIONS} value={shading} onChange={setShading} />
          <PgTabs label="Hat" options={HAT_OPTIONS} value="none" onChange={keepNone} />
          <PgTabs label="Glasses" options={GLASSES_OPTIONS} value="none" onChange={keepNone} />
          {/* The Studio's other knobs at clover's and fabric's defaults, as
              the Studio shows them: values and fills in its own units and
              ranges. */}
          <StudioTeaser
            rows={[
              { kind: "slider", label: "Fur length", value: "100%", fill: 32 },
              { kind: "swatches", label: "Color", colors: TEASER_COLORS },
              { kind: "slider", label: "Brightness", value: "120%", fill: 70 },
              { kind: "slider", label: "Saturation", value: "159%", fill: 55 },
              { kind: "swatches", label: "Ink", colors: ["#1F1B2E", "#F6F4F0", "#35B8FF", "#DC48FF"] },
              { kind: "slider", label: "Shadow", value: "115%", fill: 58 },
              { kind: "slider", label: "Back light", value: "60%", fill: 30 },
              { kind: "slider", label: "Sheen", value: "0%", fill: 0 },
              { kind: "slider", label: "Depth", value: "65%", fill: 25 },
              { kind: "slider", label: "Edge fuzz", value: "90%", fill: 90 },
              { kind: "slider", label: "Speed", value: "1×", fill: 27 },
            ]}
          />
        </div>
      </div>

      <CodeBlock code={snippet} label="Copy playground code" className="pg-snippet" />

      {/* localhost / ?dev only: strip the cards and the labels for a shot */}
      <DemoDevPanel />
    </>
  );
}

const rootEl = document.getElementById("playground-root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <AvatarsPlayground />
    </StrictMode>
  );
}
