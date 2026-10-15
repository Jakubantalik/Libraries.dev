/* Local-only Worker for developing the Studio agent.
 *
 * api.libraries.dev does not exist yet, and the prompt is the part of this
 * feature actually worth testing. This stands the route up on its own at
 * localhost:8787 — the port the Studio already falls back to on localhost —
 * so the chat can talk to a real model today, with no Stripe, no sessions
 * and nothing deployed.
 *
 *   npm install
 *   cp .dev.vars.example .dev.vars   # paste your key into it
 *   npx wrangler dev
 *
 * When the real Pro Worker exists, this directory is deleted and
 * handleStudioChat is mounted there with its genuine session resolver.
 */

import { handleStudioChat, type Env } from "../handler";

/* Every caller is treated as a signed-in Pro user. This is the entire
   reason this file must never be deployed: it has no authentication. */
const STUB_SESSION = { userId: "local-dev", pro: true };

/* The Vite dev server picks its own port when 5173 is taken, so the exact
   origin isn't known ahead of time. Any localhost origin is echoed back —
   `credentials: "include"` forbids the `*` wildcard, and this Worker is
   never reachable from anywhere but this machine. */
function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!allowed) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "vary": "Origin",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request);
    const url = new URL(request.url);

    // Preflight: the JSON content-type on the chat POST triggers one.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (url.pathname === "/studio/chat" && request.method === "POST") {
      if (!env.ANTHROPIC_API_KEY) {
        return new Response(
          JSON.stringify({ error: "no_api_key" }),
          { status: 500, headers: { "content-type": "application/json", ...cors } }
        );
      }
      const response = await handleStudioChat(request, env, async () => STUB_SESSION);
      /* handleStudioChat returns a streaming body; re-wrap rather than
         mutate, since a Response's headers are immutable once built. */
      const headers = new Headers(response.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(response.body, { status: response.status, headers });
    }

    // The site's Feedback form posts here in local dev; the production
    // route (libraries-pro API) mails it on. Here it is only logged.
    if (url.pathname === "/feedback" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      console.log("[feedback:dev]", JSON.stringify(body));
      return new Response(JSON.stringify({ ok: true, dev: true }), {
        status: 200,
        headers: { ...cors, "content-type": "application/json" },
      });
    }
    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({ ok: true, hasKey: !!env.ANTHROPIC_API_KEY }),
        { headers: { "content-type": "application/json", ...cors } }
      );
    }

    return new Response("studio-agent dev worker", { status: 404, headers: cors });
  },
};
