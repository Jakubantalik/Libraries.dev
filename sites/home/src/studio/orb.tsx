import { useCallback, useMemo, useState } from "react";
import {
  ThinkingOrb,
  countDots,
  resolvePreset,
  scaleCounts,
  MODE_FRAMES,
  finalizeFrame, makeProj, radiusScale, fibDir, hashD, vnoise, lerp, frac, angleDelta,
  type OrbSize,
  type OrbState,
  type ModeFrame,
  type ModeOpts,
  type OrbFrame,
} from "thinking-orbs";
import { ControlsPanel, PgTabs, PgSlider, PgSwatches, PanelSep, Snippet, num, StageBar, PgGroup } from "./controls";
import { indent, type CoreWiring } from "./core";
import { MAC_ARROW, isMacPointer } from "../examples/macCursor";

/* Gravity draws the platform's pointer, and the raster bundled here is
   the macOS arrow — so the effect only shows on a Mac. */
const GRAVITY_AVAILABLE = isMacPointer();
const GRAVITY_DEFAULTS = { reach: 160, strength: 11, deform: 19, taper: 1.95, curve: 2.8, falloff: 24, smoothing: 0.3, handover: 0.6, squash: 1.2, blur: 1 } as const;

/* ── Rebuilt core: a frame function the agent wrote ───────────────────
   The library's own geometry toolkit is handed in twice — as `h` and as
   bare names — so a body written either way (the contract says h.*, the
   stock source it is shown uses bare names) runs unchanged. */
const FRAME_HELPERS = { finalizeFrame, makeProj, radiusScale, fibDir, hashD, vnoise, lerp, frac, angleDelta };
const HELPER_NAMES = Object.keys(FRAME_HELPERS);
type FrameBody = (size: number, t: number, o: ModeOpts, h: typeof FRAME_HELPERS, ...helpers: unknown[]) => OrbFrame;

function compileFrame(code: string): { fn: ModeFrame } | { error: string } {
  let body: FrameBody;
  try {
    body = new Function("size", "t", "o", "h", ...HELPER_NAMES, code) as FrameBody;
  } catch (e) {
    return { error: `JavaScript syntax: ${(e as Error).message}` };
  }
  const helperValues = Object.values(FRAME_HELPERS);
  return { fn: (size, t, o) => body(size, t, o, FRAME_HELPERS, ...helperValues) };
}

function checkFrame(code: string, opts: ModeOpts): string | null {
  const c = compileFrame(code);
  if ("error" in c) return c.error;
  for (const [size, t] of [[64, 0.7], [20, 3.3]] as const) {
    let out: OrbFrame;
    try {
      out = c.fn(size, t, opts);
    } catch (e) {
      return `the frame function threw at size ${size}: ${(e as Error).message}`;
    }
    if (!out || !Array.isArray(out.dots) || !Array.isArray(out.lines)) {
      return "it did not return { dots, lines } — end with return h.finalizeFrame(dots, lines, o.rMin)";
    }
    if (!out.dots.length && !out.lines.length) return "it returned an empty frame";
    for (const d of out.dots) {
      if (![d.x, d.y, d.z, d.r, d.white].every(Number.isFinite)) return "a dot has a non-finite x, y, z, r or white";
    }
  }
  return null;
}

/* Studio — Orb workbench: all nine states, the tuned sizes, speed, the ink
   tint and dot-density knobs, and — under Effect settings — the engine's
   own per-state options, passed through the library's `opts` prop. The orb
   ships hand-tuned size presets, so the size control stays tabs. */

/* The engine knobs the Studio reaches, by the key the agent spec uses.
   `engine` is the ModeOpts key the library reads; `states` gates which
   state shows (and sends) it; `fallback` is what the engine assumes when
   the preset carries no value. Defaults otherwise come from the resolved
   preset, so every slider starts on the tuned value and the snippet emits
   only real overrides. */
