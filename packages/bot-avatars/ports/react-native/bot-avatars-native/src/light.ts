/* The plastic material's lighting — the web's `buildMatcap` (plastic.ts)
   per normal, twice: as a worklet, for the side gradients' stops on the
   UI thread, and as SkSL, for the front cap lit per pixel on the GPU.
   Both give the numbers plastic.ts gives, down to its lookup tables: the
   tone map is read at the centre of one of 2048 bins over [0, 2.5], and
   the two specular powers are raised from `nh` floored to 1/1024, exactly
   as the web's `toneLut` and `powLut` do. */

export type V3 = [number, number, number];

/** the cap's frame: light, view, half vector, sky up, window normal and its two axes */
export interface LightFrame {
  L: V3; V: V3; H: V3; U: V3; W: V3; A: V3; B: V3;
}

export interface LightMaterial {
  shadow: number;
  highlight: number;
  spread: number;
  rim: number;
}

/** what the material boils down to for a colour: the same constants
    `buildMatcap` derives once per call */
export interface LightConstants {
  /** linear body colour */
  c: V3;
  ambT: V3;
  wrap: number;
  ks1: number;
  ks2: number;
  winK: number;
  rimK: number;
  e1: number;
  e2: number;
}

const ENV: V3 = [0.92, 0.96, 1.0];
const WARM: V3 = [1, 0.98, 0.95];
const KD = 0.85;
const TONE_N = 2048;
const TONE_MAX = 2.5;
const TONE_SCALE = TONE_N / TONE_MAX;
const POW_N = 1024;

export function lightConstants(c: V3, p: LightMaterial): LightConstants {
  'worklet';
  const mx = Math.max(c[0], c[1], c[2], 0.05);
  const amb = Math.max(0.03, 0.3 - 0.15 * p.shadow);
  return {
    c,
    ambT: [(amb * c[0]) / mx, (amb * c[1]) / mx, (amb * c[2]) / mx],
    wrap: 0.15 + 0.14 * p.spread,
    ks1: 0.45 * p.highlight,
    ks2: 0.1 * p.highlight,
    winK: 0.11 * p.highlight,
    rimK: 0.3 * p.rim,
    e1: Math.min(90, Math.round(110 / Math.pow(p.spread, 1.3))),
    e2: Math.max(2, Math.round(8 / p.spread)),
  };
}

/* tone map (soft shoulder above 0.75, keeps hue) + sRGB encode, read the
   way the web reads its table: at the centre of the bin `v` falls in */
