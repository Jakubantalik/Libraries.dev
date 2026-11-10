/* Distortion waves — the WebGL2 renderer of the web preview. The SwiftUI
   library's three shaders (waveLens, waveBlurMask, waveBand in
   DistortionWaveShaders.metal) become one pass here: each pixel works out the
   field once, samples the screen through the lens with its progressive blur,
   and lays the colour on top. The dots are a second, tiny pass.

   The screen's blurred copies are made only when it changes — downsampled and
   blurred on the GPU, into textures kept from frame to frame — so most frames
   are a single draw over the canvas. As in the app, both sides of the wave
   show the same screen, morphing in place. */

import { COVER_ZONE, LUMPS, oklab, type Front, type WaveStyle } from "./model";

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/* Separable gaussian, one axis per pass; the input is already downsampled. */
const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uStep;
uniform float uSigma;
out vec4 outColor;
void main() {
  float r = ceil(uSigma * 3.0);
  vec4 acc = vec4(0.0);
  float wsum = 0.0;
  for (float i = -48.0; i <= 48.0; i += 1.0) {
    if (abs(i) > r) continue;
    float w = exp(-0.5 * i * i / (uSigma * uSigma));
    acc += texture(uTex, vUv + uStep * i) * w;
    wsum += w;
  }
  outColor = acc / wsum;
}`;

/* Plain copy, for the downsample (bilinear from a mipmapped source). */
const COPY_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uLod;
out vec4 outColor;
void main() { outColor = textureLod(uTex, vUv, uLod); }`;

