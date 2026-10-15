import { useEffect, type RefObject } from 'react';
import { redrawInstance, setInstanceDeform } from './engine/renderer/loop';
import type { DeformLayers } from './engine/renderer/core';
import { BEND, type BendConfig } from './engine/bend/config';

/**
 * Cursor-driven local deformation ("liquid dent") for a MetalFx root.
 *
 * Field
 * ─────
 * Two gaussian blobs centred at `c` (which lags the cursor by `follow`):
 *   • directional: `amp · g_bend(r)` — a 2-D spring chasing the cursor's
 *     smoothed velocity × gain, so motion toward the centre pushes the ring
 *     in and motion away drags it out; recoils on release.
 *   • liquid: `(p − c)/σ · g_liq(r) · la` — the gradient of a bump, i.e. a
 *     divergent push away from the contact point. This term *stretches*
 *     material rather than sliding it, so the stroke thins under the cursor
 *     and thickens either side. `la` is its own slower spring; pressure is 1
 *     with the cursor on the ring, fading over `liquidReach`.
 *
 * Two render paths, chosen by `applyTo`:
 *
 * `ring` — vector. The engine masks the ring with a rounded-rect outline it
 * traces every frame; we hand it a `DeformFn` that displaces those outline
 * points, plus the fill / rim / hairline that normally live on CSS boxes so
 * they bend along. Edges stay anti-aliased at any stretch. The instance is
 * redrawn from here at the pointer's frame rate, since the shared loop only
 * composites at 15 fps.
 *
 * `all` — SVG `feDisplacementMap` on the whole root. Bends the content too,
 * but the sampler duplicates source pixels where material is stretched, so
 * quality degrades with amplitude. Kept for comparison.
 */
