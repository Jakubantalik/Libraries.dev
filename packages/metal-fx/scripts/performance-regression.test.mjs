// Run: npx tsx --tsconfig packages/metal-fx/tsconfig.json --experimental-test-module-mocks --test packages/metal-fx/scripts/performance-regression.test.mjs
import assert from 'node:assert/strict';
import { afterEach, mock, test } from 'node:test';
import * as React from 'react';

const cleanups = [];
afterEach(() => { cleanups.splice(0).reverse().forEach((cleanup) => cleanup()); mock.restoreAll(); });
function stubGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  cleanups.push(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
}

function environment() {
  let now = 2000, nextRaf = 0, reads = 0, callbacks = 0;
  const queue = new Map(), drawImage = mock.fn();
  const gl = new Proxy({}, { get: (_target, key) => {
    if (key === 'getShaderParameter' || key === 'getProgramParameter') return () => true;
    if (key === 'getUniformLocation' || key === 'getExtension') return () => null;
    if (key === 'getAttribLocation') return () => 0;
    if (typeof key === 'string' && /^[A-Z_0-9]+$/.test(key)) return 1;
    return () => ({});
  } });
  const context = new Proxy({ drawImage }, { get: (target, key) => {
    if (key === 'drawImage') return target.drawImage;
    if (key === 'getImageData') return (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) });
    return () => {};
  } });
  class Element extends EventTarget {
    width = 40; height = 40; isConnected = true; innerHTML = '';
    style = { setProperty() {}, removeProperty() {} };
    getContext(kind) { return kind === 'webgl2' ? gl : context; }
    getBoundingClientRect() { reads++; return { left: 0, top: 0, width: 40, height: 40, right: 40, bottom: 40 }; }
    appendChild() {} remove() {}
  }
  const document = Object.assign(new EventTarget(), {
    hidden: false, documentElement: new Element(), body: new Element(), head: new Element(),
    createElement: () => new Element(), getElementById: () => null
  });
  stubGlobal('document', document);
  stubGlobal('window', Object.assign(new EventTarget(), {
    devicePixelRatio: 1,
    matchMedia: (query) => ({ matches: query === '(pointer: fine)' || query === '(hover: hover)', addEventListener() {}, removeEventListener() {} })
  }));
  stubGlobal('OffscreenCanvas', undefined);
  stubGlobal('performance', { now: () => now });
  const requestFrame = mock.fn((callback) => { queue.set(++nextRaf, callback); return nextRaf; });
  stubGlobal('requestAnimationFrame', requestFrame);
  stubGlobal('cancelAnimationFrame', (id) => queue.delete(id));
  stubGlobal('getComputedStyle', () => ({ borderTopLeftRadius: '20px' }));
  stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  return {
    document, queue, requestFrame, drawImage, element: () => new Element(),
    reads: () => reads, callbacks: () => callbacks,
    move() { const event = new Event('pointermove'); Object.assign(event, { pointerType: 'mouse', clientX: 40, clientY: 20 }); document.dispatchEvent(event); },
    frames(count) {
      for (let i = 0; i < count; i++) {
        now += 1000 / 60;
        const pending = [...queue.values()]; queue.clear();
        pending.forEach((callback) => { callbacks++; callback(now); });
      }
    }
  };
}

test('cursor tracking skips invisible effects and resumes/fades without a zero-distance NaN', async () => {
  const env = environment();
  const core = await import('../src/engine/renderer/core.ts');
  const loop = await import('../src/engine/renderer/loop.ts');
  const cursor = await import('../src/engine/cursor/light.ts');
  const inst = loop.createInstance({ hostCanvas: env.element(), cssWidth: 40, cssHeight: 40, cornerRadius: 20, kind: 'circle', paused: true });
  loop.pauseShared(); cursor.attachCursorLight();
  cleanups.push(() => { cursor.detachCursorLight(); loop.destroyInstance(inst); core.teardownSharedRenderer(); });
  env.requestFrame.mock.resetCalls();
  for (let i = 0; i < 60; i++) { env.move(); env.frames(1); }
  assert.equal(env.reads(), 0);
  assert.equal(env.requestFrame.mock.callCount(), 0);
  assert.equal(env.callbacks(), 0);
  cursor.setCursorLightConfig({ catchLight: true });
  env.move(); env.frames(60);
  assert.equal(env.reads(), 60);
  assert.equal(inst.cursorLight.x, 40); assert.equal(inst.cursorLight.y, 20);
  const weight = inst.cursorLight.w;
  assert.ok(Number.isFinite(weight) && weight > 0.9);
  cursor.setCursorLightConfig({ enabled: false }); env.frames(1);
  assert.ok(inst.cursorLight.w > 0 && inst.cursorLight.w < weight);
  env.frames(119);
  assert.equal(env.reads(), 60); assert.equal(inst.cursorLight, null); assert.equal(env.queue.size, 0);
  cursor.setCursorLightConfig({ enabled: true }); env.move(); env.frames(10);
  env.document.hidden = true; env.document.dispatchEvent(new Event('visibilitychange'));
  const callbacks = env.callbacks(), reads = env.reads();
  cursor.setCursorLightConfig({ enabled: true }); cursor.setCursorSprite(null); env.frames(60);
  assert.equal(env.callbacks(), callbacks); assert.equal(env.reads(), reads); assert.equal(env.queue.size, 0);
  env.document.hidden = false; env.document.dispatchEvent(new Event('visibilitychange')); env.frames(120);
  assert.equal(env.queue.size, 0); assert.equal(inst.cursorLight, null);
  env.move(); env.frames(5); assert.ok(inst.cursorLight.w > 0);
});

