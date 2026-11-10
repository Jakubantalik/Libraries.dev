import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { BorderBeam } from "border-beam";
import { duration, makeParticles, particleAt, rimLumps, waveFront, type Point, type Rect, type WaveStyle } from "./model";
import { WaveRenderer, type DotBuffer } from "./renderer";
import { drawSheet, drawTransfer, LAYOUT, PHONE, sceneImagesReady, screenCanvas, SHEET } from "./scenes";
import "./preview.css";

/* Distortion waves — the live preview: the SwiftUI demo's prototypes on the
   stage's phone, the wave drawn by the WebGL port of the library.

   - Vertical: the transfer review; Confirm sends the wave up the screen.
   - Horizontal: the same screen; the handle on the left edge sends it across.
   - Center: the USDC sheet; Send processes for a moment, then a ring of
     green leaves the token as it becomes the success check.

   As in the app, the screen morphs in place while the wave passes over it,
   and every change keeps the app's timing from the moment of the touch: one
   clock drives the screen, the wave, the button's title and its beam. The
   screen is redrawn (and its texture refilled) only while something on it
   moves. Touch the source to send one; Play sends them on a loop; the
   success state holds, then the screen goes straight back to its review. */

export interface PreviewProps {
  style: WaveStyle;
  /** Send a wave every time the screen is back at rest. */
  playing: boolean;
  /** Seconds the success state holds before the screen resets. */
  resetAfter?: number;
  /** Seconds the sheet says Processing… before the ring (center). */
  processing?: number;
}

/** The text changes this long before the badge, as the app's textLead. */
const TEXT_LEAD = 0.2;

/** When each thing happens, s from the touch, for this style. */
function timeline(style: WaveStyle, processing: number) {
  const center = style.type === "center";
  const waveStart = center ? processing : 0;
  const launch = waveStart + style.anticipation;
  // Just after the front has passed the hero (or left the token).
  const morph = launch + style.travel * (center ? 0.03 : 0.18);
  return {
    waveStart,
    morph,
    text: Math.max(morph - TEXT_LEAD, waveStart),
    // The beam goes out once the screen is readable again, as the app's phase.
    beamOff: launch + style.travel * 0.8,
    end: waveStart + duration(style),
  };
}

/** The stage's zoom on this node (0.7 on the phone): the backing store must
    match what is on screen, not the layout size. */
function zoomOf(el: HTMLElement | null) {
  if (!el) return 1;
  const z = parseFloat((getComputedStyle(el) as CSSStyleDeclaration & { zoom?: string }).zoom || "1");
  return Number.isFinite(z) && z > 0 ? z : 1;
}