const MAIN_FRAG = `#version 300 es
precision highp float;
uniform vec2 uSize;
uniform vec2 uPx;
uniform float uF[19];
uniform sampler2D uC0;
uniform sampler2D uC1;
uniform sampler2D uC2;
uniform sampler2D uR0;
uniform sampler2D uR1;
uniform sampler2D uR2;
uniform int uContent;
uniform int uRevealed;
uniform int uLens;
uniform int uLive;
uniform float uAmplitude;
uniform float uLensWidth;
uniform float uAberration;
uniform float uBlur;
uniform float uBlurAhead;
uniform float uBlurBehind;
uniform float uNear;
uniform vec3 uPal[9];
uniform int uPalCount;
uniform vec3 uAhead;
uniform vec3 uBehind;
uniform float uLead;
uniform float uTail;
uniform float uStrength;
uniform float uRimWidth;
uniform float uRimSoftness;
uniform float uCorner;
uniform float uUneven;
uniform float uPulse;
uniform float uHairW;
uniform float uHairO;
uniform float uHairWhite;
uniform vec3 uLumps[${LUMPS}];
out vec4 outColor;

const float coverZone = ${COVER_ZONE.toFixed(1)};
const float PI = 3.14159265;

struct Field { float d; vec2 n; vec2 q; vec2 raw; float g; };

float heldAt(vec2 p) {
  if (uF[16] <= 0.0) return 1.0;
  return smoothstep(uF[16] * 0.9, uF[16] * 1.8, length(p - vec2(uF[0], uF[1])));
}

Field fieldAt(vec2 p) {
  vec2 raw = p - vec2(uF[0], uF[1]);
  float cs = cos(uF[14]), sn = sin(uF[14]);
  vec2 q = vec2(cs * raw.x + sn * raw.y, -sn * raw.x + cs * raw.y);
  float spine = uF[2], radius = uF[3], squash = uF[4], time = uF[5], swell = uF[7];
  float mx = q.x * squash;
  vec2 v = vec2(max(abs(mx) - spine, 0.0), q.y);
  float l = max(length(v), 1e-3);
  vec2 grad = vec2(v.x * sign(q.x) * squash, v.y) / l;
  float g = max(length(grad), 1e-3);
  float bend;
  if (uF[15] > 0.5) {
    float a = atan(q.y, q.x);
    bend = 0.62 * sin(2.0 * a + time * 1.1) + 0.38 * sin(3.0 * a - time * 1.5 + 1.7);
  } else {
    float s = mx * 0.0058;
    bend = 0.62 * sin(s + time * 1.1) + 0.38 * sin(s * 2.1 - time * 1.5 + 1.7);
  }
  vec2 n = grad / g;
  Field o;
  o.d = (l - radius) / g + swell * bend;
  o.n = vec2(cs * n.x - sn * n.y, sn * n.x + cs * n.y);
  o.q = q;
  o.raw = raw;
  o.g = g;
  return o;
}

/* The progressive blur, as the stacked blurred copies: near over sharp, far
   over that, each taking over where the last ends. */
vec3 side(sampler2D a, sampler2D b, sampler2D c, vec2 s, float tn, float tf) {
  vec2 uv = clamp(s, vec2(0.5), uSize - 0.5) / uSize;
  vec3 col = texture(a, uv).rgb;
  if (tn > 0.0) col = mix(col, texture(b, uv).rgb, tn);
  if (tf > 0.0) col = mix(col, texture(c, uv).rgb, tf);
  return col;
}

const vec3 spectrum[5] = vec3[5](
  vec3(0.571, 0.0, 0.0), vec3(0.343, 0.206, 0.0), vec3(0.086, 0.588, 0.086), vec3(0.0, 0.206, 0.343), vec3(0.0, 0.0, 0.571)
);

vec3 lensed(int which, vec2 s, vec2 split, float tn, float tf) {
  if (dot(split, split) < 0.0625) {
    return which == 0 ? side(uC0, uC1, uC2, s, tn, tf) : side(uR0, uR1, uR2, s, tn, tf);
  }
  vec3 o = vec3(0.0);
  for (int i = 0; i < 5; i++) {
    float along = float(i) / 4.0 * 2.0 - 1.0;
    vec3 c = which == 0 ? side(uC0, uC1, uC2, s + split * along, tn, tf) : side(uR0, uR1, uR2, s + split * along, tn, tf);
    o += c * spectrum[i];
  }
  return o;
}

float continuousRectSDF(vec2 p, vec2 halfSize, float radius) {
  float a = min(radius * 1.528665, min(halfSize.x, halfSize.y));
  vec2 q = abs(p) - (halfSize - a);
  if (q.x <= 0.0 || q.y <= 0.0) return max(abs(p.x) - halfSize.x, abs(p.y) - halfSize.y);
  const float n = 3.26;
  vec2 u = q / a;
  float norm = pow(pow(u.x, n) + pow(u.y, n), 1.0 / n);
  vec2 gg = pow(u / max(norm, 1e-4), vec2(n - 1.0));
  return (norm - 1.0) * a / max(length(gg), 1e-3);
}

vec2 perimeterAt(vec2 p, vec2 halfSize, float r) {
  float ex = max(halfSize.x - r, 0.0);
  float ey = max(halfSize.y - r, 0.0);
  float arc = 0.5 * PI * r;
  float P = 4.0 * (ex + ey + arc);
  float ax = abs(p.x), ay = abs(p.y);
  if (ax > ex && ay > ey) {
    vec2 v = p - vec2(sign(p.x) * ex, sign(p.y) * ey);
    float a, base;
    if (p.x >= 0.0 && p.y < 0.0) { a = atan(v.x, -v.y); base = ex; }
    else if (p.x >= 0.0) { a = atan(v.y, v.x); base = ex + arc + 2.0 * ey; }
    else if (p.y >= 0.0) { a = atan(-v.x, v.y); base = 3.0 * ex + 2.0 * arc + 2.0 * ey; }
    else { a = atan(-v.y, -v.x); base = 3.0 * ex + 3.0 * arc + 4.0 * ey; }
    return vec2(base + r * clamp(a, 0.0, 0.5 * PI), P);
  }
  bool sideHit = ax > ex ? true : (ay > ey ? false : (halfSize.x - ax) < (halfSize.y - ay));
  if (sideHit) return vec2(p.x >= 0.0 ? ex + arc + (p.y + ey) : 3.0 * ex + 3.0 * arc + 2.0 * ey + (ey - p.y), P);
  return vec2(p.y < 0.0 ? (p.x >= 0.0 ? p.x : P + p.x) : ex + 2.0 * arc + 2.0 * ey + (ex - p.x), P);
}

float rimThickness(float s, float P) {
  float t = 0.08;
  for (int i = 0; i < ${LUMPS}; i++) {
    float ds = s - uLumps[i].x;
    ds -= P * floor(ds / P + 0.5);
    float k = ds / uLumps[i].y;
    t += uLumps[i].z * exp(-k * k);
  }
  return t / 1.0498;
}

float dither(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))) - 0.5; }

vec3 paletteAt(float u) {
  float x = fract(u) * float(uPalCount);
  int i = min(int(x), uPalCount - 1);
  int j = i + 1 == uPalCount ? 0 : i + 1;
  float m = fract(x);
  m = m * m * (3.0 - 2.0 * m);
  return mix(uPal[i], uPal[j], m);
}

vec3 oklabToSRGB(vec3 c) {
  float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  l = l * l * l; m = m * m * m; s = s * s * s;
  vec3 lin = clamp(vec3(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ), 0.0, 1.0);
  return mix(12.92 * lin, 1.055 * pow(lin, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), lin));
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uPx.y - gl_FragCoord.y) * (uSize.x / uPx.x);

  if (uLive == 0) {
    outColor = vec4(uRevealed == 1 ? texture(uR0, p / uSize).rgb : texture(uC0, p / uSize).rgb, 1.0);
    return;
  }

  Field w = fieldAt(p);
  float energy = uF[6], gravity = uF[10];
  float held = heldAt(p);

  // ─── The two screens, through the swell (waveLens) ───
  vec2 s = p;
  vec2 split = vec2(0.0);
  if (uLens == 1) {
    float u = w.d / (uLensWidth * (w.d > 0.0 ? 0.85 : 1.5));
    float lift = exp(-u * u);
    float r = max(length(w.raw), 1.0);
    vec2 swollen = w.n * energy * uAmplitude * lift * held;
    vec2 inward = w.raw / r;
    s = p - swollen + inward * gravity * exp(-r / 900.0) * held;
    split = (swollen - inward * gravity * exp(-r / 240.0) * held) * uAberration;
  }
  // The progressive blur, read where the pixel is (waveBlurMask).
  float bu = w.d / (w.d > 0.0 ? uBlurAhead : uBlurBehind);
  float radius = energy * uBlur * exp(-bu * bu) * held;
  float tn = clamp(radius / max(uNear, 1e-3), 0.0, 1.0);
  tn = tn * tn * (3.0 - 2.0 * tn);
  float tf = clamp((radius - uNear) / max(uBlur - uNear, 1e-3), 0.0, 1.0);
  tf = tf * tf * (3.0 - 2.0 * tf);

  vec3 col = vec3(0.0);
  float cover = 1.0;
  if (uContent == 1 && uF[17] > 0.5) cover = smoothstep(-coverZone, coverZone, w.d);
  if (uContent == 0) cover = 0.0;
  bool showRevealed = uRevealed == 1 && w.d <= coverZone + 6.0 && cover < 1.0;
  if (showRevealed) col = lensed(1, s, split, tn, tf);
  if (cover > 0.0) col = mix(col, lensed(0, s, split, tn, tf), cover);

  // ─── The colour (waveBand) ───
  float d = w.d, time = uF[5], glow = uF[11], rim = uF[13];
  vec2 c = p - uSize * 0.5;
  float inset = max(-continuousRectSDF(c, uSize * 0.5, uCorner), 0.0);
  bool nearEdge = rim > 0.0 && inset < max(uRimWidth * 2.2 * (1.0 + 1.9 * uUneven), uHairW * 0.5 + 0.75);
  if (glow <= 0.0 && !nearEdge) {
    outColor = vec4(col + dither(gl_FragCoord.xy) / 255.0, 1.0);
    return;
  }
  bool ring = uF[15] > 0.5;
  float turn = atan(w.q.y, w.q.x);
  float along = w.q.x * 0.0068;
  float lobes = ring
    ? 0.5 + 0.5 * sin(2.0 * turn + time * 1.4) * cos(turn - time * 0.7 + 1.2)
    : 0.5 + 0.5 * sin(along * 1.3 + time * 1.4) * cos(along * 0.6 - time * 0.7 + 1.2);
  float bandA = 0.0;
  if (glow > 0.0 && d < uLead) {
    if (d >= 0.0) {
      float k = 1.0 - d / uLead;
      bandA = k * k * k * (k * (k * 6.0 - 15.0) + 10.0);
    } else {
      bandA = pow(1.0 - clamp(-d / (uTail * mix(0.6, 1.3, lobes)), 0.0, 1.0), 2.3);
    }
    bandA *= glow * uStrength * mix(0.6, 1.0, exp(-inset / 140.0)) * held;
  }
  float aroundA = atan(c.y / uSize.y, c.x / uSize.x);
  float rimA = 0.0;
  float hairA = 0.0;
  float shimmer = 0.5;
  if (nearEdge) {
    vec2 edge = perimeterAt(c, uSize * 0.5, uCorner);
    float thickness = 1.0;
    if (uUneven > 0.0) thickness = max(1.0 + (rimThickness(edge.x, edge.y) - 1.0) * uUneven, 0.04);
    float hk = inset / (uRimWidth * thickness);
    float hug = exp(-hk * hk);
    float reached = 1.0 - smoothstep(-uLead * 0.7, uLead * 0.5, d);
    float kept = smoothstep(-uRimSoftness, uRimSoftness, d + (uF[3] - uF[12]) / w.g);
    shimmer = 0.5 + 0.5 * sin(time * 3.4 - edge.x / edge.y * 4.0 * PI);
    rimA = hug * reached * kept * rim * mix(1.0, 0.7 + 0.3 * shimmer, uPulse);
    if (uHairW > 0.0) {
      float line = 1.0 - smoothstep(uHairW * 0.5, uHairW * 0.5 + 0.75, inset);
      float hairKept = smoothstep(-uRimSoftness, uRimSoftness, d + (uF[3] - uF[18]) / w.g);
      hairA = line * reached * hairKept * rim * uHairO
        * mix(0.5, 1.0, smoothstep(0.1, 1.5, thickness))
        * mix(1.0, 0.55 + 0.45 * shimmer, uPulse);
    }
  }
  float a = 1.0 - (1.0 - bandA) * (1.0 - rimA);
  float total = 1.0 - (1.0 - a) * (1.0 - hairA);
  if (total <= 0.0005) {
    outColor = vec4(col + dither(gl_FragCoord.xy) / 255.0, 1.0);
    return;
  }
  float flow = 0.62 + (ring ? turn / (2.0 * PI) : along * 0.2) + time * 0.13 + d * 0.0015 + (ring ? 0.0 : 0.05 * sin(w.q.y * 0.009 + time));
  vec3 lab = paletteAt(flow);
  lab = mix(lab, uAhead, 0.5 * exp(-pow((d - 30.0) / 50.0, 2.0)));
  lab = mix(lab, uBehind, 0.5 * exp(-pow((d + 84.0) / 72.0, 2.0)));
  lab.yz *= 1.22;
  lab = mix(lab, vec3(0.99, 0.0, 0.0), 0.7 * exp(-pow((d + 8.0) / 26.0, 2.0)));
  vec3 rimLab = paletteAt(aroundA / (2.0 * PI) + time * (0.12 + 0.25 * uPulse) + inset * 0.0012);
  rimLab.yz *= 1.1;
  lab = mix(lab, rimLab, rimA / (rimA + bandA + 1e-4));
  vec3 rgb = oklabToSRGB(lab);
  if (hairA > 0.0) {
    vec3 hair = mix(oklabToSRGB(rimLab), vec3(1.0), uHairWhite * (0.5 + 0.5 * shimmer));
    rgb = (rgb * a * (1.0 - hairA) + hair * hairA) / total;
  }
  float noise = dither(gl_FragCoord.xy) * 2.0 / 255.0;
  // The colour over the screens, as the band view over the transition.
  outColor = vec4(mix(col, clamp(rgb + noise, 0.0, 1.0), clamp(total + noise, 0.0, 1.0)), 1.0);
}`;

