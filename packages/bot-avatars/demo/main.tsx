import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BotAvatar, botAvatarTypes, botAvatarStates, botAvatarFaces, botAvatarShapes, botAvatarParts, botAvatarPresets, warmBotAvatarPlastic, drawBotAvatarFrame, BotAvatarSim, autoInk, BOT_AVATAR_OVERSCAN, type BotAvatarState, type BotAvatarType } from '../src';
import { Strip } from './strip';
import { rasterize as plasticRasterize, buildForm as plasticBuildForm, capFrame as plasticCapFrame, buildMatcap as plasticBuildMatcap, shadeTexels as plasticShadeTexels } from '../src/plastic';

/* A switcher: click to cycle the state and watch the cross-animation. */
function Switcher() {
  const [state, setState] = useState<BotAvatarState>('default');
  const next = () => setState((s) => botAvatarStates[(botAvatarStates.indexOf(s) + 1) % botAvatarStates.length]);
  return (
    <div className="cell" onClick={next} style={{ cursor: 'pointer' }}>
      <BotAvatar type="clover" face="mouth" state={state} size={160} />
      <span className="label">click: {state}</span>
    </div>
  );
}

/* #idle, #working, #sleeping, #faces or #light shows one section. */
const only = location.hash.slice(1);
const show = (id: string) => !only || only === id;

/* #speed: three avatars with one seed at different speeds, driven by a
   fake frame loop — window.__pump(seconds) advances them — so the speed
   prop can be checked from a tab that gets no real animation frames. */
/* window.__bench(type, box, shading): ms to bake the form once and ms per
   frame to draw, so the material's cost can be read from any tab */
(window as unknown as { __bench: (t: BotAvatarType, box: number, shading: 'plastic' | 'crisp' | 'smooth') => unknown }).__bench = (t, box, shading) => {
  const preset = botAvatarPresets[t];
  const path = new Path2D(botAvatarShapes[t]);
  const dpr = 2;
  const devicePx = box * dpr;
  const n = devicePx <= 96 ? 64 : devicePx <= 256 ? 96 : 128;
  const t0 = performance.now();
  warmBotAvatarPlastic(`bench-${t}-${Math.random()}`, path, devicePx, 0.95);
  const bake = performance.now() - t0;
  const c = document.createElement('canvas');
  c.width = c.height = box * BOT_AVATAR_OVERSCAN * dpr;
  const ctx = c.getContext('2d')!;
  const sim = new BotAvatarSim(0.3, 'default');
  const cfg = { path, face: 'eyes' as const, faceX: preset.faceX, faceY: preset.faceY, faceScale: preset.faceScale, color: preset.color, ink: autoInk(preset.color), shading, typeKey: t, still: true };
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBotAvatarFrame(ctx, box, sim.pose, cfg);
  const frames = 120;
  const t1 = performance.now();
  for (let i = 0; i < frames; i++) {
    sim.update(1 / 60);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBotAvatarFrame(ctx, box, sim.pose, cfg);
  }
  const perFrame = (performance.now() - t1) / frames;
  return { n, bakeMs: +bake.toFixed(2), frameMs: +perFrame.toFixed(3) };
};

/* window.__profile(opts): frame cost for one avatar over N frames with the
   real sim, plus how many canvas calls a frame makes and how often the
   plastic material rebuilds (putImageData) — for a performance pass */
