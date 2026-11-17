/* Distortion waves — the wave's timeline, a port of DistortionWaveStyle and
   DistortionWaveTimeline from the DistortionWavesKit Swift package.

   It lives in the distortion-waves package now, where the React component
   draws from it too: the phone preview, the desktop demo and the SwiftUI
   library all move by the same numbers. This file only passes it on. */

export {
  bezierEase,
  COVER_ZONE,
  defaultStyle,
  duration,
  hexToRgb,
  LUMPS,
  makeParticles,
  PALETTES,
  particleAt,
  rgbToHex,
  rimLumps,
  singlePalette,
  smooth,
  waveFront,
} from "distortion-waves";
export type { Front, Palette, PaletteName, Particle, Point, Rect, RGB, WaveStyle, WaveType } from "distortion-waves";
