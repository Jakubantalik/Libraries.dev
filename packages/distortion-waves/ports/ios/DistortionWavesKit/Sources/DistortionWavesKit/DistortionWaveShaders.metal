#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>
using namespace metal;

// Waves — one field, three shaders.
//
// Everything the wave does is read from the same signed distance to its front:
// the swell, the colour and the blur can never drift apart, because none of them
// has a position of its own.
//
//   d > 0  the wave has not got here yet
//   d = 0  the front
//   d < 0  the wave has passed
//
// The front starts as the source's own outline (a pill) and opens into an arc:
// the pill's straight spine shrinks to nothing while its radius grows.
//
// field: 0 originX, 1 originY, 2 spine, 3 radius, 4 squash, 5 time, 6 energy, 7 swell,
//        8 width, 9 height, 10 gravity, 11 glow, 12 clearRadius, 13 rim, 14 tilt,
//        15 ring, 16 hold, 17 launched, 18 hairClearRadius
//
// Touched off-centre, the wave's frame is turned (tilt) so that it leans toward
// the touch; the front is worked out in that frame.
//
// A ring (ring = 1) has no spine and no squash: a circle spreading from the
// source's centre. What varies along an arc with x varies along a ring with the
// angle instead, in whole turns, so nothing has a seam.
//
// hold is the radius of a round source the wave leaves alone: the epicentre stays
// sharp and in place, with no colour over it, so what it shows can morph in full
// view while the ring spreads from it. 0 holds nothing.

// Half the zone over which the two screens crossfade, pt (WaveFront.coverZone).
constant float coverZone = 60.0;

// How much of the wave acts at this point: 0 on a held source, 1 well clear of it.
static float heldAt(float2 p, device const float *f) {
    float hold = f[16];
    if (hold <= 0.0) return 1.0;
    return smoothstep(hold * 0.9, hold * 1.8, length(p - float2(f[0], f[1])));
}

struct Field {
    float d;
    float2 n;   // points away from the source, on screen
    float2 q;   // position relative to the origin, in the wave's frame
    float2 raw; // position relative to the origin, on screen
    float g;    // how fast the raw distance grows, which d has been divided by
};

static Field fieldAt(float2 p, device const float *f) {
    float2 raw = p - float2(f[0], f[1]);
    float cs = cos(f[14]), sn = sin(f[14]);
    float2 q = float2(cs * raw.x + sn * raw.y, -sn * raw.x + cs * raw.y);
    float spine = f[2], radius = f[3], squash = f[4], time = f[5], swell = f[7];

    // A narrower x metric bows the front: wider than a circle would be, it
    // would otherwise cross a phone screen as a nearly flat line.
    float mx = q.x * squash;
    float2 v = float2(max(abs(mx) - spine, 0.0), q.y);
    float l = max(length(v), 1e-3);
    float2 grad = float2(v.x * sign(q.x) * squash, v.y) / l;
    float g = max(length(grad), 1e-3);

    // A slow bend along the front, so the wave never looks drawn with a compass.
    // Low frequencies only: anything quicker reads as a wobble at this speed.
    float bend;
    if (f[15] > 0.5) {
        float a = atan2(q.y, q.x);
        bend = 0.62 * sin(2.0 * a + time * 1.1) + 0.38 * sin(3.0 * a - time * 1.5 + 1.7);
    } else {
        float s = mx * 0.0058;
        bend = 0.62 * sin(s + time * 1.1) + 0.38 * sin(s * 2.1 - time * 1.5 + 1.7);
    }

    float2 n = grad / g;
    Field out;
    out.d = (l - radius) / g + swell * bend;
    out.n = float2(cs * n.x - sn * n.y, sn * n.x + cs * n.y);
    out.q = q;
    out.raw = raw;
    out.g = g;
    return out;
}

