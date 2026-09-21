#include <metal_stdlib>
#include <SwiftUI/SwiftUI.h>
using namespace metal;

// MetalFxKit — the liquid-metal material and the screen-edge halo.
//
// `mfxLiquidMetal` is a port of Paper Shaders' `liquidMetal` fragment stage
// (Apache-2.0, paper-design/shaders @ 0.0.80), the material metal-fx v2 renders
// on the web, in the `shape: none` (full-fill) mode the web engine uses. The
// web draws the material once onto a 96×96 (×DPR 2) sheet and crops a window
// of it onto every instance (`copyShaderToInstance`); here the same window is
// expressed as a uv mapping (`uvOrigin + position * uvScale`) so a view of
// any size samples exactly the piece of the sheet the web would have shown.
//
// Two deliberate departures from the GLSL:
//   • no derivative intrinsics (`fwidth`) — SwiftUI shaders are stitchable
//     functions, not fragment functions. The stripe anti-aliasing width is a
//     finite difference of the stripe coordinate over one texel of the web's
//     192-px sheet, which also reproduces the web's softness at any DPR.
//   • the layer's own alpha is the mask: a stroked ring, a glyph, a pill.
//
// Output is premultiplied, as SwiftUI expects.

#define MFX_PI 3.14159265358979323846
#define MFX_TEXEL (1.0 / 192.0)

static inline float mfx_mod(float x, float y) { return x - y * floor(x / y); }
static inline float2 mfx_mod(float2 x, float y) { return x - y * floor(x / y); }
static inline float3 mfx_mod(float3 x, float y) { return x - y * floor(x / y); }

static inline float2 mfx_rotate(float2 uv, float th) {
    return float2x2(float2(cos(th), sin(th)), float2(-sin(th), cos(th))) * uv;
}

static inline float3 mfx_permute(float3 x) { return mfx_mod(((x * 34.0) + 1.0) * x, 289.0); }

