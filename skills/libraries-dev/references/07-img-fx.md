# Image

A React WebGL loader: a churning pixel-mosaic shader fills a card while an image is generated, then dissolves into the real image (npm `img-fx`).

## When to use

- Placeholder for an AI image generation result (text-to-image, image edit, avatar or thumbnail generation) while the request runs.
- A "Regenerate" flow: the shown image breaks back into pixels, churns, and the next image dissolves in.
- Gallery or grid tiles that wait on generated or slow-loading media, where a static skeleton reads too flat.
- Hero or marketing cards that loop between sample outputs to show "this product makes images" (`autoReveal`).
- A reveal moment after a long job completes (render, upscale, export preview).

### When not to use

- Ordinary photo lazy-loading on content pages. A blur-up or plain skeleton is cheaper and quieter.
- Text or list loading states. The effect is a square/rectangular media surface, not a line skeleton.
- Many dozens of tiles animating at once. All cards share one WebGL context and render one after another each frame.
- Non-React stacks. The package ships a React component only (the engine is exported, but there is no vanilla or custom-element wrapper).

## Install

```bash
npm install img-fx three
pnpm add img-fx three
yarn add img-fx three
```

```tsx
import { ImageGeneration } from 'img-fx';
```

- React component only. Peer dependencies: `react` >= 18, `react-dom` >= 18, `three` >= 0.149.0.
- ESM and CJS builds with types (`dist/index.es.js`, `dist/index.cjs.js`, `dist/index.d.ts`).
- The bundle has no `"use client"` directive. In the Next.js App Router, render it from your own file that starts with `"use client"`.
- The component uses `useLayoutEffect`, WebGL, `ResizeObserver` and `IntersectionObserver`. Everything GPU-side starts after mount, so server rendering outputs only the wrapper and the child.

## Basic usage

Install & Usage tab on the detail page:

```tsx
import { ImageGeneration } from 'img-fx';

<ImageGeneration
  preset="pixels-organic"
  images={['/img/a.jpg', '/img/b.jpg']}
  autoReveal
>
  <div className="card" style={{ width: 320, height: 320, borderRadius: 20 }} />
</ImageGeneration>
```

Snippet the playground builds from its controls (strength is only written when it is not 100%):

```tsx
import { ImageGeneration } from 'img-fx';

<ImageGeneration
  preset="pixels-mechanic"
  strength={0.60}
  images={['/images/gen-1.jpg', '/images/gen-2.jpg']}
>
  <div style={{ width: 280, height: 280, borderRadius: 20 }} />
</ImageGeneration>
```

The wrapped child is the card. The wrapper sizes itself to it, and takes its corner radius from the child's computed `border-top-left-radius`.

## Options (free)