// ─── Swell ───────────────────────────────────────────────────────────────────
//
// layer: one side of the transition, with its progressive blur already in it.
// side:  +1 the content the wave leaves behind it (visible ahead of the front),
//        -1 the content it reveals (visible behind the front).
//
// Content rises once as the swell passes and settles back: one smooth pulse per
// pixel, never a reversal. At this speed a lens that pushes content both ways,
// or ripples behind it, is seen as the screen shaking.
//
// Gravity is the anticipation before all that: everything falls toward the
// source, more the nearer it is, and is let go as the wave leaves.
//
// Chromatic aberration follows from the same displacement: the colours part along
// the way a pixel has been moved, in proportion to how far. So it shows exactly
// where the UI and text are distorted, and anything unmoved stays perfectly clean.
// Several samples across the spectrum make it a smooth split, not three ghost images.

// How much each sample, from the red end to the blue end, gives to each channel.
constant int spectrumSamples = 5;
constant half3 spectrum[spectrumSamples] = {
    half3(0.571, 0.000, 0.000),
    half3(0.343, 0.206, 0.000),
    half3(0.086, 0.588, 0.086),
    half3(0.000, 0.206, 0.343),
    half3(0.000, 0.000, 0.571),
};

[[ stitchable ]] half4 waveLens(
    float2 p, SwiftUI::Layer layer,
    device const float *f, int fc,
    float amplitude, float width, float aberration, float side
) {
    Field w = fieldAt(p, f);
    float energy = f[6], gravity = f[10];
    float2 bounds = float2(f[8], f[9]) - 0.5;

    // Ahead of the zone the outgoing side covers the incoming one completely,
    // so the incoming side has nothing to draw there. Before the launch the
    // incoming side is not drawn at all, so the outgoing one covers everything,
    // the source and the ring falling onto it included.
    float cover = 1.0;
    if (side > 0.0) {
        if (f[17] > 0.5) cover = smoothstep(-coverZone, coverZone, w.d);
        if (cover <= 0.0) return half4(0.0);
    } else if (w.d > coverZone + 6.0) {
        return half4(0.0);
    }

    // Steeper ahead, where it compresses what it is about to reach; long behind.
    float u = w.d / (width * (w.d > 0.0 ? 0.85 : 1.5));
    float lift = exp(-u * u);
    float r = max(length(w.raw), 1.0);

    // How far the content shown at this pixel has been moved. Gravity moves the
    // whole screen, but far from the source it only slides content along: it bends
    // it near the source, so only there does it count as distortion.
    float held = heldAt(p, f);
    float2 swollen = w.n * energy * amplitude * lift * held;
    float2 inward = w.raw / r;
    float2 s = p - swollen + inward * gravity * exp(-r / 900.0) * held;
    float2 split = (swollen - inward * gravity * exp(-r / 240.0) * held) * aberration;

    // Under a quarter of a point the colours can't be seen apart.
    if (dot(split, split) < 0.0625) {
        return layer.sample(clamp(s, float2(0.5), bounds)) * half(cover);
    }

    half4 out = half4(0.0);
    for (int i = 0; i < spectrumSamples; i++) {
        float along = float(i) / float(spectrumSamples - 1) * 2.0 - 1.0;
        half4 c = layer.sample(clamp(s + split * along, float2(0.5), bounds));
        out += half4(c.rgb * spectrum[i], c.a / half(spectrumSamples));
    }
    return out * half(cover);
}

// ─── Progressive blur ────────────────────────────────────────────────────────
//
// The blur radius this pixel should have, turned into the coverage of one
// blurred copy of the content: copies stacked over the sharp original, each
// taking over where the last one ends, give a true gaussian at every radius.
// Blur gathers ahead of the front, peaks on it, and clears slowly behind it, so
// what the wave reveals comes into focus as the wave moves on.
[[ stitchable ]] half4 waveBlurMask(
    float2 p, half4 color,
    device const float *f, int fc,
    float blur, float ahead, float behind, float from, float to
) {
    Field w = fieldAt(p, f);
    float u = w.d / (w.d > 0.0 ? ahead : behind);
    float radius = f[6] * blur * exp(-u * u) * heldAt(p, f);
    float t = clamp((radius - from) / max(to - from, 1e-3), 0.0, 1.0);
    return color * half(t * t * (3.0 - 2.0 * t));
}

