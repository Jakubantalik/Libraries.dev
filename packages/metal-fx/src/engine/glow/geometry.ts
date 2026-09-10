/**
 * Pure geometry + SVG markup for the glow overlay.
 *
 * Perimeter math (rounded-rect / circle arc-length sampling), blob path
 * generation, SVG filter/mask construction, and HSV colour helpers.
 * No state — every function is a pure transform.
 */
import { PERIM_SAMPLES } from '../perfConfig';

import { GLOW } from './config';
import { outlinePathD, roundRectOutline } from '../renderer/outline';

export { PERIM_SAMPLES };

export interface GlowOptions {
  width: number;
  height: number;
  cornerRadius: number;
  kind: 'pill' | 'circle';
  /** Master multiplier for absolute SVG units (stroke widths, blur,
   *  fade-circle radius). 1 is the canonical 1× rendering. Set to 2 when
   *  the host element is rendered at a 2× layout (e.g. CSS zoom: 2) so
   *  the glow grows proportionally. */
  scale?: number;
  /**
   * Point mode (custom-mask instances). `samplePoints` are box-local CSS-px
   * positions inside the mask where luminance is sampled and the hotspot can
   * sit; `maskDataUrl` is the mask rendered white-on-transparent, used to clip
   * the glow to the glyphs instead of the ring band.
   */
  samplePoints?: Pt[];
  maskDataUrl?: string;
}
export interface Pt { x: number; y: number }
export interface PerimSample extends Pt { arc: number }

export function rrPerim(w: number, h: number, r: number): number {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  return 2 * Math.max(0, w - 2 * rr) + 2 * Math.max(0, h - 2 * rr) + 2 * Math.PI * rr;
}

export function shapePerim(w: number, h: number, r: number, kind: 'pill' | 'circle'): number {
  if (kind === 'circle') return 2 * Math.PI * Math.max(0, Math.min(r, Math.min(w, h) / 2));
  return rrPerim(w, h, r);
}

export function sampleAtArc(s: number, w: number, h: number, r: number, inset: number, outward: number, kind: 'pill' | 'circle', out?: Pt): Pt {
  const o = out || { x: 0, y: 0 };
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (kind === 'circle') {
    const perim = 2 * Math.PI * rr;
    if (perim <= 0.0001) { o.x = w * 0.5; o.y = h * 0.5; return o; }
    s = ((s % perim) + perim) % perim;
    const theta = -Math.PI / 2 + (s / perim) * Math.PI * 2;
    const rad = Math.max(0, rr - inset + outward);
    o.x = w * 0.5 + rad * Math.cos(theta);
    o.y = h * 0.5 + rad * Math.sin(theta);
    return o;
  }
  const topLen = Math.max(0, w - 2 * rr), sideLen = Math.max(0, h - 2 * rr);
  const arcLen = (Math.PI * rr) / 2;
  const perim = 2 * (topLen + sideLen) + 4 * arcLen;
  s = ((s % perim) + perim) % perim;
  const rad = Math.max(0, rr - inset + outward);
  let d = s;
  if (d < topLen) { o.x = rr + d; o.y = inset - outward; return o; }
  d -= topLen;
  if (d < arcLen) {
    const theta = -Math.PI / 2 + (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2);
    o.x = (w - rr) + rad * Math.cos(theta); o.y = rr + rad * Math.sin(theta); return o;
  }
  d -= arcLen;
  if (d < sideLen) { o.x = w - inset + outward; o.y = rr + d; return o; }
  d -= sideLen;
  if (d < arcLen) {
    const theta = (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2);
    o.x = (w - rr) + rad * Math.cos(theta); o.y = (h - rr) + rad * Math.sin(theta); return o;
  }
  d -= arcLen;
  if (d < topLen) { o.x = w - rr - d; o.y = h - inset + outward; return o; }
  d -= topLen;
  if (d < arcLen) {
    const theta = Math.PI / 2 + (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2);
    o.x = rr + rad * Math.cos(theta); o.y = (h - rr) + rad * Math.sin(theta); return o;
  }
  d -= arcLen;
  if (d < sideLen) { o.x = inset - outward; o.y = h - rr - d; return o; }
  d -= sideLen;
  const theta = Math.PI + (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2);
  o.x = rr + rad * Math.cos(theta); o.y = rr + rad * Math.sin(theta);
  return o;
}

/**
 * Inverse of `sampleAtArc` at inset 0: the arc-length position on the outline
 * nearest a box-local point. Points off the outline project onto it.
 */
