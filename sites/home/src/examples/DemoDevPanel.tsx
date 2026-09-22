import { useEffect, useState } from "react";

/* Dev-only switches for shooting the demo rows: drop the cards' fill and
   the labels under the avatars, so a clip or a still carries the effect
   alone. Localhost or ?dev only, and it writes nothing but two
   attributes on <html>, which examples.css reads. */

export const SHOW_DEMO_DEV =
  typeof location !== "undefined" &&
  (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ||
    new URLSearchParams(location.search).has("dev"));

type Flag = { key: "demoFill" | "demoNames"; attr: string; label: string; hint: string };

const FLAGS: Flag[] = [
  { key: "demoFill", attr: "data-demo-fill", label: "Card fill", hint: "the panels behind the demos" },
  { key: "demoNames", attr: "data-demo-names", label: "Names", hint: "the labels under the avatars" },
];

export function DemoDevPanel() {
  const [on, setOn] = useState<Record<string, boolean>>({ demoFill: true, demoNames: true });
  const [open, setOpen] = useState(false);

  /* the attributes live on <html>, so the CSS can reach every row */
  useEffect(() => {
    for (const f of FLAGS) {
      document.documentElement.setAttribute(f.attr, on[f.key] ? "on" : "off");
    }
    return () => {
      for (const f of FLAGS) document.documentElement.removeAttribute(f.attr);
    };
  }, [on]);

  if (!SHOW_DEMO_DEV) return null;
  if (!open) {
    return (
      <button type="button" className="gdev-fab" onClick={() => setOpen(true)}>
        Demo
      </button>
    );
  }
  return (
    <div className="gdev" role="group" aria-label="Demo controls">
      <div className="gdev-head">
        <span className="gdev-title">Demo</span>
        <div className="gdev-actions">
          <button type="button" className="gdev-btn" onClick={() => setOn({ demoFill: true, demoNames: true })}>
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
            onClick={() => setOn((v) => ({ ...v, [f.key]: !v[f.key] }))}
          >
            {on[f.key] ? "Shown" : "Hidden"}
          </button>
        </div>
      ))}
      <p className="gdev-hint">Local only: the shipped page never sees these.</p>
    </div>
  );
}
