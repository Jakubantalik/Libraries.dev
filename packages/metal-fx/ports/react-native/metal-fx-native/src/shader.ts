/**
 * The liquid-metal material as SkSL (react-native-skia runtime effects).
 *
 * A port of Paper Shaders' `liquidMetal` fragment stage (Apache-2.0,
 * paper-design/shaders @ 0.0.80) — the material metal-fx v2 renders on the
 * web — in the `shape: none` (full-fill) mode the web engine uses. The web
 * draws the material once onto a square sheet and crops a window of it onto
 * every instance; here that window is the uv mapping
 * `uvOrigin + pos * uvScale`, so a shape of any size samples exactly the
 * piece of the sheet the web would show.
 *
 * SkSL has no derivative intrinsics, so the stripe anti-aliasing width is a
 * finite difference of the stripe coordinate over one texel of the web's
 * 192-px sheet — which also reproduces the web's softness at any density.
 *
 * Output is premultiplied. The paint's own coverage (a path, glyphs) masks it.
 */
export const LIQUID_METAL_SKSL = `
uniform float2 uvOrigin;
uniform float2 uvScale;
uniform float time;
uniform float4 colorBack;
uniform float4 colorTint;
uniform float repetition;
uniform float softness;
uniform float shiftRed;
uniform float shiftBlue;
uniform float distortion;
uniform float contour;
uniform float angle;
uniform float opacityMul;
uniform float ditherScale;

const float PI = 3.14159265358979323846;
const float TEXEL = 1.0 / 192.0;

float3 permute3(float3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(float2 v) {
  const float4 C = float4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  float2 i = floor(v + dot(v, C.yy));
  float2 x0 = v - i + dot(i, C.xx);
  float2 i1 = (x0.x > x0.y) ? float2(1.0, 0.0) : float2(0.0, 1.0);
  float4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  float3 p = permute3(permute3(i.y + float3(0.0, i1.y, 1.0)) + i.x + float3(0.0, i1.x, 1.0));
  float3 m = max(0.5 - float3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m;
  m = m * m;
  float3 x = 2.0 * fract(p * C.www) - 1.0;
  float3 h = abs(x) - 0.5;
  float3 ox = floor(x + 0.5);
  float3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  float3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

float ss(float e0, float e1, float x) { return smoothstep(e0, max(e1, e0 + 1e-6), x); }

float2 rot2(float2 uv, float th) { return float2(cos(th) * uv.x - sin(th) * uv.y, sin(th) * uv.x + cos(th) * uv.y); }

float colorChanges(float c1, float c2, float p, float3 w, float blur, float bump, float tint, float tintA) {
  blur = max(blur, 1e-5);
  float ch = mix(c2, c1, ss(0.0, 2.0 * blur, p));
  float border = w[0];
  ch = mix(ch, c2, ss(border, border + 2.0 * blur, p));
  border = w[0] + 0.4 * (1.0 - bump) * w[1];
  ch = mix(ch, c1, ss(border, border + 2.0 * blur, p));
  border = w[0] + 0.5 * (1.0 - bump) * w[1];
  ch = mix(ch, c2, ss(border, border + 2.0 * blur, p));
  border = w[0] + w[1];
  ch = mix(ch, c1, ss(border, border + 2.0 * blur, p));
  float gt = (p - w[0] - w[1]) / w[2];
  float gradient = mix(c1, c2, ss(0.0, 1.0, gt));
  ch = mix(ch, gradient, ss(border, border + 0.5 * blur, p));
  ch = mix(ch, 1.0 - min(1.0, (1.0 - ch) / max(tint, 0.0001)), tintA);
  return ch;
}

// direction, bump, edge, diagBL, diagTL
float4 fieldA(float2 uv, float t, float noise, float cw, float2 rot) {
  float2 uvc = clamp(uv, 0.0, 1.0);
  float2 mask = min(uvc, 1.0 - uvc);
  float maskX = pow(ss(0.0, 0.5, mask.x), 0.25);
  float maskY = pow(ss(0.0, 0.5, mask.y), 0.25);
  float edge = clamp(1.0 - maskX * maskY, 0.0, 1.0);
  const float fwE = 0.002;
  edge = mix(ss(0.9 - 2.0 * fwE, 0.9, edge), edge, ss(0.0, 0.4, contour));
  edge = 1.2 * edge;

  float2 r = uv - 0.5;
  float2 rotated = float2(r.x * rot.x - r.y * rot.y, r.x * rot.y + r.y * rot.x) + 0.5;
  float diagBL = rotated.x - rotated.y;

  float2 g = uv - 0.5;
  float dist = length(g + float2(0.0, 0.2 * diagBL));
  g = rot2(g, (0.25 - 0.2 * diagBL) * PI);
  float direction = g.x;

  float uy = max(uvc.y, 0.0);
  float bump = 1.0 - pow(1.8 * dist, 1.2);
  bump *= pow(uy, 0.3);

  edge += (1.0 - edge) * distortion * noise;

  direction += diagBL;
  float sE = ss(0.0, 1.0, edge);
  direction -= 2.0 * noise * diagBL * (sE * (1.0 - sE));
  float c51 = ss(0.5, 1.0, contour);
  direction *= mix(1.0, 1.0 - edge, c51);
  direction -= 1.7 * edge * c51;
  direction += 0.2 * pow(contour, 4.0) * (1.0 - sE);

  bump *= clamp(pow(uy, 0.1), 0.3, 1.0);
  direction *= (0.1 + (1.1 - edge) * bump);
  direction *= (0.4 + 0.6 * (1.0 - ss(0.5, 1.0, edge)));
  direction += 0.18 * (ss(0.1, 0.2, uv.y) * (1.0 - ss(0.2, 0.4, uv.y)));
  direction += 0.03 * (ss(0.1, 0.2, 1.0 - uv.y) * (1.0 - ss(0.2, 0.4, 1.0 - uv.y)));
  direction *= (0.5 + 0.5 * uv.y * uv.y);
  direction *= cw;
  direction -= t;
  return float4(direction, bump, edge, diagBL);
}

half4 main(float2 pos) {
  float2 uv = uvOrigin + pos * uvScale;
  float t = 0.3 * (time + 2.8);
  float cw = repetition * 2.0;
  float a = (-angle + 70.0) * PI / 180.0;
  float2 rot = float2(cos(a), sin(a));

  float noise = snoise(uv - t);
  float4 f = fieldA(uv, t, noise, cw, rot);
  float4 fx = fieldA(uv + float2(TEXEL, 0.0), t, noise, cw, rot);
  float4 fy = fieldA(uv + float2(0.0, TEXEL), t, noise, cw, rot);
  float fw = abs(fx.x - f.x) + abs(fy.x - f.x);
  float direction = f.x, bump = f.y, edge = f.z, diagBL = f.w;

  float2 r = uv - 0.5;
  float diagTL = (r.x * rot.x - r.y * rot.y + 0.5) + (r.x * rot.y + r.y * rot.x + 0.5);

  const float fwE = 0.002;
  float2 uvc = clamp(uv, 0.0, 1.0);
  float2 mask = min(uvc, 1.0 - uvc);
  float rawEdge = clamp(1.0 - pow(ss(0.0, 0.5, mask.x), 0.25) * pow(ss(0.0, 0.5, mask.y), 0.25), 0.0, 1.0);
  float opacity = 1.0 - ss(0.9 - 2.0 * fwE, 0.9, rawEdge);

  float3 color1 = float3(0.98, 0.98, 1.0);
  float3 color2 = float3(0.1, 0.1, 0.1 + 0.1 * ss(0.7, 1.3, diagTL));

  float thin1 = 0.12 / cw * (1.0 - 0.4 * bump);
  float thin2 = 0.07 / cw * (1.0 + 0.4 * bump);
  float3 w = float3(cw * thin1, cw * thin2, 1.0 - thin1 - thin2);

  float cd = clamp(1.0 - bump, 0.0, 1.0);
  float dR = cd;
  dR += 0.03 * bump * noise;
  dR += 5.0 * (ss(-0.1, 0.2, uv.y) * (1.0 - ss(0.1, 0.5, uv.y))) * (ss(0.4, 0.6, bump) * (1.0 - ss(0.4, 1.0, bump)));
  dR -= diagBL;
  float dB = cd * 1.3;
  dB += (ss(0.0, 0.4, uv.y) * (1.0 - ss(0.1, 0.8, uv.y))) * (ss(0.4, 0.6, bump) * (1.0 - ss(0.4, 0.8, bump)));
  dB -= 0.2 * edge;
  dR *= (shiftRed / 20.0);
  dB *= (shiftBlue / 20.0);

  float blur = softness / 15.0;
  w[1] -= 0.02 * ss(0.0, 1.0, edge + bump);

  float cr = colorChanges(color1.r, color2.r, fract(direction + dR), w, blur + fw, bump, colorTint.r, colorTint.a);
  float cg = colorChanges(color1.g, color2.g, fract(direction), w, blur + fw, bump, colorTint.g, colorTint.a);
  float cb = colorChanges(color1.b, color2.b, fract(direction - dB), w, blur + fw, bump, colorTint.b, colorTint.a);

  float3 color = float3(cr, cg, cb) * opacity;
  float3 bg = colorBack.rgb * colorBack.a;
  color = color + bg * (1.0 - opacity);
  opacity = opacity + colorBack.a * (1.0 - opacity);
  color += 1.0 / 256.0 * (fract(sin(dot(0.014 * pos * ditherScale, float2(12.9898, 78.233))) * 43758.5453123) - 0.5);

  float k = opacityMul;
  return half4(half3(color * k), half(opacity * k));
}
`;

