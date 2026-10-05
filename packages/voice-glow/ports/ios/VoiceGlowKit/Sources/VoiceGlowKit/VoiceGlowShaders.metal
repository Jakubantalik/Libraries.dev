#include <metal_stdlib>
using namespace metal;

// VoiceGlowKit — the glow's layer shader.
//
// Reproduces one layer of the web glow (see packages/voice-glow/src/styles.ts):
// a stack of CSS radial-gradient lobes composited source-over (first lobe on
// top), optionally the white highlight above them, masked by the ellipse the
// glow rises in, cut to the layer's geometry.
//
// CSS semantics mirrored:
// - Explicit-size radial gradients: the two lengths are the ellipse RADII.
// - `color 0%, transparent F%` interpolates premultiplied: RGB constant,
//   alpha falls linearly to 0 at F% of the radius.
// - The lobe colours arrive already through the layer's filter chain
//   (hue-rotate / brightness / saturate), which is linear, so the chain is
//   applied on the CPU once per lobe instead of once per pixel.
//
// kind: 0 = stroke ring (::after)      — the 1pt edge ring
//       1 = inner light (::before)     — rounded rect, corner fades, inset shadow
//       2 = bloom ([data-voice-beam-bloom]) — gradients only; blurred and
//           masked by SwiftUI (CSS blurs before it masks)
//       3 = mask only                  — white × the mask, for the bloom's mask

static float roundedRectSDF(float2 p, float2 halfSize, float radius) {
    float2 q = abs(p) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

static float4 srcOver(float4 src, float4 dst) {
    return src + dst * (1.0 - src.a);
}

// The ellipse mask: alpha 1 at the centre, 0.5 at `mid`, `tail` at 0.85
// (when ≥ 0), 0 at the edge — piecewise linear in normalised distance.
static float maskAlpha(float d, float mid, float tail) {
    if (d >= 1.0) return 0.0;
    if (d <= mid) return mix(1.0, 0.5, d / max(mid, 1e-4));
    if (tail < 0.0) return mix(0.5, 0.0, (d - mid) / max(1.0 - mid, 1e-4));
    if (d <= 0.85) return mix(0.5, tail, (d - mid) / max(0.85 - mid, 1e-4));
    return mix(tail, 0.0, (d - 0.85) / 0.15);
}

static float ellipseDistance(float2 p, float2 c, float2 r) {
    if (r.x <= 0.0 || r.y <= 0.0) return 1e6;
    return length((p - c) / r);
}

// lobes:     8 floats each — cx, cy, rx, ry (pt), r, g, b (0–1), a
// highlight: 11 floats or none — cx, cy, rx, ry, r, g, b, a0, p1, a1, p2
//            (alpha a0 at the centre, a1 at p1, 0 at p2)
// mask:      6 floats or none — cx, cy, rx, ry, mid, tail (tail < 0: none)
// params:    kind, cornerRadius, borderWidth, fadeStop, cornerFade, insetBlur,
//            shadowR, shadowG, shadowB, shadowA, opacity
[[ stitchable ]] half4 voiceGlowLayer(
    float2 position,
    half4 inColor,
    float2 size,
    device const float *lobes, int lobeCount,
    device const float *highlight, int highlightCount,
    device const float *mask, int maskCount,
    device const float *params, int paramCount
) {
    int kind = int(params[0]);
    float radius = params[1];
    float borderWidth = params[2];
    float fadeStop = params[3];
    float cornerFade = params[4];
    float insetBlur = params[5];
    float4 shadow = float4(params[6], params[7], params[8], params[9]);
    float opacity = params[10];

    float2 center = size * 0.5;
    float2 rel = position - center;

    // ── Mask ──────────────────────────────────────────────────────────────
    float m = 1.0;
    if (maskCount >= 6) {
        float d = ellipseDistance(position, float2(mask[0], mask[1]), float2(mask[2], mask[3]));
        m = maskAlpha(d, mask[4], mask[5]);
    }
    if (kind == 3) {
        return half4(m, m, m, m);
    }

    // ── Geometry ──────────────────────────────────────────────────────────
    float outerSDF = roundedRectSDF(rel, center, radius);
    float outerCov = 1.0 - smoothstep(-0.5, 0.5, outerSDF);
    float geom = 1.0;
    if (kind == 0) {
        float innerR = max(radius - borderWidth, 0.0);
        float innerSDF = roundedRectSDF(rel, center - borderWidth, innerR);
        float innerCov = 1.0 - smoothstep(-0.5, 0.5, innerSDF);
        geom = max(outerCov - innerCov, 0.0);
    } else if (kind == 1) {
        // mask-composite: the ellipse ∩ (top/bottom fades ∪ left/right fades)
        float y = position.y, x = position.x;
        float v = max(max(0.0, 1.0 - y / cornerFade), max(0.0, 1.0 - (size.y - y) / cornerFade));
        float h = max(max(0.0, 1.0 - x / cornerFade), max(0.0, 1.0 - (size.x - x) / cornerFade));
        geom = outerCov * (v + h * (1.0 - v));
    }
    if (geom * m <= 0.0) return half4(0);

    // ── Lobes, first on top ───────────────────────────────────────────────
    float4 col = float4(0);
    int n = lobeCount / 8;
    for (int i = n - 1; i >= 0; i--) {
        device const float *l = lobes + i * 8;
        float d = ellipseDistance(position, float2(l[0], l[1]), float2(l[2], l[3]));
        float a = l[7] * max(0.0, 1.0 - d / fadeStop);
        if (a <= 0.0) continue;
        col = srcOver(float4(l[4], l[5], l[6], 1.0) * a, col);
    }

    if (highlightCount >= 11) {
        float d = ellipseDistance(position, float2(highlight[0], highlight[1]), float2(highlight[2], highlight[3]));
        float a0 = highlight[7], p1 = highlight[8], a1 = highlight[9], p2 = highlight[10];
        float a = d <= p1 ? mix(a0, a1, d / max(p1, 1e-4))
                : (d < p2 ? mix(a1, 0.0, (d - p1) / max(p2 - p1, 1e-4)) : 0.0);
        if (a > 0.0) col = srcOver(float4(highlight[4], highlight[5], highlight[6], 1.0) * a, col);
    }

    if (kind == 1 && shadow.a > 0.0) {
        // box-shadow: inset 0 0 <blur> 1px — full at the edge, gone ~blur in.
        float e = -outerSDF;
        float s = shadow.a * (1.0 - smoothstep(1.0 - insetBlur, 1.0 + insetBlur, e));
        col = srcOver(float4(shadow.rgb, 1.0) * s, col);
    }

    float k = geom * m * opacity;
    return half4(col * k);
}