test('disableGlow removes glow work while preserving metal rendering and handles across re-enable', async () => {
  const env = environment();
  const refs = [], states = [], effects = [], pending = [];
  let refIndex = 0, stateIndex = 0, effectIndex = 0;
  const effect = (run, deps) => {
    const index = effectIndex++, previous = effects[index];
    if (previous && deps?.length === previous.deps?.length && deps?.every((dep, i) => Object.is(dep, previous.deps?.[i]))) return;
    pending.push(() => { previous?.cleanup?.(); effects[index] = { deps, cleanup: run() }; });
  };
  const { default: reactDefault, ...reactNamed } = React;
  const reactMock = mock.module('react', {
    defaultExport: reactDefault,
    namedExports: {
      ...reactNamed, forwardRef: (render) => (props) => render(props, null),
      useMemo: (factory) => factory(), useImperativeHandle() {}, useEffect: effect, useLayoutEffect: effect,
      useRef: (initial) => refs[refIndex++] ??= { current: initial },
      useState: (initial) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
        return [states[index], (value) => { states[index] = value; }];
      }
    }
  });
  const handles = {}, injectGlow = mock.fn(() => handles), updateGlow = mock.fn(() => false);
  const glowMock = mock.module('../src/engine/glow/glow.ts', {
    namedExports: { injectGlow, updateGlow, updateGlowMask() {}, carryGlowState() {} }
  });
  cleanups.push(() => { reactMock.restore(); glowMock.restore(); });
  const { MetalFx } = await import('../src/MetalFx.tsx');
  const core = await import('../src/engine/renderer/core.ts');
  cleanups.push(() => { effects.slice().reverse().forEach((entry) => entry.cleanup?.()); core.teardownSharedRenderer(); });
  const bindRefs = (node) => {
    if (Array.isArray(node)) { node.forEach(bindRefs); return; }
    if (!node || typeof node !== 'object' || !('props' in node)) return;
    const ref = node.ref;
    if (ref && ref.current === null) ref.current = env.element();
    bindRefs(node.props.children);
  };
  const render = (disableGlow) => {
    refIndex = stateIndex = effectIndex = 0;
    bindRefs(MetalFx({ variant: 'circle', theme: 'dark', disableGlow, children: 'Generate' }));
    pending.splice(0).forEach((run) => run());
  };
  render(false);
  const shared = core.SHARED, inst = [...shared.instances][0];
  assert.deepEqual(shared.glowQueue, [inst]);
  env.frames(12); assert.ok(updateGlow.mock.callCount() > 0);
  const copies = env.drawImage.mock.callCount(); updateGlow.mock.resetCalls();
  render(true); env.frames(12);
  assert.equal(core.SHARED, shared); assert.deepEqual([...shared.instances], [inst]);
  assert.deepEqual(shared.glowQueue, []); assert.equal(updateGlow.mock.callCount(), 0);
  assert.ok(env.drawImage.mock.callCount() > copies); assert.equal(injectGlow.mock.callCount(), 1);
  render(false); env.frames(12);
  assert.deepEqual(shared.glowQueue, [inst]); assert.ok(updateGlow.mock.callCount() > 0);
  assert.ok(updateGlow.mock.calls.every(({ arguments: args }) => args[0] === handles));
  assert.equal(injectGlow.mock.callCount(), 1); assert.equal(core.SHARED, shared);
});
