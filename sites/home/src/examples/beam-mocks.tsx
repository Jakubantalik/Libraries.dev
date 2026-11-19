import { useCallback, useId, useLayoutEffect, useRef } from "react";

/* The Beam demo page's mock UI, verbatim from sites/beam/src/mocks.tsx so
   the detail page shows exactly what that page shows. Presentational and
   class-driven; the styling lives in assets/examples.css. */

export function AtSignIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M10.4 5.59963V8.59962C10.4 9.07701 10.5896 9.53485 10.9272 9.87242C11.2648 10.21 11.7226 10.3996 12.2 10.3996C12.6774 10.3996 13.1352 10.21 13.4728 9.87242C13.8104 9.53485 14 9.07701 14 8.59962V7.99962C13.9999 6.64544 13.5417 5.33111 12.7 4.27035C11.8582 3.20958 10.6823 2.46476 9.36359 2.15701C8.04484 1.84925 6.66076 1.99665 5.43641 2.57525C4.21206 3.15384 3.21944 4.1296 2.61996 5.34386C2.02048 6.55812 1.84939 7.93947 2.13451 9.26329C2.41963 10.5871 3.14419 11.7756 4.19038 12.6354C5.23657 13.4952 6.54286 13.9758 7.89684 13.9991C9.25083 14.0224 10.5729 13.587 11.648 12.7636M10.4 7.99962C10.4 9.32511 9.32549 10.3996 8 10.3996C6.67452 10.3996 5.6 9.32511 5.6 7.99962C5.6 6.67414 6.67452 5.59963 8 5.59963C9.32549 5.59963 10.4 6.67414 10.4 7.99962Z"
        stroke="#808388"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronDownIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ transform: 'rotate(90deg)' }}>
      <path d="M7 11L10 8L7 5" stroke="#8B9099" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </svg>
  );
}

export function ArrowUpIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M8 12.6667V3.33333M12.6667 8L8 3.33333L3.33333 8" stroke="#8B8B8B" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TaskCircleIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 17.5 17.5" fill="none">
      <circle cx="8.75" cy="8.75" r="8" stroke="#818181" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="3 3" />
    </svg>
  );
}

export function SearchIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export function MockChatInput() {
  return (
    <div className="mock-chat" role="img" aria-label="Chat input UI example with border beam effect">
      <div className="mock-chat-inner">
        <div className="pill">
          <AtSignIcon />
        </div>
        <div className="placeholder">Build anything...</div>
        <div className="bottom-row">
          <div className="tag">
            Agent
            <ChevronDownIcon />
          </div>
          <div className="tag">
            Auto
            <ChevronDownIcon />
          </div>
          <div className="send-btn">
            <ArrowUpIcon />
          </div>
        </div>
      </div>
    </div>
  );
}

export const WORKING_TASKS = [
  'Generate color palettes',
  'Recommend font pairings',
  'Create layout templates',
  'Build section engine',
  'Generate hero variants',
];

