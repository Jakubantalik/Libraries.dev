# bot-avatars

Animated bot avatars for React. Eighteen simple 3D shapes with living faces — round eyes that blink and glance, an optional mouth — and three states an agent can be in: idle, working and sleeping. Each one turns its head, looks around, hops and flips, and every state change is a cross-animation. Vector shapes drawn on a 2D canvas as a lit, rounded extrusion: no WebGL, no runtime dependencies.

[Live demo](https://libraries.dev/avatars) · [Repository](https://github.com/Jakubantalik/Libraries.dev) · [Report an issue](https://github.com/Jakubantalik/Libraries.dev/issues)

## Install

```bash
npm install bot-avatars
```

## Quick start

```tsx
import { BotAvatar } from 'bot-avatars';

function Agent({ busy }: { busy: boolean }) {
  return <BotAvatar type="clover" state={busy ? 'working' : 'default'} />;
}
```

## Types

Eighteen bodies, each with its own colour:

```tsx
<BotAvatar type="clover" />    {/* sky */}
<BotAvatar type="flower" />    {/* pink */}
<BotAvatar type="triangle" />  {/* magenta */}
<BotAvatar type="square" />    {/* sky */}
<BotAvatar type="blob" />      {/* green */}
<BotAvatar type="ghost" />     {/* white */}
<BotAvatar type="circle" />    {/* lavender */}
<BotAvatar type="drop" />      {/* teal */}
<BotAvatar type="star" />      {/* yellow */}
<BotAvatar type="droid" />     {/* pale, antenna ball, round ears */}
<BotAvatar type="mech" />      {/* slate, wide head, two antennae */}
<BotAvatar type="alien" />     {/* lime, wide brow, narrow chin */}
<BotAvatar type="hexagon" />   {/* orange nut */}
<BotAvatar type="cat" />       {/* butter, round head, two ears */}
<BotAvatar type="cloud" />     {/* pale sky, five puffs */}
<BotAvatar type="pill" />      {/* indigo, a wide capsule */}
<BotAvatar type="pebble" />    {/* peach, a wide flat stone */}
<BotAvatar type="puddle" />    {/* salmon, a taller lumpy blob */}
```

## Faces

The eyes alone by default. `face="mouth"` adds a small mouth that changes with the state:

```tsx
<BotAvatar type="clover" face="mouth" />
```

## States

```tsx
<BotAvatar state="default" />   {/* idle: turns to look around, blinks, a jump with a full turn now and then */}
<BotAvatar state="working" />   {/* busy: hopping — every third hop a spin — with a wide smile and the odd laugh */}
<BotAvatar state="sleeping" />  {/* head down, lids shut, slow breaths and the odd nod */}
```

Every state is a resting pose plus its own motion. The pose is a small rig — yaw, pitch, roll, position, squash, eyes — and a state switch eases from the old targets to the new ones on a timed curve (soft start, soft finish), so it never snaps or creeps. With `prefers-reduced-motion: reduce` (or `paused`) the still pose of the state is drawn instead.

## Colour

```tsx
<BotAvatar type="blob" color="#ff5c8a" />          {/* any body colour */}
<BotAvatar type="clover" color="#111" />            {/* the ink turns light on a dark body */}
<BotAvatar type="star" ink="#4D7CFF" />             {/* or pick the ink yourself */}
<BotAvatar type="drop" brightness={1.25} />          {/* lighter body; below 1 darker */}
<BotAvatar type="drop" saturation={0.7} />           {/* duller body; above 1 more vivid */}
<BotAvatar type="square" shading="crisp" />         {/* a lit rim with a clean edge */}
<BotAvatar type="square" shading="smooth" />        {/* soft shadow and highlight, no edge */}
<BotAvatar type="square" shading="flat" />          {/* keep the depth, drop the lighting */}
```

The palette is exported as `botAvatarPalette` (type → colour), with `botAvatarPresets` carrying each type's face and label.

## Shading

`plastic` (the default) is a real material, shaded per pixel: the outline is baked once into a pillow height field (lobes become domes, rays become tubes, the cusps between them fall into shadow), and every frame a lit sphere is evaluated for the head's pose — wrap-around diffuse, a tight hot spot and a broad sheen, a Fresnel rim under a sky, a window reflection, saturated shadows — and mapped onto it. `crisp` lights a rim round the front with a clean edge, `smooth` lays a soft shadow and highlight over the whole form, `flat` keeps only the depth. The light itself is adjustable:

```tsx
<BotAvatar
  shadow={1.4}      // 0–2, strength of the shadow side (default 0.35)
  highlight={0.6}   // 0–2, strength of the lit side (default 1.3)
  light={315}       // degrees clockwise from the top (default 265, from the left)
  depth={1.5}       // 0.2–2, thickness shown when the head turns (default 0.65)
  rim={1.5}         // 0–2, Fresnel strength in plastic, rim width in crisp (default 0.5)
  spread={0.7}      // 0.4–2.5, width of the highlight in plastic, reach of the soft shading in smooth (default 1.55)
/>
```

## Other props

```tsx
<BotAvatar
  type="star"
  size={40}            // px, or any CSS length; default 64
  speed={1.5}          // multiplier on every animation
  paused={false}       // freeze on the current frame
  seed={0.3}           // 0–1: offsets the blink and glance loops; auto by default
  interactive={false}  // no pointer following, no hop on click
  aria-label="Talent scout, working"  // overrides the per-state default
/>
```

All other `<canvas>` props (`className`, `style`, `onClick`, `data-*`, …) pass through. The canvas draws a little larger than its box and pulls itself back with negative margins, so a hop or a flip is never clipped while the layout stays exactly `size` square.

## Drawing it yourself

The rig and the renderer are exported for custom uses — a filmstrip, a sprite sheet, another canvas:

```ts
import { BotAvatarSim, drawBotAvatarFrame, botAvatarShapes, botAvatarPresets, autoInk, BOT_AVATAR_OVERSCAN } from 'bot-avatars';

const sim = new BotAvatarSim(0.5, 'working');
sim.update(1 / 60); // advance a frame
drawBotAvatarFrame(ctx, 64, sim.pose, {
  path: new Path2D(botAvatarShapes.clover),
  ...botAvatarPresets.clover, // face, faceX, faceY, faceScale, color
  ink: autoInk(botAvatarPresets.clover.color),
  shading: true,
}); // on a canvas 64 * BOT_AVATAR_OVERSCAN px square
```

In `plastic` the first frame of a new type bakes its form (a few ms, done on idle time when an animation loop is running; the smooth look stands in until then). `warmBotAvatarPlastic(type, path, devicePx)` bakes ahead of time.

## Pointer play

By default an avatar's eyes and head follow a pointer that comes within a few head widths, and a click makes it hop and turn right round, in any state. Turn it off with `interactive={false}`; your own `onClick` still runs either way.

## A row of them

Each instance seeds its own blink timing from its React id, so a roster never blinks in unison. Pass the same `seed` to two avatars to make them move in step.

```tsx
{agents.map((a) => (
  <BotAvatar key={a.id} type={a.avatar} state={a.busy ? 'working' : 'default'} size={32} />
))}
```

## Accessibility & performance

- `role="img"` with a per-state `aria-label` ("Clover bot, working") out of the box.
- `prefers-reduced-motion: reduce` keeps the pose and drops the motion.
- One shared animation frame loop for every avatar on the page; each one pauses when scrolled offscreen or when the tab is hidden. Device-pixel-ratio capped at 2.
- The body is thirteen copies of its outline stacked through the depth with a pillow profile, projected with the head's yaw and pitch and lit from the upper left — a rounded solid that turns and flips, in plain 2D canvas fills. Cheap enough for a whole roster at once.
- Server rendering works: the canvas paints on the client, after mount.

## License

MIT © Jakub Antalik