// ─── Colour ──────────────────────────────────────────────────────────────────

static float3 oklabToSRGB(float3 c) {
    float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
    float m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
    float s = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
    l = l * l * l; m = m * m * m; s = s * s * s;
    float3 lin = clamp(float3(
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    ), 0.0, 1.0);
    return mix(12.92 * lin, 1.055 * pow(lin, float3(1.0 / 2.4)) - 0.055, step(float3(0.0031308), lin));
}

static float sq(float x) { return x * x; }

// Signed distance to a rect with Apple's continuous corners, as the iPhone's
// screen has: the curve starts 1.53 radii from the corner, and passes where a
// circular corner of that radius would at 45°. A superellipse with these two
// points in common is within a fraction of a point of it, which a hairline on the
// glass needs; a circular corner runs off the glass where the curve begins.
static float continuousRectSDF(float2 p, float2 halfSize, float radius) {
    float a = min(radius * 1.528665, min(halfSize.x, halfSize.y));
    float2 q = abs(p) - (halfSize - a);
    if (q.x <= 0.0 || q.y <= 0.0) {
        return max(abs(p.x) - halfSize.x, abs(p.y) - halfSize.y);
    }
    const float n = 3.26;
    float2 u = q / a;
    float norm = pow(pow(u.x, n) + pow(u.y, n), 1.0 / n);
    float2 g = pow(u / max(norm, 1e-4), float2(n - 1.0));
    return (norm - 1.0) * a / max(length(g), 1e-3);
}

// Where a point is along the screen's rounded-rect edge: clockwise from the top
// centre, through the corner arcs, pt. .y is the whole perimeter. Ported from
// BorderBeamKit's borderPathCoord.
static float2 perimeterAt(float2 p, float2 halfSize, float r) {
    float ex = max(halfSize.x - r, 0.0);
    float ey = max(halfSize.y - r, 0.0);
    float arc = 0.5 * M_PI_F * r;
    float P = 4.0 * (ex + ey + arc);
    float ax = fabs(p.x), ay = fabs(p.y);
    if (ax > ex && ay > ey) {
        float2 v = p - float2(copysign(ex, p.x), copysign(ey, p.y));
        float a, base;
        if (p.x >= 0.0 && p.y < 0.0) { a = atan2(v.x, -v.y);  base = ex; }
        else if (p.x >= 0.0)         { a = atan2(v.y, v.x);   base = ex + arc + 2.0 * ey; }
        else if (p.y >= 0.0)         { a = atan2(-v.x, v.y);  base = 3.0 * ex + 2.0 * arc + 2.0 * ey; }
        else                         { a = atan2(-v.y, -v.x); base = 3.0 * ex + 3.0 * arc + 4.0 * ey; }
        return float2(base + r * clamp(a, 0.0, 0.5 * M_PI_F), P);
    }
    bool side = ax > ex ? true : (ay > ey ? false : (halfSize.x - ax) < (halfSize.y - ay));
    if (side) {
        return float2(p.x >= 0.0 ? ex + arc + (p.y + ey) : 3.0 * ex + 3.0 * arc + 2.0 * ey + (ey - p.y), P);
    }
    return float2(p.y < 0.0 ? (p.x >= 0.0 ? p.x : P + p.x) : ex + 2.0 * arc + 2.0 * ey + (ex - p.x), P);
}

// How thick the colour on the edges is at `s` along the perimeter, as a share of
// rimWidth — BorderBeamKit's glow, wrapped round the screen: lumps of their own
// length and depth, with thin stretches between them. The lumps (centre, length,
// depth triplets, drifting and breathing) are worked out once a frame, in
// WaveRim. Averages 1; the thinnest is about a tenth of that, the thickest almost
// three times.
static float rimThickness(float s, float P, device const float *lumps, int count) {
    float t = 0.08;
    for (int i = 0; i + 2 < count; i += 3) {
        float ds = s - lumps[i];
        ds -= P * rint(ds / P);
        t += lumps[i + 2] * exp(-sq(ds / lumps[i + 1]));
    }
    return t / 1.0498;
}

