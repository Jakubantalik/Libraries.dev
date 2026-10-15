if (import.meta.env.DEV) (globalThis as { __MFX_DEBUG__?: boolean }).__MFX_DEBUG__ = true;
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './tailwind.css';
import './styles.css';

// Dev-only: `?nowebgl2` simulates a browser without WebGL2 so the fallback
// path can be eyeballed. Must run before any MetalFx mounts.
if (import.meta.env.DEV && location.search.includes('nowebgl2')) {
  const wrap = (proto: { getContext: (...a: unknown[]) => unknown }) => {
    const orig = proto.getContext;
    proto.getContext = function (this: unknown, type: unknown, ...rest: unknown[]) {
      return type === 'webgl2' ? null : orig.call(this, type, ...rest);
    };
  };
  wrap(HTMLCanvasElement.prototype as unknown as { getContext: (...a: unknown[]) => unknown });
  if (typeof OffscreenCanvas !== 'undefined') {
    wrap(OffscreenCanvas.prototype as unknown as { getContext: (...a: unknown[]) => unknown });
  }
}

createRoot(document.getElementById('root')!).render(<App />);
