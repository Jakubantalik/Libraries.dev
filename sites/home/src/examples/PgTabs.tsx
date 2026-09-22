/* The playground's pill radio tabs, shared by every detail page.
   Options past `open`, and the label-only `extra`, are what the free plan
   does not include. A handful of them sit in the row itself, dimmed, with
   a note on hover; a long tail instead goes behind the Studio teaser's
   fade, where a list that would dwarf the real choices reads as a taste
   rather than a wall. A single option can be locked on its own with
   `locked`. */

/* Up to this many locked choices stay in the row rather than the fade. */
const INLINE_LOCKS = 3;
const LOCK_NOTE = "Available with Pro plan";

export function PgTabs<T extends string>({
  label,
  options,
  value,
  onChange,
  open,
  extra,
}: {
  label: string;
  /* `locked` is the note the option shows instead of being selectable. */
  options: ReadonlyArray<{ value: T; label: string; locked?: string }>;
  value: T;
  onChange: (v: T) => void;
  /* How many of the options this plan opens. The rest are shown behind
     the same fade the Studio teaser uses, as a taste of what is there. */
  open?: number;
  /* Labels for choices the page cannot offer at all — they belong to the
     Studio, so they have no value here — shown behind the same fade. */
  extra?: readonly string[];
}) {
  const live = open === undefined ? options : options.slice(0, open);
  const locked = [
    ...(open === undefined ? [] : options.slice(open)).map((o) => o.label),
    ...(extra ?? []),
  ];
  const inline = locked.length <= INLINE_LOCKS ? locked : [];
  const behind = inline.length > 0 ? [] : locked;
  return (
    <div className="pg-field" role="radiogroup" aria-label={label}>
      <span className="pg-label">{label}</span>
      <div className="pg-tabs">
        {live.map((o) => (
          /* A locked option keeps the button — `disabled` would take it out
             of the tab order and, in some browsers, stop the hover that
             reveals the note — and turns the click away instead. */
          <button
            key={o.value}
            type="button"
            className="pg-tab"
            role="radio"
            aria-checked={value === o.value}
            aria-disabled={o.locked ? true : undefined}
            aria-describedby={o.locked ? `${label}-${o.value}-note` : undefined}
            data-active={value === o.value ? "true" : undefined}
            data-locked={o.locked ? "true" : undefined}
            onClick={() => {
              if (o.locked) return;
              onChange(o.value);
            }}
          >
            {/* The dimming rides the label, not the button: on the button
                it would take the note down with it. */}
            <span className="pg-tab-label">{o.label}</span>
            {o.locked ? (
              <span className="pg-lock-note" id={`${label}-${o.value}-note`} role="tooltip">
                {o.locked}
              </span>
            ) : null}
          </button>
        ))}
        {/* The few locked ones, in the row: same pill, dimmed, saying why
            on hover. They carry no value, so they only ever look back. */}
        {inline.map((o) => (
          <button
            key={o}
            type="button"
            className="pg-tab"
            role="radio"
            aria-checked={false}
            aria-disabled
            aria-describedby={`${label}-${o}-note`}
            data-locked="true"
            onClick={(e) => e.preventDefault()}
          >
            <span className="pg-tab-label">{o}</span>
            <span className="pg-lock-note" id={`${label}-${o}-note`} role="tooltip">
              {LOCK_NOTE}
            </span>
          </button>
        ))}
      </div>
      {behind.length > 0 ? (
        /* Presentation only: static markup, out of the tab order and out
           of the reader, dimmed under a fade to the panel. */
        <div className="pg-tabs-behind" aria-hidden="true">
          {/* the clip lives on the inner layer so the note, which sits on
              the block itself, isn't cut off with the last row */}
          <div className="pg-tabs-behind-clip">
            <div className="pg-tabs">
              {behind.map((o) => (
                <div className="pg-tab" key={o}>
                  <span className="pg-tab-label">{o}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="pg-tabs-scrim" />
          <span className="pg-lock-note pg-lock-note--block">{LOCK_NOTE}</span>
        </div>
      ) : null}
    </div>
  );
}
