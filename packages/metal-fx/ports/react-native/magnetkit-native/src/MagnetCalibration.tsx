/* Calibration: the magnet held still over five rings, fitted to its face,
   strength and where the sensor sits, kept on the phone across launches.
   `calibrate()` runs it headless; <MagnetCalibration> is a ready-made
   full-screen version. */

import { useEffect, useRef, useState } from "react";
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { runCalibration, type CalibrationOptions, type CalibrationState } from "./core/calibration-core";
import { Magnet } from "./magnet";

/** Runs a calibration; resolves with the fit (already kept by the phone), or null. */
export function calibrate(opts: CalibrationOptions = {}) {
  const screen = Magnet.screen();
  return runCalibration(
    {
      zero: () => { Magnet.zero(); },
      addFrameListener: (l) => Magnet.addFrameListener(l),
      setMagnet: (fit) => { Magnet.setMagnet(fit); },
      viewport: () => {
        const w = Dimensions.get("window");
        return { x: w.width, y: w.height };
      },
      // The window is the screen (edge to edge), as the readings measure it.
      toScreen: (p) => p,
      screenSize: () => ({ x: screen.width, y: screen.height }),
      pointsPerCm: screen.pointsPerCm,
    },
    opts,
  );
}

export type MagnetCalibrationProps = {
  visible: boolean;
  /** true when a calibration was kept. */
  onClose?: (ok: boolean) => void;
};

/** A ready-made calibration screen: five rings, full screen, cancel button. */
export function MagnetCalibration({ visible, onClose }: MagnetCalibrationProps) {
  const [s, setS] = useState<CalibrationState | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const cancelRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!visible) return;
    const run = calibrate({ onUpdate: setS });
    cancelRef.current = run.cancel;
    run.promise.then((fit) => closeRef.current?.(!!fit));
    return () => run.cancel();
  }, [visible]);

  const open = visible && !!s && s.phase !== "done" && s.phase !== "cancelled";
  const spot = s?.spot ?? null;
  const win = Dimensions.get("window");
  const msg = !s ? "" : s.phase === "zeroing" ? "Keep the magnet away for a moment…"
    : s.phase === "failed" ? "That didn't fit. Try again, holding the magnet still over each ring."
    : `Ring ${s.index + 1} of ${s.total}: hold the magnet 1–2 cm above it and keep it still.`;
  const diag = !s ? "" : s.field == null ? "No readings yet." : `${s.field.toFixed(0)} µT${s.zeroing ? " · zeroing" : ""}`;

  return (
    <Modal visible={open} transparent animationType="fade" statusBarTranslucent navigationBarTranslucent onRequestClose={() => cancelRef.current()}>
      <View style={styles.root}>
        {spot && (
          <View style={[styles.ring, { left: spot.x - 36, top: spot.y - 36 }]}>
            <View style={[styles.fill, { transform: [{ scale: s?.progress ?? 0 }] }]} />
          </View>
        )}
        <Text style={[styles.msg, { top: spot ? (spot.y < win.height / 2 ? spot.y + 64 : spot.y - 120) : win.height * 0.4 }]}>{msg}</Text>
        <Text style={styles.diag}>{diag}</Text>
        <Pressable onPress={() => cancelRef.current()} style={styles.cancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)" },
  ring: { position: "absolute", width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: "#fff" },
  fill: { position: "absolute", left: 7, top: 7, right: 7, bottom: 7, borderRadius: 30, backgroundColor: "#4f9cff" },
  msg: { position: "absolute", left: 16, right: 16, color: "#fff", fontSize: 16, lineHeight: 24, fontWeight: "500", textAlign: "center" },
  diag: { position: "absolute", left: 16, right: 16, bottom: 88, color: "#9a9a9a", fontSize: 13, lineHeight: 18, textAlign: "center" },
  cancel: { position: "absolute", alignSelf: "center", bottom: 32, height: 40, paddingHorizontal: 18, borderRadius: 999, backgroundColor: "#2a2a2a", justifyContent: "center" },
  cancelText: { color: "#fff", fontSize: 14, fontWeight: "500" },
});
