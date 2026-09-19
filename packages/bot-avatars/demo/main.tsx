import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BotAvatar, botAvatarTypes, botAvatarStates, botAvatarFaces, botAvatarShapes, botAvatarPresets, warmBotAvatarPlastic, drawBotAvatarFrame, BotAvatarSim, autoInk, BOT_AVATAR_OVERSCAN, type BotAvatarState, type BotAvatarType } from '../src';
import { Strip } from './strip';

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