| Prop | Values | Default | What it does |
| --- | --- | --- | --- |
| `preset` | `'pixels-organic'` \| `'pixels-mechanic'` \| `'sweep-gradient'` | `'pixels-organic'` | The effect. Organic: soft, cloud-like mosaic. Mechanic: sharper, grid-locked mosaic. Gradient Sweep: diagonal band sweeping top-left to bottom-right with per-cell flicker. |
| `strength` | `0` to `1` (tuner: 0-100%, step 1%) | `1` | Opacity of the effect canvas. The shader keeps animating at full speed; only its alpha scales. |
| `images` | `string` \| `string[]` | `[]` | Reveal pool. A random pick per reveal that never repeats the previous one. |
| `autoReveal` | `boolean` | `false` | Runs the loop on its own: shader, random 2-4 s wait, reveal, hold 2 s, fade back, repeat. |
| `paused` | `boolean` | `false` | Freezes the shader and the reveal scheduler (the playground's Play / Pause). |

Imperative actions (the playground's buttons), through a `ref` typed `ImageGenerationHandle`:

| Method | What it does |
| --- | --- |
| `triggerReveal()` | One pass: reveal, hold 2 s, hide. No-op while a reveal is running or `images` is empty. |
| `triggerReveal({ hold: 'manual' })` | Reveal and stay visible until `triggerHide()`. The playground's "Reveal image". |
| `triggerHide()` | Fade the revealed image back to the shader. No-op if nothing is revealed. |
| `triggerRegenerate({ durationMs })` | Only while an image is showing: it breaks into cells, churns for `durationMs` (default 4000, the playground uses 3000), then the next image dissolves in and stays. The churn is recoloured from the outgoing image. |
| `isImageActive()` | `true` while an image is revealing, visible or hiding. Use it to pick the button label. |

Tuner to prop mapping: "Type" tabs Organic / Mechanic / Gradient Sweep map to `preset` values `pixels-organic` / `pixels-mechanic` / `sweep-gradient`. The "Strength" slider shows percent; the prop is that value divided by 100 (`60%` becomes `strength={0.60}`). "Play" / "Pause" maps to `paused`. "Reveal image" / "Hide image" and "Regenerate" are ref calls, not props.

## Recipes

Generated image result. Use when: a text-to-image request is in flight and the URL arrives later.

```tsx
import { useEffect, useRef } from 'react';
import { ImageGeneration, type ImageGenerationHandle } from 'img-fx';

export function GeneratedImage({ src }: { src: string | null }) {
  const ref = useRef<ImageGenerationHandle>(null);
  useEffect(() => {
    if (src) ref.current?.triggerReveal({ hold: 'manual' });
  }, [src]);
  return (
    <ImageGeneration ref={ref} preset="pixels-organic" images={src ? [src] : []}>
      <div style={{ width: 384, height: 384, borderRadius: 16 }} />
    </ImageGeneration>
  );
}
```

Regenerate button. Use when: the user can ask for another take on a shown image.

```tsx
import { useRef } from 'react';
import { ImageGeneration, type ImageGenerationHandle } from 'img-fx';

export function Variants({ variants }: { variants: string[] }) {
  const ref = useRef<ImageGenerationHandle>(null);
  return (
    <>
      <ImageGeneration ref={ref} preset="pixels-mechanic" images={variants}>
        <div style={{ width: 320, height: 320, borderRadius: 20 }} />
      </ImageGeneration>
      <button onClick={() => ref.current?.triggerReveal({ hold: 'manual' })}>Show</button>
      <button onClick={() => ref.current?.triggerRegenerate({ durationMs: 3000 })}>Regenerate</button>
    </>
  );
}
```

Quiet tile placeholder. Use when: a grid of media tiles waits on data and should not shout.

```tsx
<ImageGeneration preset="sweep-gradient" strength={0.5}>
  <div style={{ width: 240, height: 160, borderRadius: 12 }} />
</ImageGeneration>
```

Looping showcase card. Use when: a landing page hero should demo generated outputs on its own.

```tsx
<ImageGeneration preset="pixels-organic" images={['/samples/1.jpg', '/samples/2.jpg', '/samples/3.jpg']} autoReveal>
  <div style={{ width: 480, height: 320, borderRadius: 24 }} />
</ImageGeneration>
```

Only animate while working. Use when: the card stays mounted after the job ends.

```tsx
<ImageGeneration preset="pixels-mechanic" paused={!isGenerating}>
  <div style={{ width: 320, height: 320, borderRadius: 20 }} />
</ImageGeneration>
```

## Accessibility & performance

- Both canvases are `aria-hidden="true"`. The wrapper `<div>` has no role. It forwards any HTML attribute, so add `role="img"` and an `aria-label` (for example "Generating image"), or `aria-busy={isGenerating}`, on `<ImageGeneration>` itself.
- The revealed image is painted into a canvas, not an `<img>`. It has no alt text. If the result matters to screen readers, render a visually hidden description or an `<img>` elsewhere.
- No `prefers-reduced-motion` handling in the package. Do it yourself: `paused={prefersReducedMotion}` (read `matchMedia('(prefers-reduced-motion: reduce)')`).
- One shared `THREE.WebGLRenderer` and one WebGL context for the whole page. Each card copies its frame into its own 2D canvas.
- Frame rate is capped at 10 fps. The GL canvas renders at a device-pixel-ratio cap of 1.25; the visible canvas is capped at 2.
- Cards pause when offscreen (`IntersectionObserver`, 64px margin). When no card is active the animation loop stops completely.
- WebGL context loss is handled: the loop stops and resumes on restore.
- Decoded images are cached by URL across all cards. Images draw like `object-fit: cover`, centre-cropped.
- `strength` below 1 is a CSS opacity change on the canvas: no shader cost difference.

## Common mistakes

- Child without a size. The wrapper is `inline-block` and sizes to the child. A child with no width or height gives a 1px card and nothing visible.
- Forgetting `three`. It is a peer dependency: install `img-fx three` together.
- Calling `triggerReveal()` with an empty `images` list. It is a silent no-op. Set `images` first; the example above triggers from an effect after `src` changes.
- Expecting `triggerRegenerate()` to work from the idle shader. It only runs while an image is revealed.
- Per-corner radii. One radius is read from the child's top-left corner and applied to all four.
- Cross-origin images without CORS headers. They still reveal, but Regenerate cannot sample their colours and falls back to the preset palette. Serve images same-origin or with CORS.
- Server rendering in light mode. The effect follows the page theme (`<html data-theme>`, `.dark` / `.light` class, `color-scheme`, then the OS setting) and assumes dark on the server. On light pages, render the card client-only to avoid a dark first frame and attribute mismatch.

## Detecting a fit in a codebase

| Signal to grep for | Suggest |
| --- | --- |
| Image generation APIs: `images.generate`, `dall-e`, `gpt-image`, `replicate`, `fal.ai`, `@fal-ai`, `stability`, `flux`, `midjourney` | Wrap the result slot in `<ImageGeneration>` and `triggerReveal({ hold: 'manual' })` when the URL arrives. |
| Copy like "Generating image", "Creating your image", "Rendering…", `isGenerating`, `status === 'generating'` | The generated-image recipe, `paused={!isGenerating}` if the card persists. |
| Buttons labelled "Regenerate", "Try again", "Variations", "Reroll" next to an image | `triggerRegenerate({ durationMs: 3000 })` on that button. |
| `animate-pulse`, `<Skeleton`, `shimmer`, `aspect-square bg-muted` on image containers | Replace the skeleton with `preset="sweep-gradient"` and `strength={0.5}` for a quieter loader. |
| Spinners (`<Spinner`, `Loader2`, `animate-spin`) centred over an image or canvas area | Replace with the mosaic on the image box itself. |
| Hero sections cycling sample outputs, carousels of "made with" images | `autoReveal` with those samples in `images`. |
| Avatar, thumbnail or cover generators (`generateAvatar`, `generateThumbnail`, `cover-art`) | Same as the generated-image recipe, sized to the avatar or cover box. |

## Go further (Pro)

- Animation speed and pixel-cell size.
- Palette re-tints (Ocean, Ember, Mono) and the card background colour the shader reasons against.
- A stronger-than-default intensity range.
- Rebuilding the effect's shader (cell shape, mosaic layout, colour field) through the agent.

Tune it visually in the Studio at https://libraries.dev/studio, or install the Pro skill.
