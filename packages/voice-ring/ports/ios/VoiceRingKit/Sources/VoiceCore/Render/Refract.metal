// Refraction at the screen's edge — port of src/engine/refract.ts. Where a
// luminous orb presses on the edge its pixels are drawn through a lens
// there: toward the edge the image is stretched out across the gap the orb
// rests short by and opened a little taller, red and blue part as glass
// disperses them, and it blurs, more the nearer the edge.

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

[[ stitchable ]] half4 voiceRefract(
    float2 p, SwiftUI::Layer layer,
    float wall, float side, float zone, float gap, float flare, float split, float blur, float cy
) {
    // 0 a zone back from the edge … 1 at it and past it
    float t = clamp(1.0 - (wall - p.x) * side / zone, 0.0, 1.0);
    if (t <= 0.0) return layer.sample(p);
    float w = t * t;
    // drawn out across the gap toward the edge, and opened a little taller
    float d = (wall - p.x) * side + gap * w;
    float2 s = float2(wall - side * d, cy + (p.y - cy) / (1.0 + flare * w));
    // dispersion: red bent further out than blue, along the stretch and the flare
    float2 sp = float2(side, 0.6 * (p.y - cy) / zone) * split * w;
    // the blur grows toward the edge, drawn out along the stretch
    float b = blur * w;
    half3 rgb = half3(0.0);
    half a = 0.0;
    const int taps = 16;
    for (int i = 0; i < taps; i++) {
        float f = float(i);
        float r = sqrt((f + 0.5) / float(taps)) * b;
        float2 o = float2(cos(f * 2.39996) * 1.8, sin(f * 2.39996)) * r;
        half4 cr = layer.sample(s + o + sp);
        half4 cg = layer.sample(s + o);
        half4 cb = layer.sample(s + o - sp);
        rgb += half3(cr.r, cg.g, cb.b);
        a += max(cg.a, max(cr.a, cb.a));
    }
    return half4(rgb, a) / half(taps);
}