// Interleaved gradient noise: enough to hide banding, not enough to see.
static float dither(float2 p) {
    return fract(52.9829189 * fract(dot(p, float2(0.06711056, 0.00583715)))) - 0.5;
}

// One colour from the ring of `count` OKLab triplets, mixed so neighbours never
// pass through grey.
static float3 paletteAt(device const float *palette, int count, float u) {
    float x = fract(u) * float(count);
    int i = min(int(x), count - 1);
    int j = (i + 1) % count;
    float m = fract(x);
    m = m * m * (3.0 - 2.0 * m);
    return mix(
        float3(palette[i * 3], palette[i * 3 + 1], palette[i * 3 + 2]),
        float3(palette[j * 3], palette[j * 3 + 1], palette[j * 3 + 2]),
        m
    );
}

// The wave's colour, in two parts.
//
// The band rides the front: the voice palette flowing along it, with the voice
// glow's structure across it — a warm fringe ahead, a cool one behind, a glow
// between them. Every edge of it is wide and feathered, with no line anywhere.
//
// The rim is what the band leaves on the screen's edges: colour clinging to them
// after the middle has cleared, until a second, later front wipes it away.
//
// palette: OKLab triplets, the last two being the warm and the cool fringe.
[[ stitchable ]] half4 waveBand(
    float2 p, half4 color,
    device const float *f, int fc,
    device const float *palette, int pc,
    float lead, float tail, float strength,
    float rimWidth, float rimSoftness, float cornerRadius, float unevenness, float pulse,
    float hairWidth, float hairOpacity, float hairWhite,
    device const float *lumps, int lumpCount
) {
    float glow = f[11], rim = f[13];
    float2 size = float2(f[8], f[9]);
    float2 c = p - size * 0.5;
    float inset = max(-continuousRectSDF(c, size * 0.5, cornerRadius), 0.0);
    // Further in than this, even the thickest lump has faded to nothing, and
    // the hairline is far behind.
    bool nearEdge = rim > 0.0 && inset < max(rimWidth * 2.2 * (1.0 + 1.9 * unevenness), hairWidth * 0.5 + 0.75);
    // Once the front's colour has gone, only the edges are left to draw: the
    // rest of the view need not work out the field at all.
    if (glow <= 0.0 && !nearEdge) return half4(0.0);

    Field w = fieldAt(p, f);
    float d = w.d, time = f[5];

    // The tail swells and thins along the front, like the voice glow's lobes,
    // and is lighter in the middle of the screen, which it clears first.
    bool ring = f[15] > 0.5;
    float turn = atan2(w.q.y, w.q.x);
    float along = w.q.x * 0.0068;
    float lobes = ring
        ? 0.5 + 0.5 * sin(2.0 * turn + time * 1.4) * cos(turn - time * 0.7 + 1.2)
        : 0.5 + 0.5 * sin(along * 1.3 + time * 1.4) * cos(along * 0.6 - time * 0.7 + 1.2);
    float bandA = 0.0;
    if (glow > 0.0 && d < lead) {
        if (d >= 0.0) {
            float k = 1.0 - d / lead;
            bandA = k * k * k * (k * (k * 6.0 - 15.0) + 10.0);
        } else {
            bandA = pow(1.0 - clamp(-d / (tail * mix(0.6, 1.3, lobes)), 0.0, 1.0), 2.3);
        }
        bandA *= glow * strength * mix(0.6, 1.0, exp(-inset / 140.0)) * heldAt(p, f);
    }

    // Around the screen: normalised, so the long sides get their share of colour.
    float around = atan2(c.y / size.y, c.x / size.x);
    float rimA = 0.0;
    float hairA = 0.0;
    float shimmer = 0.5;
    if (nearEdge) {
        float2 edge = perimeterAt(c, size * 0.5, cornerRadius);
        float thickness = 1.0;
        if (unevenness > 0.0) {
            // Past 1 the lumps are pushed further still, and the thinnest
            // stretches break off altogether.
            thickness = max(1.0 + (rimThickness(edge.x, edge.y, lumps, lumpCount) - 1.0) * unevenness, 0.04);
        }
        float hug = exp(-sq(inset / (rimWidth * thickness)));
        float reached = 1.0 - smoothstep(-lead * 0.7, lead * 0.5, d);
        float kept = smoothstep(-rimSoftness, rimSoftness, d + (f[3] - f[12]) / w.g);
        // As BorderBeamKit's pulse: two soft swells of brightness running round
        // the edge.
        shimmer = 0.5 + 0.5 * sin(time * 3.4 - edge.x / edge.y * 4.0 * M_PI_F);
        rimA = hug * reached * kept * rim * mix(1.0, 0.7 + 0.3 * shimmer, pulse);

        // A hairline right on the glass, as BorderBeamKit's stroke ring: all the
        // way round, brightest where the lumps are and where the pulse's light
        // runs.
        if (hairWidth > 0.0) {
            float line = 1.0 - smoothstep(hairWidth * 0.5, hairWidth * 0.5 + 0.75, inset);
            // Wiped by a front of its own, later and slower than the colour's,
            // so the line outlasts the colour it sits on.
            float hairKept = smoothstep(-rimSoftness, rimSoftness, d + (f[3] - f[18]) / w.g);
            hairA = line * reached * hairKept * rim * hairOpacity
                * mix(0.5, 1.0, smoothstep(0.1, 1.5, thickness))
                * mix(1.0, 0.55 + 0.45 * shimmer, pulse);
        }
    }

    float a = 1.0 - (1.0 - bandA) * (1.0 - rimA);
    float total = 1.0 - (1.0 - a) * (1.0 - hairA);
    if (total <= 0.0005) return half4(0.0);

    int n = pc / 3 - 2;
    // Round a ring, the palette goes once round with it.
    float flow = 0.62 + (ring ? turn / (2.0 * M_PI_F) : along * 0.2) + time * 0.13 + d * 0.0015
        + (ring ? 0.0 : 0.05 * sin(w.q.y * 0.009 + time));
    float3 lab = paletteAt(palette, n, flow);
    float3 warm = float3(palette[n * 3], palette[n * 3 + 1], palette[n * 3 + 2]);
    float3 cool = float3(palette[n * 3 + 3], palette[n * 3 + 4], palette[n * 3 + 5]);
    lab = mix(lab, warm, 0.5 * exp(-sq((d - 30.0) / 50.0)));
    lab = mix(lab, cool, 0.5 * exp(-sq((d + 84.0) / 72.0)));
    lab.yz *= 1.22;
    lab = mix(lab, float3(0.99, 0.0, 0.0), 0.7 * exp(-sq((d + 8.0) / 26.0)));

    // Once around the ring: `around` jumps by a full turn, which fract() hides.
    float3 rimLab = paletteAt(palette, n, around / (2.0 * M_PI_F) + time * (0.12 + 0.25 * pulse) + inset * 0.0012);
    rimLab.yz *= 1.1;
    lab = mix(lab, rimLab, rimA / (rimA + bandA + 1e-4));

    // The hairline over the glow: the edge's own colour, whitening where the
    // pulse's light passes, as the beam's highlight does.
    float3 rgb = oklabToSRGB(lab);
    if (hairA > 0.0) {
        float3 hair = mix(oklabToSRGB(rimLab), float3(1.0), hairWhite * (0.5 + 0.5 * shimmer));
        rgb = (rgb * a * (1.0 - hairA) + hair * hairA) / total;
    }

    float noise = dither(p) * 2.0 / 255.0;
    return half4(half3(clamp(rgb * total + noise, 0.0, 1.0)), half(clamp(total + noise, 0.0, 1.0)));
}