interface EngineKnob {
  engine: string;
  label: string;
  states: ReadonlyArray<OrbState>;
  min: number;
  max: number;
  step: number;
  fallback: number;
  format: (v: number) => string;
}
const SASH: ReadonlyArray<OrbState> = ["composing", "breathing"];
const ENGINE_KNOBS: Record<string, EngineKnob> = {
  spread: { engine: "spread", label: "Spread", states: ["shaping", "connecting"], min: 0.8, max: 2, step: 0.05, fallback: 1, format: (v) => `${num(v)}×` },
  ghostOpacity: { engine: "ghostA", label: "Orbit paths", states: ["working"], min: 0, max: 1, step: 0.05, fallback: 0.5, format: (v) => `${Math.round(v * 100)}%` },
  particles: { engine: "particles", label: "Particles", states: ["working"], min: 1, max: 8, step: 1, fallback: 3, format: (v) => `${v}` },
  scanSpeed: { engine: "scanMul", label: "Scan speed", states: ["searching"], min: 0.5, max: 8, step: 0.1, fallback: 1, format: (v) => `${num(v)}×` },
  scanDim: { engine: "dimBase", label: "Unscanned dots", states: ["searching"], min: 0.1, max: 1, step: 0.05, fallback: 1, format: (v) => `${Math.round(v * 100)}%` },
  linkThreshold: { engine: "thr", label: "Link reach", states: ["connecting"], min: 0.3, max: 1.2, step: 0.02, fallback: 0.72, format: (v) => num(v) },
  signals: { engine: "signals", label: "Signals", states: ["connecting"], min: 0, max: 12, step: 1, fallback: 5, format: (v) => `${v}` },
  lineWidth: { engine: "lineW", label: "Line width", states: ["connecting"], min: 0.3, max: 2.5, step: 0.1, fallback: 0.8, format: (v) => `${num(v)}px` },
  turns: { engine: "turns", label: "Turns", states: ["weaving"], min: 1, max: 6, step: 0.5, fallback: 3, format: (v) => num(v) },
  wobble: { engine: "wobMul", label: "Wobble", states: SASH, min: 0, max: 2.5, step: 0.05, fallback: 1, format: (v) => `${num(v)}×` },
  bandWidth: { engine: "bandMul", label: "Band width", states: SASH, min: 1, max: 6, step: 0.1, fallback: 1, format: (v) => `${num(v)}×` },
  spin: { engine: "spin", label: "Spin", states: SASH, min: 0, max: 2, step: 0.05, fallback: 1, format: (v) => `${num(v)}×` },
};
/* shaping's outline: hold one shape, or the tuned cycle. The engine takes
   the shape's index; anything else keeps cycling. */
const SHAPE_OPTIONS = [
  { value: "cycle", label: "Cycle" },
  { value: "circle", label: "Circle" },
  { value: "triangle", label: "Triangle" },
  { value: "square", label: "Square" },
] as const;
type Shape = (typeof SHAPE_OPTIONS)[number]["value"];
const SHAPE_INDEX: Record<Shape, number> = { cycle: -1, circle: 0, triangle: 1, square: 2 };

/* Empty value = the stock grayscale ink (no `color` prop emitted). */
const INK_OPTIONS = [
  { value: "#ededed", label: "Ink (default)" },
  { value: "#7cd4ff", label: "Sky" },
  { value: "#ffd28f", label: "Amber" },
  { value: "#ff9ec9", label: "Pink" },
  { value: "#9fe8a8", label: "Mint" },
] as const;
const INK_DEFAULT = "#ededed";

const STATE_OPTIONS: ReadonlyArray<{ value: OrbState; label: string }> = [
  "working",
  "searching",
  "solving",
  "listening",
  "connecting",
  "weaving",
  "composing",
  "breathing",
  "shaping",
].map((s) => ({ value: s as OrbState, label: s.charAt(0).toUpperCase() + s.slice(1) }));

const SIZE_OPTIONS = [
  { value: "64", label: "64px" },
  { value: "32", label: "32px" },
  { value: "20", label: "20px" },
] as const;

/* Param key -> the knob's own label, for the agent's applied-change line. */
const ORB_PARAM_LABELS: Record<string, string> = {
  state: "State",
  size: "Size",
  speed: "Speed",
  ink: "Color",
  dots: "Dots amount",
  dotSize: "Dot size",
  shape: "Shape",
  core: "Core",
  gravity: "Cursor gravity",
  gravityReach: "Reach",
  gravityPull: "Tail",
  gravityBend: "Bend",
  gravityTaper: "Taper",
  gravityCurve: "Curve",
  gravityFalloff: "Falloff",
  gravityInertia: "Inertia",
  gravityHandover: "Handover",
  gravitySquash: "Squash",
  gravityBlur: "Blur",
  paused: "Paused",
  ...Object.fromEntries(Object.entries(ENGINE_KNOBS).map(([k, v]) => [k, v.label])),
};

