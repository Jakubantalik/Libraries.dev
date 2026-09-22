# BotAvatarsKit — bot-avatars for SwiftUI

The animated bot avatars from [bot-avatars](../../../README.md), rebuilt for
iOS 17+ on SwiftUI's `Canvas`. Same eighteen shapes, faces and states, same
rig (a line-for-line port of the web engine), same plastic material — the
baked pillow form, the matcap with its bin hysteresis and cross-fade, the
per-texel cap and the matcap-sampled sides — with a tap for the click and a
finger for the pointer.

```swift
import BotAvatarsKit

BotAvatar(type: .clover, state: busy ? .working : .default)
BotAvatar(type: .star, face: .mouth, size: 96, saturation: 1.2)
BotAvatar(type: .blob, color: BotColor("#ff5c8a")!, shading: .crisp)

BotAvatarStage {                       // one canvas for the whole roster
    LazyVGrid(columns: columns) {
        ForEach(agents) { BotAvatar(type: $0.type, state: $0.state, size: 48) }
    }
}
```

## What's in it

| Web (`bot-avatars`)                     | SwiftUI                                                     |
| --------------------------------------- | ----------------------------------------------------------- |
| `<BotAvatar type face state size>`      | `BotAvatar(type:face:state:size:)`                          |
| `color`, `ink`, `brightness`, `saturation` | `color: BotColor?`, `ink:`, `brightness:`, `saturation:` |
| `speed`, `paused`, `seed`               | `speed:`, `paused:`, `seed:`                                |
| `shading` plastic / crisp / smooth / flat | `shading: .plastic` (default) `.crisp` `.smooth` `.flat`  |
| `shadow highlight depth light rim spread` | the same names, the same ranges and defaults              |
| `interactive` (pointer follow, click)   | `interactive:` — a tap pokes, a drag is the pointer         |
| `theme`                                 | `theme: ColorScheme?` (nil reads the environment; unused by the drawing, as on the web) |
| `whirl whirlSize whirlWidth whirlLength whirlTilt` | `whirl: BotAvatarWhirl(strength:size:width:length:tilt:)` |
| `jumpHeight … jumpLand`                 | `jump: BotAvatarJumpConfig` (every field, `.defaults` = `JUMP_DEFAULTS`) |
| `prefers-reduced-motion`                | `accessibilityReduceMotion`: the still pose, no loop         |
| `aria-label`                            | `accessibilityLabel("Clover bot, working")`, `.isImage`     |
| `botAvatarPresets`, `botAvatarPalette`  | `botAvatarPresets`, `BotAvatarType.preset`, `.paletteColor` |
| `botAvatarShapes`, `botAvatarParts`     | `botAvatarShapePaths`, `botAvatarPartPaths`, `BotAvatarType.shape` (a `Path`) |
| `BotAvatarSim`, `restPose`              | `BotAvatarSim`, `BotAvatarPose.rest(_:)`                    |
| `drawBotAvatarFrame`                    | `drawBotAvatarFrame(_:box:pose:cfg:state:)` on a `GraphicsContext` |
| `warmBotAvatarPlastic`                  | `warmBotAvatarPlastic(_:devicePx:depth:)`                   |
| `DrawConfig.sides` vector / sprite      | `BotAvatarDrawConfig.sides` `.auto` / `.vector` / `.merged` |
| —                                       | `BotAvatarStage { … }`: one canvas for every avatar inside  |
| —                                       | `.botAvatarPointer()`: a drag over a larger view is the pointer |

### Touch instead of a pointer
There is no pointer on a phone, so `interactive` (the default) means: a tap
is the web's click — a hop and a full turn — and while a finger drags over
the avatar the eyes and head follow the finger, as they follow a pointer
that comes near on the web. The drag feeds `BotAvatarPointer.shared`, a
location in the global coordinate space, and every interactive avatar on
screen reads it with the web's reach (full pull within a head width, gone
by three). Put `.botAvatarPointer()` on a grid or a card to let a drag
anywhere over it be the pointer for all the avatars in it; the gesture is
simultaneous, so taps and scrolling still work. Set
`BotAvatarPointer.shared.location` yourself to drive it from anything else.