/**
 * The screen-edge halo as a runtime shader: a soft, metal-coloured bloom
 * along one screen edge with a chromatic drift. Drawn additively over the
 * app; a true refraction of RN views is not possible from a Skia overlay,
 * so the lens term is applied to the strip's own light only.
 *
 *   edge: 0 left, 1 right, 2 top, 3 bottom; coordinates are the overlay's.
 */
export const EDGE_HALO_SKSL = `
uniform float edge;
uniform float edgeCoord;
uniform float centerAlong;
uniform float halfLen;
uniform float depth;
uniform float intensity;
uniform float3 tint;
uniform float time;

float ss(float e0, float e1, float x) { return smoothstep(e0, max(e1, e0 + 1e-6), x); }

half4 main(float2 pos) {
  float n, along;
  if (edge < 0.5)      { n = pos.x - edgeCoord; along = pos.y; }
  else if (edge < 1.5) { n = edgeCoord - pos.x; along = pos.y; }
  else if (edge < 2.5) { n = pos.y - edgeCoord; along = pos.x; }
  else                 { n = edgeCoord - pos.y; along = pos.x; }
  float da = abs(along - centerAlong);
  if (intensity <= 0.001 || n > depth || n < -0.5 || da > halfLen) return half4(0.0);
  float q = 1.0 - clamp(n / depth, 0.0, 1.0);
  float p = 1.0 - ss(0.0, 1.0, da / halfLen);
  p = p * p;
  float shimmer = 0.85 + 0.15 * sin(along * 0.11 + time * 1.7) * sin(along * 0.037 - time * 0.9);
  float bloom = pow(q, 1.6) * p * intensity * shimmer;
  float rim = ss(0.86, 1.0, q) * p * intensity;
  float lum = dot(tint, float3(0.2126, 0.7152, 0.0722));
  float3 sat = clamp(lum + (tint - lum) * 2.6, 0.0, 1.0);
  float3 glow = sat * (0.8 * bloom) + float3(1.0) * (0.10 * rim);
  float hue = along * 0.02 + time * 0.35;
  float3 drift = 0.5 + 0.5 * float3(sin(hue), sin(hue + 2.094), sin(hue + 4.189));
  float3 fringe = (float3(ss(0.15, 0.75, q), ss(0.35, 0.95, q), ss(0.0, 0.55, q)) * 0.6 + drift * 0.4) * 0.28 * bloom;
  float3 add = glow + fringe;
  float a = min(1.0, 0.9 * bloom + rim);
  return half4(half3(add), half(a));
}
`;
