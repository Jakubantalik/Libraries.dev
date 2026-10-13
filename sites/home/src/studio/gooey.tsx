import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Liquid } from "liquid-gooey";
import { checkSvgFilter, tpl, type CoreWiring } from "./core";
import { ControlsPanel, PgTabs, PgSlider, PgToggles, PgSwatches, PanelSep, Snippet, num, StageBar, PgGroup } from "./controls";
import { StudioTeaser } from "../examples/StudioTeaser";

/* Studio — Gooey workbench. The four demos are the LIVE gooey demo page's
   prototypes (sites/gooey/playground/demos), ported verbatim in dark mode:
   same geometry, classes, physics defaults, fills and shadows — the Studio
   only adds its knob panel on top. */

type EffectType = "morph" | "move" | "bend" | "melt";

const EFFECT_OPTIONS = [
  { value: "morph", label: "Morph" },
  { value: "move", label: "Move" },
  { value: "bend", label: "Bend" },
  { value: "melt", label: "Melt" },
] as const;

/* Easing vocabulary of the live PlusMenu demo. */
const EASES: Record<string, string> = {
  Bouncy: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  Smooth: "cubic-bezier(0.3, 1.05, 0.4, 1)",
  Snappy: "cubic-bezier(0.22, 1, 0.36, 1)",
};
const EASE_OPTIONS = [
  { value: "Bouncy", label: "Bouncy" },
  { value: "Smooth", label: "Smooth" },
  { value: "Snappy", label: "Snappy" },
] as const;
type EaseName = (typeof EASE_OPTIONS)[number]["value"];

/* Per-effect liquid surfaces, both themes taken from the live demo page's
   tokens (sites/gooey/playground/styles.css): dark --modal-bg #202020 /
   --sl-thumb #525252, light --modal-bg and --sl-thumb both #ffffff. */
type GooeyTheme = "dark" | "light";
const SURFACE_DEFAULT = "default";
const FILLS: Record<GooeyTheme, Record<EffectType, string>> = {
  dark: { morph: "#202020", move: "#525252", bend: "#202020", melt: "#ffffff" },
  light: { morph: "#ffffff", move: "#ffffff", bend: "#ffffff", melt: "#ffffff" },
};
const FILL_SWATCH: Record<GooeyTheme, string> = { dark: "#202020", light: "#ffffff" };
const FILL_OPTIONS_REST = [
  { value: "#e9e9e9", label: "Light" },
  { value: "#7cd4ff", label: "Sky" },
  { value: "#ffd28f", label: "Amber" },
] as const;

/* Param key -> the knob's own label, for the agent's applied-change line.
   The agent's namespace is flat and prefixed per effect, so several keys
   collapse back onto the same panel label — "Goo blur" belongs to both the
   shared surface and to melt, which never appear together. */
const GOOEY_PARAM_LABELS: Record<string, string> = {
  core: "Core",
  effect: "Effect",
  blur: "Goo blur",
  contrast: "Contrast",
  waviness: "Waviness",
  fill: "Button fill color",
  morphDuration: "Open duration",
  morphCloseDuration: "Close duration",
  morphCloseStagger: "Close stagger",
  morphAnticipationDuration: "Anticipation duration",
  morphIconDuration: "Icon fade",
  morphIconDelay: "Icon delay",
  morphStagger: "Stagger",
  morphSpread: "Spread",
  morphAnticipation: "Anticipation",
  moveSpringiness: "Springiness",
  moveWobble: "Wobble",
  moveStretch: "Stretch",
  moveTrail: "Trail",
  bendVertical: "Vertical bow",
  bendHorizontal: "Horizontal caps",
  bendContent: "Content bend",
  meltBlur: "Goo blur",
  meltContrast: "Contrast",
  meltReach: "Reach",
  meltFade: "Fade",
  meltWarp: "Warp",
  meltMarbling: "Marbling",
  meltGravity: "Gravity",
  meltMixBlur: "Marbling blur",
  meltWaviness: "Waviness",
};

/* The liquid surface shadows, verbatim from the live page's theme.ts
   ("Figma soft"): the dark Logram dropdown spec, and light's prototype
   Figma elevation. */
const LIQUID_SHADOW: Record<GooeyTheme, string> = {
  dark:
    "0 0 0 1px rgba(255, 255, 255, 0.04) inset, 0 1px 0 0 rgba(255, 255, 255, 0.03) inset",
  light:
    "",
};

/* Content ink flips with the liquid's luminance so icons stay legible on
   both the dark surface defaults and the light/colored fills. */
function inkFor(fill: string): string {
  const m = fill.match(/^#([0-9a-f]{6})$/i);
  if (!m) return "#fbfbfb";
  const n = parseInt(m[1], 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 140 ? "#17181c" : "#fbfbfb";
}

interface GroupTuning {
  blur: number;
  contrast: number;
  fill: string; // SURFACE_DEFAULT or a hex override
  waviness: number;
}

function fillFor(group: GroupTuning, effect: EffectType, theme: GooeyTheme): string {
  return group.fill === SURFACE_DEFAULT ? FILLS[theme][effect] : group.fill;
}

/* ── Morph demo: the live PlusMenu, verbatim ──────────────────── */

const SATELLITES = [
  {
    label: "New file",
    x: -54,
    y: -34,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8a1.5 1.5 0 0 0 1.5-1.5V6z" />
        <path d="M9 1.5V6h4.5" />
      </svg>
    ),
  },
  {
    label: "Add image",
    x: 0,
    y: -64,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
        <circle cx="5.5" cy="5.5" r="1.25" />
        <path d="M14.5 10.5L11 7l-7.5 7.5" />
      </svg>
    ),
  },
  {
    label: "New folder",
    x: 54,
    y: -34,
    icon: (
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 12.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h3L7.5 4H13a1.5 1.5 0 0 1 1.5 1.5z" />
      </svg>
    ),
  },
];