### Layout
The view lays out `size` square. Its canvas is 1.5× that and sits a tenth
of the size higher (the web's overscan and rise), drawn as an overlay, so a
hop or a flip is never clipped while the layout stays exactly `size`.

### The stage
Every `BotAvatar` has a `Canvas` of its own — a layer Core Animation renders
each frame. On a roster the per-layer cost adds up, so `BotAvatarStage`
wraps any container and draws all the avatars inside it into one overlay
canvas; each avatar keeps its layout, its gestures and its props. The
stage's canvas reaches beyond the container by enough for a hop.

## Performance
- One shared frame clock (`BotAvatarClock`, a `CADisplayLink`) advances
  every subscribed rig, then bumps a counter the canvases observe, so the
  screen redraws in one pass. It stops while nothing is animating; paused
  avatars and reduced motion draw once.
- Per avatar per frame the work is the rig (a few µs) and recording the
  canvas: three merged side fills, the cap as an image fill of the outline,
  two eye strokes, a mouth. Measured with `CFAbsoluteTime` in the demo on
  an iPhone 16 / 16 Pro simulator (Release): 0.12–0.17 ms of CPU per
  96-pt avatar per frame in the idle state, 0.15–0.18 working with the
  mouth, 0.07–0.08 asleep; 18 animating at 56–60 fps, 49–50 fps with the
  whirl on while they spin (the Simulator's Metal bridge is the limit
  there, not the CPU: 0.15 ms per avatar).
- The plastic material's matcap (64 × 64) is rebuilt only once the light
  or the view has moved a bin (1/48); the new one cross-fades in over as
  many frames as the last bin took, and the texels are re-shaded — and
  copied into a `CGImage` — only when that mix changes. Nothing is read
  back from the GPU.
- Forms bake in the background, one at a time, the first time a type is
  drawn at a texture tier; the smooth look stands in until then (a paused
  avatar bakes at once).
- RenderBox spends its time per path fill, not per pixel, so the side
  slices that share a fill are merged into one path (`sides: .merged`, the
  default; `.vector` fills each slice as the web does, which the Simulator's
  Metal bridge renders at half the frame rate). The whirl, off by default,
  is drawn as six gradient-filled bands a half instead of the web's five
  strokes per segment, for the same reason.

## What differs from the web
- The pointer is a finger: see above. Hovering does not exist.
- The whirl's trail is a band under a conic gradient rather than a chain
  of stroked segments: the same widths, colours and fades, sampled at the
  same 34 segments, without the butt joins between them.
- The side stack merges runs of slices into one path filled with the run's
  middle slice's gradient; the gradient's centre is off by a few body units
  on the outer slices of a run, where a sliver shows. The reference grid
  (`ReferenceScreen` in the demo, exported at 2× with `-renderGrid YES`)
  differs from the web renderer's by a mean of 0.35/255 per tile.
- `seed` defaults to a random value per instance (there is no React id).
- The texture tier and the sprite scale cap the display scale at 2, as the
  web caps the device pixel ratio; the canvas itself renders at the display's
  scale.

## Building
A plain SwiftPM package, no resources. The demo in `../BotAvatarsDemo`
(xcodegen) builds, installs and launches with `./run.sh` on a booted
Simulator (the device by name, resolved to the booted one of that name);
`./run.sh "iPhone 16 Pro" -renderGrid YES` also writes the reference grid
to the app's `Documents/grid.png`, and `-screen controls|reference`,
`-state working -mouth YES -whirl YES`, `-count 6`, `-stage NO` set the grid
screen up for measurements, which it appends to `Documents/stats.txt`.