export function DistortionWavePreview({ style, playing, resetAfter = 2, processing = 1.2 }: PreviewProps) {
  const type = style.type;
  const center = type === "center";
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WaveRenderer | null>(null);
  const styleRef = useRef(style);
  styleRef.current = style;
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const optsRef = useRef({ resetAfter, processing });
  optsRef.current = { resetAfter, processing };
  const [scale, setScale] = useState(0);
  const [title, setTitle] = useState("Confirm");
  const [lit, setLit] = useState(false);
  const [gulp, setGulp] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Bumped on every reset: the title remounts, so it goes back in one
      frame, as the app's reset does. */
  const [resets, setResets] = useState(0);

  /** The run: when it started (null at rest), its focus, its frame and timers. */
  const run = useRef({ start: null as number | null, focus: null as Point | null, raf: 0, timers: [] as number[], drawnUntil: -1 });
  const screenRef = useRef<ReturnType<typeof screenCanvas> | null>(null);

  const area = center ? { w: SHEET.w, h: SHEET.h } : { w: PHONE.w, h: PHONE.h };
  const source: Rect = center
    ? { x: LAYOUT.token.x, y: LAYOUT.token.y, w: LAYOUT.token.w, h: LAYOUT.token.h }
    : type === "horizontal"
      ? { x: LAYOUT.edge.x, y: LAYOUT.edge.y, w: LAYOUT.edge.w, h: LAYOUT.edge.h }
      : { x: LAYOUT.button.x, y: LAYOUT.button.y, w: LAYOUT.button.w, h: LAYOUT.button.h };
  const sourceRef = useRef(source);
  sourceRef.current = source;

  /* The particles, remade only when their count, size or life moves. */
  const particlesRef = useRef<{ key: string; list: ReturnType<typeof makeParticles>; buf: DotBuffer }>({ key: "", list: [], buf: { data: new Float32Array(0), count: 0 } });
  const pKey = `${style.particleCount}|${style.particleSize}|${style.particleLife}`;
  if (particlesRef.current.key !== pKey) {
    const list = makeParticles(style);
    particlesRef.current = { key: pKey, list, buf: { data: new Float32Array(Math.max(list.length, 1) * 3), count: 0 } };
  }

  /* The backing resolution: what the phone shows, times the device's pixels. */
  useLayoutEffect(() => {
    const read = () => setScale(Math.min(zoomOf(rootRef.current) * (window.devicePixelRatio || 1), 3));
    read();
    const stage = rootRef.current?.parentElement;
    const watch = new MutationObserver(read);
    if (stage) watch.observe(stage, { attributes: true, attributeFilter: ["data-device"] });
    window.addEventListener("resize", read);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", read);
    };
  }, []);

  /* The renderer, for as long as the canvas is mounted. */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let r: WaveRenderer | null = null;
    try {
      r = new WaveRenderer(canvas);
    } catch (e) {
      console.warn("distortion-waves:", e);
    }
    if (!r || !r.ok) {
      setFailed(true);
      return;
    }
    rendererRef.current = r;
    return () => {
      cancelAnimationFrame(run.current.raf);
      r?.dispose();
      rendererRef.current = null;
    };
  }, [center]);

  /** Draws the screen as it is `elapsed` s after the touch (null: at rest) and
      hands it to the renderer. */
  const paintScreen = (elapsed: number | null) => {
    const r = rendererRef.current;
    const scr = screenRef.current;
    if (!r || !scr) return;
    const tl = timeline(styleRef.current, optsRef.current.processing);
    const since = (at: number) => (elapsed !== null && elapsed >= at ? elapsed - at : null);
    if (center) {
      drawSheet(scr.ctx, { tap: elapsed, text: since(tl.text), badge: since(tl.morph), clock: elapsed ?? 0 });
    } else {
      drawTransfer(scr.ctx, { text: since(tl.text), badge: since(tl.morph) });
    }
    r.setScreen(scr.c, area.w, area.h, styleRef.current.blur);
  };

  /** One frame of the run, `elapsed` s after the touch. */
  const frame = (elapsed: number) => {
    const r = rendererRef.current;
    if (!r) return;
    const s = styleRef.current;
    const tl = timeline(s, optsRef.current.processing);
    // The screen moves from the touch (the sheet) or the text morph (the
    // transfer) until the badge has landed; then it holds still.
    const from = center ? 0 : tl.text;
    const until = tl.morph + 0.95;
    if (elapsed >= from && run.current.drawnUntil < until) {
      paintScreen(elapsed);
      if (elapsed >= until) run.current.drawnUntil = until;
    }
    r.setBlur(s.blur);
    const total = duration(s);
    const wp = (elapsed - tl.waveStart) / total;
    const lumps = rimLumps(Math.max(wp, 0) * total, area.w, area.h, s.cornerRadius, s.rimPulse);
    if (wp <= 0 || wp >= 1) {
      r.render(null, s, lumps, null);
      return;
    }
    const src = sourceRef.current;
    const front = waveFront(wp, src, area.w, area.h, s, run.current.focus);
    const buf = particlesRef.current.buf;
    let n = 0;
    if (front.time > 0) {
      for (const part of particlesRef.current.list) {
        const at = particleAt(part, front, src, s);
        if (at.a <= 0.002) continue;
        buf.data[n * 3] = at.x;
        buf.data[n * 3 + 1] = at.y;
        buf.data[n * 3 + 2] = Math.floor(part.size * 10) + Math.min(at.a, 0.999);
        n++;
      }
    }
    buf.count = n;
    r.render(front, s, lumps, buf);
  };

  const clearTimers = () => {
    run.current.timers.forEach((t) => clearTimeout(t));
    run.current.timers = [];
  };
  const later = (seconds: number, fn: () => void) => {
    run.current.timers.push(window.setTimeout(fn, seconds * 1000));
  };

  /** Straight back to the review, in one frame. */
  const toRest = () => {
    cancelAnimationFrame(run.current.raf);
    clearTimers();
    run.current.start = null;
    run.current.drawnUntil = -1;
    setTitle("Confirm");
    setLit(false);
    setGulp(false);
    setSending(false);
    setResets((n) => n + 1);
    paintScreen(null);
    const s = styleRef.current;
    rendererRef.current?.render(null, s, rimLumps(0, area.w, area.h, s.cornerRadius, 0), null);
    if (playingRef.current) later(0.9, () => send(null));
  };

  const tick = () => {
    const start = run.current.start;
    if (start === null || start < 0) return;
    const elapsed = (performance.now() - start) / 1000;
    frame(elapsed);
    const tl = timeline(styleRef.current, optsRef.current.processing);
    if (elapsed < tl.end) {
      run.current.raf = requestAnimationFrame(tick);
    } else {
      later(optsRef.current.resetAfter, toRest);
    }
  };

  function send(focus: Point | null) {
    if (run.current.start !== null || !rendererRef.current) return;
    clearTimers();
    const s = styleRef.current;
    const tl = timeline(s, optsRef.current.processing);
    run.current.focus = focus;
    run.current.start = performance.now();
    run.current.drawnUntil = -1;
    setSending(true);
    if (!center) {
      setLit(type === "vertical");
      setGulp(true);
      later(s.anticipation, () => setGulp(false));
      later(tl.morph, () => setTitle("Done"));
      later(tl.beamOff, () => setLit(false));
    }
    cancelAnimationFrame(run.current.raf);
    run.current.raf = requestAnimationFrame(tick);
  }

  /* A new type or size: a fresh screen, back at the review. */
  useEffect(() => {
    if (!scale) return;
    screenRef.current = screenCanvas(area.w, area.h, scale);
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = screenRef.current.c.width;
      canvas.height = screenRef.current.c.height;
    }
    toRest();
    return () => {
      cancelAnimationFrame(run.current.raf);
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, scale]);

  /* Play starts the loop from rest; Pause lets the current wave finish. */
  useEffect(() => {
    if (playing && run.current.start === null) send(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  /* At rest, a style change shows at once (the blur, the corners). */
  useEffect(() => {
    if (run.current.start === null && screenRef.current) {
      paintScreen(null);
      const s = styleRef.current;
      rendererRef.current?.render(null, s, rimLumps(0, area.w, area.h, s.cornerRadius, 0), null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [style]);

  /* Maya's photo decodes after the first paint: show it on the resting
     screen as soon as it has. */
  useEffect(() => {
    let live = true;
    sceneImagesReady.then(() => {
      if (!live || run.current.start !== null || !screenRef.current) return;
      paintScreen(null);
      const s = styleRef.current;
      rendererRef.current?.render(null, s, rimLumps(0, area.w, area.h, s.cornerRadius, 0), null);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Dev only: draw any moment of the wave (0–1 of its own duration), for
     checking frames without animating — a hidden tab runs no frames. */
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __dwScrub?: (p: number) => void };
    w.__dwScrub = (p: number) => {
      cancelAnimationFrame(run.current.raf);
      clearTimers();
      run.current.start = -1;
      const s = styleRef.current;
      const tl = timeline(s, optsRef.current.processing);
      const elapsed = tl.waveStart + p * duration(s);
      paintScreen(elapsed);
      run.current.drawnUntil = Infinity;
      frame(elapsed);
    };
    return () => {
      delete w.__dwScrub;
    };
  });

  const touch = (e: React.PointerEvent) => {
    const root = rootRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const k = PHONE.w / box.width;
    send({ x: (e.clientX - box.left) * k, y: (e.clientY - box.top) * k });
  };

  const px = (v: number) => `${v}px`;
  const rootStyle: CSSProperties = { position: "relative", width: px(PHONE.w), height: px(PHONE.h), borderRadius: px(PHONE.radius), overflow: "hidden", background: center ? "#000" : "#0D0D0D", flex: "none" };

  if (failed) {
    return (
      <div ref={rootRef} style={{ ...rootStyle, display: "grid", placeItems: "center", color: "#8F8F8F", font: "500 15px Inter, system-ui" }}>
        This preview needs WebGL 2.
      </div>
    );
  }

  return (
    <div ref={rootRef} className="dw-phone" style={rootStyle}>
      {center && <Backdrop />}
      <div
        className="dw-area"
        style={center
          ? { position: "absolute", left: px(SHEET.x), top: px(SHEET.y), width: px(SHEET.w), height: px(SHEET.h), borderRadius: px(SHEET.radius), overflow: "hidden", boxShadow: "inset 0 0 0 1px rgba(235,235,235,0.1)" }
          : { position: "absolute", inset: 0 }}
      >
        <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }} />
        {center && (
          <>
            <button type="button" className="dw-hit" aria-label="Send" onPointerDown={touch} style={hit(LAYOUT.sheetButton)} />
            <button type="button" className="dw-hit" aria-label="Close" onClick={toRest} style={hit({ x: SHEET.w - 62, y: 20, w: 42, h: 42 })} />
          </>
        )}
      </div>
      {!center && (
        <div className="dw-button-wrap" style={{ left: px(LAYOUT.button.x), top: px(LAYOUT.button.y), width: px(LAYOUT.button.w), height: px(LAYOUT.button.h) }}>
          {/* The beam on the light button and its glow spilling onto the dark
              page, as the app's SendButton, while the wave is out. */}
          <BorderBeam size="pulse-outside" colorVariant="colorful" theme="dark" active={lit} borderRadius={29} style={{ width: "100%", height: "100%" }}>
            <BorderBeam size="md" colorVariant="colorful" theme="light" duration={1.6} active={lit} borderRadius={29} style={{ width: "100%", height: "100%" }}>
              <button
                type="button"
                className={`dw-button${gulp && type === "vertical" ? " is-gulp" : ""}`}
                onPointerDown={touch}
                style={{ ["--dw-gulp" as string]: `${style.anticipation}s` }}
              >
                <span key={`${title}${title === "Confirm" ? resets : ""}`} className={`dw-button-title${title === "Done" ? " is-swapped" : ""}`}>{title}</span>
              </button>
            </BorderBeam>
          </BorderBeam>
        </div>
      )}
      {type === "horizontal" && (
        <button
          type="button"
          className={`dw-edge${sending ? " is-lit" : ""}`}
          aria-label="Send from the edge"
          onPointerDown={touch}
          style={{ left: 0, top: px(LAYOUT.edge.y), width: px(44), height: px(LAYOUT.edge.h) }}
        />
      )}
      <div className="dw-island" aria-hidden="true" />
    </div>
  );
}

const hit = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({
  position: "absolute",
  left: `${r.x}px`,
  top: `${r.y}px`,
  width: `${r.w}px`,
  height: `${r.h}px`,
  background: "transparent",
  border: 0,
  padding: 0,
  cursor: "pointer",
});

/** The home screen behind the sheet: blurred, under the design's 80% scrim. */
function Backdrop() {
  const blob = (left: number, top: number, w: number, h: number, color: string, r = 20): CSSProperties => ({ position: "absolute", left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px`, borderRadius: `${r}px`, background: color });
  return (
    <div aria-hidden="true" style={{ position: "absolute", inset: 0, background: "#000", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, filter: "blur(12px)" }}>
        <div style={blob(20, 69, 40, 40, "#8CC46A", 20)} />
        <div style={blob(68, 69, 80, 40, "#AB9FF2")} />
        <div style={blob(156, 69, 80, 40, "#171717")} />
        <div style={blob(244, 69, 80, 40, "#171717")} />
        <div style={blob(20, 143, 110, 22, "#2a2a2a", 6)} />
        <div style={blob(20, 171, 190, 52, "#e8e8e8", 10)} />
        <div style={blob(20, 229, 70, 20, "#f0182e", 6)} />
        <div style={blob(98, 229, 64, 22, "#f0182e", 6)} />
        <div style={blob(20, 281, 170, 50, "#171717", 25)} />
        <div style={blob(199, 281, 170, 50, "#171717", 25)} />
      </div>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)" }} />
    </div>
  );
}
