import { StrictMode, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { CodeBlock } from "./examples/CodeCopy";
import { StudioTeaser, useEntitled, type TeaserRow } from "./examples/StudioTeaser";
import { PgTabs } from "./examples/PgTabs";
import { DistortionWavePreview } from "./distortion-waves/Preview";
import { WaveVariant } from "./distortion-waves/Components";
import type { Which } from "./distortion-waves/WaveControls";
import { defaultStyle as packageStyle } from "distortion-waves";
import { defaultStyle, duration, PALETTES, rgbToHex, type WaveType } from "./distortion-waves/model";
import { PHONE, SHEET } from "./distortion-waves/scenes";

/* Distortion waves detail page — one React island: the playground (stage +
   controls) and the live snippet under it. The library has two ports, and
   the page's platform tabs (site.js) choose which one the stage shows:

   - React: the `distortion-waves` package itself, on the wave components
     (./distortion-waves/Components, WaveVariant), all real DOM.
   - SwiftUI: DistortionWavesKit, shown as a phone that a WebGL port of the
     Swift shaders draws, from the same timeline (./distortion-waves/Preview).

   The page tunes nothing but the type. On React each type shows one of the
   wave components (Send money, Add credits, Toast, Document), and the
   vertical wave's lean toward the press is an on/off switch that only Pro
   opens. Horizontal and diagonal are Pro's on both ports. Colour and duration show
   locked, as the Studio's own controls, under its teaser. The stage starts
   PAUSED, like every other library's. */

/* Four types on both ports: the library's vertical, center and horizontal,
   and a diagonal one, the center ring from a corner. The React stage shows
   each on one of the wave components (Send money, Add credits, Toast and
   Document); the phone on the SwiftUI demo's screens. */
type PageType = WaveType | "diagonal";
type Port = "react" | "swift";

/** The diagonal type's numbers over the center ring's: no anticipation and
    no pull, in grey at half strength, as the Document's. */
const DIAGONAL = { anticipation: 0, pull: 0, inhale: 0, gatherGlow: 0, gatherDots: 0 };

/** The types: horizontal and diagonal are Pro's. */
const pageTypes = (entitled: boolean) => [
  { value: "vertical" as const, label: "Vertical" },
  { value: "center" as const, label: "Center" },
  { value: "horizontal" as const, label: "Horizontal", locked: entitled ? undefined : "Available with Pro" },
  { value: "diagonal" as const, label: "Diagonal", locked: entitled ? undefined : "Available with Pro" },
];

/** The component each type shows on the React stage. */
const TYPE_COMPONENT: Record<PageType, Which> = { vertical: "send", center: "credits", horizontal: "toast", diagonal: "doc" };

const REACT_NOTE: Record<PageType, string> = {
  vertical: "Click Confirm: the wave goes up the modal from the button, and the avatar turns into the check as the front passes it.",
  center: "Click Buy: after a moment of processing, the token squeezes, a ring leaves it, and it turns into the check.",
  horizontal: "Press Play: the spinner turns for a second, then the wave crosses the toast from the token as it turns into the check.",
  diagonal: "Click Rewrite: after a moment of rewriting, a grey ring sweeps the new text in from the card's corner.",
};

const REACT_SNIPPET: Record<PageType, string> = {
  vertical: `import { DistortionWave } from "distortion-waves";

<DistortionWave
  revealed={sent}
  source={button}
  revealedContent={<Review sent />}
  overlay={<button ref={button} onClick={() => setSent(true)}>Confirm</button>}
>
  <Review />
</DistortionWave>`,
  center: `import { DistortionWave } from "distortion-waves";

<DistortionWave type="center" revealed={bought} source={token} revealedContent={<Credits added />}>
  <Credits tokenRef={token} />
</DistortionWave>`,
  horizontal: `import { DistortionWave } from "distortion-waves";

<DistortionWave type="horizontal" palette="green" role="status" revealed={sent} source={token} revealedContent={<Toast sent />}>
  <Toast tokenRef={token} />
</DistortionWave>`,
  diagonal: `import { DistortionWave } from "distortion-waves";

// A ring from the card's top left corner, with no anticipation.
<DistortionWave
  type="center"
  palette="mono"
  source={{ x: -1, y: -1, w: 2, h: 2 }}
  waveStyle={{ anticipation: 0, pull: 0, inhale: 0 }}
  revealed={rewritten}
  revealedContent={<Document text={next} />}
>
  <Document text={current} />
</DistortionWave>`,
};

const SWIFT_NOTE: Record<PageType, string> = {
  vertical: "Touch Confirm: the wave goes up the screen from the button.",
  center: "Touch Send: after a moment of processing, a ring leaves the token as it becomes the check.",
  horizontal: "Touch the handle on the left edge: the wave crosses the screen from it.",
  diagonal: "Touch Confirm: a grey ring sweeps the screen from its top left corner, with no anticipation.",
};

const SWIFT_SNIPPET: Record<PageType, string> = {
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
  horizontal: `import DistortionWavesKit

DistortionWave(isRevealed: sent, source: edgeFrame, focus: touch, style: .horizontal) {
    ReviewScreen()
} revealed: {
    ReceiptScreen()
}`,
  diagonal: `import DistortionWavesKit

var style = DistortionWaveStyle.center
style.anticipation = 0   // no pull before it leaves
style.palette = .mono

// A ring from the screen's top left corner.
DistortionWave(isRevealed: sent, source: CGRect(x: -1, y: -1, width: 2, height: 2), style: style) {
    ReviewScreen()
} revealed: {
    ReceiptScreen()
}`,
};

/* The lean toward the press: Pro opens it, everyone else sees it locked. */
type Lean = "off" | "on";

/** The platform site.js is about to choose: the saved one if this page has
    it, else the page's first. Read before the first paint, so a visitor who
    last looked at SwiftUI does not see the desktop demo flash by. */
function startsOnPhone(): boolean {
  const ready = Array.from(document.querySelectorAll<HTMLElement>("[data-head-platform]:not([data-soon])"), (tab) => tab.dataset.headPlatform);
  let saved: string | null = null;
  try {
    saved = localStorage.getItem("ldev:platform");
  } catch {
    /* no storage: the page's own platform */
  }
  const platform = saved && ready.includes(saved) ? saved : (ready[0] ?? "react");
  return platform !== "react";
}

/** True while site.js has the stage in its phone frame (SwiftUI). */
function usePhone(stage: RefObject<HTMLDivElement>) {
  const [phone, setPhone] = useState(startsOnPhone);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const read = () => setPhone(el.getAttribute("data-device") === "phone");
    const watch = new MutationObserver(read);
    watch.observe(el, { attributes: true, attributeFilter: ["data-device"] });
    return () => watch.disconnect();
  }, [stage]);
  return phone;
}

