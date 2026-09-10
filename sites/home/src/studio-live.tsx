import { createRoot } from "react-dom/client";
import { BorderBeam } from "border-beam";
import { ThinkingStatus } from "./studio/controls";

/* Studio page preview cards: two live pieces laid over the exported
   screenshots, so the parts that move in the app move here too.
   - The agent card's status row is the Studio's own ThinkingStatus
     (controls.tsx): orb, shimmer and the line cycle, unchanged.
   - The stage's demo card is a real BorderBeam around a mock card, at the
     spot the screenshot shows it, so the beam actually runs. */

const status = document.getElementById("studio-agent-live");
if (status) {
  status.textContent = "";
  createRoot(status).render(<ThinkingStatus />);
}

const beam = document.getElementById("studio-beam-live");
if (beam) {
  beam.textContent = "";
  createRoot(beam).render(
    <BorderBeam size="md" colorVariant="colorful" theme="dark">
      <div className="st-beam-mock" aria-hidden="true">
        <i /><i />
      </div>
    </BorderBeam>,
  );
}

/* The overlay frames are designed in the card's desktop pixel frame; scale
   them to the card's rendered width so they keep their spot on the
   screenshot when the grid collapses on a phone. */
for (const frame of document.querySelectorAll<HTMLElement>(".studio-live-frame")) {
  const card = frame.parentElement;
  if (!card) continue;
  const designWidth = parseFloat(frame.style.getPropertyValue("--frame-w")) || card.clientWidth;
  const fit = () => card.style.setProperty("--studio-k", String(card.clientWidth / designWidth));
  fit();
  new ResizeObserver(fit).observe(card);
}
