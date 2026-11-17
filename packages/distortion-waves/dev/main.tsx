/* The bench for the React wave: three scenes, every switch, and a run that
   times its own frames and reports them to the dev server (see
   vite.config.ts), so any browser can be measured by opening one URL.

     ?scene=send|board|table   what the wave crosses
     ?type=vertical|center|horizontal
     ?w=860&h=540              the element's size
     ?scale=1                  CSS pixels per point (default auto)
     ?capture=0                colour only, no lens
     ?overlay=1                the send button above the wave, left as it is
     ?scrub=0.4                hold the wave there
     ?auto=1&cycles=3&tag=…    run the timing and POST it to /__stats
     ?types=vertical,center    with auto: one type after another in this tab,
                               each reported as <tag>-<type>
     ?control=8000             how long the plain-canvas baseline runs (ms)   */

import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DistortionWave, type DistortionWaveHandle, type WaveType } from "distortion-waves";

const query = new URLSearchParams(location.search);
const SCENES = ["send", "board", "table"] as const;
const TYPES = ["vertical", "center", "horizontal"] as const;
type Scene = (typeof SCENES)[number];

function pick<T extends string>(key: string, all: readonly T[], fallback: T): T {
  const v = query.get(key) as T | null;
  return v && all.includes(v) ? v : fallback;
}
function number(key: string, fallback: number): number {
  const v = Number(query.get(key));
  return query.has(key) && isFinite(v) ? v : fallback;
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** The types still to time in this tab, the one on screen first. */
const QUEUE = (query.get("types") ?? "").split(",").filter((t): t is (typeof TYPES)[number] => (TYPES as readonly string[]).includes(t));

// ─── Scenes ───

function Review({ onSend, bare }: { onSend: () => void; bare?: boolean }) {
  return (
    <div className="view">
      <div className="head">
        <h2>Review transfer</h2>
        <button className="ghost" aria-label="Close">
          ×
        </button>
      </div>
      <div className="body">
        <div className="sum">
          <div className="amount">
            $240<small>.00</small>
          </div>
          <div className="to">
            <div className="avatar">MC</div>
            <div>
              <b>Maya Chen</b>
              <span>maya@hey.com</span>
            </div>
          </div>
          <div className="note">“Dinner on Friday, and the tickets. Thanks for sorting it.”</div>
        </div>
        <div className="rows">
          <div className="row">
            <span>From</span>
            <b>Checking ·· 4821</b>
          </div>
          <div className="row">
            <span>Arrives</span>
            <b>Today, in seconds</b>
          </div>
          <div className="row">
            <span>Fee</span>
            <b>Free</b>
          </div>
          <div className="row">
            <span>Balance after</span>
            <b>$3,912.40</b>
          </div>
        </div>
      </div>
      <div className="foot">
        <button className="secondary">Edit</button>
        <button className="primary" onClick={onSend} style={bare ? { visibility: "hidden" } : undefined}>
          Send $240
        </button>
      </div>
    </div>
  );
}

function Receipt({ onDone, bare }: { onDone: () => void; bare?: boolean }) {
  return (
    <div className="view receipt">
      <div className="head">
        <h2>Receipt</h2>
        <button className="ghost" aria-label="Share">
          ↗
        </button>
      </div>
      <div className="body">
        <div className="done">
          <div className="tick">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h3>$240 sent to Maya</h3>
          <p>It is in her account now. We have emailed you both a copy of this receipt.</p>
        </div>
        <div className="rows">
          <div className="row">
            <span>Reference</span>
            <b>TX-88213-MC</b>
          </div>
          <div className="row">
            <span>Sent</span>
            <b>16 Nov, 13:07</b>
          </div>
          <div className="row">
            <span>From</span>
            <b>Checking ·· 4821</b>
          </div>
          <div className="row">
            <span>Balance</span>
            <b>$3,912.40</b>
          </div>
        </div>
      </div>
      <div className="foot">
        <button className="secondary">Send again</button>
        <button className="primary" onClick={onDone} style={bare ? { visibility: "hidden" } : undefined}>
          Done
        </button>
      </div>
    </div>
  );
}

function Board({ onGo }: { onGo: () => void }) {
  return (
    <div className="board">
      <div className="head">
        <h2>This week</h2>
        <button className="ghost" aria-label="More">
          ⋯
        </button>
      </div>
      <div className="tiles">
        <div className="tile wide">
          <i>Revenue</i>
          <b>$48,210</b>
          <div className="spark" />
        </div>
        <div className="tile">
          <i>New customers</i>
          <b>312</b>
          <button className="primary" onClick={onGo}>
            Refresh
          </button>
        </div>
        <div className="tile">
          <i>Churn</i>
          <b>1.8%</b>
        </div>
        <div className="tile">
          <i>Tickets</i>
          <b>27</b>
        </div>
        <div className="tile">
          <i>Net promoter</i>
          <b>61</b>
        </div>
      </div>
    </div>
  );
}

const NAMES = ["Maya Chen", "Arjun Rao", "Lena Fischer", "Tomás Ortiz", "Aiko Tanaka", "Noor Haddad", "Piotr Nowak", "Sara Lind"];
function Table({ paid, onAct, rows }: { paid: boolean; onAct: () => void; rows: number }) {
  return (
    <div className="table">
      <table>
        <thead>
          <tr>
            <th>Invoice</th>
            <th>Customer</th>
            <th>Due</th>
            <th>Status</th>
            <th>
              <button className="primary" onClick={onAct}>
                {paid ? "Undo" : "Mark all paid"}
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <td>INV-{String(2400 + i)}</td>
              <td>{NAMES[i % NAMES.length]}</td>
              <td>{(i % 28) + 1} Nov</td>
              <td>
                <span className={paid || i % 3 ? "pill" : "pill late"}>{paid ? "Paid" : i % 3 ? "Sent" : "Late"}</span>
              </td>
              <td>${(120 + ((i * 37) % 900)).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── The bench ───

interface Report {
  [key: string]: unknown;
}

interface Mark {
  t: number;
  name: string;
  ms: number;
  p: number;
}
interface Frame {
  t: number;
  dt: number;
  p: number;
  draw: number;
  run: number;
  /** How long after its own timestamp the frame's callback ran. */
  lag: number;
}
interface Pace {
  frames: number;
  p50: number;
  p99: number;
  max: number;
  long: number;
}

/** Frame gaps over a stretch with nothing running, or with `each` done in
    every frame. Nothing is allocated while it counts. */
function quiet(ms: number, each?: (t: number) => void): Promise<Pace> {
  return new Promise((done) => {
    const gaps = new Float64Array(Math.ceil(ms / 2) + 64);
    let n = 0;
    let first = 0;
    let last = 0;
    const tick = (t: number) => {
      if (!first) first = t;
      if (last && n < gaps.length) gaps[n++] = t - last;
      last = t;
      each?.(t);
      if (t - first < ms) {
        requestAnimationFrame(tick);
        return;
      }
      const sorted = Array.from(gaps.subarray(0, n)).sort((a, b) => a - b);
      const at = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))] ?? 0;
      const round = (v: number) => Math.round(v * 100) / 100;
      done({ frames: n, p50: round(at(0.5)), p99: round(at(0.99)), max: round(at(1)), long: sorted.filter((g) => g > at(0.5) * 1.5).length });
    };
    requestAnimationFrame(tick);
  });
}

/** The same count with a plain WebGL canvas the size of the card redrawn in
    every frame: the browser's own pacing while a canvas presents, which is
    what the wave's frames are read against. It sits over the card from the
    body, so the card itself sees no change. */
async function control(over: HTMLElement | null | undefined, ms: number): Promise<Pace | null> {
  if (!over || ms <= 0) return null;
  const box = over.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  canvas.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height}px;pointer-events:none;z-index:9`;
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false });
  if (!gl) return null;
  document.body.appendChild(canvas);
  const pace = await quiet(ms, (t) => {
    const a = 0.02 + 0.02 * Math.sin(t / 300);
    gl.clearColor(a, a, a, a);
    gl.clear(gl.COLOR_BUFFER_BIT);
  });
  canvas.remove();
  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return pace;
}

/** A beat on the main thread every few milliseconds. Where a frame came late,
    the longest gap between the beats inside it says whether the thread was
    held (script, layout, a collection) or free, which leaves the browser's
    own pacing. */
function heartbeat() {
  const at = new Float64Array(120_000);
  let n = 0;
  let on = true;
  const beat = () => {
    if (!on) return;
    if (n < at.length) at[n++] = performance.now();
    setTimeout(beat, 0);
  };
  beat();
  return {
    stop() {
      on = false;
    },
    /** The longest gap between beats that touches the stretch. */
    stall(from: number, to: number) {
      let worst = 0;
      for (let i = 1; i < n; i++) {
        if (at[i] < from || at[i - 1] > to) continue;
        worst = Math.max(worst, at[i] - at[i - 1]);
      }
      return worst;
    },
    /** The usual gap, and the gaps of 12 ms and more over the whole count. */
    summary() {
      const gaps = Array.from({ length: Math.max(0, n - 1) }, (_, i) => at[i + 1] - at[i]).sort((a, b) => a - b);
      const round = (v: number) => Math.round(v * 10) / 10;
      return { beats: n, p50: round(gaps[Math.floor(gaps.length / 2)] ?? 0), max: round(gaps[gaps.length - 1] ?? 0), over12: gaps.filter((g) => g >= 12).length };
    },
  };
}

/** Wraps the controller's own steps so each leaves a mark; returns the undo. */
function watch(controller: unknown, marks: Mark[], progress: () => number): () => void {
  const undo: (() => void)[] = [];
  // `changes`: called in every frame with the same thing; only a new value is
  // a step worth a mark.
  const wrap = (owner: Record<string, unknown> | null | undefined, name: string, floor = 0, changes = false) => {
    const original = owner?.[name];
    if (!owner || typeof original !== "function") return;
    let before: unknown;
    owner[name] = function (this: unknown, ...args: unknown[]) {
      const t = performance.now();
      const out = (original as (...a: unknown[]) => unknown).apply(this, args);
      const ms = performance.now() - t;
      if (changes && args[0] === before) return out;
      before = args[0];
      if (ms < floor) return out;
      const arg = typeof args[0] === "string" || typeof args[0] === "number" ? `(${args[0]})` : "";
      marks.push({ t, name: name + arg, ms, p: progress() });
      if (name === "capture" && out && typeof (out as Promise<void>).then === "function") {
        void (out as Promise<void>).then(() => marks.push({ t: performance.now(), name: `landed${arg}`, ms: performance.now() - t, p: progress() }));
      }
      return out;
    };
    undo.push(() => {
      owner[name] = original;
    });
  };
  const c = controller as Record<string, unknown> | null | undefined;
  wrap(c, "capture");
  wrap(c, "go");
  wrap(c, "finish");
  wrap(c, "show", 0, true);
  wrap(c, "measure", 0.3);
  wrap(c, "draw", 2);
  const r = c?.renderer as Record<string, unknown> | null | undefined;
  wrap(r, "setScreen");
  wrap(r, "render", 1);
  return () => undo.forEach((fn) => fn());
}

/** The frames that came late, each with what was done since the one before. */
function hitches(frames: Frame[], marks: Mark[], stall: (from: number, to: number) => number) {
  const sorted = frames.map((f) => f.dt).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const round = (v: number) => Math.round(v * 10) / 10;
  return frames
    .filter((f) => f.dt > median * 1.5)
    .map((f) => ({
      run: f.run,
      dt: round(f.dt),
      p: Math.round(f.p * 1000) / 1000,
      draw: round(f.draw),
      lag: round(f.lag),
      // The main thread's longest silence inside the frame.
      stall: round(stall(f.t - f.dt, f.t + f.lag)),
      did: marks.filter((m) => m.t >= f.t - f.dt - 1 && m.t < f.t + 1).map((m) => `${m.name} ${round(m.ms)}`),
    }));
}

function summarise(deltas: number[], draws: number[]) {
  const sorted = [...deltas].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0;
  const mean = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);
  const median = at(0.5);
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    frames: deltas.length,
    hz: median ? Math.round(1000 / median) : 0,
    mean: round(mean(deltas)),
    p50: round(median),
    p95: round(at(0.95)),
    p99: round(at(0.99)),
    max: round(sorted[sorted.length - 1] ?? 0),
    // Frames that took half as long again as the usual one: the ones seen.
    long: deltas.filter((d) => d > median * 1.5).length,
    drawMean: round(mean(draws)),
    drawMax: round(Math.max(0, ...draws)),
  };
}

function App() {
  const [scene, setScene] = useState<Scene>(pick("scene", SCENES, "send"));
  const [type, setType] = useState<WaveType>(QUEUE[0] ?? pick("type", TYPES, "vertical"));
  const [revealed, setRevealed] = useState(false);
  const [scrub, setScrub] = useState<number | null>(query.has("scrub") ? number("scrub", 0) : null);
  const [capture, setCapture] = useState(query.get("capture") !== "0");
  const [scale] = useState<number | "auto">(query.has("scale") ? number("scale", 1) : "auto");
  const [size] = useState({ w: number("w", 860), h: number("h", 540) });
  const [over, setOver] = useState(query.get("overlay") === "1");
  const [status, setStatus] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const api = useRef<DistortionWaveHandle>(null);
  const finished = useRef<((revealed: boolean) => void) | null>(null);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  /** While the frames are being timed: the bench keeps its own hands still. */
  const timing = useRef(false);

  const onFinish = useCallback((now: boolean) => {
    // Every call, for the checks that count them.
    const w = window as unknown as { __finishes?: boolean[] };
    (w.__finishes ??= []).push(now);
    const done = finished.current;
    finished.current = null;
    done?.(now);
  }, []);

  /** Runs the wave one way and resolves when it has arrived. */
  const runTo = useCallback((to: boolean) => {
    return new Promise<boolean>((resolve) => {
      finished.current = resolve;
      if (sceneRef.current === "board") {
        if (to) api.current?.play();
        else api.current?.reverse();
      } else {
        setRevealed(to);
      }
    });
  }, []);

  const bench = useCallback(
    async (cycles = 3) => {
      const debug = () => api.current?.controller?.debug;
      timing.current = true;
      await api.current?.prepare();
      await sleep(600);
      // The controller's own fields, read bare: `debug` builds a report on
      // every read, and the count should leave nothing behind for a collector.
      const bare = api.current?.controller as unknown as { p: number; run: unknown; lastDraw: number } | undefined;
      // What the controller did, and when: each long frame is reported with
      // the work that fell inside it.
      const marks: Mark[] = [];
      const undo = watch(api.current?.controller, marks, () => bare?.p ?? 0);
      // The browser's own pacing with nothing going on, then with a plain
      // canvas presenting, to read the rest against.
      const idle = await quiet(4000);
      const plain = await control(api.current?.element, number("control", 8000));
      await sleep(300);
      const SLOTS = 40_000;
      const at = new Float64Array(SLOTS);
      const gap = new Float32Array(SLOTS);
      const where = new Float32Array(SLOTS);
      const took = new Float32Array(SLOTS);
      const late = new Float32Array(SLOTS);
      const which = new Uint8Array(SLOTS);
      const drew = new Float32Array(SLOTS);
      let n = 0;
      let m = 0;
      let last = 0;
      let run = 0;
      let on = true;
      const beats = heartbeat();
      const loop = (t: number) => {
        if (!on) return;
        if (bare?.run) {
          if (last) {
            if (n < SLOTS) {
              at[n] = t;
              gap[n] = t - last;
              where[n] = bare.p;
              took[n] = bare.lastDraw;
              late[n] = performance.now() - t;
              which[n] = run;
              n++;
            }
          } else {
            run++;
          }
          if (m < SLOTS) drew[m++] = bare.lastDraw;
          last = t;
        } else {
          last = 0;
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      let mode: unknown = null;
      for (let i = 0; i < cycles; i++) {
        const forward = runTo(true);
        await sleep(700);
        mode = debug()?.mode ?? mode;
        await forward;
        await sleep(400);
        if (sceneRef.current !== "board") {
          await runTo(false);
          await sleep(400);
        }
      }
      on = false;
      beats.stop();
      undo();
      timing.current = false;
      const frames: Frame[] = Array.from({ length: n }, (_, i) => ({ t: at[i], dt: gap[i], p: where[i], draw: took[i], run: which[i], lag: late[i] }));
      const deltas = frames.map((f) => f.dt);
      const draws = Array.from(drew.subarray(0, m));
      const d = debug();
      const g = d?.geometry;
      const result: Report = {
        tag: (query.get("tag") ?? "") + (QUEUE.length ? `-${type}` : ""),
        ua: navigator.userAgent,
        scene: sceneRef.current,
        type,
        css: [size.w, size.h],
        dpr: window.devicePixelRatio,
        canvas: g ? [g.W, g.H] : null,
        scale: g ? Math.round(g.k * 100) / 100 : null,
        mode,
        ...summarise(deltas, draws),
        idle,
        plain,
        beats: beats.summary(),
        hitches: hitches(frames, marks, beats.stall),
        events: marks.filter((m) => !/^(draw|render)/.test(m.name)).map((m) => `${m.name} p${m.p.toFixed(3)} ${Math.round(m.ms * 10) / 10}`),
        content: d?.content,
        revealed: d?.revealed,
      };
      setReport(result);
      try {
        await fetch("/__stats", { method: "POST", body: JSON.stringify(result) });
      } catch {
        /* no server to tell */
      }
      return result;
    },
    [runTo, size.h, size.w, type],
  );

  useEffect(() => {
    (window as unknown as { __dw: unknown }).__dw = {
      api,
      debug: () => api.current?.controller?.debug,
      run: runTo,
      bench,
      scrub: (p: number | null) => setScrub(p),
      reveal: (to: boolean) => setRevealed(to),
      type: (t: WaveType) => setType(t),
    };
  }, [bench, runTo]);

  useEffect(() => {
    const id = window.setInterval(() => {
      if (timing.current) return;
      const d = api.current?.controller?.debug;
      if (!d) return;
      const g = d.geometry;
      const slot = (s: typeof d.content) => `${s.ready ? "ready" : "–"}${s.stale ? " stale" : ""}${s.busy ? " busy" : ""} ${s.nodes}n ${Math.round(s.size / 1024)}kB walk ${s.walk.toFixed(1)} raster ${s.raster.toFixed(1)} total ${s.cost.toFixed(1)}ms ×${s.count}`;
      setStatus(
        `p ${d.progress.toFixed(3)}  ${d.running ? "running" : "rest"}  mode ${d.mode ?? "–"}  gain ${d.gain.toFixed(2)}  floor ${d.floor.toFixed(2)}  draw ${d.draw.toFixed(2)}ms  clearAt ${d.clearAt.toFixed(3)}  ${d.duration.toFixed(2)}s\n` +
          (g ? `area ${g.w}×${g.h}  scale ${g.k.toFixed(2)}  canvas ${g.W}×${g.H}  radius ${g.radius}  webgl ${d.webgl}\n` : "") +
          `content  ${slot(d.content)}\nrevealed ${slot(d.revealed)}`,
      );
    }, 200);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (query.get("auto") !== "1") return;
    let live = true;
    const id = window.setTimeout(() => {
      if (!live) return;
      void bench(number("cycles", 3)).then(() => {
        // The next type, in this same tab.
        if (QUEUE.length < 2) return;
        const next = new URLSearchParams(location.search);
        next.set("types", QUEUE.slice(1).join(","));
        location.replace(`${location.pathname}?${next}`);
      });
    }, 1200);
    return () => {
      live = false;
      clearTimeout(id);
    };
    // Once, on load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = number("rows", 120);
  const shared = {
    ref: api,
    className: "card",
    style: { width: size.w, height: size.h },
    type,
    scale,
    capture,
    scrub,
    onFinish,
  };

  return (
    <div className="bench">
      <div className="bar">
        <div className="group">
          {SCENES.map((s) => (
            <button
              key={s}
              aria-pressed={scene === s}
              onClick={() => {
                setRevealed(false);
                setScene(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="group">
          {TYPES.map((t) => (
            <button key={t} aria-pressed={type === t} onClick={() => setType(t)}>
              {t}
            </button>
          ))}
        </div>
        <label>
          <input type="checkbox" checked={capture} onChange={(e) => setCapture(e.target.checked)} /> lens
        </label>
        <label>
          <input type="checkbox" checked={scrub !== null} onChange={(e) => setScrub(e.target.checked ? 0.3 : null)} /> scrub
        </label>
        {scrub !== null ? <input type="range" min={0} max={1} step={0.001} value={scrub} onChange={(e) => setScrub(Number(e.target.value))} /> : null}
        <label>
          <input type="checkbox" checked={over} onChange={(e) => setOver(e.target.checked)} /> overlay
        </label>
        <button onClick={() => void bench(number("cycles", 3))}>time it</button>
      </div>

      {scene === "send" ? (
        <DistortionWave
          key="send"
          {...shared}
          revealed={revealed}
          revealedContent={<Receipt bare={over} onDone={() => setRevealed(false)} />}
          overlay={
            over ? (
              <button className={`primary float${revealed ? " is-done" : ""}`} onClick={() => setRevealed((v) => !v)}>
                {revealed ? "Done" : "Send $240"}
              </button>
            ) : null
          }
        >
          <Review bare={over} onSend={() => setRevealed(true)} />
        </DistortionWave>
      ) : scene === "table" ? (
        <DistortionWave key="table" {...shared} revealed={revealed} revealedContent={<Table paid rows={rows} onAct={() => setRevealed(false)} />}>
          <Table paid={false} rows={rows} onAct={() => setRevealed(true)} />
        </DistortionWave>
      ) : (
        <DistortionWave key="board" {...shared}>
          <Board onGo={() => api.current?.play()} />
        </DistortionWave>
      )}

      <pre className="stats" id="status">
        {status}
      </pre>
      {report ? (
        <pre className="stats" id="report">
          {JSON.stringify(report, null, 1)}
        </pre>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