export function arcAtPoint(x: number, y: number, w: number, h: number, r: number, kind: 'pill' | 'circle'): number {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (kind === 'circle') {
    const perim = 2 * Math.PI * rr;
    if (perim <= 0.0001) return 0;
    const theta = Math.atan2(y - h / 2, x - w / 2);
    const s = ((theta + Math.PI / 2) / (2 * Math.PI)) * perim;
    return ((s % perim) + perim) % perim;
  }
  const topLen = Math.max(0, w - 2 * rr), sideLen = Math.max(0, h - 2 * rr);
  const arcLen = (Math.PI * rr) / 2, Q = Math.PI / 2;
  const s1 = topLen, s2 = s1 + arcLen, s3 = s2 + sideLen, s4 = s3 + arcLen, s5 = s4 + topLen, s6 = s5 + arcLen, s7 = s6 + sideLen;
  const inX = x >= rr && x <= w - rr, inY = y >= rr && y <= h - rr;
  if (inX && inY) {
    const dl = x, dr = w - x, dt = y, db = h - y, m = Math.min(dl, dr, dt, db);
    if (m === dt) return x - rr;
    if (m === dr) return s2 + (y - rr);
    if (m === db) return s4 + (w - rr - x);
    return s6 + (h - rr - y);
  }
  if (inX) return y < h / 2 ? x - rr : s4 + (w - rr - x);
  if (inY) return x > w / 2 ? s2 + (y - rr) : s6 + (h - rr - y);
  if (x > w / 2 && y < h / 2) { const t = Math.atan2(y - rr, x - (w - rr)); return s1 + ((t + Q) / Q) * arcLen; }
  if (x > w / 2) { const t = Math.atan2(y - (h - rr), x - (w - rr)); return s3 + (t / Q) * arcLen; }
  if (y > h / 2) { const t = Math.atan2(y - (h - rr), x - rr); return s5 + ((t - Q) / Q) * arcLen; }
  const t = Math.atan2(y - rr, x - rr);
  return s7 + ((t + Math.PI) / Q) * arcLen;
}

export function buildStaticBlobPath(halfLen: number, segments: number): string {
  const step = (halfLen * 2) / segments;
  let d = '';
  for (let i = 0; i <= segments; i++) {
    const x = -halfLen + i * step;
    d += (i === 0 ? 'M ' : 'L ') + x.toFixed(3) + ' 0 ';
  }
  return d;
}

const _ta: Pt = { x: 0, y: 0 };
const _tb: Pt = { x: 0, y: 0 };

export function tangentAngleAtArc(s: number, w: number, h: number, r: number, inset: number, kind: 'pill' | 'circle'): number {
  const eps = 0.1;
  sampleAtArc(s - eps, w, h, r, inset, 0, kind, _ta);
  sampleAtArc(s + eps, w, h, r, inset, 0, kind, _tb);
  return Math.atan2(_tb.y - _ta.y, _tb.x - _ta.x);
}

export function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function buildPerimTable(opts: GlowOptions): PerimSample[] {
  if (opts.samplePoints && opts.samplePoints.length > 0) {
    // Point mode: `arc` is just the index — relocation logic works on
    // indices, and positioning bypasses arc math entirely.
    return opts.samplePoints.map((p, i) => ({ x: p.x, y: p.y, arc: i }));
  }
  const perim = shapePerim(opts.width, opts.height, opts.cornerRadius, opts.kind);
  const insetS = GLOW.inset * (opts.scale ?? 1);
  const table: PerimSample[] = [];
  for (let i = 0; i < PERIM_SAMPLES; i++) {
    const arc = (i / PERIM_SAMPLES) * perim;
    const pt = sampleAtArc(arc, opts.width, opts.height, opts.cornerRadius, insetS, 0, opts.kind);
    table.push({ x: pt.x, y: pt.y, arc });
  }
  return table;
}

