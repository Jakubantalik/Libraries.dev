# magnetkit

Magnetic UI for React on the web: a real magnet beside an Android phone
pulls your interface. Browsers can't read the raw magnetometer, so the
[Magnet Bridge app](https://libraries.dev/downloads/MagnetBridge.apk) runs
the on-device magnet model on the phone and serves its answers to the sites
you allow; this package talks to it and turns the readings into motion.

Docs and live demo: https://libraries.dev/magnetic

## Install

```sh
npm install magnetkit
```

React 18+. Your site ships no model file.

## Use

```tsx
import { useRef, useState } from "react";
import { MagnetCalibration, useMagnetBridge, useMagnetGestures, useMagneticPull } from "magnetkit";

export function Header() {
  const ref = useRef<HTMLElement>(null);
  const { state, connect, calibrated } = useMagnetBridge();
  const [calibrating, setCalibrating] = useState(false);

  useMagneticPull(ref);   // everything marked data-magnetic is pulled and springs back
  useMagnetGestures((g) => { if (g.g === "tap") openMenu(); });

  return (
    <header ref={ref}>
      <a data-magnetic href="/">Home</a>
      <a data-magnetic href="/docs">Docs</a>
      {state !== "open" ? <button onClick={connect}>Connect magnet</button>
        : !calibrated ? <button onClick={() => setCalibrating(true)}>Calibrate</button> : null}
      <MagnetCalibration open={calibrating} onClose={() => setCalibrating(false)} />
    </header>
  );
}
```

- `useMagnet()` gives the latest reading as state; `useMagnetFrame(cb)` every
  reading without rendering. Positions are screen dp:
  `getMagnetBridge().toClient(p)` turns them into page px.
- `calibrate(bridge, { onUpdate })` runs a calibration headless.
- `simulateMagnetWithPointer()` lets the pointer play the magnet while you
  develop without a phone.
- `MagneticField` is the physics on its own, for canvas or anything else.

Visitors need the Magnet Bridge app on an Android phone (Android 10+): they
tap Start bridge, then connect from your page. Android Chrome asks once to
allow local network access. iPhone browsers can't take part.

## License

MIT. The model runs inside the Magnet Bridge app.