export function OrbStudio({ visible = true, theme = "dark" }: { visible?: boolean; theme?: "dark" | "light" }) {
  const [state, setState] = useState<OrbState>("listening");
  const [size, setSize] = useState<OrbSize>(64);
  const [speed, setSpeed] = useState(100);
  const [ink, setInk] = useState<string>(INK_DEFAULT);
  const [dots, setDots] = useState(1);
  const [dotSize, setDotSize] = useState(1);
  const [paused, setPaused] = useState(false);
  /* Engine overrides, kept per state: composing and breathing both read
     wobMul but with different tuned values, so a wobble set on one must
     not follow the user to the other. Sparse — only touched knobs. */
  const [adv, setAdv] = useState<Partial<Record<OrbState, Record<string, number>>>>({});
  const [shape, setShape] = useState<Shape>("cycle");
  /* The agent's rebuilt frame function, or "" for the stock geometry. It
     belongs to the state it was written for, so choosing another state
     drops it. */
  const [core, setCore] = useState("");
  /* Gravity: the orb pulls the pointer in (see thinking-orbs/gravity.ts). */
  const [gravity, setGravity] = useState(false);
  const [gravityReach, setGravityReach] = useState<number>(GRAVITY_DEFAULTS.reach);
  const [gravityPull, setGravityPull] = useState<number>(GRAVITY_DEFAULTS.strength);
  const [gravityBend, setGravityBend] = useState<number>(GRAVITY_DEFAULTS.deform);
  const [gravityTaper, setGravityTaper] = useState<number>(GRAVITY_DEFAULTS.taper);
  const [gravityCurve, setGravityCurve] = useState<number>(GRAVITY_DEFAULTS.curve);
  const [gravityFalloff, setGravityFalloff] = useState<number>(GRAVITY_DEFAULTS.falloff);
  const [gravityInertia, setGravityInertia] = useState<number>(GRAVITY_DEFAULTS.smoothing);
  const [gravityHandover, setGravityHandover] = useState<number>(GRAVITY_DEFAULTS.handover);
  const [gravitySquash, setGravitySquash] = useState<number>(GRAVITY_DEFAULTS.squash);
  const [gravityBlur, setGravityBlur] = useState<number>(GRAVITY_DEFAULTS.blur);
  const gravityProp = gravity && GRAVITY_AVAILABLE
    ? { sprite: MAC_ARROW, reach: gravityReach, strength: gravityPull, deform: gravityBend, taper: gravityTaper, curve: gravityCurve, falloff: gravityFalloff, smoothing: gravityInertia, handover: gravityHandover, squash: gravitySquash, blur: gravityBlur }
    : false;
  const customFrame = useMemo<ModeFrame | undefined>(() => {
    if (!core) return undefined;
    const c = compileFrame(core);
    return "error" in c ? undefined : c.fn;
  }, [core]);
  const chooseState = useCallback((next: OrbState) => {
    setState(next);
    setCore("");
  }, []);

  const resolved = resolvePreset(state, size);
  const dotTotal = countDots(scaleCounts(resolved.opts, Math.max(0.1, dots)));
  const advFor = adv[state] ?? {};
  const knobDefault = (key: string) => resolved.opts[ENGINE_KNOBS[key].engine] ?? ENGINE_KNOBS[key].fallback;
  const knobValue = (key: string) => advFor[key] ?? knobDefault(key);
  const setKnob = (key: string, v: number) =>
    setAdv((prev) => ({ ...prev, [state]: { ...(prev[state] ?? {}), [key]: v } }));
  const liveKnobs = Object.keys(ENGINE_KNOBS).filter((k) => ENGINE_KNOBS[k].states.includes(state));

  /* What actually reaches the library: engine keys, overrides only. */
  const engineOpts: Record<string, number> = {};
  for (const k of liveKnobs) {
    const v = knobValue(k);
    if (v !== knobDefault(k)) engineOpts[ENGINE_KNOBS[k].engine] = v;
  }
  if (state === "shaping" && shape !== "cycle") engineOpts.shape = SHAPE_INDEX[shape];
  const hasOpts = Object.keys(engineOpts).length > 0;


  /* Agent wiring — keys match the Worker's spec, which owns the ranges and
     rejects anything outside them. `size` arrives as a string, since the
     library only offers two hand-tuned presets rather than a range. */
  const agentParams: Record<string, unknown> = {
    state, size: String(size), speed, ink, dots, dotSize, paused, core,
    gravity, gravityReach, gravityPull, gravityBend, gravityTaper, gravityCurve, gravityFalloff, gravityInertia, gravityHandover, gravitySquash, gravityBlur,
    ...(state === "shaping" ? { shape } : {}),
    ...Object.fromEntries(liveKnobs.map((k) => [k, knobValue(k)])),
  };

  /* A patch that switches state and tunes that state's knobs in one call
     must land the knobs on the NEW state, so the target state is read
     from the patch first and the overrides are written under it. */
  const applyAgentParams = useCallback((patch: Record<string, unknown>) => {
    const target = typeof patch.state === "string" ? (patch.state as OrbState) : null;
    if (target) setState(target);
    if (typeof patch.core === "string") setCore(patch.core);
    else if (target && target !== state) setCore("");
    if (typeof patch.size === "string") setSize(Number(patch.size) as OrbSize);
    if (typeof patch.speed === "number") setSpeed(patch.speed);
    if (typeof patch.ink === "string") setInk(patch.ink);
    if (typeof patch.dots === "number") setDots(patch.dots);
    if (typeof patch.dotSize === "number") setDotSize(patch.dotSize);
    if (typeof patch.shape === "string" && patch.shape in SHAPE_INDEX) setShape(patch.shape as Shape);
    if (typeof patch.gravity === "boolean") setGravity(patch.gravity);
    if (typeof patch.gravityReach === "number") setGravityReach(patch.gravityReach);
    if (typeof patch.gravityPull === "number") setGravityPull(patch.gravityPull);
    if (typeof patch.gravityBend === "number") setGravityBend(patch.gravityBend);
    if (typeof patch.gravityTaper === "number") setGravityTaper(patch.gravityTaper);
    if (typeof patch.gravityCurve === "number") setGravityCurve(patch.gravityCurve);
    if (typeof patch.gravityFalloff === "number") setGravityFalloff(patch.gravityFalloff);
    if (typeof patch.gravityInertia === "number") setGravityInertia(patch.gravityInertia);
    if (typeof patch.gravityHandover === "number") setGravityHandover(patch.gravityHandover);
    if (typeof patch.gravitySquash === "number") setGravitySquash(patch.gravitySquash);
    if (typeof patch.gravityBlur === "number") setGravityBlur(patch.gravityBlur);
    if (typeof patch.paused === "boolean") setPaused(patch.paused);
    const knobs = Object.entries(patch).filter(([k, v]) => k in ENGINE_KNOBS && typeof v === "number") as Array<[string, number]>;
    if (knobs.length) {
      setAdv((prev) => {
        const at = target ?? state;
        return { ...prev, [at]: { ...(prev[at] ?? {}), ...Object.fromEntries(knobs) } };
      });
    }
  }, [state]);

  const coreWiring: CoreWiring = {
    lang: "js",
    source: () =>
      `// Stock frame function for state "${state}" (engine mode "${resolved.mode}"). The helpers it calls by bare name are the same ones on h.\n` +
      MODE_FRAMES[resolved.mode].toString(),
    check: (code) => checkFrame(code, resolved.opts),
  };

  const tinted = ink !== INK_DEFAULT;
  const props = [`state="${state}"`, `size={${size}}`];
  if (speed !== 100) props.push(`speed={${num(speed / 100)}}`);
  if (tinted) props.push(`color="${ink}"`);
  if (dots !== 1) props.push(`dots={${num(dots)}}`);
  if (dotSize !== 1) props.push(`dotSize={${num(dotSize)}}`);
  if (hasOpts) {
    props.push(`opts={{ ${Object.entries(engineOpts).map(([k, v]) => `${k}: ${num(v)}`).join(", ")} }}`);
  }
  if (core) props.push("frame={frame}");
  if (gravity) {
    const g: string[] = ["sprite: macArrow"];
    if (gravityReach !== GRAVITY_DEFAULTS.reach) g.push(`reach: ${num(gravityReach)}`);
    if (gravityPull !== GRAVITY_DEFAULTS.strength) g.push(`strength: ${num(gravityPull)}`);
    if (gravityBend !== GRAVITY_DEFAULTS.deform) g.push(`deform: ${num(gravityBend)}`);
    if (gravityTaper !== GRAVITY_DEFAULTS.taper) g.push(`taper: ${num(gravityTaper)}`);
    if (gravityCurve !== GRAVITY_DEFAULTS.curve) g.push(`curve: ${num(gravityCurve)}`);
    if (gravityFalloff !== GRAVITY_DEFAULTS.falloff) g.push(`falloff: ${num(gravityFalloff)}`);
    if (gravityInertia !== GRAVITY_DEFAULTS.smoothing) g.push(`smoothing: ${num(gravityInertia)}`);
    if (gravityHandover !== GRAVITY_DEFAULTS.handover) g.push(`handover: ${num(gravityHandover)}`);
    if (gravitySquash !== GRAVITY_DEFAULTS.squash) g.push(`squash: ${num(gravitySquash)}`);
    if (gravityBlur !== GRAVITY_DEFAULTS.blur) g.push(`blur: ${num(gravityBlur)}`);
    props.push(`gravity={{ ${g.join(", ")} }}`);
  }
  const snippet = core
    ? `import { ThinkingOrb, ${HELPER_NAMES.join(", ")} } from 'thinking-orbs';\n\n` +
      `const h = { ${HELPER_NAMES.join(", ")} };\nconst frame = (size, t, o) => {\n${indent(core)}\n};\n\n` +
      `<ThinkingOrb ${props.join(" ")} />`
    : `import { ThinkingOrb } from 'thinking-orbs';\n${gravity ? "// A raster of the platform's own pointer — see the Gravity docs.\nimport { macArrow } from './cursors';\n" : ""}\n<ThinkingOrb ${props.join(" ")} />`;

  /* The ports take state / size / theme / speed / paused only
     (thinking-orbs-native/src/types.ts, ThinkingOrbsKit/ThinkingOrb.swift):
     the web-only color tint and dot-count multiplier are left out, and
     size 32 has no port preset — the tuned presets are 64 and 20 — so the
     snippet falls back to 64 and says so. Both ports default to theme
     auto, so no theme is written. */
  const portSize: 64 | 20 = size === 20 ? 20 : 64;
  const sizeNote = size === 32 ? "// size 32 is web-only; the ports ship the 64 and 20 presets\n" : "";
  const rn: string[] = [`state="${state}"`, `size={${portSize}}`];
  if (speed !== 100) rn.push(`speed={${num(speed / 100)}}`);
  if (paused) rn.push("paused");
  const rnSnippet = `import { ThinkingOrb } from 'thinking-orbs-native';\n\n${sizeNote}<ThinkingOrb ${rn.join(" ")} />`;
  const sw: string[] = [`state: .${state}`, `size: .px${portSize}`];
  if (speed !== 100) sw.push(`speed: ${num(speed / 100)}`);
  if (paused) sw.push("paused: true");
  const swiftSnippet = `import ThinkingOrbsKit\n\n${sizeNote}ThinkingOrb(${sw.join(", ")})`;

  const platforms = [
    {
      id: "rn",
      label: "React Native",
      installTitle: "Install thinking-orbs-native with Skia and Reanimated",
      install: "npm install thinking-orbs-native @shopify/react-native-skia react-native-reanimated",
      note: "thinking-orbs-native is not on npm yet — it lives in this repo at packages/thinking-orbs/ports/react-native/thinking-orbs-native. Expo needs expo run:ios / run:android (native modules).",
      usage: rnSnippet,
    },
    {
      id: "swift",
      label: "Swift UI",
      installTitle: "Add ThinkingOrbsKit as a local Swift package (iOS 15+, no dependencies)",
      install: `// Package.swift — or Xcode: File › Add Package Dependencies… › Add Local…\n.package(path: "packages/thinking-orbs/ports/ios/ThinkingOrbsKit")`,
      usage: swiftSnippet,
    },
  ];

  return (
    <div className="pg">
      <StageBar library="Thinking orbs" prompt={{ pkg: "thinking-orbs", docsPath: "/orbs.html", snippet, platforms }} agent={{ libraryId: "orb", params: agentParams, labels: ORB_PARAM_LABELS, onApply: applyAgentParams }} />
      <div className="pg-stage">
        {/* key remounts the canvas on state/size change, matching the live playground */}
        {visible && (
          <ThinkingOrb
            key={`${state}-${size}`}
            state={state}
            size={size}
            speed={speed / 100}
            color={tinted ? ink : undefined}
            dots={dots}
            dotSize={dotSize}
            opts={hasOpts ? engineOpts : undefined}
            frame={customFrame}
            gravity={gravityProp}
            paused={paused}
            theme={theme}
          />
        )}
        <button
          type="button"
          className="btn-animate pg-play"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={!paused}
        >
          {paused ? "Play" : "Pause"}
        </button>
      </div>

      <ControlsPanel
        library="Thinking orbs"
        agent={{
          libraryId: "orb",
          params: agentParams,
          labels: ORB_PARAM_LABELS,
          onApply: applyAgentParams,
          core: coreWiring,
        }}
      >
        <PgTabs label="State" options={STATE_OPTIONS} value={state} onChange={chooseState} />
        <PgTabs
          label="Size"
          options={SIZE_OPTIONS}
          value={String(size) as "64" | "32" | "20"}
          onChange={(v) => setSize(Number(v) as OrbSize)}
        />
        <PgGroup label="Motion">
          <PgSlider
            label="Speed"
            value={speed}
            min={25}
            max={300}
            step={5}
            display={`${num(speed / 100)}×`}
            onChange={setSpeed}
          />
        </PgGroup>
        <PanelSep />
        <PgGroup label="Dots">
          <PgSwatches label="Color" options={INK_OPTIONS} value={ink} onChange={setInk} allowCustom hideLabel />
        {/* The library scales every count knob of a state together, so the
            prop is a multiplier — but a multiplier is a poor thing to aim
            with. The slider reads out the dots the current state and size
            will actually draw, recomputed as either of those changes. */}
          <PgSlider
            label="Dots amount"
            value={dots}
            min={0.4}
            max={2}
            step={0.05}
            display={`${dotTotal}`}
            onChange={setDots}
          />
          <PgSlider label="Dot size" value={dotSize} min={0.5} max={2} step={0.05} display={`${num(dotSize)}×`} onChange={setDotSize} />
        </PgGroup>
        <PanelSep />
        {/* The orb pulling the pointer in. Draws the platform's own
            pointer, and the raster here is the macOS arrow. */}
        <PgGroup label="Cursor gravity">
          <PgTabs
            label="Cursor gravity"
            options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }] as const}
            value={gravity ? "on" : "off"}
            onChange={(v) => setGravity(v === "on")}
          />
          {gravity && !GRAVITY_AVAILABLE && (
            <span className="pg-note">Draws the macOS pointer, so it only shows on a Mac.</span>
          )}
          {gravity && (
            <>
              <PgSlider label="Reach" value={gravityReach} min={24} max={240} step={4} display={`${gravityReach}px`} onChange={setGravityReach} />
              <PgSlider label="Tail" value={gravityPull} min={0} max={48} step={1} display={`${gravityPull}px`} onChange={setGravityPull} />
              <PgSlider label="Bend" value={gravityBend} min={0} max={24} step={0.5} display={`${num(gravityBend)}px`} onChange={setGravityBend} />
              <PgSlider label="Taper" value={gravityTaper} min={1} max={4} step={0.05} display={`${num(gravityTaper)}`} onChange={setGravityTaper} />
              <PgSlider label="Curve" value={gravityCurve} min={1} max={4} step={0.05} display={`${num(gravityCurve)}`} onChange={setGravityCurve} />
              <PgSlider label="Falloff" value={gravityFalloff} min={2} max={120} step={2} display={`${gravityFalloff}px`} onChange={setGravityFalloff} />
              <PgSlider label="Inertia" value={gravityInertia} min={0} max={1} step={0.05} display={`${Math.round(gravityInertia * 100)}%`} onChange={setGravityInertia} />
              <PgSlider label="Handover" value={gravityHandover} min={0} max={1} step={0.05} display={`${Math.round(gravityHandover * 100)}%`} onChange={setGravityHandover} />
              <PgSlider label="Squash" value={gravitySquash} min={0} max={3} step={0.05} display={`${gravitySquash.toFixed(2)}×`} onChange={setGravitySquash} />
              <PgSlider label="Blur" value={gravityBlur} min={0} max={24} step={0.5} display={`${gravityBlur}px`} onChange={setGravityBlur} />
            </>
          )}
        </PgGroup>
        {/* The engine's own knobs for this state, on top of its tuned
            preset — the same reach the agent has. Listening and solving
            expose none, so the section stays out rather than sit empty. */}
        {(liveKnobs.length > 0 || state === "shaping") && (
          <>
            <PanelSep />
            <PgGroup label="Effect settings">
              {state === "shaping" && (
                <PgTabs label="Shape" options={SHAPE_OPTIONS} value={shape} onChange={setShape} />
              )}
              {liveKnobs.map((k) => {
                const knob = ENGINE_KNOBS[k];
                const v = knobValue(k);
                return (
                  <PgSlider key={k} label={knob.label} value={v} min={knob.min} max={knob.max} step={knob.step} display={knob.format(v)} onChange={(n) => setKnob(k, n)} />
                );
              })}
            </PgGroup>
          </>
        )}
      </ControlsPanel>

      <Snippet code={snippet} />
    </div>
  );
}
