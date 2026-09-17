/// <reference types="vite/client" />
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BeamStudio } from "./beam";
import { OrbStudio } from "./orb";
import { GooeyStudio } from "./gooey";
import { MetalStudio } from "./metal";
import { ImageStudio } from "./image";
import { VoiceStudio } from "./voice";
import { StudioThemeContext } from "./controls";

/* Studio app — Pro-gated workbench for all five libraries.

   Gate: three states driven by the Pro client (same contract as
   /studio.html): (a) auth unresolved -> skeleton, (b) resolved without
   entitlement -> locked hero, (c) entitled -> the workbench.
   pro-client.js dispatches "pro:me" after every /me resolution and once
   early from its optimistic cache. `?dev` unlocks locally so the app can
   be developed without the API Worker.

   GATE_ENABLED is the switch. It was off while the Studio was open to
   everyone (before the API Worker that answers /me was deployed); now
   the Studio is Pro-only. Flip it to false to open the workbench to
   everyone again: /me entitlement still drives the "Get Pro" chip either
   way, so nothing else has to change. */

const GATE_ENABLED = true;

type GateState = "pending" | "locked" | "open";

interface ProState {
  authenticated?: boolean;
  email?: string | null;
  pro?: boolean;
  resolved?: boolean;
}

declare global {
  interface Window {
    LibrariesPro?: {
      state: ProState;
      apiBase?: string;
      signIn?: () => void;
      refresh?: () => void;
      logout?: (allDevices?: boolean) => Promise<unknown>;
      presets?: {
        list: (library: string) => Promise<{ presets?: Array<{ name: string; values: unknown; updated_at: number }>; error?: string }>;
        save: (library: string, name: string, values: unknown) => Promise<{ ok?: boolean; error?: string }>;
        remove: (library: string, name: string) => Promise<{ ok?: boolean; error?: string }>;
      };
    };
  }
}

/* `?dev` opens the gate on a local dev server only, so the Studio can be
   worked on without the API Worker; on the live site the flag is inert. */
const DEV_UNLOCK =
  new URLSearchParams(window.location.search).has("dev") &&
  /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);

function useProGate(): { gate: GateState; email: string | null; entitled: boolean } {
  const gateOff = !GATE_ENABLED || DEV_UNLOCK;
  const [gate, setGate] = useState<GateState>(gateOff ? "open" : "pending");
  const [email, setEmail] = useState<string | null>(null);
  const [entitled, setEntitled] = useState(false);

  useEffect(() => {
    /* Sticky gate: once we've left the skeleton, an unresolved /me
       re-dispatch (network retry, tab un-freeze) must not drop the app
       back to the skeleton; only the fallback below may still run. */
    let settled = false;
    const render = (s: ProState | undefined) => {
      const isPro = !!(s && s.pro);
      const resolved = !!(s && s.resolved);
      if (s && typeof s.email === "string") setEmail(s.email);
      setEntitled(isPro);
      /* With the gate off the workbench is already showing — /me still
         runs, but only to fill in the email and the "Get Pro" chip. */
      if (gateOff) return;
      /* Only an answered /me opens the gate: the optimistic localStorage
         cache paints the chrome early but is the visitor's to edit, so it
         may not unlock the workbench on its own. */
      if (!resolved) return;
      settled = true;
      setGate(isPro ? "open" : "locked");
    };

    const onMe = (e: Event) => render((e as CustomEvent<ProState>).detail);
    document.addEventListener("pro:me", onMe);
    render(window.LibrariesPro?.state);

    /* /me unreachable (e.g. the API Worker isn't deployed): don't strand
       visitors on the skeleton — fall through to the locked hero. */
    const fallback = window.setTimeout(() => {
      const s = window.LibrariesPro?.state;
      if (!settled && !(s && s.resolved)) render({ resolved: true, pro: false });
    }, 4000);

    return () => {
      document.removeEventListener("pro:me", onMe);
      window.clearTimeout(fallback);
    };
  }, [gateOff]);

  return { gate, email, entitled };
}