static float mfx_snoise(float2 v) {
    const float4 C = float4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    float2 i = floor(v + dot(v, C.yy));
    float2 x0 = v - i + dot(i, C.xx);
    float2 i1 = (x0.x > x0.y) ? float2(1.0, 0.0) : float2(0.0, 1.0);
    float4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mfx_mod(i, 289.0);
    float3 p = mfx_permute(mfx_permute(i.y + float3(0.0, i1.y, 1.0)) + i.x + float3(0.0, i1.x, 1.0));
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

static inline float mfx_ss(float e0, float e1, float x) {
    return smoothstep(e0, max(e1, e0 + 1e-6), x);
}

// One channel of the stripe field, with the colour-burn tint.
static float mfx_colorChanges(float c1, float c2, float stripe_p, float3 w, float blur, float bump, float tint, float tintA) {
    blur = max(blur, 1e-5);
    float ch = mix(c2, c1, mfx_ss(0.0, 2.0 * blur, stripe_p));
    float border = w[0];
    ch = mix(ch, c2, mfx_ss(border, border + 2.0 * blur, stripe_p));
    border = w[0] + 0.4 * (1.0 - bump) * w[1];
    ch = mix(ch, c1, mfx_ss(border, border + 2.0 * blur, stripe_p));
    border = w[0] + 0.5 * (1.0 - bump) * w[1];
    ch = mix(ch, c2, mfx_ss(border, border + 2.0 * blur, stripe_p));
    border = w[0] + w[1];
    ch = mix(ch, c1, mfx_ss(border, border + 2.0 * blur, stripe_p));
    float gradient_t = (stripe_p - w[0] - w[1]) / w[2];
    float gradient = mix(c1, c2, mfx_ss(0.0, 1.0, gradient_t));
    ch = mix(ch, gradient, mfx_ss(border, border + 0.5 * blur, stripe_p));
    ch = mix(ch, 1.0 - min(1.0, (1.0 - ch) / max(tint, 0.0001)), tintA);
    return ch;
}

struct MfxField {
    float direction;
    float bump;
    float edge;
    float diagBL;
    float diagTL;
};

// Everything that depends on uv, up to (but not including) the stripe fract.
static MfxField mfx_field(float2 uv, float t, float noise, float cw, float contour, float distortion, float angle) {
    MfxField f;
    float2 uvc = clamp(uv, 0.0, 1.0);

    // Full-fill edge mask, on the web's square sheet (pixel_thickness = .5).
    float2 mask = min(uvc, 1.0 - uvc);
    float maskX = pow(mfx_ss(0.0, 0.5, mask.x), 0.25);
    float maskY = pow(mfx_ss(0.0, 0.5, mask.y), 0.25);
    float edge = clamp(1.0 - maskX * maskY, 0.0, 1.0);
    const float fwE = 0.002;
    edge = mix(mfx_ss(0.9 - 2.0 * fwE, 0.9, edge), edge, mfx_ss(0.0, 0.4, contour));
    edge = 1.2 * edge;

    float2 rotatedUV = uv - 0.5;
    float a = (-angle + 70.0) * MFX_PI / 180.0;
    float cosA = cos(a), sinA = sin(a);
    rotatedUV = float2(rotatedUV.x * cosA - rotatedUV.y * sinA, rotatedUV.x * sinA + rotatedUV.y * cosA) + 0.5;
    float diagBLtoTR = rotatedUV.x - rotatedUV.y;
    float diagTLtoBR = rotatedUV.x + rotatedUV.y;

    float2 grad_uv = uv - 0.5;
    float dist = length(grad_uv + float2(0.0, 0.2 * diagBLtoTR));
    grad_uv = mfx_rotate(grad_uv, (0.25 - 0.2 * diagBLtoTR) * MFX_PI);
    float direction = grad_uv.x;

    float uy = max(uvc.y, 0.0);
    float bump = pow(1.8 * dist, 1.2);
    bump = 1.0 - bump;
    bump *= pow(uy, 0.3);

    edge += (1.0 - edge) * distortion * noise;

    direction += diagBLtoTR;
    float sE = mfx_ss(0.0, 1.0, edge);
    direction -= 2.0 * noise * diagBLtoTR * (sE * (1.0 - sE));
    float c51 = mfx_ss(0.5, 1.0, contour);
    direction *= mix(1.0, 1.0 - edge, c51);
    direction -= 1.7 * edge * c51;
    direction += 0.2 * pow(contour, 4.0) * (1.0 - sE);

    bump *= clamp(pow(uy, 0.1), 0.3, 1.0);
    direction *= (0.1 + (1.1 - edge) * bump);

    direction *= (0.4 + 0.6 * (1.0 - mfx_ss(0.5, 1.0, edge)));
    direction += 0.18 * (mfx_ss(0.1, 0.2, uv.y) * (1.0 - mfx_ss(0.2, 0.4, uv.y)));
    direction += 0.03 * (mfx_ss(0.1, 0.2, 1.0 - uv.y) * (1.0 - mfx_ss(0.2, 0.4, 1.0 - uv.y)));

    direction *= (0.5 + 0.5 * uv.y * uv.y);
    direction *= cw;
    direction -= t;

    f.direction = direction;
    f.bump = bump;
    f.edge = edge;
    f.diagBL = diagBLtoTR;
    f.diagTL = diagTLtoBR;
    return f;
}

// The material at `uv` (0..1 over the web's square sheet, y down), premultiplied.
static float4 mfx_material(float2 uv, float2 dither, float time,
                           float4 colorBack, float4 colorTint,
                           float repetition, float softness, float shiftRed, float shiftBlue,
                           float distortion, float contour, float angle) {
    float t = 0.3 * (time + 2.8);
    float cw = repetition * 2.0;

    float noise = mfx_snoise(uv - t);
    MfxField f = mfx_field(uv, t, noise, cw, contour, distortion, angle);
    // Stripe AA width: finite difference over one texel of the web's sheet.
    MfxField fx = mfx_field(uv + float2(MFX_TEXEL, 0.0), t, noise, cw, contour, distortion, angle);
    MfxField fy = mfx_field(uv + float2(0.0, MFX_TEXEL), t, noise, cw, contour, distortion, angle);
    float fw = abs(fx.direction - f.direction) + abs(fy.direction - f.direction);

    float edge = f.edge, bump = f.bump, direction = f.direction;
    float diagBLtoTR = f.diagBL;

    // Full-fill opacity: only the sheet's outermost sliver ever reaches .9.
    const float fwE = 0.002;
    float2 uvc = clamp(uv, 0.0, 1.0);
    float2 mask = min(uvc, 1.0 - uvc);
    float rawEdge = clamp(1.0 - pow(mfx_ss(0.0, 0.5, mask.x), 0.25) * pow(mfx_ss(0.0, 0.5, mask.y), 0.25), 0.0, 1.0);
    float opacity = 1.0 - mfx_ss(0.9 - 2.0 * fwE, 0.9, rawEdge);

    float3 color1 = float3(0.98, 0.98, 1.0);
    float3 color2 = float3(0.1, 0.1, 0.1 + 0.1 * mfx_ss(0.7, 1.3, f.diagTL));

    float thin1 = 0.12 / cw * (1.0 - 0.4 * bump);
    float thin2 = 0.07 / cw * (1.0 + 0.4 * bump);
    float wide = 1.0 - thin1 - thin2;
    float3 w = float3(cw * thin1, cw * thin2, wide);

    float colorDispersion = clamp(1.0 - bump, 0.0, 1.0);
    float dR = colorDispersion;
    dR += 0.03 * bump * noise;
    dR += 5.0 * (mfx_ss(-0.1, 0.2, uv.y) * (1.0 - mfx_ss(0.1, 0.5, uv.y))) * (mfx_ss(0.4, 0.6, bump) * (1.0 - mfx_ss(0.4, 1.0, bump)));
    dR -= diagBLtoTR;
    float dB = colorDispersion * 1.3;
    dB += (mfx_ss(0.0, 0.4, uv.y) * (1.0 - mfx_ss(0.1, 0.8, uv.y))) * (mfx_ss(0.4, 0.6, bump) * (1.0 - mfx_ss(0.4, 0.8, bump)));
    dB -= 0.2 * edge;
    dR *= (shiftRed / 20.0);
    dB *= (shiftBlue / 20.0);

    float blur = softness / 15.0;
    w[1] -= 0.02 * mfx_ss(0.0, 1.0, edge + bump);

    float stripe_r = fract(direction + dR);
    float r = mfx_colorChanges(color1.r, color2.r, stripe_r, w, blur + fw, bump, colorTint.r, colorTint.a);
    float stripe_g = fract(direction);
    float g = mfx_colorChanges(color1.g, color2.g, stripe_g, w, blur + fw, bump, colorTint.g, colorTint.a);
    float stripe_b = fract(direction - dB);
    float b = mfx_colorChanges(color1.b, color2.b, stripe_b, w, blur + fw, bump, colorTint.b, colorTint.a);

    float3 color = float3(r, g, b) * opacity;
    float3 bgColor = colorBack.rgb * colorBack.a;
    color = color + bgColor * (1.0 - opacity);
    opacity = opacity + colorBack.a * (1.0 - opacity);

    // Banding fix (dither), as in Paper's shader.
    color += 1.0 / 256.0 * (fract(sin(dot(0.014 * dither, float2(12.9898, 78.233))) * 43758.5453123) - 0.5);
    return float4(color, opacity);
}

// SwiftUI `colorEffect`. The layer's alpha masks the material.
//   uv = uvOrigin + position * uvScale   (the web's sheet crop, see MetalFx.swift)
//   opacityMul = strength × preset shaderOpacity (× metalOpacity for text/badge)
[[ stitchable ]] half4 mfxLiquidMetal(float2 position, half4 color,
                                      float2 uvOrigin, float2 uvScale,
                                      float time,
                                      float4 colorBack, float4 colorTint,
                                      float repetition, float softness, float shiftRed, float shiftBlue,
                                      float distortion, float contour, float angle,
                                      float opacityMul, float ditherScale) {
    float la = float(color.a);
    if (la <= 0.0005) return half4(0.0);
    float2 uv = uvOrigin + position * uvScale;
    float4 m = mfx_material(uv, position * ditherScale, time, colorBack, colorTint,
                            repetition, softness, shiftRed, shiftBlue, distortion, contour, angle);
    float k = opacityMul * la;
    return half4(half3(m.rgb * k), half(m.a * k));
}

// Screen-edge halo (SwiftUI `layerEffect`, applied at the screen root).
//
// Light from a ring sitting close to the display's edge refracts through the
// glass edge: content in a strip along that edge is pulled toward it (a lens
// profile, with a small chromatic split) and a soft, metal-tinted glow blooms
// from the edge. Outside the strip every pixel is a single pass-through
// sample.
//
//   edge: 0 left, 1 right, 2 top, 3 bottom (of the screen)
//   edgeCoord: the screen edge's x (or y), in the layer's coordinates
//   centerAlong / halfLen: the strip's extent along the edge, points
//   depth: strip thickness, points
//   intensity: 0..1 (proximity)
//   tint: the metal's colour at the facing point, 0..1
[[ stitchable ]] half4 mfxEdgeHalo(float2 position, SwiftUI::Layer layer,
                                   float edge, float edgeCoord, float centerAlong, float halfLen, float depth,
                                   float intensity, float3 tint, float time, float displacement) {
    float n, along;
    float2 inward;   // unit vector pointing away from the edge, into the screen
    if (edge < 0.5)      { n = position.x - edgeCoord; along = position.y; inward = float2(1.0, 0.0); }
    else if (edge < 1.5) { n = edgeCoord - position.x; along = position.y; inward = float2(-1.0, 0.0); }
    else if (edge < 2.5) { n = position.y - edgeCoord; along = position.x; inward = float2(0.0, 1.0); }
    else                 { n = edgeCoord - position.y; along = position.x; inward = float2(0.0, -1.0); }

    float da = abs(along - centerAlong);
    if (intensity <= 0.001 || n > depth || n < -0.5 || da > halfLen) return layer.sample(position);

    float q = 1.0 - clamp(n / depth, 0.0, 1.0);          // 1 at the edge → 0 inside
    float p = 1.0 - mfx_ss(0.0, 1.0, da / halfLen);      // along-edge falloff
    p = p * p;
    if (displacement < 0.0) return half4(half(q), half(p), 0.0h, 1.0h);   // debug: geometry
    float w = q * q * p * intensity;

    // Lens: pull samples toward the edge, more the closer to it, with a
    // slight chromatic split (blue bends more).
    float disp = displacement * w;
    float2 pR = position + inward * disp * 0.92;
    float2 pG = position + inward * disp;
    float2 pB = position + inward * disp * 1.08;
    half4 sR = layer.sample(pR);
    half4 sG = layer.sample(pG);
    half4 sB = layer.sample(pB);
    half4 s = half4(sR.r, sG.g, sB.b, sG.a);
    if (displacement < -2.5) return s;                                        // debug: lens only

    // Bloom from the edge, in the metal's colour, with a slow shimmer along it.
    float shimmer = 0.85 + 0.15 * sin(along * 0.11 + time * 1.7) * sin(along * 0.037 - time * 0.9);
    float bloom = pow(q, 1.6) * p * intensity * shimmer;
    float rim = mfx_ss(0.86, 1.0, q) * p * intensity;
    // Push the tint's saturation: the glass edge splits the light.
    float lum = dot(tint, float3(0.2126, 0.7152, 0.0722));
    float3 sat = clamp(lum + (tint - lum) * 2.6, 0.0, 1.0);
    float3 glow = sat * (0.8 * bloom) + float3(1.0) * (0.10 * rim);
    // Chromatic fringe across the strip: the hue drifts with depth, and
    // slowly along the edge, so the bloom reads as split light.
    float hue = along * 0.02 + time * 0.35;
    float3 drift = 0.5 + 0.5 * float3(sin(hue), sin(hue + 2.094), sin(hue + 4.189));
    float3 fringe = (float3(mfx_ss(0.15, 0.75, q), mfx_ss(0.35, 0.95, q), mfx_ss(0.0, 0.55, q)) * 0.6 + drift * 0.4) * 0.28 * bloom;
    float3 add = glow + fringe;
    if (displacement < -1.5) return half4(half3(add), half(min(1.0, 0.9 * bloom + rim)));   // debug: glow only

    float3 rgb = float3(s.rgb) + add;
    float a = max(float(s.a), min(1.0, float(s.a) + 0.9 * bloom + rim));
    return half4(half3(rgb), half(a));
}