const srcLib = { drawBotAvatarFrame, BotAvatarSim, botAvatarShapes, botAvatarParts, botAvatarPresets, autoInk, BOT_AVATAR_OVERSCAN };
(window as unknown as { __profile: (o: Record<string, unknown>) => unknown }).__profile = (o) => {
  const lib = (o.lib as typeof import('../src')) ?? srcLib;
  const type = (o.type as BotAvatarType) ?? 'clover';
  const box = (o.box as number) ?? 96;
  const shading = (o.shading as 'plastic' | 'crisp' | 'smooth' | 'flat') ?? 'plastic';
  const state = (o.state as BotAvatarState) ?? 'default';
  const frames = (o.frames as number) ?? 240;
  const dpr = (o.dpr as number) ?? 2;
  const preset = lib.botAvatarPresets[type];
  const path = new Path2D(lib.botAvatarShapes[type]);
  const parts = lib.botAvatarParts[type] ? new Path2D(lib.botAvatarParts[type] as string) : undefined;
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(box * lib.BOT_AVATAR_OVERSCAN * dpr);
  const ctx = c.getContext('2d')!;
  const sim = new lib.BotAvatarSim(0.3, state);
  const cfg = { path, parts, face: (o.face as 'eyes' | 'mouth') ?? 'eyes', faceX: preset.faceX, faceY: preset.faceY, faceScale: preset.faceScale, color: preset.color, ink: lib.autoInk(preset.color), shading, typeKey: type, still: true, sides: (o.sides as 'auto' | 'vector' | 'sprite') ?? 'auto', whirl: { strength: (o.whirl as number) ?? 1, size: 1, width: 1, length: 1, tilt: 1 } };
  for (let i = 0; i < 90; i++) sim.update(1 / 60);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  lib.drawBotAvatarFrame(ctx, box, sim.pose, cfg);
  /* count canvas calls and material rebuilds */
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  const counts: Record<string, number> = {};
  const timed = !!o.timed;
  const wrapped = timed
    ? ['fill', 'stroke', 'putImageData', 'drawImage', 'createConicGradient', 'createLinearGradient', 'createRadialGradient', 'clip', 'getImageData', 'save', 'restore', 'transform', 'setTransform', 'translate', 'scale', 'rotate', 'beginPath', 'ellipse', 'moveTo', 'lineTo', 'quadraticCurveTo', 'bezierCurveTo', 'clearRect', 'getTransform', 'closePath']
    : ['fill', 'stroke', 'putImageData', 'drawImage', 'createConicGradient', 'createLinearGradient', 'createRadialGradient', 'clip', 'getImageData'];
  const orig: Record<string, (...a: unknown[]) => unknown> = {};
  const times: Record<string, number> = {};
  for (const name of wrapped.slice()) {
    if (typeof proto[name] !== 'function') { wrapped.splice(wrapped.indexOf(name), 1); continue; }
    orig[name] = proto[name];
    counts[name] = 0;
    times[name] = 0;
    proto[name] = timed
      ? function (this: unknown, ...a: unknown[]) { counts[name]++; const t = performance.now(); const r = orig[name].apply(this, a); times[name] += performance.now() - t; return r; }
      : function (this: unknown, ...a: unknown[]) { counts[name]++; return orig[name].apply(this, a); };
  }
  /* the style setters, timed too */
  const setters = ['fillStyle', 'strokeStyle', 'lineWidth'];
  const descs: Record<string, PropertyDescriptor> = {};
  if (timed) for (const name of setters) {
    const d = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, name);
    if (!d || !d.set) continue;
    descs[name] = d;
    counts['set ' + name] = 0;
    times['set ' + name] = 0;
    Object.defineProperty(CanvasRenderingContext2D.prototype, name, { configurable: true, get: d.get, set(this: unknown, v: unknown) { counts['set ' + name]++; const t = performance.now(); d.set!.call(this, v); times['set ' + name] += performance.now() - t; } });
  }
  let spinFrames = 0;
  const t1 = performance.now();
  for (let i = 0; i < frames; i++) {
    if (o.poke && i === 30) sim.poke();
    sim.update(1 / 60);
    if (sim.pose.whirl > 0.01) spinFrames++;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lib.drawBotAvatarFrame(ctx, box, sim.pose, cfg);
  }
  const total = performance.now() - t1;
  for (const name of wrapped) proto[name] = orig[name];
  for (const name of Object.keys(descs)) Object.defineProperty(CanvasRenderingContext2D.prototype, name, descs[name]);
  const per: Record<string, number> = {};
  for (const name of Object.keys(counts)) per[name] = +(counts[name] / frames).toFixed(2);
  const out: Record<string, unknown> = { type, box, shading, state, frames, spinFrames, msPerFrame: +(total / frames).toFixed(3), callsPerFrame: per };
  if (timed) {
    const by: Record<string, number> = {};
    let inCanvas = 0;
    for (const name of Object.keys(times).sort((a, b) => times[b] - times[a])) { by[name] = +((times[name] / frames) * 1000).toFixed(0); inCanvas += times[name]; }
    out.usPerFrameBy = by;
    out.canvasUsPerFrame = +((inCanvas / frames) * 1000).toFixed(0);
    out.jsUsPerFrame = +(((total - inCanvas) / frames) * 1000).toFixed(0);
  }
  return out;
};

/* ?diag: a panel with the browser's canvas support and the profile
   numbers, for browsers this session cannot script (Safari) */
/* ?diag: an overlay with the browser's canvas support and the profile
   numbers, for browsers this session cannot script */
