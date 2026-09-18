/* Generates src/shapes.ts: the ten body outlines as SVG path data in a
   100×100 box, centred on (50, 50). Run with `node scripts/gen-shapes.mjs`.

   Everything is built from a few primitives so the silhouettes stay
   smooth at every size: circle unions with filleted cusps (clover,
   flower), rounded polygons with true circular fillets (sun, triangle,
   star), a superellipse (square), a polar blob, and hand-drawn Béziers
   (ghost, drop). Numbers are rounded to 0.01 to keep the strings short. */

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const C = 50;
const f = (n) => Math.round(n * 100) / 100;
const pt = (p) => `${f(p[0])} ${f(p[1])}`;
const polar = (r, a) => [C + r * Math.cos(a), C + r * Math.sin(a)];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = (a) => Math.hypot(a[0], a[1]);
const norm = (a) => mul(a, 1 / len(a));
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

/* ── Rounded polygon: every vertex replaced by a circular fillet ────── */
function roundedPolygon(points, radius) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = points[(i - 1 + n) % n];
    const v = points[i];
    const q = points[(i + 1) % n];
    const r = typeof radius === "function" ? radius(i) : radius;
    const u1 = norm(sub(p, v));
    const u2 = norm(sub(q, v));
    const cosA = u1[0] * u2[0] + u1[1] * u2[1];
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosA)));
    /* tangent distance from the vertex; clamped so neighbouring fillets
       never overlap */
    let t = r / Math.tan(alpha / 2);
    const maxT = Math.min(len(sub(p, v)), len(sub(q, v))) / 2 - 0.01;
    let rr = r;
    if (t > maxT) { t = maxT; rr = t * Math.tan(alpha / 2); }
    const a = add(v, mul(u1, t));
    const b = add(v, mul(u2, t));
    /* sweep: 1 when the corner turns clockwise on screen (y down) */
    const sweep = cross(sub(v, p), sub(q, v)) > 0 ? 1 : 0;
    out.push({ a, b, rr, sweep });
  }
  let d = `M${pt(out[0].a)}`;
  for (let i = 0; i < n; i++) {
    const s = out[i];
    d += `A${f(s.rr)} ${f(s.rr)} 0 0 ${s.sweep} ${pt(s.b)}`;
    const next = out[(i + 1) % n];
    d += `L${pt(next.a)}`;
  }
  return d + "Z";
}

/* ── Union of k equal circles on a ring, cusps filleted ─────────────── */
function lobes(k, r, offset, fillet, phase = -Math.PI / 2) {
  const centres = [];
  for (let i = 0; i < k; i++) centres.push(polar(offset, phase + (i * 2 * Math.PI) / k));
  const parts = [];
  for (let i = 0; i < k; i++) {
    const a = centres[i];
    const b = centres[(i + 1) % k];
    /* fillet circle: tangent to both lobes from outside, on the outer
       side of the chord between their centres */
    const m = mul(add(a, b), 0.5);
    const d = len(sub(b, a));
    const h = Math.sqrt((r + fillet) ** 2 - (d / 2) ** 2);
    const outward = norm(sub(m, [C, C]));
    const c = add(m, mul(outward, h));
    const ta = add(a, mul(norm(sub(c, a)), r));
    const tb = add(b, mul(norm(sub(c, b)), r));
    parts.push({ ta, tb });
  }
  /* lobe i runs from the fillet before it (parts[i-1].tb) to the fillet
     after it (parts[i].ta), the long way round its circle */
  let d = `M${pt(parts[k - 1].tb)}`;
  for (let i = 0; i < k; i++) {
    const from = parts[(i - 1 + k) % k].tb;
    const { ta, tb } = parts[i];
    /* the lobe's outer arc is the clockwise way round from `from` to
       `ta`; past a half-turn it needs the large-arc flag */
    const c = centres[i];
    const a0 = Math.atan2(from[1] - c[1], from[0] - c[0]);
    const a1 = Math.atan2(ta[1] - c[1], ta[0] - c[0]);
    const span = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    d += `A${r} ${r} 0 ${span > Math.PI ? 1 : 0} 1 ${pt(ta)}`;
    d += `A${f(fillet)} ${f(fillet)} 0 0 0 ${pt(tb)}`;
  }
  return d + "Z";
}

/* ── Superellipse (squircle) ────────────────────────────────────────── */
function squircle(half, n, steps = 64) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    const c = Math.cos(a), s = Math.sin(a);
    pts.push([C + half * Math.sign(c) * Math.abs(c) ** (2 / n), C + half * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return smoothClosed(pts);
}

/* ── Polar blob, sampled and smoothed ───────────────────────────────── */
function blob(fn, steps = 48) {
  const pts = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    pts.push(polar(fn(a), a));
  }
  return smoothClosed(pts);
}

/* Catmull-Rom through the points, emitted as cubic Béziers. */
function smoothClosed(p) {
  const n = p.length;
  let d = `M${pt(p[0])}`;
  for (let i = 0; i < n; i++) {
    const p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
    const c1 = add(p1, mul(sub(p2, p0), 1 / 6));
    const c2 = sub(p2, mul(sub(p3, p1), 1 / 6));
    d += `C${pt(c1)} ${pt(c2)} ${pt(p2)}`;
  }
  return d + "Z";
}

