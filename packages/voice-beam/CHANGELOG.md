# Changelog

## 0.1.0

- Initial release: `VoiceBeam` component, `useMicrophone` hook, eight color variants, dark / light / auto themes.
- The distortion is dropped while `processing`: it settles out in about a quarter second, and once gone its layers leave the paint (`data-voice-warp="off"` on the wrapper) until processing ends.
