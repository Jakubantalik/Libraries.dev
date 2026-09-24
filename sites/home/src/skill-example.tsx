import { createRoot } from "react-dom/client";
import { BorderBeam } from "border-beam";
import { MetalBadge } from "metal-fx";
import { ThinkingOrb } from "thinking-orbs";
import { BotAvatar } from "bot-avatars";

/* The skill page's hero compare: prototypes from the skill demo page
   (skill-demo.html, Figma 1635:1035) — a prompt input, a "New" badge, a
   Get Pro button, a planning status and an assistant row. `?style=generic`
   renders them with the stock effect a generic AI agent writes (a
   breathing glow, a flat badge, Tailwind's ping, a border spinner, an
   emoji on a gradient circle); the default
   renders what the Libraries.dev skill uses for the same spots. The
   components and their styling are the demo page's, so the two panes
   differ only in the effect. */

const GENERIC = new URLSearchParams(location.search).get("style") === "generic";

function PromptForm() {
  return (
    <form className="sd-input" onSubmit={(e) => e.preventDefault()}>
      <input className="sd-input-field" placeholder="Build anything..." aria-label="What should the agent build?" />
      <button type="submit" className="sd-input-send" aria-label="Send">
        <img src="/assets/icons/arrow-up-16.svg" width={16} height={16} alt="" draggable={false} />
      </button>
    </form>
  );
}

function AgentText() {
  return (
    <div className="sd-agent-text">
      <p>Personal assistant</p>
      <p className="t-shimmer" data-text="Booking the venue…">Booking the venue…</p>
    </div>
  );
}

function WithSkill() {
  return (
    <div className="sx-card">
      <div className="sx-col">
        <BorderBeam size="md" theme="dark" className="sd-beam">
          <PromptForm />
        </BorderBeam>
        <div className="sd-studio">
          <span className="sd-studio-label">Studio app</span>
          {/* 0.88 × the Figma's 45×25 badge: 22px tall. */}
          <MetalBadge theme="dark" scale={0.88}>New</MetalBadge>
        </div>
        <BorderBeam size="pulse-inner" theme="dark" strength={0.8} className="sd-beam">
          <button type="button" className="sd-btn">Get Pro</button>
        </BorderBeam>
        <div className="sd-status">
          {/* Sizes are 64 / 32 / 20 presets; the 32 drawn at 24px stays crisp. */}
          <ThinkingOrb state="connecting" size={32} theme="dark" style={{ width: 24, height: 24 }} />
          <span className="t-shimmer" data-text="Planning next steps">Planning next steps</span>
        </div>
        <div className="sd-agent">
          <BotAvatar type="triangle" state="default" size={48} theme="dark" />
          <AgentText />
        </div>
      </div>
    </div>
  );
}

function Generic() {
  return (
    <div className="sx-card">
      <div className="sx-col">
        <div className="gx-input-glow">
          <PromptForm />
        </div>
        <div className="sd-studio">
          <span className="sd-studio-label">Studio app</span>
          <span className="gx-badge">New</span>
        </div>
        <button type="button" className="sd-btn gx-ping">Get Pro</button>
        <div className="sd-status">
          <span className="gx-spinner" aria-hidden="true" />
          <span className="t-shimmer" data-text="Planning next steps">Planning next steps</span>
        </div>
        <div className="sd-agent">
          <span className="gx-avatar" aria-hidden="true">🤖</span>
          <AgentText />
        </div>
      </div>
    </div>
  );
}

const el = document.getElementById("skill-example-root");
if (el) {
  /* No StrictMode: metal-fx keeps one shared renderer, and the simulated
     double mount leaves its loop frozen (see metal.tsx). */
  createRoot(el).render(GENERIC ? <Generic /> : <WithSkill />);
}
