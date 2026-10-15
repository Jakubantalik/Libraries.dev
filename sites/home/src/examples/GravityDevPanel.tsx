import { useEffect, useMemo, useState } from "react";
import { GRAVITY_DEFAULTS, getGravityStatus, resetGravity, setGravityConfig, type GravityOptions } from "thinking-orbs";
import { DevCopy } from "./DevCopy";

/* Dev-only tuning panel for Gravity. Writes into the library's live
   tuning override (setGravityConfig), which every orb on the page reads
   each frame — so a slider moves the effect under the pointer as you drag
   it. Shows on localhost or with ?dev in the URL; never in the shipped
   page otherwise. The code line at the bottom is the options object to
   paste into `gravity={{ … }}` once a feel is found. */

type Key = keyof Required<Omit<GravityOptions, "sprite">>;
type Row = [Key, string, number, number, number, string];

const ROWS: Row[] = [
  ["reach", "Reach", 16, 320, 4, "px outside the edge where the pull starts"],
  ["strength", "Tail", 0, 48, 1, "px the pointer trails toward the orb on contact — the pointer itself never moves"],
  ["deform", "Bend", 0, 24, 0.5, "px the body leans toward the orb on contact — the tip stays pinned"],
  ["taper", "Taper", 1, 4, 0.05, "1 bends evenly from the tip out; higher keeps the tip end firm and bends the far end hardest"],
  ["curve", "Curve", 1, 4, 0.05, "how late the pull builds — higher stays whole until close"],
  ["falloff", "Falloff", 2, 120, 2, "px band across the pointer over which the tail fades from the facing side to the far side — small keeps it to the facing edge, large lets the whole body trail"],
  ["smoothing", "Inertia", 0, 1, 0.01, "lag of the deformation — 0 instant, higher heavier"],
  ["handover", "Handover", 0, 1, 0.01, "how slowly the pull swings to the next orb when the nearest changes — 0 flips, higher glides"],
  ["squash", "Squash", 0, 3, 0.05, "extra bend and tail when the orb is off the tip's side (up-left), where the pull shortens the body — evens it with the stretch from the other side"],
  ["blur", "Blur", 0, 24, 0.5, "px of progressive blur along the tail — crisp at the pointer, this soft at the far end"],
  ["fadeMs", "Fade", 0, 600, 10, "ms envelope on enter / leave"],
];

function serialize(cfg: Record<Key, number>): string {
  const parts: string[] = [];
  for (const [k] of ROWS) if (cfg[k] !== GRAVITY_DEFAULTS[k]) parts.push(`${k}: ${cfg[k]}`);
  return parts.length ? `gravity={{ sprite: macArrow, ${parts.join(", ")} }}` : "gravity={{ sprite: macArrow }}  // defaults";
}

export function GravityDevPanel({
  enabled,
  onToggle,
  available,
}: {
  /** The page's Gravity switch, mirrored here so the panel is self-contained. */
  enabled: boolean;
  onToggle: (on: boolean) => void;
  /** Whether this platform's pointer raster is bundled (macOS only today). */
  available: boolean;
}) {
  const [cfg, setCfg] = useState<Record<Key, number>>(() => ({ ...GRAVITY_DEFAULTS }));
  const [open, setOpen] = useState(true);
  /* Polled, not evented: the reasons the swap can be refused (reduced
     motion, zoom, a slow frame) change outside React's view. */
  const [status, setStatus] = useState(() => getGravityStatus());
  useEffect(() => {
    const t = setInterval(() => setStatus(getGravityStatus()), 400);
    return () => clearInterval(t);
  }, []);
  const set = (k: Key, v: number) => {
    const next = { ...cfg, [k]: v };
    setCfg(next);
    setGravityConfig(next);
  };
  const reset = () => {
    setCfg({ ...GRAVITY_DEFAULTS });
    setGravityConfig(null);
  };
  const code = useMemo(() => serialize(cfg), [cfg]);

  if (!open) {
    return (
      <button type="button" className="gdev-fab" onClick={() => setOpen(true)}>Cursor gravity dev</button>
    );
  }
  return (
    <aside className="gdev" aria-label="Gravity tuning (dev only)">
      <header className="gdev-head">
        <span className="gdev-title">Gravity · dev</span>
        <span className="gdev-actions">
          <button type="button" className="gdev-btn" aria-pressed={enabled} data-on={enabled ? "true" : undefined} onClick={() => onToggle(!enabled)}>
            {enabled ? "On" : "Off"}
          </button>
          <button type="button" className="gdev-btn" onClick={reset}>Reset</button>
          <button type="button" className="gdev-btn" onClick={() => setOpen(false)} aria-label="Close">×</button>
        </span>
      </header>
      <p className="gdev-hint">Bring the pointer near an orb. Values apply live to every orb on the page.</p>
      <p className="gdev-status" data-state={!available ? "off" : status.active ? "active" : status.blockedBy ? "blocked" : "armed"}>
        {!available
          ? "Off: the bundled pointer is the macOS arrow, and this is not a Mac."
          : !enabled
            ? "Off — switch it on above."
            : status.active
              ? "Active — pointer is in the well."
              : status.blockedBy
                ? `Not running: ${status.blockedBy}.`
                : "Armed — move the pointer near the orb."}
        {available && enabled && status.blockedBy && /^disabled/.test(status.blockedBy) && (
          <>
            {" "}
            <button type="button" className="gdev-link" onClick={() => { resetGravity(); setStatus(getGravityStatus()); }}>
              Re-arm
            </button>
          </>
        )}
      </p>
      {ROWS.map(([k, name, min, max, step, hint]) => {
        const v = cfg[k];
        const changed = v !== GRAVITY_DEFAULTS[k];
        const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
        return (
          <label key={k} className="gdev-row">
            <span className="gdev-row-head">
              <span className={changed ? "gdev-changed" : undefined}>{name}</span>
              <span className="gdev-val">{v.toFixed(dec)}</span>
            </span>
            <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="gdev-hint">{hint}</span>
          </label>
        );
      })}
      <div className="gdev-code-row">
        <code className="gdev-code">{code}</code>
        <DevCopy text={code} />
      </div>
    </aside>
  );
}