/* ── Chrome pieces ─────────────────────────────────────────────── */

/* Signed-in avatar + dropdown, in the 3-dot button's nav position
   (Figma 1425:38996). The Studio is Pro-gated, so whenever the workbench
   shows there is a signed-in user — the avatar renders whenever an email
   is known. Same tl-menu / t-dropdown classes as the site nav menu. */
/* Feedback from the avatar menu — the site's ⋮-menu page (site.js) done
   in React: page two of the menu behind a back button, a message, an
   optional address (the signed-in one filled in), sent to the API with
   the mailto fallback. */
const FEEDBACK_API = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname) ? "http://localhost:8787" : "https://api.libraries.dev";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MenuChevron = () => (
  <span className="tl-menu-chevr" aria-hidden="true">
    <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(8,8) rotate(-90) translate(-3.75,-2.25)"><path fillRule="evenodd" clipRule="evenodd" d="M0.21967 0.21967C0.512563 -0.0732233 0.987437 -0.0732233 1.28033 0.21967L3.75 2.68934L6.21967 0.21967C6.51256 -0.0732233 6.98744 -0.0732233 7.28033 0.21967C7.57322 0.512563 7.57322 0.987437 7.28033 1.28033L4.28033 4.28033C3.98744 4.57322 3.51256 4.57322 3.21967 4.28033L0.21967 1.28033C-0.0732233 0.987437 -0.0732233 0.512563 0.21967 0.21967Z" fill="currentColor"/></g></svg>
  </span>
);

