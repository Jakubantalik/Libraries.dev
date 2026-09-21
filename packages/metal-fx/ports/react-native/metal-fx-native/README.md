# metal-fx-native — metal-fx v2 for React Native

The liquid-metal UI from [metal-fx](../../../README.md) v2 on
[react-native-skia](https://shopify.github.io/react-native-skia/) and
Reanimated. Same material (Paper Shaders' `liquidMetal`, ported to SkSL),
same presets, same numbers as the web engine — with the phone's tilt playing
the pointer.

```bash
npm install metal-fx-native @shopify/react-native-skia react-native-reanimated react-native-worklets
```

```tsx
import { MetalFx, MetalText, MetalBadge, MetalReflection, MetalReflectionText, MetalEdgeHalo } from 'metal-fx-native';

<MetalFx variant="circle" preset="chromatic" strength={0.9} innerShadow id="send">
  <View style={{ width: 40, height: 40 }}><ArrowUp /></View>
</MetalFx>

<MetalReflection of="send"><Chip label="Auto" /></MetalReflection>   // the chip catches the ring's light
<MetalText fontSize={24} fontWeight="500" id="pro">Pro</MetalText>   // metal inside the glyphs
<MetalReflectionText of="pro" strength={0.64}>Plan</MetalReflectionText>
<MetalBadge>New</MetalBadge>
<MetalEdgeHalo style={styles.card}>…a ring with an id…</MetalEdgeHalo>  // the card at the screen's edge
```

## What's in it

| Web (`metal-fx`)            | React Native                                   |
| --------------------------- | ---------------------------------------------- |
| `<MetalFx>` circle / button | `<MetalFx variant preset theme …>`             |
| `<MetalText>`               | `<MetalText>` (drawn in Skia)                  |
| `<MetalBadge>`              | `<MetalBadge>`                                 |
| `reflectionTargets`         | `<MetalReflection of>`, `<MetalReflectionText>` |
| `useMetalBend` (cursor)     | `tilt` (Reanimated gravity sensor)             |
| glow (halo + catch-light)   | `glow`, `glowGain`, `glowConfig`               |
| `innerShadow`               | `innerShadow`                                  |
| cursor light                | — (no pointer on a phone)                      |
| —                           | `<MetalEdgeHalo>` screen-edge liquid lens      |

### Everything runs on the UI thread
Time, tilt, the bend physics, the glow state machine and the shader uniforms
are shared values. React renders once per layout change; per frame, Skia
reads the derived values and redraws the small canvases behind each
component. The glow's luminance hunt samples a worklet port of the material
at 16 points every 66 ms — nothing is read back from the GPU.

### Tilt bend
`tilt` (default on) bends the ring like liquid toward the low side of the
phone, from the outline point in the tilt direction, with the web's
`useMetalBend` springs and liquid stretch. Tilt is measured against a slowly
adapting baseline. Drive it by hand with `tiltOverride` (a shared value of
`{dx, dy}` in g; the example's tilt pad uses it for the Simulator).

### Reflections
Give a ring, text or badge an `id`; wrap a neighbour in `<MetalReflection of>`
(chips, cards) or use `<MetalReflectionText of>` for a word. Frames are
measured in window coordinates on layout; if you move things without a
layout pass (an animated scroll), remount or re-layout the target.

### Edge halo
Wrap the view that touches the display's edge (a card, a bar) in
`<MetalEdgeHalo>`. When a ring with an `id` inside it sits within `reach` of
that edge, the side of the ring facing the edge is pulled toward it like
liquid glass — a slow undulation with a slight chromatic split and a faint
tint in the metal's colour. It is a runtime-shader layer on the ring's own
canvas, switched on only while a ring is near an edge; unlike the SwiftUI
port it cannot pull the surrounding views along (a Skia overlay can only
sample what it draws). Call `refreshMetalFrames()` from `onScroll` so the
lens follows the ring.

### Anti-aliasing
RN Skia's `clip` is not anti-aliased; every visible boundary here is a path
fill, a `dstOut` layer or a `Mask`, never a clip.

## Requirements
react-native-skia ≥ 2, Reanimated ≥ 4 with react-native-worklets ≥ 0.7 (Skia objects inside worklets), React
Native ≥ 0.78 (new architecture). See `../example` (Expo SDK 54).