/* ── The ten ────────────────────────────────────────────────────────── */

const clover = lobes(4, 25, 19, 7);
const flower = lobes(5, 20.5, 22, 5);

const tri = roundedPolygon([[50, 8], [94, 84], [6, 84]], 13);

const starPts = [];
for (let i = 0; i < 10; i++) {
  const a = -Math.PI / 2 + (i * Math.PI) / 5;
  starPts.push(polar(i % 2 === 0 ? 47 : 27, a));
}
const star = roundedPolygon(starPts, (i) => (i % 2 === 0 ? 5 : 4));

const square = squircle(43, 3.4);

const blobShape = blob((a) => 39 + 3.2 * Math.sin(2 * a + 0.9) + 2.4 * Math.sin(3 * a + 2.3) + 1.6 * Math.sin(5 * a + 0.4));

const circle = `M${pt([C, 8])}A42 42 0 1 1 ${pt([C, 92])}A42 42 0 1 1 ${pt([C, 8])}Z`;

/* Ghost: a dome over a body with a three-scallop hem. */
const ghost = "M17 50C17 31.78 31.78 17 50 17C68.22 17 83 31.78 83 50V81.5Q72 93.5 61 81.5Q50 93.5 39 81.5Q28 93.5 17 81.5Z";

/* Drop: a round belly rising to a soft tip. */
const drop = "M50 8.5C52.2 8.5 53.4 10.3 56.4 15.2C62.9 25.5 84 44.6 84 61.5C84 80.3 68.8 92 50 92C31.2 92 16 80.3 16 61.5C16 44.6 37.1 25.5 43.6 15.2C46.6 10.3 47.8 8.5 50 8.5Z";

/* Droid: a rounded head, an antenna with a ball, two round ears. */
const droid = "M16 50C16 38.95 24.95 30 36 30H64C75.05 30 84 38.95 84 50V70C84 81.05 75.05 90 64 90H36C24.95 90 16 81.05 16 70Z" +
  "M4 62A7 7 0 1 1 18 62A7 7 0 1 1 4 62Z" +
  "M82 62A7 7 0 1 1 96 62A7 7 0 1 1 82 62Z" +
  "M47.5 14H52.5V32H47.5Z" +
  "M43 11A7 7 0 1 1 57 11A7 7 0 1 1 43 11Z";

/* Mech: a wide head, two antennae, a nub on each side. */
const mech = "M10 48C10 38.06 18.06 30 28 30H72C81.94 30 90 38.06 90 48V70C90 79.94 81.94 88 72 88H28C18.06 88 10 79.94 10 70Z" +
  "M3 54C3 51.79 4.79 50 7 50H11V72H7C4.79 72 3 70.21 3 68Z" +
  "M89 50H93C95.21 50 97 51.79 97 54V68C97 70.21 95.21 72 93 72H89Z" +
  "M19.5 32L24.5 32L17 13L12 13Z" +
  "M75.5 32L80.5 32L88 13L83 13Z" +
  "M10 11.5A4.5 4.5 0 1 1 19 11.5A4.5 4.5 0 1 1 10 11.5Z" +
  "M81 11.5A4.5 4.5 0 1 1 90 11.5A4.5 4.5 0 1 1 81 11.5Z";

/* Alien: an egg upside down, wide brow and a narrow chin. */
const alien = "M50 12C73 12 88 29 88 48C88 66 69 90 50 90C31 90 12 66 12 48C12 29 27 12 50 12Z";

/* Hexagon: a rounded nut, flat top and bottom. */
const hexPts = [];
for (let i = 0; i < 6; i++) hexPts.push(polar(44, (i * Math.PI) / 3));
const hexagon = roundedPolygon(hexPts, 9);

/* Cat: a round head with two rounded ears, as three subpaths. */
const cat = `M${pt([50, 20])}A36 36 0 1 1 ${pt([50, 92])}A36 36 0 1 1 ${pt([50, 20])}Z` +
  roundedPolygon([[16, 52], [21, 10], [48, 25]], 4.5) +
  roundedPolygon([[84, 52], [52, 25], [79, 10]], 4.5);

const shapes = { clover, flower, triangle: tri, square, blob: blobShape, ghost, circle, drop, star, droid, mech, alien, hexagon, cat };

let ts = `/* Generated by scripts/gen-shapes.mjs — do not edit by hand. Body
   outlines in a 100×100 box, centred on (50, 50). */

import type { BotAvatarType } from './types';

export const SHAPE_PATHS: Record<BotAvatarType, string> = {
`;
for (const [k, v] of Object.entries(shapes)) ts += `  ${k}: '${v}',\n`;
ts += "};\n";

const here = dirname(fileURLToPath(import.meta.url));
writeFileSync(resolve(here, "../src/shapes.ts"), ts);
console.log("wrote src/shapes.ts", Object.keys(shapes).join(", "));
