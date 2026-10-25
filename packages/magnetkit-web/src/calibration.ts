/* Calibration through the bridge: the magnet held still over a few spots
   on the screen, fitted to the magnet's face, strength and the sensor's
   spot, then handed to the phone. Render the rings yourself from
   `onUpdate`, or use <MagnetCalibration>. */

import type { MagnetBridge } from "./bridge";
import { runCalibration, type CalibrationOptions } from "./calibration-core";

export { DEFAULT_SPOTS, type CalibrationState, type CalibrationOptions } from "./calibration-core";

/** Runs a calibration; resolves with the fit (already sent to the phone), or null. */
export function calibrate(bridge: MagnetBridge, opts: CalibrationOptions = {}) {
  return runCalibration(
    {
      zero: () => bridge.zero(),
      addFrameListener: (l) => bridge.addFrameListener(l),
      setMagnet: (fit) => bridge.setMagnet(fit),
      viewport: () => ({ x: innerWidth, y: innerHeight }),
      toScreen: (p) => bridge.toScreen(p),
      screenSize: () => {
        const h = bridge.hello;
        return h ? { x: h.screenDp[0], y: h.screenDp[1] } : { x: screen.width, y: screen.height };
      },
      // Android dp: 160 per inch.
      pointsPerCm: 160 / 2.54,
    },
    opts,
  );
}