/* Live PlusMenu defaults (DEFAULTS in demos/PlusMenu.tsx). */
interface MorphKnobs {
  openDur: number;
  /** The live menu closes faster than it opens; both are tunable here. */
  closeDur: number;
  openEase: EaseName;
  openStagger: number;
  closeStagger: number;
  spread: number;
  anticipDist: number;
  anticipDur: number;
  iconDur: number;
  iconDelay: number;
}
/* The live playground's PRO panel defaults (sites/gooey/playground/demos/
   PlusMenu.tsx DEFAULTS) — the Studio now exposes the same surface. */
const MORPH_DEFAULTS: MorphKnobs = {
  openDur: 550,
  closeDur: 250,
  openEase: "Bouncy",
  openStagger: 0,
  closeStagger: 0,
  spread: 1,
  anticipDist: 5,
  anticipDur: 700,
  iconDur: 180,
  iconDelay: 120,
};


export function MorphDemo({ group, knobs, theme = "dark", filter }: { group: GroupTuning; knobs: MorphKnobs; theme?: GooeyTheme; filter?: string }) {
  const [open, setOpen] = useState(false);
  const [anticipating, setAnticipating] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const toggle = () => {
    /* Closing plays the anticipation nudge: the whole liquid layer (and the
       main button riding it) dips toward the returning satellites' momentum
       and settles back. Side effects stay OUT of the state updater —
       StrictMode double-invokes updaters. */
    if (open && knobs.anticipDist > 0) {
      if (timer.current) clearTimeout(timer.current);
      setAnticipating(false);
      requestAnimationFrame(() => setAnticipating(true));
      timer.current = setTimeout(() => setAnticipating(false), knobs.anticipDur);
    }
    setOpen((o) => !o);
  };

  const fill = fillFor(group, "morph", theme);
  const vars = {
    "--pm-anticip": `${knobs.anticipDist}px`,
    "--pm-anticip-dur": `${knobs.anticipDur}ms`,
    "--pm-icon-dur": `${knobs.iconDur}ms`,
    "--gd-ink": inkFor(fill),
  } as CSSProperties;

  const phase = open
    ? { dur: knobs.openDur, ease: EASES[knobs.openEase], stagger: knobs.openStagger }
    : { dur: knobs.closeDur, ease: EASES.Snappy, stagger: knobs.closeStagger };

  return (
    <Liquid
      filter={filter}
      blur={group.blur}
      contrast={group.contrast}
      fill={fill}
      shadow={LIQUID_SHADOW[theme]}
      waviness={group.waviness}
      className={`pm ${open ? "pm-open" : ""} ${anticipating ? "pm-anticipating" : ""}`}
      style={vars}
    >
      {SATELLITES.map((s, i) => (
        <Liquid.Item
          key={s.label}
          className="pm-slot"
          x={open ? s.x * knobs.spread : 0}
          y={open ? s.y * knobs.spread : 0}
          transition={{ duration: phase.dur, ease: phase.ease }}
          delay={i * phase.stagger}
        >
          <button
            type="button"
            className="pm-btn pm-sat"
            aria-label={s.label}
            tabIndex={open ? 0 : -1}
            onClick={toggle}
          >
            <span
              className="pm-sat-icon"
              style={{ transitionDelay: open ? `${knobs.iconDelay + i * phase.stagger}ms` : "0ms" }}
            >
              {s.icon}
            </span>
          </button>
        </Liquid.Item>
      ))}
      <Liquid.Item className="pm-slot">
        <button
          type="button"
          className="pm-btn pm-main"
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={toggle}
        >
          <span className="pm-plus">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
              <path d="M10 4V16M4 10H16" />
            </svg>
          </span>
        </button>
      </Liquid.Item>
    </Liquid>
  );
}

/* ── Move demo: the live Slider, verbatim ─────────────────────── */

/* Track spans 14..226 (240 − 14px insets each side); the 24px thumb's left
   offset travels 0..188 to stay flush with the track ends. */
const THUMB_MAX = 188;

/* Live Slider defaults (demos/Slider.tsx). Wobble is the library default. */
interface MoveKnobs {
  springiness: number;
  wobble: number;
  stretch: number;
  trail: number;
}
const MOVE_DEFAULTS: MoveKnobs = { springiness: 0.5, wobble: 0.5, stretch: 0.6, trail: 0.35 };

export function MoveDemo({ group, knobs, theme = "dark", filter }: { group: GroupTuning; knobs: MoveKnobs; theme?: GooeyTheme; filter?: string }) {
  const [x, setX] = useState(84);
  const drag = useRef<number | null>(null);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    drag.current = e.clientX - x;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current == null) return;
    setX(Math.min(THUMB_MAX, Math.max(0, e.clientX - drag.current)));
  };
  const endDrag = () => {
    drag.current = null;
  };

  return (
    <Liquid
      filter={filter}
      blur={group.blur}
      contrast={group.contrast}
      fill={fillFor(group, "move", theme)}
      shadow={LIQUID_SHADOW[theme]}
      waviness={group.waviness}
      className="sl"
    >
      <div className="sl-track" aria-hidden="true" />
      <Liquid.Item effect="move" move={knobs}>
        <div
          className="sl-thumb"
          role="slider"
          aria-label="Demo slider"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round((x / THUMB_MAX) * 100)}
          tabIndex={0}
          style={{ transform: `translateX(${x}px)` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
      </Liquid.Item>
    </Liquid>
  );
}

