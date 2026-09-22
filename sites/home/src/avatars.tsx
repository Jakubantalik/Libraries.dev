import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BotAvatar, botAvatarPresets, botAvatarTypes, type BotAvatarState, type BotAvatarType } from "bot-avatars";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser } from "./examples/StudioTeaser";
import { BotRoster, BotChat } from "./examples/avatars-mocks";
import { PgTabs } from "./examples/PgTabs";
import { DemoDevPanel } from "./examples/DemoDevPanel";

/* Bot avatars detail page — one React island rendering the examples, the
   playground (stage + controls) and the live-updating snippet below it.
   Controls are the Studio's first knobs — type, state — plus the size;
   the face, colour, ink, speed and shading live in the Studio. */

const STATE_OPTIONS = [
  { value: "default", label: "Idle" },
  { value: "working", label: "Working" },
  /* Sleeping ships with the paid plan, so the tab is here but locked. */
  { value: "sleeping", label: "Sleeping", locked: "Available with Pro plan" },
] as const;

const SIZE_OPTIONS = [
  { value: "96", label: "96px" },
  { value: "64", label: "64px" },
  { value: "32", label: "32px" },
] as const;
type Size = (typeof SIZE_OPTIONS)[number]["value"];

/* The team: eight of the eighteen — one of each kind of shape and colour,
   idle, and pleased to be hovered. */
const TEAM: BotAvatarType[] = ["clover", "flower", "star", "ghost", "mech", "circle", "hexagon", "square"];

/* The playground offers the same eight the page shows above; the other
   ten sit behind the paywall, shown but locked under a fade. */
const TYPE_OPTIONS = [...TEAM, ...botAvatarTypes.filter((t) => !TEAM.includes(t))].map((t) => ({
  value: t,
  label: botAvatarPresets[t].label,
}));


function Team() {
  const [hot, setHot] = useState<BotAvatarType | null>(null);
  return (
    <div className="ex-avatars-team">
      {TEAM.map((t) => (
        <span
          className="ex-avatars-seat"
          key={t}
          onPointerEnter={() => setHot(t)}
          onPointerLeave={() => setHot((h) => (h === t ? null : h))}
        >
          <BotAvatar type={t} state={hot === t ? "working" : "default"} size={64} />
          <span className="ex-avatars-name">{botAvatarPresets[t].label}</span>
        </span>
      ))}
    </div>
  );
}

function AvatarsPlayground() {
  const [type, setType] = useState<BotAvatarType>("clover");
  const [state, setState] = useState<BotAvatarState>("default");
  const [size, setSize] = useState<Size>("96");
  /* Paused on arrival, like every other library's stage: the pose shows,
     the motion waits for Play. The examples above run on their own. */
  const [paused, setPaused] = useState(true);

  /* Live snippet: only non-default props survive. */
  const props = [`type="${type}"`];
  if (state !== "default") props.push(`state="${state}"`);
  if (size !== "64") props.push(`size={${size}}`);
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
          <BotAvatar type={type} state={state} size={Number(size)} paused={paused} />
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
          <StudioTeaser
            rows={[
              { kind: "swatches", label: "Color", colors: ["#35B8FF", "#FF7AB8", "#DC48FF", "#2FCB7A", "#FFD32B"] },
              { kind: "slider", label: "Brightness", value: "100%", fill: 50 },
              { kind: "slider", label: "Saturation", value: "100%", fill: 50 },
              { kind: "swatches", label: "Ink", colors: ["#1E1A33", "#F7F5F2", "#35B8FF"] },
              { kind: "slider", label: "Speed", value: "1×", fill: 33 },
              { kind: "tabs", label: "Shading", options: ["Plastic", "Crisp", "Smooth", "Flat"] },
              { kind: "slider", label: "Shadow", value: "35%", fill: 17 },
              { kind: "slider", label: "Depth", value: "65%", fill: 25 },
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