const DOT_VERT = `#version 300 es
in vec3 aDot;
uniform vec2 uSize;
uniform float uPoint;
out float vA;
void main() {
  vec2 clip = vec2(aDot.x / uSize.x * 2.0 - 1.0, 1.0 - aDot.y / uSize.y * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  gl_PointSize = uPoint;
  vA = aDot.z;
}`;
/* aDot.z packs opacity (fraction) and size in pt (integer part / 10). */
const DOT_FRAG = `#version 300 es
precision highp float;
in float vA;
uniform float uScale;
uniform float uPoint;
out vec4 outColor;
void main() {
  float a = fract(vA);
  float size = floor(vA) / 10.0;
  float r = length(gl_PointCoord - 0.5) * uPoint;
  float edge = size * uScale * 0.5;
  float cov = clamp(edge - r + 0.5, 0.0, 1.0);
  outColor = vec4(vec3(1.0) * a * cov, a * cov);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(`${type === gl.VERTEX_SHADER ? "vertex" : "fragment"} shader: ${gl.isContextLost() ? "context lost" : gl.getShaderInfoLog(sh)}`);
  }
  return sh;
}

function program(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, "aPos");
  gl.bindAttribLocation(p, 0, "aDot");
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || "link");
  const cache = new Map<string, WebGLUniformLocation | null>();
  const loc = (name: string) => {
    if (!cache.has(name)) cache.set(name, gl.getUniformLocation(p, name));
    return cache.get(name)!;
  };
  return { p, loc };
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

/** One screen: sharp, and its near and far blurred copies. */
interface Screen {
  sharp: WebGLTexture;
  near: Target | null;
  far: Target | null;
  w: number;
  h: number;
}

export interface DotBuffer {
  data: Float32Array;
  count: number;
}

/** Near copy's blur radius, pt, as the SwiftUI stage's. */
const NEAR = 7;

export class WaveRenderer {
  private gl: WebGL2RenderingContext;
  private quad: WebGLBuffer;
  private dots: WebGLBuffer;
  private main: ReturnType<typeof program>;
  private blur: ReturnType<typeof program>;
  private copy: ReturnType<typeof program>;
  private dot: ReturnType<typeof program>;
  private screen: Screen | null = null;
  private sizePt = { w: 1, h: 1 };
  private farBlur = -1;
  /* Reused every frame, so a wave allocates nothing as it plays. */
  private field = new Float32Array(19);
  private dotsSize = 0;
  private pal = new Float32Array(27);
  private palKey: unknown = null;
  private ahead = new Float32Array(3);
  private behind = new Float32Array(3);
  readonly ok: boolean;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: false, preserveDrawingBuffer: false });
    this.ok = !!gl;
    this.gl = gl as WebGL2RenderingContext;
    if (!gl) {
      this.quad = this.dots = null as unknown as WebGLBuffer;
      this.main = this.blur = this.copy = this.dot = null as unknown as ReturnType<typeof program>;
      return;
    }
    this.main = program(gl, VERT, MAIN_FRAG);
    this.blur = program(gl, VERT, BLUR_FRAG);
    this.copy = program(gl, VERT, COPY_FRAG);
    this.dot = program(gl, DOT_VERT, DOT_FRAG);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.dots = gl.createBuffer()!;
  }

  private texture(w: number, h: number, source?: TexImageSource, mip = false): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    return tex;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture(w, h);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }

  private drop(t: Target | null) {
    if (!t) return;
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fb);
  }

  private quadDraw(prog: ReturnType<typeof program>) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** A blurred copy of `sharp` into `into` (made, or remade at a new size):
      downsampled so the kernel stays short, then blurred along x and y.
      `sigmaPt` is the blur radius in points. */
  private blurred(sharp: WebGLTexture, w: number, h: number, sigmaPt: number, into: Target | null): Target {
    const gl = this.gl;
    const pxPerPt = w / this.sizePt.w;
    const sigmaPx = sigmaPt * pxPerPt;
    const f = Math.max(1, Math.round(sigmaPx / 5));
    const dw = Math.max(1, Math.round(w / f));
    const dh = Math.max(1, Math.round(h / f));
    let small = into;
    if (!small || small.w !== dw || small.h !== dh) {
      this.drop(small);
      small = this.target(dw, dh);
    }
    const tmp = this.scratch(dw, dh);
    gl.viewport(0, 0, dw, dh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, small.fb);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sharp);
    gl.useProgram(this.copy.p);
    gl.uniform1i(this.copy.loc("uTex"), 0);
    gl.uniform1f(this.copy.loc("uLod"), Math.log2(f));
    this.quadDraw(this.copy);
    const sigma = sigmaPx / f;
    gl.useProgram(this.blur.p);
    gl.uniform1i(this.blur.loc("uTex"), 0);
    gl.uniform1f(this.blur.loc("uSigma"), Math.max(sigma, 0.01));
    gl.bindFramebuffer(gl.FRAMEBUFFER, tmp.fb);
    gl.bindTexture(gl.TEXTURE_2D, small.tex);
    gl.uniform2f(this.blur.loc("uStep"), 1 / dw, 0);
    this.quadDraw(this.blur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, small.fb);
    gl.bindTexture(gl.TEXTURE_2D, tmp.tex);
    gl.uniform2f(this.blur.loc("uStep"), 0, 1 / dh);
    this.quadDraw(this.blur);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return small;
  }

  /** A scratch target per size, kept for the next blur. */
  private scratches = new Map<string, Target>();
  private scratch(w: number, h: number) {
    const key = `${w}x${h}`;
    let t = this.scratches.get(key);
    if (!t) {
      t = this.target(w, h);
      this.scratches.set(key, t);
    }
    return t;
  }

  /** The screen (a canvas drawn at the backing resolution), with its blurred
      copies. Both sides of the wave show it, as both sides of the app's wave
      show the same morphing view. Called again while the screen animates: the
      textures are refilled in place. */
  setScreen(c: HTMLCanvasElement, widthPt: number, heightPt: number, blurPt: number) {
    if (!this.ok) return;
    const gl = this.gl;
    this.sizePt = { w: widthPt, h: heightPt };
    let s = this.screen;
    if (s && (s.w !== c.width || s.h !== c.height)) {
      this.dropScreen(s);
      s = null;
    }
    if (!s) {
      s = { sharp: this.texture(c.width, c.height, c, true), near: null, far: null, w: c.width, h: c.height };
    } else {
      gl.bindTexture(gl.TEXTURE_2D, s.sharp);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
    s.near = this.blurred(s.sharp, s.w, s.h, NEAR, s.near);
    s.far = this.blurred(s.sharp, s.w, s.h, Math.max(blurPt, NEAR), s.far);
    this.screen = s;
    this.farBlur = blurPt;
  }

  private dropScreen(s: Screen | null) {
    if (!s) return;
    this.gl.deleteTexture(s.sharp);
    this.drop(s.near);
    this.drop(s.far);
  }

  /** Remake the far copy when the style's blur radius moves. */
  setBlur(blurPt: number) {
    if (!this.ok || blurPt === this.farBlur || !this.screen) return;
    this.farBlur = blurPt;
    const s = this.screen;
    s.far = this.blurred(s.sharp, s.w, s.h, Math.max(blurPt, NEAR), s.far);
  }

  /** One frame. `front` null draws the content at rest (or the revealed
      screen, once a wave has finished). */
  render(front: Front | null, style: WaveStyle, lumps: Float32Array, dots: DotBuffer | null) {
    if (!this.ok || !this.screen) return;
    const content = this.screen;
    const revealed = this.screen;
    const gl = this.gl;
    const pw = this.canvas.width;
    const ph = this.canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, pw, ph);
    gl.disable(gl.BLEND);
    const m = this.main;
    gl.useProgram(m.p);
    const tex: Array<[string, WebGLTexture]> = [
      ["uC0", content.sharp], ["uC1", content.near!.tex], ["uC2", content.far!.tex],
      ["uR0", revealed.sharp], ["uR1", revealed.near!.tex], ["uR2", revealed.far!.tex],
    ];
    tex.forEach(([name, t], i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.uniform1i(m.loc(name), i);
    });
    gl.uniform2f(m.loc("uSize"), this.sizePt.w, this.sizePt.h);
    gl.uniform2f(m.loc("uPx"), pw, ph);
    const live = !!front;
    gl.uniform1i(m.loc("uLive"), live ? 1 : 0);
    if (!front) {
      gl.uniform1i(m.loc("uRevealed"), 0);
      this.quadDraw(m);
      return;
    }
    const f = this.field;
    f[0] = front.ox; f[1] = front.oy; f[2] = front.spine; f[3] = front.radius; f[4] = front.squash;
    f[5] = front.time; f[6] = front.energy; f[7] = front.swell; f[8] = front.width; f[9] = front.height;
    f[10] = front.gravity; f[11] = front.glow; f[12] = front.clearRadius; f[13] = front.rim; f[14] = front.tilt;
    f[15] = front.ring ? 1 : 0; f[16] = front.hold; f[17] = front.launched ? 1 : 0; f[18] = front.hairClearRadius;
    gl.uniform1fv(m.loc("uF"), f);
    const acting = front.energy > 0;
    gl.uniform1i(m.loc("uContent"), front.hasCleared ? 0 : 1);
    gl.uniform1i(m.loc("uRevealed"), front.launched ? 1 : 0);
    gl.uniform1i(m.loc("uLens"), acting || front.gravity > 0 ? 1 : 0);
    gl.uniform1f(m.loc("uAmplitude"), style.amplitude);
    gl.uniform1f(m.loc("uLensWidth"), style.lensWidth);
    gl.uniform1f(m.loc("uAberration"), style.aberration);
    gl.uniform1f(m.loc("uBlur"), acting ? Math.max(style.blur, NEAR) : 0);
    gl.uniform1f(m.loc("uBlurAhead"), style.blurAhead);
    gl.uniform1f(m.loc("uBlurBehind"), style.blurBehind);
    gl.uniform1f(m.loc("uNear"), NEAR);
    const colors = style.palette.colors.slice(0, 9);
    if (this.palKey !== style.palette) {
      this.palKey = style.palette;
      colors.forEach((c, i) => this.pal.set(oklab(c), i * 3));
      this.ahead.set(oklab(style.palette.ahead));
      this.behind.set(oklab(style.palette.behind));
    }
    gl.uniform3fv(m.loc("uPal"), this.pal);
    gl.uniform1i(m.loc("uPalCount"), Math.max(colors.length, 1));
    gl.uniform3fv(m.loc("uAhead"), this.ahead);
    gl.uniform3fv(m.loc("uBehind"), this.behind);
    gl.uniform1f(m.loc("uLead"), style.lead);
    gl.uniform1f(m.loc("uTail"), style.tail);
    gl.uniform1f(m.loc("uStrength"), style.strength);
    gl.uniform1f(m.loc("uRimWidth"), style.rimWidth);
    gl.uniform1f(m.loc("uRimSoftness"), style.rimSoftness);
    gl.uniform1f(m.loc("uCorner"), style.cornerRadius);
    gl.uniform1f(m.loc("uUneven"), style.rimUnevenness);
    gl.uniform1f(m.loc("uPulse"), style.rimPulse);
    gl.uniform1f(m.loc("uHairW"), style.hairlineWidth);
    gl.uniform1f(m.loc("uHairO"), style.hairlineOpacity);
    gl.uniform1f(m.loc("uHairWhite"), style.hairlineWhite);
    gl.uniform3fv(m.loc("uLumps"), lumps);
    this.quadDraw(m);

    if (dots && dots.count > 0) {
      const d = this.dot;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(d.p);
      gl.uniform2f(d.loc("uSize"), this.sizePt.w, this.sizePt.h);
      const scale = pw / this.sizePt.w;
      gl.uniform1f(d.loc("uScale"), scale);
      // Big enough for the largest dot, with a pixel to spare for its edge.
      gl.uniform1f(d.loc("uPoint"), Math.ceil((style.particleSize + 1) * scale) + 2);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dots);
      // Sized once for every dot, then refilled in place.
      if (this.dotsSize < dots.data.length) {
        gl.bufferData(gl.ARRAY_BUFFER, dots.data.byteLength, gl.DYNAMIC_DRAW);
        this.dotsSize = dots.data.length;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, dots.data, 0, dots.count * 3);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.POINTS, 0, dots.count);
      gl.disable(gl.BLEND);
    }
  }

  /* Frees the textures and programs, but keeps the context: React's strict
     mode mounts the same canvas again straight after, and a lost context
     would not come back. The canvas going away frees it. */
  dispose() {
    if (!this.ok) return;
    const gl = this.gl;
    this.dropScreen(this.screen);
    this.screen = null;
    for (const t of this.scratches.values()) this.drop(t);
    this.scratches.clear();
    for (const p of [this.main, this.blur, this.copy, this.dot]) gl.deleteProgram(p.p);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.dots);
  }
}