/* ── Bend demo: the live DragCard, verbatim ───────────────────── */

const DROP_MS = 400;
const DROP_EASE = "cubic-bezier(0.34, 1.40, 0.64, 1)";
const BEND_CLAMP_FALLBACK = { x: 70, y: 60 };

interface BendKnobs {
  vertical: number;
  horizontal: number;
  content: number;
}
const BEND_DEFAULTS: BendKnobs = { vertical: 0.6, horizontal: 0.35, content: 0.3 };

export function BendDemo({ group, knobs, theme = "dark", filter }: { group: GroupTuning; knobs: BendKnobs; theme?: GooeyTheme; filter?: string }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [releasing, setReleasing] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);

  /* Half the free travel in each axis: the card sits centred and moves by
     transform, so it may run to the group's edge but no further. */
  const limits = () => {
    const g = stageRef.current?.getBoundingClientRect();
    const c = cardRef.current?.getBoundingClientRect();
    if (!g || !c || !g.width || !c.width) return BEND_CLAMP_FALLBACK;
    return {
      x: Math.max(0, (g.width - c.width) / 2),
      y: Math.max(0, (g.height - c.height) / 2),
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    drag.current = { id: e.pointerId, dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const lim = limits();
    setPos({
      x: Math.max(-lim.x, Math.min(lim.x, e.clientX - d.dx)),
      y: Math.max(-lim.y, Math.min(lim.y, e.clientY - d.dy)),
    });
  };
  const endDrag = () => {
    drag.current = null;
    /* Release: the card flies home on the drop animation — 400ms with the
       overshoot bezier, landing with a bounce (live DragCard). */
    setReleasing(true);
    setPos({ x: 0, y: 0 });
    window.setTimeout(() => setReleasing(false), DROP_MS);
  };

  const fill = fillFor(group, "bend", theme);
  return (
    <Liquid
      filter={filter}
      blur={group.blur}
      contrast={group.contrast}
      fill={fill}
      shadow={LIQUID_SHADOW[theme]}
      waviness={group.waviness}
      className="dgc"
      ref={stageRef}
      style={{ "--gd-ink": inkFor(fill) } as CSSProperties}
    >
      <Liquid.Item effect="bend" bend={{ vertical: knobs.vertical, horizontal: knobs.horizontal }}>
        <div
          className="dgc-card"
          ref={cardRef}
          style={{
            transform: `translate(${pos.x}px, ${pos.y}px)`,
            transition: releasing ? `transform ${DROP_MS}ms ${DROP_EASE}` : "none",
            ["--dgc-cb" as string]: knobs.content,
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <span className="dgc-chip" aria-hidden="true">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14.5 12.5A1.5 1.5 0 0 1 13 14H3a1.5 1.5 0 0 1-1.5-1.5V3A1.5 1.5 0 0 1 3 1.5h3L7.5 4H13a1.5 1.5 0 0 1 1.5 1.5z" />
            </svg>
          </span>
          <span className="dgc-title">Gooey Project</span>
          <span className="dgc-count">45 files</span>
        </div>
      </Liquid.Item>
    </Liquid>
  );
}

/* ── Melt demo: the live MeltPair, verbatim ───────────────────── */

const MELT_CARD = 84;
const MELT_STAGE_H = 200;

interface MeltKnobs {
  blur: number;
  contrast: number;
  reach: number;
  fade: number;
  warp: number;
  mix: number;
  mixBlur: number;
  gravity: number;
  waviness: number;
}

interface Pos {
  x: number;
  y: number;
}

function MeltCard({
  src,
  pos,
  setPos,
  stageRef,
  melt,
}: {
  src: string;
  pos: Pos;
  setPos: (p: Pos) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
  melt: MeltKnobs;
}) {
  const drag = useRef<{ id: number; dx: number; dy: number } | null>(null);
  return (
    <Liquid.Item effect="melt" melt={melt}>
      <div
        className="mp-card"
        // Size lives here, not in CSS: the melt reads the element's real
        // rect, so the constant and the painted card must not disagree.
        style={{ left: pos.x, top: pos.y, width: MELT_CARD, height: MELT_CARD }}
        onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
          drag.current = { id: e.pointerId, dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          e.currentTarget.setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || e.pointerId !== d.id) return;
          // Clamp against the stage's LIVE size (narrow viewports shrink it).
          const box = stageRef.current?.getBoundingClientRect();
          const maxX = Math.max(0, (box?.width ?? MELT_CARD * 2) - MELT_CARD);
          const maxY = Math.max(0, (box?.height ?? MELT_STAGE_H) - MELT_CARD);
          setPos({
            x: Math.max(0, Math.min(maxX, e.clientX - d.dx)),
            y: Math.max(0, Math.min(maxY, e.clientY - d.dy)),
          });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <img src={src} alt="" draggable={false} />
      </div>
    </Liquid.Item>
  );
}

export function MeltDemo({ melt, filter }: { melt: MeltKnobs; filter?: string }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [a, setA] = useState<Pos>({ x: 0, y: (MELT_STAGE_H - MELT_CARD) / 2 });
  const [b, setB] = useState<Pos>({ x: MELT_CARD + 24, y: (MELT_STAGE_H - MELT_CARD) / 2 });
  const placed = useRef(false);

  /* Lay the pair out symmetrically once the stage has a measured width —
     the two cards start a hair apart so the goo is already necking. */
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const place = () => {
      const w = el.getBoundingClientRect().width;
      if (!w) return;
      const gap = Math.min(20, Math.max(4, w - MELT_CARD * 2 - 8));
      const total = MELT_CARD * 2 + gap;
      const left = Math.max(0, (w - total) / 2);
      setA({ x: left, y: (MELT_STAGE_H - MELT_CARD) / 2 });
      setB({ x: left + MELT_CARD + gap, y: (MELT_STAGE_H - MELT_CARD) / 2 });
      placed.current = true;
    };
    place();
    const ro = new ResizeObserver(() => {
      if (!placed.current) place();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <Liquid filter={filter} className="mp" style={{ width: "min(100%, 420px)", height: MELT_STAGE_H }} ref={stageRef}>
      <MeltCard src="/images/melt-a.jpg" pos={a} setPos={setA} stageRef={stageRef} melt={melt} />
      <MeltCard src="/images/melt-b.jpg" pos={b} setPos={setB} stageRef={stageRef} melt={melt} />
    </Liquid>
  );
}

/* ── Snippet builders ──────────────────────────────────────────── */

function groupAttrs(group: GroupTuning, effect: EffectType, theme: GooeyTheme): string {
  const parts: string[] = [];
  if (group.blur !== 6) parts.push(` blur={${num(group.blur)}}`);
  if (group.contrast !== 18) parts.push(` contrast={${num(group.contrast)}}`);
  parts.push(` fill="${fillFor(group, effect, theme)}"`);
  if (group.waviness !== 0) parts.push(` waviness={${num(group.waviness)}}`);
  return parts.join("");
}

function obj(pairs: Array<[string, string] | null>): string {
  const inner = pairs.filter(Boolean).map((p) => `${p![0]}: ${p![1]}`);
  return inner.length ? `{{ ${inner.join(", ")} }}` : "";
}

function buildSnippet(
  effect: EffectType,
  group: GroupTuning,
  morph: MorphKnobs,
  move: MoveKnobs,
  bend: BendKnobs,
  melt: MeltKnobs,
  theme: GooeyTheme
): string {
  const head = "import { Liquid } from 'liquid-gooey'\n\n";
  if (effect === "morph") {
    const t = ` transition={{ duration: ${morph.openDur}, ease: '${EASES[morph.openEase]}' }}`;
    const sx = num(-54 * morph.spread);
    const sy = num(-34 * morph.spread);
    const ty = num(-64 * morph.spread);
    return (
      head +
      `<Liquid${groupAttrs(group, effect, theme)}>\n` +
      `  <Liquid.Item x={open ? ${sx} : 0} y={open ? ${sy} : 0}${t}>\n` +
      `    <button className="round-btn">…</button>\n` +
      `  </Liquid.Item>\n` +
      `  <Liquid.Item x={0} y={open ? ${ty} : 0}${t} delay={${morph.openStagger}}>\n` +
      `    <button className="round-btn">…</button>\n` +
      `  </Liquid.Item>\n` +
      `  <Liquid.Item>\n` +
      `    <button className="round-btn">+</button>\n` +
      `  </Liquid.Item>\n` +
      `</Liquid>`
    );
  }
  if (effect === "move") {
    const moveObj = obj([
      move.springiness !== 0.5 ? ["springiness", num(move.springiness)] : null,
      move.wobble !== 0.5 ? ["wobble", num(move.wobble)] : null,
      ["stretch", num(move.stretch)],
      ["trail", num(move.trail)],
    ]);
    return (
      head +
      `<Liquid${groupAttrs(group, effect, theme)}>\n` +
      `  <Liquid.Item effect="move" move=${moveObj}>\n` +
      `    <div className="thumb" style={{ transform: \`translateX(\${x}px)\` }} />\n` +
      `  </Liquid.Item>\n` +
      `</Liquid>`
    );
  }
  if (effect === "bend") {
    const bendObj = obj([
      bend.vertical !== 0.6 ? ["vertical", num(bend.vertical)] : null,
      bend.horizontal !== 0.35 ? ["horizontal", num(bend.horizontal)] : null,
    ]);
    const bendAttr = bendObj ? ` bend=${bendObj}` : "";
    return (
      head +
      `<Liquid${groupAttrs(group, effect, theme)}>\n` +
      `  <Liquid.Item effect="bend"${bendAttr}>\n` +
      `    <div className="card" style={{ transform: \`translate(\${x}px, \${y}px)\` }}>…</div>\n` +
      `  </Liquid.Item>\n` +
      `</Liquid>`
    );
  }
  const meltObj = obj([
    melt.blur !== 7 ? ["blur", num(melt.blur)] : null,
    melt.contrast !== 40 ? ["contrast", num(melt.contrast)] : null,
    melt.reach !== 0.8 ? ["reach", num(melt.reach)] : null,
    melt.fade !== 17 ? ["fade", num(melt.fade)] : null,
    melt.warp !== 0 ? ["warp", num(melt.warp)] : null,
    melt.mix !== 1 ? ["mix", num(melt.mix)] : null,
    melt.gravity !== 1.9 ? ["gravity", num(melt.gravity)] : null,
  ]);
  const meltAttr = meltObj ? ` melt=${meltObj}` : "";
  return (
    head +
    `<Liquid>\n` +
    `  <Liquid.Item effect="melt"${meltAttr}>\n` +
    `    <img src="/photo-a.jpg" style={{ width: 84, height: 84, borderRadius: 16 }} />\n` +
    `  </Liquid.Item>\n` +
    `  <Liquid.Item effect="melt"${meltAttr}>\n` +
    `    <img src="/photo-b.jpg" style={{ width: 84, height: 84, borderRadius: 16 }} />\n` +
    `  </Liquid.Item>\n` +
    `</Liquid>`
  );
}

/* ── The workbench ─────────────────────────────────────────────── */

/* One component, two surfaces. The Studio gets the whole panel behind its
   Manual control / Agent tabs; the public detail page gets the same demos
   with only the effect switch and the two surface knobs, and no Agent —
   the deeper tuning is what Pro is for. */
/* The demo page's own defaults, so the detail-page examples render the
   effect exactly as that page does without carrying the Studio's state. */
export const GOOEY_EXAMPLE_DEFAULTS = {
  group: { blur: 6, contrast: 18, fill: SURFACE_DEFAULT, waviness: 0 } as GroupTuning,
  morph: MORPH_DEFAULTS,
  move: MOVE_DEFAULTS,
  bend: BEND_DEFAULTS,
};

export function GooeyStudio({
  visible = true,
  variant = "studio",
  theme = "dark",
}: {
  visible?: boolean;
  variant?: "studio" | "public";
  theme?: GooeyTheme;
}) {
  const isPublic = variant === "public";
  const fillOptions = [
    { value: SURFACE_DEFAULT, label: "Surface (default)", swatch: FILL_SWATCH[theme] },
    ...FILL_OPTIONS_REST,
  ];
  const [effect, setEffect] = useState<EffectType>("morph");

  const [group, setGroup] = useState<GroupTuning>({ blur: 6, contrast: 18, fill: SURFACE_DEFAULT, waviness: 0 });
  const [morph, setMorph] = useState<MorphKnobs>(MORPH_DEFAULTS);
  const [move, setMove] = useState<MoveKnobs>(MOVE_DEFAULTS);
  const [bend, setBend] = useState<BendKnobs>(BEND_DEFAULTS);
  const [melt, setMelt] = useState<MeltKnobs>({ blur: 7, contrast: 40, reach: 0.8, fade: 17, warp: 0, mix: 1, mixBlur: 8, gravity: 1.9, waviness: 12 });
  /* The agent's rebuilt filter chain (raw SVG primitives), or "" for the
     library's goo chain. */
  const [core, setCore] = useState("");
  const coreWiring: CoreWiring = {
    lang: "svg",
    /* The chain the library rendered for the visible demo, read back from
       its <filter> — the exact primitives the agent is replacing. */
    source: () => {
      const f = Array.from(document.querySelectorAll<SVGFilterElement>(".pg [data-gooey-svg] filter")).find(
        (el) => ((el.closest(".pg") as HTMLElement | null)?.offsetWidth ?? 0) > 0
      );
      return f ? f.innerHTML.trim() : "";
    },
    check: checkSvgFilter,
  };

  /* Every Gooey effect is hand-driven — click the menu, drag the thumb, the
     card, the photos. No idle loop and no play/pause pill. */

  const setGroupKey = useCallback(
    <K extends keyof GroupTuning>(k: K, v: GroupTuning[K]) => setGroup((g) => ({ ...g, [k]: v })),
    []
  );

  /* Agent wiring. The knobs live in five nested objects; the agent sees one
     flat namespace, prefixed per effect so `blur` (shared surface) and
     `meltBlur` (melt's own) stay distinct. Keys match the Worker's spec,
     which owns the ranges and rejects whatever the current effect makes
     inert. */
  const agentParams: Record<string, unknown> = {
    effect,
    core,
    blur: group.blur,
    contrast: group.contrast,
    waviness: group.waviness,
    fill: group.fill,
    morphDuration: morph.openDur,
    morphCloseDuration: morph.closeDur,
    morphCloseStagger: morph.closeStagger,
    morphAnticipationDuration: morph.anticipDur,
    morphIconDuration: morph.iconDur,
    morphIconDelay: morph.iconDelay,
    morphStagger: morph.openStagger,
    morphSpread: morph.spread,
    morphAnticipation: morph.anticipDist,
    moveSpringiness: move.springiness,
    moveWobble: move.wobble,
    moveStretch: move.stretch,
    moveTrail: move.trail,
    bendVertical: bend.vertical,
    bendHorizontal: bend.horizontal,
    bendContent: bend.content,
    meltBlur: melt.blur,
    meltContrast: melt.contrast,
    meltReach: melt.reach,
    meltFade: melt.fade,
    meltWarp: melt.warp,
    meltMarbling: melt.mix,
    meltGravity: melt.gravity,
    meltMixBlur: melt.mixBlur,
    meltWaviness: melt.waviness,
  };

  const applyAgentParams = useCallback((patch: Record<string, unknown>) => {
    const n = (k: string) => (typeof patch[k] === "number" ? (patch[k] as number) : undefined);

    if (typeof patch.effect === "string") setEffect(patch.effect as EffectType);
    if (typeof patch.core === "string") setCore(patch.core);

    setGroup((g) => ({
      ...g,
      blur: n("blur") ?? g.blur,
      contrast: n("contrast") ?? g.contrast,
      waviness: n("waviness") ?? g.waviness,
      fill: typeof patch.fill === "string" ? patch.fill : g.fill,
    }));
    setMorph((m) => ({
      ...m,
      openDur: n("morphDuration") ?? m.openDur,
      closeDur: n("morphCloseDuration") ?? m.closeDur,
      closeStagger: n("morphCloseStagger") ?? m.closeStagger,
      anticipDur: n("morphAnticipationDuration") ?? m.anticipDur,
      iconDur: n("morphIconDuration") ?? m.iconDur,
      iconDelay: n("morphIconDelay") ?? m.iconDelay,
      openStagger: n("morphStagger") ?? m.openStagger,
      spread: n("morphSpread") ?? m.spread,
      anticipDist: n("morphAnticipation") ?? m.anticipDist,
    }));
    setMove((m) => ({
      ...m,
      springiness: n("moveSpringiness") ?? m.springiness,
      wobble: n("moveWobble") ?? m.wobble,
      stretch: n("moveStretch") ?? m.stretch,
      trail: n("moveTrail") ?? m.trail,
    }));
    setBend((b) => ({
      ...b,
      vertical: n("bendVertical") ?? b.vertical,
      horizontal: n("bendHorizontal") ?? b.horizontal,
      content: n("bendContent") ?? b.content,
    }));
    setMelt((m) => ({
      ...m,
      blur: n("meltBlur") ?? m.blur,
      contrast: n("meltContrast") ?? m.contrast,
      reach: n("meltReach") ?? m.reach,
      fade: n("meltFade") ?? m.fade,
      warp: n("meltWarp") ?? m.warp,
      mix: n("meltMarbling") ?? m.mix,
      gravity: n("meltGravity") ?? m.gravity,
      mixBlur: n("meltMixBlur") ?? m.mixBlur,
      waviness: n("meltWaviness") ?? m.waviness,
    }));
  }, []);

  const stockSnippet = buildSnippet(effect, group, morph, move, bend, melt, theme);
  const snippet = core
    ? stockSnippet.replace("\n\n<Liquid", `\n\nconst liquidFilter = ${tpl(core)}\n\n<Liquid filter={liquidFilter}`)
    : stockSnippet;

  /* The public page skips ControlsPanel entirely, so the Agent tab never
     renders there rather than rendering hidden — which also means it never
     mounts the agent wiring the Studio side passes below. Both branches are
     written inline: a component declared inside this render would be a new
     type on every state change, so React would remount the whole panel and
     kill any in-flight slider drag. */

  return (
    <div className="pg">
      {!isPublic && <StageBar library="Gooey" prompt={{ pkg: "liquid-gooey", docsPath: "/gooey.html", snippet }} agent={{ libraryId: "gooey", params: agentParams, labels: GOOEY_PARAM_LABELS, onApply: applyAgentParams }} />}
      <div className="pg-stage">
        {visible && effect === "morph" && <MorphDemo group={group} knobs={morph} theme={theme} filter={core || undefined} />}
        {visible && effect === "move" && <MoveDemo group={group} knobs={move} theme={theme} filter={core || undefined} />}
        {visible && effect === "bend" && <BendDemo group={group} knobs={bend} theme={theme} filter={core || undefined} />}
        {visible && effect === "melt" && <MeltDemo melt={melt} filter={core || undefined} />}
      </div>

      {isPublic ? (
        <div className="pg-controls">
          <PgTabs label="Effect" options={EFFECT_OPTIONS} value={effect} onChange={setEffect} />

          {isPublic && effect !== "melt" && (
            <>
              <PgSlider label="Goo blur" value={group.blur} min={0} max={16} step={0.5} onChange={(v) => setGroupKey("blur", v)} />
              <PgSlider label="Contrast" value={group.contrast} min={4} max={40} step={1} onChange={(v) => setGroupKey("contrast", v)} />
            </>
          )}

          {!isPublic && effect !== "melt" && (
            <>
              <PanelSep />
              <PgSlider label="Goo blur" value={group.blur} min={0} max={16} step={0.5} onChange={(v) => setGroupKey("blur", v)} />
              <PgSlider label="Contrast" value={group.contrast} min={4} max={40} step={1} onChange={(v) => setGroupKey("contrast", v)} />
              <PgSlider label="Waviness" value={group.waviness} min={0} max={8} step={0.5} onChange={(v) => setGroupKey("waviness", v)} />
              <PgSwatches label="Button fill color" options={fillOptions} value={group.fill} onChange={(v) => setGroupKey("fill", v)} allowCustom />
            </>
          )}

          {!isPublic && effect === "morph" && (
            <>
              <PanelSep />
              <PgSlider label="Open duration" value={morph.openDur} min={80} max={1200} step={10} display={`${morph.openDur}ms`} onChange={(v) => setMorph((m) => ({ ...m, openDur: v }))} />
              <PgSlider label="Close duration" value={morph.closeDur} min={80} max={1200} step={10} display={`${morph.closeDur}ms`} onChange={(v) => setMorph((m) => ({ ...m, closeDur: v }))} />
              <PgSlider label="Stagger" value={morph.openStagger} min={0} max={200} step={5} display={`${morph.openStagger}ms`} onChange={(v) => setMorph((m) => ({ ...m, openStagger: v }))} />
              <PgSlider label="Spread" value={morph.spread} min={0.4} max={2} step={0.05} display={`${num(morph.spread)}×`} onChange={(v) => setMorph((m) => ({ ...m, spread: v }))} />
              <PgSlider label="Anticipation" value={morph.anticipDist} min={0} max={24} step={1} display={`${morph.anticipDist}px`} onChange={(v) => setMorph((m) => ({ ...m, anticipDist: v }))} />
            </>
          )}

          {!isPublic && effect === "move" && (
            <>
              <PanelSep />
              <PgSlider label="Springiness" value={move.springiness} min={0} max={1} step={0.05} onChange={(v) => setMove((m) => ({ ...m, springiness: v }))} />
              <PgSlider label="Wobble" value={move.wobble} min={0} max={1} step={0.05} onChange={(v) => setMove((m) => ({ ...m, wobble: v }))} />
              <PgSlider label="Stretch" value={move.stretch} min={0} max={1} step={0.02} onChange={(v) => setMove((m) => ({ ...m, stretch: v }))} />
              <PgSlider label="Trail" value={move.trail} min={0} max={1} step={0.025} onChange={(v) => setMove((m) => ({ ...m, trail: v }))} />
            </>
          )}

          {!isPublic && effect === "bend" && (
            <>
              <PanelSep />
              <PgSlider label="Vertical bow" value={bend.vertical} min={0} max={1} step={0.05} onChange={(v) => setBend((b) => ({ ...b, vertical: v }))} />
              <PgSlider label="Horizontal caps" value={bend.horizontal} min={0} max={1} step={0.05} onChange={(v) => setBend((b) => ({ ...b, horizontal: v }))} />
              <PgSlider label="Content bend" value={bend.content} min={0} max={1} step={0.05} onChange={(v) => setBend((b) => ({ ...b, content: v }))} />
            </>
          )}

          {!isPublic && effect === "melt" && (
            <>
              <PanelSep />
              <PgSlider label="Goo blur" value={melt.blur} min={0} max={20} step={0.5} onChange={(v) => setMelt((m) => ({ ...m, blur: v }))} />
              <PgSlider label="Contrast" value={melt.contrast} min={10} max={80} step={1} onChange={(v) => setMelt((m) => ({ ...m, contrast: v }))} />
              <PgSlider label="Reach" value={melt.reach} min={0} max={2} step={0.05} onChange={(v) => setMelt((m) => ({ ...m, reach: v }))} />
              <PgSlider label="Fade" value={melt.fade} min={0} max={40} step={1} onChange={(v) => setMelt((m) => ({ ...m, fade: v }))} />
              <PgSlider label="Warp" value={melt.warp} min={0} max={40} step={1} onChange={(v) => setMelt((m) => ({ ...m, warp: v }))} />
              <PgSlider label="Marbling" value={melt.mix} min={0} max={1} step={0.05} onChange={(v) => setMelt((m) => ({ ...m, mix: v }))} />
              <PgSlider label="Gravity" value={melt.gravity} min={0} max={4} step={0.1} onChange={(v) => setMelt((m) => ({ ...m, gravity: v }))} />
            </>
          )}
          <StudioTeaser
            rows={[
              { kind: "slider", label: "Waviness", value: "0", fill: 0 },
              { kind: "tabs", label: "Fill", options: ["Surface", "Light", "Sky"] },
              { kind: "slider", label: "Bounce", value: "0.5", fill: 50 },
              { kind: "slider", label: "Stagger", value: "40ms", fill: 20 },
            ]}
          />
        </div>
      ) : (
        <ControlsPanel
          library="Gooey"
          agent={{
            libraryId: "gooey",
            params: agentParams,
            labels: GOOEY_PARAM_LABELS,
            onApply: applyAgentParams,
            core: coreWiring,
          }}
        >
          <PgTabs label="Effect" options={EFFECT_OPTIONS} value={effect} onChange={setEffect} />

          {isPublic && effect !== "melt" && (
            <>
              <PgSlider label="Goo blur" value={group.blur} min={0} max={16} step={0.5} onChange={(v) => setGroupKey("blur", v)} />
              <PgSlider label="Contrast" value={group.contrast} min={4} max={40} step={1} onChange={(v) => setGroupKey("contrast", v)} />
            </>
          )}

          {!isPublic && effect !== "melt" && (
            <>
              <PanelSep />
              <PgGroup label="Effect settings">
                <PgSlider label="Goo blur" value={group.blur} min={0} max={16} step={0.5} onChange={(v) => setGroupKey("blur", v)} />
                <PgSlider label="Contrast" value={group.contrast} min={4} max={40} step={1} onChange={(v) => setGroupKey("contrast", v)} />
                <PgSlider label="Waviness" value={group.waviness} min={0} max={8} step={0.5} onChange={(v) => setGroupKey("waviness", v)} />
                {/* Move's and Bend's physics ARE the effect — neither has a
                    separate open/close animation, so they belong here. */}
                {effect === "bend" && (
                  <>
                    <PgSlider label="Vertical bow" value={bend.vertical} min={0} max={1} step={0.05} onChange={(v) => setBend((b) => ({ ...b, vertical: v }))} />
                    <PgSlider label="Horizontal caps" value={bend.horizontal} min={0} max={1} step={0.05} onChange={(v) => setBend((b) => ({ ...b, horizontal: v }))} />
                    <PgSlider label="Content bend" value={bend.content} min={0} max={1} step={0.05} onChange={(v) => setBend((b) => ({ ...b, content: v }))} />
                  </>
                )}
                {effect === "move" && (
                  <>
                    <PgSlider label="Springiness" value={move.springiness} min={0} max={1} step={0.05} onChange={(v) => setMove((m) => ({ ...m, springiness: v }))} />
                    <PgSlider label="Wobble" value={move.wobble} min={0} max={1} step={0.05} onChange={(v) => setMove((m) => ({ ...m, wobble: v }))} />
                    <PgSlider label="Stretch" value={move.stretch} min={0} max={1} step={0.02} onChange={(v) => setMove((m) => ({ ...m, stretch: v }))} />
                    <PgSlider label="Trail" value={move.trail} min={0} max={1} step={0.025} onChange={(v) => setMove((m) => ({ ...m, trail: v }))} />
                  </>
                )}
              </PgGroup>
              <PanelSep />
              <PgSwatches label="Button fill color" options={fillOptions} value={group.fill} onChange={(v) => setGroupKey("fill", v)} allowCustom />
            </>
          )}

          {!isPublic && effect !== "move" && effect !== "bend" && (
            <>
              <PanelSep />
              {/* Melt has no separate open/close animation either — its knobs
                  ARE the effect, so the section takes the same title as the
                  other effects' surface controls. */}
              <PgGroup label={effect === "melt" ? "Effect settings" : "Component animation"}>
                {effect === "morph" && (
                  <>
                    <PgSlider label="Open duration" value={morph.openDur} min={80} max={1200} step={10} display={`${morph.openDur}ms`} onChange={(v) => setMorph((m) => ({ ...m, openDur: v }))} />
                    <PgSlider label="Close duration" value={morph.closeDur} min={80} max={1200} step={10} display={`${morph.closeDur}ms`} onChange={(v) => setMorph((m) => ({ ...m, closeDur: v }))} />
                    <PgSlider label="Open stagger" value={morph.openStagger} min={0} max={200} step={5} display={`${morph.openStagger}ms`} onChange={(v) => setMorph((m) => ({ ...m, openStagger: v }))} />
                    <PgSlider label="Close stagger" value={morph.closeStagger} min={0} max={200} step={5} display={`${morph.closeStagger}ms`} onChange={(v) => setMorph((m) => ({ ...m, closeStagger: v }))} />
                    <PgSlider label="Spread" value={morph.spread} min={0.4} max={2} step={0.05} display={`${num(morph.spread)}×`} onChange={(v) => setMorph((m) => ({ ...m, spread: v }))} />
                    <PgSlider label="Anticipation" value={morph.anticipDist} min={0} max={24} step={1} display={`${morph.anticipDist}px`} onChange={(v) => setMorph((m) => ({ ...m, anticipDist: v }))} />
                    <PgSlider label="Anticipation duration" value={morph.anticipDur} min={120} max={1400} step={20} display={`${morph.anticipDur}ms`} onChange={(v) => setMorph((m) => ({ ...m, anticipDur: v }))} />
                    <PgSlider label="Icon fade" value={morph.iconDur} min={0} max={600} step={10} display={`${morph.iconDur}ms`} onChange={(v) => setMorph((m) => ({ ...m, iconDur: v }))} />
                    <PgSlider label="Icon delay" value={morph.iconDelay} min={0} max={600} step={10} display={`${morph.iconDelay}ms`} onChange={(v) => setMorph((m) => ({ ...m, iconDelay: v }))} />
                  </>
                )}
                {effect === "melt" && (
                  <>
                    <PgSlider label="Goo blur" value={melt.blur} min={0} max={20} step={0.5} onChange={(v) => setMelt((m) => ({ ...m, blur: v }))} />
                    <PgSlider label="Contrast" value={melt.contrast} min={10} max={80} step={1} onChange={(v) => setMelt((m) => ({ ...m, contrast: v }))} />
                    <PgSlider label="Reach" value={melt.reach} min={0} max={2} step={0.05} onChange={(v) => setMelt((m) => ({ ...m, reach: v }))} />
                    <PgSlider label="Fade" value={melt.fade} min={0} max={40} step={1} onChange={(v) => setMelt((m) => ({ ...m, fade: v }))} />
                    <PgSlider label="Warp" value={melt.warp} min={0} max={40} step={1} onChange={(v) => setMelt((m) => ({ ...m, warp: v }))} />
                    <PgSlider label="Marbling" value={melt.mix} min={0} max={1} step={0.05} onChange={(v) => setMelt((m) => ({ ...m, mix: v }))} />
                    <PgSlider label="Marbling blur" value={melt.mixBlur} min={0} max={24} step={0.5} onChange={(v) => setMelt((m) => ({ ...m, mixBlur: v }))} />
                    <PgSlider label="Gravity" value={melt.gravity} min={0} max={4} step={0.1} onChange={(v) => setMelt((m) => ({ ...m, gravity: v }))} />
                    <PgSlider label="Waviness" value={melt.waviness} min={0} max={40} step={1} onChange={(v) => setMelt((m) => ({ ...m, waviness: v }))} />
                  </>
                )}
              </PgGroup>
            </>
          )}
        </ControlsPanel>
      )}

      <Snippet code={snippet} />
    </div>
  );
}