if (new URLSearchParams(location.search).has('diag')) {
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;left:8px;top:8px;z-index:9;background:#000d;color:#7f7;font:15px/1.35 Menlo,monospace;padding:10px;max-width:96vw;white-space:pre-wrap;margin:0';
  document.body.appendChild(pre);
  const g = globalThis as { OffscreenCanvas?: unknown; requestIdleCallback?: unknown };
  const proto = CanvasRenderingContext2D.prototype as unknown as Record<string, unknown>;
  const lines = [navigator.userAgent, `OffscreenCanvas ${typeof g.OffscreenCanvas}  ric ${typeof g.requestIdleCallback}  conic ${typeof proto.createConicGradient}  dpr ${devicePixelRatio}`];
  pre.textContent = lines.join('\n');
  /* the live page: time in the frame callback and the achieved rate */
  const measureRaf = () => new Promise<string>((resolve) => {
    const orig = window.requestAnimationFrame.bind(window);
    let frames = 0, total = 0, max = 0, wall0 = 0, done = false;
    window.requestAnimationFrame = (cb) => orig((now) => {
      if (done) return cb(now);
      if (!wall0) wall0 = now;
      const t = performance.now(); cb(now); const d = performance.now() - t;
      frames++; total += d; if (d > max) max = d;
      if (frames >= 240) { done = true; window.requestAnimationFrame = orig; resolve(`page: ${document.querySelectorAll('canvas').length} canvases, frame callback avg ${(total / frames).toFixed(2)} ms, max ${max.toFixed(1)} ms, ${(frames / ((now - wall0) / 1000)).toFixed(0)} fps`); }
    });
    setTimeout(() => { if (!done) { done = true; window.requestAnimationFrame = orig; resolve(`page: only ${frames} frames in 10 s (hidden?)`); } }, 10000);
  });
  setTimeout(() => void measureRaf().then((l) => { lines.push(l); pre.textContent = lines.join('\n'); }), 1200);
  setTimeout(() => {
    const P = (window as unknown as { __profile: (o: Record<string, unknown>) => unknown }).__profile;
    for (const o of [{ shading: 'plastic', whirl: 0 }, { shading: 'crisp', whirl: 0 }, { shading: 'plastic', state: 'working', whirl: 0 }, { shading: 'plastic', poke: true, whirl: 0 }, { shading: 'plastic', poke: true, whirl: 1 }, { shading: 'plastic', type: 'mech', whirl: 0 }]) {
      let best: unknown = null;
      for (let r = 0; r < 3; r++) { const x = P({ type: 'clover', box: 96, frames: 240, dpr: devicePixelRatio, ...o }) as { msPerFrame: number }; if (!best || x.msPerFrame < (best as { msPerFrame: number }).msPerFrame) best = x; }
      lines.push(JSON.stringify(best));
      pre.textContent = lines.join('\n');
    }
  }, 12000);
}

/* window.__profilePlastic(): the material's stages timed one by one */
(window as unknown as { __profilePlastic: (n?: number) => unknown }).__profilePlastic = (N = 96) => {
  const path = new Path2D(botAvatarShapes.clover);
  const halfDepth = 15 * 0.65;
  const t0 = performance.now();
  const cov = plasticRasterize(path, N)!;
  const rasterMs = performance.now() - t0;
  const form = plasticBuildForm(cov, N, halfDepth);
  const bake = performance.now() - t0;
  const rig = { cy: Math.cos(0.3), sy: Math.sin(0.3), cp: Math.cos(0.1), sp: Math.sin(0.1), facing: Math.cos(0.3) * Math.cos(0.1), roll: 0.05, halfDepth, cap: 0.95, lx: Math.sin((265 * Math.PI) / 180), ly: -Math.cos((265 * Math.PI) / 180), dev: N * 2 };
  const reps = 200;
  let t = performance.now();
  let frame = plasticCapFrame(rig);
  for (let i = 0; i < reps; i++) frame = plasticCapFrame({ ...rig, roll: rig.roll + i * 1e-4 });
  const capFrameMs = (performance.now() - t) / reps;
  const mc = new Float32Array(64 * 64 * 3);
  const c: [number, number, number] = [0.04, 0.2, 1];
  const mat = { shadow: 0.35, highlight: 1.3, spread: 1.55, rim: 0.5 };
  t = performance.now();
  for (let i = 0; i < reps; i++) plasticBuildMatcap(mc, c, frame, mat);
  const matcapMs = (performance.now() - t) / reps;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 8;
  const g = cv.getContext('2d')!;
  t = performance.now();
  for (let i = 0; i < reps; i++) {
    for (let k = 0; k < 3; k++) {
      const cg = g.createConicGradient(0, 50, 50);
      for (let s2 = 0; s2 <= 24; s2++) cg.addColorStop(s2 / 24, `rgb(${(i + s2) & 255} ${(i * 3) & 255} ${s2 * 9})`);
    }
  }
  const sideGradientsMs = (performance.now() - t) / reps;
  const img = new ImageData(N, N);
  const aoMul = new Float32Array(256);
  for (let a = 0; a < 256; a++) aoMul[a] = 1 - 0.42 * (1 - a / 255);
  t = performance.now();
  for (let i = 0; i < reps; i++) plasticShadeTexels(form, mc, img.data, aoMul);
  const texelsMs = (performance.now() - t) / reps;
  const sc = new OffscreenCanvas(N, N);
  const sg = sc.getContext('2d')!;
  t = performance.now();
  for (let i = 0; i < reps; i++) sg.putImageData(img, 0, 0);
  const putMs = (performance.now() - t) / reps;
  const dst = document.createElement('canvas');
  dst.width = dst.height = Math.round(N * 2 * 1.4);
  const dg = dst.getContext('2d')!;
  t = performance.now();
  for (let i = 0; i < reps; i++) {
    dg.save();
    dg.setTransform(2, 0, 0, 2, 40, 40);
    dg.clip(path);
    dg.imageSmoothingQuality = 'high';
    dg.drawImage(sc, -3, -3, 106, 106);
    dg.restore();
  }
  const drawImageMs = (performance.now() - t) / reps;
  const r = (v: number) => +v.toFixed(3);
  return { N, rasterMs: r(rasterMs), bakeMs: r(bake), capFrameMs: r(capFrameMs), matcapMs: r(matcapMs), sideGradientsMs: r(sideGradientsMs), texelsMs: r(texelsMs), putImageDataMs: r(putMs), drawImageMs: r(drawImageMs) };
};