export function tone(v: number): number {
  'worklet';
  const i = v <= 0 ? 0 : v >= TONE_MAX ? TONE_N - 1 : (v * TONE_SCALE) | 0;
  const x = (i + 0.5) / TONE_SCALE;
  const y = x <= 0.75 ? x : 0.75 + 0.25 * (1 - Math.exp(-(x - 0.75) / 0.25));
  return 255 * (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
}

function smooth(a: number, b: number, v: number): number {
  'worklet';
  const t = v <= a ? 0 : v >= b ? 1 : (v - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** The lit colour (sRGB 0–255) of a unit normal in the cap's frame. */
export function lightNormal(nx: number, ny: number, nz: number, f: LightFrame, k: LightConstants, out: V3): void {
  'worklet';
  const { L, V, H, U, W, A, B } = f;
  const nl = nx * L[0] + ny * L[1] + nz * L[2];
  const nv = Math.max(0, nx * V[0] + ny * V[1] + nz * V[2]);
  const nh = Math.max(0, nx * H[0] + ny * H[1] + nz * H[2]);
  const dif = Math.min(1, Math.max(0, (nl + k.wrap) / (1 + k.wrap)));
  const q = 1 - nv, q2 = q * q, f3 = q2 * q, f5 = f3 * q2;
  const ni = ((nh * POW_N) | 0) / POW_N;
  const spec = (k.ks1 * Math.pow(ni, k.e1) + k.ks2 * Math.pow(ni, k.e2)) * (1 + 3 * f5);
  const rx = 2 * nv * nx - V[0], ry = 2 * nv * ny - V[1], rz = 2 * nv * nz - V[2];
  const sky = 0.45 + 0.55 * smooth(-0.4, 0.6, rx * U[0] + ry * U[1] + rz * U[2]);
  const rw = rx * W[0] + ry * W[1] + rz * W[2];
  let win = 0;
  if (rw > 0.5) {
    const ra = Math.abs((rx * A[0] + ry * A[1] + rz * A[2]) / rw), rb = Math.abs((rx * B[0] + ry * B[1] + rz * B[2]) / rw);
    win = (1 - smooth(0.22, 0.46, ra)) * (1 - smooth(0.06, 0.18, rb));
  }
  const env = k.rimK * f3 * sky + k.winK * win;
  const c = k.c;
  out[0] = tone(c[0] * (k.ambT[0] + KD * dif) + spec * WARM[0] + env * ENV[0]);
  out[1] = tone(c[1] * (k.ambT[1] + KD * dif) + spec * WARM[1] + env * ENV[1]);
  out[2] = tone(c[2] * (k.ambT[2] + KD * dif) + spec * WARM[2] + env * ENV[2]);
}

/** The matcap read the web's side gradients read: a normal on the ring
    at tilt `nz`, clamped into the unit disc the way `buildMatcap` does. */
export function lightRing(phi: number, nz: number, f: LightFrame, k: LightConstants, out: V3): void {
  'worklet';
  const rr = Math.sqrt(1 - nz * nz);
  lightNormal(rr * Math.cos(phi), rr * Math.sin(phi), nz, f, k, out);
}

/* ── the same, per pixel ───────────────────────────────────────────── */

/** Uniform layout of the cap shader, in floats. */
export const CAP_UNIFORMS = 3 * 7 + 3 + 3 + 4 + 4 + 2 + 1;

/**
 * The cap shader: the form texture (nx, ny in [0, 1], baked AO, 1) is
 * sampled in design units through `texScale` and `pad`, and each pixel's
 * normal is lit with the material above.
 */
export const CAP_SKSL = `
uniform shader form;
uniform float3 L; uniform float3 V; uniform float3 H; uniform float3 U;
uniform float3 W; uniform float3 A; uniform float3 B;
uniform float3 c;
uniform float3 ambT;
uniform float4 k1;   // wrap, ks1, ks2, winK
uniform float4 k2;   // rimK, e1, e2, aoK
uniform float2 tex;  // texels per design unit, pad
uniform float alpha;

const float3 ENV = float3(0.92, 0.96, 1.0);
const float3 WARM = float3(1.0, 0.98, 0.95);
const float KD = 0.85;
const float TONE_SCALE = 819.2;

float smoothk(float a, float b, float v) {
  float t = clamp((v - a) / (b - a), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
float tone(float v) {
  float i = clamp(floor(v * TONE_SCALE), 0.0, 2047.0);
  float x = (i + 0.5) / TONE_SCALE;
  float y = x <= 0.75 ? x : 0.75 + 0.25 * (1.0 - exp(-(x - 0.75) / 0.25));
  return y <= 0.0031308 ? 12.92 * y : 1.055 * pow(y, 1.0 / 2.4) - 0.055;
}
/* the material for one normal, as buildMatcap evaluates one matcap cell */
float3 lit(float nx, float ny) {
  float r2 = nx * nx + ny * ny;
  if (r2 > 1.0) { float s = inversesqrt(r2); nx *= s; ny *= s; r2 = 1.0; }
  float nz = sqrt(1.0 - r2);
  float3 n = float3(nx, ny, nz);
  float nl = dot(n, L);
  float nv = max(0.0, dot(n, V));
  float nh = max(0.0, dot(n, H));
  float wrap = k1.x;
  float dif = clamp((nl + wrap) / (1.0 + wrap), 0.0, 1.0);
  float q = 1.0 - nv, q2 = q * q, f3 = q2 * q, f5 = f3 * q2;
  float ni = floor(nh * 1024.0) / 1024.0;
  float spec = (k1.y * pow(ni, k2.y) + k1.z * pow(ni, k2.z)) * (1.0 + 3.0 * f5);
  float3 r = 2.0 * nv * n - V;
  float sky = 0.45 + 0.55 * smoothk(-0.4, 0.6, dot(r, U));
  float rw = dot(r, W);
  float win = 0.0;
  if (rw > 0.5) {
    float ra = abs(dot(r, A) / rw), rb = abs(dot(r, B) / rw);
    win = (1.0 - smoothk(0.22, 0.46, ra)) * (1.0 - smoothk(0.06, 0.18, rb));
  }
  float env = k2.x * f3 * sky + k1.w * win;
  float3 v = c * (ambT + KD * dif) + spec * WARM + env * ENV;
  return float3(tone(v.x), tone(v.y), tone(v.z));
}
/* the sampled normal, lit once: the form's normals are smooth enough that
   lighting them is the web's matcap read to within its own quantisation
   (the four-cell mix the web's bilinear read does was tried and made no
   visible difference at four times the fragment cost) */
half4 main(float2 p) {
  float4 t = form.eval((p + tex.y) * tex.x);
  float ao = t.b;
  if (ao <= 0.0) return half4(0.0);
  float3 col = lit(t.r * 2.0 - 1.0, t.g * 2.0 - 1.0);
  float m = max(0.0, 1.0 - k2.w * (1.0 - ao)) * alpha;
  return half4(half3(col) * m, alpha);
}
`;

/** Fill `u` (CAP_UNIFORMS floats) for the cap shader. */
export function capUniforms(u: number[], f: LightFrame, k: LightConstants, aoK: number, texScale: number, pad: number, alpha: number): void {
  'worklet';
  let i = 0;
  const put3 = (v: V3) => {
    u[i++] = v[0]; u[i++] = v[1]; u[i++] = v[2];
  };
  put3(f.L); put3(f.V); put3(f.H); put3(f.U); put3(f.W); put3(f.A); put3(f.B);
  put3(k.c);
  put3(k.ambT);
  u[i++] = k.wrap; u[i++] = k.ks1; u[i++] = k.ks2; u[i++] = k.winK;
  u[i++] = k.rimK; u[i++] = k.e1; u[i++] = k.e2; u[i++] = aoK;
  u[i++] = texScale; u[i++] = pad;
  u[i++] = alpha;
}
