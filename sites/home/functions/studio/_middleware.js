/* Server-side gate for the Studio app.

   The workbench's own gate runs in the browser, which makes it a courtesy:
   anyone can edit the page's scripts or storage. This Pages Function runs at
   the edge before the HTML is served, so the app shell never reaches a
   visitor the API does not vouch for. It asks the same /me the client uses,
   forwarding the visitor's session cookie; only an answered "pro" lets the
   request through. Anything else, including an API that does not answer,
   sends the visitor to the Studio page, which sells the offer and signs
   people in. Failing closed is the point: the Studio is Pro-only. */

const API_ORIGIN = "https://api.libraries.dev";
/* The clean URL: Pages answers /studio.html with a 308 to it anyway, so
   bouncing straight there saves the visitor a hop. */
const STUDIO_PAGE = "/studio";
const GATED = new Set(["/studio/app", "/studio/app.html"]);

/** @type {import("@cloudflare/workers-types").PagesFunction<{ API_ORIGIN?: string }>} */
export const onRequest = async (context) => {
  const { request, next, env } = context;
  const url = new URL(request.url);
  if (!GATED.has(url.pathname)) return next();

  const cookie = request.headers.get("Cookie") || "";
  const bounce = () => {
    const to = new URL(STUDIO_PAGE, url);
    const res = Response.redirect(to.toString(), 302);
    const headers = new Headers(res.headers);
    headers.set("cache-control", "no-store");
    return new Response(null, { status: 302, headers });
  };

  if (!/(?:^|;\s*)lp_session=/.test(cookie)) return bounce();

  /** @type {{ authenticated?: boolean, entitlements?: { pro?: boolean } } | null} */
  let me = null;
  /** @type {string | null} */
  let renewed = null;
  try {
    const r = await fetch(`${env.API_ORIGIN || API_ORIGIN}/me`, {
      headers: { Cookie: cookie, Accept: "application/json" },
      cf: { cacheTtl: 0 },
    });
    if (r.ok) {
      me = await r.json();
      renewed = r.headers.get("set-cookie");
    }
  } catch {
    me = null;
  }

  if (!(me && me.authenticated && me.entitlements && me.entitlements.pro)) return bounce();

  const res = await next();
  const headers = new Headers(res.headers);
  /* The gated shell must never be served from a cache to the next visitor. */
  headers.set("cache-control", "no-store");
  /* /me may have extended the session; pass the fresh cookie along so the
     renewal reaches the browser exactly as it would from a client call. */
  if (renewed) headers.append("set-cookie", renewed);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
};
