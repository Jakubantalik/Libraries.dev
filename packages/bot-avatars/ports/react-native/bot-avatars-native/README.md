# bot-avatars-native — bot-avatars for React Native

The animated bot avatars from [bot-avatars](../../../README.md) on
[react-native-skia](https://shopify.github.io/react-native-skia/) and
Reanimated. Same eighteen bodies, faces and states, same rig (it is the web
package's `BotAvatarSim`, imported, not copied), same numbers everywhere —
the slice stack, the face on its sphere, the whirl, the plastic material
lit per pixel, here in an SkSL runtime shader.

Local only: the package depends on the web package by path
(`"bot-avatars": "file:../../.."`) and is not published.

```bash
npm install @shopify/react-native-skia react-native-reanimated react-native-worklets
# and the package by path, or consume ../bot-avatars-native/src from Metro as the example does
```

```tsx
import { BotAvatar } from 'bot-avatars-native';

<BotAvatar type="clover" state={busy ? 'working' : 'default'} size={64} />
<BotAvatar type="star" face="mouth" shading="crisp" whirl={1} />
```

## What's in it

| Web (`bot-avatars`)                              | React Native                                                |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `<BotAvatar>` and every prop                     | `<BotAvatar>`, same names and defaults (`size` in points)   |
| 18 types, `face`, three `state`s                 | same (`droid` and `mech` draw their thin parts at 0.4 depth) |
| `shading` plastic / crisp / smooth / flat        | same; plastic is a runtime shader on the baked form         |
| `shadow` `highlight` `depth` `light` `rim` `spread` | same                                                     |
| `whirl` + `whirlSize/Width/Length/Tilt`          | same (off by default)                                       |
| `jump*` group                                    | same, through `BotAvatarSim.setJump`                        |
| pointer following, click = hop                   | a finger resting on the avatar is the pointer; a tap hops; `ref.lookAt(x, y)` for your own gesture |
| `prefers-reduced-motion`                         | `useReducedMotion()` (Reanimated): the still pose, no loop  |
| `theme`                                          | accepted for parity; nothing drawn depends on it (as on the web today) |
| `onClick`, `className`, `style`, `aria-label`    | `onPress`, `style`, `accessibilityLabel`, `testID`          |
| `drawBotAvatarFrame(ctx, …)`                     | `drawBotAvatarPose(canvas, …)` (JS), `drawBotAvatarFrame` (worklet) |
| `DrawConfig.sides` (WebKit blits side sprites)   | `sides` prop: `sprite` (default) or `vector`                |
| —                                                | `<BotAvatarSheet>`: one canvas for a whole roster           |

### Everything per frame runs off React
The rig runs on the JS thread — one `requestAnimationFrame` loop for every
avatar on screen, each `BotAvatarSim.update` a few microseconds — and writes
every avatar's pose, plus the plastic cap's lighting frame from the web's
`capFrame`, into one flat array handed to the UI thread as a single shared
value per frame. On the UI thread each avatar has a `useDerivedValue` that
records its frame into an `SkPicture` (a `<Picture>` inside a small
`<Canvas>`), so a frame never renders React. The loop stops in the
background and while nothing is subscribed.

### The look, checked
The example's reference screen draws the eighteen types in five still
poses through the same worklet at the web reference's geometry (box 96,
scale 2: 288-px tiles) and exports the PNG; against the web renderer's
screenshot the mean absolute difference is 0.26 / 255 per pixel with
`sides="vector"` (0.37 with sprites), no tile above 0.7, the residue being
edge anti-aliasing — Chrome's canvas is Skia too.

### The plastic material
Once per outline, texture tier and depth, the outline is rasterised into a
raster Skia surface, its coverage read back once, and the web's
`bakeBotAvatarForm` turns it into the pillow height field's normals and
baked occlusion; those go into a half-float RGBA image (`nx, ny, ao, 1`).
The front cap is the outline filled with an SkSL shader that samples that
image through the equator affine stretched along the turn and lights each
pixel with `buildMatcap`'s exact maths — the same wrap diffuse, two specular
lobes, Fresnel sky rim and window, the tone map read at the centre of the
web's 2048 lookup bins and the specular powers raised from `nh` floored to
1/1024, so the numbers are plastic.ts's numbers (checked against
`buildBotAvatarMatcap` in Node to 1e-5 on a 0–255 scale). The sixteen side
slices are sweep gradients with the web's 24 stops sampled from the same
lighting, rebuilt only when the light or the view has moved a bin (1/48), as
on the web; the cap moves every frame through its uniforms. Bakes run one
per timer slot (about 170 ms each on Hermes for the 96-texel tier — Hermes
has no JIT) with the smooth look standing in, exactly as the web's idle
bakes do; a still avatar bakes at once.

