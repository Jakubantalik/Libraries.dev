import { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { BotAvatar, botAvatarTypes, type BotAvatarType } from "bot-avatars";

/* Internal demo: a row of bots walking rightward across a 1000×960 stage.
   The one in the middle is half again as big and is the one at work; the
   rest idle. Every `interval` the row steps one slot to the right over
   `duration` on a smooth ease-out, blurred by how fast it is travelling.

   The row travels as one element, so the step is a single transform and
   the blur a single filter pass. When a step lands, the bot that has left
   on the right is moved to the front of the row and the row's offset goes
   back to zero — the same picture, so nothing flickers, and the ring
   never runs out of bots. */

const RING = 9; // bots in the ring: five on the stage, two spare each side
const CENTRE = Math.floor(RING / 2);

const EASINGS = [
  { value: "cubic-bezier(0.22, 1, 0.36, 1)", label: "Smooth out" },
  { value: "cubic-bezier(0.33, 1, 0.68, 1)", label: "Ease out" },
  { value: "cubic-bezier(0.65, 0, 0.35, 1)", label: "Ease in out" },
  { value: "cubic-bezier(0.34, 1.56, 0.64, 1)", label: "Back out" },
  { value: "linear", label: "Linear" },
] as const;

const DEFAULTS = {
  interval: 2600, // ms between steps
  duration: 600, // ms a step takes
  ease: EASINGS[2].value as string, // ease in out
  blur: 21, // px of motion blur at full speed
  size: 110, // px, the idle bots
  centre: 185, // % of that for the middle one
  gap: 170, // % of the size, slot to slot
};
type Cfg = typeof DEFAULTS;

const ROWS: Array<[keyof Cfg, string, number, number, number, string, string]> = [
  ["interval", "Every", 600, 6000, 100, "ms", "ms one bot waits in the middle before the row steps on"],
  ["duration", "Move", 150, 2000, 50, "ms", "ms a step takes, end to end"],
  ["blur", "Blur", 0, 40, 1, "px", "px of horizontal blur at the fastest point of a step"],
  ["size", "Size", 40, 200, 2, "px", "px of the bots either side of the middle"],
  ["centre", "Middle", 100, 250, 5, "%", "% of that size for the bot in the middle"],
  ["gap", "Spacing", 120, 320, 5, "%", "% of the size from one slot to the next"],
];

/* The order the bots walk in to begin with — the strip below the stage
   changes it. Every type in the library, once. */
const ORDER: BotAvatarType[] = [
  "mech",
  "puddle",
  "ghost",
  "blob",
  "circle",
  "drop",
  "square",
  "alien",
  "star",
  "hexagon",
  "clover",
  "flower",
  "droid",
  "pebble",
  "pill",
  "cloud",
  "cat",
  "triangle",
];
if (ORDER.length !== botAvatarTypes.length) console.warn("bot-carousel: the order is missing a type");

interface Bot {
  id: number;
  type: BotAvatarType;
}

function Carousel() {
  const [cfg, setCfg] = useState<Cfg>(DEFAULTS);
  const [paused, setPaused] = useState(false);

  /* the order the bots walk in — the strip below the stage sets it — and
     the ring drawn from it */
  const [order, setOrder] = useState<BotAvatarType[]>(ORDER);
  const orderRef = useRef(order);
  orderRef.current = order;
  const nextId = useRef(RING);
  /* which place in the order the next bot to walk on comes from. The row
     reads left to right in the strip's order and travels rightward, so
     the one entering on the left is the one *before* the leftmost —
     the feed walks the order backwards. */
  const feed = useRef(-1);
  const [bots, setBots] = useState<Bot[]>(() =>
    Array.from({ length: RING }, (_, i) => ({ id: i, type: orderRef.current[i % orderRef.current.length] }))
  );
  const botsRef = useRef(bots);
  botsRef.current = bots;
  const [centreId, setCentreId] = useState(() => CENTRE);

  const rowRef = useRef<HTMLDivElement>(null);
  const blurRef = useRef<SVGFEGaussianBlurElement | null>(null);
  const moving = useRef(false);

  useLayoutEffect(() => {
    blurRef.current = document.getElementById("bc-motion-blur-dev") as SVGFEGaussianBlurElement | null;
  }, []);

  const slot = Math.round((cfg.size * cfg.gap) / 100);

  /* One step: the row slides one slot to the right while the bot arriving
     in the middle takes up work and the one leaving it settles back to
     idle; when it lands, the ring rotates and the row resets. */
  const step = useCallback(() => {
    const row = rowRef.current;
    const blur = blurRef.current;
    if (!row || moving.current) return;
    moving.current = true;

    /* the bot one slot to the left is the one about to be in the middle */
    setCentreId(botsRef.current[CENTRE - 1].id);

    const anim = row.animate(
      [
        { transform: "translate(-50%, -50%) translateX(0px)" },
        { transform: `translate(-50%, -50%) translateX(${slot}px)` },
      ],
      { duration: cfg.duration, easing: cfg.ease, fill: "forwards" }
    );
    /* set through the attribute, not React: a re-render mid-step would
       clear a React-owned one and drop the blur */
    row.setAttribute("data-moving", "true");

    /* The blur follows the row's real speed, so it matches whatever
       easing and duration are set. The first reading has to start from
       where the row already is — the row carries a translate(-50%) of its
       own, and starting from zero read that as a leap and flashed the
       blur to full for a frame. */
    let prev = new DOMMatrixReadOnly(getComputedStyle(row).transform).m41;
    let raf = 0;
    const perPx = cfg.blur / Math.max(1, slot / 6); // full blur at a sixth of a slot per frame
    const follow = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(row).transform);
      const dx = Math.abs(m.m41 - prev);
      prev = m.m41;
      if (blur) blur.setAttribute("stdDeviation", `${Math.min(cfg.blur, dx * perPx).toFixed(2)} 0`);
      raf = requestAnimationFrame(follow);
    };
    raf = requestAnimationFrame(follow);

    const land = () => {
      cancelAnimationFrame(raf);
      if (blur) blur.setAttribute("stdDeviation", "0 0");
      row.setAttribute("data-moving", "false");
      moving.current = false;
      /* The bot that has left on the right comes back at the front, which
         leaves the picture exactly as the step ended. The rotation and
         dropping the step's transform have to land in the same frame —
         apart, the row would paint one slot back before the ring caught
         up — so the render is flushed before the animation is cancelled. */
      /* the next type comes off the ring's own counter here, not inside
         the updater: React runs an updater twice in development, and a
         counter bumped in there would skip every other type */
      const id = nextId.current++;
      const len = orderRef.current.length;
      feed.current = ((feed.current % len) + len) % len;
      const type = orderRef.current[feed.current];
      feed.current -= 1;
      flushSync(() => {
        setBots((cur) => [{ id, type }, ...cur.slice(0, -1)]);
      });
      anim.cancel();
    };
    anim.addEventListener("finish", land, { once: true });
  }, [cfg.blur, cfg.duration, cfg.ease, slot]);

  /* the clock: one step every `interval` while playing */
  useEffect(() => {
    if (paused) return;
    const id = setInterval(step, cfg.interval);
    return () => clearInterval(id);
  }, [paused, cfg.interval, step]);

  /* a paused row is left where it is, unblurred */
  useEffect(() => {
    if (!paused) return;
    const blur = blurRef.current;
    if (blur) blur.setAttribute("stdDeviation", "0 0");
  }, [paused]);

  const scale = cfg.centre / 100;

  /* the strip below the stage: every type once, dragged to set the order
     the ring deals them in. Bots already on the stage keep the type they
     arrived with; the next one along takes the new order. */
  const dragFrom = useRef<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const reorder = (from: number, to: number) =>
    setOrder((cur) => {
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  return (
    <>
      <div className="bc-stage" style={{ ["--bc-dur" as string]: `${cfg.duration}ms`, ["--bc-ease" as string]: cfg.ease }}>
        <div className="bc-track">
          <div className="bc-row" ref={rowRef}>
            {bots.map((b) => (
              <div
                key={b.id}
                className="bc-slot"
                style={{
                  width: `${slot}px`,
                  height: `${Math.round(cfg.size * 2.6)}px`,
                  transform: `scale(${b.id === centreId ? scale : 1})`,
                }}
              >
                <BotAvatar
                  type={b.type}
                  size={cfg.size}
                  state={b.id === centreId ? "working" : "default"}
                  interactive={false}
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bc-strip" role="list" aria-label="The order the bots walk in">
        {order.map((type, i) => (
          <div
            key={type}
            role="listitem"
            className="bc-chip"
            draggable
            data-dragging={dragging === i ? "true" : undefined}
            title={`${type} — drag to reorder`}
            onDragStart={(e) => {
              dragFrom.current = i;
              setDragging(i);
              e.dataTransfer.effectAllowed = "move";
              /* an empty drag image: the chip itself moves with the row */
              e.dataTransfer.setDragImage(new Image(), 0, 0);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const from = dragFrom.current;
              if (from === null || from === i) return;
              reorder(from, i);
              dragFrom.current = i;
              setDragging(i);
            }}
            onDrop={(e) => e.preventDefault()}
            onDragEnd={() => {
              dragFrom.current = null;
              setDragging(null);
            }}
          >
            <BotAvatar type={type} size={54} paused interactive={false} />
            <span className="bc-chip-label">{type}</span>
          </div>
        ))}
      </div>

      <div className="bcdev" role="group" aria-label="Carousel controls">
        <div className="bcdev-head">
          <span>Carousel</span>
          <div className="bcdev-actions">
            <button
              type="button"
              className="bcdev-btn"
              aria-pressed={paused}
              data-on={paused ? "true" : undefined}
              onClick={() => setPaused((v) => !v)}
            >
              {paused ? "Play" : "Pause"}
            </button>
            <button type="button" className="bcdev-btn" onClick={() => setCfg(DEFAULTS)}>
              Reset
            </button>
          </div>
        </div>

        <div className="bcdev-row">
          <div className="bcdev-row-head">
            <span>Easing</span>
          </div>
          <select
            className="bcdev-select"
            value={cfg.ease}
            onChange={(e) => setCfg((c) => ({ ...c, ease: e.target.value }))}
          >
            {EASINGS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {ROWS.map(([key, label, min, max, stepBy, unit, hint]) => (
          <div className="bcdev-row" key={key}>
            <div className="bcdev-row-head">
              <span title={hint}>{label}</span>
              <span className="bcdev-val">
                {cfg[key]}
                {unit}
              </span>
            </div>
            <input
              type="range"
              min={min}
              max={max}
              step={stepBy}
              value={cfg[key] as number}
              onChange={(e) => setCfg((c) => ({ ...c, [key]: Number(e.target.value) }))}
            />
          </div>
        ))}

        <p className="bcdev-hint">
          The bot in the middle works; the rest idle. A step moves the row one slot right and the blur follows its
          speed.
        </p>
      </div>
    </>
  );
}

/* One root per container, kept across hot updates: a second createRoot on
   the same element leaves two carousels running on one row. */
const host = document.getElementById("carousel-root") as (HTMLElement & { _root?: Root }) | null;
if (host) {
  host._root = host._root ?? createRoot(host);
  host._root.render(
    <StrictMode>
      <Carousel />
    </StrictMode>
  );
}
