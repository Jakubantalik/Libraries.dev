import { createRoot } from "react-dom/client";
import { POSTERS } from "./posters";
import { useCallback, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, useEffect } from "react";

/* Hero tiles — the five floating library previews, upgraded from static
   links to draggable cards.

   The markup mirrors index.html's static version class for class, so the
   page renders the tiles server-free and this island swaps in the same DOM
   with drag wired on. Positions still come from the stylesheet (the
   .hero-tile--* rules); dragging only writes an offset into CSS vars the
   stylesheet composes with its own hover lift, so the scatter layout and its
   breakpoints stay entirely in CSS. */

interface Tile {
  /* Several clips: the tile plays one of them, chosen on mount. */
  videos?: string[];
  key: string;
  href: string;
  label: string;
}

const TILES: Tile[] = [
  { key: "orb",
    videos: [
      "/assets/videos/orb-small-card-1.mp4",
      "/assets/videos/orb-small-card-2.mp4",
      "/assets/videos/orb-small-card-3.mp4",
    ], href: "/orbs.html", label: "Thinking orbs" },
  { key: "beam",
    videos: ["/assets/videos/beam-small-card.mp4"], href: "/beam.html", label: "Border beam" },
  { key: "metal", videos: ["/assets/videos/metal-small-card.mp4"], href: "/metal.html", label: "Liquid metal" },
  { key: "gooey", videos: ["/assets/videos/gooey-small-card.mp4"], href: "/gooey.html", label: "Gooey" },
  { key: "image", videos: ["/assets/videos/image-small-card.mp4"], href: "/image.html", label: "Image generation" },
];

/* Past this the gesture is a drag, and the click that follows it is not a
   navigation. Below it the pointer wobble of an ordinary click is absorbed. */
const DRAG_SLOP = 4;

const CHEVRON = (
  <svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M4.47 6.22a.75.75 0 0 1 1.06 0L8 8.69l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3 3a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 0 1 0-1.06Z"
      fill="currentColor"
    />
  </svg>
);

interface DragState {
  id: number;
  /* Pointer position minus the tile's current offset, so the offset is a
     plain subtraction on every move. */
  dx: number;
  dy: number;
  moved: boolean;
}

function HeroTile({ tile, bounds }: { tile: Tile; bounds: () => DOMRect | null }) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<DragState | null>(null);
  const ref = useRef<HTMLAnchorElement | null>(null);

  /* Free travel in each direction: the tile may move anywhere inside the
     hero box but never out of it, so a dropped card is always retrievable.
     Measured against the tile's *resting* rect (its live rect already
     carries the current offset). */
  const clamp = useCallback(
    (x: number, y: number) => {
      const box = bounds();
      const el = ref.current;
      if (!box || !el) return { x, y };
      const r = el.getBoundingClientRect();
      const restLeft = r.left - pos.x;
      const restTop = r.top - pos.y;
      return {
        x: Math.max(box.left - restLeft, Math.min(box.right - r.width - restLeft, x)),
        y: Math.max(box.top - restTop, Math.min(box.bottom - r.height - restTop, y)),
      };
    },
    [bounds, pos.x, pos.y],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events have no active pointer */
    }
    drag.current = {
      id: e.pointerId,
      dx: e.clientX - pos.x,
      dy: e.clientY - pos.y,
      moved: false,
    };
    setDragging(true);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLAnchorElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    const next = clamp(e.clientX - d.dx, e.clientY - d.dy);
    if (!d.moved && Math.hypot(next.x - pos.x, next.y - pos.y) > DRAG_SLOP) d.moved = true;
    setPos(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLAnchorElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    setDragging(false);
    /* The click fires after pointerup; a gesture that travelled is not a
       navigation, so mark the tile and let onClick swallow the next one. */
    if (d.moved && ref.current) ref.current.dataset.dragged = "true";
  };

  const onClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    const el = ref.current;
    if (el?.dataset.dragged === "true") {
      e.preventDefault();
      delete el.dataset.dragged;
    }
  };

  /* Chosen once per mount: a Math.random() in render would re-pick on
     every drag update and restart the clip mid-gesture. */
  const [clip] = useState(() =>
    tile.videos && tile.videos.length
      ? tile.videos[Math.floor(Math.random() * tile.videos.length)]
      : null,
  );
  const art = clip ? POSTERS[clip.split("/").pop()!.replace(/\.mp4$/, "")] : undefined;
  /* Blur-up: ready once the sharp poster has decoded (or the clip has a
     frame), at which point the wrapper fades its inline placeholder out. */
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!art) return;
    const img = new Image();
    img.onload = () => setReady(true);
    img.src = art.poster;
  }, [art]);

  const moved = pos.x !== 0 || pos.y !== 0;
  /* The offset rides in CSS vars, not a transform: the stylesheet composes
     them with its own hover lift, so a dropped tile still lifts on hover. */
  const style: CSSProperties | undefined = moved
    ? {
        ["--drag-x" as string]: `${pos.x}px`,
        ["--drag-y" as string]: `${pos.y}px`,
        zIndex: dragging ? 7 : 6,
      }
    : undefined;

  return (
    <a
      ref={ref}
      className={`hero-tile hero-tile--${tile.key}`}
      href={tile.href}
      aria-label={tile.label}
      style={style}
      draggable={false}
      data-dragging={dragging ? "true" : undefined}
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onClick={onClick}
    >
      <span className="hero-tile-stage">
        {clip && (
          <span
            className="vid"
            data-ready={ready ? "" : undefined}
            style={art ? ({ ["--lqip" as string]: `url("${art.lqip}")` } as CSSProperties) : undefined}
          >
          <video
            className="hero-tile-video"
            src={clip}
            poster={art?.poster}
            onLoadedData={() => setReady(true)}
            /* React sets `muted` as a property after the element exists,
               and Chrome's autoplay policy reads the attribute at insertion,
               so a React-rendered muted video can still be refused. Set it
               on the node itself and nudge play() once, swallowing the
               rejection the policy would otherwise throw. */
            ref={(el) => {
              if (!el) return;
              el.muted = true;
              el.defaultMuted = true;
              el.play().catch(() => {});
            }}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
          />
          </span>
        )}
      </span>
      <span className="hero-tile-pill">
        {tile.label} {CHEVRON}
      </span>
    </a>
  );
}

function HeroTiles() {
  const root = useRef<HTMLDivElement | null>(null);
  const bounds = useCallback(() => root.current?.getBoundingClientRect() ?? null, []);

  return (
    <div ref={root} className="hero-tiles-box">
      {TILES.map((t) => (
        <HeroTile key={t.key} tile={t} bounds={bounds} />
      ))}
    </div>
  );
}

const el = document.getElementById("hero-tiles");
if (el) createRoot(el).render(<HeroTiles />);
