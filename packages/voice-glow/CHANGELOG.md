# Changelog

## 0.2.0

- First public release, as `voice-glow` (a `voice-beam` 0.1.0 was withdrawn before launch).
- Half-resolution soft layers on every engine through an explicit per-layer length factor, so Safari 18 rasters them at half size with the right geometry.
- The distortion filter's region follows the band line (Chromium, Firefox); WebKit keeps the full region, where its noise is anchored to the region.
- The 1px edge stroke stays full-resolution on dense screens.
- `paused` holds the frame; `coreLight` brightens the epicentre (the light theme uses it); `processingCurve` shapes the travelling beam's ease.

## 0.1.0

- Initial release: `VoiceBeam` component, `useMicrophone` hook, eight color variants, dark / light / auto themes.
- The distortion is dropped while `processing`: it settles out in about a quarter second, and once gone its layers leave the paint (`data-voice-warp="off"` on the wrapper) until processing ends.
