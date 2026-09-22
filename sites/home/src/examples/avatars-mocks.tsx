import { useEffect, useRef, useState } from "react";
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

/* The answer, word by word: transitions.dev's Streaming text. Every word
   is a span that rests visible; the effect wipes them all with the
   transition off, flushes one reflow, then resolves them in order
   through opacity and a small blur, one every --stream-gap. */
const REPLY =
  "They only sign annual, Dana approves, and pricing is the same thread as last quarter. I answered without waiting on you.";

function StreamedReply() {
  const words = REPLY.trim().split(/\s+/);
  const spansRef = useRef<Array<HTMLSpanElement | null>>([]);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const spans = spansRef.current.filter(Boolean) as HTMLSpanElement[];
    if (!spans.length) return;

    /* back to nothing, without animating the wipe itself */
    spans.forEach((el) => {
      el.style.transition = "none";
      el.classList.remove("is-in");
    });
    void spans[0].offsetWidth;
    spans.forEach((el) => {
      el.style.transition = "";
    });

    const gap =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--stream-gap")) || 60;
    const next = (n: number) => {
      if (n >= spans.length) return;
      spans[n].classList.add("is-in");
      timer.current = window.setTimeout(() => next(n + 1), gap);
    };
    next(0);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <p className="mock-thread-reply t-stream">
      {words.map((w, i) => (
        <span
          key={i}
          ref={(el) => {
            spansRef.current[i] = el;
          }}
          className="t-stream-w is-in"
        >
          {w}
          {i < words.length - 1 ? " " : ""}
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
        {/* The answer's own box, always: a hidden copy holds the height
            while the bot thinks, so neither the avatar nor the bubble
            above it moves when the reply arrives. */}
        <div className="mock-thread-body">
          <p className="mock-thread-reply mock-thread-ghost" aria-hidden="true">
            {REPLY}
          </p>
          <div className="mock-thread-live">
            {thinking ? (
              <span className="t-shimmer" data-text="Thinking…">Thinking…</span>
            ) : (
              <StreamedReply />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