function Playground() {
  const [chosenType, setType] = useState<PageType>("vertical");
  const [chosenLean, setLean] = useState<Lean>("off");
  const [paused, setPaused] = useState(true);
  const stage = useRef<HTMLDivElement>(null);
  const phone = usePhone(stage);
  const entitled = useEntitled();
  // A Pro type picked before signing out goes back to vertical.
  const open = entitled || chosenType === "vertical" || chosenType === "center";
  const type: PageType = open ? chosenType : "vertical";
  const lean = entitled && chosenLean === "on";
  // The waves a touch starts: the vertical one, and on the phone the
  // horizontal one too, from its edge handle (React's toast plays itself).
  const leans = type === "vertical" || (phone && type === "horizontal");

  /* The type's tuned defaults, round the phone's (or the sheet's) corners.
     The diagonal type is the center ring, from a corner. */
  const waveType: WaveType = type === "diagonal" ? "center" : type;
  const style = useMemo(() => {
    const s = defaultStyle(waveType);
    if (type === "diagonal") {
      Object.assign(s, DIAGONAL);
      s.strength *= 0.5;
      s.rimStrength *= 0.5;
      s.palette = PALETTES.mono;
    }
    s.cornerRadius = type === "center" ? SHEET.radius : PHONE.radius;
    // Touch orientation off: the wave leaves the source evenly.
    if (!lean) s.orientation = 0;
    return s;
  }, [type, waveType, lean]);

  /* Colour and duration, locked: the Studio tunes them. */
  const teaser: TeaserRow[] = [
    { kind: "swatches", label: "Colour", colors: [style.palette, PALETTES.ocean, PALETTES.sunset, PALETTES.mono, waveType === "center" ? PALETTES.colorful : PALETTES.green].map((p) => rgbToHex(p.colors[0])) },
    { kind: "slider", label: "Duration", value: `${duration(style).toFixed(2)}s`, fill: Math.round((style.travel / 4.5) * 100) },
    { kind: "slider", label: "Swell", value: `${style.amplitude}pt`, fill: Math.round((style.amplitude / 80) * 100) },
    { kind: "slider", label: "Edges", value: `${style.rimWidth}pt`, fill: Math.round((style.rimWidth / 60) * 100) },
  ];

  return (
    <>
      <p className="detail-playground-label">Playground</p>

      <div className="pg">
        <div className="pg-stage" id="playground-stage" ref={stage}>
          {phone ? (
            <DistortionWavePreview style={style} playing={!paused} diagonal={type === "diagonal"} />
          ) : (
            <WaveVariant key={type} which={TYPE_COMPONENT[type]} playing={!paused} lean={lean} />
          )}
          <button type="button" className="btn-animate pg-play" onClick={() => setPaused((p) => !p)} aria-pressed={!paused}>
            {paused ? "Play" : "Pause"}
          </button>
        </div>

        <div className="pg-controls" id="playground-controls">
          <div>
            <PgTabs label="Type" options={pageTypes(entitled)} value={type} onChange={setType} />
            <span className="pg-note">{phone ? SWIFT_NOTE[type] : REACT_NOTE[type]}</span>
          </div>
          {leans ? (
            <div>
              <PgTabs
                label="Touch orientation"
                options={[
                  { value: "off", label: "Off" },
                  { value: "on", label: "On", locked: entitled ? undefined : "Available with Pro" },
                ]}
                value={lean ? "on" : "off"}
                onChange={setLean}
              />
              <span className="pg-note">
                The wave leans toward where you {phone ? "touch" : "click"} {type === "horizontal" ? "the handle" : "the button"}, from the moment it leaves it.
              </span>
            </div>
          ) : null}
          <StudioTeaser rows={teaser} />
        </div>
      </div>

      <CodeBlock code={phone ? SWIFT_SNIPPET[type] : REACT_SNIPPET[type]} label="Copy playground code" className="pg-snippet" />
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