export function MockWorkingCard() {
  return (
    <div className="mock-working" role="img" aria-label="Agent task list UI example with border beam effect">
      <div className="mock-working-header t-shimmer" data-text="Working...">Working...</div>
      <div className="mock-working-list">
        {WORKING_TASKS.map((task) => (
          <div className="mock-working-row" key={task}>
            <TaskCircleIcon />
            <span>{task}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MockSubscribeButton() {
  return (
    <div className="mock-subscribe" role="img" aria-label="Subscribe button UI example with border beam effect">
      Subscribe
    </div>
  );
}

export function MockIconButton() {
  return (
    <div className="mock-icon-btn" role="img" aria-label="Icon button UI example with border beam effect">
      <div className="mock-icon-btn-square" />
    </div>
  );
}

export function MockSearchBar() {
  return (
    <div className="mock-search" role="img" aria-label="Search bar UI example with border beam effect">
      <div className="mock-search-inner">
        <SearchIcon />
        <span>Search</span>
      </div>
    </div>
  );
}

/* Studio chat input (Figma 1561:44249 dark, 1567:44998 light), shared by
   the chat benches: the prompt,
   an add button on the left and the Agent chip, mic and close on the
   right. Icons are masked spans so each theme sets their colour; the
   plus and close glyphs are CSS bars (the Figma export collapsed them). */
/** The voice-mode glyph — four rounded bars, the start button's icon once
    voice mode is closed. Takes the button's text colour. */
export function VoiceStartIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {[[2.5, 6.5, 3], [6, 4, 8], [9.5, 2.5, 11], [13, 5.5, 5]].map(([x, y, h]) => (
        <rect key={x} x={x - 0.9} y={y} width={1.8} height={h} rx={0.9} fill="currentColor" />
      ))}
    </svg>
  );
}

/* ── Gooey merge: the mic folds into the close button ──
   Closing voice mode, the mic pours into the × and the two settle as the
   start button; opening, the mic squeezes back out. Timing is the Gooey
   PlusMenu prototype's (sites/home/src/studio/gooey.tsx MORPH_DEFAULTS):
   open 550ms Bouncy, close 250ms Snappy, the close anticipation — the
   liquid and the button it lands in nudge 5px along the incoming momentum
   and settle, peak at 30% of 700ms — and its icon fades (in 180ms after
   120ms, out 120ms). Its goo too: blur 6, contrast 18.

   For the length of the move the two fills are drawn as one liquid: solid
   blobs through an SVG goo filter, recoloured to the button's own fill
   and opacity, with the button's own box-shadow rebuilt as filter passes
   on the merged silhouette (as liquid-gooey does), so the edge light and
   drop follow the neck. The real buttons go see-through meanwhile and
   carry the icons on the same transforms. */

const GOO = {
  openMs: 550,
  closeMs: 250,
  bouncy: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  snappy: "cubic-bezier(0.22, 1, 0.36, 1)",
  anticipPx: 5,
  anticipMs: 700,
  iconInMs: 180,
  iconInDelay: 120,
  iconOutMs: 120,
  swapMs: 250,
  blur: 6,
  contrast: 18,
};

type GooRefs = {
  host: React.RefObject<HTMLDivElement>;
  mic: React.RefObject<HTMLElement>;
  close: React.RefObject<HTMLButtonElement>;
  blobs: React.RefObject<HTMLDivElement>;
  filter: React.RefObject<SVGFilterElement>;
  frost: React.RefObject<HTMLDivElement>;
};

/** The merged silhouette of two circles as one clip path: both circles
    plus a metaball bridge (Sato's construction) that thins to nothing at
    the distance where the goo filter lets go, so a single frost layer can
    follow the liquid without the two buttons' frost edges crossing. All
    subpaths run clockwise, so the nonzero union has no holes. */
function metaballPath(ax: number, ay: number, ar: number, bx: number, by: number, br: number, release: number): string {
  const circle = (x: number, y: number, r: number) =>
    `M${x + r} ${y}A${r} ${r} 0 1 1 ${x - r} ${y}A${r} ${r} 0 1 1 ${x + r} ${y}Z`;
  let out = circle(ax, ay, ar) + circle(bx, by, br);
  const d = Math.hypot(bx - ax, by - ay);
  const maxD = ar + br + release;
  if (d >= maxD || d <= Math.abs(ar - br) + 0.5) return out;
  const u1 = d < ar + br ? Math.acos((ar * ar + d * d - br * br) / (2 * ar * d)) : 0;
  const u2 = d < ar + br ? Math.acos((br * br + d * d - ar * ar) / (2 * br * d)) : 0;
  const between = Math.atan2(by - ay, bx - ax);
  const spread = Math.acos(Math.max(-1, Math.min(1, (ar - br) / d)));
  // 0.5 is the classic neck; it closes to 1 (no neck) as the gap opens.
  const v = 0.5 + 0.5 * Math.max(0, Math.min(1, (d - ar - br) / release));
  const a1 = between + u1 + (spread - u1) * v;
  const a2 = between - u1 - (spread - u1) * v;
  const a3 = between + Math.PI - u2 - (Math.PI - u2 - spread) * v;
  const a4 = between - Math.PI + u2 + (Math.PI - u2 - spread) * v;
  const at = (x: number, y: number, a: number, r: number) => [x + r * Math.cos(a), y + r * Math.sin(a)];
  const p1 = at(ax, ay, a1, ar), p2 = at(ax, ay, a2, ar), p3 = at(bx, by, a3, br), p4 = at(bx, by, a4, br);
  const k = Math.min(1.2, Math.hypot(p1[0] - p3[0], p1[1] - p3[1]) / (ar + br)) * Math.min(1, (d * 2) / (ar + br));
  const h1 = at(p1[0], p1[1], a1 - Math.PI / 2, ar * k), h2 = at(p2[0], p2[1], a2 + Math.PI / 2, ar * k);
  const h3 = at(p3[0], p3[1], a3 + Math.PI / 2, br * k), h4 = at(p4[0], p4[1], a4 - Math.PI / 2, br * k);
  const pts = [p1, p3, p4, p2];
  let area = 0;
  for (let i = 0; i < 4; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % 4]; area += x0 * y1 - x1 * y0; }
  const f = (q: number[]) => `${q[0].toFixed(2)} ${q[1].toFixed(2)}`;
  out += area >= 0
    ? `M${f(p1)}C${f(h1)} ${f(h3)} ${f(p3)}L${f(p4)}C${f(h4)} ${f(h2)} ${f(p2)}Z`
    : `M${f(p2)}C${f(h2)} ${f(h4)} ${f(p4)}L${f(p3)}C${f(h3)} ${f(h1)} ${f(p1)}Z`;
  return out;
}

type ShadowLayer = { x: number; y: number; blur: number; spread: number; color: string; inset: boolean };

/** Computed `box-shadow` → layers (colour may sit anywhere in a layer). */
function parseBoxShadow(input: string): ShadowLayer[] {
  if (!input || input === "none") return [];
  const split = (str: string, comma: boolean) => {
    const out: string[] = [];
    let depth = 0, cur = "";
    for (const ch of str) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      if (depth === 0 && (comma ? ch === "," : /\s/.test(ch))) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  return split(input, true).map((layer) => {
    const tokens = split(layer, false);
    const nums: number[] = [];
    const color: string[] = [];
    for (const tk of tokens) {
      if (tk === "inset") continue;
      if (nums.length < 4 && /^[+-]?(\d+\.?\d*|\.\d+)(px)?$/.test(tk)) nums.push(parseFloat(tk));
      else color.push(tk);
    }
    const [x = 0, y = 0, blur = 0, spread = 0] = nums;
    return { x, y, blur, spread, color: color.join(" ") || "rgba(0,0,0,0.35)", inset: tokens.includes("inset") };
  });
}

/** The goo chain: blur → alpha threshold (the silhouette, in the button's
    fill colour and opacity), then each box-shadow layer as a pass on the
    binarized silhouette — outer drops clipped off the shape (CSS paints
    none under the box), insets clipped inside it. */
function gooFilterMarkup(fill: string, shadow: string): string {
  const m = fill.match(/rgba?\(([^)]+)\)/);
  const [r, g, b, a = 1] = m ? m[1].split(/[\s,/]+/).filter(Boolean).map(Number) : [255, 255, 255, 0.1];
  const intercept = Math.round((0.5 - GOO.contrast * (5 / 12)) * 100) / 100;
  const out: string[] = [
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${GOO.blur}" result="blur"/>`,
    `<feColorMatrix in="blur" type="matrix" values="0 0 0 0 ${r / 255} 0 0 0 0 ${g / 255} 0 0 0 0 ${b / 255} 0 0 0 ${GOO.contrast} ${intercept}" result="goo"/>`,
    `<feColorMatrix in="goo" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 60 -29.5" result="bin"/>`,
    `<feColorMatrix in="bin" type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 ${a} 0" result="fill"/>`,
  ];
  const layers = parseBoxShadow(shadow);
  layers.forEach((s, i) => {
    let src = "bin";
    const esc = s.color.replace(/"/g, "");
    if (s.inset) {
      if (s.spread) { out.push(`<feMorphology in="${src}" operator="${s.spread > 0 ? "erode" : "dilate"}" radius="${Math.abs(s.spread)}" result="s${i}e"/>`); src = `s${i}e`; }
      if (s.x || s.y) { out.push(`<feOffset in="${src}" dx="${s.x}" dy="${s.y}" result="s${i}o"/>`); src = `s${i}o`; }
      if (s.blur) { out.push(`<feGaussianBlur in="${src}" stdDeviation="${s.blur / 2}" result="s${i}b"/>`); src = `s${i}b`; }
      out.push(
        `<feComposite in="bin" in2="${src}" operator="out" result="s${i}band"/>`,
        `<feFlood flood-color="${esc}" result="s${i}c"/>`,
        `<feComposite in="s${i}c" in2="s${i}band" operator="in" result="s${i}"/>`,
      );
    } else {
      if (s.spread) { out.push(`<feMorphology in="${src}" operator="${s.spread > 0 ? "dilate" : "erode"}" radius="${Math.abs(s.spread)}" result="s${i}e"/>`); src = `s${i}e`; }
      if (s.blur) { out.push(`<feGaussianBlur in="${src}" stdDeviation="${s.blur / 2}" result="s${i}b"/>`); src = `s${i}b`; }
      if (s.x || s.y) { out.push(`<feOffset in="${src}" dx="${s.x}" dy="${s.y}" result="s${i}o"/>`); src = `s${i}o`; }
      out.push(
        `<feFlood flood-color="${esc}" result="s${i}c"/>`,
        `<feComposite in="s${i}c" in2="${src}" operator="in" result="s${i}t"/>`,
        `<feComposite in="s${i}t" in2="bin" operator="out" result="s${i}"/>`,
      );
    }
  });
  // CSS stacking: the first listed shadow on top; outer ones under the
  // fill, insets over it.
  const outer = layers.map((s, i) => (s.inset ? -1 : i)).filter((i) => i >= 0).reverse();
  const inner = layers.map((s, i) => (s.inset ? i : -1)).filter((i) => i >= 0).reverse();
  out.push(
    "<feMerge>",
    ...outer.map((i) => `<feMergeNode in="s${i}"/>`),
    `<feMergeNode in="fill"/>`,
    ...inner.map((i) => `<feMergeNode in="s${i}"/>`),
    "</feMerge>",
  );
  return out.join("");
}

export function useGooMerge(closed: boolean): GooRefs & { filterId: string } {
  const host = useRef<HTMLDivElement>(null);
  const mic = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const blobs = useRef<HTMLDivElement>(null);
  const filter = useRef<SVGFilterElement>(null);
  const frost = useRef<HTMLDivElement>(null);
  const frostRaf = useRef(0);
  const filterId = "mock-goo-" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const running = useRef<Animation[]>([]);
  const first = useRef(true);

  useLayoutEffect(() => {
    if (first.current) { first.current = false; return; }
    const h = host.current, m = mic.current, c = close.current, b = blobs.current, f = filter.current, fr = frost.current;
    if (!h || !m || !c || !b || !f || !fr) return;
    running.current.forEach((a) => a.cancel());
    running.current = [];
    cancelAnimationFrame(frostRaf.current);
    h.removeAttribute("data-goo");
    if (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    // The liquid takes the button's own fill and shadow, read while the
    // buttons still show them (before data-goo clears them).
    const cs = getComputedStyle(c);
    f.innerHTML = gooFilterMarkup(cs.backgroundColor, cs.boxShadow);
    // The frost (pixel looks) moves off the buttons onto one layer under
    // the liquid, clipped to the merged shape each frame: two frosted
    // circles would show each other's edges, and a frost above the liquid
    // would blur its hairline away.
    const frostValue = cs.backdropFilter && cs.backdropFilter !== "none" ? cs.backdropFilter : "";
    fr.style.backdropFilter = frostValue;
    fr.style.setProperty("-webkit-backdrop-filter", frostValue);

    // Layout boxes (offsets ignore the phone's scale and any press scale).
    const pad = 24;
    const [mb, cb] = Array.from(b.children) as HTMLElement[];
    const place = (blob: HTMLElement, el: HTMLElement) => {
      blob.style.left = `${el.offsetLeft + pad}px`;
      blob.style.top = `${el.offsetTop + pad}px`;
      blob.style.width = `${el.offsetWidth}px`;
      blob.style.height = `${el.offsetHeight}px`;
    };
    place(mb, m);
    place(cb, c);
    const dx = c.offsetLeft + c.offsetWidth / 2 - (m.offsetLeft + m.offsetWidth / 2);
    const tx = (x: number) => ({ transform: `translateX(${x}px)` });
    const hidden = { opacity: 0, filter: "blur(2px)", transform: "scale(0.5)" };
    const shown = { opacity: 1, filter: "blur(0px)", transform: "scale(1)" };
    const xIcon = c.querySelector('[data-icon="x"]');
    const startIcon = c.querySelector('[data-icon="start"]');

    h.setAttribute("data-goo", "");
    const go = (el: Element | null | undefined, kf: Keyframe[], o: KeyframeAnimationOptions) => {
      if (el) running.current.push(el.animate(kf, o));
    };
    if (closed) {
      // Held at the × until the anticipation settles, so the merged mic
      // stays inside the liquid rather than snapping back to its slot.
      const travel: KeyframeAnimationOptions = { duration: GOO.closeMs, easing: GOO.snappy, fill: "forwards" };
      go(m, [tx(0), tx(dx)], travel);
      go(mb, [tx(0), tx(dx)], travel);
      go(m.firstElementChild, [{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(2px)" }], { duration: GOO.iconOutMs, easing: "ease", fill: "forwards" });
      // Anticipation: the liquid and the button it lands in nudge along
      // the incoming momentum and settle (each segment Snappy, as in CSS).
      const nudge: Keyframe[] = [
        { offset: 0, transform: "translateX(0px)", easing: GOO.snappy },
        { offset: 0.3, transform: `translateX(${GOO.anticipPx}px)`, easing: GOO.snappy },
        { offset: 1, transform: "translateX(0px)" },
      ];
      go(b, nudge, { duration: GOO.anticipMs });
      go(c, nudge, { duration: GOO.anticipMs });
      go(xIcon, [shown, hidden], { duration: GOO.swapMs, easing: "ease-in-out", fill: "forwards" });
      go(startIcon, [hidden, shown], { duration: GOO.swapMs, easing: "ease-in-out" });
    } else {
      const travel = { duration: GOO.openMs, easing: GOO.bouncy };
      go(m, [tx(dx), tx(0)], travel);
      go(mb, [tx(dx), tx(0)], travel);
      go(m.firstElementChild, [{ opacity: 0, filter: "blur(2px)" }, { opacity: 1, filter: "blur(0px)" }], { duration: GOO.iconInMs, delay: GOO.iconInDelay, easing: "ease", fill: "backwards" });
      go(startIcon, [shown, hidden], { duration: GOO.swapMs, easing: "ease-in-out", fill: "forwards" });
      go(xIcon, [hidden, shown], { duration: GOO.swapMs, easing: "ease-in-out" });
    }
    const mine = running.current;
    if (frostValue) {
      const [mbl, cbl] = [mb, cb];
      const tick = () => {
        const box = fr.getBoundingClientRect();
        const k = box.width / (fr.offsetWidth || 1); // the phone's scale
        const ra = mbl.getBoundingClientRect(), rb = cbl.getBoundingClientRect();
        const ar = Math.min(ra.width, ra.height) / 2 / k, br = Math.min(rb.width, rb.height) / 2 / k;
        fr.style.clipPath = `path("${metaballPath(
          (ra.x + ra.width / 2 - box.x) / k, (ra.y + ra.height / 2 - box.y) / k, ar,
          (rb.x + rb.width / 2 - box.x) / k, (rb.y + rb.height / 2 - box.y) / k, br,
          // Where blur 6 / contrast 18 lets go, ~8px at a 36px button.
          8 * (ar / 18),
        )}")`;
        if (running.current === mine) frostRaf.current = requestAnimationFrame(tick);
      };
      tick();
    }
    Promise.all(mine.map((a) => a.finished)).then(() => {
      if (running.current !== mine) return;
      cancelAnimationFrame(frostRaf.current);
      h.removeAttribute("data-goo");
      // Drop the held icon fades so the static data-closed CSS rules again.
      mine.forEach((a) => a.cancel());
      running.current = [];
    }, () => {});
  }, [closed]);

  return { host, mic, close, blobs, filter, frost, filterId };
}

/** The goo layer: an SVG filter (filled in per move from the button's own
    fill and shadow) and two blobs, shown only while `data-goo` is on the
    host. */
export function GooLayer({ id, blobsRef, filterRef, frostRef }: { id: string; blobsRef: React.RefObject<HTMLDivElement>; filterRef: React.RefObject<SVGFilterElement>; frostRef: React.RefObject<HTMLDivElement> }) {
  return (
    <>
      <div className="mock-goo-frost" ref={frostRef} aria-hidden="true" />
      <svg className="mock-goo-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id={id} ref={filterRef} x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB" />
      </svg>
      <div className="mock-goo" ref={blobsRef} style={{ filter: `url(#${id})` }} aria-hidden="true">
        <span />
        <span />
      </div>
    </>
  );
}

export function ChatInputMock({
  radius = 20,
  agent = true,
  closed = false,
  listening = false,
  onClose,
  closeRef,
}: {
  radius?: number;
  agent?: boolean;
  /** Voice mode is off: the close button becomes the start button. */
  closed?: boolean;
  /** Voice mode is on: the field reads "Listening..." instead of its prompt. */
  listening?: boolean;
  onClose?: () => void;
  closeRef?: (el: HTMLButtonElement | null) => void;
}) {
  const goo = useGooMerge(closed);
  const setClose = useCallback((el: HTMLButtonElement | null) => {
    (goo.close as React.MutableRefObject<HTMLButtonElement | null>).current = el;
    closeRef?.(el);
  }, [closeRef]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <form className="mock-vchat" aria-label="Chat input UI example" style={radius !== 20 ? { borderRadius: radius } : undefined} onSubmit={(e) => e.preventDefault()}>
      {/* A real field and real buttons, so the mock can be typed into and
          pressed while the beam runs; nothing is sent anywhere. */}
      <input className="mock-vchat-input" type="text" placeholder={listening ? "Listening..." : "Ask me anything.."} aria-label="Message" autoComplete="off" spellCheck={false} />
      <div className="mock-vchat-row">
        <button type="button" className="mock-vchat-btn" aria-label="Add">
          <span className="mk-ico mk-ico-plus" />
        </button>
        <div className="mock-vchat-actions">
          {agent && (
            <button type="button" className="mock-vchat-btn mock-vchat-agent">
              Agent
              <span className="mk-ico mk-ico-chevron" />
            </button>
          )}
          <div className="mock-goo-host" ref={goo.host} data-closed={closed ? "" : undefined}>
            <GooLayer id={goo.filterId} blobsRef={goo.blobs} filterRef={goo.filter} frostRef={goo.frost} />
            <button type="button" className="mock-vchat-btn" data-goo-part="mic" aria-label="Voice" ref={goo.mic as React.RefObject<HTMLButtonElement>} tabIndex={closed ? -1 : undefined} aria-hidden={closed || undefined}>
              <span className="mk-ico mk-ico-mic" />
            </button>
            <button type="button" className="mock-vchat-btn mock-vchat-close" data-goo-part="close" aria-label={closed ? "Start voice" : "Close"} onClick={onClose} ref={setClose}>
              <span className="mock-swap-icon" data-icon="x"><span className="mk-ico mk-ico-plus mk-ico-x" /></span>
              <span className="mock-swap-icon" data-icon="start"><VoiceStartIcon /></span>
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
