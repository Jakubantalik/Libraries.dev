import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser, type TeaserRow } from "./examples/StudioTeaser";
import { PgTabs } from "./examples/PgTabs";
import { DistortionWavePreview } from "./distortion-waves/Preview";
import { defaultStyle, duration, PALETTES, rgbToHex, type WaveType } from "./distortion-waves/model";
import { PHONE, SHEET } from "./distortion-waves/scenes";

/* Distortion waves detail page — one React island: the playground (stage +
   controls) and the live snippet under it. The library is SwiftUI only
   (DistortionWavesKit), so the page's platform is SwiftUI and the stage is
   the phone; the WebGL port in ./distortion-waves draws the wave on it, from
   the same timeline as the Swift package.

   The page tunes nothing but the type, and shows two of the three: vertical
   and center (horizontal is the Studio's). Colour and duration show locked,
   as the Studio's own controls, under its teaser. The stage starts PAUSED,
   like every other library's. */

type PageType = Exclude<WaveType, "horizontal">;

const TYPE_OPTIONS = [
  { value: "vertical", label: "Vertical" },
  { value: "center", label: "Center" },
] as const;

const SOURCE_NOTE: Record<PageType, string> = {
  vertical: "Touch Confirm: the wave goes up the screen from the button.",
  center: "Touch Send: after a moment of processing, a ring leaves the token as it becomes the check.",
};

const SNIPPET: Record<PageType, string> = {
  vertical: `import DistortionWavesKit

DistortionWave(isRevealed: sent, source: buttonFrame, focus: touch, style: .vertical) {
    ReviewScreen()
} revealed: {
    ReceiptScreen()
}`,
  center: `import DistortionWavesKit

var style = DistortionWaveStyle.center
style.cornerRadius = 48   // the sheet's corners

DistortionWave(isRevealed: done, source: tokenFrame, style: style) {
    Sheet(sent: false)
} revealed: {
    Sheet(sent: true)
}`,
};

function Playground() {
  const [type, setType] = useState<PageType>("vertical");
  const [paused, setPaused] = useState(true);

  /* The type's tuned defaults, round the phone's (or the sheet's) corners. */
  const style = useMemo(() => {
    const s = defaultStyle(type);
    s.cornerRadius = type === "center" ? SHEET.radius : PHONE.radius;
    return s;
  }, [type]);

  /* Colour and duration, locked: the Studio tunes them. */
  const teaser: TeaserRow[] = [
    { kind: "swatches", label: "Colour", colors: [style.palette, PALETTES.ocean, PALETTES.sunset, PALETTES.mono, type === "center" ? PALETTES.colorful : PALETTES.green].map((p) => rgbToHex(p.colors[0])) },
    { kind: "slider", label: "Duration", value: `${duration(style).toFixed(2)}s`, fill: Math.round((style.travel / 4.5) * 100) },
    { kind: "slider", label: "Swell", value: `${style.amplitude}pt`, fill: Math.round((style.amplitude / 80) * 100) },
    { kind: "slider", label: "Edges", value: `${style.rimWidth}pt`, fill: Math.round((style.rimWidth / 60) * 100) },
  ];

  return (
    <>
      <p className="detail-playground-label">Playground</p>

      <div className="pg">
        <div className="pg-stage" id="playground-stage">
          <DistortionWavePreview style={style} playing={!paused} />
          <button type="button" className="btn-animate pg-play" onClick={() => setPaused((p) => !p)} aria-pressed={!paused}>
            {paused ? "Play" : "Pause"}
          </button>
        </div>

        <div className="pg-controls" id="playground-controls">
          <div>
            <PgTabs label="Type" options={TYPE_OPTIONS} value={type} onChange={setType} />
            <span className="pg-note">{SOURCE_NOTE[type]}</span>
          </div>
          <StudioTeaser rows={teaser} />
        </div>
      </div>

      <CodeBlock code={SNIPPET[type]} label="Copy playground code" className="pg-snippet" />
    </>
  );
}

const rootEl = document.getElementById("playground-root");
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <Playground />
    </StrictMode>
  );
}
