/* Studio agent — browser half of the tuning chat.
 *
 * Talks to POST /studio/chat on the Pro Worker (services/studio-agent holds
 * the route). The server runs the model's tool loop and streams back three
 * kinds of event: prose deltas, validated parameter patches, and a final
 * done/error. Patches arrive as they are made, so the preview moves while
 * the sentence explaining it is still arriving.
 */

export interface AgentEventHandlers {
  onText: (delta: string) => void;
  onParams: (patch: Record<string, unknown>) => void;
}

export interface AgentTurnResult {
  /** Every parameter the turn ended up changing, merged in order. */
  patch: Record<string, unknown>;
  turnsRemaining?: number;
}

export class AgentError extends Error {
  constructor(
    message: string,
    /** Machine-readable when it came from the route's JSON error body. */
    readonly code?: string
  ) {
    super(message);
    this.name = "AgentError";
  }
}

/* Session lives on a .libraries.dev cookie, so the Studio must send
   credentials the same way pro-client.js does. Falling back to the
   production host keeps the chat working on a page that loaded without
   pro-client.js, and localhost:8787 is the Worker's dev port. */
function apiBase(): string {
  const injected = window.LibrariesPro?.apiBase;
  if (injected) return injected;
  return /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? "http://localhost:8787"
    : "https://api.libraries.dev";
}

const MESSAGES: Record<string, string> = {
  not_authenticated: "Sign in to your Libraries Pro account to use the agent.",
  pro_required: "The Studio agent is a Pro feature.",
  turn_cap_reached:
    "You've hit this month's agent limit. Manual control still works, and the limit resets next month.",
  user_budget_exhausted:
    "You've used this month's agent credits. Manual control still works, and your credits reset next month.",
  lifetime_credit_used:
    "You've used the agent credit that comes with Lifetime. Manual control and everything else in the Studio still work; a Pro subscription adds a monthly agent allowance.",
  budget_exhausted:
    "The agent is paused for the rest of this month. Manual control still works — nothing you tuned is lost.",
  unknown_library: "The agent doesn't know this library yet.",
};

export interface ChatTurn {
  role: "user" | "agent";
  text: string;
}

export async function streamAgentTurn(
  args: {
    library: string;
    params: Record<string, unknown>;
    messages: ChatTurn[];
    /** The library's stock core source, when its core can be rebuilt. */
    coreSource?: string;
    /** Why the last rebuilt core failed in the browser, if it did. */
    coreError?: string;
    /** false = the user opted out of anonymous prompt analytics. */
    analytics?: boolean;
    signal?: AbortSignal;
  },
  handlers: AgentEventHandlers
): Promise<AgentTurnResult> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}/studio/chat`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        library: args.library,
        params: args.params,
        messages: args.messages,
        coreSource: args.coreSource,
        coreError: args.coreError,
        analytics: args.analytics,
      }),
      signal: args.signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") throw err;
    throw new AgentError("Couldn't reach the agent. Check your connection and try again.");
  }

  if (!response.ok || !response.body) {
    /* Error responses are JSON, not SSE. */
    const body = await response.json().catch(() => ({}) as { error?: string });
    const code = (body as { error?: string }).error;
    throw new AgentError(
      (code && MESSAGES[code]) ?? "The agent is unavailable right now.",
      code
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const merged: Record<string, unknown> = {};
  let turnsRemaining: number | undefined;
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    /* Frames are "data: {...}\n\n". A partial frame stays in the buffer
       until its terminator arrives. */
    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const frame = buffer.slice(0, split).trim();
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf("\n\n");

      if (!frame.startsWith("data:")) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(frame.slice(5).trim());
      } catch {
        continue;
      }

      if (event.type === "text") {
        handlers.onText(String(event.text ?? ""));
      } else if (event.type === "params") {
        const patch = (event.patch ?? {}) as Record<string, unknown>;
        Object.assign(merged, patch);
        handlers.onParams(patch);
      } else if (event.type === "done") {
        const remaining = (event as { turnsRemaining?: number }).turnsRemaining;
        if (typeof remaining === "number") turnsRemaining = remaining;
      } else if (event.type === "error") {
        throw new AgentError(String(event.message ?? "The agent hit an error."));
      }
    }
  }

  return { patch: merged, turnsRemaining };
}

/** "duration 1.96 → 3.2" — the applied-change line shown in the transcript. */
export function describePatch(
  patch: Record<string, unknown>,
  before: Record<string, unknown>,
  labels: Record<string, string>
): string {
  return Object.entries(patch)
    .map(([key, value]) => {
      const name = labels[key] ?? key;
      /* The core is source, not a value: name the move, not the text. */
      if (key === "core") return value === "" ? "Core restored to stock" : "Core rebuilt";
      const from = before[key];
      const fmt = (v: unknown) => (typeof v === "number" ? String(Number(v.toFixed(2))) : String(v));
      return from === undefined || from === value
        ? `${name} ${fmt(value)}`
        : `${name} ${fmt(from)} → ${fmt(value)}`;
    })
    .join(" · ");
}
