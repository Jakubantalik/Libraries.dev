/* Playground: a header that feels the magnet. On an Android phone with the
   Magnet Bridge app, tap Connect; on a desktop, ?sim lets the pointer play
   the magnet (press and hold beside the header). */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MagnetCalibration, simulateMagnetWithPointer, useMagnet, useMagnetBridge, useMagnetGestures, useMagneticPull } from "../src";

function App() {
  const { state, device, calibrated, connect } = useMagnetBridge();
  const frame = useMagnet();
  const header = useRef<HTMLDivElement>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [lastGesture, setLastGesture] = useState("–");
  useMagneticPull(header);
  useMagnetGestures((g) => setLastGesture(g.g));
  useEffect(() => (new URLSearchParams(location.search).has("sim") ? simulateMagnetWithPointer() : undefined), []);

  const pill = { display: "inline-block", padding: "8px 14px", borderRadius: 999, background: "#2a2a2a" } as const;
  return (
    <div style={{ padding: 16 }}>
      <div ref={header} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "12px 0" }}>
        <b data-magnetic style={{ fontSize: 18 }}>Libraries</b>
        <span data-magnetic style={pill}>Docs</span>
        <span data-magnetic style={pill}>Studio</span>
        <span data-magnetic style={{ ...pill, background: "#1f3b75" }}>Get Pro</span>
      </div>
      <h1 data-magnetic style={{ margin: "24px 0 8px" }}>Magnetic UI</h1>
      <p style={{ color: "#9a9a9a" }}>Hold a magnet beside the phone.</p>
      <p>Bridge: {state}{device ? ` · ${device}` : ""} · {calibrated ? "calibrated" : "not calibrated"}</p>
      <p>Field: {frame ? `${frame.strength.toFixed(0)} µT` : "–"} · gesture: {lastGesture}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => connect()}>Connect</button>
        <button onClick={() => setCalibrating(true)} disabled={state !== "open"}>Calibrate</button>
      </div>
      <MagnetCalibration open={calibrating} onClose={() => setCalibrating(false)} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