function FeedbackPage({ email, onBack, onSent }: { email: string; onBack: () => void; onSent: () => void }) {
  const [message, setMessage] = useState("");
  const [address, setAddress] = useState(email.includes("@") ? email : "");
  const [note, setNote] = useState<{ kind: "ok" | "err"; html: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [shake, setShake] = useState<"message" | "email" | null>(null);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  const send = () => {
    if (sending) return;
    const text = message.trim();
    if (!text) {
      setShake("message");
      setNote({ kind: "err", html: "Write a few words first." });
      messageRef.current?.focus();
      return;
    }
    const addr = address.trim();
    if (addr && !EMAIL_RE.test(addr)) {
      setShake("email");
      setNote({ kind: "err", html: "That email doesn't look right." });
      emailRef.current?.focus();
      return;
    }
    setSending(true);
    setNote(null);
    fetch(FEEDBACK_API + "/feedback", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, page: window.location.href, email: addr || undefined }),
    })
      .then((r) => { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
      .then(() => {
        setMessage("");
        setNote({ kind: "ok", html: "Sent. Thank you!" });
        window.setTimeout(onSent, 1400);
      })
      .catch(() => {
        const subject = encodeURIComponent("Feedback on Libraries.dev");
        const body = encodeURIComponent(text + "\n\nFrom " + window.location.href);
        setNote({ kind: "err", html: `Could not send. <a href="mailto:jakubja@gmail.com?subject=${subject}&body=${body}">Email it instead</a>.` });
      })
      .then(() => setSending(false));
  };

  const errClass = (which: "message" | "email") =>
    (note?.kind === "err" && shake === which ? " is-error" : "") + (shake === which ? " is-shaking" : "");

  return (
    <>
      <button type="button" className="tl-set-back" onClick={onBack}>
        <span className="tl-set-back-ic" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><g transform="translate(8,8) rotate(-90) translate(-3.75,-2.25)"><path fillRule="evenodd" clipRule="evenodd" d="M0.21967 0.21967C0.512563 -0.0732233 0.987437 -0.0732233 1.28033 0.21967L3.75 2.68934L6.21967 0.21967C6.51256 -0.0732233 6.98744 -0.0732233 7.28033 0.21967C7.57322 0.512563 7.57322 0.987437 7.28033 1.28033L4.28033 4.28033C3.98744 4.57322 3.51256 4.57322 3.21967 4.28033L0.21967 1.28033C-0.0732233 0.987437 -0.0732233 0.512563 0.21967 0.21967Z" fill="currentColor"/></g></svg>
        </span>
        <span className="tl-set-back-title">Feedback</span>
      </button>
      <div className="tl-menu-divider" />
      <form className="pm-feedback" noValidate onSubmit={(e) => { e.preventDefault(); send(); }}>
        <textarea
          ref={messageRef}
          className={`pm-feedback-input${errClass("message")}`}
          rows={6}
          maxLength={2000}
          placeholder="Share your feedback, idea or comment"
          aria-label="Your feedback"
          value={message}
          onChange={(e) => { setMessage(e.target.value); if (note?.kind === "err") setNote(null); setShake(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          onAnimationEnd={() => setShake(null)}
        />
        <input
          ref={emailRef}
          type="email"
          className={`pm-feedback-email${errClass("email")}`}
          maxLength={200}
          placeholder="Email (optional)"
          aria-label="Your email (optional)"
          autoComplete="email"
          spellCheck={false}
          value={address}
          onChange={(e) => { setAddress(e.target.value); if (note?.kind === "err") setNote(null); setShake(null); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
          onAnimationEnd={() => setShake(null)}
        />
        {note && <p className="pm-feedback-note" role="status" data-kind={note.kind} dangerouslySetInnerHTML={{ __html: note.html }} />}
        <button type="submit" className="pm-feedback-btn" disabled={sending}>{sending ? "Sending…" : "Send feedback"}</button>
      </form>
    </>
  );
}

function AvatarMenu({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [page, setPage] = useState<"1" | "2">("1");
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const slideRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const close = () => {
    setOpen(false);
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => { setClosing(false); setPage("1"); }, 150);
  };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  /* The slide's height follows the active page (site.js does the same). */
  useLayoutEffect(() => {
    const slide = slideRef.current;
    if (!slide) return;
    const sync = () => {
      const active = slide.querySelector<HTMLElement>(`.t-page[data-page-id="${page}"]`);
      if (active) slide.style.height = active.offsetHeight + "px";
    };
    sync();
    const ro = new ResizeObserver(sync);
    slide.querySelectorAll<HTMLElement>(".t-page").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [page, open]);

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  const onSignOut = () => {
    close();
    const LP = window.LibrariesPro;
    if (LP && typeof LP.logout === "function") {
      LP.logout().then(() => {
        window.location.href = "/studio.html";
      });
    } else {
      window.location.href = "/studio.html";
    }
  };
  const openFeedback = () => setPage("2");

  return (
    <div className="pm-anchor" ref={anchorRef}>
      <button
        type="button"
        className="icon-btn icon-btn--avatar"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          open ? close() : setOpen(true);
        }}
      >
        <span className="nav-avatar-initial" aria-hidden="true">{email.charAt(0)}</span>
      </button>
      <div
        className={`tl-menu t-dropdown${open ? " is-open" : ""}${closing ? " is-closing" : ""}${page === "2" ? " is-feedback" : ""}`}
        data-origin="top-right"
        role="menu"
        aria-label="Account"
      >
        <div className="tl-set-slide" data-page={page} ref={slideRef}>
          <div className="t-page" data-page-id="1">
            <a className="tl-menu-item" href="/account.html" role="menuitem">
              <span className="tl-menu-item-label">Account</span>
            </a>
            <div className="tl-menu-item" role="menuitem" tabIndex={0} onClick={onSignOut} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onSignOut(); }}>
              <span className="tl-menu-item-label">Sign out</span>
            </div>
            <div className="tl-menu-divider" />
            <div className="tl-menu-item" role="menuitem" tabIndex={0} onClick={openFeedback} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFeedback(); } }}>
              <span className="tl-menu-item-label">Feedback</span>
              <span className="tl-menu-trail"><MenuChevron /></span>
            </div>
            <a className="tl-menu-item" href="mailto:jakubja@gmail.com" role="menuitem">
              <span className="tl-menu-item-label">Support</span>
            </a>
          </div>
          <div className="t-page" data-page-id="2">
            {page === "2" && <FeedbackPage email={email} onBack={() => setPage("1")} onSent={close} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* Studio theme. The rest of the site is dark-only; this app lets the user
   flip to light so a preview can be judged on the surface it will ship on.
   The choice is stored under ldev:studio-theme and re-applied before first
   paint by the inline script in app.html. */
type StudioTheme = "dark" | "light";
const THEME_KEY = "ldev:studio-theme";

function readTheme(): StudioTheme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch (e) {
    /* private mode — fall through to the document's own attribute */
  }
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function useStudioTheme(): [StudioTheme, () => void] {
  const [theme, setTheme] = useState<StudioTheme>(readTheme);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (e) {
      /* nothing to persist to — the in-page state still holds */
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "dark" ? "light" : "dark"));
  return [theme, toggle];
}

/* Dev only (`?dev` on localhost): a top-bar toggle that drops the fill of
   the stage cards the examples sit on, so a mock can be judged on the bare
   ground. Stored under ldev:studio-stage-fill ("off"); flips the root's
   data-stage-fill, which the Studio's CSS reads. */
const STAGE_FILL_KEY = "ldev:studio-stage-fill";

function StageFillToggle() {
  const [filled, setFilled] = useState(() => {
    try {
      return localStorage.getItem(STAGE_FILL_KEY) !== "off";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (filled) document.documentElement.removeAttribute("data-stage-fill");
    else document.documentElement.setAttribute("data-stage-fill", "off");
    try {
      if (filled) localStorage.removeItem(STAGE_FILL_KEY);
      else localStorage.setItem(STAGE_FILL_KEY, "off");
    } catch {
      /* storage may be unavailable; the attribute still applies */
    }
  }, [filled]);
  return (
    <button
      type="button"
      className="st-dev-btn"
      aria-pressed={filled}
      title="Dev: toggle the stage cards' fill"
      onClick={() => setFilled((f) => !f)}
    >
      Fill
    </button>
  );
}

function TopBar({ email, pro }: { email: string | null; pro: boolean }) {
  return (
    <div className="st-top">
      <div className="st-top-left">
        <a className="brand" href="/studio.html" aria-label="Back to the Studio page">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 22.6705 14.6705" fill="none" xmlns="http://www.w3.org/2000/svg">
              {/* brand-draw + pathLength drive the hover redraw in site.css —
                  without them the mark is inert here but animates elsewhere. */}
              <path className="brand-draw" d="M21.3352 10.3354L6.89079 13.3354L18.0019 7.33536L1.33524 9.33536L19.3352 1.33536L1.33524 4.33536L9.33524 1.33536" stroke="currentColor" strokeWidth="2.67" strokeLinecap="round" strokeLinejoin="round" pathLength={100} />
            </svg>
          </span>
          <span className="brand-word"><span className="brand-word-strong">Libraries</span><span className="brand-word-dim">.dev</span></span>
        </a>
        <span className="st-top-sep" aria-hidden="true" />
        <span className="st-top-name">
          Studio <span className="st-top-chip">Pro</span>
        </span>
      </div>
      {/* The address itself belongs on the account page — here the avatar
          (and its Account item) is the identity. */}
      <div className="st-top-right">
        {DEV_UNLOCK && <StageFillToggle />}
        {/* TEMP: signed-out fallback initial so the avatar is visible for
            testing before the auth Worker is deployed. */}
        <AvatarMenu email={email ?? "j"} />
      </div>
    </div>
  );
}

const LIBS = [
  { id: "beam", label: "Border beam", icon: "/assets/icons/figma-beam.png" },
  { id: "orb", label: "Thinking orbs", icon: "/assets/icons/figma-orbs.svg" },
  { id: "gooey", label: "Gooey", icon: "/assets/icons/figma-gooey.svg" },
  { id: "metal", label: "Metal", icon: "/assets/icons/figma-metal.png" },
  { id: "image", label: "Image", icon: "/assets/icons/figma-image.png" },
  { id: "voice", label: "Voice", icon: "/assets/icons/figma-voice.png" },
  ...Object.values(
    import.meta.glob<{ bench: PrivateBench }>("./private/*.tsx", { eager: true })
  ).map((m) => m.bench),
];

/* A bench kept out of the repo: any module in ./private (untracked, see
   .gitignore) that exports `bench` joins the sidebar after the five. */
interface PrivateBench {
  id: string;
  label: string;
  icon: string;
  Component: (props: { visible: boolean; theme: StudioTheme }) => JSX.Element;
}

type LibId = string;

function Workbench({ theme }: { theme: StudioTheme }) {
  const [lib, setLib] = useState<LibId>(() => {
    const wanted = window.location.hash.replace("#", "");
    return (LIBS.some((l) => l.id === wanted) ? wanted : "gooey") as LibId;
  });

  /* Deep-linkable: #beam .. #image select the library. */
  useEffect(() => {
    const onHash = () => {
      const wanted = window.location.hash.replace("#", "");
      if (LIBS.some((l) => l.id === wanted)) setLib(wanted as LibId);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = (id: LibId) => {
    setLib(id);
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <div className="st-body">
      <nav className="st-side" aria-label="Libraries">
        <span className="st-side-label">Libraries</span>
        {LIBS.map((l) => (
          <button
            key={l.id}
            type="button"
            className="st-lib"
            data-active={lib === l.id ? "true" : undefined}
            aria-pressed={lib === l.id}
            onClick={() => select(l.id)}
          >
            <span className="st-lib-ico" aria-hidden="true">
              <img src={l.icon} alt="" draggable={false} />
            </span>
            {l.label}
          </button>
        ))}
      </nav>

      {/* All benches stay mounted so tuning survives switching; the hidden
          ones render no stage content (WebGL / canvas / rAF all stop). */}
      <div className="st-main">
        <div hidden={lib !== "beam"}><BeamStudio visible={lib === "beam"} theme={theme} /></div>
        <div hidden={lib !== "orb"}><OrbStudio visible={lib === "orb"} theme={theme} /></div>
        <div hidden={lib !== "gooey"}><GooeyStudio visible={lib === "gooey"} theme={theme} /></div>
        <div hidden={lib !== "metal"}><MetalStudio visible={lib === "metal"} theme={theme} /></div>
        <div hidden={lib !== "image"}><ImageStudio visible={lib === "image"} theme={theme} /></div>
        <div hidden={lib !== "voice"}><VoiceStudio visible={lib === "voice"} theme={theme} /></div>
        {LIBS.map((l) =>
          "Component" in l ? (
            <div key={l.id} hidden={lib !== l.id}><l.Component visible={lib === l.id} theme={theme} /></div>
          ) : null
        )}
      </div>
    </div>
  );
}

/* ── Gate screens ──────────────────────────────────────────────── */

/* The loading state is the workbench itself, unpainted: same sidebar, stage
   bar, stage, controls panel and snippet, in the same grid — so the layout
   does not jump when the real thing arrives. Structure is shared with the
   pre-React markup in app.html; keep the two in step. */
function Skeleton() {
  return (
    <div className="st-body st-skeleton" aria-hidden="true">
      <div className="st-side">
        <span className="sk sk-side-label" />
        {LIBS.map((l) => (
          <span className="sk sk-lib" key={l.id} />
        ))}
      </div>
      <div className="st-main">
        <div className="pg">
          <div className="st-stage-bar" data-view="preview">
            <span className="sk sk-tabs" />
            <span className="st-stage-actions">
              <span className="sk sk-preset" />
              <span className="sk sk-icon-sm" />
              <span className="sk sk-prompt" />
            </span>
          </div>
          <div className="pg-stage" />
          <div className="pg-controls">
            <div className="st-panel-head">
              <span className="sk sk-tabs" />
              <span className="sk sk-icon" />
            </div>
            <div className="st-panel-body">
              {[3, 4, 3].map((rows, i) => (
                <div className="sk-section" key={i}>
                  <span className="sk sk-label" />
                  {Array.from({ length: rows }, (_, r) => (
                    <span className="sk sk-field" key={r} />
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="code-block pg-snippet">
            <span className="sk sk-code" />
            <span className="sk sk-code" />
            <span className="sk sk-code" />
          </div>
        </div>
      </div>
    </div>
  );
}

function Locked() {
  const onSignIn = () => {
    const LP = window.LibrariesPro;
    if (LP && typeof LP.signIn === "function") LP.signIn();
    else window.location.href = "/pro.html";
  };
  return (
    <div className="st-gate">
      <div className="st-locked">
        <span className="st-lock-glyph" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="10.5" width="16" height="10" rx="3" />
            <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
          </svg>
        </span>
        <h1 className="st-locked-title">The Studio is a Pro feature</h1>
        <p className="st-locked-sub">
          Deep customization of all five libraries: Beam, Orb, Gooey, Metal
          and Image. Tune every parameter live, preview the result, and export
          the exact configuration for your project. Get Libraries Pro to
          unlock it, or sign in if you already have access.
        </p>
        <div className="skill-cta-row">
          <a className="skill-btn skill-btn--primary" href="/pro.html">Get Pro</a>
          <button type="button" className="skill-btn skill-btn--secondary" onClick={onSignIn}>Sign in</button>
        </div>
      </div>
    </div>
  );
}

/* The workbench is a three-column layout of live canvases and dense
   controls; it has no phone form. Below this width an entitled user gets a
   notice instead of a squeezed workbench. Same breakpoint at which the
   library pages drop their "Tune in Studio" button. */
const DESKTOP_ONLY_QUERY = "(max-width: 900px)";

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia(DESKTOP_ONLY_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_ONLY_QUERY);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

function DesktopOnly() {
  return (
    <div className="st-gate">
      <div className="st-locked">
        <span className="st-lock-glyph" aria-hidden="true">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4.5" width="18" height="12" rx="2.5" />
            <path d="M9 20h6M12 16.5V20" />
          </svg>
        </span>
        <h1 className="st-locked-title">Sorry, the Studio is desktop only</h1>
        <p className="st-locked-sub">
          The workbench lays out live previews next to a full column of
          controls, and that needs a wide screen. Open this page on a laptop
          or desktop to tune the libraries — your Pro access and saved
          presets are already waiting there.
        </p>
        <div className="skill-cta-row">
          <a className="skill-btn skill-btn--primary" href="/">Browse the libraries</a>
        </div>
      </div>
    </div>
  );
}

function StudioApp() {
  const { gate, email, entitled } = useProGate();
  const [theme, toggleTheme] = useStudioTheme();
  const narrow = useIsNarrow();
  return (
    <StudioThemeContext.Provider value={{ theme, toggle: toggleTheme }}>
      <div className="st-app">
        <TopBar email={email} pro={entitled} />
        {gate === "pending" && <Skeleton />}
        {gate === "locked" && <Locked />}
        {gate === "open" && (narrow ? <DesktopOnly /> : <Workbench theme={theme} />)}
      </div>
    </StudioThemeContext.Provider>
  );
}

const rootEl = document.getElementById("studio-root");
if (rootEl) {
  createRoot(rootEl).render(
    /* No StrictMode: metal-fx v1 keeps one shared renderer, and the
       simulated double-mount destroys it in a state its loop never
       recovers from — everything paints one frame and freezes. The
       detail page mounts without StrictMode for the same reason. */
    <StudioApp />
  );
}
