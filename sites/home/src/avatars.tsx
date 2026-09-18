import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BotAvatar, botAvatarPresets, botAvatarTypes, type BotAvatarFace, type BotAvatarState, type BotAvatarType } from "bot-avatars";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser } from "./examples/StudioTeaser";
import { BotRoster, BotChat } from "./examples/avatars-mocks";

/* Bot avatars detail page — one React island rendering the examples, the
   playground (stage + controls) and the live-updating snippet below it.
   Controls mirror the Studio's first three knobs — type, face, state —
   plus the size; colour, ink, speed and shading live in the Studio. */

const FACE_OPTIONS = [
  { value: "eyes", label: "Eyes" },
  { value: "mouth", label: "Mouth" },
] as const;

const STATE_OPTIONS = [
  { value: "default", label: "Idle" },
  { value: "thinking", label: "Thinking" },
  { value: "happy", label: "Happy" },
  { value: "sleeping", label: "Sleeping" },
] as const;

const SIZE_OPTIONS = [
  { value: "96", label: "96px" },
  { value: "64", label: "64px" },
  { value: "32", label: "32px" },
] as const;
type Size = (typeof SIZE_OPTIONS)[number]["value"];

const TYPE_OPTIONS = botAvatarTypes.map((t) => ({ value: t, label: botAvatarPresets[t].label }));

function PgTabs<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="pg-field" role="radiogroup" aria-label={label}>
      <span className="pg-label">{label}</span>
      <div className="pg-tabs">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className="pg-tab"
            role="radio"
            aria-checked={value === o.value}
            data-active={value === o.value ? "true" : undefined}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* The team: every type in its own face, idle, and pleased to be hovered. */
function Team() {
  const [hot, setHot] = useState<BotAvatarType | null>(null);
  return (
    <div className="ex-avatars-team">
      {botAvatarTypes.map((t) => (
        <span
          className="ex-avatars-seat"
          key={t}
          onPointerEnter={() => setHot(t)}
          onPointerLeave={() => setHot((h) => (h === t ? null : h))}
        >
          <BotAvatar type={t} state={hot === t ? "happy" : "default"} size={64} />
          <span className="ex-avatars-name">{botAvatarPresets[t].label}</span>
        </span>
      ))}
    </div>
  );
}

function AvatarsPlayground() {
  const [type, setType] = useState<BotAvatarType>("clover");
  /* The face follows the type's own until one is picked. */
  const [face, setFace] = useState<BotAvatarFace | null>(null);
  const [state, setState] = useState<BotAvatarState>("default");
  const [size, setSize] = useState<Size>("96");
  /* Paused on arrival, like every other library's stage: the pose shows,
     the motion waits for Play. The examples above run on their own. */
  const [paused, setPaused] = useState(true);

  const ownFace = botAvatarPresets[type].face;
  const shownFace = face ?? ownFace;

  /* Live snippet: only non-default props survive. */
  const props = [`type="${type}"`];
  if (face && face !== ownFace) props.push(`face="${face}"`);
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
          <BotAvatar type={type} face={shownFace} state={state} size={Number(size)} paused={paused} />
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
          <PgTabs label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} />
          <PgTabs label="Face" options={FACE_OPTIONS} value={shownFace} onChange={setFace} />
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