### The side slices
`plastic`'s sixteen side slices are the outline filled sixteen times with
sweep gradients, and in Ganesh every anti-aliased concave path fill is CPU
work — with eighteen avatars that was the frame. As the web does on WebKit,
the three side gradients are rendered once into sprites of the outline
(GPU offscreen surfaces, redrawn on a lighting rebuild) and each slice is
an image draw. `sides="vector"` keeps the path fills — the pixel-exact
look, a pixel of anti-aliasing better along the side stack's silhouette.

### One canvas for a roster
Each avatar draws into its own small canvas — one Metal layer each. Wrap a
roster in `<BotAvatarSheet>` and the avatars inside it lay out as usual
but paint through the sheet's single canvas at their measured positions
(`measureLayout` against the sheet; a parent that moves them without a
layout pass needs a re-layout). On the iOS Simulator, where compositing
many layers is the slow part, eighteen avatars go from about 44 fps to 58.

```tsx
<BotAvatarSheet style={styles.grid}>
  {agents.map((a) => <BotAvatar key={a.id} type={a.avatar} size={96} />)}
</BotAvatarSheet>
```

### Frame costs
Measured in the example on an iPhone 16 Pro Simulator (Xcode 26, M-series
Mac), eighteen plastic avatars at 96 pt, every one animating, read from
the stats line (`performance.now()` round the recording on the UI thread,
round the rig on the JS thread, and Reanimated's frame timestamps):

| | one canvas, sprites (default) | one canvas, vector sides | a canvas each, sprites | a canvas each, vector |
| --- | --- | --- | --- | --- |
| frame rate, idle | 58 fps | 45 fps | 44 fps | 35 fps |
| frame rate, working (spins) | 57 fps | — | — | — |
| UI thread, recording a frame | 0.36 ms / avatar | 0.27 ms / avatar | 0.39 | 0.31 |
| JS thread, rig + packing | 0.022 ms / avatar | | | |
| JS → UI hand-over (one ArrayBuffer) | 0.14 ms / frame | | | |

The recording figure includes the lighting rebuilds (about a fifth of
frames per avatar while the head wanders: 75 material evaluations, three
sweep gradients, three sprite redraws). The web's Chromium renderer spends
0.09 ms of CPU per avatar per frame; the target for the port was 0.15 ms,
and this sits at about 0.38 ms all in — Hermes has no JIT and every Skia
call is a JSI hop (some sixty per avatar per frame: sixteen image draws
with their concats, the cap, two eyes, a mouth). Per frame there are no
React renders, no GPU readbacks, and the only Skia objects made are the
picture and the cap's shader (its uniforms change every frame); the
sprites and gradients are remade only when the lighting has moved a bin.

### Sizing
The layout box is `size` square. The canvas behind it is `size × 1.5` with
the body's centre `0.1 × size` below its middle (`BOT_AVATAR_OVERSCAN`,
`BOT_AVATAR_RISE`), positioned absolutely so a hop or a flip is not clipped;
a parent with `overflow: 'hidden'` will clip it.

### Touch
`interactive` (default on): a tap hops and turns right round; while a
finger rests on the avatar the eyes and head follow it, with the web's
reach (full pull within a head width, gone by three). A ref gives
`poke()`, `setPointer(x, y, strength)` and `lookAt(x, y)` in window
coordinates (`lookAt(null)` lets go) for a gesture over a whole roster —
the example's grid does this.

### Drawing it yourself
```ts
import { Skia } from '@shopify/react-native-skia';
import { drawBotAvatarPose, resolveBotAvatarConfig, resourcesFor, restPose } from 'bot-avatars-native';

const cfg = resolveBotAvatarConfig({ type: 'clover', face: 'mouth' }, 96 * 2); // props, box in device px
const res = resourcesFor('clover', 96 * 2, 0.65, true, true);                   // forms baked now
const surface = Skia.Surface.MakeOffscreen(288, 288)!;
drawBotAvatarPose(surface.getCanvas(), 96, restPose('working'), cfg, res);       // box 96 → a 144-unit canvas
```

## Requirements
react-native-skia ≥ 2 (`PathBuilder`, runtime shaders with children),
Reanimated ≥ 4 with react-native-worklets ≥ 0.7 (Skia objects inside
worklets), React Native ≥ 0.78 (new architecture). See `../example` (Expo
SDK 54).
