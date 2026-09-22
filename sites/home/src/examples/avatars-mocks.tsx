import { useEffect, useState } from "react";
import { BotAvatar, type BotAvatarState, type BotAvatarType } from "bot-avatars";

/* Mocks for the Bot avatars detail page: a roster of agents, each in its
   own state, and a chat thread whose bot thinks, then answers. */

interface Bot {
  type: BotAvatarType;
  name: string;
  state: BotAvatarState;
  status: string;
}

const ROSTER: Bot[] = [
  { type: "clover", name: "Chief", state: "working", status: "Booking the venue…" },
  { type: "star", name: "Inbox manager", state: "default", status: "Inbox at zero, 5 drafts parked" },
  { type: "flower", name: "Talent scout", state: "default", status: "3 intros drafted in your voice" },
  { type: "ghost", name: "Night shift", state: "sleeping", status: "Back at 9:00" },
];

/* The agent list: avatar, name and what each one is up to. The working
   row's status shimmers, the way the orb pills do. */
export function BotRoster() {
  return (
    <div className="mock-bots" aria-label="Agents">
      <div className="mock-bots-head">Bots</div>
      {ROSTER.map((b) => (
        <div className="mock-bots-row" key={b.name}>
          <BotAvatar type={b.type} state={b.state} size={36} />
          <span className="mock-bots-text">
            <span className="mock-bots-name">{b.name}</span>
            {b.state === "working" ? (
              <span className="mock-bots-status t-shimmer" data-text={b.status}>{b.status}</span>
            ) : (
              <span className="mock-bots-status">{b.status}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/* The answer, word by word: transitions.dev's texts reveal (18) with one
   line per word, so the reply arrives the way a streamed one does — each
   word rising out of its blur a beat behind the last. */
const REPLY =
  "They only sign annual, Dana approves, and pricing is the same thread as last quarter. I answered without waiting on you.";

function StreamedReply() {
  const [shown, setShown] = useState(false);
  /* a frame after mounting, so the words start from their offset rather
     than arriving already in place */
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <p className={`mock-thread-reply t-stagger${shown ? " is-shown" : ""}`}>
      {REPLY.split(" ").map((word, i) => (
        <span key={i}>
          <span className="t-stagger-line" style={{ transitionDelay: `calc(var(--stagger-stagger) * ${i})` }}>
            {word}
          </span>{" "}
        </span>
      ))}
    </p>
  );
}

/* The thread: a question, then the bot works on it and settles with the
   answer — on a loop, so the transitions between states can be watched. */
const CYCLE: Array<{ state: BotAvatarState; ms: number }> = [
  { state: "working", ms: 2600 },
  { state: "default", ms: 3200 },
];

export function BotChat({ paused = false }: { paused?: boolean }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => setStep((s) => (s + 1) % CYCLE.length), CYCLE[step].ms);
    return () => window.clearTimeout(t);
  }, [step, paused]);
  const state = CYCLE[step].state;
  const thinking = state === "working";
  return (
    <div className="mock-thread" aria-label="Chat">
      <div className="mock-thread-user">Can you summarise the thread with Acme?</div>
      <div className="mock-thread-bot">
        <BotAvatar type="clover" state={state} size={32} paused={paused} />
        <div className="mock-thread-body">
          {thinking ? (
            <span className="t-shimmer" data-text="Thinking…">Thinking…</span>
          ) : (
            <StreamedReply />
          )}
        </div>
      </div>
    </div>
  );
}
