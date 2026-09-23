import { useEffect, useState } from "react";
import { demoFlags, useDemoFlag, type DemoFlagKey } from "./demoFlags";

/* Dev-only switches for shooting the demo rows: drop the cards' fill and
   the labels under the avatars so a clip or a still carries the effect
   alone, and unlock the team row so the avatars can be dragged into
   whatever arrangement the shot wants. Localhost or ?dev only. */

/* The dev machine: loopback, a private address on the LAN (the phone
   reads the site that way), a .local name, or an explicit ?dev. The
   public site matches none of these. */
export const SHOW_DEMO_DEV =
  typeof location !== "undefined" &&
  (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ||
    /^10\./.test(location.hostname) ||
    /^192\.168\./.test(location.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(location.hostname) ||
    /\.local$/.test(location.hostname) ||
    new URLSearchParams(location.search).has("dev"));

type Flag = { key: DemoFlagKey; label: string; on: string; off: string; hint: string };

const FLAGS: Flag[] = [
  { key: "fill", label: "Card fill", on: "Shown", off: "Hidden", hint: "the panels behind the demos" },
  { key: "names", label: "Names", on: "Shown", off: "Hidden", hint: "the labels under the avatars" },
  {
    key: "arrange",
    label: "Arrange",
    on: "Draggable",
    off: "Locked",
    hint: "drag the avatars around the team row; Reset puts them back",
  },
];

export function DemoDevPanel() {
  const [open, setOpen] = useState(false);
  /* one subscription per switch, so the panel redraws with the store */
  const fill = useDemoFlag("fill");
  const names = useDemoFlag("names");
  const arrange = useDemoFlag("arrange");
  const on: Record<DemoFlagKey, boolean> = { fill, names, arrange };

  /* the attributes belong on <html>, where the CSS can reach every row */
  useEffect(() => {
    demoFlags.set("fill", demoFlags.read("fill"));
    demoFlags.set("names", demoFlags.read("names"));
    return () => {
      for (const f of FLAGS) document.documentElement.removeAttribute(`data-demo-${f.key}`);
    };
  }, []);

  if (!SHOW_DEMO_DEV) return null;
  if (!open) {
    return (
      <button type="button" className="gdev-fab gdev-fab--demo" onClick={() => setOpen(true)}>
        Demo
      </button>
    );
  }
  return (
    <div className="gdev" role="group" aria-label="Demo controls">
      <div className="gdev-head">
        <span className="gdev-title">Demo</span>
        <div className="gdev-actions">
          <button type="button" className="gdev-btn" onClick={() => demoFlags.reset()}>
            Reset
          </button>
          <button type="button" className="gdev-btn" onClick={() => setOpen(false)}>
            Hide
          </button>
        </div>
      </div>
      {FLAGS.map((f) => (
        <div className="gdev-row" key={f.key}>
          <div className="gdev-row-head">
            <span title={f.hint}>{f.label}</span>
          </div>
          <button
            type="button"
            className="gdev-btn"
            aria-pressed={on[f.key]}
            data-on={on[f.key] ? "true" : undefined}
            onClick={() => demoFlags.set(f.key, !on[f.key])}
          >
            {on[f.key] ? f.on : f.off}
          </button>
        </div>
      ))}
      <p className="gdev-hint">Local only: the shipped page never sees these.</p>
    </div>
  );
}