if (only === 'speed') {
  const queue: FrameRequestCallback[] = [];
  let now = 0;
  try {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
  } catch {
    /* already patched by an earlier module evaluation */
  }
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = () => {};
  (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
  (window as unknown as { __pump: (s: number) => number }).__pump = (seconds) => {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      now += 1000 / 60;
      queue.splice(0).forEach((cb) => cb(now));
    }
    return queue.length;
  };
}

function SpeedTest() {
  /* window.__setSpeed(x) changes the live one after mount, the way the
     Studio's slider does */
  const [live, setLive] = useState(1);
  (window as unknown as { __setSpeed: (x: number) => void }).__setSpeed = setLive;
  return (
    <>
      <h2>speed 0.25× / 1× / 4×, same seed — window.__pump(s)</h2>
      <div className="row">
        <div className="cell"><BotAvatar type="star" seed={0.3} speed={live} size={120} /><span className="label">live {live}×</span></div>
        <div className="cell"><BotAvatar type="star" seed={0.3} speed={1} size={120} /><span className="label">1×</span></div>
        {[0.25, 1, 4].map((sp) => (
          <div className="cell" key={sp}><BotAvatar type="clover" face="mouth" seed={0.3} speed={sp} size={120} /><span className="label">{sp}×</span></div>
        ))}
        {[0.25, 1, 4].map((sp) => (
          <div className="cell" key={'t' + sp}><BotAvatar type="drop" state="working" seed={0.3} speed={sp} size={120} /><span className="label">{sp}×</span></div>
        ))}
      </div>
    </>
  );
}

/* #strip-<state>[-<from>]: filmstrips of the motion, no live loop needed. */
function Strips() {
  const [, state, from] = only.split('-') as [string, BotAvatarState, BotAvatarState | undefined];
  if (state === ('poke' as BotAvatarState)) {
    return (
      <>
        <h2>a poke: hop, turn and the whirl, every 0.07 s</h2>
        <Strip type="clover" state="default" every={0.07} frames={13} size={150} poke />
        <Strip type="star" state="default" every={0.07} frames={13} size={150} poke seed={0.7} />
      </>
    );
  }
  return (
    <>
      <h2>{from ? `${from} → ${state}, every 0.1 s` : `${state}, every ${state === 'working' ? 0.12 : state === 'default' ? 0.5 : 0.3} s`}</h2>
      {(['clover', 'flower', 'star'] as const).map((t) => (
        <Strip key={t} type={t} state={state} from={from} every={from ? 0.1 : state === 'working' ? 0.12 : state === 'default' ? 0.5 : 0.3} size={from ? 72 : 88} />
      ))}
      {!from && <Strip type="clover" face="mouth" state={state} every={0.3} size={88} seed={0.9} />}
    </>
  );
}