export function useMetalBend(ref: RefObject<HTMLElement | null>, getCfg: () => BendConfig = () => BEND): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof document === 'undefined') return;

    const ring = el.querySelector<HTMLCanvasElement>('canvas.metal-fx-canvas');
    const inner = el.querySelector<HTMLElement>('.metal-fx-inner');

    // ── shared field state ──────────────────────────────────────────
    let pointer: { x: number; y: number } | null = null;
    let lastPointer: { x: number; y: number; t: number } | null = null;
    let pressed = false;
    let active = false;
    let cx = 0, cy = 0;          // blob centre, element-local px
    let ax = 0, ay = 0;          // directional displacement (px)
    let vax = 0, vay = 0;
    let la = 0, vla = 0;         // liquid amplitude
    let stx = 0, sty = 0, stl = 0; // low-passed targets (see smoothMs)
    let pressure = 0;
    let env = 0;                 // hover envelope 0..1 — no pops on enter/leave
    let svx = 0, svy = 0;        // smoothed cursor velocity, px/s
    let raf = 0, last = 0;
    // Redraw gate: physics integrates at display rate, but the canvas +
    // glow-mask rebuild is capped at 60 fps and skipped when nothing moved
    // more than 0.05 px — on a 120 Hz display that halves the bend's cost.
    let drawT = 0, dAx = NaN, dAy = NaN, dLa = NaN, dCx = NaN, dCy = NaN;

    // Per-frame constants for the field evaluators.
    let fDirX = 0, fDirY = 0, fRadK = 0, fS2b = 1, fS2l = 1;
    const evalField = (x: number, y: number, out: { x: number; y: number }) => {
      const dx = x - cx, dy = y - cy;
      const q = dx * dx + dy * dy;
      const gb = Math.exp(-q / fS2b);
      const gl = Math.exp(-q / fS2l);
      out.x = fDirX * gb + dx * fRadK * gl;
      out.y = fDirY * gb + dy * fRadK * gl;
    };
    const _f = { x: 0, y: 0 };
    const deform = (x: number, y: number, out: { x: number; y: number }) => {
      evalField(x, y, _f);
      out.x = x + _f.x;
      out.y = y + _f.y;
    };

    // ── vector path (ring mode) ─────────────────────────────────────
    const STYLE_ID = 'mfx-bend-style';
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = '.metal-fx-root[data-mfx-bend]::before,.metal-fx-root[data-mfx-bend]::after{box-shadow:none!important}';
      document.head.appendChild(st);
    }
    let vectorOn = false;
    let layers: DeformLayers | null = null;
    const prevRootBg = el.style.background;
    const prevInnerVis = inner?.style.visibility ?? '';

    /** "rgba(…) 0px 0px 0px 2px inset" → { color, spread } for the first shadow. */
    const parseShadow = (v: string): { color: string; spread: number } | null => {
      if (!v || v === 'none') return null;
      const m = v.match(/^(rgba?\([^)]*\)|#[0-9a-fA-F]+|[a-z]+)\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px/);
      if (!m) return null;
      return { color: m[1], spread: Math.abs(parseFloat(m[5])) };
    };
    const vectorStart = (overscan: number) => {
      if (vectorOn || !ring) return;
      const rim = parseShadow(getComputedStyle(el, '::after').boxShadow);
      const hair = inner ? parseShadow(getComputedStyle(inner).boxShadow) : null;
      const innerInset = inner ? parseFloat(getComputedStyle(inner).inset) || 0 : 0;
      layers = {
        fill: getComputedStyle(el).backgroundColor,
        rim: rim && rim.spread > 0 ? { inset: 0, width: rim.spread, color: rim.color } : null,
        hairline: hair && hair.spread > 0 ? { inset: innerInset, width: hair.spread, color: hair.color } : null,
      };
      el.style.background = 'transparent';
      el.setAttribute('data-mfx-bend', '');
      if (inner) inner.style.visibility = 'hidden';
      setInstanceDeform(ring, deform, layers, overscan);
      vectorOn = true;
    };
    const vectorStop = () => {
      if (!vectorOn || !ring) return;
      setInstanceDeform(ring, null, null, 0);
      el.style.background = prevRootBg;
      el.removeAttribute('data-mfx-bend');
      if (inner) inner.style.visibility = prevInnerVis;
      vectorOn = false;
    };

    // ── filter path (all mode) ──────────────────────────────────────
    const id = `mfx-bend-${Math.random().toString(36).slice(2, 8)}`;
    const NS = 'http://www.w3.org/2000/svg';
    const REGION = 0.75;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    const filter = document.createElementNS(NS, 'filter');
    filter.setAttribute('id', id);
    filter.setAttribute('x', `-${REGION * 100}%`); filter.setAttribute('y', `-${REGION * 100}%`);
    filter.setAttribute('width', `${(1 + 2 * REGION) * 100}%`); filter.setAttribute('height', `${(1 + 2 * REGION) * 100}%`);
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const feFlood = document.createElementNS(NS, 'feFlood');
    feFlood.setAttribute('flood-color', 'rgb(128,128,0)');
    feFlood.setAttribute('flood-opacity', '1');
    feFlood.setAttribute('result', 'neutral');
    const feImage = document.createElementNS(NS, 'feImage');
    feImage.setAttribute('result', 'img');
    feImage.setAttribute('preserveAspectRatio', 'none');
    const feComp = document.createElementNS(NS, 'feComposite');
    feComp.setAttribute('in', 'img'); feComp.setAttribute('in2', 'neutral');
    feComp.setAttribute('operator', 'over'); feComp.setAttribute('result', 'map');
    const feDisp = document.createElementNS(NS, 'feDisplacementMap');
    feDisp.setAttribute('in', 'SourceGraphic'); feDisp.setAttribute('in2', 'map');
    feDisp.setAttribute('xChannelSelector', 'R'); feDisp.setAttribute('yChannelSelector', 'G');
    feDisp.setAttribute('result', 'bent');
    const feSmooth = document.createElementNS(NS, 'feGaussianBlur');
    feSmooth.setAttribute('in', 'bent'); feSmooth.setAttribute('stdDeviation', '0');
    for (const n of [feFlood, feImage, feComp, feDisp, feSmooth]) filter.appendChild(n);
    svg.appendChild(filter);
    document.body.appendChild(svg);

    const map = document.createElement('canvas');
    const mctx = map.getContext('2d', { alpha: false, willReadFrequently: true });
    let img: ImageData | null = null;
    let img32: Uint32Array | null = null;
    const NEUTRAL = 0xff008080;
    let filterOn = false;
    const prevFilter = el.style.filter;
    const filterStop = () => {
      if (!filterOn) return;
      el.style.filter = prevFilter;
      filterOn = false;
    };
    const filterFrame = (cfg: BendConfig, W: number, H: number, scale: number) => {
      if (!mctx) return;
      const res = Math.max(0.25, cfg.mapRes);
      const mx = -W * REGION, my = -H * REGION, mw = W * (1 + 2 * REGION), mh = H * (1 + 2 * REGION);
      const pw = Math.max(2, Math.round(mw * res)), ph = Math.max(2, Math.round(mh * res));
      if (map.width !== pw || map.height !== ph || !img || !img32) {
        map.width = pw; map.height = ph;
        img = mctx.createImageData(pw, ph);
        img32 = new Uint32Array(img.data.buffer);
      }
      img32.fill(NEUTRAL);
      const data = img.data;
      const ext = 3 * Math.max(cfg.blob, cfg.liquidBlob);
      const px0 = Math.max(0, Math.floor((cx - ext - mx) * res));
      const px1 = Math.min(pw - 1, Math.ceil((cx + ext - mx) * res));
      const py0 = Math.max(0, Math.floor((cy - ext - my) * res));
      const py1 = Math.min(ph - 1, Math.ceil((cy + ext - my) * res));
      const inv = 255 / scale;
      for (let py = py0; py <= py1; py++) {
        const y = my + (py + 0.5) / res;
        let i = (py * pw + px0) * 4;
        for (let px = px0; px <= px1; px++, i += 4) {
          const x = mx + (px + 0.5) / res;
          evalField(x, y, _f);
          let r = 127.5 - _f.x * inv; r = r < 0 ? 0 : r > 255 ? 255 : r;
          let g = 127.5 - _f.y * inv; g = g < 0 ? 0 : g > 255 ? 255 : g;
          data[i] = r; data[i + 1] = g;
        }
      }
      mctx.putImageData(img, 0, 0);
      feImage.setAttribute('x', mx.toFixed(2)); feImage.setAttribute('y', my.toFixed(2));
      feImage.setAttribute('width', mw.toFixed(2)); feImage.setAttribute('height', mh.toFixed(2));
      feImage.setAttribute('href', map.toDataURL('image/png'));
      feDisp.setAttribute('scale', scale.toFixed(2));
      feSmooth.setAttribute('stdDeviation', Math.max(0, cfg.smooth).toFixed(3));
      if (!filterOn) { el.style.filter = `url(#${id})`; filterOn = true; }
    };

    // ── simulation ──────────────────────────────────────────────────
    const kick = () => {
      if (raf !== 0) return;
      last = performance.now();
      raf = requestAnimationFrame(step);
    };

    const step = (now: number) => {
      raf = 0;
      const cfg = getCfg();
      const dt = Math.min(0.032, Math.max(0.001, (now - last) / 1000));
      last = now;

      const r = el.getBoundingClientRect();
      const W = r.width, H = r.height;
      const ecx = W / 2, ecy = H / 2;

      let tx = 0, ty = 0;
      pressure = 0;
      if (cfg.enabled && pointer) {
        const lx = pointer.x - r.left, ly = pointer.y - r.top;
        const ddx = lx - ecx, ddy = ly - ecy;
        const d = Math.hypot(ddx, ddy);
        const R = Math.min(W, H) / 2;
        const reach = Math.max(W, H) / 2 + cfg.reach;
        const wasActive = active;
        active = d < reach;
        const u = Math.max(0, 1 - Math.abs(d - R) / Math.max(1, cfg.liquidReach));
        pressure = u * u * (3 - 2 * u);
        if (active) {
          if (!wasActive) { cx = lx; cy = ly; }
          // `follow` is defined per 60 Hz frame; convert to this frame's dt.
          const fa = 1 - Math.pow(1 - Math.min(0.999, cfg.follow), dt * 60);
          cx += (lx - cx) * fa;
          cy += (ly - cy) * fa;
          const edgeFade = 1 - Math.max(0, (d - (reach - cfg.reach)) / cfg.reach);
          // Transient kick from cursor speed.
          tx = svx * (cfg.gain / 100) * edgeFade;
          ty = svy * (cfg.gain / 100) * edgeFade;
          // Position-based, so the dent holds while the cursor sits there.
          // Inside the edge: press toward the centre by penetration.
          // Outside: pull toward the cursor, fading to zero at reach.
          const ux = d > 0.001 ? ddx / d : 0, uy = d > 0.001 ? ddy / d : 0;
          const pen = R - d;
          if (pen > 0) {
            const m = pen * cfg.pressGain;
            tx -= ux * m; ty -= uy * m;
          } else {
            const out = -pen;
            const f = Math.max(0, 1 - out / Math.max(1, cfg.reach));
            const m = out * cfg.pullGain * (f * f * (3 - 2 * f));
            tx += ux * m; ty += uy * m;
          }
          const tm = Math.hypot(tx, ty);
          if (tm > cfg.maxDisp) { tx *= cfg.maxDisp / tm; ty *= cfg.maxDisp / tm; }
        }
      } else {
        active = false;
      }
      svx *= Math.exp(-dt * 12); svy *= Math.exp(-dt * 12);

      // Low-pass the targets. Springs then chase a smooth signal instead of a
      // stepping one — the stepping is what read as "unnatural" on fast sweeps.
      const sa = 1 - Math.exp(-(dt * 1000) / Math.max(1, cfg.smoothMs));
      stx += (tx - stx) * sa;
      sty += (ty - sty) * sa;

      const m = Math.max(0.05, cfg.mass);
      vax += ((-cfg.stiffness * (ax - stx) - cfg.damping * vax) / m) * dt;
      vay += ((-cfg.stiffness * (ay - sty) - cfg.damping * vay) / m) * dt;
      ax += vax * dt; ay += vay * dt;

      const pressAmt = pressed && active && cfg.enabled ? cfg.press : 0;
      const tl = active && cfg.enabled ? cfg.liquid * (pressure + (pressed ? 0.5 : 0)) : 0;
      stl += (tl - stl) * sa;
      vla += ((-cfg.liquidStiffness * (la - stl) - cfg.liquidDamping * vla) / m) * dt;
      la += vla * dt;

      // Envelope: exponential approach, ~95% of the way by fadeIn/OutMs.
      const envTarget = active && cfg.enabled ? 1 : 0;
      const tauMs = Math.max(1, envTarget ? cfg.fadeInMs : cfg.fadeOutMs) / 3;
      env += (envTarget - env) * (1 - Math.exp(-(dt * 1000) / tauMs));
      if (env < 0.002 && envTarget === 0) env = 0;

      const amp = Math.hypot(ax, ay);
      const idle = !active && env === 0 && amp < 0.05 && Math.hypot(vax, vay) < 1 && Math.abs(la) < 0.05 && pressAmt === 0;

      // Mode switch releases whichever path was active.
      if (cfg.applyTo === 'ring') filterStop(); else vectorStop();

      if (idle) {
        ax = ay = vax = vay = la = vla = 0;
        stx = sty = stl = 0;
        dAx = dAy = dLa = dCx = dCy = NaN;
        vectorStop();
        filterStop();
        return;
      }

      // Field constants for this frame. The envelope scales the whole field.
      const k = Math.max(0, cfg.strength) * env;
      let pdx = ecx - cx, pdy = ecy - cy;
      const pl = Math.hypot(pdx, pdy) || 1; pdx /= pl; pdy /= pl;
      const sb = Math.max(0.5, cfg.blob), sl = Math.max(0.5, cfg.liquidBlob);
      fS2b = 2 * sb * sb; fS2l = 2 * sl * sl;
      fDirX = (ax + pdx * pressAmt) * k;
      fDirY = (ay + pdy * pressAmt) * k;
      fRadK = (la / sl) * k;

      const moved = !(Math.abs(ax - dAx) < 0.05 && Math.abs(ay - dAy) < 0.05 && Math.abs(la - dLa) < 0.05 &&
                      Math.abs(cx - dCx) < 0.05 && Math.abs(cy - dCy) < 0.05);
      const due = now - drawT >= 1000 / 60 - 0.5;
      if (moved && due) {
        drawT = now; dAx = ax; dAy = ay; dLa = la; dCx = cx; dCy = cy;
        if (cfg.applyTo === 'ring' && ring) {
          // Overscan budget: the furthest any point can travel.
          const reachPx = Math.ceil((cfg.maxDisp + cfg.liquid * 1.5) * Math.max(1, cfg.strength)) + 4;
          vectorStart(reachPx);
          redrawInstance(ring);
        } else {
          const scale = Math.max(1, (cfg.maxDisp + cfg.liquid * 1.5) * 2 * Math.max(1, cfg.strength));
          filterFrame(cfg, W, H, scale);
        }
      } else if (cfg.applyTo === 'ring' && ring && !vectorOn) {
        vectorStart(Math.ceil((cfg.maxDisp + cfg.liquid * 1.5) * Math.max(1, cfg.strength)) + 4);
      }

      raf = requestAnimationFrame(step);
    };

    const onMove = (e: PointerEvent) => {
      const now = performance.now();
      if (lastPointer) {
        const dt = Math.max(0.004, (now - lastPointer.t) / 1000);
        // ~40 ms time constant regardless of event rate.
        const a = 1 - Math.exp(-dt / 0.04);
        svx += ((e.clientX - lastPointer.x) / dt - svx) * a;
        svy += ((e.clientY - lastPointer.y) / dt - svy) * a;
      }
      lastPointer = { x: e.clientX, y: e.clientY, t: now };
      pointer = { x: e.clientX, y: e.clientY };
      kick();
    };
    const onLeave = () => { pointer = null; lastPointer = null; kick(); };
    const onDown = () => { pressed = true; kick(); };
    const onUp = () => { pressed = false; kick(); };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);
    el.addEventListener('pointerdown', onDown);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);

    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      el.removeEventListener('pointerdown', onDown);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onUp);
      vectorStop();
      filterStop();
      if (svg.parentNode) svg.parentNode.removeChild(svg);
    };
  }, [ref, getCfg]);
}
