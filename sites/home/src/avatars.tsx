import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BotAvatar, botAvatarPresets, botAvatarTypes, type BotAvatarState, type BotAvatarType } from "bot-avatars";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser } from "./examples/StudioTeaser";
import { BotRoster, BotChat } from "./examples/avatars-mocks";

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

function PgTabs<T extends string>({
  label,
  options,
  value,
  onChange,
  open,
}: {
  label: string;
  /* `locked` is the note the option shows instead of being selectable. */
  options: ReadonlyArray<{ value: T; label: string; locked?: string }>;
  value: T;
  onChange: (v: T) => void;
  /* How many of the options this plan opens. The rest are shown behind
     the same fade the Studio teaser uses, as a taste of what is there. */
  open?: number;
}) {
  const live = open === undefined ? options : options.slice(0, open);
  const behind = open === undefined ? [] : options.slice(open);
  return (
    <div className="pg-field" role="radiogroup" aria-label={label}>
      <span className="pg-label">{label}</span>
      <div className="pg-tabs">
        {live.map((o) => (
          /* A locked option keeps the button — `disabled` would take it out
             of the tab order and, in some browsers, stop the hover that
             reveals the note — and turns the click away instead. */
          <button
            key={o.value}
            type="button"
            className="pg-tab"
            role="radio"
            aria-checked={value === o.value}
            aria-disabled={o.locked ? true : undefined}
            aria-describedby={o.locked ? `${label}-${o.value}-note` : undefined}
            data-active={value === o.value ? "true" : undefined}
            data-locked={o.locked ? "true" : undefined}
            onClick={() => {
              if (o.locked) return;
              onChange(o.value);
            }}
          >
            {/* The dimming rides the label, not the button: on the button
                it would take the note down with it. */}
            <span className="pg-tab-label">{o.label}</span>
            {o.locked ? (
              <span className="pg-lock-note" id={`${label}-${o.value}-note`} role="tooltip">
                {o.locked}
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {behind.length > 0 ? (
        /* Presentation only: static markup, out of the tab order and out
           of the reader, dimmed under a fade to the panel. */
        <div className="pg-tabs-behind" aria-hidden="true">
          {/* the clip lives on the inner layer so the note, which sits on
              the block itself, isn't cut off with the last row */}
          <div className="pg-tabs-behind-clip">
            <div className="pg-tabs">
              {behind.map((o) => (
                <div className="pg-tab" key={o.value}>
                  <span className="pg-tab-label">{o.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="pg-tabs-scrim" />
          <span className="pg-lock-note pg-lock-note--block">Available with Pro plan</span>
        </div>
      ) : null}
    </div>
  );
}

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
