/**
 * Rounded-rect outline sampling and perimeter math — the web's
 * `renderer/outline.ts` and `glow/geometry.ts`. Worklets, so the bend can
 * rebuild the path on the UI thread every frame.
 */
import { FillType, Skia, type SkPath } from '@shopify/react-native-skia';

export type ShapeKind = 'pill' | 'circle';
export type Pt = { x: number; y: number };
export type Deform = ((x: number, y: number) => Pt) | null;

const ARC_N = 14;
const EDGE_STEP = 1.5;

/** Clockwise from the end of the top-left corner; flat [x0,y0,x1,y1,…]. */
export function roundRectOutline(x: number, y: number, w: number, h: number, radius: number, deform: Deform): number[] {
  'worklet';
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  const out: number[] = [];
  const push = (px: number, py: number) => {
    if (deform) { const q = deform(px, py); out.push(q.x, q.y); } else { out.push(px, py); }
  };
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const k = Math.max(1, Math.ceil(len / EDGE_STEP));
    for (let i = 0; i < k; i++) { const t = i / k; push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t); }
  };
  const arc = (cx: number, cy: number, a0: number, a1: number) => {
    for (let i = 0; i <= ARC_N; i++) { const a = a0 + (a1 - a0) * (i / ARC_N); push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  };
  edge(x + r, y, x + w - r, y);
  arc(x + w - r, y + r, -Math.PI / 2, 0);
  edge(x + w, y + r, x + w, y + h - r);
  arc(x + w - r, y + h - r, 0, Math.PI / 2);
  edge(x + w - r, y + h, x + r, y + h);
  arc(x + r, y + h - r, Math.PI / 2, Math.PI);
  edge(x, y + h - r, x, y + r);
  arc(x + r, y + r, Math.PI, 1.5 * Math.PI);
  return out;
}

export function addOutline(path: SkPath, xy: number[]): void {
  'worklet';
  if (xy.length < 4) return;
  path.moveTo(xy[0], xy[1]);
  for (let i = 2; i < xy.length; i += 2) path.lineTo(xy[i], xy[i + 1]);
  path.close();
}

/** Outer outline with the inner one punched out (even-odd). */
export function bandPath(outer: number[], inner: number[]): SkPath {
  'worklet';
  const p = Skia.Path.Make();
  addOutline(p, outer);
  addOutline(p, inner);
  p.setFillType(FillType.EvenOdd);
  return p;
}

export function outlinePath(xy: number[]): SkPath {
  'worklet';
  const p = Skia.Path.Make();
  addOutline(p, xy);
  return p;
}

export function shapeKind(w: number, h: number, radius: number): ShapeKind {
  'worklet';
  const m = Math.min(w, h);
  return Math.abs(w - h) < 0.5 && radius >= m / 2 - 0.5 ? 'circle' : 'pill';
}

export function rrPerim(w: number, h: number, r: number): number {
  'worklet';
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  return 2 * Math.max(0, w - 2 * rr) + 2 * Math.max(0, h - 2 * rr) + 2 * Math.PI * rr;
}

export function shapePerim(w: number, h: number, r: number, kind: ShapeKind): number {
  'worklet';
  if (kind === 'circle') return 2 * Math.PI * Math.max(0, Math.min(r, Math.min(w, h) / 2));
  return rrPerim(w, h, r);
}

export function sampleAtArc(sIn: number, w: number, h: number, r: number, inset: number, outward: number, kind: ShapeKind): Pt {
  'worklet';
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  if (kind === 'circle') {
    const perim = 2 * Math.PI * rr;
    if (perim <= 0.0001) return { x: w / 2, y: h / 2 };
    const s = ((sIn % perim) + perim) % perim;
    const theta = -Math.PI / 2 + (s / perim) * Math.PI * 2;
    const rad = Math.max(0, rr - inset + outward);
    return { x: w / 2 + rad * Math.cos(theta), y: h / 2 + rad * Math.sin(theta) };
  }
  const topLen = Math.max(0, w - 2 * rr), sideLen = Math.max(0, h - 2 * rr);
  const arcLen = (Math.PI * rr) / 2;
  const perim = 2 * (topLen + sideLen) + 4 * arcLen;
  let d = ((sIn % perim) + perim) % perim;
  const rad = Math.max(0, rr - inset + outward);
  if (d < topLen) return { x: rr + d, y: inset - outward };
  d -= topLen;
  if (d < arcLen) { const th = -Math.PI / 2 + (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2); return { x: (w - rr) + rad * Math.cos(th), y: rr + rad * Math.sin(th) }; }
  d -= arcLen;
  if (d < sideLen) return { x: w - inset + outward, y: rr + d };
  d -= sideLen;
  if (d < arcLen) { const th = (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2); return { x: (w - rr) + rad * Math.cos(th), y: (h - rr) + rad * Math.sin(th) }; }
  d -= arcLen;
  if (d < topLen) return { x: w - rr - d, y: h - inset + outward };
  d -= topLen;
  if (d < arcLen) { const th = Math.PI / 2 + (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2); return { x: rr + rad * Math.cos(th), y: (h - rr) + rad * Math.sin(th) }; }
  d -= arcLen;
  if (d < sideLen) return { x: inset - outward, y: h - rr - d };
  d -= sideLen;
  const th = Math.PI + (arcLen > 0 ? d / arcLen : 0) * (Math.PI / 2);
  return { x: rr + rad * Math.cos(th), y: rr + rad * Math.sin(th) };
}

export function tangentAngleAtArc(s: number, w: number, h: number, r: number, inset: number, kind: ShapeKind): number {
  'worklet';
  const a = sampleAtArc(s - 0.5, w, h, r, inset, 0, kind);
  const b = sampleAtArc(s + 0.5, w, h, r, inset, 0, kind);
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/** Where a ray from the centre in (dx, dy) leaves the rounded rect. */
export function boundaryPoint(w: number, h: number, radius: number, dx: number, dy: number): Pt {
  'worklet';
  const hw = w / 2, hh = h / 2;
  const r = Math.max(0, Math.min(radius, Math.min(hw, hh)));
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: hw, y: hh };
  const nx = dx / len, ny = dy / len;
  const tx = Math.abs(nx) > 1e-6 ? hw / Math.abs(nx) : Infinity;
  const ty = Math.abs(ny) > 1e-6 ? hh / Math.abs(ny) : Infinity;
  let t = Math.min(tx, ty);
  const px = nx * t, py = ny * t;
  if (Math.abs(px) > hw - r && Math.abs(py) > hh - r && r > 0) {
    const cx = (px < 0 ? -1 : 1) * (hw - r), cy = (py < 0 ? -1 : 1) * (hh - r);
    const b = -2 * (nx * cx + ny * cy);
    const c = cx * cx + cy * cy - r * r;
    const disc = b * b - 4 * c;
    if (disc >= 0) t = (-b + Math.sqrt(disc)) / 2;
  }
  return { x: hw + nx * t, y: hh + ny * t };
}
