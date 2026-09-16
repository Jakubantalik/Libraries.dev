/* Studio teaser (Figma 1425:38896) — the paywall foot of every detail
   playground panel. A locked replica of the library's real Studio controls
   sits at 20% opacity under a scrim that fades the panel surface in over a
   progressive blur; on top, the pitch and a Get access pill wearing the
   Tune-in-Studio rim wash. The replica is presentation only: static
   markup, aria-hidden, pointer-events off. */

export type TeaserRow =
  | { kind: "tabs"; label: string; options: string[] }
  | { kind: "slider"; label: string; value: string; fill: number }
  /** The Studio's colour picker row: a run of swatches, the first selected. */
  | { kind: "swatches"; label: string; colors: string[] };

export function StudioTeaser({ rows }: { rows: TeaserRow[] }) {
  return (
    <div className="pg-teaser">
      <div className="pg-teaser-locked" aria-hidden="true">
        {rows.map((row) => (
          <div className="pg-teaser-group" key={row.label}>
            <div className="pg-field">
              <span className="pg-label">{row.label}</span>
              {row.kind === "tabs" ? (
                <div className="pg-tabs">
                  {row.options.map((o, i) => (
                    <div className="pg-tab" data-active={i === 0 ? "true" : "false"} key={o}>
                      {o}
                    </div>
                  ))}
                </div>
              ) : row.kind === "swatches" ? (
                <div className="pg-swatches">
                  {row.colors.map((c, i) => (
                    <div className="pg-swatch" data-active={i === 0 ? "true" : "false"} style={{ background: c }} key={c} />
                  ))}
                </div>
              ) : (
                <div className="pg-vslider">
                  <div className="pg-vslider-fill" style={{ width: `${row.fill}%` }} />
                  <span className="pg-vslider-label">{row.label}</span>
                  <span className="pg-vslider-value">{row.value}</span>
                </div>
              )}
            </div>
            <div className="pg-teaser-sep" />
          </div>
        ))}
      </div>

      <div className="pg-teaser-scrim" aria-hidden="true" />

      <div className="pg-teaser-cta">
        <div className="pg-teaser-copy">
          <p className="pg-teaser-title">Tune In Studio</p>
          <p className="pg-teaser-sub">
            Customize it to perfection in Studio with 20+ customization
            options and AI agent assistance.
          </p>
        </div>
        <a className="t-pro-btn detail-studio pg-teaser-btn" href="/pro.html">
          <span className="t-pro-btn-label">Get access</span>
        </a>
      </div>
    </div>
  );
}