function Demo() {
  if (only === 'speed') return <SpeedTest />;
  if (only.startsWith('strip-')) return <Strips />;
  return (
    <>
      {show('idle') && <><h2 id="idle">All types, own face, idle</h2>
      <div className="row">
        {botAvatarTypes.map((t) => (
          <div className="cell" key={t}><BotAvatar type={t} size={120} /><span className="label">{t}</span></div>
        ))}
        <Switcher />
      </div></>}
      {botAvatarStates.filter((s) => show(s)).map((s) => (
        <div key={s}>
          <h2 id={s}>{s}</h2>
          <div className="row">
            {botAvatarTypes.map((t) => (
              <div className="cell" key={t}><BotAvatar type={t} state={s} size={only ? 120 : 88} /></div>
            ))}
          </div>
        </div>
      ))}
      {show('faces') && <><h2 id="faces">Faces × states on the circle</h2>
      <div className="row">
        {botAvatarFaces.map((f) =>
          botAvatarStates.map((s) => (
            <div className="cell" key={f + s}><BotAvatar type="circle" face={f} state={s} size={88} /><span className="label">{f} · {s}</span></div>
          ))
        )}
      </div></>}
      {show('smooth') && <><h2 id="smooth">Smooth shading, then the knobs</h2>
      <div className="row">
        {botAvatarTypes.map((t) => (
          <div className="cell" key={t}><BotAvatar type={t} shading="smooth" size={120} /></div>
        ))}
      </div>
      <div className="row">
        <div className="cell"><BotAvatar type="clover" shading="smooth" shadow={2} size={100} /><span className="label">shadow 2</span></div>
        <div className="cell"><BotAvatar type="clover" shading="smooth" highlight={2} size={100} /><span className="label">highlight 2</span></div>
        <div className="cell"><BotAvatar type="clover" shading="smooth" light={135} size={100} /><span className="label">light 135°</span></div>
        <div className="cell"><BotAvatar type="clover" shading="smooth" spread={0.5} size={100} /><span className="label">spread .5</span></div>
        <div className="cell"><BotAvatar type="clover" shadow={2} size={100} /><span className="label">crisp shadow 2</span></div>
        <div className="cell"><BotAvatar type="clover" rim={2} size={100} /><span className="label">rim 2</span></div>
        <div className="cell"><BotAvatar type="clover" rim={0} size={100} /><span className="label">rim 0</span></div>
        <div className="cell"><BotAvatar type="clover" state="working" depth={2} size={100} /><span className="label">depth 2</span></div>
        <div className="cell"><BotAvatar type="clover" state="working" depth={0.3} size={100} /><span className="label">depth .3</span></div>
        <div className="cell"><BotAvatar type="clover" light={90} size={100} /><span className="label">crisp light 90°</span></div>
      </div></>}
      {show('plastic') && <><h2 id="plastic">Plastic</h2>
      <div className="row">
        {botAvatarTypes.map((t) => (
          <div className="cell" key={t}><BotAvatar type={t} shading="plastic" size={120} /></div>
        ))}
      </div>
      <div className="row">
        <div className="cell"><BotAvatar type="clover" shading="plastic" light={315} size={120} /><span className="label">light 315°</span></div>
        <div className="cell"><BotAvatar type="clover" shading="plastic" highlight={2} size={120} /><span className="label">highlight 2</span></div>
        <div className="cell"><BotAvatar type="clover" shading="plastic" shadow={1.5} size={120} /><span className="label">shadow 1.5</span></div>
        <div className="cell"><BotAvatar type="clover" shading="plastic" spread={0.6} size={120} /><span className="label">spread .6</span></div>
        <div className="cell"><BotAvatar type="circle" shading="plastic" state="working" size={120} /><span className="label">working</span></div>
      </div>
      <div className="row light">
        {(['clover', 'drop', 'flower', 'ghost', 'star'] as const).map((t) => (
          <div className="cell" key={t}><BotAvatar type={t} shading="plastic" size={72} /></div>
        ))}
      </div></>}
      {show('light') && <><h2 id="light">Light ground, small sizes, custom colours</h2>
      <div className="row light">
        {botAvatarTypes.map((t) => (
          <div className="cell" key={t}><BotAvatar type={t} size={40} /></div>
        ))}
        <BotAvatar type="clover" color="#111" size={88} />
        <BotAvatar type="blob" color="#ff5c8a" face="eyes" size={88} />
        <BotAvatar type="square" shading="flat" size={88} />
        <BotAvatar type="clover" shading="smooth" size={88} />
        <BotAvatar type="flower" shading="smooth" face="mouth" size={88} />
        <BotAvatar type="star" size={24} />
      </div></>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Demo />);