export function buildSvgMarkup(opts: GlowOptions, p: string): string {
  const { width: W, height: H, cornerRadius: R } = opts;
  const s = opts.scale ?? 1;
  const ringInset = opts.kind === 'circle' ? 2 : 1;
  const innerR = Math.max(0, R - ringInset);
  // Filter region grows with scale so blurred strokes don't get clipped at
  // bigger sizes. The 200/540/440 baseline matches the canonical 1× pill.
  const fX = (-200 * s).toFixed(0), fY = fX;
  const fW = (540 * s).toFixed(0), fH = (440 * s).toFixed(0);
  const fRect = `x="${fX}" y="${fY}" width="${fW}" height="${fH}"`;
  const fr = `${fRect} filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"`;
  // Stroke widths and blur stdDeviations are absolute SVG units; multiply
  // by `s` so they remain proportional when viewBox grows with the host.
  const sw = (n: number) => (n * s).toFixed(3);
  const sd = (n: number) => (n * s).toFixed(3);
  return [
    '<defs>',
    `<filter id="${p}_bXl" ${fr}><feGaussianBlur stdDeviation="${sd(GLOW.haloBlurXl)}"/></filter>`,
    `<filter id="${p}_bLg" ${fr}><feGaussianBlur stdDeviation="${sd(GLOW.haloBlurLg)}"/></filter>`,
    `<filter id="${p}_bMd" ${fr}><feGaussianBlur stdDeviation="${sd(GLOW.haloBlurMd)}"/></filter>`,
    `<filter id="${p}_bSm" ${fr}><feGaussianBlur stdDeviation="${sd(GLOW.haloBlurSm)}"/></filter>`,
    `<filter id="${p}_ebO" ${fr}><feGaussianBlur stdDeviation="${sd(GLOW.extraBlurOuter)}"/></filter>`,
    `<filter id="${p}_ebC" ${fr}><feGaussianBlur stdDeviation="${sd(GLOW.extraBlurCore)}"/></filter>`,
    `<radialGradient id="${p}_fg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="white"/><stop offset="0.30" stop-color="white"/><stop offset="0.65" stop-color="#404040"/><stop offset="1" stop-color="black"/></radialGradient>`,
    `<mask id="${p}_fm" maskUnits="userSpaceOnUse" ${fRect}><rect ${fRect} fill="black"/><circle id="${p}_fc" cx="0" cy="0" r="${(GLOW.extraFadeR * s).toFixed(3)}" fill="url(#${p}_fg)"/></mask>`,
    opts.maskDataUrl
      // Point mode clips hard to the glyphs (black surround); the halo's
      // blurred energy outside the strokes is discarded, so `pointGain`
      // compensates inside them.
      ? `<mask id="${p}_rm" maskUnits="userSpaceOnUse" ${fRect}><rect ${fRect} fill="black"/><image href="${opts.maskDataUrl}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/></mask>`
      : `<mask id="${p}_rm" maskUnits="userSpaceOnUse" ${fRect}><rect ${fRect} fill="#808080"/><path id="${p}_rmO" d="${outlinePathD(roundRectOutline(0, 0, W, H, R, null))}" fill="white"/><path id="${p}_rmI" d="${outlinePathD(roundRectOutline(ringInset, ringInset, W - ringInset * 2, H - ringInset * 2, innerR, null))}" fill="black"/></mask>`,
    '</defs>',
    // Safari clips mask to the masked element's bbox; our horizontal strokes
    // have zero height, so the mask becomes a sliver. These spacer rects
    // inflate the bbox to the full filter region.
    `<g id="${p}_h" mask="url(#${p}_rm)" opacity="0">`,
    `<rect ${fRect} fill="none" pointer-events="none"/>`,
    `<g id="${p}_hI" stroke="white">`,
    `<path id="${p}_pXl" stroke-width="${sw(GLOW.haloStrokeXl)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${GLOW.haloOpXl}" filter="url(#${p}_bXl)"/>`,
    `<path id="${p}_pLg" stroke-width="${sw(GLOW.haloStrokeLg)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${GLOW.haloOpLg}" filter="url(#${p}_bLg)"/>`,
    `<path id="${p}_pMd" stroke-width="${sw(GLOW.haloStrokeMd)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${GLOW.haloOpMd}" filter="url(#${p}_bMd)"/>`,
    `<path id="${p}_pSm" stroke-width="${sw(GLOW.haloStrokeSm)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${GLOW.haloOpSm}" filter="url(#${p}_bSm)"/>`,
    '</g></g>',
    `<g id="${p}_e" mask="url(#${p}_rm)" opacity="0">`,
    `<rect ${fRect} fill="none" pointer-events="none"/>`,
    `<g mask="url(#${p}_fm)">`,
    `<g id="${p}_eI" stroke="white">`,
    `<path id="${p}_eO" stroke-width="${sw(GLOW.extraStrokeOuter)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="${GLOW.extraOpOuter}" filter="url(#${p}_ebO)"/>`,
    `<path id="${p}_eC" stroke-width="${sw(GLOW.extraStrokeCore)}" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity="1.0" filter="url(#${p}_ebC)"/>`,
    '</g></g></g>',
  ].join('');
}
