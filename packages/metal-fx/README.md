# metal-fx

Animated WebGL "liquid metal" effect for React. Wrap a button, chip, or icon and it gets a real-time metal ring with optional proximity reflection on neighbouring elements.

[Live demo](https://metal.jakubantalik.com) · [Repository](https://github.com/Jakubantalik/metal-fx) · [Report an issue](https://github.com/Jakubantalik/metal-fx/issues)

## v2

v2 replaces the plasma shader with [Paper Shaders'](https://github.com/paper-design/shaders) `liquidMetal` (Apache-2.0, see `NOTICE`) and adds:

- `MetalText` — metal inside the glyphs of any text, with an inner-shadow rim.
- `MetalBadge` — the "New" pill: white fill, metal rim, clean core under the label.
- `useMetalBend(ref)` — cursor-driven liquid dent of the ring (spring physics, vector outline).
- `useMetalTextReflection(ref)` — a neighbouring text catches the metal on its letterforms.
- `innerShadow` prop — light rim along the ring's top inside edge.
- Cursor light — the ring lights the pointer (`setCursorSprite`, `setCursorLightConfig`); opt-in, macOS sprite required.
- Baked-sprite glow: ~10× cheaper than v1's SVG filters, same look.
- Live-tunable `GLOW`, `REFLECTION_OCCLUDER` and `CURSOR_LIGHT` configs.

Requires WebGL2 (`isMetalFxSupported()`); unsupported browsers render the plain child. Presets, variants and the `MetalFx` props from v1 are unchanged. To stay on the old engine: `npm install metal-fx@1`.

## Install

```bash
npm install metal-fx
```

## Quick start

```tsx
import { MetalFx } from 'metal-fx';

function App() {
  return (
    <MetalFx variant="button">
      <button className="upgrade-pill">Upgrade to Pro</button>
    </MetalFx>
  );
}
```

The component wraps a single child host element, measures it, and paints an animated metal ring on top. The child stays fully interactive — overlays sit above it with `pointer-events: none`.

## Variants

```tsx
<MetalFx variant="button">  {/* Pill silhouette, 1 px ring, scale 1.6 */}
  <button>Upgrade to Pro</button>
</MetalFx>

<MetalFx variant="circle">  {/* Compact circle, 2 px ring, scale 1.3 */}
  <button>↑</button>
</MetalFx>
```

## Presets

Three bundled palettes, each with a tuned dark and light mode block:

```tsx
<MetalFx preset="chromatic" />  {/* Iridescent rainbow (default) */}
<MetalFx preset="silver" />     {/* Cool steel */}
<MetalFx preset="gold" />       {/* Warm gold */}
```

## Theme

```tsx
<MetalFx theme="auto" />    {/* Follows prefers-color-scheme (default) */}
<MetalFx theme="dark" />    {/* Pin to dark backgrounds */}
<MetalFx theme="light" />   {/* Pin to light backgrounds */}
```

`auto` reads the OS / browser theme on mount and subscribes to live changes via `matchMedia('(prefers-color-scheme: dark)')`, so the metal frame switches over instantly when the user toggles their system theme. SSR-safe — the initial render falls back to `dark` and rehydrates to the resolved theme on the client.

If your app has its own theme toggle that doesn't follow the OS, drive `theme` from your app state instead:

```tsx
const appTheme = useAppTheme(); // 'dark' | 'light'
<MetalFx theme={appTheme}>...</MetalFx>
```

## Strength

```tsx
<MetalFx strength={0.7}>  {/* 70% effect intensity */}
  <button>Upgrade to Pro</button>
</MetalFx>
```

`strength` runs from `0` (invisible) to `1` (full, default). It scales the canvas and glow opacity without changing the underlying shader animation.

## Paused

```tsx
<MetalFx paused>
  <button>Upgrade to Pro</button>
</MetalFx>
```

Freezes the shader on its current frame. The metal silhouette stays visible.

## Proximity reflection (dark mode only)

Pass refs to neighbouring elements and they receive a soft, mirrored reflection of the metal ring:

```tsx
const sendRef = useRef<HTMLButtonElement>(null);
const chipRef = useRef<HTMLButtonElement>(null);

<>
  <button ref={chipRef}>Tools</button>
  <MetalFx variant="circle" reflectionTargets={[chipRef]}>
    <button ref={sendRef} aria-label="Send">↑</button>
  </MetalFx>
</>
```

Reflections are skipped automatically when the resolved theme is `light` — no DOM scanning, no per-frame work in light mode.

## Performance

- One shared WebGL context is reused across every mounted `<MetalFx>` on the page. The shader is compiled once.
- A single `requestAnimationFrame` loop drives every instance. Per-frame work for one mount: a `gl.drawArrays` plus N×`drawImage` copies (one per visible instance).
- `IntersectionObserver` pauses per-instance copies when the host scrolls offscreen. When every instance is offscreen the GL render is skipped too.
- `ResizeObserver` callbacks are debounced through RAF.
- The GL context, program, and buffer are released when the last `<MetalFx>` unmounts.

## Server-side rendering

The component renders a transparent placeholder during SSR and only mounts the WebGL pipeline after hydration on the client. No flash of broken effect, no SSR errors.

## Sizing

`MetalFx` does not force any dimensions onto the wrapped child — the wrapper sizes itself to whatever the child renders. Style your child the way you normally would (intrinsic content, CSS class, or inline style):

```tsx
// Pattern 1 (recommended): size the child.
<MetalFx variant="circle">
  <button style={{ width: 36, height: 36 }} aria-label="Send">↑</button>
</MetalFx>

<MetalFx>
  <button className="rounded-full px-6 h-10">Upgrade to Pro</button>
</MetalFx>
```

If you want a metal frame larger than the child (e.g. padding around an icon), size the wrapper instead and explicitly stretch the child to fill:

```tsx
// Pattern 2: size the wrapper, child fills.
<MetalFx style={{ width: 36, height: 36 }} variant="circle">
  <button style={{ width: '100%', height: '100%' }} aria-label="Send">↑</button>
</MetalFx>
```

Both patterns work; pick whichever fits your layout. The wrapper is `display: inline-flex` so it lays out inline like a button.

## Custom border radius

By default `MetalFx` reads the computed `border-radius` of the wrapped child each resize. Pass an explicit override when needed:

```tsx
<MetalFx borderRadius={20}>
  <button>Upgrade to Pro</button>
</MetalFx>
```

## License

MIT &copy; [Jakub Antalik](https://github.com/Jakubantalik). See [LICENSE](./LICENSE).
