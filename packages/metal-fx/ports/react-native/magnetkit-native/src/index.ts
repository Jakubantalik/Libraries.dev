export { Magnet } from "./magnet";
export type { NativeMagnetFrame as MagnetFrame, NativeMagnetGesture as MagnetGesture, StoredMagnet } from "./MagnetKitModule";
export type { Pt } from "./core/types";
export { useMagnet, useMagnetFrame, useMagnetGestures } from "./hooks";
export { MagneticView, getMagneticField, type MagneticViewProps } from "./MagneticView";
export { MagnetCalibration, calibrate, type MagnetCalibrationProps } from "./MagnetCalibration";
export { DEFAULT_SPOTS, type CalibrationState, type CalibrationOptions } from "./core/calibration-core";
export { fitCalibration, type CalibrationFit, type CalibrationSpot } from "./core/fit";
export { MagneticField, Particle, type Box } from "./core/field";
