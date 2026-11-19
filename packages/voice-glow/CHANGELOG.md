# Changelog

## 0.5.0

- **Breaking:** the mosaic, dots and lines looks moved to Libraries Pro. Built in are `look="glow"` and `look="dither"`; the Pro skill adds `mosaic`, `dots` and `lines` as look objects (`look={mosaic}`). An unknown look name (`look="mosaic"`) draws the glow and warns once.
- Looks plug in: `look` also takes a `VoiceLook` object, either a pixel look painted on the dither's engine (sampling, colour, magnet, dust, flying pixels) or a surface look that owns its canvas. New types: `VoiceLook`, `VoicePixelLook`, `VoicePixelKit`, `VoiceSurfaceLook`, `VoiceSurfaceFrame`, `VoiceLookConfig`.
- `resolveVoiceDefaults` takes a look object as well as a name.
- Removed: `VOICE_SURFACE_LOOKS` and the `VOICE_SURFACE` build switch.

## 0.4.0

- Four more looks, alongside `look="glow"`: `"mosaic"` and `"dither"` sample the glow itself onto a grid of glyphs or dithered pixels (same palette, flow and hue drift), and `"dots"` and `"lines"` draw the voice as a domed sheet it raises and gravity brings down. See [Looks](README.md#looks).
- The pixel looks' props: `pixelSize`, `pixelGlow`, `pixelDust` (the processing beam's trail), `pixelDome`, `pixelMagnet` (pixels fly toward the pointer) and `pixelExitTarget` (pixels fly into and out of a button as `active` changes).
- `tint` / `tintAmount`: colour the dots' and lines' ink, e.g. with a mood.
- New exports: `pixelGlowDefault`, `pixelDustDefault`, `pixelDomeDefault`, and `VOICE_SURFACE_LOOKS` (true).

## 0.3.0

- **Breaking:** the processing state moved to Libraries Pro. `processing`, `processingDuration`, `processingLevel`, `processingEase`, `processingTravel`, `processingCurve` and `cornerFollow` are gone, and the wrapper no longer carries `data-processing`.
- New `motion` prop (a value or a per-frame getter, type `VoiceBeamMotion`): gathers the lobes into one beam, places it, holds the glow's level and rides the corners. Pro's `useVoiceProcessing` drives it to give the processing sweep.

## 0.2.0

- First public release, as `voice-glow` (a `voice-beam` 0.1.0 was withdrawn before launch).
- Half-resolution soft layers on every engine through an explicit per-layer length factor, so Safari 18 rasters them at half size with the right geometry.
- The distortion filter's region follows the band line (Chromium, Firefox); WebKit keeps the full region, where its noise is anchored to the region.
- The 1px edge stroke stays full-resolution on dense screens.
- `paused` holds the frame; `coreLight` brightens the epicentre (the light theme uses it); `processingCurve` shapes the travelling beam's ease.

## 0.1.0

- Initial release: `VoiceBeam` component, `useMicrophone` hook, eight color variants, dark / light / auto themes.
- The distortion is dropped while `processing`: it settles out in about a quarter second, and once gone its layers leave the paint (`data-voice-warp="off"` on the wrapper) until processing ends.
